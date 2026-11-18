import { installPullToRefresh, reloadPageForRefresh } from '../pull-refresh.js';
import { installWaitingOn, waitingCanRefresh } from '../waiting-on/browser.js';
import { installIssues, issuesCanRefresh } from '../issues/browser.js';

installWaitingOn();
installIssues();
const status = document.querySelector<HTMLElement>('#handover-message');
const canRefresh = () => {
  const waiting = waitingCanRefresh();
  return waiting === true ? issuesCanRefresh() : waiting;
};
if (status) installPullToRefresh({refresh: signal => reloadPageForRefresh(signal, canRefresh), status, canRefresh});
