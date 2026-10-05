import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateDays, buildHeroRange, HeroRangeError, ukToday, validateHeroRange,
  type DailyMetrics,
} from '../src/hero-range.js';
import { SAMPLE_START, SAMPLE_TODAY, sampleDays } from '../src/sample-days.js';

const now = new Date('2026-10-05T12:00:00Z');
const completed = { today: '2026-10-05' };

function day(date: string, overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    date, net: 100, o: 1, uk: 1, us: 0, sess: 10, ukS: 8,
    ukM: 10, usM: 0, g: 0, ours: 0, ...overrides,
  };
}

// Unequal order, session and spend weights expose averages of daily ratios.
const smallDay = day('2026-05-01', { ours: 3 });
const largeDay = day('2026-05-02', {
  net: 900, o: 9, uk: 3, us: 6, sess: 990, ukS: 90,
  ukM: 90, usM: 300, g: 100, ours: 97,
});

function closeTo(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
}

test('today uses the UK calendar day before and after the clock changes', () => {
  const cases = [
    ['2026-09-30T22:59:59Z', '2026-09-30'],
    ['2026-09-30T23:00:00Z', '2026-10-01'],
    ['2026-10-24T23:30:00Z', '2026-10-25'],
    ['2026-10-25T23:30:00Z', '2026-10-25'],
    ['2026-10-26T00:00:00Z', '2026-10-26'],
    ['2027-03-27T23:30:00Z', '2027-03-27'],
    ['2027-03-28T23:30:00Z', '2027-03-29'],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(ukToday(new Date(instant!)), expected, instant);
  }
});

test('date ranges accept a single real day, leap day and at most 366 inclusive days', () => {
  for (const [from, to] of [
    ['2026-10-05', '2026-10-05'],
    ['2024-02-29', '2024-02-29'],
    ['2024-01-01', '2024-12-31'],
    ['2023-01-01', '2024-01-01'],
  ]) {
    assert.deepEqual(validateHeroRange(from, to, now), { from, to });
  }
  assert.throws(() => validateHeroRange('2024-01-01', '2025-01-01', now), HeroRangeError);
  assert.throws(() => validateHeroRange('2026-10-02', '2026-10-01', now), HeroRangeError);
});

test('invalid date inputs fail with a fixed safe error instead of being normalized', () => {
  const invalid: unknown[] = [
    undefined, null, 20261001, [], ['2026-10-01'], { date: '2026-10-01' },
    '', '2026-2-01', '2026-02-1', '2026-02-29', '2026-02-30', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-10-01 ', ' 2026-10-01',
    '2026-10-01T00:00:00Z', '<script>untrusted date</script>',
  ];
  const messages = new Set<string>();
  for (const value of invalid) {
    for (const [from, to] of [[value, '2026-10-05'], ['2026-01-01', value]]) {
      assert.throws(() => validateHeroRange(from, to, now), (error: unknown) => {
        assert.ok(error instanceof HeroRangeError);
        assert.ok(error.message.length > 0);
        assert.ok(!error.message.includes('untrusted'));
        messages.add(error.message);
        return true;
      });
    }
  }
  assert.equal(messages.size, 1);
});

test('future validation uses actual UK today rather than UTC or the sample anchor', () => {
  const instant = new Date('2026-09-30T23:15:00Z');
  assert.deepEqual(validateHeroRange('2026-10-01', '2026-10-01', instant), {
    from: '2026-10-01', to: '2026-10-01',
  });
  assert.throws(() => validateHeroRange('2026-10-01', '2026-10-02', instant), HeroRangeError);
  assert.deepEqual(validateHeroRange('2026-10-05', '2026-10-05', now), {
    from: '2026-10-05', to: '2026-10-05',
  });
});

test('sample days preserve the mockup readout, including every underlying denominator', () => {
  assert.equal(SAMPLE_START, '2026-01-01');
  assert.equal(SAMPLE_TODAY, '2026-09-30');
  const { ours: todayOurs, ...today } = sampleDays('2026-09-30', '2026-09-30')[0]!;
  closeTo(todayOurs, 59);
  assert.deepEqual(today, {
    date: '2026-09-30', net: 296, o: 6, uk: 2, us: 4, sess: 188, ukS: 90,
    ukM: 49, usM: 111, g: 14,
  });
  const week = aggregateDays(sampleDays('2026-09-23', '2026-09-29'));
  assert.equal(week.days, 7);
  assert.equal(week.net, 13_319);
  assert.equal(week.o, 269);
  assert.equal(week.uk, 169);
  assert.equal(week.us, 100);
  assert.equal(week.sess, 7_120);
  assert.equal(week.ukS, 3_440);
  closeTo(week.ukM, 4_503.85);
  closeTo(week.usM, 3_427);
  closeTo(week.spend, 8_596);
  closeTo(week.ours, 3_262);
  const readout = buildHeroRange(sampleDays(), '2026-09-23', '2026-09-29', completed);
  assert.equal(readout.ukcpo.v, 26.65);
  assert.equal(readout.uscpo.v, 34.27);
  const yesterday = sampleDays('2026-09-29', '2026-09-29')[0]!;
  assert.equal(yesterday.net, 2_099);
  assert.equal(yesterday.o, 43);
  assert.equal(yesterday.uk, 27);
  assert.equal(yesterday.us, 16);
  closeTo(yesterday.ukM, 27 * 24.96);
  closeTo(yesterday.usM, 16 * 34.61);
  closeTo(yesterday.ours, 466);
});

