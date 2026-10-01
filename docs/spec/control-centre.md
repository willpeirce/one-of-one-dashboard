# One of One control centre

Mockup 7 of the dashboard, 1 Oct 2026. Will's brief, in four rounds: build on the plan, simplify it, make it replace the daily ads check, show a live health check as dials, add what is missing (30 Sep, mockup 2); then "information overload", headlines only (1 Oct, mockup 2b); then "still not appealing, a long list of red X's, make it fun and visual, I want to run the whole business from it, decisions are not alarms, and can a button act on Meta" (1 Oct, mockup 3); then a reference screenshot of a sports dashboard, "style it like this, add the One of One logo, Meta logos on anything Meta in the dials and the table, Google logos where needed, clean and not distracting, easy to glance at and read", with no outer frame because the reference was a showcase page (1 Oct, mockup 4); then the real logo (mockup 5); then "a test section, a test a week ideally, live results I can see", and a hero where every number follows the selected day, with overall ROAS, live net margin and website conversion rate, no orders today, and the Meta and Google logos big and bold in the background of the dials (1 Oct, mockup 6); then "flag when a new review has been posted, because I like to go in and either publish it or review it, in the top third of everything", then "move it to go above the tests panel" (1 Oct, this mockup). The rules behind the last two rounds are in `knowledge/dashboard-design-rules.md`. Where this note and `docs/dashboard-plan.md` disagree, this note wins for the screen; the plan still wins for keys, access levels, data facts, build rules and the "do not build" list.

Files:
- `docs/control-centre-mockup.html`: the screen, with the 29 Sep readout and 30 Sep status figures as sample data. Published for Will's phone at https://claude.ai/artifact/AgygkhL9yZJsszQ7WP4K5s (version 9: mockup 7, new Judge.me reviews flagged in the greeting, panel above Tests; earlier mockups are earlier versions of the same link). Every dial, ring and stat opens a sheet with what it reads, the rule, the source and the last seven days.
- `docs/dashboard-mockup.html`: mockup 1 (Business, Handover, UGC tabs), kept for the record.

## The four states

Always icon plus word, never colour alone.

| State | Looks | Means | Examples |
| --- | --- | --- | --- |
| Good ✓ | green | inside its bar | UK blended cost £24.96 against £28 |
| Watch ! | amber | from 90% of a bar, or a trend going the wrong way | BREAKING US slipping on 3 days; audience at 95% of plan |
| Decide ◆ | violet, the page accent | a choice only Will can make. Not a fault. | pause a set past its kill rule, Google budget off plan, Mailchimp overage, keep or revert the delivery setting |
| Alarm ✕ | red | something is actually broken or about to be | site or checkout down, stock under its 21-day floor, spend over 120% of plan, Meta over-credit above 1.8×, a dead feed |

Grey with an "i" is information with no bar set. Red is rationed on purpose: on the sample day the page has one alarm (US Slabs & Label pack, 14 days of stock) and five decisions. Mockup 2b painted all six red, which is what Will objected to.

Amber convention: unless the rule says otherwise, amber starts at 90% of the bar. So the £28 blended tripwire is amber from £25.20, the £16 UK add-to-cart bar from £14.40, the 25% test share cap from 22.5%. Where the rule has its own amber (stock 45 days amber, 21 days red; spend ±10% green, ±20% amber) the rule's numbers are used.

## The look (mockups 4 to 7)

Taken from Will's reference: a violet-to-magenta-to-blue gradient running edge to edge with no frame, frosted-glass panels and tiles on it, white rounded type (Outfit for headings and numbers, Plus Jakarta Sans for text, both from Google Fonts with system fallbacks), icon-pill navigation with a search box and a "W" avatar in the header, and one coral accent for the radar and the net-sales tile. Dial arcs sit on a dark well inside each glass tile so the status colours keep their contrast on the gradient. Status colours were re-validated for the purple surfaces: good #4cf0a0, watch #ffc43d, decide #7fd8ff, alarm #ff5a6e (light theme #0d9b5a / #b4760a / #1e78cc / #d62f45). Coral is an accent, not a state, and is kept visibly apart from alarm red.

Source marks: every tile with a `data-src` carries its source logo (Meta, Google, Shopify bag, email, box for stock) large and bold in its background: 170px on stat tiles, 200px on dials and rings, about 30% opacity on the dark theme and 16% on the light, with the dial well 45% transparent so the mark shows through and the numbers stay readable. Will asked for them big and bold on 1 Oct; mockup 4's faint corner marks were "kind of there, but kind of not". Every row on the table and in Tests carries the same mark in a glass square beside its chip. They are drawn placeholder glyphs until the real brand files are added within each company's guidelines. The One of One logo top-left is the real one: Will supplied it on 1 Oct, it is saved at `docs/assets/one-of-one-logo.png` (500×312 PNG, black slanted mark with the letters knocked out, so the gradient shows through them) and embedded inline in the header at 34px tall on desktop and 28px on a phone. A white version is a one-line swap (`filter: invert(1)` or a recoloured file) if Will prefers it on the purple. The copy in Shopify Files (`One_of_one_logo_white.png`, MediaImage 53873423614286) is not used because cdn.shopify.com is denied by the cloud environment's network policy.

