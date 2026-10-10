/** Keep the sign before a currency prefix without changing number precision or grouping. */
export function prefixedNumber(number: string, prefix = '', suffix = ''): string {
  return number.startsWith('-')
    ? `-${prefix}${number.slice(1)}${suffix}`
    : `${prefix}${number}${suffix}`;
}

export function formatPounds(value: number, formatNumber = (number: number): string => number.toFixed(2)): string {
  return prefixedNumber(formatNumber(value), '£');
}

export function formatMetricNumber(value: number, format: { pre?: string; dp?: number; suf?: string }): string {
  const number = format.dp ? value.toFixed(format.dp) : Math.round(value).toLocaleString('en-GB');
  return prefixedNumber(number, format.pre, format.suf);
}

/** Preserve the existing compact precision used for dial limits and history labels. */
export function formatLike(text: string): (value: number) => string {
  const unsigned = text.replace(/^-/, '');
  const prefix = unsigned.match(/^[^\d-]+/)?.[0] ?? '', suffix = unsigned.match(/[^\d.,]+$/)?.[0] ?? '';
  return (value) => prefixedNumber(Math.abs(value) >= 1000 ? value.toLocaleString('en-GB') : String(Math.round(value * 100) / 100), prefix, suffix);
}
