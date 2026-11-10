interface Notice { title: string; body: string; path: string; day: string | null }
interface WindowClient {
  url: string; focus(): Promise<unknown>; navigate?(url: string): Promise<WindowClient | null>;
}
interface PushEvent { data?: { json(): unknown } | null; waitUntil(work: Promise<unknown>): void }
interface ClickEvent { notification: { data: unknown; close(): void }; waitUntil(work: Promise<unknown>): void }
export interface PushWorkerScope {
  location: { origin: string };
  registration: { showNotification(title: string, options: { body: string; tag: string; icon: string; data: { path: string } }): Promise<unknown> };
  clients: { matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>; openWindow(url: string): Promise<unknown> };
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: ClickEvent) => void): void;
}

/** URL normalization must not turn a slash path, including backslashes, into another origin. */
export function notificationPath(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/morning';
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/morning';
  } catch { return '/morning'; }
}
export function notificationMessage(value: unknown, origin: string): Notice {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const cut = (text: unknown, fallback: string, limit: number) => typeof text === 'string' && text.trim()
    ? Array.from(text).slice(0, limit).join('') : fallback;
  return { title: cut(data.title, 'Morning · Pulse', 120),
    body: typeof data.body === 'string' ? Array.from(data.body).slice(0, 1000).join('') : 'Open Morning for your daily check.',
    path: notificationPath(data.path, origin),
    day: typeof data.day === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(data.day) ? data.day : null };
}

/** No fetch handler, cache, install hook or private data persistence. */
export function installPushWorker(scope: PushWorkerScope): void {
  scope.addEventListener('push', event => {
    let data: unknown = null;
    try { data = event.data?.json(); } catch { /* An unreadable push still shows one visible notification. */ }
    const notice = notificationMessage(data, scope.location.origin);
    event.waitUntil(scope.registration.showNotification(notice.title, {
      body: notice.body, tag: notice.day ? `pulse-morning-${notice.day}` : 'pulse-morning', icon: '/assets/icon-192.png', data: { path: notice.path },
    }));
  });
  scope.addEventListener('notificationclick', event => {
    event.notification.close();
    const data = event.notification.data && typeof event.notification.data === 'object'
      ? event.notification.data as Record<string, unknown> : {};
    const target = new URL(notificationPath(data.path, scope.location.origin), scope.location.origin).href;
    event.waitUntil((async () => {
      const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try {
          if (new URL(client.url).origin !== scope.location.origin) continue;
          const destination = client.url !== target && client.navigate ? await client.navigate(target) : client;
          if (!destination) continue;
          await destination.focus(); return;
        } catch { /* A closed window cannot receive the click; try another or open one. */ }
      }
      await scope.clients.openWindow(target);
    })());
  });
}