test('sample requests are deterministic, independent and limited to labelled coverage', () => {
  const all = sampleDays();
  assert.equal(all.length, 273);
  assert.equal(all[0]?.date, SAMPLE_START);
  assert.equal(all.at(-1)?.date, SAMPLE_TODAY);
  // Pinned from the mockup's seeded generator, before its fixed September readout.
  const { ours: firstOurs, ...first } = all[0]!;
  assert.ok(Number.isFinite(firstOurs));
  assert.deepEqual(first, {
    date: '2026-01-01', net: 1_076, o: 22, uk: 14, us: 8, sess: 560, ukS: 259,
    ukM: 390.30195431411266, usM: 281.1834152638912, g: 76.39764558523893,
  });
  const selected = sampleDays('2026-02-20', '2026-03-04');
  assert.deepEqual(selected, all.filter((row) => row.date >= '2026-02-20' && row.date <= '2026-03-04'));
  assert.deepEqual(sampleDays('2026-02-20', '2026-03-04'), selected);
  selected[0]!.net = -1;
  assert.notEqual(sampleDays('2026-02-20', '2026-03-04')[0]!.net, -1);
  assert.throws(() => sampleDays('2025-12-31', '2026-01-01'));
  assert.throws(() => sampleDays('2026-09-30', '2026-10-01'));
});

test('custom and calendar quick ranges match independently evaluated mockup totals', () => {
  // Expected totals were evaluated from docs/spec/mockup.html's ROWS generator.
  // They are deliberately not derived through the application's aggregation.
  const cases = [
    ['2026-09-08', '2026-09-20', 20_895, 441, 13_773],
    ['2026-09-01', '2026-09-30', 48_547, 1_009, 31_796],
    ['2026-08-01', '2026-08-31', 46_238, 984, 30_583],
    ['2026-01-01', '2026-09-30', 360_688, 7_638, 241_146],
  ] as const;
  for (const [from, to, net, orders, spend] of cases) {
    const hero = buildHeroRange(sampleDays(), from, to, { today: SAMPLE_TODAY });
    assert.equal(hero.net.n, net, from);
    assert.equal(hero.orders.n, orders, from);
    assert.equal(hero.spend.n, spend, from);
  }
});

test('aggregation preserves additive inputs and derives spend without rounding each day', () => {
  const rows = [smallDay, largeDay];
  const before = structuredClone(rows);
  const totals = aggregateDays(rows);
  assert.deepEqual(totals, {
    net: 1_000, o: 10, uk: 4, us: 6, sess: 1_000, ukS: 98,
    ukM: 100, usM: 300, g: 100, days: 2,
    usS: 902, meta: 400, spend: 500, ours: 100,
  });
  assert.deepEqual(rows, before);
  const fractional = aggregateDays([
    day('2026-05-01', { ukM: 0.49, usM: 0.49, g: 0.49 }),
    day('2026-05-02', { ukM: 0.49, usM: 0.49, g: 0.49 }),
  ]);
  closeTo(fractional.spend, 2.94);
});

test('a selected range recomputes all eight hero metrics from its raw totals', () => {
  const rows = [day('2026-04-30', { net: 99_999 }), smallDay, largeDay, day('2026-05-03', { net: 99_999 })];
  const before = structuredClone(rows);
  const hero = buildHeroRange(rows, '2026-05-01', '2026-05-02', completed);
  assert.equal(hero.from, '2026-05-01');
  assert.equal(hero.to, '2026-05-02');
  assert.equal(hero.net.n, 1_000);
  assert.equal(hero.orders.n, 10);
  assert.equal(hero.spend.n, 500);
  assert.match(hero.spend.ss, /ours £100 · Laszlo £300 · Google £100/);
  assert.equal(hero.cr.n, 1);
  assert.equal(hero.roas.n, 2);
  assert.equal(hero.margin.n, 25);
  assert.equal(hero.ukcpo.v, 25);
  assert.equal(hero.uscpo.v, 50);
  assert.deepEqual(hero.net.d.hist, [100, 900]);
  assert.deepEqual(hero.spark, hero.net.d.hist);
  assert.match(hero.margin.d.why, /25%/);
  assert.match(hero.margin.d.why, /sample/i);
  assert.deepEqual(rows, before);
});

