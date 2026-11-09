import type { TickerItem, TickerKind } from './model.js';

export const tickerEscape = (value: string): string => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

const paths = {
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  spark: 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5V8zm0 0l9 5 9-5M12 13v8',
  signpost: 'M12 3v18M6 6h11l3 3-3 3H6zM18 12H7l-3 3 3 3h11',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  pen: 'M4 20l4-1L19 8l-3-3L5 16l-1 4z',
  warn: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.5',
  check: 'M5 12l5 5 9-10',
  chevron: 'M9 6l6 6-6 6',
  info: 'M12 11v6M12 7v.5M22 12a10 10 0 11-20 0 10 10 0 0120 0z',
} as const;
export function tickerIcon(kind: TickerKind | 'warn' | 'check' | 'chevron' | 'info'): string {
  return `<svg class="tk-icon${kind === 'signpost' ? ' tk-decide-icon' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[kind]}"></path></svg>`;
}
export function tickerChip(item: TickerItem): string {
  return `<span class="tk-chip tk-${item.days < 0 ? 'late' : item.days === 0 ? 'today' : 'soon'}">${item.days < 0 ? tickerIcon('warn') : tickerIcon(item.days === 0 ? 'flag' : 'chevron')}${tickerEscape(item.chip)}</span>`;
}
export function tickerHead(): string {
  return '<link rel="stylesheet" href="/assets/ticker.css"><script type="module" src="/assets/ticker.js"></script>';
}
export function tickerHtml(): string {
  return `<aside class="tk-root" id="tk-strip" aria-label="Next up"><div class="tk-inner"><span class="tk-tag"><span class="tk-dot" aria-hidden="true"></span><span class="tk-tag-word">Next up</span></span><button class="tk-band" id="tk-band" type="button" aria-label="Next up. Loading dates." aria-haspopup="dialog" aria-controls="tk-dialog" aria-expanded="false" aria-disabled="true"><span class="tk-content" id="tk-content"><span class="tk-quiet">${tickerIcon('info')} Loading dates</span></span></button><div class="tk-actions"><span class="tk-saved" id="tk-saved" hidden>${tickerIcon('check')}<span class="tk-saved-label" id="tk-saved-label">Saved ·</span><button class="tk-undo" id="tk-undo" type="button">Undo</button></span><button class="tk-next" id="tk-next" type="button" hidden>Next ${tickerIcon('chevron')}</button><button class="tk-retry" id="tk-retry" type="button" hidden>${tickerIcon('warn')} Not saved · Try again</button><a class="tk-add" id="tk-add-date" href="/settings#keyDates" hidden>Add a date ${tickerIcon('chevron')}</a></div></div><span class="tk-foil" aria-hidden="true"></span><p class="tk-visually-hidden" id="tk-status" role="status" aria-live="polite" aria-atomic="true"></p><dialog class="tk-sheet" id="tk-dialog" aria-labelledby="tk-dialog-title"><p class="tk-visually-hidden" id="tk-sheet-status" role="status" aria-live="polite" aria-atomic="true"></p><div class="tk-sheet-heading"><h2 id="tk-dialog-title">Coming up</h2><button class="tk-close" id="tk-close" type="button">Close</button></div><p class="tk-mode" id="tk-mode" hidden>Sample dates</p><div class="tk-sheet-error" id="tk-sheet-error" hidden><button class="tk-retry" id="tk-sheet-retry" type="button">${tickerIcon('warn')} Not saved · Try again</button></div><div class="tk-ahead" id="tk-ahead"></div><button class="tk-more" id="tk-more" type="button" hidden></button><h3 class="tk-passed-heading" id="tk-passed-heading">Passed (0)</h3><div class="tk-passed" id="tk-passed"></div><a class="tk-edit" href="/settings#keyDates">Edit dates in Settings ${tickerIcon('chevron')}</a></dialog></aside>`;
}
