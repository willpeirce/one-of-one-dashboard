const ukHour = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London',
});

/** Greeting follows the real UK clock, independently of the selected data period. */
export function greetingAt(now: Date): string {
  const hour = Number(ukHour.format(now));
  return `${hour >= 5 && hour < 12 ? 'Morning' : hour >= 12 && hour < 18 ? 'Afternoon' : 'Evening'}, Will.`;
}
