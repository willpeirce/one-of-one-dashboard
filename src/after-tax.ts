import type { HeroMetric } from './dashboard-types.js';
import { formatNumber, formatPounds } from './money.js';

/** The UK main rate. Will can change it in Settings once the accountant confirms the rate to plan with. */
export const defaultCorporationTaxPercent = 25;

/** Corporation tax on one period's profit. A loss pays none: it is not refunded, it reduces tax on later profit. */
export function corporationTax(profit: number, ratePercent: number): number {
  return profit > 0 ? profit * ratePercent / 100 : 0;
}

/**
 * After tax: Net profit less estimated UK corporation tax, from the same pound total as Net profit,
 * so it carries Net profit's gaps, state, sources and market rules. UK VAT is already out of Net profit.
 */
export function afterTaxMetric(profit: HeroMetric, ratePercent: number): HeroMetric {
  const rate = `${formatNumber(ratePercent)}%`;
  const tax = corporationTax(profit.n, ratePercent);
  const n = profit.n - tax;
  const loss = profit.n <= 0;
  const line = loss ? 'No tax on a loss' : `Less ${rate} corporation tax`;
  const ss = profit.unavailable ? profit.ss : profit.state === 'warn' ? `${line}\nSame gaps as Net profit` : line;
  const why = profit.unavailable
    ? `After tax follows Net profit, which is unavailable here: ${profit.ss.replaceAll('\n', ' ')}.`
    : `${loss
      ? `Net profit is ${formatPounds(profit.n)}, so no corporation tax comes off: a loss is not refunded, it reduces tax on later profit.`
      : `Net profit ${formatPounds(profit.n)} less corporation tax at ${rate} (${formatPounds(tax)}): ${formatPounds(n)}.`}`
      + ' An estimate of what the business keeps from these sales, not the bank balance: stock is paid for before it sells, VAT sits in the account until the quarter\'s return, and corporation tax is paid later.';
  return {
    ...profit,
    n,
    ss,
    d: {
      ...profit.d,
      ...(profit.d.hist ? { hist: profit.d.hist.map(value => value - corporationTax(value, ratePercent)) } : {}),
      why,
      rule: `UK VAT is already out of Net profit: Shopify's item and shipping tax comes off every order, and J&J charges are net of VAT. Enter overheads in Settings without VAT. US orders carry no sales tax today; if Shopify starts collecting it, its tax lines come off the same way. Corporation tax is charged on the year's taxable profit; this applies one rate from Settings (${rate}) to each period, not the 19% small profits rate or marginal relief, which depend on the whole year and the group's associated companies. It is due 9 months and a day after the year end, or in quarterly instalments for large companies.`,
      src: `${profit.d.src}; corporation tax rate from Settings`,
      extra: [
        ['Net profit', profit.unavailable ? 'Unknown' : formatPounds(profit.n)],
        [`Corporation tax at ${rate}`, profit.unavailable ? 'Unknown' : loss ? 'None on a loss' : `−${formatPounds(tax)}`],
        ['After tax', profit.unavailable ? 'Unknown' : formatPounds(n)],
      ],
    },
  };
}
