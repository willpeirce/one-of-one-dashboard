const formats = new Map<number | undefined, Intl.NumberFormat>();

/** One display boundary for money and counts; never use this output in calculations or inputs. */
export function formatNumber(value: number, decimalPlaces?: number): string {
  let format = formats.get(decimalPlaces);
  if (!format) {
    format = new Intl.NumberFormat('en-GB', decimalPlaces === undefined
      ? { maximumFractionDigits: 20 }
      : { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces });
    formats.set(decimalPlaces, format);
  }
  return format.format(value);
}

/** Keep the sign before a currency prefix without changing number precision or grouping. */
export function prefixedNumber(number: string, prefix = '', suffix = ''): string {
  return number.startsWith('-')
    ? `-${prefix}${number.slice(1)}${suffix}`
    : `${prefix}${number}${suffix}`;
}

export function formatPounds(value: number, number = (value: number): string => formatNumber(value, 2)): string {
  return prefixedNumber(number(value), '£');
}

export function formatDollars(value: number, number = (value: number): string => formatNumber(value, 2)): string {
  return prefixedNumber(number(value), '$');
}

export function formatMetricNumber(value: number, format: { pre?: string; dp?: number; suf?: string }): string {
  const number = format.dp ? formatNumber(value, format.dp) : formatNumber(Math.round(value), 0);
  return prefixedNumber(number, format.pre, format.suf);
}

/** Preserve the existing compact precision used for dial limits and history labels. */
export function formatLike(text: string): (value: number) => string {
  const unsigned = text.replace(/^-/, '');
  const prefix = unsigned.match(/^[^\d-]+/)?.[0] ?? '', suffix = unsigned.match(/[^\d.,]+$/)?.[0] ?? '';
  return (value) => prefixedNumber(formatNumber(Math.abs(value) >= 1000 ? Math.round(value * 1000) / 1000 : Math.round(value * 100) / 100), prefix, suffix);
}
