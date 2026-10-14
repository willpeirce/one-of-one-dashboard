import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdError } from '../src/ad-spend/model.js';
import { MetaCreativeClient } from '../src/creatives/client.js';
import type { CatalogueEntry, CatalogueRead } from '../src/creatives/model.js';
import { defaultSettings } from '../src/settings.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const now = new Date('2026-10-13T12:00:00Z');
const settings = defaultSettings();
const ad = (creative: string, values: Record<string, unknown> = {}) => ({ id: `invented-ad-${creative}`, name: 'Invented creative example',
  status: 'PAUSED', effective_status: 'PAUSED', created_time: '2026-09-01T10:00:00Z',
  campaign: { id: 'invented-campaign', name: 'Invented discovery UK' }, adset: { id: 'invented-set', name: 'Invented US alternative' },
  creative: { id: creative, thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-64.jpg' }, ...values });
function reader(route: (url: URL, init?: RequestInit) => unknown | Promise<unknown>, credential?: string) {
  const token = credential ?? `invented-${randomBytes(16).toString('hex')}`;
  const requests: { url: URL; init?: RequestInit }[] = [], logs: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    const value = await route(url, init);
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'x-fb-trace-id': token } });
  };
  const options = { fetch: fetcher, sleep: async () => {}, log: (entry: unknown) => logs.push(entry) };
  return { client: new MetaCreativeClient(new MetaSpend(token, options), options), requests, token, logs };
}
const account = { currency: 'GBP', timezone_name: 'Europe/London' };
const picture = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
function detailed(entries: CatalogueRead[]): CatalogueEntry[] {
  return entries.map(entry => {
    assert.ok(entry.media, 'Expected a full catalogue entry');
    return entry as CatalogueEntry;
  });
}

test('SHARE catalogue reads the object story and stores the explicitly requested 600 thumbnail', async () => {
  const mock = reader(url => {
    if (url.hostname !== 'graph.facebook.com') return picture();
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad('invented-share')] };
    if (url.pathname.endsWith('/invented-share')) return { id: 'invented-share', object_type: 'SHARE', effective_object_story_id: 'invented-story', thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-600.jpg' };
    if (url.pathname.endsWith('/invented-story')) return { attachments: { data: [{ type: 'video_inline', target: { id: 'invented-video' }, media: { image: { src: 'https://scontent.xx.fbcdn.net/invented-attachment.jpg' } } }] }, permalink_url: 'https://www.facebook.com/invented-story' };
    if (url.pathname.endsWith('/invented-video/thumbnails')) return { data: [] };
    if (url.pathname.endsWith('/invented-video')) return { title: 'Invented creator upload', length: 12.4, format: [{ width: 600, height: 800 }] };
    throw new Error('Unexpected invented request');
  });
  const entries = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.media.key, 'invented-video');
  assert.equal(entries[0]!.media.kind, 'video');
  assert.deepEqual(entries[0]!.media.thumbnail, jpeg);
  assert.equal(entries[0]!.ad.facebookUrl, 'https://www.facebook.com/invented-story');
  assert.equal(entries[0]!.ad.owner, 'unassigned');
  assert.equal(entries[0]!.ad.market, 'uk', 'Unassigned ads use campaign placement');
  const creative = mock.requests.find(request => request.url.pathname.endsWith('/invented-share'))!;
  assert.equal(creative.url.searchParams.get('thumbnail_width'), '600');
  assert.equal(creative.url.searchParams.get('thumbnail_height'), '600');
  assert.ok(mock.requests.some(request => request.url.pathname.endsWith('/invented-600.jpg')));
  assert.ok(mock.requests.every(request => !request.url.pathname.endsWith('/invented-64.jpg')));
  assert.ok(mock.requests.every(request => request.init?.method === 'GET'));
  assert.ok(mock.requests.filter(request => request.url.hostname !== 'graph.facebook.com').every(request => !new Headers(request.init?.headers).has('authorization')));
  const statuses = JSON.parse(mock.requests.find(request => request.url.pathname.endsWith('/ads'))!.url.searchParams.get('effective_status')!);
  assert.deepEqual(statuses, ['ACTIVE', 'PAUSED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS', 'WITH_ISSUES']);
});