## The screen, top to bottom

1. **Hello.** "Morning, Will", one sentence on the day, five pills (health score, alarms, decisions, to watch, good; alarms and decisions are counted from the table, watch and good from the dials) and a six-axis radar: Meta, Google, Growth, Store, Email, Stock, each axis the share of that source's gauges that are green (watch counts half, decisions and info are neutral), with the health number ghosted behind the shape.
2. **The period.** A Today / Yesterday / Last 7 days switch above the hero drives every number in it (Will, 1 Oct: everything relates to the day selected). Today reads "so far". Tiles: a coral net-sales tile with sparkbars, orders, website conversion rate, ad spend, the UK and US blended Meta cost-per-order dials, overall ROAS (net sales ÷ all ad spend: Meta, TikTok, Google) and net margin as a live estimate. Orders today and "net sales per £1 of ads" are gone. Net margin is a sample until `knowledge/costs.md` is filled: it assumes landed cost, fulfilment, payment fees and discounts at 25% of net sales, and its sheet says so.
3. **Score column** (right on desktop, under the hero on a phone). Three tabs: Live (minutes since the last order, carts open, parcels to dispatch against the UK and US cut-offs, site response, junk sources), Wins, Coming up (the next dated items, with every date behind "All dates").
4. **On the table.** One glass row per alarm or decision: source mark, chip, headline and recommendation, three numbers, buttons. Tap the headline for the why. Buttons act after a confirm tap, write a log line and keep an undo.
5. **New reviews.** Directly above Tests (Will, 1 Oct: first "in the top third of everything", then "move it to go above the tests panel"). The flag stays at the top: a count pill in the greeting and "Three new reviews to check." in its sentence; the pill scrolls to the panel. One row per Judge.me review that is neither published nor hidden: stars, product, market, two lines of text, age, Publish and Open. 1 to 3 stars reads "! Read first" with Read in Judge.me as the main button; never red. Rules in plan 7.9.
6. **Tests.** The fifth nav pill (Will, 1 Oct: "a test a week, ideally", with live results he can see). This week's test is a large card: one bar per arm with its count, a "how sure" dial on a well, the day against the stopping rule, and a Call button that stays disabled ("Ready in about 8 days") until the rule is met. The chip reads Too early, Not yet, Leaning, Call A or B, or Draw; only a call (95% on two mornings in a row) turns the card violet for Will. Under it: Also running (UK screen set and delivery dates, both before/after and capped at Leaning), Next up (retargeting, long v short cut, cart wording, bundles page; one test at a time per lane) and Past tests with the verdict and the rule each made. Calling asks for a confirm tap, then writes the register row, a `log/` line and the rule, with undo. The rules and the queue are in `ops/tests/register.md`, which this section reads.
7. **Dials.** Four tabs: Ads (12 gauges), Store (9), Growth (8), Stock (8). The dot on each tab is the worst state inside it. Semicircle dials carry a bar; countdown rings carry days. Each tile's source logo sits large behind it. The header search filters the dials by name across all four decks. The live sets table sits behind a button on the Ads tab, with Pause and Step on the rows that qualify.
8. **Feeds, today's log, note.** Feed ages, the lines written by today's actions, and the sample-data note.

Dark theme first, with the light theme carried (the gradient turns pastel and the wells go light). Green against amber fails the colour-blind separation test for every status palette, which is why every chip carries the icon and the word.

## Acting from the dashboard

Mockup 2b "drafted, never acted". Mockups 3 and 4 act, with three guards: every action needs a confirm tap, every action writes a line to today's log (and a `log/` entry when built), and every action keeps an undo.

Actions in the mockup: Pause (Meta ad set), Step +25% (Meta ad set budget), Leave running until tomorrow, Accept or Wait (Google budget change), Block or Tier (Mailchimp plan), Keep or Revert (delivery dates setting), Publish (a Judge.me review, only if Will allows that one write; otherwise Open only), Snooze (a card until a date), Copy message (supplier ask), WhatsApp Laszlo (a prefilled `wa.me` share link; no phone number is stored in the repo, so the first tap picks the contact).

How the Meta buttons would be built, answering Will's side question:

