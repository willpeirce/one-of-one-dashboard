import {installPullToRefresh, reloadPageForRefresh} from '../pull-refresh.js';
import {installKitSheets} from './browser.js';

const root = document.querySelector<HTMLElement>('[data-kits-page]');
if (root) {
  installKitSheets({mode: root.dataset.mode === 'sample' ? 'sample' : 'live', ready: root.dataset.ready === 'true',
    ids: Array.from(root.querySelectorAll<HTMLElement>('[data-kit-open]'), card => card.dataset.kitOpen!)}, {suppliers: true});
  const sheet = document.querySelector<HTMLDialogElement>('#sheet');
  document.querySelector('#sh-x')?.addEventListener('click', () => sheet?.close());
  sheet?.addEventListener('click', event => {if (event.target === sheet) sheet.close();});
  const status = document.querySelector<HTMLElement>('#kits-page-message');
  const canRefresh = (): true | string => sheet?.open ? 'Close the kit before refreshing.' : true;
  if (status) installPullToRefresh({refresh: signal => reloadPageForRefresh(signal, canRefresh), status, canRefresh});
}
