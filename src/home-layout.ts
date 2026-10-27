import type { DashboardSnapshot } from './dashboard-types.js';
import type { SourceHealth } from './sources.js';

export function footerChipHtml(sources?: readonly SourceHealth[]): string {
  if (!sources?.length) return '<span class="chip info">i Sample data</span>';
  const errors = sources.filter(source => source.status === 'error').length;
  const waiting = sources.filter(source => source.status === 'waiting_for_keys').length;
  return errors ? `<span class="chip alarm">✕ ${errors} unavailable</span>`
    : waiting ? `<span class="chip info">i ${waiting} waiting for keys</span>`
      : '<span class="chip good">✓ All connected</span>';
}

const priority = ['w001', 'w002', 'w019', 'w017'];
export const homeDialOrder = (id: string): number => priority.includes(id) ? priority.indexOf(id) : priority.length;

/** Preserve the existing tiles and their sheet bindings; only group by measured/sample provenance. */
export function homeDialsHtml(content: string, widgets: DashboardSnapshot['widgets']): string {
  return content.replace(/(<div class="panel" id="p-[^"]+"[^>]*>\s*)<div class="grid">([\s\S]*?)<\/div>/g,
    (_match, opening: string, grid: string) => {
      const tiles = [...grid.matchAll(/<(button|article)\b[^>]*data-model-id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g)]
        .map(match => ({ html: match[0], id: match[2]!, mode: widgets[match[2]!]!.mode }));
      const live = tiles.filter(tile => tile.mode === 'live').sort((a, b) => homeDialOrder(a.id) - homeDialOrder(b.id));
      const sample = tiles.filter(tile => tile.mode === 'sample');
      return `${opening}<div class="grid" data-primary-dials>${live.map(tile => tile.html).join('')}</div>`
        + (sample.length ? `<details class="sample-dials"><summary>Show ${sample.length} sample dials</summary><div class="grid" data-sample-dials>${sample.map(tile => tile.html).join('')}</div></details>` : '');
    });
}
