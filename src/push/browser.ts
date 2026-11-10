interface TestResult { ok: true; sent: number; failed: number; gone: number }
const supported = (): boolean => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let registration: Promise<ServiceWorkerRegistration> | null = null;
function worker(): Promise<ServiceWorkerRegistration> {
  if (!registration) registration = (async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Notifications could not start. Try again.')), 10_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  })().catch(error => { registration = null; throw error; });
  return registration;
}
async function request<T>(path: string, body?: object, timeoutMs = 10_000, redirect = true): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  if (response.status === 401) { if (redirect) location.assign('/login'); throw new Error('Sign in to change notifications.'); }
  if (response.status === 429) throw new Error('A test was sent recently. Wait a minute and try again.');
  if (!response.ok) throw new Error('Could not save notifications or send the test. Try again.');
  return await response.json() as T;
}
function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Notifications are not ready. Try again.');
  return bytes;
}
function payload(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = subscription.toJSON(), p256dh = json.keys?.p256dh, auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('Could not read this device subscription. Try again.');
  return { endpoint: subscription.endpoint, keys: { p256dh, auth } };
}

let signingOut = false;
const subscriptionSaves = new Set<Promise<unknown>>();
// Settings and the common browser entry can be separate bundles on the same page.
document.addEventListener('pulse:signing-out', event => {
  signingOut = true;
  (event as CustomEvent<Promise<unknown>[]>).detail.push(...subscriptionSaves);
});
async function saveSubscription(subscription: PushSubscription): Promise<void> {
  if (signingOut) return;
  const pending = request('/api/push/subscribe', payload(subscription));
  subscriptionSaves.add(pending);
  try { await pending; } finally { subscriptionSaves.delete(pending); }
}

const CLEANUP_TIMEOUT_MS = 1500;
const REMOVAL_OWED = 'pulse-push-removal-owed';
function removalOwed(): boolean {
  try { if (localStorage.getItem(REMOVAL_OWED) === '1') return true; } catch { /* Cookies provide a fallback. */ }
  try { return document.cookie.split(';').some(part => part.trim() === `${REMOVAL_OWED}=1`); } catch { return false; }
}
function markRemoval(owed: boolean): void {
  // One boolean only: never persist an endpoint, keys or credential in browser storage.
  try { if (owed) localStorage.setItem(REMOVAL_OWED, '1'); else localStorage.removeItem(REMOVAL_OWED); } catch { /* Fall back to the same boolean cookie. */ }
  try { document.cookie = `${REMOVAL_OWED}=${owed ? '1' : ''}; Path=/; SameSite=Strict; Max-Age=${owed ? 34_560_000 : 0}`; } catch { /* Storage availability cannot block sign-out. */ }
}
async function bounded<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Device cleanup is still pending.')), CLEANUP_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function localSubscription(): Promise<PushSubscription | null> {
  const registration = await bounded(() => navigator.serviceWorker.getRegistration('/'));
  return registration ? bounded(() => registration.pushManager.getSubscription()) : null;
}
async function revokeLocal(subscription: PushSubscription): Promise<void> {
  await bounded(() => subscription.unsubscribe());
  if (await localSubscription()) throw new Error('Device cleanup is still pending.');
  markRemoval(false);
}
let removing: Promise<void> | undefined;
/** Finish an owed local removal before any automatic repair, including on the sign-in page. */
export function finishPendingPushRemoval(): Promise<void> {
  if (!removalOwed()) return Promise.resolve();
  if (!removing) removing = (async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Device cleanup is still pending.');
    const subscription = await localSubscription();
    if (subscription) await revokeLocal(subscription); else markRemoval(false);
  })().finally(() => { removing = undefined; });
  return removing;
}
let repair: Promise<void> | undefined;
function repairOnce(subscription: PushSubscription | null): Promise<void> {
  // A failed repair stays unknown for this page; focus/visibility reads never write again.
  return repair ??= subscription ? saveSubscription(subscription) : Promise.resolve();
}
export function cancelPushSignOut(): void { document.dispatchEvent(new Event('pulse:sign-out-failed')); }
document.addEventListener('pulse:sign-out-failed', () => { signingOut = false; });