test('refused SHARE reads retain their 600 picture with a refillable creative key and log refusal once', async () => {
  const captured: unknown[] = [], originalInfo = console.info;
  console.info = (...values) => { captured.push(values); };
  try {
    const mock = reader(url => {
      if (url.hostname !== 'graph.facebook.com') return picture();
      if (url.pathname.endsWith('/act_invented-account')) return account;
      if (url.pathname.endsWith('/ads')) return { data: [ad('invented-denied')] };
      if (url.pathname.endsWith('/invented-denied')) return { object_type: 'SHARE', effective_object_story_id: 'invented-refused-story', thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-600.jpg', link_url: `https://example.invalid/${encodeURIComponent(mock.token)}` };
      return new Response(JSON.stringify({ error: { code: 200, message: mock.token } }), { status: 403 });
    });
    const first = detailed(await mock.client.readCatalogue('invented-account', settings, now));
    assert.equal(first[0]!.media.key, 'creative:invented-denied');
    assert.deepEqual(first[0]!.media.thumbnail, jpeg);
    assert.equal(first[0]!.ad.facebookUrl, null);
    assert.equal(first[0]!.ad.linkUrl, null);
    const logs = captured.length;
    await mock.client.readCatalogue('invented-account', settings, now);
    assert.equal(captured.length, logs);
    assert.ok(!JSON.stringify([first, captured, mock.logs]).includes(mock.token));
  } finally { console.info = originalInfo; }
});

test('placement customisation has one primary hash and one alternate; duplicate ads reuse the media download', async () => {
  const mock = reader(url => {
    if (url.hostname !== 'graph.facebook.com') return picture();
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad('invented-feed'), ad('invented-feed', { id: 'invented-second-ad' })] };
    return { object_type: 'PHOTO', thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-feed600.jpg',
      asset_feed_spec: { images: [{ hash: 'invented-first-hash' }, { hash: 'invented-second-hash' }] } };
  });
  const entries = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.equal(entries[0]!.media.key, 'invented-first-hash');
  assert.deepEqual(entries[0]!.media.alternates, [{ kind: 'image', key: 'invented-second-hash' }]);
  assert.equal(entries[0]!.media, entries[1]!.media);
  assert.equal(mock.requests.filter(request => request.url.hostname !== 'graph.facebook.com').length, 1);
});

test('persisted groups update metadata without replenishing cap-evicted bytes on catalogue refresh', async () => {
  const mock = reader(url => {
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad('invented-existing', { creative: { id: 'invented-existing', video_id: 'invented-video' } })] };
    if (url.pathname.endsWith('/invented-existing')) return { video_id: 'invented-video', thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-600.jpg' };
    if (url.pathname.endsWith('/invented-video')) return { title: 'Invented updated title', length: 14 };
    throw new Error('A stored group must not re-download media in the catalogue');
  });
  mock.client.rememberStoredMedia(['video:invented-video']);
  const result = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.equal(result[0]!.media.title, 'Invented updated title');
  assert.equal(result[0]!.media.thumbnail, null);
  assert.deepEqual(result[0]!.media.frames, []);
  assert.ok(!mock.requests.some(request => request.url.pathname.endsWith('/invented-existing')), 'The listed video key already belongs to a stored group');
});

test('daily ad insights page, retain attribution actions and record the two-second fallback only when needed', async () => {
  const base = { ad_id: 'invented-ad', adset_id: 'invented-set', date_start: '2026-10-12', spend: '64.50', impressions: '1000', reach: '500', frequency: '2',
    actions: [{ action_type: 'omni_purchase', value: '3' }, { action_type: 'omni_add_to_cart', value: '7' }],
    action_values: [{ action_type: 'omni_purchase', value: '240' }], video_continuous_2_sec_watched_actions: [{ action_type: 'video_view', value: '200' }],
    video_play_actions: [{ action_type: 'video_view', value: '300' }], video_thruplay_watched_actions: [{ action_type: 'video_view', value: '100' }],
    video_avg_time_watched_actions: [{ action_type: 'video_view', value: '6.2' }] };
  const mock = reader(url => url.pathname.endsWith('/act_invented-account') ? account : url.searchParams.has('after')
    ? { data: [{ ...base, ad_id: 'invented-ad-zero', actions: [{ action_type: 'video_view', value: '0' }] }] }
    : { data: [base], paging: { next: 'https://graph.facebook.com/ignored-provider-url', cursors: { after: 'invented-next' } } });
  const results = await mock.client.readInsights('invented-account', '2026-10-12', '2026-10-13');
  assert.equal(results.length, 2);
  assert.equal(results[0]!.threeSecondPlays, 200);
  assert.equal(results[0]!.threeSecondSource, 'video_continuous_2_sec_watched_actions');
  assert.equal(results[0]!.purchases, 3); assert.equal(results[0]!.purchaseValue, 240);
  assert.equal(results[0]!.addsToCart, 7); assert.equal(results[0]!.averagePlayTime, 6.2);
  assert.equal(results[1]!.threeSecondPlays, 0); assert.equal(results[1]!.threeSecondSource, 'video_view');
  for (const request of mock.requests.filter(request => request.url.pathname.endsWith('/insights'))) {
    assert.equal(request.url.searchParams.get('level'), 'ad'); assert.equal(request.url.searchParams.get('time_increment'), '1');
  }
});

