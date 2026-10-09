interface PullRefreshOptions {
  refresh: (signal: AbortSignal) => Promise<void>;
  status: HTMLElement;
  canRefresh?: () => boolean | string;
}

const refreshReceipt = 'pulse-pull-refresh';
const failureMessage = 'Could not refresh, showing the last data';
const ukClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

class RefreshBlocked extends Error {}

function updatedMessage(): string {
  return `Updated ${ukClock.format(new Date())}`;
}

/** Check that the next page is available before replacing the current, usable page. */
export async function reloadPageForRefresh(signal: AbortSignal, canReload?: () => boolean | string): Promise<void> {
  const response = await fetch(location.pathname + location.search, {
    credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'text/html' },
  });
  if (signal.aborted) throw signal.reason;
  if (response.status === 401 || new URL(response.url, location.href).pathname === '/login') {
    location.assign('/login');
    return;
  }
  if (!response.ok) throw new Error('Refresh unavailable');
  await response.text();
  if (signal.aborted) throw signal.reason;
  const allowed = canReload?.() ?? true;
  if (allowed !== true) throw new RefreshBlocked(typeof allowed === 'string' ? allowed : 'Refresh cancelled');
  try {
    sessionStorage.setItem(refreshReceipt, JSON.stringify({
      page: location.pathname + location.search, at: Date.now(), message: updatedMessage(),
    }));
  } catch { /* Refresh still works when browser storage is unavailable. */ }
  location.reload();
}

function restoreReceipt(status: HTMLElement): void {
  try {
    const stored = sessionStorage.getItem(refreshReceipt);
    sessionStorage.removeItem(refreshReceipt);
    if (!stored) return;
    const receipt = JSON.parse(stored) as { page?: unknown; at?: unknown; message?: unknown };
    if (receipt.page === location.pathname + location.search && typeof receipt.at === 'number'
      && Date.now() - receipt.at < 30_000 && Date.now() >= receipt.at
      && typeof receipt.message === 'string' && /^Updated \d{2}:\d{2}$/.test(receipt.message)) {
      status.textContent = receipt.message;
    }
  } catch { /* A receipt is only a convenience after the reload. */ }
}

function excluded(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || document.querySelector('dialog[open]')) return true;
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node.matches('input,textarea,select,[contenteditable="true"],#picker')) return true;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === 'auto' || overflow === 'scroll') return true;
  }
  return false;
}

/** Installed home-screen pages share the gesture, timing and accessible feedback. */
export function installPullToRefresh(options: PullRefreshOptions): void {
  const standalone = matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  if (!standalone || !touch || document.querySelector('#pull-refresh')) return;

  restoreReceipt(options.status);
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/assets/pull-refresh.css';
  document.head.append(stylesheet);
  document.documentElement.classList.add('pull-refresh-enabled');

  const indicator = document.createElement('div');
  indicator.id = 'pull-refresh';
  indicator.hidden = true;
  indicator.dataset.state = 'idle';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.setAttribute('aria-atomic', 'true');
  const spinner = document.createElement('span');
  spinner.className = 'pull-refresh-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.id = 'pull-refresh-label';
  indicator.append(spinner, label);
  document.body.append(indicator);

  const threshold = 70;
  let origin: { id: number; x: number; y: number } | undefined;
  let pulling = false;
  let travel = 0;
  let running = false;
  let settling: ReturnType<typeof setTimeout> | undefined;

  function show(state: 'pulling' | 'ready' | 'refreshing', text: string, distance: number): void {
    clearTimeout(settling);
    indicator.hidden = false;
    indicator.dataset.state = state;
    indicator.style.setProperty('--pull-distance', `${distance}px`);
    if (label.textContent !== text) label.textContent = text;
  }
  function settle(): void {
    origin = undefined;
    pulling = false;
    travel = 0;
    indicator.dataset.state = 'idle';
    indicator.style.setProperty('--pull-distance', '0px');
    settling = setTimeout(() => { indicator.hidden = true; }, 180);
  }

  async function refresh(): Promise<void> {
    const allowed = options.canRefresh?.() ?? true;
    if (allowed !== true) {
      if (typeof allowed === 'string') options.status.textContent = allowed;
      settle();
      return;
    }
    running = true;
    origin = undefined;
    pulling = false;
    show('refreshing', 'Refreshing', threshold / 2);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        options.refresh(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Refresh timed out'));
          }, 10_000);
        }),
      ]);
      if (!controller.signal.aborted) options.status.textContent = updatedMessage();
    } catch (error) {
      controller.abort();
      options.status.textContent = error instanceof RefreshBlocked ? error.message : failureMessage;
    } finally {
      clearTimeout(timeout);
      running = false;
      settle();
    }
  }

  document.addEventListener('touchstart', (event) => {
    if (running || event.touches.length !== 1 || window.scrollY > 0 || excluded(event.target)) return;
    const touch = event.touches[0]!;
    origin = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    pulling = false;
    travel = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!origin || running) return;
    const touch = Array.from(event.touches).find((item) => item.identifier === origin!.id);
    if (!touch || event.touches.length !== 1 || window.scrollY > 0) { settle(); return; }
    const vertical = touch.clientY - origin.y;
    const horizontal = Math.abs(touch.clientX - origin.x);
    if (vertical < 0 || (horizontal > 6 && horizontal >= vertical)) { settle(); return; }
    if (!pulling && vertical < 6) return;
    pulling = true;
    travel = vertical;
    if (event.cancelable) event.preventDefault();
    show(travel >= threshold ? 'ready' : 'pulling',
      travel >= threshold ? 'Release to refresh' : 'Pull to refresh', Math.min(travel / 2, 90));
  }, { passive: false });
  document.addEventListener('touchend', (event) => {
    if (!origin || running || !Array.from(event.changedTouches).some((touch) => touch.identifier === origin!.id)) return;
    if (pulling && travel >= threshold) void refresh();
    else settle();
  }, { passive: true });
  document.addEventListener('touchcancel', () => { if (!running) settle(); }, { passive: true });
}