export function initializePushDevice(): void {
  const root = document.getElementById('push-device'); if (!root) return;
  const element = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const on = element<HTMLButtonElement>('push-turn-on'), off = element<HTMLButtonElement>('push-turn-off'), test = element<HTMLButtonElement>('push-send-test');
  const status = element('push-device-status'), help = element('push-device-help'), message = element('push-device-message');
  let subscription: PushSubscription | null = null, busy = false, retrySetup = false;
  function render(): void {
    const available = supported(), denied = available && Notification.permission === 'denied';
    status.textContent = !available ? 'Notifications are unavailable here.' : denied ? 'Notifications are blocked.' : subscription ? retrySetup ? 'Notifications need setup.' : 'Notifications are on.' : 'Notifications are off.';
    help.textContent = !available ? 'Add Pulse to the home screen and open it from there to use notifications.'
      : denied ? 'Allow notifications for Pulse in your device or browser settings, then return here.' : '';
    on.hidden = !available || denied || !!subscription && !retrySetup;
    off.hidden = !available || denied || !subscription;
    test.hidden = !available || denied || !subscription || retrySetup;
    for (const button of [on, off, test]) button.disabled = busy;
  }
  function announce(text: string): void { message.textContent = text; }
  async function read(): Promise<void> {
    if (!supported() || Notification.permission === 'denied') { render(); return; }
    try { await finishPendingPushRemoval();
      subscription = await (await worker()).pushManager.getSubscription();
      await repairOnce(subscription);
      retrySetup = false; render(); }
    catch { retrySetup = true; render(); announce('Could not check this device. Try turning notifications on again.'); }
  }
  on.addEventListener('click', () => {
    if (busy || signingOut || !supported()) return;
    // Ask within this click before awaiting registration or the public key (iPhone activation rule).
    let permission: Promise<NotificationPermission>;
    try { permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission(); }
    catch { announce('Could not ask for notification permission. Try again.'); return; }
    busy = true; announce(''); render();
    void (async () => {
      let created: PushSubscription | null = null;
      try {
        if (await permission !== 'granted') { announce('Notifications were not enabled.'); return; }
        await finishPendingPushRemoval();
        const serviceWorker = await worker(), existing = await serviceWorker.pushManager.getSubscription();
        const { publicKey } = await request<{ publicKey: string }>('/api/push/key');
        if (signingOut) return;
        subscription = existing ?? await serviceWorker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
        if (!existing) created = subscription;
        if (signingOut) { if (created) { markRemoval(true); await revokeLocal(created); } return; }
        await saveSubscription(subscription); repair = Promise.resolve();
        retrySetup = false; announce('Notifications are on.');
      } catch {
        retrySetup = true;
        if (created) {
          try { await created.unsubscribe(); subscription = await (await worker()).pushManager.getSubscription(); } catch { /* Keep Turn on available to retry saving. */ }
        }
        announce('Could not turn notifications on. Try again.');
      } finally { busy = false; render(); (subscription && !retrySetup ? off : on).focus(); }
    })();
  });
  off.addEventListener('click', () => {
    if (busy || !subscription) return;
    busy = true; announce(''); render();
    void (async () => {
      try {
        await request('/api/push/unsubscribe', { endpoint: subscription!.endpoint });
        await subscription!.unsubscribe(); subscription = await (await worker()).pushManager.getSubscription();
        if (subscription) throw new Error('The browser kept the subscription');
        retrySetup = false; announce('Notifications are off.');
      } catch { retrySetup = true; announce('Could not finish turning notifications off. Try again.'); }
      finally { busy = false; render(); (subscription ? off : on).focus(); }
    })();
  });
  test.addEventListener('click', () => {
    if (busy || !subscription) return;
    busy = true; announce('Sending a test…'); render();
    void (async () => {
      try {
        const result = await request<TestResult>('/api/push/test', {});
        announce(result.failed ? `Test sent to ${result.sent} device${result.sent === 1 ? '' : 's'}; ${result.failed} could not receive it.` : 'Test sent.');
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not send the test. Try again.'); }
      finally { busy = false; render(); test.focus(); }
    })();
  });
  function reveal(): void {
    if (location.hash !== '#notifications') return;
    for (let parent = root!.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    document.getElementById('notifications')?.scrollIntoView({ block: 'center' });
  }
  document.addEventListener('pulse:sign-out-failed', () => { void read(); });
  window.addEventListener('hashchange', reveal); reveal(); void read();
}

let nudgeEnabled = false, subscribed: boolean | null = null, reading = false, watching = false;
function paintNudge(): void {
  const link = document.getElementById('mn-push-nudge');
  if (link) link.hidden = !nudgeEnabled || subscribed !== false;
}
async function readNudge(): Promise<void> {
  if (reading || !nudgeEnabled) return;
  if (!supported() || Notification.permission === 'denied') { subscribed = false; paintNudge(); return; }
  reading = true;
  try {
    await finishPendingPushRemoval();
    const subscription = await (await worker()).pushManager.getSubscription();
    await repairOnce(subscription);
    subscribed = !!subscription;
  } catch { subscribed = null; }
  finally { reading = false; paintNudge(); }
}
/** Repair an existing subscription without asking for notification permission. */
export function updateMorningPushNudge(enabled: boolean): void {
  if (enabled && !nudgeEnabled) subscribed = null;
  nudgeEnabled = enabled; paintNudge();
  if (!watching) {
    watching = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void readNudge(); });
    window.addEventListener('focus', () => { void readNudge(); });
  }
  if (enabled && subscribed === null) void readNudge();
}

/** Best-effort cleanup never prevents logout; retain any readable endpoint for atomic server revocation. */
export async function unsubscribeForSignOut(): Promise<string | undefined> {
  markRemoval(true);
  const pending: Promise<unknown>[] = [];
  document.dispatchEvent(new CustomEvent('pulse:signing-out', {detail: pending}));
  try { await bounded(() => Promise.allSettled(pending)); } catch { /* Logout must proceed. */ }
  let subscription: PushSubscription | null;
  try {
    if (!('serviceWorker' in navigator)) return undefined;
    subscription = await localSubscription();
  } catch { return undefined; }
  if (!subscription) { markRemoval(false); return undefined; }
  const endpoint = subscription.endpoint;
  try { await request('/api/push/unsubscribe', {endpoint}, CLEANUP_TIMEOUT_MS, false); } catch { /* Logout also removes it. */ }
  try { await revokeLocal(subscription); } catch { /* The boolean marker prevents repair after signing back in. */ }
  return endpoint;
}

void finishPendingPushRemoval().catch(() => {});
