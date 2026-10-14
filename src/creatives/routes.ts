import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import { readSettings } from '../settings.js';
import { addDays, ukToday } from '../hero-range.js';
import { MetaSpend } from '../ad-spend/clients.js';
import { MetaCreativeClient } from './client.js';
import type { CreativeData, CreativeReader } from './model.js';
import type { CreativeView, CreativeSheet, CreativeSelection } from './presentation-types.js';
import { aggregateCreativeGroups, creativeWindowRange, parentGroup, topCreatives } from './ranking.js';
import { creativePerformance } from './performance.js';
import { exactCreativeFrequency, hasFadingHistory } from './frequency.js';
import { readCreativeData, readMedia, ensureGroupMedia, mergeMediaGroups, splitMediaGroup, undoMediaMerge } from './store.js';
import { seedCreativeSample } from './seed.js';
import { SAMPLE_CREATIVE_ACCOUNT, sampleCreativeAttributeRows, sampleCreativeStoredLifts } from './sample.js';
import { adsManagerLink, creativesPage, safeCreativeLink, escapeCreative } from './view.js';
import { resolveAttributes, type AttributeRow } from './attributes.js';
import { readAttributeRows, readGroupAttributes, readWillNote, saveWillNote, toggleWillAttribute } from './attribute-store.js';
import { creativeAttributeOptions, creativeTaggingQueue, filterCreativeAttributes } from './tagging.js';
import { runCreativeScans, type ScanOptions } from './scan.js';
import { readScanHealth, scanEnabled, scanPricesReady } from './scan-health.js';
import type { CreativeScanView } from './scan-view.js';
import { readCreativeLifts, recomputeCreativeLifts, type CreativeLift } from './lifts.js';
import { deriveCreativeLiftPresentation } from './lift-presentation.js';

