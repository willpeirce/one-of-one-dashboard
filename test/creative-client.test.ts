import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdError } from '../src/ad-spend/model.js';
import { MetaCreativeClient } from '../src/creatives/client.js';
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
  const entries = await mock.client.readCatalogue('invented-account', settings, now);
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
  assert.ok(statuses.includes('DELETED') && statuses.includes('ARCHIVED') && statuses.includes('PAUSED'));
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
    const first = await mock.client.readCatalogue('invented-account', settings, now);
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
  const entries = await mock.client.readCatalogue('invented-account', settings, now);
  assert.equal(entries[0]!.media.key, 'invented-first-hash');
  assert.deepEqual(entries[0]!.media.alternates, [{ kind: 'image', key: 'invented-second-hash' }]);
  assert.equal(entries[0]!.media, entries[1]!.media);
  assert.equal(mock.requests.filter(request => request.url.hostname !== 'graph.facebook.com').length, 1);
});

test('persisted groups update metadata without replenishing cap-evicted bytes on catalogue refresh', async () => {
  const mock = reader(url => {
    if (url.pathname.endsWith('/act_invented-account')) return account;
    if (url.pathname.endsWith('/ads')) return { data: [ad('invented-existing')] };
    if (url.pathname.endsWith('/invented-existing')) return { video_id: 'invented-video', thumbnail_url: 'https://scontent.xx.fbcdn.net/invented-600.jpg' };
    if (url.pathname.endsWith('/invented-video')) return { title: 'Invented updated title', length: 14 };
    throw new Error('A stored group must not re-download media in the catalogue');
  });
  mock.client.rememberStoredMedia(['video:invented-video']);
  const result = await mock.client.readCatalogue('invented-account', settings, now);
  assert.equal(result[0]!.media.title, 'Invented updated title');
  assert.equal(result[0]!.media.thumbnail, null);
  assert.deepEqual(result[0]!.media.frames, []);
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
