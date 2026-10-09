import { addDays, ukToday } from './hero-range.js';

export interface OverheadItem {
  name: string;
  monthlyGbp: number;
  startMonth: string;
  endMonth: string;
}

const activeInMonth = (item: OverheadItem, month: string): boolean =>
  (!item.startMonth || item.startMonth <= month) && (!item.endMonth || item.endMonth >= month);

export function monthlyOverheadTotal(items: readonly OverheadItem[], month: string): number {
  return items.filter((item) => activeInMonth(item, month)).reduce((total, item) => total + item.monthlyGbp, 0);
}

const ukClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function ukMidnight(day: string): number {
  const target = Date.parse(`${day}T00:00:00Z`);
  let timestamp = target;
  // Resolve local midnight using London's actual offset, including either side of a clock change.
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = ukClock.formatToParts(timestamp);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
    const local = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
    if (local === target) break;
    timestamp += target - local;
  }
  return timestamp;
}

export function overheadsForPeriod(
  items: readonly OverheadItem[], from: string, to: string, now: Date,
): { total: number; items: { name: string; total: number }[] } {
  const today = ukToday(now);
  const shares = new Map<number, number>();
  for (let day = from; day <= to && day <= today; day = addDays(day, 1)) {
    const month = day.slice(0, 7);
    const monthEnd = new Date(`${month}-01T00:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    const days = monthEnd.getUTCDate();
    const start = day === today ? ukMidnight(day) : 0;
    const fraction = day === today
      ? Math.max(0, Math.min(1, (now.getTime() - start) / (ukMidnight(addDays(day, 1)) - start)))
      : 1;
    items.forEach((item, index) => {
      if (activeInMonth(item, month))
        shares.set(index, (shares.get(index) ?? 0) + item.monthlyGbp / days * fraction);
    });
  }
  const breakdown = items.flatMap((item, index) => shares.has(index) ? [{ name: item.name, total: shares.get(index)! }] : []);
  return { total: breakdown.reduce((sum, item) => sum + item.total, 0), items: breakdown };
}

/** Invented examples: sample mode never uses the user's Settings costs. */
export function sampleOverheads(): OverheadItem[] {
  return [
    { name: 'Software subscriptions', monthlyGbp: 180, startMonth: '', endMonth: '' },
    { name: 'Accountant', monthlyGbp: 150, startMonth: '', endMonth: '' },
    { name: 'Office rent', monthlyGbp: 400, startMonth: '', endMonth: '' },
  ];
}
