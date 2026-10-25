export const hourLabel = (hour: number): string => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
export function hourlyTop(values: readonly number[]): number {
  const max = Math.max(2, ...values), unit = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 4, 6, 8, 10].map(n => n * unit).find(n => n >= max)!;
}
/** Fritsch–Carlson tangents; each interval stays between its two observations. */
export function monotoneSegments(values: readonly number[], x: (i: number) => number, y: (n: number) => number): string[] {
  if (values.length < 2) return [];
  const slopes = values.slice(1).map((value, i) => value - values[i]!);
  const tangents = values.map((_, i) => i === 0 ? slopes[0]! : i === values.length - 1 ? slopes.at(-1)! : (slopes[i - 1]! + slopes[i]!) / 2);
  slopes.forEach((slope, i) => {
    if (slope === 0) { tangents[i] = 0; tangents[i + 1] = 0; return; }
    if (tangents[i]! / slope < 0) tangents[i] = 0;
    if (tangents[i + 1]! / slope < 0) tangents[i + 1] = 0;
    const a = tangents[i]! / slope, b = tangents[i + 1]! / slope, length = Math.hypot(a, b);
    if (length > 3) { tangents[i] = 3 * a * slope / length; tangents[i + 1] = 3 * b * slope / length; }
  });
  return slopes.map((_, i) => {
    const step = (x(i + 1) - x(i)) / 3;
    return `C${x(i) + step} ${y(values[i]! + tangents[i]! / 3)} ${x(i + 1) - step} ${y(values[i + 1]! - tangents[i + 1]! / 3)} ${x(i + 1)} ${y(values[i + 1]!)}`;
  });
}
