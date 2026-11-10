import assert from 'node:assert/strict';
import test from 'node:test';
import { installPushWorker, notificationMessage, notificationPath, type PushWorkerScope } from '../src/push/worker.js';

const origin = 'https://pulse.example.test';
test('notification paths stay inside this app after URL normalization, including at click time', () => {
  for (const path of ['https://elsewhere.example.test/', '//elsewhere.example.test/', '/\\elsewhere.example.test/', '\\elsewhere.example.test', 'morning', '', null])
    assert.equal(notificationPath(path, origin), '/morning');
  assert.equal(notificationPath('/morning?from=push#today', origin), '/morning?from=push#today');
  assert.equal(notificationPath('/settings', origin), '/settings');
  assert.deepEqual(notificationMessage({ title: 'Invented notice', body: 'Invented body', path: '//elsewhere.example.test' }, origin),
    { title: 'Invented notice', body: 'Invented body', path: '/morning', day: null, kind: 'summary' });
  assert.equal(notificationMessage({ title: 'All clear this morning', body: '', path: '/morning' }, origin).body, '');
});

test('the worker only handles push and clicks and always shows exactly one tagged notification per push', async () => {
  const handlers = new Map<string, (event: unknown) => void>(), notices: { title: string; options: unknown }[] = [];
  const scope = { location: { origin }, addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
    registration: { showNotification: async (title: string, options: unknown) => { notices.push({ title, options }); } },
    clients: { matchAll: async () => [], openWindow: async () => {} } } as unknown as PushWorkerScope;
  installPushWorker(scope);
  assert.deepEqual([...handlers.keys()], ['push', 'notificationclick']);
  const jobs: Promise<unknown>[] = [];
  for (const data of [{ json: () => ({ title: 'Needs you: 1 item', body: '1. Invented check', path: '/morning' }) }, null,
    { json() { throw new Error('Invented malformed JSON'); } }]) handlers.get('push')!({ data, waitUntil: (job: Promise<unknown>) => jobs.push(job) });
  await Promise.all(jobs);
  assert.equal(notices.length, 3);
  assert.equal(notices[0]!.title, 'Needs you: 1 item'); assert.equal(notices[1]!.title, 'Morning · Pulse');
  for (const notice of notices) assert.deepEqual((notice.options as { tag: string; data: object }).tag, 'pulse-morning');
});

test('a notification click navigates and focuses an app window or opens its safe destination', async () => {
  const handlers = new Map<string, (event: unknown) => void>(), visited: string[] = [];
  let clients = [
    { url: 'https://elsewhere.example.test/', focus: async () => { throw new Error('Must not focus another origin'); } },
    { url: `${origin}/`, navigate: async (url: string) => { visited.push(url); return { url, focus: async () => { visited.push('focus'); } }; }, focus: async () => { visited.push('focus'); } },
  ];
  const scope = { location: { origin }, addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
    registration: { showNotification: async () => {} }, clients: { matchAll: async () => clients, openWindow: async (url: string) => { visited.push(`open ${url}`); } } } as unknown as PushWorkerScope;
  installPushWorker(scope);
  const click = async (path: string) => {
    let work: Promise<unknown> | undefined;
    handlers.get('notificationclick')!({ notification: { data: { path }, close: () => visited.push('close') }, waitUntil: (job: Promise<unknown>) => { work = job; } });
    await work;
  };
  await click('/morning'); assert.deepEqual(visited, ['close', `${origin}/morning`, 'focus']);
  clients = []; visited.length = 0;
  await click('/\\elsewhere.example.test/'); assert.deepEqual(visited, ['close', `open ${origin}/morning`]);
});

test('notification tags differ by checked UK day and replace another notification from the same day', async () => {
  const tags: string[] = []; let receive: ((event: {data: {json(): object}; waitUntil(work: Promise<unknown>): void}) => void) | undefined;
  const scope = {location: {origin}, addEventListener: (type: string, listener: typeof receive) => {if (type === 'push') receive = listener;},
    registration: {showNotification: async (_title: string, options: {tag: string}) => {tags.push(options.tag);}},
    clients: {matchAll: async () => [], openWindow: async () => {}}} as unknown as PushWorkerScope;
  installPushWorker(scope);
  for (const day of ['2032-04-20', '2032-04-21', '2032-04-21', '../../invalid', '2032-99-99']) {
    let work: Promise<unknown> | undefined; receive!({data: {json: () => ({title: 'Invented summary', body: '', path: '/morning', day})}, waitUntil: promise => {work = promise;}}); await work;
  }
  assert.deepEqual(tags, ['pulse-morning-2032-04-20', 'pulse-morning-2032-04-21', 'pulse-morning-2032-04-21', 'pulse-morning', 'pulse-morning']);
});


test('untagged manual tests keep both themselves and the daily summary in the tray', async () => {
  const tray: {title: string; tag?: string}[] = [];
  const handlers = new Map<string, (event: unknown) => void>();
  const scope = {location: {origin}, addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
    registration: {showNotification: async (title: string, options: {tag?: string}) => {
      if (options.tag) { const previous = tray.findIndex(row => row.tag === options.tag); if (previous >= 0) tray.splice(previous, 1); }
      tray.push({title, ...options});
    }}, clients: {matchAll: async () => [], openWindow: async () => {}}} as unknown as PushWorkerScope;
  installPushWorker(scope);
  const push = async (kind: unknown, title: string) => {
    let work: Promise<unknown> | undefined;
    handlers.get('push')!({data: {json: () => ({kind, title, day: '2032-04-07'})}, waitUntil: (job: Promise<unknown>) => {work = job;}});
    await work;
  };
  await push('summary', 'Invented summary'); await push('test', 'Invented test one'); await push('test', 'Invented test two');
  assert.equal(tray.length, 3); assert.ok(tray.slice(1).every(row => !Object.hasOwn(row, 'tag')));
  await push('summary', 'Invented replacement'); assert.equal(tray.length, 3);
  await push('unknown', 'Invented fallback'); assert.equal(tray.length, 3);
  assert.equal(tray.filter(row => row.tag === 'pulse-morning-2032-04-07').length, 1);
});
