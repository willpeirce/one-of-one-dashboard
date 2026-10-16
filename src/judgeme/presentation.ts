import { formatNumber } from '../money.js';
import type { Review, ReviewsPanel } from './model.js';

const esc = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const count = formatNumber;
export function reviewLink(): string { return 'https://app.judge.me/index'; }
export function reviewsGreeting(panel: ReviewsPanel): string {
  const n = panel.rows.length, low = panel.rows.filter(row => row.rating <= 3).length;
  if (!n && panel.unreadCount > 0) return 'Some reviews could not be read';
  if (!n) return panel.status === 'pending' ? 'Reviews: first sync pending' : panel.status === 'unavailable' ? 'Reviews unavailable' : 'All caught up';
  return `${count(n)} ${panel.mode === 'sample' ? 'sample' : 'new'} ${n === 1 ? 'review' : 'reviews'}${low ? `, ${count(low)} needs reading first` : ' to check'}`;
}
export function reviewAge(createdAt: string, asOf: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(createdAt)) / 60_000));
  return minutes < 60 ? `${count(minutes)} min` : minutes < 1440 ? `${count(Math.floor(minutes / 60))} h` : `${count(Math.floor(minutes / 1440))} d`;
}
function links(review: Review): string {
  const href = esc(reviewLink());
  return `${review.rating <= 3 ? `<a class="act primary" data-review-link href="${href}" target="_blank" rel="noopener noreferrer">Read in Judge.me</a>` : ''}<a class="act" data-review-link href="${href}" target="_blank" rel="noopener noreferrer">Open in Judge.me</a>`;
}
function reviewChips(review: Review): string {
  const source=review.source?.replace(/[-_]/g,' ');
  const label=source==='email' ? 'Email request' : source ? source[0]!.toUpperCase()+source.slice(1) : null;
  return `${review.flagged ? '<span class="chip warn">Flagged by Judge.me</span>' : ''}${label ? `<span class="chip info">${esc(label)}</span>` : ''}`;
}
export function reviewsPanelHtml(panel: ReviewsPanel): string {
  const status = panel.mode === 'sample' ? 'Sample data · invented reviews · waiting for keys'
    : panel.status === 'pending' ? 'Judge.me · first sync pending'
    : panel.status === 'unavailable' ? 'Judge.me · source unavailable · showing the last successful poll'
    : `Judge.me · live · checked ${panel.checkedAt ? new Date(panel.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—'} UK`;
  return `<header class="chapter-heading rvhead"><span class="chapter-number" aria-hidden="true">2</span>
    <div class="chapter-copy"><p class="chapter-eyebrow">Customers</p><h2 class="chapter-title" id="reviews-title">New reviews <span class="chip ${panel.rows.length ? 'decide' : 'info'}" id="rvcount">${panel.rows.length ? `${count(panel.rows.length)} waiting` : esc(reviewsGreeting(panel))}</span></h2><span class="shm">${esc(status)}</span></div>
    <button class="act" id="review-publish" type="button" disabled title="Publishing from Pulse is not enabled">Publish</button></header>
    ${panel.unreadCount > 0 ? `<p class="note" data-review-notice>${count(panel.unreadCount)} reviews could not be read</p>` : ''}
    <div class="rvlist">${panel.rows.length ? panel.rows.map(row => `<article class="rv" data-state="${row.rating <= 3 ? 'warn' : 'decide'}" data-review-id="${esc(row.id)}" data-source="judgeme" data-mode="${panel.mode}">
      <div class="rvr"><span class="rvs"><span class="stars" role="img" aria-label="${row.rating} out of 5 stars" data-stars="${row.rating}">${[1, 2, 3, 4, 5].map(star => `<svg class="${star <= row.rating ? 'on' : 'off'}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>`).join('')}</span><span class="chip ${row.rating <= 3 ? 'warn' : 'decide'}">${row.rating <= 3 ? 'Read first' : 'New'}</span></span>
      <button class="rt" type="button" data-review-open="${esc(row.id)}"><h3>${esc(row.productTitle)} · ${esc(row.market ?? 'Market unknown')}</h3>
      <span class="review-meta">${row.verifiedBuyer ? 'Verified buyer' : ''}${row.photoCount ? `${row.verifiedBuyer ? ' · ' : ''}${count(row.photoCount)} ${row.photoCount === 1 ? 'photo' : 'photos'}` : ''}${panel.mode === 'sample' ? ' · Sample data' : ''}</span>
      ${reviewChips(row)}<span class="rec">${esc(row.body)}</span></button><div class="rvm"><span class="age">${reviewAge(row.createdAt, panel.asOf)}</span><div class="acts">${links(row)}</div></div></div></article>`).join('') : ''}</div>`;
}
export function reviewSheetHtml(review: Review, panel: ReviewsPanel): string {
  const posted = new Date(review.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' });
  return `${reviewChips(review)}<p class="review-body">${esc(review.body)}</p><dl class="xdl"><dt>Product</dt><dd>${esc(review.productTitle)}</dd><dt>Market</dt><dd>${esc(review.market ?? 'Unknown: not supplied by the review API')}</dd><dt>Posted</dt><dd>${esc(posted)} UK</dd><dt>Review</dt><dd>${esc(review.id)}</dd>${review.verifiedBuyer ? '<dt>Verified buyer</dt><dd>Yes</dd>' : ''}<dt>Photos</dt><dd>${count(review.photoCount)}</dd></dl><div class="acts review-links">${links(review)}</div><p class="note">${panel.mode === 'sample' ? 'Sample data · invented review. ' : ''}Publishing from Pulse is disabled. Manage this review in Judge.me.</p>`;
}