test('charts stay daily through 31 days, then use weighted seven-day bins and a short final bin', () => {
  const rows = Array.from({ length: 32 }, (_, index) => ({
    ...(index % 2 === 0 ? smallDay : largeDay),
    date: new Date(Date.UTC(2026, 4, index + 1)).toISOString().slice(0, 10),
  }));
  const daily = buildHeroRange(rows, '2026-05-01', '2026-05-31', completed);
  assert.equal(daily.net.d.hist?.length, 31);
  assert.deepEqual(daily.net.d.hist?.slice(0, 4), [100, 900, 100, 900]);
  const weekly = buildHeroRange(rows, '2026-05-01', '2026-06-01', completed);
  assert.deepEqual(weekly.net.d.hist, [443, 557, 443, 557, 500]);
  assert.deepEqual(weekly.orders.d.hist, [4, 6, 4, 6, 5]);
  assert.deepEqual(weekly.spend.d.hist, [216, 284, 216, 284, 250]);
  assert.deepEqual(weekly.roas.d.hist, [2.05, 1.96, 2.05, 1.96, 2]);
  assert.deepEqual(weekly.margin.d.hist, [26, 24, 26, 24, 25]);
  assert.deepEqual(weekly.ukcpo.d.hist, [23.85, 26, 23.85, 26, 25]);
  assert.deepEqual(weekly.spark, weekly.net.d.hist);
  assert.match(weekly.net.d.ha!, /week by week.*average a day/i);
  assert.deepEqual(weekly.net.d.hl, ['week of 1 May', 'week of 29 May']);
});

test('a single day shows the seven days ending on the chosen date', () => {
  const rows = Array.from({ length: 10 }, (_, index) => day(`2026-05-${String(index + 1).padStart(2, '0')}`, {
    net: (index + 1) * 100,
  }));
  const hero = buildHeroRange(rows, '2026-05-10', '2026-05-10', completed);
  assert.equal(hero.net.n, 1_000);
  assert.deepEqual(hero.net.d.hist, [400, 500, 600, 700, 800, 900, 1_000]);
  assert.deepEqual(hero.net.d.hl, ['4 May', '10 May']);
  assert.match(hero.net.d.why, /7-day average.*£600/);
  const first = buildHeroRange(rows, '2026-05-01', '2026-05-01', completed);
  assert.deepEqual(first.net.d.hist, [100]);
  assert.equal(first.net.state, 'info');
  const firstSample = buildHeroRange(sampleDays(), SAMPLE_START, SAMPLE_START, completed);
  assert.deepEqual(firstSample.spark, [1_076]);
  assert.deepEqual(firstSample.net.d.hl, ['1 Jan', '1 Jan']);
  assert.equal(firstSample.net.state, 'info');
});

test('comparison states use the immediately preceding equal-length range and the strict 85% boundary', () => {
  const rows = [
    day('2026-05-01'), day('2026-05-02'),
    day('2026-05-03', { net: 80 }), day('2026-05-04', { net: 90 }),
  ];
  const boundary = buildHeroRange(rows, '2026-05-03', '2026-05-04', completed);
  assert.equal(boundary.net.state, 'info');
  rows[2]!.net = 79;
  assert.equal(buildHeroRange(rows, '2026-05-03', '2026-05-04', completed).net.state, 'warn');
  rows[2]!.net = 110;
  assert.equal(buildHeroRange(rows, '2026-05-03', '2026-05-04', completed).net.state, 'good');
});

test('ranges containing today stay so far and use the configured blended Meta bar', () => {
  const hero = buildHeroRange([smallDay, largeDay], '2026-05-01', '2026-05-02', {
    today: '2026-05-02', blendedMetaTripwireGbp: 31.2,
  });
  for (const metric of [hero.net, hero.orders, hero.cr, hero.spend]) assert.equal(metric.state, 'sofar');
  assert.match(hero.eyebrow, /today so far/);
  for (const dial of [hero.ukcpo, hero.uscpo]) {
    assert.equal(dial.cap, 'sofar');
    assert.equal(dial.z[1]?.[1], 31.2);
    closeTo(dial.z[1]![0], 28.08);
    assert.match(dial.s, /£31\.2/);
    assert.match(dial.d.rule, /no judgement until today ends/i);
  }
  assert.equal(hero.roas.state, 'info');
  assert.equal(hero.margin.state, 'est');
});

