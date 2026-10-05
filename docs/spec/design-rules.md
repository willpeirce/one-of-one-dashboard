---
name: Dashboard design rules
description: Will's taste for the control centre, from five rounds of feedback (30 Sep and 1 Oct 2026): fun and visual, dials not lists, red only for real failures, decisions are decisions, buttons that act, styled on his reference (purple gradient edge to edge, glass panels, source logos big and bold behind the dials, glanceable), one period switch with any day or range drives the hero, dark look only with a white logo, a weekly test section with visual results, new reviews flagged in the greeting with the panel above Tests
type: feedback
---

# Dashboard design rules

What Will wants from the One of One control centre, taken from his reactions to mockups 1, 2, 2b, 3 and 4, and the reference screenshot he sent for mockup 4. Apply these before showing him any screen. The current screen is `docs/control-centre-mockup.html`; the concept note is `docs/control-centre.md`.

## What he said

- Mockup 2 (1 Oct): "information overload". Hide most of it behind a click, give him the headlines that matter for a DTC brand run by a solo founder.
- Mockup 2b (1 Oct): "still not appealing to look at, loads of X's and negatives, a long list of stuff". Simplifying had hidden the dials and turned the page into a list. He likes the dials ("concept-wise they're great"), does not mind more of them. Keep the dark theme, but make it fun. A pending Meta pause is "a decision that needs to be made", not a big red X.
- Mockup 3 (1 Oct): he sent a reference screenshot of a sports-player dashboard (deep purple ground, a violet-to-magenta-to-blue gradient, frosted-glass panels, white rounded type, icon-pill nav with search and an avatar, a radar chart with a ghosted big number, coral and white stat tiles, a glass table with translucent rows, Live/Yesterday/Today/Upcoming tabs). "Style it kind of like this. Ignore the massive image. Add the One of One logo. Visually easy to glance at and really easy to read. Meta logos on anything with Meta in it, in the dials and the table, Google logos where needed, clean and not distracting." The reference came from a showcase page, so it does not need the outer border.
- Mockup 4 and 5 (1 Oct): drop orders today and the separate yesterday and today figures; "all of that data should relate to whatever day I've selected" with Today, Yesterday and Last 7 days in a switch at the top. Call it overall ROAS, not net sales per £1 of ads. Add live net margin, "a live estimate based on previous shipping data", and website conversion rate to the top. The Meta and Google logos behind the dials should be "big and bold"; faint corner marks were "kind of there, but kind of not". He wants a test section, "a test a week, ideally", with live results he can see: long v short Meta ad, cart wording, two landing pages.
- Mockup 6 (1 Oct): "I need it to flag when the new review has been posted because I like to go in and either publish it or review it. That should be in the top third of everything." Judge.me reviews had been deferred to the Handover tab in stage 5. Mockup 7 put the panel under the greeting; he then said "Move it to go above the tests panel."
- Mockup 7 (4 Oct): "looks good, one of one logo should be white not black. I should be able to select a date and date range (not just today / yesterday / last 7 days)". Mockup 8 added a 30 days tab and a Dates calendar.
- Mockup 8 (5 Oct): "Only want dark mode (it's not actually dark it's still bright but much nicer looking)". The light theme was removed: one look, whatever the phone's setting.
- The ambition: "a dashboard that I want to run the whole business from every day", half his day in it, built out gradually until he can amend ads, kill ad sets, message Laszlo on WhatsApp and eventually do bits of customer service from it.

## Rules

1. Visual first. Every number that has a bar is a dial or a ring. A stat tile is for numbers without a bar. A list is the last resort, and a long list is never shown; put the tail behind a tap.
2. Red is for real failures only: site or checkout down, stock under its floor, spend running away, tracking broken, a dead feed. On a normal day the page should have zero or one red thing.
3. A choice is a Decide (violet, the accent), not an alarm. Pause a set, accept a budget change, keep or revert a setting, pay for overage: these are cards with buttons, not warnings.
4. Urgent things still get flagged, and go at the top, as cards he can act on, not as rows.
5. Fun means glow, colour, motion that respects reduced-motion, a health score, wins shown next to asks, trading-card styling (foil edges) that fits the brand. It does not mean clutter.
6. Buttons act. After a confirm tap, with a log line and an undo. Never on load, never on a schedule, never without the tap. Kill and step rules stay in `knowledge/meta-ads.md`; the page proposes what the rules say.
7. Dark look only (Will, 5 Oct): the purple gradient whatever the phone's light or dark setting. No light theme and no theme switch. He calls it dark but it reads bright; keep it bright.
8. Every state carries an icon and a word, never colour alone (green against amber fails the colour-blind check for every palette).
9. Headlines in words, numbers behind a tap: why, rule, source and the last seven days on every gauge.
10. The look is his reference: a purple gradient running edge to edge with no frame, frosted-glass panels and tiles, white rounded type, icon-pill navigation, one warm accent (coral) that is never a status colour. Dial arcs sit on a dark well so the status colours keep their contrast on the gradient.
11. Source logos on anything that comes from a source: big and bold in the background of every dial and tile (most of the tile's height, about 30% opacity, the dial well partly transparent so the mark shows through), and a small mark beside each row on the table and in Tests. The number on top stays readable; check it on the phone. Real brand files, used within each company's guidelines, before anything ships; drawn placeholders until then.
12. The One of One logo sits top-left in the header, white (Will, 4 Oct). The file Will supplied on 1 Oct is `docs/assets/one-of-one-logo.png` (black mark, letters knocked out); use that file, recoloured by CSS filter, not a drawn copy.
13. Glanceable beats complete. He reads it on a phone first thing: one screen should say the health score, what is on the table and the hero numbers before any scrolling.
14. One period switch drives every number in the hero: Today, Yesterday, 7 days, 30 days, and Dates for any one day or range (tap one day, or a first and a last day; quick ranges for last 14 days, month to date, last month, year to date). No tile is fixed to one day. Today reads "so far". The eyebrow always names the dates. Name money metrics the way he does: overall ROAS, net margin.
15. A number built on an assumption says so on its sheet (net margin assumes 25% non-ad cost until `knowledge/costs.md` is filled). Never show a sample as if it were measured.
16. Tests are visual: one bar per arm, a "how sure" dial that stays grey until the stopping rule is met, the day against the rule, and a Call button that only wakes at 95% on two mornings. A draw is a result and is shown as one. One test at a time per lane; the queue and rules are in `ops/tests/register.md`.
17. New Judge.me reviews are flagged at the top of Home, a count pill and a line in the greeting, until each is published or hidden. The panel itself sits directly above Tests. Will publishes or reads every one. A new review is a Decide; 1 to 3 stars is a Watch ("Read first", Judge.me link first); never red. Publish is one write, only with his yes, behind the confirm tap and undo. No reviewer names on the page. Plan 7.9 has the detail.

## Why these rules

He is one person reading the page on his phone first thing. A page that reads as a list of faults makes a good day feel bad and hides the one thing that is actually broken. Dials show distance from a bar at a glance, which a row of text cannot. Decisions drawn as alarms made him stop trusting the colour, so the colour had to mean something again.
