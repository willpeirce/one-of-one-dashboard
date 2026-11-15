import { installPullToRefresh, reloadPageForRefresh } from '../pull-refresh.js';

const status = document.querySelector<HTMLElement>('#handover-message');
if (status) installPullToRefresh({refresh: reloadPageForRefresh, status});
