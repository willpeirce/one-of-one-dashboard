import type {DashboardNeed} from '../shopify/dashboard.js';
import type {WaitingView} from './model.js';

export function waitingNeeds(view: WaitingView): DashboardNeed[] {
  const overdue = view.rows.filter(row => row.days >= view.thresholdDays);
  if (!overdue.length) return [];
  return [{id: 'waiting-on-overdue', source: 'github-hq', sourceMode: 'live', state: 'warn',
    title: `${overdue.length} waiting on others over ${view.thresholdDays} days`,
    why: `${overdue.length} open ${overdue.length === 1 ? 'item has' : 'items have'} waited at least ${view.thresholdDays} UK calendar days; oldest ${overdue[0]!.days} days.`,
    link: '/handover', figure: {value: String(overdue.length), label: 'Waiting on others'}}];
}
