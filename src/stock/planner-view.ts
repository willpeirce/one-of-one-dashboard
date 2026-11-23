import { formatNumber } from '../money.js';
import { scorecardShellStart } from '../scorecard/shell.js';
import { paceDate } from '../series-pace/model.js';
import type { StockPlannerView } from './planner-store.js';
import { plannerHistoryDays, type PlannerRow } from './planner.js';

const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const date = (value: string | null) => value ? `<time datetime="${escape(value)}">${escape(paceDate(value))}</time>` : '—';

function productRow(row: PlannerRow): string {
  const decision = row.state === 'alarm' ? 'Order now' : row.state === 'warn' ? 'Order soon' : row.state === 'good' ? 'Good' : '';
  const inbound = row.inbound.length ? row.inbound.map(item => `<span>${formatNumber(item.quantity)} · ${date(item.expectedDate)}</span>`).join('') : 'None listed';
  const cover = row.coverage;
  const coverage = cover === null ? '' : `<p class="planner-cover">Covers about ${formatNumber(cover.covered)} of ${formatNumber(cover.kits)} kits left${cover.shortfall ? ` · ${formatNumber(cover.shortfall)} units short` : ''}</p>`;
  const rate = row.rate === null ? 'No history' : `${formatNumber(row.rate, 2)} / day${row.observedDays < plannerHistoryDays ? '<small>Short history</small>' : ''}`;
  const orderBy = row.kit ? 'Run-out, not restocked' : row.setSupplier ? '<a href="/settings">Set a supplier</a>'
    : `${date(row.orderBy)}${decision ? `<small class="planner-state" data-stock-state="${row.state}">${decision}</small>` : ''}`;
  return `<article class="glass planner-row" data-planner-product><h3>${escape(row.name)}${row.kit ? '<small>Series kit</small>' : ''}</h3><dl>
    <div><dt>Available now</dt><dd>${row.available === null ? 'Unknown' : formatNumber(row.available)}</dd></div>
    <div><dt>Daily rate</dt><dd>${rate}</dd></div>
    <div><dt>Stock landing</dt><dd>${inbound}</dd></div>
    <div><dt>Run-out</dt><dd>${date(row.runOut)}</dd></div>
    <div><dt>Order-by</dt><dd>${orderBy}</dd></div>
  </dl>${coverage}</article>`;
}

export function stockPlannerPage(view: StockPlannerView): string {
  return `${scorecardShellStart('Stock', '<link rel="stylesheet" href="/assets/stock-planner.css">')}
    <main class="wrap settings-wrap score-wrap planner-page" id="main">
      <section class="chapter">
        <header class="chapter-heading"><div class="chapter-copy"><h1 class="chapter-title">Stock and reorders</h1></div></header>
        <p class="sample-banner" data-stock-mode="${view.mode}">${view.mode === 'sample' ? 'Sample data · invented products, stock and suppliers' : 'Live Shopify inventory · 28 complete UK days of stock snapshots'}</p>
        <p class="score-context">Rates use observed stock changes on days with usable snapshots. Order-by dates include the supplier lead time and safety weeks in Settings.</p>
      </section>
      ${(['uk', 'us'] as const).map(market => `<section class="chapter planner-warehouse" data-planner-market="${market}" aria-labelledby="stock-${market}">
        <h2 id="stock-${market}">${market.toUpperCase()} warehouse</h2>${view.rows.filter(row => row.market === market).map(productRow).join('')}
      </section>`).join('')}
      <p id="auth-message" role="status"></p>
    </main></body></html>`;
}