test('source reads fall back separately to HD and neither errors nor URLs disclose a bearer credential', async () => {
  const mock = reader(url => url.searchParams.get('fields') === 'source' ? { source: null }
    : { download_hd_url: 'https://video.xx.fbcdn.net/invented.mp4?signature=invented-expiring-value' });
  const source = await mock.client.videoSource('invented-video');
  assert.match(source, /invented\.mp4\?signature=/);
  assert.deepEqual(mock.requests.map(request => request.url.searchParams.get('fields')), ['source', 'download_hd_url']);
  assert.ok(!JSON.stringify(mock.logs).includes(mock.token));
  const denied = reader(() => { throw new Error('invented transport credential message'); });
  await assert.rejects(denied.client.videoSource('invented-video'), error => error instanceof AdError && !error.message.includes('credential message'));
  const unsafe = reader(() => ({ source: `https://video.xx.fbcdn.net/invented.mp4?access_token=${unsafe.token}` }));
  await assert.rejects(unsafe.client.videoSource('invented-video'), error => error instanceof AdError && !error.message.includes(unsafe.token));
  const escapedToken = `invented-${randomBytes(16).toString('hex')}+`;
  const encoded = reader(() => ({ source: `https://video.xx.fbcdn.net/${encodeURIComponent(escapedToken)}/invented.mp4` }), escapedToken);
  await assert.rejects(encoded.client.videoSource('invented-video'), error => error instanceof AdError && !error.message.includes(escapedToken));
});

