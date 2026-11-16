import type {Settings} from '../settings.js';
import type {DashboardNeed} from '../shopify/dashboard.js';
import type {SourceMode} from '../sources.js';
import {gorgiasWaitHours, gorgiasWaitLabel, type GorgiasFacts} from './model.js';

/** Existing needs are the only route from Handover into Morning and Home. */
export function gorgiasNeeds(facts: GorgiasFacts, settings: Settings, dashboardMode: SourceMode): DashboardNeed[] {
  if (facts.mode === 'sample' && dashboardMode === 'live') return [];
  const open = facts.tickets.filter(ticket => ticket.status === 'open' && ticket.inHandover);
  const oldest = Math.max(0, ...open.map(ticket => gorgiasWaitHours(ticket, facts.asOf)));
  if (!open.length || oldest <= settings.gorgiasHandoverWaitHours) return [];
  const wait = gorgiasWaitLabel(oldest);
  return [{id: 'gorgias-handover', state: 'decide', source: 'gorgias', sourceMode: facts.mode,
    title: `${facts.mode === 'sample' ? 'Sample · ' : ''}Reply to ${open.length} customers · oldest ${wait}`,
    why: `${facts.mode === 'sample' ? 'Sample data · ' : ''}${open.length} open handover ${open.length === 1 ? 'ticket' : 'tickets'}. The oldest customer message has waited ${wait}, over the ${settings.gorgiasHandoverWaitHours}-hour bar.${facts.status === 'unavailable' ? ' The last successful read is shown; check Source health.' : ''}`,
    link: '/handover', figure: {value: wait, label: 'Oldest handover wait'}}];
}