- Today a Claude session can already do this through the Meta Ads connector on his say-so: the connector has update and activate tools that set an ad set's status or daily budget.
- In the Replit dashboard a button calls a small server endpoint that calls the Meta Marketing API with a system-user token (scope `ads_management`, stored in Replit Secrets, never in this repo) to set the ad set `status` to `PAUSED` or change `daily_budget`. The endpoint writes the `log/` entry (date, system, ad set id, old and new values, how to undo) through the GitHub API, then returns. Undo calls the same endpoint with the old value: resume the set, or restore the old budget.
- Nothing acts on page load, on a schedule, or without the confirm tap. Kill and step rules stay in `knowledge/meta-ads.md`; the dashboard only proposes what the rules say.
- WhatsApp: the `wa.me` link is one tap to send from Will's phone. Sending without the tap needs the WhatsApp Business API, which is a later stage if he wants it.
- Customer service from the same page (Will's later wish) would be a Gorgias or Shopify inbox feed with reply buttons behind the same confirm-and-log pattern. Deferred with the UGC tab.

## Replacing the daily ads check

The routine "Daily ads check" (`trig_01LFiRte1YZznwEkM8JDT7P1`, 07:37 UK) does 19 checks and produces a phone reply, WhatsApp drafts and a repo entry. The dashboard covers each check as follows.

| Routine check | Dashboard element |
| --- | --- |
| A1-A2 pull by spend, prove the total | Feeds: Meta feed age, with the reconciliation (ad set rows add up to the account figure within £1) as a Store-tab light |
| A3 seven days by day for live sets | The sheet behind every dial (last 7 days) and the live sets table |
| A4 spend vs expected | Ads: "Our spend vs plan" dial |
| A5 kill rules | Ads: WINNER ATC dials, live sets table rows; one card on the table per breach with Pause as the button |
| A6 slipping | Live sets table rows marked Watch |
| A7 step-up candidates | Live sets table: Step +25% button on a qualifying row; a card when one is due |
| A8 delivery problems | Ads: "Placements" and delivery lights |
| A9 test share | Ads: "Test share" dial |
| A10 account changes | Ads: "Changes not by us" stat with the activity log behind it |
| B11-B12 freelancer | Ads: Laszlo UK and US dials; a card with "WhatsApp Laszlo" when a set is over the bar on 3 days |
| C13 Google junk | Ads: "Google junk" dial, spend vs plan dial, ROAS (bar to set) |
| D14 orders by market, Meta vs Shopify | Hero: orders; Ads: "Meta over-credit" dial |
| D15 blended cost per order | Hero: the two headline dials |
| D16 junk traffic | Right now: junk sources pill; Store: Missouri share and direct share |
| D17 refill counters | Store: "Refill pack" stat |
| E18 dated items | Coming up, and the All dates sheet |
| E19 watch tomorrow | Cards stay on the table until acted on; "Leave running" brings a card back tomorrow |

Two things the routine does that the dashboard must keep doing:

1. The 07:37 push. The dashboard sends the same short message to Will's phone at 07:37 UK: blended cost by market, what is on the table, what is watched.
2. The repo entry in `ops/ads-daily/YYYY-MM.md`. The dashboard writes the same entry, so the month file stays the audit trail and the Handover reader in the plan still works.

Retirement steps, in order:

1. Build to the point where the Meta, Google and Shopify feeds are live and the cards on the table match the routine's "What needs Will" section.
2. Run both for seven mornings. Each morning compare the dashboard's push and entry with the routine's. Note any difference in `ops/ads-daily/` under Run notes.
3. After seven clean mornings, ask Will. On his yes, disable the routine (not delete, so its history stays) and write a `log/` entry with the routine id, the date, and how to re-enable it.
4. Until that yes, the routine stays live and is the report of record.

## Added, not in the brief or the plan

- Site-up and checkout-reachable pings, and a check that the product-page delivery promise matches the checkout date (the delivery trial showed these drift).
- Over-credit ratio: Meta-reported purchases against Shopify orders, expected 1.2-1.5×. Above 1.8× is an alarm, because tracking or attribution has changed.
- Test share of spend and "changes not by us" as first-class gauges.
- Every running test as a countdown ring with its read date.
- Mailchimp audience against the plan, flow orders, flow leakage (buyers still emailed), and the D1 US routing check.
- Google budget against the expected list, so a campaign switched on without a message (as on 30 Sep) shows the same morning as a decision.
- Spike-day note on the hero heading (UK 24-26, US 1st and 15th, last two days of the month) so a flattering day is read as one.
- Feed freshness and the clocks-change date (25 Oct, Google day realigns with the UK day).
- "Bar to set" tiles where the repo has no threshold: overall ROAS and Google ROAS.
- Wins, health score and the action buttons (mockup 3); the radar by source, source marks on dials and rows, and dial search (mockup 4); the period switch, overall ROAS, the net margin estimate, conversion rate, big source marks and the Tests section (mockup 6); New reviews, flagged in the greeting with the panel above Tests (mockup 7).

## Deferred from the plan

Still in the plan and not in this mockup: the UGC tab, Gorgias and Discord feeds, J&J parcel uploads and the fulfilment cost model (plan 8.2), supplier orders and the reorder planner (8.3-8.4), the issues taxonomy (8.5), Ask (7.5), and the net-profit goal maths (needs COGS). They come after the dials are live, in the plan's stage order.

## Bars Will needs to set

- Overall ROAS (net sales ÷ all ad spend): the break-even is AOV ÷ contribution per order. Needs the costs table, `knowledge/costs.md`: landed cost per kit and fulfilment per parcel. The same table turns the net margin tile from a sample into a number.
- Google ROAS: the repo has no bar. A first guess is the same break-even logic as Meta.
- Whether the dashboard's 07:37 push replaces the routine's, or both run until he says.