test('non-GBP currency fails explicitly and the media downloader rejects unsafe or oversized responses', async () => {
  const unsupported = reader(() => ({ ...account, currency: 'USD' }));
  await assert.rejects(unsupported.client.readInsights('invented-account', '2026-10-12', '2026-10-13'), error => error instanceof AdError && error.code === 'unsupported_account');
  for (const location of ['http://scontent.xx.fbcdn.net/invented.jpg', 'https://127.0.0.1/invented.jpg', 'https://fbcdn.net.evil.invalid/invented.jpg']) {
    const unsafe = reader(() => ({ data: [{ hash: 'invented-hash', url: location }] }));
    await assert.rejects(unsafe.client.imageBytes('invented-account', 'invented-hash'), AdError);
    assert.equal(unsafe.requests.length, 1, 'Unsafe media hosts are rejected before downloading');
  }
  const large = reader(url => url.hostname === 'graph.facebook.com' ? { data: [{ hash: 'invented-hash', url: 'https://scontent.xx.fbcdn.net/invented.jpg' }] }
    : new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': String(9 * 1024 * 1024) } }));
  await assert.rejects(large.client.imageBytes('invented-account', 'invented-hash'), AdError);
});

test('video poster frames are bounded to ten while preserving Meta image bytes', async () => {
  const mock = reader(url => url.hostname === 'graph.facebook.com'
    ? { data: Array.from({ length: 12 }, (_, index) => ({ uri: `https://scontent.xx.fbcdn.net/invented-frame-${index}.jpg` })) } : picture());
  const frames = await mock.client.videoFrames('invented-video');
  assert.equal(frames.length, 10);
  assert.ok(frames.every(frame => Buffer.from(frame).equals(Buffer.from(jpeg))));
  assert.equal(mock.requests.filter(request => request.url.hostname !== 'graph.facebook.com').length, 10);
});

test('group frequency reads one deduplicated Meta account aggregate across the exact ad membership and window', async () => {
  const mock = reader(url => url.pathname.endsWith('/act_invented-account') ? account
    : { data: [{ impressions: '3100', reach: '1000', frequency: '3.1' }] });
  const frequency = await mock.client.readFrequency('invented-account', ['invented-b', 'invented-a', 'invented-a'], '2026-10-07', '2026-10-13');
  assert.equal(frequency, 3.1);
  const requests = mock.requests.filter(request => request.url.pathname.endsWith('/insights'));
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.equal(request.init?.method, 'GET');
  assert.equal(request.url.searchParams.get('fields'), 'impressions,reach,frequency');
  assert.equal(request.url.searchParams.get('level'), 'account');
  assert.equal(request.url.searchParams.has('time_increment'), false);
  assert.equal(request.url.searchParams.has('access_token'), false);
  assert.deepEqual(JSON.parse(request.url.searchParams.get('time_range')!), { since: '2026-10-07', until: '2026-10-13' });
  assert.deepEqual(JSON.parse(request.url.searchParams.get('filtering')!), [{ field: 'ad.id', operator: 'IN', value: ['invented-a', 'invented-b'] }]);
  assert.ok(!JSON.stringify([frequency, mock.logs, mock.requests.map(row => row.url.toString())]).includes(mock.token));
});

test('group frequency keeps empty/malformed results unknown and rejects ambiguous multi-row totals', async () => {
  const empty = reader(url => url.pathname.endsWith('/act_invented-account') ? account : { data: [] });
  assert.equal(await empty.client.readFrequency('invented-account', ['invented-a'], '2026-10-07', '2026-10-13'), null);
  assert.equal(await empty.client.readFrequency('invented-account', [], '2026-10-07', '2026-10-13'), null);
  assert.equal(empty.requests.length, 2, 'An empty membership never requests all-account frequency');
  for (const data of [[{ frequency: '2' }, { frequency: '3' }], [{ reach: '500' }], [{ frequency: 'not-a-number' }]]) {
    const malformed = reader(url => url.pathname.endsWith('/act_invented-account') ? account : { data });
    await assert.rejects(malformed.client.readFrequency('invented-account', ['invented-a'], '2026-10-07', '2026-10-13'), AdError);
  }
  await assert.rejects(empty.client.readFrequency('invented-account', ['invented-a'], '2026-02-30', '2026-10-13'), AdError);
  await assert.rejects(empty.client.readFrequency('invented-account', ['invented-a'], '2026-10-14', '2026-10-13'), AdError);
  await assert.rejects(empty.client.readFrequency('invented-account', ['bad/id'], '2026-10-07', '2026-10-13'), AdError);
});


test('stored ads refresh from list rows only, while changed creatives and a cleared stored snapshot read full details', async () => {
  let creativeId = 'invented-original', name = 'Invented original name', status = 'PAUSED';
  let campaign = { id: 'invented-campaign', name: 'Invented discovery UK' };
  let adset = { id: 'invented-set', name: 'Invented US alternative' };
  const mock = reader(url => {
    if (url.hostname !== 'graph.facebook.com') return picture();
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad(creativeId, { id: 'invented-stable-ad', name, status, effective_status: status, campaign, adset,
      creative: { id: creativeId, image_hash: `hash-${creativeId}`, body: 'Invented nested copy', effective_object_story_id: 'invented-stable-story', effective_instagram_media_id: 'invented-instagram' } })] };
    if (url.pathname.endsWith('/invented-stable-story')) return { attachments: { data: [] }, permalink_url: 'https://www.facebook.com/invented-stable-story' };
    if (url.pathname.endsWith('/invented-instagram')) return { permalink: 'https://www.instagram.com/p/invented/' };
    if (url.pathname.endsWith(`/` + creativeId)) return { id: creativeId, image_hash: `hash-${creativeId}`, thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-600.jpg' };
    throw new Error('Unexpected invented request');
  });
  const first = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.equal(first.length, 1);
  mock.client.rememberStoredAds([{ id: 'invented-stable-ad', creativeId, mediaGroupId: 'invented-group' }]);
  name = 'Invented renamed ad'; status = 'ACTIVE';
  campaign = { id: 'invented-current-campaign', name: 'Invented current UK campaign' };
  adset = { id: 'invented-current-set', name: 'Invented current — US — audience' };
  const currentSettings = { ...settings, metaOwners: [{ campaignId: campaign.id, owner: 'ours' as const }] };
  let previous = mock.requests.length;
  const later = new Date(now.getTime() + 30 * 60_000);
  const refreshed = await mock.client.readCatalogue('invented-account', currentSettings, later);
  assert.deepEqual(refreshed, [{ ad: { id: 'invented-stable-ad', name, status, effectiveStatus: status, lastSeen: later.toISOString(),
    adSetId: adset.id, adSetName: adset.name, campaignId: campaign.id, campaignName: campaign.name, owner: 'ours', market: 'us' }, media: null }]);
  assert.deepEqual(mock.requests.slice(previous).map(request => request.url.pathname.split('/').at(-1)), ['ads']);
  creativeId = 'invented-replacement'; previous = mock.requests.length;
  const changed = detailed(await mock.client.readCatalogue('invented-account', currentSettings, later));
  assert.equal(changed[0]!.ad.creativeId, creativeId);
  assert.ok(mock.requests.slice(previous).some(request => request.url.pathname.endsWith('/invented-replacement')));
  mock.client.rememberStoredAds([{ id: 'invented-stable-ad', creativeId, mediaGroupId: 'invented-group' }]);
  assert.equal((await mock.client.readCatalogue('invented-account', currentSettings, later))[0]!.media, null);
  mock.client.rememberStoredAds([]); previous = mock.requests.length;
  assert.ok(detailed(await mock.client.readCatalogue('invented-account', currentSettings, later))[0]!.media);
  assert.ok(mock.requests.slice(previous).some(request => request.url.pathname.endsWith('/invented-replacement')));
});