test('zero denominators cannot put NaN or Infinity into hero values or histories', () => {
  const empty = day('2026-05-01', {
    net: 0, o: 0, uk: 0, us: 0, sess: 0, ukS: 0, ukM: 0, usM: 0, g: 0,
  });
  const hero = buildHeroRange([empty], empty.date, empty.date, completed);
  for (const metric of [hero.net, hero.orders, hero.cr, hero.spend, hero.roas, hero.margin]) {
    assert.equal(metric.n, 0);
    assert.ok(metric.d.hist?.every(Number.isFinite));
  }
  assert.equal(hero.ukcpo.v, 0);
  assert.equal(hero.uscpo.v, 0);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(hero)));
});

test('22 and 23 September guard market conversion without discarding store-wide orders or conversion', () => {
  const rows = sampleDays();
  for (const date of ['2026-09-22', '2026-09-23']) {
    const source = rows.find((row) => row.date === date)!;
    const hero = buildHeroRange(rows, date, date, completed);
    assert.equal(hero.orders.n, source.o);
    assert.equal(hero.cr.n, Math.round(1_000 * source.o / source.sess) / 10);
    assert.match(`${hero.cr.ss} ${hero.cr.d.why}`, /no data|unknown/i);
    assert.ok(!/UK [\d.]+%|US [\d.]+%/.test(hero.cr.ss));
  }
  const crossing = buildHeroRange(rows, '2026-09-21', '2026-09-24', completed);
  assert.match(`${crossing.cr.ss} ${crossing.cr.d.why}`, /no data|unknown/i);
  const restored = buildHeroRange(rows, '2026-09-24', '2026-09-24', completed);
  assert.match(restored.cr.ss, /UK [\d.]+%/);
  assert.match(restored.cr.ss, /US [\d.]+%/);
});

test('the hero identifies market-specific spike dates, including real month ends', () => {
  const rows = sampleDays();
  for (const [date, label] of [
    ['2026-02-27', '27 Feb (UK and US)'], ['2026-02-28', '28 Feb (UK and US)'],
    ['2026-09-01', '1 Sep (US)'], ['2026-09-15', '15 Sep (US)'],
    ['2026-09-24', '24 Sep (UK)'], ['2026-09-25', '25 Sep (UK)'], ['2026-09-26', '26 Sep (UK)'],
    ['2026-09-29', '29 Sep (UK and US)'], ['2026-09-30', '30 Sep (UK and US)'],
  ] as const) {
    const hero = buildHeroRange(rows, date, date, completed);
    const note = hero.orders.d.extra?.find(([key]) => key === 'Spike days')?.[1];
    assert.ok(note, date);
    assert.ok(note.replaceAll('Sept', 'Sep').includes(label), date);
    assert.match(note, /do not base a verdict on a spike day alone/i);
    assert.ok(hero.orders.d.hm?.at(-1)?.replaceAll('Sept', 'Sep').includes(label), date);
    assert.equal(hero.orders.state, 'info');
  }
  for (const date of ['2026-02-23', '2026-03-27', '2026-09-27', '2026-09-28']) {
    const hero = buildHeroRange(rows, date, date, completed);
    assert.ok(!hero.orders.d.extra?.some(([key]) => key === 'Spike days'), date);
  }
});

test('spike notes list up to five days, then use a count throughout the range details', () => {
  const rows = sampleDays();
  const warning = 'Do not base a verdict on a spike day alone.';
  const five = buildHeroRange(rows, '2026-09-24', '2026-09-30', completed);
  assert.equal(five.net.d.extra?.find(([key]) => key === 'Spike days')?.[1],
    `Spike days: 24 Sep (UK), 25 Sep (UK), 26 Sep (UK), 29 Sep (UK and US), 30 Sep (UK and US). ${warning}`);

  for (const [from, count] of [['2026-09-15', 6], [SAMPLE_START, 63]] as const) {
    const hero = buildHeroRange(rows, from, SAMPLE_TODAY, completed);
    const note = `${count} spike days in this range. ${warning}`;
    for (const metric of [hero.net, hero.orders, hero.cr, hero.spend, hero.roas, hero.margin, hero.ukcpo, hero.uscpo]) {
      assert.equal(metric.d.extra?.find(([key]) => key === 'Spike days')?.[1], note);
      assert.ok(metric.d.ha?.endsWith(note));
      assert.ok(!metric.d.rule.includes('Spike days:'));
    }
    for (const metric of [hero.net, hero.orders, hero.cr, hero.ukcpo, hero.uscpo]) {
      assert.ok(metric.d.rule.endsWith(note));
    }
    assert.ok(hero.orders.d.why.endsWith(note));
    // Individual bars retain the dates and markets, even for a long range.
    assert.ok(hero.orders.d.hm?.some((mark) => mark.includes('30 Sep (UK and US)')));
    if (count === 63) assert.equal(hero.orders.d.hm?.[0], 'Spike days: 1 Jan (US)');
  }
});
