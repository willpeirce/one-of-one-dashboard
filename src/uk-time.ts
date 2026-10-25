const ukTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** One user-facing clock for source diagnostics, including both sides of DST. */
export function formatUkTime(value: Date | string): string {
  return `${ukTime.format(new Date(value)).replace(',', '')} UK`;
}