test('distinct creative IDs sharing a listed image hash expand once and retain their own copy and links', async () => {
  const listed = ['first', 'second'].map(label => ad(`invented-${label}`, { creative: {
    id: `invented-${label}`, image_hash: 'invented-shared-hash', body: `Invented ${label} copy`, title: `Invented ${label} title`,
    call_to_action_type: label === 'first' ? 'SHOP_NOW' : 'LEARN_MORE', link_url: `https://example.invalid/${label}`,
    thumbnail_url: `https://scontent.xx.fbcdn.net/invented-${label}-64.jpg`,
  } }));
  const mock = reader(url => {
    if (url.hostname !== 'graph.facebook.com') return picture();
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: listed };
    if (url.pathname.endsWith('/invented-first')) return { ...listed[0]!.creative, thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-shared-600.jpg' };
    throw new Error('The shared picture must expand once');
  });
  const entries = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.equal(entries.length, 2); assert.equal(entries[0]!.media, entries[1]!.media);
  assert.equal(entries[1]!.ad.body, 'Invented second copy'); assert.equal(entries[1]!.ad.title, 'Invented second title');
  assert.equal(entries[1]!.ad.callToAction, 'LEARN_MORE'); assert.equal(entries[1]!.ad.linkUrl, 'https://example.invalid/second');
  assert.equal(mock.requests.filter(request => request.url.pathname.endsWith('/invented-first') || request.url.pathname.endsWith('/invented-second')).length, 1);
  assert.deepEqual(mock.requests.filter(request => request.url.hostname !== 'graph.facebook.com').map(request => request.url.pathname), ['/invented-shared-600.jpg']);
});

