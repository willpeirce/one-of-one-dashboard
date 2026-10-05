# One of One Pulse: dashboard plan

Written 30 Sep 2026. It replaces the old `docs/dashboard-brief.md` (removed 30 Sep 2026, still in git history) and the build brief drafted in Will's separate Claude conversation. Design reference: `docs/control-centre-mockup.html` (mockup 7, 1 Oct 2026, sample data only), described in `docs/control-centre.md`. It replaces mockup 1, `docs/dashboard-mockup.html`, which is kept for the record. Build the front end from it; don't redesign it. For the screen (layout, look, the hero, the Tests section, New reviews) the mockup and `docs/control-centre.md` win; for keys, sources, metric definitions and build order this plan wins (section 7).

**For the builder.** The first build is done by Codex (OpenAI's GPT-6 Astra, on Will's OpenAI credits) from the build pack in `docs/dashboard-build-pack/`, run as `docs/dashboard-build.md` says; Claude Code makes every edit after that (Will, 1 Oct 2026). Read sections 1 to 5 before writing code. Build in the order in section 6, one stage at a time, on fixtures: a source runs on labelled sample data until its keys are in Replit Secrets, and a stage is done only when, with its keys in, its numbers match the source. Record build decisions in the dashboard repo's `docs/DECISIONS.md`; if a decision changes this plan, Claude edits this file and refreshes the dashboard repo's `docs/spec/` copy with `scripts/dashboard-seed.sh`. Every change to a live system (a new app, token, user, webhook or DNS record) gets a `log/` entry here in the same session, with how to undo it. When an open item (section 12) blocks you, ask Will one short question; otherwise make the sensible call and note it.

## 1. Keys to create for Replit

The app on Replit can't use Claude's connectors or the keys in Claude's cloud environment. It needs its own. Will creates them one source at a time, in build order; nothing is needed before its stage. Claude can walk him through any of them in a session; Will does the sign-ins and the copying.

Rules for every key:
- It lives in one place: Replit → Secrets. Never in either repo, a chat, an email or a screenshot. Copy it from the source and paste it straight into Replit.
- After adding or changing one, redeploy so the live app picks it up.
- If one is ever exposed: revoke it at the source, make a new one, update Replit, add a `log/` entry.
- Ids that aren't secret (store domain, ad account, customer id, list id) go in the code's config file, not in Secrets.

| Stage | Secret in Replit | What it is | Where it comes from |
|---|---|---|---|
| 0 | `DASHBOARD_SETUP_CODE` | A long phrase you make up. Used only to turn on Face ID or Touch ID sign-in on a new device | Your password manager |
| 1 | `SHOPIFY_CLIENT_ID` | Id of the dashboard's own Shopify app | Shopify Dev Dashboard (1.1) |
| 1 | `SHOPIFY_CLIENT_SECRET` | That app's secret. The app swaps it for a 24-hour token and uses it to check webhooks | Same page |
| 2 | `META_ACCESS_TOKEN` | Read-only Marketing API token (`ads_read`) that never expires | Meta Business Settings → System users (1.2) |
| 3 | `GOOGLE_ADS_CLIENT_ID` | The app's OAuth client | Google Cloud console, in the project Claude's Google Ads access already uses (1.3) |
| 3 | `GOOGLE_ADS_CLIENT_SECRET` | That client's secret | Same place |
| 3 | `GOOGLE_ADS_REFRESH_TOKEN` | The app's login, made with a Google account that has Read only access to Google Ads | Google's OAuth Playground (1.3) |
| 4 | `MAILCHIMP_API_KEY` | A second Mailchimp key, for the app only | Mailchimp → Profile → Extras → API keys (1.4) |
| 5 | `GITHUB_HQ_TOKEN` | Read-only access to this repo, so the app can show the files routines write to `ops/` | GitHub fine-grained token (1.5) |
| 5 | `GORGIAS_DOMAIN`, `GORGIAS_EMAIL`, `GORGIAS_API_KEY` | Helpdesk, read | Gorgias → Settings → REST API |
| 1 | `JUDGEME_API_TOKEN` | Reviews, read (plus Publish, only if Will allows it, 7.9) | Judge.me admin → Settings → Integrations (private API token) |
| 5 | `DISCORD_BOT_TOKEN` | Community, read | Discord Developer Portal (1.5) |
| 5 | `UGC_FEED_TOKEN` | Shared secret between the dashboard and the UGC app | A long phrase you make up. The same value goes in the UGC app's Secrets |
| 6 | `ANTHROPIC_API_KEY` | Reads supplier PDFs and photos, sorts review text into issues, answers Ask | console.anthropic.com → API keys (set a monthly spend limit) |

Replit adds `DATABASE_URL` itself. The app makes its own session key and push-notification keys on first start and keeps them in its database.

No longer needed: a Google Ads developer token (Google retired them on 9 Sep 2026), Supermetrics (removed 30 Sep 2026), Twilio (alerts arrive as push notifications), a Gmail key (section 3).

### 1.1 Shopify (stage 1)

