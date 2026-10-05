import { addDays, HeroRangeError, type DailyMetrics } from './hero-range.js';

export const SAMPLE_START = '2026-01-01';
export const SAMPLE_TODAY = '2026-09-30';
const OUR_SHARE = 0.4113;
type SampleDay = Omit<DailyMetrics, 'date' | 'ours'> & { ours?: number };

/** Dated, invented daily inputs from mockup 8's seeded ROWS generator. */
function generateDays(): DailyMetrics[] {
  let seed = 20260930;
  const random = (): number => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const between = (a: number, b: number): number => a + (b - a) * random();
  const dayOfWeek = [1.12, 0.97, 0.95, 1, 0.98, 1.02, 0.98];
  const rows: DailyMetrics[] = [];
  const append = (row: SampleDay): void => { rows.push({ date: addDays(SAMPLE_START, rows.length), ...row, ours: row.ours ?? (row.ukM + row.usM) * OUR_SHARE }); };
  for (let n = 0; n < 258; n++) {
    const date = new Date(`${addDays(SAMPLE_START, n)}T00:00:00Z`);
    const o = Math.max(8, Math.round((22 + 11 * n / 257) * dayOfWeek[date.getUTCDay()]! * between(0.9, 1.1)));
    const uk = Math.round(o * between(0.55, 0.65));
    const us = o - uk;
    const sess = Math.round(o / between(0.033, 0.04));
    append({ net: Math.round(o * between(44, 50)), o, uk, us, sess, ukS: Math.round(sess * between(0.45, 0.51)), ukM: uk * between(24, 28), usM: us * between(28, 36), g: between(70, 110) });
  }
  const previousWeek = [[1590, 33, 20, 917], [1660, 34, 21, 944], [1860, 37, 22, 1028], [1720, 35, 21, 972], [2060, 42, 25, 1167], [1580, 32, 19, 889], [1750, 35, 21, 972]] as const;
  for (const [net, o, uk, sess] of previousWeek) append({ net, o, uk, us: o - uk, sess, ukS: Math.round(sess * 0.49), ukM: uk * 26.2, usM: (o - uk) * 33.5, g: 92 });

  const net = [1640, 1710, 1980, 1820, 2310, 1760, 2099];
  const orders = [35, 36, 40, 37, 46, 32, 43];
  const sessions = [951, 953, 1032, 1034, 1126, 919, 1105];
  const ukSessions = [470, 468, 508, 506, 556, 452, 480];
  const ukOrders = [21, 22, 27, 24, 28, 20, 27];
  const ukCosts = [26.6, 25.9, 29.1, 25.6, 25.6, 28.8, 24.96];
  const usCosts = [31.2, 36.4, 33, 38.9, 30.1, 35.7, 34.61];
  const spend = [1120, 1170, 1280, 1200, 1370, 1086, 1370];
  const week = net.map((value, i): SampleDay => {
    const us = orders[i]! - ukOrders[i]!;
    const ukM = ukCosts[i]! * ukOrders[i]!;
    const usM = usCosts[i]! * us;
    return { net: value, o: orders[i]!, uk: ukOrders[i]!, us, sess: sessions[i]!, ukS: ukSessions[i]!, ukM, usM, g: spend[i]! - ukM - usM };
  });
  // Mockup ROWS' rounded daily CPAs do not reproduce its seven-day readout.
  // Preserve the requested £26.65 UK / £34.27 US blend and yesterday's figures:
  // allocate the small differences across 23–28 Sep in integer pence, with the
  // last day taking the residual. Google is the daily spend remainder, so every
  // displayed daily spend and the £8,596 weekly total remain unchanged.
  for (const [field, target] of [['ukM', 450385], ['usM', 342700]] as const) {
    const current = week.map((row) => Math.round(row[field] * 100));
    const delta = target - current.reduce((sum, value) => sum + value, 0);
    const denominator = current.slice(0, 6).reduce((sum, value) => sum + value, 0);
    let remaining = delta;
    for (let i = 0; i < 6; i++) {
      const adjustment = i === 5 ? remaining : Math.floor(delta * current[i]! / denominator);
      week[i]![field] = (current[i]! + adjustment) / 100;
      remaining -= adjustment;
    }
  }
  for (let i = 0; i < week.length; i++) {
    const row = week[i]!;
    row.g = (Math.round(spend[i]! * 100) - Math.round(row.ukM * 100) - Math.round(row.usM * 100)) / 100;
    row.ours = Math.round((row.ukM + row.usM) * OUR_SHARE * 100) / 100;
  }
  // Keep the supplied yesterday owner spend and the £3,262 weekly readout.
  // Owner attribution is additive input, never a ratio assumed by aggregation.
  week[6]!.ours = 466;
  const ownerPence = week.map((row) => Math.round(row.ours! * 100));
  const ownerDelta = 326200 - ownerPence.reduce((sum, value) => sum + value, 0);
  const ownerBase = ownerPence.slice(0, 6).reduce((sum, value) => sum + value, 0);
  let ownerRemaining = ownerDelta;
  for (let i = 0; i < 6; i++) {
    const adjustment = i === 5 ? ownerRemaining : Math.floor(ownerDelta * ownerPence[i]! / ownerBase);
    week[i]!.ours = (ownerPence[i]! + adjustment) / 100;
    ownerRemaining -= adjustment;
  }
  for (const row of week) append(row);
  append({ net: 296, o: 6, uk: 2, us: 4, sess: 188, ukS: 90, ukM: 49, usM: 111, g: 14, ours: 59 });
  return rows;
}

const dailySample = generateDays();

export function sampleDays(from = SAMPLE_START, to = SAMPLE_TODAY): DailyMetrics[] {
  if (from < SAMPLE_START || to > SAMPLE_TODAY || from > to) throw new HeroRangeError();
  return dailySample.filter((row) => row.date >= from && row.date <= to).map((row) => ({ ...row }));
}