test('different SHARE stories pointing at one video expand once; a stored post picture needs no expansion', async () => {
  const mock = reader(url => {
    if (url.hostname !== 'graph.facebook.com') return picture();
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: ['first', 'second'].map(label => ad(`invented-${label}`, { creative: {
      id: `invented-${label}`, object_type: 'SHARE', effective_object_story_id: `invented-story-${label}`, body: `Invented ${label} story copy`,
    } })) };
    if (/invented-story-(first|second)$/.test(url.pathname)) return { attachments: { data: [{ type: 'video_inline', target: { id: 'invented-shared-video' } }] } };
    if (url.pathname.endsWith('/invented-first')) return { thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-shared-video-600.jpg' };
    if (url.pathname.endsWith('/invented-shared-video')) return { title: 'Invented shared video', length: 16 };
    if (url.pathname.endsWith('/invented-shared-video/thumbnails')) return { data: [] };
    throw new Error('Unexpected duplicate creative expansion');
  });
  const entries = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.equal(entries.length, 2); assert.equal(entries[0]!.media, entries[1]!.media);
  assert.equal(entries[1]!.ad.body, 'Invented second story copy');
  assert.equal(mock.requests.filter(request => /^\/v25\.0\/invented-(first|second)$/.test(request.url.pathname)).length, 1);
  const stored = reader(url => {
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad('invented-post-creative', { creative: { id: 'invented-post-creative', object_type: 'SHARE', effective_object_story_id: 'invented-picture-post' } })] };
    if (url.pathname.endsWith('/invented-picture-post')) return { attachments: { data: [{ type: 'photo', media: { image: { src: 'https://scontent.xx.fbcdn.net/invented-picture.jpg' } } }] } };
    throw new Error('Stored post media must not expand or download');
  });
  stored.client.rememberStoredMedia(['image:post:invented-picture-post']);
  const existing = detailed(await stored.client.readCatalogue('invented-account', settings, now));
  assert.equal(existing[0]!.media.key, 'post:invented-picture-post'); assert.equal(existing[0]!.media.thumbnail, null);
  assert.ok(stored.requests.every(request => !request.url.pathname.endsWith('/invented-post-creative') && request.url.hostname === 'graph.facebook.com'));
});

test('any refused expansion among three ads falls back to nested fields and emits one reduced-detail count per pass', async t => {
  for (const error of ['permission', 'server', 'transport'] as const) {
    const logs: string[] = [];
    const info = t.mock.method(console, 'info', (line: string) => logs.push(line));
    try {
      const listed = ['first', 'refused', 'third'].map(label => ad(`invented-${label}`, { creative: {
        id: `invented-${label}`, image_hash: `invented-${label}-hash`, body: `Invented ${label} nested copy`, title: `Invented ${label} nested title`,
        thumbnail_url: `https://scontent.xx.fbcdn.net/invented-${label}-64.jpg`,
      } }));
      const mock = reader(url => {
        if (url.hostname !== 'graph.facebook.com') return picture();
        if (url.pathname.endsWith('/act_invented-account')) return account;
        if (url.pathname.endsWith('/ads')) return { data: listed };
        if (url.pathname.endsWith('/invented-refused')) {
          if (error === 'transport') throw new Error(mock.token);
          return new Response(JSON.stringify({ error: { code: error === 'permission' ? 200 : 2, message: mock.token } }), { status: error === 'permission' ? 403 : 503 });
        }
        return { thumbnail_url: `https://scontent.xx.fbcdn.net/${url.pathname.split('/').at(-1)}-600.jpg` };
      });
      const entries = detailed(await mock.client.readCatalogue('invented-account', settings, now));
      assert.equal(entries.length, 3); assert.equal(entries[1]!.ad.body, 'Invented refused nested copy');
      assert.equal(entries[1]!.ad.title, 'Invented refused nested title'); assert.equal(entries[1]!.media.key, 'invented-refused-hash');
      assert.deepEqual(entries[1]!.media.thumbnail, jpeg);
      assert.ok(mock.requests.some(request => request.url.pathname.endsWith('/invented-refused-64.jpg')));
      assert.deepEqual(logs, ['1 creatives read at reduced detail']);
      await mock.client.readCatalogue('invented-account', settings, now);
      assert.deepEqual(logs, ['1 creatives read at reduced detail', '1 creatives read at reduced detail']);
      assert.ok(!JSON.stringify([entries, logs, mock.logs]).includes(mock.token));
    } finally { info.mock.restore(); }
  }
});

test('ads without a creative are skipped without discarding valid catalogue rows', async () => {
  const mock = reader(url => {
    if (url.hostname !== 'graph.facebook.com') return picture();
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad('invented-missing', { creative: null }), ad('invented-present'), ad('invented-empty', { creative: {} })] };
    if (url.pathname.endsWith('/invented-present')) return { image_hash: 'invented-present-hash', thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-present-600.jpg' };
    throw new Error('A missing creative must not trigger a read');
  });
  const entries = detailed(await mock.client.readCatalogue('invented-account', settings, now));
  assert.deepEqual(entries.map(entry => entry.ad.id), ['invented-ad-invented-present']);
});