class CreativeInputError extends Error { readonly statusCode = 400; constructor() { super('Invalid creative request.'); } }
const accountFor = (data: CreativeData, settings: Settings) => data.mode === 'sample' ? SAMPLE_CREATIVE_ACCOUNT : settings.metaAdAccountId;
const scanView = (scan: CreativeScanView): CreativeScanView => ({ enabled: scan.enabled, line: scan.line, message: scan.message });
const unscannedView = (settings: Settings): CreativeScanView => ({ enabled: false, line: 'Scan: off', message: scanPricesReady(settings) ? null : 'Set the scan prices in Settings' });
type ShopifyOrders = (from: string, to: string) => Promise<{ count: number | null; mode: SourceMode }>;
function sampleAttributeRows(data: CreativeData): AttributeRow[] {
  return data.mode === 'sample' ? sampleCreativeAttributeRows(data) : [];
}
function sampleLifts(data: CreativeData, today: string): CreativeLift[] {
  return data.mode === 'sample' ? sampleCreativeStoredLifts(new Date(`${today}T12:00:00Z`)) : [];
}
async function storedLifts(db: Database, account: string, data: CreativeData, today: string): Promise<CreativeLift[]> {
  const stored = await readCreativeLifts(db, account, data.mode);
  return stored.length || data.mode !== 'sample' ? stored : sampleLifts(data, today);
}
async function refreshSavedLifts(db: Database, account: string, data: CreativeData, settings: Settings, now: Date): Promise<void> {
  // The user's tag or completed scan is already durable. A derived-data failure must
  // not turn that successful toggle into a retry which would clear the saved answer.
  try { await recomputeCreativeLifts(db, account, data, settings, now); }
  catch { console.error('Creative lifts could not be refreshed.'); }
}
export function buildCreativeView(data: CreativeData, settings: Settings, today: string, selection: CreativeSelection = {}, attributes = sampleAttributeRows(data), lifts = sampleLifts(data, today)): CreativeView {
  const selected = { ...selection, window: selection.window ?? settings.creativeDefaultWindow };
  const top = topCreatives(data, settings, { ...selected, today });
  const performance = creativePerformance(data, settings, { ...selected, today });
  const groups = filterCreativeAttributes(aggregateCreativeGroups(data, { ...selected, to: today }), attributes, selected.attribute, selected.value)
    .sort((a, b) => b.group.firstSeen.localeCompare(a.group.firstSeen) || a.group.id.localeCompare(b.group.id));
  const cards: CreativeView['cards'] = performance.fading.map(row => ({
    id: `fading:${row.groupId}`, kind: 'watch', groupId: row.groupId,
    picture: data.groups.find(group => group.id === row.groupId)?.thumbnailUrl ?? '',
    title: `Fading: ${row.title}`, reason: row.reasons.join('; '), mode: data.mode,
  }));
  const presentation = deriveCreativeLiftPresentation(lifts, data);
  cards.push(...presentation.cards);
  return { scan: unscannedView(settings), mode: data.mode, accountId: accountFor(data, settings), selection: selected, top, performance, groups, cards,
    taggingQueue: creativeTaggingQueue(data, attributes, settings.creativeSpendFloorGbp, today), attributeFilters: creativeAttributeOptions(selected.kind),
    lifts, winning: presentation.winning, makeNext: presentation.makeNext,
    targets: { uk: settings.cppUkTargetGbp, us: settings.cppUsTargetGbp }, freelancerInitial: settings.creativeFreelancerInitial,
    merged: data.groups.filter(group => group.mergedIntoId).map(group => ({ id: group.id, title: group.title, parentId: group.mergedIntoId! })) };
}
export async function readCreativeView(db: Database, settings: Settings, env: NodeJS.ProcessEnv, now: Date, selection: CreativeSelection = {}): Promise<CreativeView> {
  const data = await readCreativeData(db, settings, env, now);
  if (data.mode === 'sample') await seedCreativeSample(db, settings, now);
  const attributes = await readAttributeRows(db, data.mode, accountFor(data, settings));
  const lifts = await storedLifts(db, accountFor(data, settings), data, ukToday(now));
  const view = buildCreativeView(data, settings, ukToday(now), selection, attributes, lifts);
  view.scan = scanView(await readScanHealth(db, settings, { mode: data.mode, accountId: view.accountId, now }));
  const states = await db.query<{ card_id: string; done_at: Date | null; snoozed_until: Date | null }>(
    'SELECT card_id,done_at,snoozed_until FROM pulse.creative_card_states WHERE account_id=$1 AND mode=$2', [view.accountId, view.mode]);
  const hidden = new Set(states.rows.filter(row => row.done_at || row.snoozed_until && new Date(row.snoozed_until).getTime() > now.getTime()).map(row => row.card_id));
  view.cards = view.cards.filter(card => !hidden.has(card.id));
  return view;
}
function parseSelection(query: unknown, detail = false): CreativeSelection {
  if (!query || typeof query !== 'object') return {};
  const values = query as Record<string, unknown>;
  const choices: Record<string, readonly string[]> = { window: ['24h', '3d', '7d'], market: ['all', 'uk', 'us'], owner: ['all', 'ours', 'freelancer', 'unassigned'], kind: ['all', 'video', 'image'], live: ['all', 'true', 'false'] };
  for (const [key, value] of Object.entries(values)) {
    if (detail && key !== 'window' || typeof value !== 'string') throw new CreativeInputError();
    if (key === 'attribute' || key === 'value') continue;
    if (!Object.hasOwn(choices, key) || !choices[key]!.includes(value)) throw new CreativeInputError();
  }
  if (values.attribute || values.value) {
    const definition = creativeAttributeOptions((values.kind ?? 'all') as 'all' | 'video' | 'image').find(attribute => attribute.key === values.attribute);
    if (!definition || values.value && !definition.values.some(option => option.value === values.value)) throw new CreativeInputError();
  }
  return { ...values, ...(values.live && values.live !== 'all' ? { live: values.live === 'true' } : {}) } as CreativeSelection;
}
export async function buildCreativeSheet(data: CreativeData, settings: Settings, today: string, id: string, selection: CreativeSelection, shopifyOrders: ShopifyOrders, lifts = sampleLifts(data, today)): Promise<CreativeSheet | null> {
  const parent = parentGroup(id, data.groups);
  const group = aggregateCreativeGroups(data, { to: today }).find(row => row.group.id === parent?.id);
  if (!group) return null;
  const range = creativeWindowRange(selection.window ?? settings.creativeDefaultWindow, today);
  const orders = await shopifyOrders(range.from, range.to);
  const links: CreativeSheet['links'] = [];
  const addLink = (label: string, value: string | null) => {
    const url = safeCreativeLink(value);
    if (url && !links.some(link => link.label === label)) links.push({ label, url });
  };
  for (const ad of group.ads) addLink('Instagram', ad.instagramUrl);
  for (const ad of group.ads) addLink('Facebook', ad.facebookUrl);
  for (const ad of group.ads) addLink('Ads Manager', adsManagerLink(accountFor(data, settings), ad.id));
  return { scan: unscannedView(settings), mode: data.mode, group,
    windows: (['24h', '3d', '7d', 'lifetime'] as const).map(window => ({ window, totals: aggregateCreativeGroups(data, creativeWindowRange(window, today)).find(row => row.group.id === parent?.id)!.totals })),
    comparison: { ...range, purchases: data.insights.filter(row => row.day >= range.from && row.day <= range.to).reduce((sum, row) => sum + row.purchases, 0), shopifyOrders: orders.count, shopifyMode: orders.mode },
    frequency: { value: exactCreativeFrequency(data, group.ads.map(ad => ad.id), addDays(today, -6), today), eligible: hasFadingHistory(group, today) },
    links, ads: group.ads, attributes: resolveAttributes(group.group.kind, sampleAttributeRows(data).filter(row => row.groupId === group.group.id)), note: '',
    brief: deriveCreativeLiftPresentation(lifts, data).makeNext[group.group.kind]?.brief };
}
export function safeVideoSource(value: string, token?: string): string | null {
  const url = safeCreativeLink(value);
  if (!url) return null;
  const variants = [value];
  try { variants.push(decodeURIComponent(value)); } catch { return null; }
  if (token && variants.some(candidate => candidate.includes(token))) return null;
  return url;
}
export function registerCreatives(app: FastifyInstance, db: Database, auth: Auth, env: NodeJS.ProcessEnv,
  clock: () => Date, shopifyOrders: ShopifyOrders, publish: () => Promise<unknown>, reader?: CreativeReader, scanOptions: Pick<ScanOptions, 'fetch' | 'clock' | 'sleep'> = {}): void {
  const client = reader ?? (env.META_ACCESS_TOKEN ? new MetaCreativeClient(new MetaSpend(env.META_ACCESS_TOKEN)) : undefined);
  const localWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({ error: 'Request origin is not allowed.' });
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({ error: 'Use a JSON request.' });
  };
  const current = async () => { const settings = (await readSettings(db)).values; return { settings, data: await readCreativeData(db, settings, env, clock()) }; };
  app.get('/creatives', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const settings = (await readSettings(db)).values;
    return reply.type('text/html; charset=utf-8').send(creativesPage(await readCreativeView(db, settings, env, clock(), parseSelection(request.query))));
  });
  app.get('/api/creatives', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return readCreativeView(db, (await readSettings(db)).values, env, clock(), parseSelection(request.query));
  });
  app.get('/api/creatives/:groupId', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const { settings, data } = await current();
    const id = (request.params as { groupId: string }).groupId;
    const sheet = await buildCreativeSheet(data, settings, ukToday(clock()), id, parseSelection(request.query, true), shopifyOrders, await storedLifts(db, accountFor(data, settings), data, ukToday(clock())));
    if (!sheet) return reply.code(404).send({ error: 'Creative not found.' });
    if (data.mode === 'sample') await seedCreativeSample(db, settings, clock());
    sheet.attributes = await readGroupAttributes(db, data.mode, accountFor(data, settings), sheet.group.group.id, sheet.group.group.kind);
    sheet.note = await readWillNote(db, data.mode, accountFor(data, settings), sheet.group.group.id);
    sheet.scan = scanView(await readScanHealth(db, settings, { mode: data.mode, accountId: accountFor(data, settings), now: clock() }));
    // Opening an evicted video re-fetches its frames, without storing the video itself.
    if (client && data.mode === 'live' && sheet.group.group.kind === 'video') await ensureGroupMedia(client, db, settings.metaAdAccountId, sheet.group.group.id, settings.creativeMediaCapMb).catch(() => null);
    return sheet;
  });
  app.post('/api/creatives/:groupId/attributes', { preHandler: localWrite }, async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const body = request.body as { key?: unknown; value?: unknown } | null;
    if (!body || Object.keys(body).some(key => key !== 'key' && key !== 'value')
      || typeof body.key !== 'string' || typeof body.value !== 'string') throw new CreativeInputError();
    const { settings, data } = await current(), now = clock(), account = accountFor(data, settings);
    const group = parentGroup((request.params as { groupId: string }).groupId, data.groups);
    if (!group) return reply.code(404).send({ error: 'Creative not found.' });
    if (data.mode === 'sample') await seedCreativeSample(db, settings, now);
    let result;
    try {
      result = body.key === 'note'
        ? { groupId: group.id, note: await saveWillNote(db, data.mode, account, group.id, body.value, now) }
        : { groupId: group.id, attribute: await toggleWillAttribute(db, data.mode, account, group.id, body.key, body.value, now) };
    } catch { throw new CreativeInputError(); }
    await refreshSavedLifts(db, account, data, settings, now);
    await publish();
    return result;
  });
  app.post('/api/creatives/:groupId/scan', { preHandler: localWrite }, async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length) throw new CreativeInputError();
    const { settings, data } = await current(), accountId = accountFor(data, settings);
    const group = parentGroup((request.params as { groupId: string }).groupId, data.groups);
    if (!group) return reply.code(404).send({ error: 'Creative not found.' });
    if (!scanEnabled(data.mode)) return reply.code(403).send({ error: 'Creative scanning is off.' });
    const result = await runCreativeScans(db, settings, { ...scanOptions, clock: scanOptions.clock ?? clock,
      accountId, mode: data.mode, groupId: group.id, reader: client });
    if (result.done) await refreshSavedLifts(db, accountId, data, settings, clock());
    const scan = scanView(await readScanHealth(db, settings, { accountId, mode: data.mode, now: clock() }));
    const attributes = await readGroupAttributes(db, data.mode, accountId, group.id, group.kind);
    await publish();
    return { groupId: group.id, result, scan, attributes };
  });
  app.get('/media/:groupId', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const { settings, data } = await current();
    const group = parentGroup((request.params as { groupId: string }).groupId, data.groups);
    if (!group) return reply.code(404).send({ error: 'Media not found.' });
    const query = request.query as Record<string, unknown>;
    if (Object.entries(query).some(([key, value]) => !['play', 'full'].includes(key) || value !== '1') || query.play && query.full) throw new CreativeInputError();
    reply.header('Cache-Control', 'private, no-store'); reply.header('Referrer-Policy', 'no-referrer');
    if (query.play) {
      if (group.kind !== 'video') return reply.code(400).send({ error: 'This creative is an image.' });
      try {
        if (!client || data.mode !== 'live' && !reader) throw new Error('Unavailable');
        const url = safeVideoSource(await client.videoSource(group.key), env.META_ACCESS_TOKEN);
        if (!url) throw new Error('Unavailable');
        return reply.redirect(url, 302);
      } catch {
        const ad = data.ads.find(ad => parentGroup(ad.mediaGroupId, data.groups)?.id === group.id);
        const manager = ad ? adsManagerLink(accountFor(data, settings), ad.id) : null;
        return reply.code(403).type('text/html; charset=utf-8').send(`<p>Meta would not give the video; ${manager ? `<a href="${escapeCreative(manager)}" rel="noopener noreferrer">open in Ads Manager</a>` : 'open in Ads Manager when an account link is available.'}</p>`);
      }
    }
    if (data.mode === 'sample') {
      const prefix = 'data:image/svg+xml,';
      if (!group.thumbnailUrl.startsWith(prefix)) return reply.code(404).send({ error: 'Media not found.' });
      return reply.type('image/svg+xml').send(decodeURIComponent(group.thumbnailUrl.slice(prefix.length)));
    }
    const account = settings.metaAdAccountId;
    let media = await readMedia(db, account, group.id, !!query.full);
    if (!media && client) {
      try { media = await ensureGroupMedia(client, db, account, group.id, settings.creativeMediaCapMb, !!query.full); }
      catch { media = query.full ? await readMedia(db, account, group.id) : null; }
    }
    if (!media) return reply.code(404).send({ error: 'Media is temporarily unavailable.' });
    return reply.type(media.mime).send(Buffer.from(media.bytes));
  });
  app.post('/api/creatives/cards', { preHandler: localWrite }, async (request, reply) => {
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({ error: 'Sign in to continue.' });
    const body = request.body as { cardId?: unknown; action?: unknown } | null;
    if (!body || typeof body.cardId !== 'string' || !['done', 'snooze', 'undo'].includes(String(body.action))) throw new CreativeInputError();
    const { settings, data } = await current(), now = clock();
    const view = buildCreativeView(data, settings, ukToday(now), {}, [], await storedLifts(db, accountFor(data, settings), data, ukToday(now)));
    // A filtered Watch can disappear in the whole-account totals or recover before
    // the tap. Acknowledge its current account parent, rather than rerunning that verdict.
    const fadingGroupId = body.cardId.startsWith('fading:') ? body.cardId.slice('fading:'.length) : null;
    const ownParent = fadingGroupId !== null && data.groups.some(group => group.id === fadingGroupId && !group.mergedIntoId);
    if (!ownParent && !view.cards.some(card => card.id === body.cardId) && body.action !== 'undo') throw new CreativeInputError();
    if (body.action === 'undo') await db.query('DELETE FROM pulse.creative_card_states WHERE account_id=$1 AND mode=$2 AND card_id=$3', [view.accountId, view.mode, body.cardId]);
    else await db.query(`INSERT INTO pulse.creative_card_states(account_id,mode,card_id,done_at,snoozed_until,updated_by) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(account_id,mode,card_id) DO UPDATE SET done_at=EXCLUDED.done_at,snoozed_until=EXCLUDED.snoozed_until,updated_by=EXCLUDED.updated_by`,
      [view.accountId, view.mode, body.cardId, body.action === 'done' ? now : null, body.action === 'snooze' ? new Date(now.getTime() + 7 * 86400000) : null, who]);
    await publish(); return { saved: true };
  });
  app.post('/api/creatives/merges', { preHandler: localWrite }, async (request, reply) => {
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({ error: 'Sign in to continue.' });
    const body = request.body as { action?: unknown; groupIds?: unknown; mergeId?: unknown } | null;
    if (!body || !['merge', 'split', 'undo'].includes(String(body.action))) throw new CreativeInputError();
    const { settings, data } = await current(), now = clock(), account = accountFor(data, settings);
    if (data.mode === 'sample') await seedCreativeSample(db, settings, now);
    let mergeId = '';
    try {
      if (body.action === 'undo') {
        if (typeof body.mergeId !== 'string') throw new CreativeInputError();
        await undoMediaMerge(db, account, body.mergeId, who, now);
      } else {
        if (!Array.isArray(body.groupIds) || body.groupIds.length !== (body.action === 'merge' ? 2 : 1) || body.groupIds.some(id => typeof id !== 'string' || !data.groups.some(group => group.id === id && group.kind === 'video'))) throw new CreativeInputError();
        mergeId = body.action === 'merge' ? await mergeMediaGroups(db, account, body.groupIds[1], body.groupIds[0], who, now) : await splitMediaGroup(db, account, body.groupIds[0], who, now);
      }
    } catch { throw new CreativeInputError(); }
    await publish(); return { mergeId };
  });
}