Why not a token: in 2026 Shopify stopped stores creating the old admin-made custom apps, the kind that showed a permanent Admin API token once. New apps are made in the Dev Dashboard. The app keeps a client id and secret and swaps them for a token that lasts 24 hours, renewing it itself (Shopify's client credentials grant). This only works because the app and the store belong to the same Shopify organization.

1. Go to dev.shopify.com, signed in as the store owner. Check that the organization shown is the one that owns One of One.
2. Apps → Create app → Start from Dev Dashboard. Name: `One of One Pulse`.
3. In the app's settings, find Protected customer data and request access first, because Shopify says approval can take time: Level 2, meaning the name, email, phone and address fields. Shopify requires Level 2 for any app that runs ShopifyQL reports (sessions, conversion, older sales), even though this app stores none of those fields. The reason to give: reports for our own store; the app stores no names, emails, phone numbers or street addresses.
4. Versions: leave the App URL as it is; set the Webhooks API version to the newest; add these scopes, all read-only: `read_orders, read_all_orders, read_products, read_inventory, read_locations, read_markets, read_reports, read_customers, read_fulfillments, read_assigned_fulfillment_orders, read_merchant_managed_fulfillment_orders, read_third_party_fulfillment_orders`. Select Release.
5. Installs → Install app → the One of One store (`6q0g0j-fv`) → Install.
6. App settings: Client ID into `SHOPIFY_CLIENT_ID`, Client secret into `SHOPIFY_CLIENT_SECRET`.

If `read_all_orders` can't be released without a review, release without it; the build then uses ShopifyQL for anything older than 60 days. If Shopify won't grant Level 2, the build falls back as described in 4.2. Don't reuse the old prototype's app or token.

### 1.2 Meta (stage 2)

1. developers.facebook.com → My Apps. If the One of One business portfolio already owns an app, use it. If not: Create app → use case "Create & manage ads with Marketing API" → connect the One of One business portfolio. It can stay in development mode.
2. business.facebook.com/settings → Users → System users → Add. Name `One of One Pulse`, role Employee, not Admin.
3. Assign assets → Ad accounts → `act_1357158712547002` → View performance only.
4. Generate new token → pick the app → expiry Never → permission `ads_read` only → Generate. Paste it into `META_ACCESS_TOKEN`. If the app isn't offered, add it under Accounts → Apps and assign the system user to it first.

### 1.3 Google Ads (stage 3)

No developer token: Google retired developer tokens on 9 Sep 2026 (Claude's `scripts/gads.mjs` still sends one; Google ignores it). API access now comes from the Google Cloud project that owns the OAuth client. So the app's client goes in the same Cloud project Claude's Google Ads access already uses, which kept its access level. A new project would start on test access and couldn't read the real account.

Read-only: Google Ads has no read-only API permission. The login behind the refresh token decides what the app could do, and the login Claude uses can edit. So the app gets its own login with Read only access.

1. Choose a Google account used for nothing else (a new free Gmail is fine).
2. Google Ads, account 296-704-5072 → Admin → Access and security → + → that address, access level Read only. Accept the invitation from that account. If only Laszlo can add users, Claude drafts a short note for you to send him.
3. Google Cloud console, signed in with the Google account you used to set up Claude's Google Ads access → the project that access uses. Its number is the digits at the start of the existing client id, which is in Claude's cloud environment settings (`GOOGLE_ADS_CLIENT_ID`) and on the MacBook in `~/code/gads-mcp/ads-adc.json`. Google Auth Platform → Audience: Publishing status must read In production. If it reads Testing, publish it, then have Claude make a fresh refresh token for its own access too: tokens made while a project is in Testing stop working after 7 days even after it is published.
4. Google Auth Platform → Clients → Create client → Web application, name `One of One Pulse`, Authorized redirect URIs `https://developers.google.com/oauthplayground`. Client ID into `GOOGLE_ADS_CLIENT_ID`, Client secret into `GOOGLE_ADS_CLIENT_SECRET`.
5. In a private browser window open developers.google.com/oauthplayground → gear icon → tick "Use your own OAuth credentials" → paste both. Step 1: type the scope `https://www.googleapis.com/auth/adwords` → Authorize APIs → sign in as the read-only account. If Google says the app isn't verified: Advanced → continue (it's your own app). Step 2: Exchange authorization code for tokens → copy the refresh token into `GOOGLE_ADS_REFRESH_TOKEN`. Close the window.

Don't copy Claude's Google Ads values into Replit instead: that login can edit Google Ads, which breaks the read-only rule, and revoking it would stop Claude's daily check and the app at the same time.

### 1.4 Mailchimp (stage 4)

Mailchimp → profile icon → Profile → Extras → API keys → Create A Key, label `One of One Pulse`. Copy it straight into `MAILCHIMP_API_KEY`; Mailchimp shows it only once. It ends in `-us2`. Mailchimp keys can't be limited to reading, so the app only sends GET requests, enforced in code. It is separate from Claude's key so either can be revoked on its own.

### 1.5 Later keys (stages 5 and 6)

- GitHub: Settings → Developer settings → Fine-grained tokens → Generate new token. Owner willpeirce, only the `one-of-one-hq` repository, Contents: Read-only, the longest expiry offered. Put the expiry date in the dashboard's Settings; it warns two weeks before.
- Discord: discord.com/developers → New Application `One of One Pulse` → Bot → Reset Token → copy into `DISCORD_BOT_TOKEN`. Turn on Server Members Intent and Message Content Intent. OAuth2 → URL Generator → scope `bot`, permissions View Channels and Read Message History → open the link and add the bot to the server.
- Gorgias: the key of a read-only user if you have one; otherwise yours, and the app only reads.
- Anthropic: set a monthly spend limit when you make the key.

## 2. Where things live

| Place | Holds | Who edits |
|---|---|---|
| `willpeirce/one-of-one-hq` (this repo) | Rules, `STATUS.md`, `knowledge/`, the change log for live systems (`log/`), routine output (`ops/`), this plan | Claude sessions and Will |
| `willpeirce/one-of-one-dashboard` (HQ setup step 9) | Dashboard code only. GitHub is the source of truth; `main` is what runs | Codex for the first build, then Claude Code; by pull request only |
| Replit | Hosting: a Reserved VM (always on), PostgreSQL, Secrets | Nobody edits code here |

- Two builders, one after the other. Codex (GPT-6 Astra) writes the first build; Claude Code makes every edit after it. Both work only through pull requests. Replit's AI agent never edits the code, and nobody edits code in Replit. If Replit's Git pane ever shows local changes, discard them before pulling.
- A change goes live like this: the builder works on a branch and opens a pull request → Claude checks it against this plan when Will asks → Will merges it (the GitHub phone app is fine) → in Replit, Git pane → Pull → Redeploy. Replit doesn't redeploy by itself when GitHub changes.
- Codex sees only the dashboard repo, holds no secrets, and works from the copy of this plan and the mockup in that repo's `docs/spec/`. Claude build sessions are cloud sessions with both repos attached. Business facts stay here; the dashboard repo keeps only the ids it needs, in one config file. The dashboard repo's own git history is the record of its changes; changes to other live systems are logged here.

## 3. Two kinds of access

| | Claude sessions (building, analysis, daily checks) | The app on Replit |
|---|---|---|
| Shopify | Connector | Its own Dev Dashboard app (1.1) |
| Meta Ads | Connector | System user token, `ads_read` (1.2) |
| Google Ads | REST API v25, GAQL, customer 2967045072, through `scripts/gads.mjs`. Read-only, no third party | The same REST approach with its own read-only login (1.3) |
| Mailchimp | API at `us2.api.mailchimp.com/3.0`, key held in Claude's cloud environment | Its own key (1.4) |
| Gmail, Drive | Connectors | None |

The app holds keys only for data it needs live. Anything a Claude routine already reads, and that can be a few hours old, reaches the app as a dated file the routine writes to `ops/` here; the app reads it with `GITHUB_HQ_TOKEN`. First the daily ads check (`ops/ads-daily/`), later Waiting on others (`ops/waiting-on/`, from Gmail), so no Gmail key sits on Replit. Customer data never passes through this repo: helpdesk, reviews and community are read by the app directly.

GitHub can't limit a token to one folder, so `GITHUB_HQ_TOKEN` can read all of this repo: business notes, but no keys and no customer data. If Will would rather Replit couldn't, the routines write their dashboard files to a small separate repo and the token covers only that (open item 12).

Supermetrics was removed on 30 Sep 2026; nothing uses it. GA4 is dropped too: Shopify's own session data covers the funnel and US regions.

## 4. Facts the dashboard must handle

### 4.1 Time
- The dashboard's day is the UK day; the Shopify store runs on UK time. Today is partial and labelled "so far".
- Google Ads is fixed on GMT. While the UK is on BST (until 25 Oct 2026, and again from 28 Mar 2027) a Google Ads day runs 01:00 to 01:00 UK time. Pull Google Ads by hour (`segments.date`, `segments.hour`), convert each hour to UK time and re-bucket into UK days. Use time-zone conversion, never a hard-coded date. Google rows carry a note: "hours re-aligned to UK time".
- Meta: read the ad account's `timezone_name` on first run. If it isn't Europe/London, re-bucket with Meta's hourly breakdown the same way.

### 4.2 Shopify
- **Webhooks.** The old Replit prototype's order webhook pointed at a Replit dev URL, which sleeps. The endpoint kept failing and Shopify deleted the subscription at 11:41 UTC on 22 Sep 2026. The new app:
  - subscribes by API to its published address (`https://pulse.oneofonehq.com/...`), never a dev URL;
  - checks each webhook's HMAC signature with `SHOPIFY_CLIENT_SECRET`, stores the raw payload, then processes it, so it can be replayed;
  - checks every hour that its subscriptions exist, re-creates any that are missing, and raises a Needs you item when it had to;
  - polls orders updated in the last 10 minutes, every 5 minutes, so data keeps flowing without webhooks;
  - reconciles the last 7 days every night.
- **Session country tagging** broke from 22:00 UTC on 22 Sep to 19:00 UTC on 23 Sep 2026: sessions were filed under United States / Missouri, Shopify's fallback when it can't place a visitor. Checked again on 30 Sep: it has stayed fixed. Missouri sessions were 0 to 16 a day on every day from 19 to 30 Sep except 23 Sep (228), and UK sessions were 122 on 23 Sep against 189 to 651 on the other days.
  - Treat that window as unknown for sessions and conversion by market (by day, 22 and 23 Sep): show "no data" with a note. Orders by market are unaffected.
  - Guard: if Missouri is more than 10% of US sessions on any day, mark that day's conversion by market as unreliable and raise a Needs you item.
- **ShopifyQL needs Level 2 access** (1.1, step 3). If Shopify won't grant it, sessions and conversion come from a Claude routine that runs the same ShopifyQL through Claude's Shopify connector and writes a daily file to `ops/`, so conversion becomes daily rather than live; and history older than 60 days needs `read_all_orders`.
- **Privacy.** Store no customer names, emails, phone numbers or street addresses, and never ask for them in a query. From the shipping address ask only for country, state or region and postcode, and keep only the first half of the postcode (for the market split and fulfilment zones). Without address access, market comes from the order's currency and the warehouse that ships it.
- Stock comes from Shopify, which James & James keeps in sync (it matched ControlPort on 26 Sep 2026; ControlPort has no API).
- TikTok Shop's duplicate products: count their orders, ignore their stock, never modify them.
- Starter and Ultimate are bundles. Read the tier mix from the products on the order, not from components.
- Exclude phantom traffic to `/pages/inside` (desktop, spoofed Google referrer, never adds to cart) from session counts.

### 4.3 Meta
- **Two owners.** Ours (Will's, run by Claude) and the freelancer's. Owner comes from a campaign-id map seeded from `knowledge/meta-ads.md` (ids in section 13). A new campaign shows as Unassigned, with a Needs you item, until its owner is set in Settings. Ours is the default view; the freelancer's is shown separately, never blended in silently. Ours, freelancer and unassigned add up to the account total.
- **Over-credit.** Meta credits itself with roughly 20 to 40% more purchases than really happen. Every Meta figure sits beside Shopify's: "Meta says 31 purchases · Shopify saw 24 orders from Meta ads". Shopify's side is orders whose last visit carries `fbclid` or a Meta `utm_source`; settle the exact values from the first 30 days of orders and record them in DECISIONS. Show the measured ratio over a rolling 14 days. Cost per order always uses Shopify orders.
- **Break-even cost per purchase:** UK £18.56, US £22.70. Targets at 85%: UK £15.78, US £19.30. These are Settings with those defaults. Above break-even is red, between target and break-even amber, under target green.
- Market of Meta spend, as the daily ads check defines it (`ops/ads-daily/ROUTINE.md`): every set in WT3 US and in the freelancer's two TOF-US campaigns is US; every set in WT4 UK and TOF-UK is UK; in Hudson and the reads campaigns the market is in the set's name ("UK" or "US"). A set that fits none falls back to its target countries and raises a Needs you item.
- Per-owner Shopify orders need campaign-level UTMs on the ads. Check in stage 2. Without them, per-owner orders show Meta's count scaled by the measured ratio, labelled "estimated".
- Spike days, as the ads check defines them: UK 24th to 26th of the month; US 1st and 15th; both markets the last two days of the month. Mark them on the orders chart and beside any window that includes them; single days there mislead.

### 4.4 Google Ads
- Four campaigns have been enabled since about 14:00 UK on 30 Sep 2026: Branded Search UK and PMax xLM UK v2, plus Branded Search - US V2 (£25/day) and PMax - xLM US v2 (tROAS 1.7, £50/day). The US pair was switched on that day by someone other than Claude and is not yet confirmed with Will or Laszlo. Daily budget £165.
- Split Google spend by the campaign's market: "UK" or "US" in its name, else its location targets. Never count all Google spend as UK.
- The expected campaigns and their markets are a Setting, seeded from "What serves" in `knowledge/google-ads.md`, the list the ads check compares against. Any other campaign that spends raises a Needs you item until Will adds it. So does an enabled Performance Max campaign not on Maximise conversion value with a target ROAS.
- Laszlo (freelancer) manages the account. The app is read-only three ways: its login has Read only access (1.3); it only calls `googleAds:search` and `googleAds:searchStream`; the repo has no code that could change anything.
- Show Google's conversions beside Shopify orders whose last visit carries `gclid` or Google paid UTMs.
- Junk check in the spend detail: spend by network, flagged as the ads check does (ROUTINE.md check 13). Display/Content above 0.5% of spend (what `scripts/gads.mjs --junk` marks) or over £1 in a day; YouTube, Gmail and Discover together at 2.5% or more of 7-day spend. Normal is about 0% and about 2%.
- Settings changes come from `change_event`, which needs a bounded date range.
- Daily limit: if the Cloud project is on Explorer access, it allows 2,880 operations a day on real accounts, shared with Claude's checks. Keep the app under 300: today and yesterday by hour every 30 minutes, the network split every 3 hours, changes every hour.
- Google's figures can lag by about 3 hours; the card shows its freshness.

### 4.5 Mailchimp
- **Two views, both labelled.** Shopify's view: orders whose last visit has `utm_medium = email`, in pounds. Mailchimp's view: its own count, which runs higher, with revenue in dollars. Where Mailchimp lists Shopify order ids, show those orders' amounts in pounds.
- **UK and US splits** inside Mailchimp are unreliable, because its address filter can't see country. Combine the UK and US versions of each flow; show the versions only in the detail, with the caveat. When a "US" customer tag lands in Shopify Flow, the US rows fill with no code change.
- **Email clicks** show in Shopify as `utm_medium = email` from 27 Sep 2026. Count email orders by UTM, never by `order_referrer_source` (it ignores UTMs). Before 27 Sep show "partial", not zero.
- **Flow-level stats.** Mailchimp's public API has no reporting for automation flows: that section of the API (formerly Customer Journeys) only offers the API trigger (checked 30 Sep 2026). Until now flow stats were read from Mailchimp's internal pages in a signed-in browser, which the app can't use. Stage 4 starts with a probe and records the result in DECISIONS:
  1. Find each live flow email's current campaign id. The part of a `utm_campaign` value before the hyphen is only a hint: copied emails inherited older ids, and `abandoned_cart_email_1` and `welcome_email` carry none. Try `GET /3.0/campaigns` and match by subject; otherwise a Claude session reads the ids from Mailchimp and adds them to section 13.
  2. `GET /3.0/reports/{id}` and `GET /3.0/campaigns/{id}` for each of those ids.
  3. `GET /3.0/ecommerce/orders?campaign_id={id}` for Mailchimp-credited orders with Shopify ids. Ask only for the fields needed (`fields=` order id, campaign id, total, currency, date), so no customer email or address ever arrives.
  4. `GET /3.0/lists/e07ea4488f` for audience counts.

  If 2 and 3 don't cover flow emails, the Email card shows Shopify's view (the truer count anyway) and the audience numbers, and says Mailchimp's per-flow figures aren't available by API. Anything that needs sends then changes: "Early" means the first 4 weeks after a flow's first send instead of the first 300 sends, and the refill funnel starts at "clicked".
- **Abandoned cart (3327).** Mailchimp's order credit is inflated: the flow was emailing people who had already bought. Purchase checks went in at 10:15 UTC on 30 Sep, but email 1 can still reach a buyer because Mailchimp often gets orders hours late. Note it on that row.
- **Gift pop-up (3354),** live since 30 Sep 2026: include it in the Email card, counted by UTM only. The code `SLABPACK` is no email signal, because the site's pop-up applies it for every claimed visitor with a kit in the cart. Email 3 uses `gift_popup_email_3_brand_story`. Before the card goes live, a Claude session reads the values on emails 1 and 2 and checks that neither inherited another email's value (copied Mailchimp emails keep the original's `utm_campaign`), which would mix pop-up orders into Welcome or D30 refill.
- **Audience against plan.** The plan covers 5,000 contacts and the audience was 5,151 on 30 Sep. Mailchimp bills on the 12th. Raise a Needs you item when the audience is over the limit in the 7 days before.
- Start dates: Abandoned cart email 1 and Welcome carry UTMs from 27 Sep 2026; D1 US has entries from 27 Sep; the D30 refill email first sent on 25 Sep.
- GET only: the Mailchimp client in the code has no other method.

### 4.6 Workflow side
- The daily ads check is live: cloud routine "Daily ads check" (`trig_01LFiRte1YZznwEkM8JDT7P1`), 07:37 UK every day, report-only. It follows `ops/ads-daily/ROUTINE.md` and appends its entry to `ops/ads-daily/YYYY-MM.md`, pushed to `main`. The app reads that file as it is; nothing in the routine changes for the dashboard.
- The file: one per month, named for the month of the day reported on (on the 1st, yesterday's entry is in the previous month's file). Newest entry at the bottom; a re-run is a new entry below the first. Each entry starts with a heading such as `## 2026-09-29 (Tue), run 30 Sep 17:50` or `## 2026-09-29 (Tue), re-run 30 Sep 18:30`, then a `**Needs Will:**` line with its numbered items straight after it, then the sections `### UK`, `### US`, `### Google`, `### Shop`, `### Account changes`, `### WhatsApp drafts`, `### Watch tomorrow` and `### Run notes`.
- Parsing: split the file on `^## (\d{4}-\d{2}-\d{2}) \((\w{3})\), (run|re-run) (.+)$`. The entry for yesterday's UK date is today's report; when there are several, the last one wins.
- Status: ok only when the text after `**Needs Will:**` is just "nothing" (any case, quotes and a full stop allowed); "nothing new" later in a line doesn't count. Otherwise take the count from the start of that text ("9 items.", which may be followed by more) and the numbered lines straight after it (`1. ...`), stopping at the first line that isn't one. Strip `**` first. An item's label is the text before its first colon when that is up to about three words ("Kill breach", "Soft breach", "Google"); otherwise the whole line shows. A line that starts "same 9 items as the 17:50 entry above" points back: show that entry's items.
- The Handover tab shows it as the first card: date, status, count and the items; tap for the whole entry, with a link to the file on GitHub. If there is no entry for yesterday by 09:00 UK, the card says so. If the entry can't be read, the card shows its first lines, says "couldn't read" and trips the Ads check watchdog (section 9).
- If `main` refuses the routine's push, it pushes to branch `claude/ads-daily` instead and merges that branch back on its next run. When `main` has no entry for yesterday, the app checks that branch too.
- Later, optional: the routine could also report when `https://pulse.oneofonehq.com/health` is down. That needs a line in ROUTINE.md, which drives a live routine, so only with Will's yes.

## 5. Metric definitions

All money in pounds (Shopify's shop currency).

- **Revenue:** Shopify net sales: gross minus discounts minus refunds, excluding shipping charged and tax.
- **Orders:** paid orders across the store and TikTok Shop, excluding cancelled and test orders. Split UK, US, EU and TikTok Shop.
- **Orders a day:** orders ÷ days in the range.
- **AOV:** revenue ÷ orders.
- **Contribution per order (before ads):** what the customer paid for items and shipping after discounts and refunds, minus VAT on UK and EU orders, minus COGS (the landed cost in force when the order was placed), minus the fulfilment cost for that parcel (J&J pick, pack, packaging and postage), minus payment fees.
- **Net profit:** contribution minus ad spend minus overheads (monthly figure ÷ 30.4 × days). **Net margin:** net profit ÷ revenue.
- **Net margin, live estimate** (hero, from mockup 6): (revenue − landed cost − fulfilment per parcel from the last month's shipping invoices − payment fees − discounts − all ad spend) ÷ revenue, for the selected period, today included, before overheads. Ad spend is real; the other costs come from `knowledge/costs.md` until the J&J model (8.2) replaces them. Until the costs table is filled, mockup 6 assumes them at 25% of revenue (1 − 1 ÷ overall ROAS − 25%) and the tile's sheet says so. No bar until the costs are real.
- **Cost per order:** all ad spend ÷ Shopify orders. Per market: that market's Meta spend (4.3) plus its Google spend by campaign market (4.4), ÷ its orders. Never platform-claimed orders; those sit beside Shopify's in the detail.
- **Blended Meta cost per order** (the daily ads check's tripwire): all Meta spend in a market (ours plus the freelancer's, every ad set that spent, live or not) ÷ Shopify orders in that market. Tripwire £28, a Setting. The ads check's "net sales per £1 of ads" is overall ROAS.
- **Break-even cost per order:** Will's figures, UK £18.56 and US £22.70, drawn as the lines. Blended break-even weights them by the period's order mix (EU at the UK figure). The model's own figure (contribution per order) is shown in the detail as a cross-check.
- **Overall ROAS** (Will's name, 1 Oct 2026; the same number is often called MER): revenue ÷ all ad spend (Meta, TikTok, Google), shown as 1.55×. **Break-even overall ROAS:** AOV ÷ contribution per order. Platform ROAS (Meta's or Google's own claim) is a different number and is labelled with its source.
- **Upgrade rate:** orders containing Starter, Ultimate or Duo ÷ kit orders.
- **Creative hit rate** (ours by default): ads created in the last 30 days that became winners ÷ ads created. Winner: cost per purchase under target after £100 spend. Killed: over 1.5 × target after £75. Otherwise testing. Target: 7 new ads a week.
- **Checkout completion:** paid ÷ checkouts started, by market. Funnel: sessions → cart → checkout → paid, from Shopify's session data.
- **Website conversion rate:** orders ÷ sessions for the selected period, from Shopify's session data, store-wide on the hero and by market in the detail.
- **Baseline demand:** orders whose last visit has no paid signal (no `fbclid`, `gclid` or `ttclid`; `utm_medium` not cpc, paid or paid_social) ÷ orders, split into email, organic search, organic social and direct.
- **Email orders:** last visit `utm_medium = email`, grouped by flow with the UTM map (section 13). Assisted = first visit. Discount codes as backup: `SHIPPINGONME` (Day 1), `REFILLSHIP` (refill). Not `SLABPACK`, which the site applies itself (4.5).
- **Refill orders:** orders containing SKU `REFILL`; credited to the email when the last-visit campaign is a refill email or the code is `REFILLSHIP`.
- **Email revenue per 1,000 sent:** Shopify email revenue for a flow ÷ Mailchimp sends × 1,000 (needs sends from the probe).
- **Reachable by email:** the period's buyers with marketing consent ÷ buyers.
- **Refund rate:** refunds ÷ revenue, rolling 7 days.
- **Days of cover:** available stock ÷ daily rate for that SKU at that warehouse (last 60 days, times the seasonal multiplier in Settings). Series 1 kits are not being restocked, so kits show a run-out date only. Accessories are sized as attach rate × kits remaining (Will's method, `knowledge/stock-and-supply.md`), not off a daily rate.
- **Goal maths** (net profit detail), at 100 orders a day and 20% net: revenue R = 100 × AOV; net needed N = 0.2 R; ads allowed A = 100 × contribution − overheads a day − N; cost per order needed = A ÷ 100; overall ROAS at goal = R ÷ A. Recalculated live.
- **Compare:** one day → Yesterday (same time of day if it's today), Last <weekday>, Last year. A range → Prior 7d or Prior 30d, Last year. Short labels on the button, full ones in the menu.
- **Changes** show in the metric's own unit: % for orders, revenue and spend; £ for profit, cost per order and AOV; points for margin, conversion and upgrade rate; a plain number for overall ROAS. Never a percentage of a negative number. Colour means good or bad for the business; ad spend is neutral grey.

## 6. Build stages

Order: foundations, then Shopify, Meta, Google Ads and Mailchimp (every other number is judged against real orders), then the workflow side, costs and planning, alerts and Ask. Each stage ends with its checks passing and a handoff: the builder updates the dashboard repo's `docs/BUILD-STATUS.md`, and Claude copies the state into `STATUS.md` here.

### Stage 0: foundations
- Will: create the private repo `one-of-one-dashboard` and give the Claude GitHub App access to it (HQ setup step 9), then connect Codex to that repo only, with no secrets (`docs/dashboard-build.md`). A Claude session seeds it with the build pack. Once stage 0 is merged, in Replit: Import from GitHub, giving Replit access to that one repo only (if Replit offers its Agent to set things up, decline); add PostgreSQL; publish as a Reserved VM; link the dashboard's address (add the records Replit shows wherever oneofonehq.com's DNS is managed); add `DASHBOARD_SETUP_CODE`.
- The address used throughout this plan, `pulse.oneofonehq.com`, was a working name. Decided by Will on 2 Oct (open item 5): the dashboard starts on Replit's own `*.replit.app` address, so no DNS is needed now, and later moves to a kindarare.com subdomain. Read `pulse.oneofonehq.com` in this plan as "the dashboard's address". A passkey belongs to one address, so the move means updating `APP_ORIGIN` in Replit Secrets and enrolling the phone again (about 2 minutes), plus a `log/` entry.
- Builder (Codex for the first build, in two parts, 0a and 0b):
  - One Node 24 + TypeScript service with PostgreSQL. `.replit` holds the run, build and deployment settings so Replit needs no setup. A `replit.md` tells Replit's agent (which reads that file) not to change anything. Check which database the published app uses and note it in DECISIONS.
  - GitHub Actions on every pull request: typecheck, tests, and a secret scan (gitleaks or similar) that fails on anything that looks like a key.
  - The front end ported from `docs/control-centre-mockup.html` (mockup 7), on sample data under a "sample data" banner, so Will can use it on his phone from the start.
  - Passkey sign-in (Face ID, Touch ID). The setup code adds a device; attempts are rate-limited; sessions last 30 days.
  - `/health` (no data in the reply), live updates over Server-Sent Events, the source health table, Settings, an audit log.
  - `AGENTS.md` (the rules in section 10 for any builder), `CLAUDE.md`, `replit.md`, `docs/DECISIONS.md` and `docs/BUILD-STATUS.md` arrive with the build pack; keep the last two current.
- Done when: Will opens pulse.oneofonehq.com on his phone, signs in with Face ID, adds it to his home screen and sees the mockup on sample data.

### Stage 1: Shopify
- Keys: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `JUDGEME_API_TOKEN`. From Will, in Settings: overheads a month, starting COGS per SKU, the payment fee rate, and a flat fulfilment cost per warehouse until the first J&J upload.
- Build:
  - Token manager: fetch a token, renew it at 20 hours, retry with backoff.
  - Backfill: 400 days of orders if `read_all_orders` was granted; otherwise 60 days, plus ShopifyQL daily totals for older dates.
  - Webhooks as in 4.2 (orders created, updated and cancelled; refunds; fulfilments created and updated; inventory levels), with the 5-minute poll, the hourly subscription check and the nightly reconcile.
  - ShopifyQL every 5 minutes for today's sessions and funnel, with the geo guard (or the routine's daily file if Level 2 is refused, 4.2).
  - Cards: the scoreboard (orders, revenue, AOV, conversion, upgrade rate; net profit and margin with costs labelled "estimated" until uploads), orders by day, checkout, stock and cover, Refill Pack and Email (Shopify side).
  - Watchdogs: orders flowing, US add to cart, checkout, dispatch, refunds, webhooks, geo, self-check.
  - New reviews panel (7.9), moved up from stage 5 on Will's ask (1 Oct): Judge.me only needs its own key, and new reviews are something he acts on every day.
  - Clean-up: find the old prototype's Shopify app. With Will's yes, uninstall it and log it, since it may still hold a permanent token.
- Done when: three chosen days match Shopify's own reports for orders and net sales exactly; a test review left on the store shows in New reviews within 5 minutes and leaves it once published or hidden in Judge.me; a real order shows on the page within 10 seconds; a removed webhook subscription comes back within the hour with a Needs you item; 22 and 23 Sep show as unknown for conversion by market.

### Stage 2: Meta
- Key: `META_ACCESS_TOKEN`.
- Build: insights every 15 minutes (today by hour, history by day, a 400-day backfill as a background job); campaigns, ad sets and ads with created dates and target countries; the owner map; account activity for budget changes; the time-zone check (4.1).
- Cards: Ad spend (ours, freelancer, unassigned), cost per order and overall ROAS with break-even lines, Meta beside Shopify (4.3), the creative line and its detail, the Meta risk rules.
- Done when: three days of spend match Ads Manager to the penny; ours plus freelancer plus unassigned equals the account; the Meta-to-Shopify ratio shows for 14 days.

### Stage 3: Google Ads
- Keys: the three `GOOGLE_ADS_*` secrets.
- Build: the hourly pull and UK-day re-bucketing (4.1); campaigns with bidding and budget; the network split; change events; conversions beside Shopify; the read-only guard and the operation budget (4.4).
- Done when: 7-day spend matches Google Ads to the penny; summing the hours by GMT day reproduces Google's daily figures; a campaign outside the expected list (4.4) raises a Needs you item (tested on sample data).

### Stage 4: Mailchimp
- Key: `MAILCHIMP_API_KEY`.
- Build: the probe (4.5) and the gift pop-up UTM check first, with results in DECISIONS. Then the Email card with both views, the Refill funnel (waiting in the flow, sent, opened, clicked, ordered, as far as the probe allows) and the audience against the plan.
- Done when: one email's figures match Mailchimp's report page, or DECISIONS records that the API can't supply them; both views are labelled; periods before 27 Sep say "partial".

### Stage 5: workflow side (Handover tab)
- Keys: `GITHUB_HQ_TOKEN` first; Gorgias, Discord and `UGC_FEED_TOKEN` as each card starts.
- Build, in this order:
  1. The Ads check card from `ops/ads-daily/` (4.6).
  2. Customer service: open Gorgias tickets tagged `ai_handover`, polled every 2 minutes.
  3. New reviews: moved to stage 1 and Home (7.9).
  4. The UGC tab (7.4). Needs the UGC app's code on GitHub so Claude Code can add embed mode, the theme and the replies-owed feed.
  5. Community, from the Discord bot.
  6. Waiting on others: a new Claude routine (smallest model, daily, built the way the ads routine was: `RemoteTrigger` from a local session, a prompt that only says to read an instructions file on `main`, every write tool on `disallowed_tools`; see `knowledge/hq-system.md`) reads Gmail sent items for the contacts in 8.6 and writes `ops/waiting-on/latest.md`; the card reads it. Will can add and clear items by hand.
- Done when: every item links to the exact ticket, review, message or conversation, and the counts match the source apps.

### Stage 6: costs, uploads, planning
- Key: `ANTHROPIC_API_KEY`, for reading PDFs and photos and sorting review text into issues (Ask uses it too, in stage 7). CSV and XLSX files parse without it.
- Build: the J&J weekly upload and fulfilment model, supplier order and invoice import with landed cost, the reorder planner, issues (section 8).
- Done when: a J&J upload reconciles a week and reports its error; a Rising Games confirmation and a Penny invoice import with Penny's markers split out as kit components.

### Stage 7: alerts and Ask
- Build: push notifications to the installed app (watchdog trips and recoveries, the Monday upload prompt, an optional 08:00 summary that starts switched off); Ask (7.5).
- Done when: a watchdog fires on simulated silence and the alert reaches the phone; Will has used the dashboard for three days without asking what a number means.

### Later
Google Merchant Center disapprovals, TikTok Shop (gift stock, affiliate sales), Search Console branded search, a post-purchase survey, year-on-year with real data, automatic redeploys, the sister brand Kinda Rare (build with a brand field from day one).

## 7. Screens

The screen is mockup 7, `docs/control-centre-mockup.html`, described in `docs/control-centre.md` (sections: Home with the hero and the score column, On the table, Tests, Dials, Log). The card content in 7.2 to 7.4 still applies, arranged as that file says; what the mockup defers is listed there under "Deferred from the plan". The notes below were written against mockup 1.

Order, grid and styling as in the mockup. Each card has glance content, a detail sheet (a bottom sheet on phones, a centred dialog on desktop) and links out to the exact place in the source app.

Where the mockup and this plan differ, the plan wins. The mockup predates these changes:
- Its sources table ("What feeds this") lists Supermetrics, GA4, Gmail and Merchant Center. Use section 3 instead: sessions and the funnel come from Shopify, and Gmail only reaches the app through the Waiting-on routine's file.
- Its watchdog sheet and pill include Merchant Center (now Later) and say checks "text you". Use the checks in section 9 and push notifications.
- Its budget-change item checks Gmail for a note from the freelancer. The app only reads the change logs; the daily ads check covers messages.
- Its cost-per-order targets are placeholders (£25 UK, £32 US). Use break-even £18.56 and £22.70, targets £15.78 and £19.30.
- New since the mockup: the Ads check card at the top of Handover, the owner split and Meta beside Shopify on Ad spend, the Gift pop-up row and the two labelled views on Email.

Principles, shown on the page and kept true:
1. Two goals up top; everything else explains the gap.
2. Tap for the detail. The front page stays short.
3. Green stays quiet. Healthy checks collapse into one pill; only a tripped check is named.
4. Hard caps: ten numbers up top, five risks, three opportunities. Dismiss one and the next comes up.
5. Every item links out to where Will deals with it.
6. Weekly for ads, monthly for margin. The hero opens on Today, and every hero number follows the period switch (Today, Yesterday, 7 days, 30 days, and Dates for any one day or range; Will, 1 and 4 Oct 2026). Ad verdicts still read 7 days whatever the period.
7. Ask instead of digging.
8. Nothing changes silently. The app reads from every source and writes only to its own database. Uploads are shown line by line and confirmed before they save.

### 7.1 Header and controls
- One header row on every width: the wordmark ("Pulse" hidden on phones), the watchdog pill, and on tablet and desktop the tabs: Business, Handover (badge: items waiting on Will), UGC (badge: replies owed).
- Phones (under 760px): a bottom tab bar instead (Business, Handover, UGC, Ask) with the same badges, clear of the home indicator. The floating Ask button is desktop only.
- Controls row: a date menu (Today, Yesterday, Last 7 days, Last 30 days, Pick a day or dates; the same date twice is one day) and a compare menu. Hidden on Handover.
- Period switch on the hero (mockup 8, Will 4 Oct): Today, Yesterday, 7 days and 30 days as tabs, then a Dates button (calendar icon; the word is hidden on phones) that opens a calendar: tap one day, or a first and a last day for a range, then Show. Quick ranges: last 14 days, month to date, last month, year to date. A day or range that matches a tab selects that tab. One month on a phone as a bottom sheet, two side by side from 641px. The eyebrow names the dates and the period ("8–20 Sep · 13 days"); the net sales bars are daily up to 31 days and weekly beyond. No future days. It drives every hero number: net sales, orders, conversion rate, ad spend, UK and US cost per order, overall ROAS and the net margin estimate. Today reads "so far" with the same time yesterday beside it.
- Watchdog pill: passing checks out of all checks, "9/9" when all is well, "⚠ 8/9" when one trips (desktop adds its name). Tap opens the list.

### 7.2 Business tab
1. **Scoreboard.** One card, ten numbers, one tap each, all visible on a 390 × 844 phone without scrolling. A slab-label strip names the period ("LAST 7 DAYS") and the goal ("GOAL 100 A DAY · 20% NET").
   - Two larger goal cells with progress bars: Orders a day (sub-line "122 orders · 17 of 100"; for today "so far · on pace for 19") and Net margin ("44 pts short of 20%").
   - Eight cells, each with label, change pill, value and one sub-line: Revenue (a day), Net profit (after ads and overheads; sub-line "after ads £X"), Ad spend (a day), overall ROAS (break-even), Cost per order (blended break-even, section 5), Average order (contribution per order), Conversion (UK and US), Upgrade rate (Starter or above).
   - Layout: phones 2 columns; tablets 4; desktop the goals stacked in a wider first column and the eight metrics in a 4 × 2 block, each with a sparkline. Hairline dividers, no nested cards. Below desktop width the labels shorten (Orders/day, Margin, CPA, AOV, CVR, Upgrades).
   - Footer: last updated (live) and days to Black Friday.
2. **Orders by day.** Stacked daily bars by store (UK, US, TikTok Shop, EU), legend totals, tooltips, days outside the range faded, spike days marked (4.3).
3. **Needs you.** Up to 5 risks, worst first, each with source, action, link and dismiss (rules in section 9).
4. **Opportunities.** Up to 3, each with a number, action, link and dismiss. Rules: an ad of ours whose Shopify-adjusted cost per order is 40%+ under the account's, with 10+ orders in 7 days; a series selling faster than planned; a UK–US conversion gap over 0.5 points; orders just under the free-shipping threshold; a drop in upgrade rate; buyer email opt-in under 50%.
5. **Email.** Follows the range. Top: email orders and revenue (Shopify, last visit), email share of revenue, reachable by email. One row per live flow with UK and US combined (Abandoned cart, Welcome, Day 1 add-ons, D30 refill, Gift pop-up): sent, click rate, orders (Shopify), orders (Mailchimp), revenue per 1,000 sent. A flow under 300 sends shows "Early" (or by date, 4.5). Detail: every email in the UTM map with both views side by side, the caveats in 4.5, links to Mailchimp.
6. **Refill Pack.** Orders since launch (11 Sep 2026) and in the period, by source (D30 email, site, other), the D30 funnel, stock. "Early: judge after 300 sends" until the D30 email passes 300 sends (or by date, 4.5).
7. **Checkout.** UK against US completion, with the gap. Detail: the full funnel and US by state.
8. **Ad spend.** Total against the compare period, by platform and owner, Meta beside Shopify, any 20%+ move in amber, and the creative line ("6 new ads this week, target 7 · 12% hit rate"). Detail: the table, budget changes, the Google junk check.
9. **Stock and pop report.** Labels claimed per series (source still open, section 12) and days of cover for kits, gift slabs and slab packs per warehouse. Detail: every SKU, rates, cover, sell-out date at the current and the Q4 pace.
10. **Fulfilment costs.** Average UK and US parcel cost, last week's estimate error, last upload, an Upload button. Detail: the upload box, how the model works, what changed after the last upload, recent parcels estimated against actual.
11. **Issues.** Issues per 100 orders, count, prior month, a table by reason.
12. **Reorder planner.** Per SKU per warehouse: order by, quantity, cover, on hand, on order, supplier. Cash committed and next payment. An Upload button.
13. **What feeds this.** The rules, and the sources with live health.

### 7.3 Handover tab
A summary line (waiting on Will, overdue, counts), then:
1. **Ads check** from `ops/ads-daily/` (4.6).
2. **Customer service:** open Gorgias tickets tagged `ai_handover`, oldest first: wait time, customer (first name and initial), channel, a quote, suggested action, link to the ticket. Footer: tickets this week, closed without Will, median first reply.
3. **Creator replies due:** the UGC app's Reply owed items with channel, wait, due flag, quote and the rule that applies (from Settings: £200 cap per asset, 3 months' usage minimum, push price before extending usage, never accept the opening offer, 50% on brief and 50% on delivery, offer to create their link, never the word affiliate). An item opens the UGC tab at that conversation.
4. **New reviews:** not here any more. They sit on Home, flagged in the greeting (7.9); the summary line counts them.
5. **Community:** Discord messages since the last visit and per day, new members, the busiest channel, unanswered questions with links.
6. **Waiting on others:** oldest first, contact, a short subject, days outstanding, and a Nudge link that opens a drafted follow-up.

### 7.4 UGC tab
Will's existing UGC app runs inside this tab, opening on Reply owed and restyled to match. It is not rebuilt.
- Dashboard side: one full-height frame loading `https://creators.oneofonehq.com/<reply-owed path>?embed=1` (address to confirm, section 12), with deep links as `&conversation=<id>`. The tab's badge counts replies owed: the app posts it with `postMessage` (check the sender's origin) and the replies-owed feed backs it up. If the app doesn't load, show a card saying so with a link to open it in a new tab. A "Full app" link sits in the tab's top line.
- UGC app side, a small job in that app's code:
  - embed mode (`?embed=1`) hides its own header and outer navigation and keeps its internal tabs as a slim row;
  - in embed mode it loads `https://pulse.oneofonehq.com/theme.css` (the dashboard's design tokens as CSS variables; the dashboard has one look, dark only) and maps its styles onto them;
  - it opens on Reply owed and supports `conversation=<id>`;
  - it allows framing only from the dashboard (`Content-Security-Policy: frame-ancestors https://pulse.oneofonehq.com`, no blocking `X-Frame-Options`);
  - it posts the count and the open conversation to the parent window;
  - it exposes `GET /api/replies-owed`, guarded by `UGC_FEED_TOKEN`.
- Sign-in inside the frame: both apps are on oneofonehq.com subdomains, so they are the same site and the UGC app's login cookie (Secure, SameSite=Lax) works in the frame on iPhone Safari. Will signs in to the UGC app once inside the tab.

### 7.5 Ask
A text box with four example questions. Every answer names its source. Read-only: it queries through a read-only database role or calls the same functions the cards use; no writes, no schema changes, no outside calls except to the model. Every question and answer is logged. It uses the smallest Claude model that answers well; Will picks.

### 7.6 Dismiss
Dismissing a risk or opportunity hides it (stored on the server, per item) until the signal behind it changes band or 7 days pass. The footer shows the count, Show, Restore all, and Undo for the last one.

### 7.7 Settings
Goal; overheads a month; break-even and target cost per purchase for the UK and US; payment fee rate; starting COGS per SKU; flat fulfilment cost until uploads; dispatch cut-off per warehouse; lead times per supplier; safety weeks; seasonal multiplier; markers and pencils per kit; the Meta owner map; the expected Google campaigns and their markets; the £28 blended Meta cost per order tripwire; the creator negotiation rules (7.3); the contacts list for Waiting on; deadlines; key expiry dates; the 08:00 summary on or off; brand.

### 7.8 Tests
Will's ask (1 Oct 2026): a test section, ideally one new test a week, with live results he can see. Mockup 6 draws it; the rules live in `ops/tests/register.md`, which the section reads through `GITHUB_HQ_TOKEN` like `ops/ads-daily/`.
- One card per live test: the question, arm A against arm B as bars on the test's one metric, a how-sure dial that stays grey until the stopping rule is met, days run and days left, and the bar written before the start.
- Stopping rule (from the register): at least 7 full days including a weekend and 30 of the counted event per arm; recomputed only at 07:37; "Call A" or "Call B" only at two-sided 95% on two mornings in a row, the last not a spike day; day 28 with no call is a draw, shown as a result. Before/after switches are capped at Leaning.
- One test at a time per lane (site, ads). Queue and history below the live cards.
- Where the numbers come from: site tests from Shopify orders carrying an order attribute written by the theme split (`__gift_test` today); Meta creative tests from two ad sets with one ad each, via Meta insights; before/after tests from the same series either side of the switch date.
- The app is read-only, so a verdict is written by a session or a routine: the register row, a `log/` entry for any live change, and the rule into `knowledge/` with an Evidence line. The mockup's Call button stands for that: it wakes only when the rule is met, asks for a confirm tap and keeps undo until the session writes it.
- Build: after stage 2 (needs Shopify orders and Meta insights). Until then the register is the record, read and updated in a session.

### 7.9 New reviews
Will's ask (1 Oct 2026): "I need it to flag when the new review has been posted because I like to go in and either publish it or review it. That should be in the top third of everything." Then, on seeing mockup 7: "Move it to go above the tests panel." Mockup 7 draws it.
- Place: the flag is in the greeting at the top of Home, a count pill ("3 new reviews", tap scrolls to the panel) and a line ("Three new reviews to check."). The panel itself sits directly above Tests, after On the table, on every width. With none waiting, the chip reads "All caught up" and the rows go.
- Which reviews: every review Judge.me holds that is neither published nor hidden. 1 to 3 stars first, then newest first. A row leaves when the review is published or hidden, here or in Judge.me.
- Row: stars, product, market, "verified buyer" when Judge.me says so, photo count, the first two lines of the text, age, buttons. No reviewer name, stricter than section 10's first name and initial. Tap the text for a sheet with the full text, posted time, product, market and the review id.
- States: a new review is a Decide (violet). 1 to 3 stars is a Watch, "Read first", with Read in Judge.me as the main button. Never red: a bad review is a decision, not a failure. Reviews do not move the health score or the radar.
- Buttons: Open (the review in Judge.me) always. Publish only if Will allows that one write: confirm tap, a line in today's log and a `log/` entry, undo hides it again. Without his yes, rows show Open only.
- Source (from the Judge.me API docs as indexed elsewhere; judge.me itself was blocked from the cloud session, so check against judge.me/api/docs before building): webhook `review/created`, plus `review/published`, `review/unpublished` and `review/updated` to clear rows, with a 5-minute poll of `GET /api/v1/reviews` as the backstop. Publish and hide are a `PUT /api/v1/reviews/{id}` with `curated` set to `ok` or `spam`. The API cannot edit review text.
- Later, once alerts exist (stage 7): a phone push for a new 1 to 3 star review, if Will wants it.

## 8. Uploads and self-correcting models

### 8.1 Confirm before save
Every upload is parsed and shown back line by line: supplier or carrier, date, order number, items, quantity, unit cost, destination, landing date, classification. Will edits or confirms. Nothing saves before he confirms. Personal columns (names, street address lines, emails, phone numbers) are dropped as the file is read, and the cleaned file is what's kept.

### 8.2 J&J parcel export, weekly
- Prompt: Monday 09:00, a push notification and a Needs you item "Upload last week's J&J export" until that week's file is in.
- Parse: order number, ship date, warehouse, destination (country, state or region, first half of the postcode), service, weight, SKUs and quantities, charges (pick, pack, packaging, postage, surcharges). Column mapping comes from the sample file (section 12). Rows without an order number are listed for Will.
- Reconcile: each parcel is matched to its Shopify order; the estimate is replaced by the actual and the order's contribution recomputed. History becomes exact for every invoiced parcel.
- Learn: rebuild the rate table keyed by warehouse, destination zone, service and SKU mix (mean, count, last seen). Report the week's mean absolute error and the three biggest rate changes. Raise Needs you items for a new surcharge, a parcel sent from the wrong warehouse for its destination, a cost more than 25% off its rate, or an unknown service.
- Estimate new orders: an exact match uses that rate; otherwise the zone average for that warehouse and service plus the per-SKU increment learned across the table, marked as a guess. Target: 95% of parcels within £0.50 after four uploads.

### 8.3 Supplier orders and invoices, whenever Will orders
- Suppliers:
  - Helen Du, Rising Games (Hong Kong): labels, tuck boxes, cards and assembly, so finished kits and packs. 35 days from e-proof approval. We supply the slabs.
  - Hedy: plastic slabs, usually shipped within 48 hours; components of the Rising Games packs they go into.
  - Penny Zhou, Shanghai Joan: Colour Expansion Packs (finished goods) and the markers that go inside Rising Games' boxes (components). Her orders come through Alibaba chat, so uploads are often screenshots or PDFs.
  - The freight forwarder: air and sea freight, and duty.
- Each line is classified: finished goods (on-order stock for a SKU and warehouse, with a landing date), component (added to the landed cost of what it goes into, at the per-kit count in Settings), or freight (spread across the units on that shipment, per warehouse).
- Landed cost per SKU per warehouse updates on confirm and is dated, so each order uses the cost in force when it was placed.
- On-order stock is released when Shopify stock at that warehouse rises by that quantity (± 5%) or Will marks it landed.
- Cash committed: outstanding balances and due dates, shown on the reorder card.

### 8.4 Reorder planner
- Per SKU and warehouse: a run-out date from available stock, stock landing before run-out, and the daily rate at the seasonal multiplier. Order-by = run-out − supplier lead time − safety weeks (default 3). Lead times start from Settings and move to the median of the last three landed orders per supplier. Red if the order-by date is today or past, amber within 14 days.
- Accessories are sized as attach rate × kits remaining, not off a daily rate. The Q4 model is in `knowledge/stock-and-supply.md`.
- Suggestions are supplier-direct splits per warehouse. Never plan J&J transfers between Northampton and Ohio (Will's rule).
- Series 1 kits aren't restocked: kits show a run-out date, not a reorder.

### 8.5 Issues
Taxonomy: scratched slab, missing slab, missing item, wrong item, damaged box, late delivery, lost parcel, QR won't register, markers dried or faulty, other. Sources: Gorgias tags (map the existing ones; adding the taxonomy as tags needs Will's approval) and the text of reviews with 3 stars or fewer (classified by the model, quote kept). One order counts once. A reason that doubles month on month with 3+ cases becomes a Needs you item listing the tickets. Cost of fixes = replacement items at landed cost plus reship fulfilment.

### 8.6 Waiting on others
From the Waiting-on routine's file (stage 5): threads Will started or last replied to, with no reply for 3+ days, with these contacts only: Laszlo, Diego, Helen (Rising Games), Hedy, Jordan (J&J), Nicole and Laura (Springbird), Hermana, HonestCreators, the forwarder. The routine matches them by email address, which lives in the routine's prompt rather than in this repo. Each line holds only the contact, a short subject and the days waiting: no email text, and an order number in place of any customer's name or address. Never threads with customers. Penny is on Alibaba chat, so her items are added by hand. Will can add items and mark them done.

## 9. Watchdogs, risks and alerts

Watchdogs run every minute. A trip sends a push notification and names the check in the pill; recovery sends another.

| Check | Trips when |
|---|---|
| Orders flowing | No paid order for 3 hours, or 2 hours in US daytime (09:00 to 23:00 ET), after comparing with the same hour last week |
| US add to cart | 75 US sessions in a row without a cart (40 in US daytime), phantom traffic excluded |
| Checkout | Checkouts started but none completed for 90 minutes |
| Dispatch | Paid before the warehouse's cut-off (Northampton 16:00 UK time, Ohio 15:00 ET) and still unfulfilled a working day later (bank holidays from a table) |
| Refunds | Refunds over 3% of revenue across a rolling week |
| Shopify webhooks | A subscription is missing (it is re-created) |
| Session geo | Missouri over 10% of US sessions in a day |
| Ads check | No entry for yesterday in `ops/ads-daily/YYYY-MM.md` (or branch `claude/ads-daily`) by 09:00 UK, or the entry can't be read |
| Self-check | A source fails twice running or is stale beyond 3 times its interval (its card goes grey with "last worked at"), or a key is within 14 days of expiry |

Needs you risk rules, kept in one file: stock cover under 60 days amber, under 21 red; TikTok gift stock under 100; slab-pack cover shorter than kit cover at either warehouse; deadlines from Settings within 60 days; a Google campaign outside the expected list (4.4) spending, or an enabled Performance Max campaign off Maximise conversion value with a target ROAS; blended Meta cost per order over £28 in a market; an unassigned Meta campaign; a budget change over 20% on any campaign (the freelancers' are flagged, never touched); the D30 refill email passing 300 sends (or 4 weeks, 4.5) with no refill orders; a live flow with no sends for 3 days (or, without Mailchimp sends, no email sessions), as D1 US had before 27 Sep; the Mailchimp audience over its plan within 7 days of the 12th.

Alerts are push notifications to the dashboard installed on Will's home screen, and each one opens the right sheet. No SMS; add Twilio later only if push proves unreliable.

## 10. Build rules: reliability and security

- Each source has its own worker and health row. One failing source never blocks another; its card shows its last good time.
- External calls have timeouts and 3 retries with backoff, respect rate limits, and log the request id, never the token.
- Ingest is idempotent (upsert on the source's id). Rows carry source, source id, fetched time and brand.
- Read-only by construction. Each source's client exposes only reads: Shopify queries (the only mutations are the app's own webhook subscriptions), Meta GET, Google Ads search, Mailchimp GET, Gorgias and Judge.me GET, Discord read, GitHub read. The one exception, only if Will allows it, is Judge.me Publish (7.9).
- Keys Will creates live only in Replit Secrets. Keys the app makes itself (session signing, push) live in a database table the Ask role can't read. None are ever logged, shown in errors or committed; CI fails on anything that looks like a key.
- No customer names, emails, phone numbers or street addresses are stored. Where a card shows a person (tickets, reviews), it shows first name and initial.
- Ask uses a read-only database role.
- Backups: uploads, Settings, dismissals and the owner map can't be pulled again from a source. Keep the cleaned upload files (8.1) in Replit's file storage and export those tables every night, keeping 30 days.
- Tests: metric functions on fixtures; a Shopify order end to end; watchdogs on synthetic silence; upload parsers on the sample files; dismiss; range and compare maths; Google re-bucketing across 25 Oct.
- A stage is done only when its numbers match the source (section 6).
- Builders: Codex for the first build, then Claude Code. Every change by pull request; nothing is pushed to `main`. Replit's agent is never used on this repo.
- The rules for live systems in HQ's `CLAUDE.md` apply: anything customers can see, and any change to a live system, is shown to Will first and logged here.

## 11. Do not build

- Editing products, orders, ads, budgets, emails or flows. Link out instead.
- Any write to Shopify, Meta, Google Ads, Mailchimp, Gorgias, Judge.me or Discord, beyond the app's own Shopify webhook subscriptions and, if Will allows it, Judge.me Publish (7.9).
- Automatic budget changes. Recommendations only. Changes to the freelancers' campaigns only ever go through a message Will sends.
- Email building or sending.
- A general admin panel. Settings has only the fields in 7.7.

## 12. Open items for Will

1. Overheads per month, starting COGS per SKU, the payment fee rate.
2. One J&J parcel export as a sample.
3. Supplier samples: a Rising Games order confirmation, a Penny invoice or Alibaba order, a Hedy invoice, a forwarder invoice.
4. Markers and pencils per kit, as Penny invoices them.
5. Answered 2 Oct: Replit's own `*.replit.app` address for now, a kindarare.com subdomain later (Will's call). DNS is only needed for the later move, and then for kindarare.com, not oneofonehq.com.
6. The UGC app: confirm it is the one at `creators.oneofonehq.com`, the address of its Reply owed page, and connect its Replit project to GitHub.
7. Stage 5 access: the Gorgias subdomain, the Discord server and which channels to watch.
8. Where "labels claimed" per series comes from.
9. Judge.me (stage 1): the private API token, and whether the app may Publish a review (one write, after a confirm tap, with undo) or only open it in Judge.me.
9. Whether per-owner Meta orders matter enough to ask the freelancer for campaign UTMs on his ads.
10. Shopify's answer on Level 2 customer data access (1.1, step 3). Request it first; it can take time.
11. The 07:37 ads routine is live and the app reads its format as it is (4.6). A dashboard-down line in ROUTINE.md is optional and needs Will's yes.
12. Whether `GITHUB_HQ_TOKEN` may read all of HQ, or the routines should write their dashboard files to a small separate repo (section 3). Default: all of HQ, as planned.

Not a dashboard task: the "US" customer tag in Shopify Flow (see `STATUS.md`, Mailchimp flows). The US rows start filling when it lands.

## 13. Reference

**Shopify.** Store `6q0g0j-fv.myshopify.com`, pounds, UK time; markets UK, US and EU. Locations: Northampton `gid://shopify/Location/106790748494`, Ohio `gid://shopify/Location/106790781262`. Read stock from these products only: ONE OF ONE `10476514214222` (SKU oneofone1), STARTER `10896499933518`, ULTIMATE `10896502063438`, DUO PACK `10476910543182`, SLABS & LABEL PACK `10892913574222` (oneofone-slabs), CERTIFIED SLAB PACK `15948268306766` (oneofone-slab, the free gift), COLOUR EXPANSION PACK `10892898992462` (extracolours), CARDS & HOLO PACK `15823486615886`, THE FRAME `10821987139918`, REFILL PACK `16062800658766` (SKU REFILL, variant `60768719044942`, £29.90 / $39.90). TikTok Shop duplicates, orders only: `10867015647566`, `16069904662862`. Prices: Kit £34.95, Starter £54.95, Duo £59.95, Ultimate £79.95; US Kit $44.95, Ultimate $109.95. Free shipping over £70 in the UK and $100 in the US (flat $14.95 below that). No percentage discounts.

**Meta.** Ad account `act_1357158712547002` (pounds), business `1210322130473958`, pixel `1369046831670193`, page `846882775164156`. Ours: WT3 US `120247907044320430`, WT4 UK `120248123337010430`, Hudson creator `120248974854080430`, IMG-SEP22 concept reads `120249894042810430`. Freelancer: TOF-US Max Conversions `120238023249020430`, TOF-US Cost Cap `120249549236700430`, TOF-UK Max Conversions `120238023249000430`.

**Google Ads.** Customer `2967045072`, manager `4037237507` (no login-customer-id needed), GMT, managed by Laszlo. Enabled since 30 Sep 2026: Branded Search UK, PMax xLM UK v2, Branded Search - US V2 and PMax - xLM US v2 (the US pair switched on that day, not yet confirmed with Will or Laszlo).

**Mailchimp.** Server us2; audience "One of One", list `e07ea4488f`. Live flows: 3327 Abandoned cart, 3329 Welcome ("Newsletter flow"), 3350 D1 UK-ROW, 3349 D1 US, 3351 D30 refill, 3354 Gift pop-up. Paused: 3346 old D1, 3328 Community.

UTM map. Every live email uses `utm_source = One of One` and `utm_medium = email`.

| utm_campaign | Email | Flow |
|---|---|---|
| `abandoned_cart_email_1` | Abandoned cart 1 (tagged from 27 Sep 2026) | Abandoned cart |
| `6c17a9d3f6-EMAIL_CAMPAIGN_2026_08_02_10_11` | Abandoned cart 2 | Abandoned cart |
| `6153376a9e-EMAIL_CAMPAIGN_2026_08_02_10_35` | Abandoned cart 3, UK (nearly everyone gets this one) | Abandoned cart |
| `f46017e8a4-EMAIL_CAMPAIGN_2026_08_02_10_28` | Abandoned cart 3, US | Abandoned cart |
| `welcome_email` | Welcome (tagged from 27 Sep 2026) | Welcome |
| `8a2f36055d-EMAIL_CAMPAIGN_2026_08_06_10_31` | Day 1 add-ons, UK/ROW | Day 1 add-ons |
| `dc19f7a994-EMAIL_CAMPAIGN_2026_08_06_10_23` | Day 1 add-ons, US | Day 1 add-ons |
| `4750ad5e7b-EMAIL_CAMPAIGN_2026_09_11_10_52` | D30 Refill, UK (sent to nearly everyone) | D30 refill |
| `2d21d80c04-EMAIL_CAMPAIGN_2026_09_11_06_45` | D30 Refill, US | D30 refill |
| `gift_popup_email_3_brand_story` | Gift pop-up 3, brand story from Will | Gift pop-up |
| to read (4.5) | Gift pop-up 1 and 2 | Gift pop-up |

Ignore `1b5a69388e-FZBVY_DBZCBVTA_5359_31_39_43_64` (a test), the paused Community flow and the one-off campaigns (none sent since 5 Apr 2026).

Shopify queries known to work (validated 27 Sep 2026):

```
FROM sessions SHOW sessions, sessions_that_completed_checkout
WHERE utm_medium = 'email' GROUP BY utm_campaign SINCE -30d UNTIL today ORDER BY sessions DESC
```

```graphql
query EmailAttributedOrders($after: String) {
  orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: "created_at:>=2026-09-27") {
    nodes {
      name createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 20) { nodes { sku title quantity } }
      customerJourneySummary {
        firstVisit { utmParameters { source medium campaign } }
        lastVisit  { utmParameters { source medium campaign } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Sanity numbers for the first Mailchimp pull (Mailchimp's own, lifetime to 26–27 Sep 2026, bot-filtered, dollars): Abandoned cart 1 about 668 sent, 27 orders, $1,866; Welcome 1,227 sent, 23 orders, $1,400; D1 UK-ROW 266 sent, 4 orders, $143; D30 refill 19 sent, 0 orders; all email about $5,585 from 88 orders.

**James & James (J&J).** Northampton, UK (contact Jordan; 16:00 dispatch cut-off, set by DPD) and Grove City, Ohio (orders before 15:00 ET leave the same day). UK last mile DPD and Royal Mail Tracked 48; US Ground Advantage.

**Dates.** Black Friday 27 Nov 2026 (window 23–28 Nov). UK clocks go back on 25 Oct 2026 and forward on 28 Mar 2027.

**Company.** One of One Trading Cards Ltd, Companies House 16146772. Sister brand Kinda Rare.
