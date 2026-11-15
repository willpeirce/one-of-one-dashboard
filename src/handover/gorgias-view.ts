import { escapeCreative as e } from '../creatives/html.js';
import { formatUkTime } from '../uk-time.js';
import { gorgiasOldestFirst, gorgiasTicketHref, gorgiasWaitHours, gorgiasWaitLabel, gorgiasWaitStartedAt, type GorgiasFacts, type GorgiasTicket } from '../gorgias/model.js';
import { formatNumber } from '../money.js';

function ticketHtml(ticket: GorgiasTicket, facts: GorgiasFacts, waitHours: number): string {
  const hours = gorgiasWaitHours(ticket, facts.asOf), needsReply = hours > waitHours;
  const href = facts.mode === 'live' ? gorgiasTicketHref(facts.domain, ticket.id) : null;
  const waitingSince = gorgiasWaitStartedAt(ticket);
  return `<details class="glass handover-item" data-gorgias-ticket="${e(ticket.id)}" data-wait-start="${e(waitingSince)}"><summary><span><strong class="handover-person">${e(ticket.customer || 'Customer')}</strong><span class="handover-channel">${e(ticket.channel || 'Channel not provided')}</span></span><span class="handover-state" data-state="${needsReply ? 'decide' : 'info'}">${needsReply ? '◆ Reply' : 'ⓘ Waiting'} · ${e(gorgiasWaitLabel(hours))}</span><span class="handover-subject">${e(ticket.subject || 'No subject provided')}</span><span class="handover-open">⊕ Ticket details</span></summary><div class="handover-detail"><p>Waiting since <time datetime="${e(waitingSince)}">${e(formatUkTime(waitingSince))}</time>${ticket.lastCustomerMessageAt ? ' · last customer message' : ' · ticket opened; customer message time not supplied'}.</p><p>Opened <time datetime="${e(ticket.createdAt)}">${e(formatUkTime(ticket.createdAt))}</time>. ${ticket.updatedAt ? `Last updated ${e(formatUkTime(ticket.updatedAt))}.` : ''}</p>${href ? `<a class="btn" href="${e(href)}" target="_blank" rel="noopener noreferrer">↗ Open in Gorgias</a>` : `<button class="btn" type="button" disabled>${facts.mode === 'sample' ? 'Sample ticket' : 'Ticket link unavailable'}</button>`}</div></details>`;
}

/** This section receives only the minimized stored facts, never a provider ticket response. */
export function gorgiasSectionHtml(facts: GorgiasFacts, waitHours = 12): string {
  const tickets = gorgiasOldestFirst(facts.tickets.filter(ticket => ticket.status === 'open' && ticket.inHandover));
  const rows = tickets.map(ticket => ticketHtml(ticket, facts, waitHours));
  const oldest = tickets[0] ? gorgiasWaitLabel(gorgiasWaitHours(tickets[0], facts.asOf)) : facts.checkedAt ? 'None waiting' : 'Awaiting read';
  const mode = facts.mode === 'sample' ? '<p class="sample-banner" data-gorgias-mode="sample">Sample data · four invented tickets, names and times.</p>'
    : '<p class="handover-context" data-gorgias-mode="live">Gorgias · stored handover tickets. This app only reads; reply in Gorgias.</p>';
  const state = facts.status === 'pending' ? '<p class="handover-notice" role="status">ⓘ Waiting for the first Gorgias read.</p>'
    : facts.status === 'unavailable' ? `<p class="handover-notice" data-state="watch" role="status">△ Watch · Gorgias read unavailable.${facts.checkedAt ? ' Showing the last successful read.' : ' No successful read is available yet.'}</p>` : '';
  return `${mode}${state}<div class="handover-list" data-gorgias-list>${rows.slice(0, 6).join('') || (facts.checkedAt ? '<p class="handover-notice">✓ No customers waiting in handover.</p>' : '')}</div>${rows.length > 6 ? `<details class="handover-more"><summary>⊕ ${formatNumber(rows.length - 6)} more tickets</summary><div class="handover-list">${rows.slice(6).join('')}</div></details>` : ''}<dl class="glass handover-summary" data-gorgias-summary><div><dt>Opened this week</dt><dd>${facts.openedThisWeek === null ? 'Awaiting read' : formatNumber(facts.openedThisWeek)}</dd></div><div><dt>Closed this week</dt><dd>${facts.closedThisWeek === null ? 'Awaiting read' : `At least ${formatNumber(facts.closedThisWeek)}`}</dd></div><div><dt>Oldest wait</dt><dd>${e(oldest)}</dd></div></dl><p class="handover-context">Week starts Monday in the UK.${facts.checkedAt ? ` Last successful read <time datetime="${e(facts.checkedAt)}">${e(formatUkTime(facts.checkedAt))}</time>.` : ''} Wait is measured from the last customer message, or the ticket’s creation time when that is not supplied.</p><p class="handover-context" data-gorgias-history-note>Counts cover tickets observed in handover. Closed is a minimum; reopened or deleted tickets can make the exact weekly total unavailable.</p>`;
}
