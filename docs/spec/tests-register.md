# Test register

Start one a week where a lane is free (site lane, ads lane); each runs until it reads. The control centre mockup's Tests section reads this file.

Every test starts with a question, two arms, one metric, a bar, a start date and an end date. It ends with a verdict and a rule, or a verdict and "no rule".

## Rules

- **Lanes.** One test at a time in the site lane (theme, cart, pages) and one in the ads lane (Meta creative and audience). Two tests in the same lane never share a page or an audience.
- **Bar first.** Write the bar before the start. A test without a bar is a look, not a test.
- **Stopping rule.** At least 7 full days including a weekend, and 30 of the counted event per arm: orders for site tests; add-to-carts, with at least £75 spent per arm, for Meta creative tests. The verdict is recomputed only at 07:37. "Sure" needs two-sided 95% on two mornings in a row, the last not a spike day. Day 28 with no call is a draw: "no difference bigger than X%", keep the simpler or cheaper arm, recorded as a result.
- **How long.** At tens of orders a day, store-level tests read in two to four weeks. Meta creative tests read on cost per add-to-cart: 30 a side at £22.50 a day per arm is about 9 to 10 days.
- **Before and after.** A test that switches a setting for everyone (checkout wording, delivery dates) is a before/after switch, not a split. Its verdict is capped at Leaning.
- **Meta creative A/B tests** use two ad sets, one ad each, same audience, spend within 10%. Never both ads in one ad set for a creative test, because Meta favours one early.
- **No test straddles Black Friday** (23 to 28 Nov).
- **Live systems.** A test that changes a live system follows the live-system rules: duplicate theme, preview, Will's yes, `log/` entry.
- **Verdicts.** A wins, B wins, draw, stopped. The rule is one sentence that goes into `knowledge/` with an Evidence line pointing at this row.
- No customer personal data. Counts and rates only.

## Live

| Id | Lane | Question | Arms | Metric and bar | Started | Ends | Where measured | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 gift popup | Site | Does an email-gated gift popup beat adding the free slab pack automatically? | A: EasyGift adds the slab pack free (`_Gifted` line, no popup). B: email-gated popup with code SLABPACK | Kit orders per arm, coin-flip test against the 50/50 split until visitor counts per arm are readable; then revenue per visitor (Will's metric) | 2026-09-29 | Proposed 2026-10-27 (day 28), Will to confirm (decision row 1) | Shopify orders, `__gift_test` order attribute on every order from #5354; sign-ups by the `slab-popup` customer tag in Shopify | Live, day 3 |
| T2 UK screen | Ads | Does the reactivated UK screen set (ads 24 + 33) earn its £40 a day? | Single set, before/after against the UK bar | Cost per purchase over all spend since 30 Sep against £18.56. Ignore the daily flex | 2026-09-30 | 2026-10-04 (day 5, Will's date) | Meta ad set `120249858748230430` via the daily entry | Live, day 2. Capped at Leaning |
| T4 delivery dates | Site | Does Automated close the afternoon delivery-date gap without over-promising? | A: Automated. B: Manual (before 29 Sep) | Dates shown against real deliveries, UK and US apart | 2026-09-29 | Audit from 2026-10-06, then Will decides (decision row 2) | `ops/delivery-trial/trial-log.md`, `scripts/delivery-audit.mjs` | Thursday checks to add. Before/after, capped at Leaning |

## Watches (kill rules, not tests)

| Id | What | Rule | Started | Where measured |
| --- | --- | --- | --- | --- |
| W1 captiontest v3 | UK set `120248648153630430`, £30 | Kill rules in `knowledge/meta-ads.md`; 28 to 30 Sep slipping | 2026-07-21 | Daily entry |

## Queue

| Id | Lane | Question | Arms | Metric and bar | How it would run | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| R1 retargeting | Ads | Does £10 a day per country on recent visitors who have not bought add orders, or only take credit? | A: RT US and RT UK sets. B: no retargeting (market totals) | The brief's own day-14 rules: 7-day-click cost per purchase, Shopify orders with last visit `utm_campaign=rt-oct`, market blend | `ads/2026-10-meta-retargeting-brief.md`. First in the ads lane on Will's yes; Q1 waits for it, because new spend in the same market muddies the brief's blend check | Will's yes on creative pair, budget, start date, 7-day click. Earliest Mon 5 Oct; day 14 Sun 18 Oct |
| Q1 long v short cut | Ads | Does the long cut of the same Meta ad beat the short cut? | A: long cut. B: short cut | Cost per add-to-cart, 30 a side; video view curve (3s, ThruPlay) second | Two ad sets at £22.50 each, one cut per set, same audience | Both cuts rendered; Will's yes; `log/` entry. After R1 (day 14 is Sun 18 Oct), or first if Will picks it over R1 |
| Q2 cart wording | Site | Does new cart drawer wording lift checkout starts? | A: current. B: new wording | Checkouts started per cart | Duplicate theme, in-theme split stamped on the order like T1. The checkout page cannot be split on this plan; checkout wording is a before/after switch | Waits for T1: the cart footer is shared with the popup. Theme library is at 20, delete a draft first |
| Q3 landing page | Site | Does `/pages/bundles` convert paid traffic better than the kit page? | A: kit page. B: `/pages/bundles` | Orders per session from the same ad | Same creative, two ad sets pointing at the two pages | After Q2; Will's yes |

## History

| Id | Question | Verdict | Rule | Evidence |
| --- | --- | --- | --- | --- |
| H1 Story and Reels placements for statics | Do static concepts work in Story and Reels? | Feed wins (Story and Reels failed for every static concept) | New static concepts go feed only | `knowledge/meta-ads.md` lessons; killed arms in `log/2026-09.md` |
| H2 re-read of killed arms | Were the September kills right after two weeks? | Mixed | Only News article US story reached break-even (£23.40 against £22.70). Re-read kills monthly | `knowledge/meta-ads.md`, 30 Sep |
| H3 Shopify Flow country condition | Does the D1 US flow fire with the country set to "United States"? | A wins | Use "United States", not the code | `knowledge/mailchimp-flows.md`, 27 Sep, 3 entries the same day |
