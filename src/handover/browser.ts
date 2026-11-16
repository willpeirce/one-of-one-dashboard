import { installPullToRefresh, reloadPageForRefresh } from '../pull-refresh.js';
import { installWaitingOn, waitingCanRefresh } from '../waiting-on/browser.js';

installWaitingOn();
const status = document.querySelector<HTMLElement>('#handover-message');
if (status) installPullToRefresh({refresh: signal => reloadPageForRefresh(signal, waitingCanRefresh), status, canRefresh: waitingCanRefresh});
