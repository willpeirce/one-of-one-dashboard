import type { DashboardSnapshot, DialModel } from './dashboard-types.js';
import type { Settings } from './settings.js';

/**
 * Server-only presentation fixtures ported from docs/spec/mockup.html. These are
 * invented display examples, not recorded source responses or API clients.
 * Models, copy and stable binding ids match dashboard-template.ts; keep that
 * template's refresh instructions when updating the source mockup.
 */
const fixture: Omit<DashboardSnapshot, 'generatedAt' | 'sourceHealth'> = {
  "schemaVersion": 1,
  "mode": "sample",
  "brand": "one-of-one",
  "asOf": "2026-09-30T06:41:00.000Z",
  "hero": {
    "today": {
      "eyebrow": "Wed 30 Sep · today so far",
      "sub1": "6 orders so far, 4 by this time yesterday.",
      "per": "today so far",
      "net": {
        "n": 296,
        "state": "sofar",
        "d": {
          "why": "£296 net sales so far today from 6 orders, UK 2 and US 4. 4 orders by this time yesterday.",
          "rule": "No judgement on a part day. The tile reads So far until midnight UK, then it is judged against the 7-day average: green at or above it, amber under 85%. Red is never used here: a quiet day is not a failure.",
          "src": "Shopify Analytics, net sales, UK and US markets, 30 Sep 00:00 UK to now",
          "hist": [
            1640,
            1710,
            1980,
            1820,
            2310,
            1760,
            2099
          ],
          "hp": "£"
        },
        "ss": "6 orders · 7-day avg £1,903 a day",
        "pre": "£",
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "orders": {
        "n": 6,
        "state": "sofar",
        "d": {
          "why": "6 orders so far today, 4 by this time yesterday. Last order 23 minutes ago: US, 2 kits.",
          "rule": "No judgement on a part day. From midnight UK: green at or above the 7-day average of 38, amber under 85% of it.",
          "src": "Shopify orders, paid, both markets, today so far",
          "hist": [
            35,
            36,
            40,
            37,
            46,
            32,
            43
          ]
        },
        "ss": "UK 2 · US 4 · 4 by this time yesterday",
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "cr": {
        "n": 3.2,
        "state": "sofar",
        "d": {
          "why": "6 orders from 188 sessions so far today, 3.2%. The 7-day average is 3.8%.",
          "rule": "No judgement on a part day. From midnight UK: green at or above the 7-day average, amber under 85% of it. Sessions count every visit, so a big ad day lowers the rate before it lifts orders.",
          "src": "Shopify Analytics, orders ÷ sessions, both markets, today so far",
          "hist": [
            3.7,
            3.8,
            3.9,
            3.6,
            4.1,
            3.5,
            3.9
          ],
          "hs": "%"
        },
        "ss": "6 of 188 sessions · 7-day avg 3.8%",
        "suf": "%",
        "dp": 1,
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "spend": {
        "n": 174,
        "state": "sofar",
        "d": {
          "why": "£174 so far today: ours £59, Laszlo £101, Google £14. TikTok shows here once the freelancer’s campaign serves.",
          "rule": "Spend has no bar of its own. The budget dial under Ads watches ours against the day plan.",
          "src": "Meta Ads Manager (ours and Laszlo), Google Ads, TikTok once it serves, today so far",
          "hist": [
            1120,
            1170,
            1280,
            1200,
            1370,
            1086,
            1370
          ],
          "hp": "£"
        },
        "ss": "ours £59 · Laszlo £101 · Google £14",
        "pre": "£",
        "mode": "sample",
        "source": [
          "meta",
          "google-ads"
        ]
      },
      "roas": {
        "n": 1.7,
        "state": "info",
        "d": {
          "why": "£296 net sales ÷ £174 ad spend so far today (Meta ours and Laszlo, Google; TikTok once it serves) = 1.70×.",
          "rule": "No bar yet. Break-even ROAS comes from costs.md: 1 ÷ (1 − non-ad cost share). Grey until then.",
          "src": "Shopify net sales ÷ Meta + Google + TikTok spend",
          "hist": [
            1.46,
            1.46,
            1.55,
            1.52,
            1.69,
            1.62,
            1.53
          ],
          "hs": "×"
        },
        "ss": "net sales ÷ all ad spend · set a bar",
        "suf": "×",
        "dp": 2,
        "mode": "sample",
        "source": [
          "shopify",
          "meta",
          "google-ads"
        ]
      },
      "margin": {
        "n": 16,
        "state": "est",
        "d": {
          "why": "Sample only. Assumes landed cost, fulfilment, payment fees and discounts at 25% of net sales until knowledge/costs.md is filled: 1 − £174 ÷ £296 − 25% = 16%. Then: (net sales − landed cost − fulfilment per parcel from last month’s shipping invoices − fees − discounts − all ad spend) ÷ net sales.",
          "rule": "No bar until the costs are real. At 1.53× ROAS yesterday the true number may be near zero.",
          "src": "Shopify net sales and orders, knowledge/costs.md, Meta + Google + TikTok spend",
          "hist": [
            7,
            7,
            10,
            9,
            16,
            13,
            10
          ],
          "hs": "%"
        },
        "ss": "sample estimate · costs model not built",
        "suf": "%",
        "mode": "sample",
        "source": [
          "shopify",
          "meta",
          "google-ads",
          "github-hq"
        ]
      },
      "ukcpo": {
        "v": 24.5,
        "min": 12,
        "max": 40,
        "t": "£24.50",
        "l": "UK Meta cost per order",
        "s": "so far · bar £28",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "£49 of UK Meta spend so far today (ours plus Laszlo) over 2 UK orders. Too few orders to judge.",
          "rule": "No judgement on a part day. From midnight UK: amber from 90% of the £28 blended bar (£25.20), over £28 is a decision.",
          "src": "Meta spend UK ÷ Shopify UK orders, today so far",
          "hist": [
            26.6,
            25.9,
            29.1,
            25.6,
            25.6,
            28.8,
            24.96
          ],
          "hp": "£"
        },
        "cap": "sofar",
        "mode": "sample",
        "source": [
          "shopify",
          "meta"
        ]
      },
      "uscpo": {
        "v": 27.75,
        "min": 12,
        "max": 40,
        "t": "£27.75",
        "l": "US Meta cost per order",
        "s": "so far · bar £28",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "£111 of US Meta spend so far today (ours plus Laszlo) over 4 US orders. Too few orders to judge.",
          "rule": "No judgement on a part day. From midnight UK: amber from 90% of the £28 blended bar (£25.20), over £28 is a decision.",
          "src": "Meta spend US ÷ Shopify US orders, today so far",
          "hist": [
            31.2,
            36.4,
            33.0,
            38.9,
            30.1,
            35.7,
            34.61
          ],
          "hp": "£"
        },
        "cap": "sofar",
        "mode": "sample",
        "source": [
          "shopify",
          "meta"
        ]
      }
    },
    "yday": {
      "eyebrow": "Tue 29 Sep · yesterday, a month-end spike day",
      "sub1": "43 orders yesterday, best Tuesday this month.",
      "per": "yesterday",
      "net": {
        "n": 2099,
        "state": "good",
        "d": {
          "why": "£2,099 net sales, 10% above the 7-day average of £1,903. Spike-day pattern: strong UK morning, US afternoon.",
          "rule": "Green when at or above the 7-day average. Amber under 85% of it. Red is never used here: a quiet day is not a failure.",
          "src": "Shopify Analytics, net sales, UK and US markets, 29 Sep 00:00–23:59 UK",
          "hist": [
            1640,
            1710,
            1980,
            1820,
            2310,
            1760,
            2099
          ],
          "hp": "£"
        },
        "ss": "7 days · avg £1,903 · yesterday +10%",
        "pre": "£",
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "orders": {
        "n": 43,
        "state": "good",
        "d": {
          "why": "43 orders against a 7-day average of 38. UK 27, US 16.",
          "rule": "Green at or above the 7-day average, amber under 85% of it.",
          "src": "Shopify orders, paid, both markets",
          "hist": [
            35,
            36,
            40,
            37,
            46,
            32,
            43
          ]
        },
        "ss": "avg 38 · UK 27 · US 16",
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "cr": {
        "n": 3.9,
        "state": "good",
        "d": {
          "why": "43 orders from 1,105 sessions, 3.9%, against a 7-day average of 3.8%. UK 27 of 480 (5.6%), US 16 of 625 (2.6%).",
          "rule": "Green at or above the 7-day average, amber under 85% of it.",
          "src": "Shopify Analytics, orders ÷ sessions, both markets, 29 Sep",
          "hist": [
            3.7,
            3.8,
            3.9,
            3.6,
            4.1,
            3.5,
            3.9
          ],
          "hs": "%"
        },
        "ss": "43 of 1,105 sessions · UK 5.6% · US 2.6%",
        "suf": "%",
        "dp": 1,
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "spend": {
        "n": 1370,
        "state": "info",
        "d": {
          "why": "£1,370 across Meta and Google yesterday: ours £466, Laszlo £810, Google £94.52.",
          "rule": "Spend has no bar of its own. The budget dial under Ads watches ours against the day plan.",
          "src": "Meta Ads Manager and Google Ads, yesterday",
          "hist": [
            1120,
            1170,
            1280,
            1200,
            1370,
            1086,
            1370
          ],
          "hp": "£"
        },
        "ss": "ours £466 · Laszlo £810 · Google £95",
        "pre": "£",
        "mode": "sample",
        "source": [
          "meta",
          "google-ads"
        ]
      },
      "roas": {
        "n": 1.53,
        "state": "info",
        "d": {
          "why": "£2,099 ÷ £1,370 yesterday = 1.53×. Meta ours £466, Laszlo £810, Google £95.",
          "rule": "No bar yet. Break-even ROAS comes from costs.md: 1 ÷ (1 − non-ad cost share). Grey until then.",
          "src": "Shopify net sales ÷ Meta + Google + TikTok spend",
          "hist": [
            1.46,
            1.46,
            1.55,
            1.52,
            1.69,
            1.62,
            1.53
          ],
          "hs": "×"
        },
        "ss": "net sales ÷ all ad spend · set a bar",
        "suf": "×",
        "dp": 2,
        "mode": "sample",
        "source": [
          "shopify",
          "meta",
          "google-ads"
        ]
      },
      "margin": {
        "n": 10,
        "state": "est",
        "d": {
          "why": "Sample only. Assumes non-ad costs at 25% of net sales until knowledge/costs.md is filled: 1 − £1,370 ÷ £2,099 − 25% = 10%.",
          "rule": "No bar until the costs are real. At 1.53× ROAS the true number may be near zero.",
          "src": "Shopify net sales and orders, knowledge/costs.md, Meta + Google + TikTok spend",
          "hist": [
            7,
            7,
            10,
            9,
            16,
            13,
            10
          ],
          "hs": "%"
        },
        "ss": "sample estimate · costs model not built",
        "suf": "%",
        "mode": "sample",
        "source": [
          "shopify",
          "meta",
          "google-ads",
          "github-hq"
        ]
      },
      "ukcpo": {
        "v": 24.96,
        "min": 12,
        "max": 40,
        "t": "£24.96",
        "l": "UK Meta cost per order",
        "s": "bar £28 · best this week",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "All UK Meta spend (ours plus Laszlo) divided by UK Shopify orders. £24.96 is the lowest of the last 7 days.",
          "rule": "Amber from 90% of the £28 blended bar (£25.20). Over £28 is a decision: cut the weakest UK set that day.",
          "src": "Meta spend UK ÷ Shopify UK orders, yesterday",
          "hist": [
            26.6,
            25.9,
            29.1,
            25.6,
            25.6,
            28.8,
            24.96
          ],
          "hp": "£"
        },
        "mode": "sample",
        "source": [
          "shopify",
          "meta"
        ]
      },
      "uscpo": {
        "v": 34.61,
        "min": 12,
        "max": 40,
        "t": "£34.61",
        "l": "US Meta cost per order",
        "s": "bar £28 · see row 2",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "US blended cost per order has been over the £28 bar on all 7 days. The News article US feed set (7d £43.52 per purchase) is the main cause and has its own row on the table.",
          "rule": "Over £28 is a decision, not an alarm: pick the US set to cut. Red is never used here.",
          "src": "Meta spend US ÷ Shopify US orders, yesterday",
          "hist": [
            31.2,
            36.4,
            33.0,
            38.9,
            30.1,
            35.7,
            34.61
          ],
          "hp": "£"
        },
        "mode": "sample",
        "source": [
          "shopify",
          "meta"
        ]
      }
    },
    "7d": {
      "eyebrow": "23–29 Sep · last 7 days",
      "sub1": "269 orders in the last 7 days, avg 38 a day.",
      "per": "last 7 days",
      "net": {
        "n": 13319,
        "state": "good",
        "d": {
          "why": "£13,319 net sales over 23–29 Sep, £1,903 a day. Up 9% on the previous 7 days (£12,220).",
          "rule": "Green when at or above the previous 7 days, amber under 85% of it.",
          "src": "Shopify Analytics, net sales, UK and US markets, 23–29 Sep",
          "hist": [
            1640,
            1710,
            1980,
            1820,
            2310,
            1760,
            2099
          ],
          "hp": "£"
        },
        "ss": "avg £1,903 a day · prev 7 days £12,220",
        "pre": "£",
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "orders": {
        "n": 269,
        "state": "good",
        "d": {
          "why": "269 orders over 23–29 Sep, 38 a day. UK 169, US 100. Best day Sun 27 Sep with 46.",
          "rule": "Green when at or above the previous 7 days (248), amber under 85% of it.",
          "src": "Shopify orders, paid, both markets, 23–29 Sep",
          "hist": [
            35,
            36,
            40,
            37,
            46,
            32,
            43
          ]
        },
        "ss": "UK 169 · US 100 · prev 7 days 248",
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "cr": {
        "n": 3.8,
        "state": "good",
        "d": {
          "why": "269 orders from 7,120 sessions over 23–29 Sep, 3.8%. UK 169 of 3,440 (4.9%), US 100 of 3,680 (2.7%).",
          "rule": "Green when at or above the previous 7 days, amber under 85% of it.",
          "src": "Shopify Analytics, orders ÷ sessions, both markets, 23–29 Sep",
          "hist": [
            3.7,
            3.8,
            3.9,
            3.6,
            4.1,
            3.5,
            3.9
          ],
          "hs": "%"
        },
        "ss": "269 of 7,120 sessions · UK 4.9% · US 2.7%",
        "suf": "%",
        "dp": 1,
        "mode": "sample",
        "source": [
          "shopify"
        ]
      },
      "spend": {
        "n": 8596,
        "state": "info",
        "d": {
          "why": "£8,596 over 23–29 Sep: Meta £7,931 (ours £3,262, Laszlo £4,669), Google £665.",
          "rule": "Spend has no bar of its own. The budget dial under Ads watches ours against the day plan.",
          "src": "Meta Ads Manager (ours and Laszlo), Google Ads, 23–29 Sep",
          "hist": [
            1120,
            1170,
            1280,
            1200,
            1370,
            1086,
            1370
          ],
          "hp": "£"
        },
        "ss": "ours £3,262 · Laszlo £4,669 · Google £665",
        "pre": "£",
        "mode": "sample",
        "source": [
          "meta",
          "google-ads"
        ]
      },
      "roas": {
        "n": 1.55,
        "state": "info",
        "d": {
          "why": "£13,319 ÷ £8,596 over 23–29 Sep = 1.55×.",
          "rule": "No bar yet. Break-even ROAS comes from costs.md: 1 ÷ (1 − non-ad cost share). Grey until then.",
          "src": "Shopify net sales ÷ Meta + Google + TikTok spend",
          "hist": [
            1.46,
            1.46,
            1.55,
            1.52,
            1.69,
            1.62,
            1.53
          ],
          "hs": "×"
        },
        "ss": "net sales ÷ all ad spend · set a bar",
        "suf": "×",
        "dp": 2,
        "mode": "sample",
        "source": [
          "shopify",
          "meta",
          "google-ads"
        ]
      },
      "margin": {
        "n": 10,
        "state": "est",
        "d": {
          "why": "Sample only. Assumes non-ad costs at 25% of net sales until knowledge/costs.md is filled: 1 − £8,596 ÷ £13,319 − 25% = 10%.",
          "rule": "No bar until the costs are real. At 1.53× ROAS the true number may be near zero.",
          "src": "Shopify net sales and orders, knowledge/costs.md, Meta + Google + TikTok spend",
          "hist": [
            7,
            7,
            10,
            9,
            16,
            13,
            10
          ],
          "hs": "%"
        },
        "ss": "sample estimate · costs model not built",
        "suf": "%",
        "mode": "sample",
        "source": [
          "shopify",
          "meta",
          "google-ads",
          "github-hq"
        ]
      },
      "ukcpo": {
        "v": 26.65,
        "min": 12,
        "max": 40,
        "t": "£26.65",
        "l": "UK Meta cost per order",
        "s": "7-day blend · bar £28",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "UK Meta spend over the 7 days ÷ UK orders: £26.65. Two days were over £28 (25 and 28 Sep).",
          "rule": "Amber from 90% of the £28 blended bar (£25.20). Over £28 is a decision: cut the weakest UK set that day.",
          "src": "Meta spend UK ÷ Shopify UK orders, 23–29 Sep",
          "hist": [
            26.6,
            25.9,
            29.1,
            25.6,
            25.6,
            28.8,
            24.96
          ],
          "hp": "£"
        },
        "mode": "sample",
        "source": [
          "shopify",
          "meta"
        ]
      },
      "uscpo": {
        "v": 34.27,
        "min": 12,
        "max": 40,
        "t": "£34.27",
        "l": "US Meta cost per order",
        "s": "7-day blend · bar £28 · see row 2",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "US Meta spend over the 7 days ÷ US orders: £34.27. All 7 days were over the £28 bar; the News article US feed set is the main cause and has its own row on the table.",
          "rule": "Over £28 is a decision, not an alarm: pick the US set to cut. Red is never used here.",
          "src": "Meta spend US ÷ Shopify US orders, 23–29 Sep",
          "hist": [
            31.2,
            36.4,
            33.0,
            38.9,
            30.1,
            35.7,
            34.61
          ],
          "hp": "£"
        },
        "mode": "sample",
        "source": [
          "shopify",
          "meta"
        ]
      }
    }
  },
  "widgets": {
    "w001": {
      "kind": "dial",
      "source": [
        "meta",
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 24.5,
        "min": 12,
        "max": 40,
        "t": "£24.50",
        "l": "UK Meta cost per order",
        "s": "so far · bar £28",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "£49 of UK Meta spend so far today (ours plus Laszlo) over 2 UK orders. Too few orders to judge.",
          "rule": "No judgement on a part day. From midnight UK: amber from 90% of the £28 blended bar (£25.20), over £28 is a decision.",
          "src": "Meta spend UK ÷ Shopify UK orders, today so far",
          "hist": [
            26.6,
            25.9,
            29.1,
            25.6,
            25.6,
            28.8,
            24.96
          ],
          "hp": "£"
        },
        "cap": "sofar"
      }
    },
    "w002": {
      "kind": "dial",
      "source": [
        "meta",
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 27.75,
        "min": 12,
        "max": 40,
        "t": "£27.75",
        "l": "US Meta cost per order",
        "s": "so far · bar £28",
        "z": [
          [
            12,
            25.2,
            "good"
          ],
          [
            25.2,
            28,
            "warn"
          ],
          [
            28,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "£111 of US Meta spend so far today (ours plus Laszlo) over 4 US orders. Too few orders to judge.",
          "rule": "No judgement on a part day. From midnight UK: amber from 90% of the £28 blended bar (£25.20), over £28 is a decision.",
          "src": "Meta spend US ÷ Shopify US orders, today so far",
          "hist": [
            31.2,
            36.4,
            33.0,
            38.9,
            30.1,
            35.7,
            34.61
          ],
          "hp": "£"
        },
        "cap": "sofar"
      }
    },
    "w003": {
      "kind": "sheet",
      "source": [
        "judgeme"
      ],
      "mode": "sample",
      "value": {
        "state": "warn",
        "title": "2★ review · Duo Pack · US",
        "why": "“One slab in my Duo Pack arrived with a scratch across the front. The labels and the case are great.”",
        "rule": "Sample review. Read-only review integration arrives in stage 1. Publishing is disabled; no review action is built.",
        "src": "Judge.me · posted 07:23 UK · not published yet · sample review, invented for the mockup",
        "extra": [
          [
            "Product",
            "Duo Pack"
          ],
          [
            "Market",
            "US"
          ],
          [
            "Buyer",
            "Verified buyer"
          ],
          [
            "Photos",
            "None"
          ],
          [
            "Ids",
            "review id and order id, never the name"
          ]
        ]
      }
    },
    "w004": {
      "kind": "sheet",
      "source": [
        "judgeme"
      ],
      "mode": "sample",
      "value": {
        "state": "decide",
        "title": "5★ review · Kit · UK",
        "why": "“Made my first slab in ten minutes and it looks like a real graded card. Ordering a refill already.”",
        "rule": "Sample review. Read-only review integration arrives in stage 1. Publishing is disabled; no review action is built.",
        "src": "Judge.me · posted 06:38 UK · not published yet · sample review, invented for the mockup",
        "extra": [
          [
            "Product",
            "Kit"
          ],
          [
            "Market",
            "UK"
          ],
          [
            "Buyer",
            "Verified buyer"
          ],
          [
            "Photos",
            "1 photo"
          ],
          [
            "Ids",
            "review id and order id, never the name"
          ]
        ]
      }
    },
    "w005": {
      "kind": "sheet",
      "source": [
        "judgeme"
      ],
      "mode": "sample",
      "value": {
        "state": "decide",
        "title": "4★ review · Refill pack · UK",
        "why": "“Good value refill. The labels took me a couple of goes to line up, fine after that.”",
        "rule": "Sample review. Read-only review integration arrives in stage 1. Publishing is disabled; no review action is built.",
        "src": "Judge.me · posted 02:10 UK · not published yet · sample review, invented for the mockup",
        "extra": [
          [
            "Product",
            "Refill pack"
          ],
          [
            "Market",
            "UK"
          ],
          [
            "Buyer",
            "Verified buyer"
          ],
          [
            "Photos",
            "None"
          ],
          [
            "Ids",
            "review id and order id, never the name"
          ]
        ]
      }
    },
    "w006": {
      "kind": "test",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "metric": "kit orders",
        "unit": "orders",
        "arms": [
          {
            "k": "A",
            "l": "Free pack added for you",
            "x": 36
          },
          {
            "k": "B",
            "l": "Popup, email unlocks it",
            "x": 29
          }
        ],
        "day": 2,
        "min": 7,
        "max": 28,
        "minx": 30,
        "prev": 58,
        "denom": "assumed 50/50 split, no visitor count yet",
        "strip": [
          "A",
          "A"
        ],
        "note": "B also collected 24 sign-ups",
        "presentation": {
          "sure": 61,
          "state": "info",
          "chipText": "i Too early",
          "say": "A 36 orders, B 29. A is ahead by 24%, but a gap this size happens by chance about 4 times in 10. Too early to call.",
          "small": "Smallest gap this test can see right now: 49% (16 orders). B also collected 24 sign-ups.",
          "progress": "Day 2 · at least 7 days, at most 28 · 30 a side: B needs 1 more · about 8 days to go at this gap",
          "buttonText": "Not built yet",
          "sureZones": [
            [
              0,
              80,
              "info"
            ],
            [
              80,
              95,
              "warn"
            ],
            [
              95,
              100,
              "good"
            ]
          ],
          "sureLabel": "sure · 95 to call",
          "stripLabel": "Leader at each 07:37 sample snapshot",
          "sureCaption": "sample leader at each 07:37 read · needs 95% twice in a row"
        }
      }
    },
    "w007": {
      "kind": "sheet",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "state": "info",
        "title": "Gift popup: free pack vs email popup",
        "why": "Half of visitors get the free slab pack added to the cart automatically (A). The other half see a popup and give an email to unlock it (B). The question is whether gating the gift behind an email beats giving it away: B banks sign-ups, A should convert better.",
        "rule": "Every test runs at least 7 full days including a weekend, and until each arm has 30 of the counted event. Numbers refresh live; the verdict is recomputed only at the 07:37 morning read. Sure needs 95% (two-sided) on two consecutive mornings, the last not a spike day. Day 28 with no call is a draw: no difference bigger than the smallest gap the test can see, keep the simpler or cheaper arm, and the draw goes in the register as a result.",
        "src": "Shopify orders, __gift_test cart attribute (gift-popup-1:A or :B) on every order since #5354; sign-ups by the slab-popup customer tag in Shopify",
        "extra": [
          [
            "Smallest gap it can see",
            "About 49% right now (16 orders between the arms). It shrinks as orders arrive: about 27% by day 7, about 13% by day 28 at today’s pace."
          ],
          [
            "How sure is worked out",
            "Coin-flip test on the order counts: z = (B − A) ÷ √(A + B). 95% sure is z of 1.96 either way. It assumes a 50/50 split of visitors because no per-arm visitor count exists yet; once the theme sends a visitor beacon the test switches to a two-proportion test with a real split check."
          ],
          [
            "Setup",
            "Theme 205345653070 (main) splits visitors 50/50 in the theme and stamps every order. Mailchimp journey 3354 sends the popup emails. Arm stickiness is one week on one device (Safari caps the cookie at 7 days)."
          ],
          [
            "What Call does",
            "Test calls are not built in this stage. The dashboard’s GitHub token is read-only; any register update requires a separate approved workflow."
          ],
          [
            "You decide",
            "End date: proposed 27 Oct, day 28, read at 07:37. Bar: kit orders per arm, 95% two-sided, at least 30 a side. Not yet confirmed."
          ]
        ]
      }
    },
    "w008": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "warn",
        "title": "UK screen set: back on with ads 24 + 33",
        "why": "The UK screen ad set was switched back on at 07:14 this morning at £40 a day with ads 24 and 33 only. It is judged on Sun 4 Oct on cost per purchase over all spend since it came back, against the £18.56 bar. Daily spend flexing up to 175% of budget is Meta’s doing, not a fault.",
        "rule": "A before/after switch, not a split: the comparison is the set’s own last 7 days before the pause. Capped at Leaning; a switch test can never be called Sure.",
        "src": "Meta Ads Manager, ad set 120249858748230430, spend and purchases since 30 Sep 07:14",
        "extra": [
          [
            "Day 1 of 5",
            "Too early for any read. The figure on the Growth dial is the pre-pause comparison until purchases arrive."
          ],
          [
            "Then",
            "Over £18.56: pause again. Under: keep, and consider a step after two more clean days."
          ]
        ]
      }
    },
    "w009": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "decide",
        "title": "Delivery dates: Automated vs Manual",
        "why": "Checkout has been on Automated dates with Same business day fulfilment since 29 Sep 18:10. Automated halves the afternoon gap rather than closing it: DPD was right at 10:31 and 12:21, then a working day late at 14:01 and 14:14. Manual rolled at noon; the real cutoff is 16:00. Nothing was over-promised.",
        "rule": "A before/after switch, capped at Leaning. The call is yours: keep Automated, revert to Manual, or close the last two hours another way.",
        "src": "ops/delivery-trial/trial-log.md and the live checkout",
        "extra": [
          [
            "Next",
            "Two observe-only checks on Thu 1 Oct at 14:30 and 16:15, then an audit against real deliveries from Tue 6 Oct. The row on the table carries Keep and Revert."
          ]
        ]
      }
    },
    "w010": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "decide",
        "title": "Retargeting: does it add orders or only take credit?",
        "why": "New campaign of our own, RT US and RT UK at £10 a day each, shown only to people who visited in the last 7 days or added to cart in the last 14 and have not bought. Retargeting is where Meta over-credits most, because these people were already coming back.",
        "rule": "Kill early at £40 spent with no add-to-cart, or 7-day frequency above 6. Keep at day 14 only if all three hold: 7-day-click cost per purchase at or under the target (UK £15.78, US £19.30); Shopify orders tagged rt-oct are at least half what Meta claims; spend per order in that market is no worse than the 14 days before.",
        "src": "Meta Ads Manager, the two RT ad sets; Shopify orders by last-visit UTM",
        "extra": [
          [
            "Needs",
            "Your yes on the creative pair, £10 a day per country, the start date and 7-day click. Brief: ads/2026-10-meta-retargeting-brief.md"
          ],
          [
            "Dates",
            "Earliest start Mon 5 Oct, after the budget hold. Day 7 is an early look only; day 14, Sun 18 Oct, is the call. The US payday on 15 Oct falls inside it."
          ]
        ]
      }
    },
    "w011": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "info",
        "title": "Long cut vs short cut of the same ad",
        "why": "Two ad sets at £22.50 a day each, same audience and placements, one cut per set. Never two ads in one ad set: Meta starves one of them and the read is void.",
        "rule": "Read on cost per add-to-cart. 30 add-to-carts a side takes about 9 to 10 days at the live cost per add-to-cart. Click-through rate is the early read, marked early; Shopify orders are the final read. Spend per arm must stay within 10% or the read is void.",
        "src": "Meta Ads Manager, the two ad sets; Shopify orders by UTM",
        "extra": [
          [
            "Needs",
            "Both cuts rendered and approved. Runs after the retargeting test (day 14 is Sun 18 Oct), or first if Will picks it: one test at a time in the ads lane."
          ],
          [
            "How sure is worked out",
            "Rate-ratio test on add-to-carts per £: z = ln(rB ÷ rA) ÷ √(1 ÷ kA + 1 ÷ kB), where k is each arm’s add-to-cart count."
          ]
        ]
      }
    },
    "w012": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "info",
        "title": "Cart drawer wording",
        "why": "The cart drawer is theme-owned, so it can be split like the gift popup: half of visitors see the current wording, half the candidate. The Shopify checkout page itself cannot be split on this plan, so checkout wording is a before/after switch, capped at Leaning.",
        "rule": "Waits for the popup test to finish: both tests touch the same cart footer file and one page carries one test at a time.",
        "src": "Shopify orders by arm, cart attribute",
        "extra": [
          [
            "Candidate wording",
            "To be written with you. One change at a time: a line, not a redesign."
          ],
          [
            "Lane",
            "Site lane, after the gift popup test."
          ]
        ]
      }
    },
    "w013": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "info",
        "title": "Bundles page vs kit page as the ad landing page",
        "why": "Bundles are 65% of US orders and 33% of UK. The question is whether sending ad traffic to /pages/bundles beats the kit page.",
        "rule": "Two ad sets, same ad and audience, different landing URL, equal budget. Read on orders per visitor, 30 orders a side. No test straddles Black Friday week (23 to 28 Nov).",
        "src": "Shopify orders by landing page and UTM; Meta spend by ad set",
        "extra": [
          [
            "Lane",
            "Site lane, after cart wording."
          ],
          [
            "No Black Friday straddle",
            "Starts only if it can finish before 23 Nov, else it waits until December."
          ]
        ]
      }
    },
    "w014": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "good",
        "title": "Feed vs Story and Reels placements",
        "why": "Every static concept lost in Story and Reels placements against the same creative in feed.",
        "rule": "New static concepts go feed only.",
        "src": "knowledge/meta-ads.md, log/2026-09.md",
        "extra": [
          [
            "Verdict",
            "Feed wins. Called in September."
          ]
        ]
      }
    },
    "w015": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "info",
        "title": "Were the September kills right?",
        "why": "A post-attribution re-read of the September kills. Only News article US story reached break-even (£23.40 against the £22.70 bar); the rest were right to kill.",
        "rule": "Re-read kills monthly, after attribution has caught up.",
        "src": "knowledge/meta-ads.md, 30 Sep readout",
        "extra": [
          [
            "Verdict",
            "Mixed. One kill looked wrong in hindsight; the rule is the monthly re-read."
          ]
        ]
      }
    },
    "w016": {
      "kind": "sheet",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "state": "good",
        "title": "D1 US flow country condition",
        "why": "The Shopify Flow country condition read the code and matched nothing. Set to the country name “United States”, the D1 US flow got its first 3 entries the same day.",
        "rule": "Use the country name, not the code. A measured before/after, not an A/B.",
        "src": "knowledge/mailchimp-flows.md, 27 Sep",
        "extra": [
          [
            "Verdict",
            "Fixed, 27 Sep."
          ]
        ]
      }
    },
    "w017": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 466,
        "min": 300,
        "max": 700,
        "t": "£466",
        "l": "Our spend vs plan",
        "s": "plan £470",
        "z": [
          [
            300,
            423,
            "warn"
          ],
          [
            423,
            517,
            "good"
          ],
          [
            517,
            564,
            "warn"
          ],
          [
            564,
            700,
            "alarm"
          ]
        ],
        "d": {
          "why": "£466 against a £470 day plan (99%). Green between 90% and 110%, amber to 120%, red above: runaway spend is a real failure.",
          "rule": "Budget band from the day plan. Over 120% of plan is red because it means a set is spending outside its budget.",
          "src": "Meta Ads Manager, our campaigns only, yesterday",
          "hist": [
            520,
            498,
            470,
            455,
            448,
            452,
            466
          ],
          "hp": "£"
        }
      }
    },
    "w018": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 25,
        "min": 0,
        "max": 40,
        "t": "25%",
        "l": "Test share",
        "s": "cap 25%",
        "z": [
          [
            0,
            22.5,
            "good"
          ],
          [
            22.5,
            25.5,
            "warn"
          ],
          [
            25.5,
            40,
            "decide"
          ]
        ],
        "d": {
          "why": "Test sets took 25% of our spend, right at the cap.",
          "rule": "Amber from 22.5%. Over the cap is a decision: trim a test or promote it to WINNER.",
          "src": "Meta, our test sets ÷ our total",
          "hist": [
            22,
            24,
            25,
            25,
            26,
            24,
            25
          ]
        }
      }
    },
    "w019": {
      "kind": "dial",
      "source": [
        "meta",
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 1.41,
        "min": 0.5,
        "max": 3,
        "t": "1.41×",
        "l": "Meta over-credit",
        "s": "vs Shopify orders",
        "z": [
          [
            0.5,
            1.5,
            "good"
          ],
          [
            1.5,
            1.8,
            "warn"
          ],
          [
            1.8,
            3,
            "alarm"
          ]
        ],
        "d": {
          "why": "Meta claimed 1.41 purchases for every real Shopify order. Normal for a 7-day click window.",
          "rule": "Amber over 1.5×, red over 1.8×: the pixel or CAPI is double-counting and every other Meta number is wrong.",
          "src": "Meta purchases ÷ Shopify orders, 7 days",
          "hist": [
            1.38,
            1.44,
            1.4,
            1.47,
            1.39,
            1.43,
            1.41
          ]
        }
      }
    },
    "w020": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 9.8,
        "min": 0,
        "max": 25,
        "t": "£9.80",
        "l": "WINNER ATC · UK",
        "s": "bar £16",
        "z": [
          [
            0,
            14.4,
            "good"
          ],
          [
            14.4,
            25,
            "warn"
          ]
        ],
        "d": {
          "why": "UK WINNER sets cost £9.80 per add-to-cart, well under the £16 bar.",
          "rule": "Amber from 90% of the bar. Over the bar: hold the next step-up.",
          "src": "Meta, 37 Story reply UK feed + 23 Cart free gift UK feed",
          "hist": [
            11.2,
            10.4,
            9.1,
            12.6,
            9.9,
            10.8,
            9.8
          ],
          "hp": "£"
        }
      }
    },
    "w021": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 13.4,
        "min": 0,
        "max": 25,
        "t": "£13.40",
        "l": "WINNER ATC · US",
        "s": "bar £11 · step on hold",
        "z": [
          [
            0,
            9.9,
            "good"
          ],
          [
            9.9,
            25,
            "warn"
          ]
        ],
        "d": {
          "why": "US WINNER set is over the £11 ATC bar and had zero-ATC days on 28 and 29 Sep. The 1-2 Oct step-up is on hold until two clean days.",
          "rule": "Amber over 90% of the bar. This is a hold, not a decision: the rule already says wait.",
          "src": "Meta, 37 Story reply US feed",
          "hist": [
            9.6,
            10.8,
            12.1,
            11.9,
            14.2,
            13.1,
            13.4
          ],
          "hp": "£"
        }
      }
    },
    "w022": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 17.9,
        "min": 8,
        "max": 36,
        "t": "£17.90",
        "l": "Laszlo UK cost",
        "s": "bar £18.56",
        "z": [
          [
            8,
            16.7,
            "good"
          ],
          [
            16.7,
            18.56,
            "warn"
          ],
          [
            18.56,
            36,
            "decide"
          ]
        ],
        "d": {
          "why": "Laszlo’s UK sets at £17.90 per purchase over 7 days, 96% of the £18.56 break-even.",
          "rule": "Amber from 90% of break-even. Over it for 3 days is a decision: message him.",
          "src": "Meta, Laszlo campaigns UK, 7 days",
          "hist": [
            16.4,
            17.1,
            18.2,
            17.6,
            18.9,
            17.3,
            17.9
          ],
          "hp": "£"
        }
      }
    },
    "w023": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 27.4,
        "min": 8,
        "max": 36,
        "t": "£27.40",
        "l": "Laszlo US cost",
        "s": "bar £22.70 · row 4",
        "z": [
          [
            8,
            20.4,
            "good"
          ],
          [
            20.4,
            22.7,
            "warn"
          ],
          [
            22.7,
            36,
            "decide"
          ]
        ],
        "d": {
          "why": "Laszlo’s US sets at £27.40 per purchase over 7 days against £22.70 break-even. Two sets are over £30.",
          "rule": "Over break-even for 3 days is a decision, which is row 4 on the table.",
          "src": "Meta, Laszlo campaigns US, 7 days",
          "hist": [
            23.1,
            24.8,
            26.0,
            28.3,
            29.1,
            27.9,
            27.4
          ],
          "hp": "£"
        }
      }
    },
    "w024": {
      "kind": "dial",
      "source": [
        "google-ads"
      ],
      "mode": "sample",
      "value": {
        "v": 2.3,
        "min": 0,
        "max": 6,
        "t": "2.3%",
        "l": "Google junk share",
        "s": "bar 2.5%",
        "z": [
          [
            0,
            2.25,
            "good"
          ],
          [
            2.25,
            2.5,
            "warn"
          ],
          [
            2.5,
            6,
            "decide"
          ]
        ],
        "d": {
          "why": "YouTube, Gmail and Discover placements took 2.3% of Google spend. Display 0.0%.",
          "rule": "Amber from 2.25%. Over 2.5% is a decision: add the placement exclusions.",
          "src": "Google Ads, cost by network type, yesterday",
          "hist": [
            1.9,
            2.4,
            2.1,
            2.6,
            2.2,
            2.0,
            2.3
          ]
        }
      }
    },
    "w025": {
      "kind": "dial",
      "source": [
        "google-ads"
      ],
      "mode": "sample",
      "value": {
        "v": 105,
        "min": 50,
        "max": 160,
        "t": "105%",
        "l": "Google spend vs plan",
        "s": "£94.52 of £90 · row 3",
        "z": [
          [
            50,
            80,
            "warn"
          ],
          [
            80,
            110,
            "good"
          ],
          [
            110,
            125,
            "warn"
          ],
          [
            125,
            160,
            "decide"
          ]
        ],
        "d": {
          "why": "£94.52 against the £90 agreed. The new £165 budget only applies from today; if Will accepts it on row 3, this dial re-bases.",
          "rule": "Green 80-110% of the agreed budget, amber to 125%, then a decision.",
          "src": "Google Ads spend ÷ agreed daily budget",
          "hist": [
            101,
            98,
            104,
            97,
            103,
            99,
            105
          ]
        }
      }
    },
    "w026": {
      "kind": "dial",
      "source": [
        "google-ads"
      ],
      "mode": "sample",
      "value": {
        "v": 3.08,
        "min": 0,
        "max": 6,
        "t": "3.08",
        "l": "Google ROAS 7d",
        "s": "set a bar",
        "z": [
          [
            0,
            6,
            "info"
          ]
        ],
        "d": {
          "why": "Google conversion value ÷ cost, 7 days. No bar yet: Will has not set a Google ROAS target.",
          "rule": "Grey until a bar is set.",
          "src": "Google Ads, 7 days",
          "hist": [
            2.9,
            3.1,
            3.3,
            2.8,
            3.0,
            3.2,
            3.08
          ]
        }
      }
    },
    "w027": {
      "kind": "detail",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "why": "Every live set is on feed placements. No story-only set is running.",
        "rule": "Any set serving stories only is a decision: switch it to feed.",
        "src": "Meta, placements per live set"
      }
    },
    "w028": {
      "kind": "detail",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample",
      "value": {
        "why": "No changes made to our Meta account by anyone else in the last 24 h. Google: 2 changes by Laszlo (row 3).",
        "rule": "Any change not made by us or logged in HQ is a decision.",
        "src": "Meta activity log, Google change history"
      }
    },
    "w029": {
      "kind": "dial",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 3.23,
        "min": 0,
        "max": 6,
        "t": "3.23%",
        "l": "Conversion · UK",
        "s": "amber under 2.5%",
        "z": [
          [
            0,
            2,
            "decide"
          ],
          [
            2,
            2.5,
            "warn"
          ],
          [
            2.5,
            6,
            "good"
          ]
        ],
        "d": {
          "why": "681 UK sessions, 22 orders from the site. Steady.",
          "rule": "Amber under 2.5%, a decision under 2% (something on the site is broken or the traffic is junk).",
          "src": "Shopify Analytics, UK market, yesterday",
          "hist": [
            2.9,
            3.1,
            3.4,
            3.0,
            3.5,
            2.8,
            3.23
          ]
        }
      }
    },
    "w030": {
      "kind": "dial",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 2.68,
        "min": 0,
        "max": 6,
        "t": "2.68%",
        "l": "Conversion · US",
        "s": "amber under 2.5%",
        "z": [
          [
            0,
            2,
            "decide"
          ],
          [
            2,
            2.5,
            "warn"
          ],
          [
            2.5,
            6,
            "good"
          ]
        ],
        "d": {
          "why": "765 US sessions, 16 orders from the site.",
          "rule": "Amber under 2.5%, a decision under 2%.",
          "src": "Shopify Analytics, US market, yesterday",
          "hist": [
            2.4,
            2.6,
            2.9,
            2.5,
            3.0,
            2.3,
            2.68
          ]
        }
      }
    },
    "w031": {
      "kind": "dial",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 1.2,
        "min": 0,
        "max": 8,
        "t": "1.2%",
        "l": "Refunds 7d",
        "s": "bar 3%",
        "z": [
          [
            0,
            2,
            "good"
          ],
          [
            2,
            3,
            "warn"
          ],
          [
            3,
            8,
            "decide"
          ]
        ],
        "d": {
          "why": "Refunds were 1.2% of net sales over 7 days: one lost DPD parcel.",
          "rule": "Amber from 2%, a decision over 3%.",
          "src": "Shopify refunds ÷ net sales, 7 days",
          "hist": [
            0.8,
            0.8,
            1.1,
            1.1,
            1.4,
            1.2,
            1.2
          ]
        }
      }
    },
    "w032": {
      "kind": "dial",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 412,
        "min": 0,
        "max": 3000,
        "t": "412 ms",
        "l": "Site response",
        "s": "both checkouts ✓",
        "z": [
          [
            0,
            800,
            "good"
          ],
          [
            800,
            1500,
            "warn"
          ],
          [
            1500,
            3000,
            "alarm"
          ]
        ],
        "d": {
          "why": "Homepage answered 200 in 412 ms. UK and US checkouts both completed the test to the payment step.",
          "rule": "Amber over 800 ms. Red over 1.5 s or any non-200: the shop is down, which is one of the few true alarms.",
          "src": "Uptime check every minute",
          "hist": [
            398,
            405,
            420,
            610,
            402,
            399,
            412
          ]
        }
      }
    },
    "w033": {
      "kind": "dial",
      "source": [
        "shopify",
        "meta",
        "google-ads"
      ],
      "mode": "sample",
      "value": {
        "v": 4,
        "min": 0,
        "max": 20,
        "t": "4%",
        "l": "Missouri share",
        "s": "watch bot traffic",
        "z": [
          [
            0,
            3,
            "good"
          ],
          [
            3,
            5,
            "warn"
          ],
          [
            5,
            20,
            "decide"
          ]
        ],
        "d": {
          "why": "4% of US sessions from Missouri, a known bot source. No junk referrers or odd countries today.",
          "rule": "Amber from 3%, a decision over 5%: exclude the region in Meta and Google.",
          "src": "Shopify sessions by region, US, yesterday",
          "hist": [
            2,
            3,
            6,
            4,
            3,
            5,
            4
          ]
        }
      }
    },
    "w034": {
      "kind": "dial",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 31,
        "min": 0,
        "max": 60,
        "t": "31%",
        "l": "Upgrade rate",
        "s": "tier or duo on PDP",
        "z": [
          [
            0,
            60,
            "info"
          ]
        ],
        "d": {
          "why": "31% of kit orders took a higher tier or the duo. No bar set.",
          "rule": "Grey until Will sets a bar.",
          "src": "Shopify orders by variant",
          "hist": [
            28,
            30,
            33,
            29,
            34,
            27,
            31
          ]
        }
      }
    },
    "w035": {
      "kind": "detail",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "Direct and branded traffic share rose 2.1 points week on week.",
        "rule": "Trend only. A rising direct share with flat ad spend is the brand working.",
        "src": "Shopify sessions by channel",
        "hist": [
          22.1,
          22.4,
          22.0,
          23.0,
          23.5,
          24.1,
          24.2
        ]
      }
    },
    "w036": {
      "kind": "detail",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "Last Shopify webhook 23 min ago, matching the last order. Delivery promise at checkout reads Thu 1 Oct, same as the product page.",
        "rule": "Amber if no webhook for 90 min in daytime. Red if the checkout date and the page date differ.",
        "src": "Shopify webhooks, live checkout read"
      }
    },
    "w037": {
      "kind": "detail",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "Refill pack: 0 orders since 11 Sep. The refill flow has sent 19 emails and REFILLSHIP has 0 uses.",
        "rule": "Amber while a live product with a live flow has 0 orders for 14 days. A decision at 28 days.",
        "src": "Shopify orders by product, discount code uses"
      }
    },
    "w038": {
      "kind": "dial",
      "source": [
        "mailchimp"
      ],
      "mode": "sample",
      "value": {
        "v": 103,
        "min": 60,
        "max": 130,
        "t": "103%",
        "l": "Email audience",
        "s": "5,151 of 5,000 · row 5",
        "z": [
          [
            60,
            90,
            "good"
          ],
          [
            90,
            100,
            "warn"
          ],
          [
            100,
            130,
            "decide"
          ]
        ],
        "d": {
          "why": "5,151 contacts on a 5,000 plan. The bill on 12 Oct charges for the overage.",
          "rule": "Amber from 90% of plan. Over plan is a decision: contact blocks or a tier.",
          "src": "Mailchimp audience count",
          "hist": [
            99,
            100,
            100,
            101,
            102,
            103,
            103
          ]
        }
      }
    },
    "w039": {
      "kind": "detail",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "11 orders in 7 days carried a flow UTM: abandoned cart 6, welcome 3, D1 2.",
        "rule": "Trend only. Amber if flow orders fall under half the 4-week average.",
        "src": "Shopify orders with utm_medium=flow",
        "hist": [
          8,
          9,
          12,
          10,
          13,
          9,
          11
        ]
      }
    },
    "w040": {
      "kind": "ring",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 2,
        "max": 28,
        "t": "2/28",
        "l": "Popup test · days",
        "s": "earliest call day 7 · draw day 28",
        "state": "info",
        "d": {
          "why": "Day 2 of the gift popup test. A (free pack added automatically) 36 kit orders, B (email popup) 29. No visitor count per arm yet, so the split is assumed 50/50.",
          "rule": "At least 7 days and 30 orders a side before any call; 95% sure on two mornings to call it; day 28 with no call is a draw.",
          "src": "Shopify orders, __gift_test cart attribute"
        }
      }
    },
    "w041": {
      "kind": "detail",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "A 36 kit orders, B 29, day 2. Too early to call: a gap this size happens by chance about 4 times in 10.",
        "rule": "Read in the Tests section.",
        "src": "Shopify orders by __gift_test arm"
      }
    },
    "w042": {
      "kind": "dial",
      "source": [
        "meta"
      ],
      "mode": "sample",
      "value": {
        "v": 19.7,
        "min": 8,
        "max": 36,
        "t": "£19.70",
        "l": "UK screen test",
        "s": "bar £18.56 · judge 4 Oct",
        "z": [
          [
            8,
            16.7,
            "good"
          ],
          [
            16.7,
            36,
            "warn"
          ]
        ],
        "d": {
          "why": "UK screen set switched back on this morning with ads 24 and 33. The figure is the set’s last 7 days before the pause, as the comparison; the live cost per purchase since 07:14 replaces it as purchases arrive. Judge on Sun 4 Oct on cost per purchase over all spend since 30 Sep.",
          "rule": "Judged on 4 Oct. Amber over 90% of break-even until then; no decision before the date.",
          "src": "Meta, UK screen set, 7 days",
          "hist": [
            24.1,
            22.0,
            20.5,
            21.2,
            19.9,
            20.3,
            19.7
          ],
          "hp": "£"
        }
      }
    },
    "w043": {
      "kind": "detail",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "Abandoned-cart flow 3327 has emailed 0 buyers since the purchase checks went in on 30 Sep. Before: about 1 kit buyer in 5.",
        "rule": "Any buyer emailed by a flow after buying is a decision.",
        "src": "Mailchimp flow report cross-checked with Shopify orders"
      }
    },
    "w044": {
      "kind": "detail",
      "source": [
        "mailchimp"
      ],
      "mode": "sample",
      "value": {
        "why": "D1 UK-ROW flow 3350: 571 entries. D1 US flow 3349: 3 entries since the country fix on 27 Sep.",
        "rule": "Trend only.",
        "src": "Mailchimp flows 3350 and 3349"
      }
    },
    "w045": {
      "kind": "detail",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "why": "Gift popup flow 3354: 10 contacts in flow, 3 buyers removed by hand on 30 Sep. Shopify Flow trigger for existing customers still to build.",
        "rule": "Trend only until the trigger is built.",
        "src": "Mailchimp flow 3354"
      }
    },
    "w046": {
      "kind": "ring",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 74,
        "max": 120,
        "t": "74 d",
        "l": "US kits",
        "s": "3,095 in Ohio",
        "z": [
          [
            0,
            21,
            "alarm"
          ],
          [
            21,
            45,
            "warn"
          ],
          [
            45,
            120,
            "good"
          ]
        ],
        "d": {
          "why": "3,095 kits at the US rate of about 42 a day, with the Q4 ceiling at 2× September.",
          "rule": "Amber under 45 days, red under 21: nothing can be shipped in time.",
          "src": "Shopify inventory, Ohio, ÷ 7-day sales rate"
        }
      }
    },
    "w047": {
      "kind": "ring",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 66,
        "max": 120,
        "t": "66 d",
        "l": "UK kits",
        "s": "3,007 at J&J",
        "z": [
          [
            0,
            21,
            "alarm"
          ],
          [
            21,
            45,
            "warn"
          ],
          [
            45,
            120,
            "good"
          ]
        ],
        "d": {
          "why": "3,007 kits at the UK rate, Q4 ceiling 3× September.",
          "rule": "Amber under 45 days, red under 21.",
          "src": "Shopify inventory, J&J, ÷ 7-day sales rate"
        }
      }
    },
    "w048": {
      "kind": "ring",
      "source": [
        "shopify"
      ],
      "mode": "sample",
      "value": {
        "v": 14,
        "max": 120,
        "t": "14 d",
        "l": "US Slabs & Label",
        "s": "row 1",
        "z": [
          [
            0,
            21,
            "alarm"
          ],
          [
            21,
            45,
            "warn"
          ],
          [
            45,
            120,
            "good"
          ]
        ],
        "d": {
          "why": "US Slabs & Label pack runs dry about 14 Oct. Helen is away until 8 Oct.",
          "rule": "Red under 21 days. This is the only alarm on the page today.",
          "src": "Shopify inventory, Ohio"
        }
      }
    },
    "w049": {
      "kind": "ring",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "v": 47,
        "max": 60,
        "t": "47 d",
        "l": "Black Label lands",
        "s": "16 Nov · 333 sets",
        "state": "info",
        "d": {
          "why": "H-26013 raised to 333 sets (US 233 / UK 100), by air, due 16 Nov.",
          "rule": "Countdown. Amber if Helen’s schedule slips past 20 Nov.",
          "src": "Supplier order H-26013"
        }
      }
    },
    "w050": {
      "kind": "ring",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "v": 54,
        "max": 90,
        "t": "54 d",
        "l": "Black Friday",
        "s": "window opens 23 Nov",
        "state": "info",
        "d": {
          "why": "23-28 Nov window, dedicated Black Label tier. Copy deck written, nothing rendered.",
          "rule": "Countdown.",
          "src": "knowledge/black-friday-2026.md"
        }
      }
    },
    "w051": {
      "kind": "ring",
      "source": [
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "v": 8,
        "max": 30,
        "t": "8 d",
        "l": "Helen back",
        "s": "8 Oct · 3 items waiting",
        "state": "info",
        "d": {
          "why": "Helen is away 1-7 Oct. Waiting: price and schedule for the Black Label air, slab address, the 1,000 label numbers.",
          "rule": "Countdown.",
          "src": "Supplier notes"
        }
      }
    },
    "w052": {
      "kind": "detail",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "why": "Penny colour order rerouted to the US: 300 by air.",
        "rule": "Trend only.",
        "src": "Supplier notes"
      }
    },
    "w053": {
      "kind": "detail",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample",
      "value": {
        "why": "Hedy dispatch before the 1-7 Oct holiday not yet confirmed.",
        "rule": "Grey until confirmed.",
        "src": "Supplier notes"
      }
    }
  },
  "textValues": {
    "t0001": {
      "value": "296",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0002": {
      "value": "1640,1710,1980,1820,2310,1760,2099",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0003": {
      "value": "6",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0004": {
      "value": "3.2",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0005": {
      "value": "174",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0006": {
      "value": "1.70",
      "source": [
        "shopify",
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0007": {
      "value": "16",
      "source": [
        "shopify",
        "meta",
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0008": {
      "value": "Snooze to 8 Oct · Not built yet",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0009": {
      "value": "Snooze to 8 Oct · Not built yet",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0010": {
      "value": "Accept £165 · Not built yet",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0011": {
      "value": "Accept £165 · Not built yet",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0012": {
      "value": "Wait for 3 Oct · Not built yet",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0013": {
      "value": "Wait for 3 Oct · Not built yet",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0014": {
      "value": "2",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0015": {
      "value": "5",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0016": {
      "value": "4",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0017": {
      "value": "Ready in about 8 days · Not built yet",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0018": {
      "value": "Ready in about 8 days · Not built yet",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0019": {
      "value": "Step +25% on 3 Oct · Not built yet",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0020": {
      "value": "Step +25% on 3 Oct · Not built yet",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0021": {
      "value": "Home",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0022": {
      "value": "On the table",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0023": {
      "value": "Tests",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0024": {
      "value": "Dials",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0025": {
      "value": "Log",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0026": {
      "value": "Wed 30 Sep · 07:41 UK · 02:41 ET",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0027": {
      "value": "W",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0028": {
      "value": "Sample data · invented examples from 30 September 2026. No live source data is shown.",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0029": {
      "value": "Today",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0030": {
      "value": "Yesterday",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0031": {
      "value": "Last 7 days",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0032": {
      "value": "Wed 30 Sep · today so far",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0033": {
      "value": "Morning, Will.",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0034": {
      "value": "6 orders so far, 4 by this time yesterday.",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0035": {
      "value": " One alarm and five decisions are on the table.",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0036": {
      "value": "Net sales · ",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0037": {
      "value": "today so far",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0038": {
      "value": "£296",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0039": {
      "value": "6 orders · 7-day avg £1,903 a day",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0040": {
      "value": "Orders · ",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0041": {
      "value": "today so far",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0042": {
      "value": "6",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0043": {
      "value": "UK 2 · US 4 · 4 by this time yesterday",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0044": {
      "value": "Conversion rate · ",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0045": {
      "value": "today so far",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0046": {
      "value": "3.2%",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0047": {
      "value": "6 of 188 sessions · 7-day avg 3.8%",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0048": {
      "value": "Ad spend · ",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0049": {
      "value": "today so far",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0050": {
      "value": "£174",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0051": {
      "value": "ours £59 · Laszlo £101 · Google £14",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0052": {
      "value": "Overall ROAS · ",
      "source": [
        "shopify",
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0053": {
      "value": "today so far",
      "source": [
        "shopify",
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0054": {
      "value": "1.70×",
      "source": [
        "shopify",
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0055": {
      "value": "net sales ÷ all ad spend · set a bar",
      "source": [
        "shopify",
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0056": {
      "value": "Net margin · ",
      "source": [
        "shopify",
        "meta",
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0057": {
      "value": "today so far",
      "source": [
        "shopify",
        "meta",
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0058": {
      "value": "16%",
      "source": [
        "shopify",
        "meta",
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0059": {
      "value": "live estimate · sample until costs.md is filled",
      "source": [
        "shopify",
        "meta",
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0060": {
      "value": "Live",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0061": {
      "value": "Wins",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0062": {
      "value": "Coming up",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0063": {
      "value": "23 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0064": {
      "value": "since the last order",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0065": {
      "value": "US, 2 kits",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0066": {
      "value": "live",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0067": {
      "value": "4",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0068": {
      "value": "carts open",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0069": {
      "value": "0 abandoned checkouts",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0070": {
      "value": "Shopify 2 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0071": {
      "value": "18 · 9",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0072": {
      "value": "to dispatch UK · US",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0073": {
      "value": "J&J by 16:00 · Ohio by 15:00 ET",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0074": {
      "value": "today",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0075": {
      "value": "412 ms",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0076": {
      "value": "site up",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0077": {
      "value": "UK and US checkouts tested",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0078": {
      "value": "✓ fine",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0079": {
      "value": "0",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0080": {
      "value": "junk traffic sources",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0081": {
      "value": "Missouri 4%, watched",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0082": {
      "value": "1 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0083": {
      "value": "£24.96",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0084": {
      "value": "UK cost per order",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0085": {
      "value": "best of the week",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0086": {
      "value": "43",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0087": {
      "value": "orders yesterday",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0088": {
      "value": "5 above the 7-day average",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0089": {
      "value": "571",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0090": {
      "value": "D1 UK flow entries",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0091": {
      "value": "since the country fix",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0092": {
      "value": "24",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0093": {
      "value": "popup sign-ups",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0094": {
      "value": "day 2 of the gift popup test",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0095": {
      "value": "0",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0096": {
      "value": "flow leaks",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0097": {
      "value": "abandoned-cart flow since the purchase checks",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0098": {
      "value": "Thu 1 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0099": {
      "value": "US payday",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0100": {
      "value": "discount tomorrow’s US dials",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0101": {
      "value": "tomorrow",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0102": {
      "value": "Sat 3 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0103": {
      "value": "Laszlo review",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0104": {
      "value": "UK Card games and Gift sets",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0105": {
      "value": "3 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0106": {
      "value": "Sun 4 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0107": {
      "value": "Judge the UK screen test",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0108": {
      "value": "ads 24 + 33",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0109": {
      "value": "4 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0110": {
      "value": "Tue 6 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0111": {
      "value": "Gift popup: earliest call",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0112": {
      "value": "day 7 of the test",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0113": {
      "value": "6 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0114": {
      "value": "Thu 8 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0115": {
      "value": "Helen back",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0116": {
      "value": "3 items waiting for her",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0117": {
      "value": "8 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0118": {
      "value": "Mon 12 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0119": {
      "value": "Mailchimp bill",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0120": {
      "value": "row 5 on the table",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0121": {
      "value": "12 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0122": {
      "value": "All dates",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0123": {
      "value": "On the table",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0124": {
      "value": "1 alarm · 5 decisions",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0125": {
      "value": "✕ Alarm",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0126": {
      "value": "US Slabs & Label pack runs dry 14 Oct",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0127": {
      "value": "Draft the ask now so it is the first thing Helen reads.",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0128": {
      "value": "14 d",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0129": {
      "value": "of stock",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0130": {
      "value": "21 d",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0131": {
      "value": "floor",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0132": {
      "value": "8 Oct",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0133": {
      "value": "Helen back",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0134": {
      "value": "The only item under its floor. Helen is away until 8 Oct, so the fix is 700–1,000 US packs by air the day she is back.",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0135": {
      "value": "◆ Decide",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0136": {
      "value": "News article · US feed",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0137": {
      "value": "Pause it. Resume later if a new creative is ready.",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0138": {
      "value": "£43.52",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0139": {
      "value": "7d per purchase",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0140": {
      "value": "£22.70",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0141": {
      "value": "US break-even",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0142": {
      "value": "£60",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0143": {
      "value": "a day",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0144": {
      "value": "Kill rule met: three days over break-even with the full budget spent. It is dragging the US blended number over £28.",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0145": {
      "value": "◆ Decide",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0146": {
      "value": "Google is at £165 a day, not £90",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0147": {
      "value": "Ask Laszlo whether this is the plan for the week.",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0148": {
      "value": "£165",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0149": {
      "value": "budget now",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0150": {
      "value": "£90",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0151": {
      "value": "agreed",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0152": {
      "value": "14:00",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0153": {
      "value": "switched on 30 Sep",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0154": {
      "value": "PMax xLM US v2 (£50) and Branded Search US V2 (£25) went live yesterday afternoon. Not by us, not yet confirmed with Laszlo.",
      "source": [
        "google-ads",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0155": {
      "value": "◆ Decide",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0156": {
      "value": "Laszlo’s US sets over £30",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0157": {
      "value": "Message him today. His UK Card games and Gift sets are due a look on 3 Oct anyway.",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0158": {
      "value": "2 sets",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0159": {
      "value": "birthday, Pokémon",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0160": {
      "value": "3 days",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0161": {
      "value": "over £30",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0162": {
      "value": "£22.70",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0163": {
      "value": "US break-even",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0164": {
      "value": "His UK sets are fine (7d £17.90). The US pair has been over £30 per purchase three days running.",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0165": {
      "value": "◆ Decide",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0166": {
      "value": "Mailchimp audience is over plan",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0167": {
      "value": "Pick one before 12 Oct. Blocks cost less if the audience stays under 5,500.",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0168": {
      "value": "5,151",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0169": {
      "value": "contacts",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0170": {
      "value": "5,000",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0171": {
      "value": "plan",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0172": {
      "value": "12 d",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0173": {
      "value": "to the bill",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0174": {
      "value": "103% of the plan. The 595 cold contacts from August stay archived, so the bill on 12 Oct adds contact blocks or moves up a tier.",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0175": {
      "value": "◆ Decide",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0176": {
      "value": "Keep Automated delivery dates?",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0177": {
      "value": "Decide after the 16:20 check. Nothing has been over-promised.",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0178": {
      "value": "~14:00",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0179": {
      "value": "Automated rolls",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0180": {
      "value": "12:00",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0181": {
      "value": "Manual rolled",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0182": {
      "value": "16:00",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0183": {
      "value": "real cutoff",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0184": {
      "value": "Automated halved the afternoon gap but did not close it. Two observe-only checks run today at 15:35 and 16:20.",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0185": {
      "value": "New reviews ",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0186": {
      "value": "◆ 3 waiting",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0187": {
      "value": "Judge.me · checked 2 min ago · sample reviews, invented",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0188": {
      "value": "! Read first",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0189": {
      "value": "Duo Pack · US · verified buyer",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0190": {
      "value": "“One slab in my Duo Pack arrived with a scratch across the front. The labels and the case are great.”",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0191": {
      "value": "18 min ago",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0192": {
      "value": "◆ New",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0193": {
      "value": "Kit · UK · verified buyer · 1 photo",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0194": {
      "value": "“Made my first slab in ten minutes and it looks like a real graded card. Ordering a refill already.”",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0195": {
      "value": "1 h ago",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0196": {
      "value": "◆ New",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0197": {
      "value": "Refill pack · UK · verified buyer",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0198": {
      "value": "“Good value refill. The labels took me a couple of goes to line up, fine after that.”",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0199": {
      "value": "5 h ago",
      "source": [
        "judgeme"
      ],
      "mode": "sample"
    },
    "t0200": {
      "value": "Tests",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0201": {
      "value": "1 live · 2 more running · 4 queued · 3 called",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0202": {
      "value": "This week’s test",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0203": {
      "value": "Gift popup: free pack vs email popup",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0204": {
      "value": "Site lane · UK + US · day 2 of at least 7",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0205": {
      "value": "i Too early",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0206": {
      "value": "Also running",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0207": {
      "value": "! Day 1",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0208": {
      "value": "UK screen set: back on with ads 24 + 33",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0209": {
      "value": "Ads lane · back on this morning · judge Sun 4 Oct on cost per purchase · before/after, capped at Leaning",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0210": {
      "value": "day 1 of 5",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0211": {
      "value": "◆ Call it",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0212": {
      "value": "Delivery dates: Automated vs Manual",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0213": {
      "value": "Site lane · before/after since 29 Sep · DPD right in the morning, a day late after 14:00",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0214": {
      "value": "Decide on the table",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0215": {
      "value": "Next up · one at a time per lane",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0216": {
      "value": "◆ Your yes",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0217": {
      "value": "Retargeting: new orders or only credit?",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0218": {
      "value": "Ads lane · £10 a day per country on visitors who have not bought · call at day 14",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0219": {
      "value": "earliest Mon 5 Oct · brief written",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0220": {
      "value": "i Queued",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0221": {
      "value": "Long cut vs short cut of the same ad",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0222": {
      "value": "Ads lane · two ad sets at £22.50 each, one cut per set, same audience · read on cost per add-to-cart",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0223": {
      "value": "after retargeting · needs both cuts",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0224": {
      "value": "i Waits",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0225": {
      "value": "Cart drawer wording",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0226": {
      "value": "Site lane · shares the cart with the popup test, so it waits · the checkout page itself cannot be split on this plan",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0227": {
      "value": "after the popup test",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0228": {
      "value": "i Waits",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0229": {
      "value": "Bundles page vs kit page as the ad landing page",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0230": {
      "value": "Site lane · bundles are 65% of US orders and 33% of UK · read on orders per visitor",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0231": {
      "value": "after cart wording",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0232": {
      "value": "Past tests · 3 called in September · 2 made a rule",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0233": {
      "value": "✓ Feed wins",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0234": {
      "value": "Feed vs Story and Reels placements",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0235": {
      "value": "Ads lane · every static concept lost in Story and Reels · rule: new statics go feed only",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0236": {
      "value": "Sep",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0237": {
      "value": "= Mixed",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0238": {
      "value": "Were the September kills right?",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0239": {
      "value": "Ads lane · only News article US story reached break-even (£23.40 v £22.70) · rule: re-read kills monthly",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0240": {
      "value": "30 Sep",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0241": {
      "value": "✓ Fixed",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0242": {
      "value": "D1 US flow country condition",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0243": {
      "value": "Email · United States, not the code · 3 entries the same day",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0244": {
      "value": "27 Sep",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0245": {
      "value": "Dials",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0246": {
      "value": "37 dials in four decks. Tap one for why, the rule, the source and 7 days.",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0247": {
      "value": "Ads",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0248": {
      "value": "Store",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0249": {
      "value": "Growth",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0250": {
      "value": "Stock",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0251": {
      "value": "Placements",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0252": {
      "value": "feed",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0253": {
      "value": "all 9 sets · no story-only",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0254": {
      "value": "Changes not by us",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0255": {
      "value": "0 · 2",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0256": {
      "value": "Meta · Google",
      "source": [
        "meta",
        "google-ads"
      ],
      "mode": "sample"
    },
    "t0257": {
      "value": "9 live sets, ours. Kill and step rules from the Meta note.",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0258": {
      "value": "Live sets",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0259": {
      "value": "Direct share",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0260": {
      "value": "+2.1 pts",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0261": {
      "value": "week on week",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0262": {
      "value": "Checkout promise",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0263": {
      "value": "Thu 1 Oct",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0264": {
      "value": "matches the product page",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0265": {
      "value": "Refill pack",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0266": {
      "value": "0",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0267": {
      "value": "orders since 11 Sep · 19 emails sent",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0268": {
      "value": "Flow orders 7d",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0269": {
      "value": "11",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0270": {
      "value": "cart 6 · welcome 3 · D1 2",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0271": {
      "value": "Popup A vs B",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0272": {
      "value": "A",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0273": {
      "value": "36",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0274": {
      "value": "B",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0275": {
      "value": "29",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0276": {
      "value": "kit orders · day 2 · see Tests",
      "source": [
        "shopify"
      ],
      "mode": "sample"
    },
    "t0277": {
      "value": "Flow leaks",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0278": {
      "value": "0",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0279": {
      "value": "cart flow since the fix",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0280": {
      "value": "D1 flows",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0281": {
      "value": "571 · 3",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0282": {
      "value": "UK-ROW · US entries",
      "source": [
        "mailchimp"
      ],
      "mode": "sample"
    },
    "t0283": {
      "value": "Popup flow",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0284": {
      "value": "10",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0285": {
      "value": "in flow · trigger to build",
      "source": [
        "mailchimp",
        "shopify"
      ],
      "mode": "sample"
    },
    "t0286": {
      "value": "Penny colour",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0287": {
      "value": "300",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0288": {
      "value": "by air to the US",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0289": {
      "value": "Hedy",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0290": {
      "value": "?",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0291": {
      "value": "dispatched before the holiday?",
      "source": [
        "shopify",
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0292": {
      "value": "Sample feed ages · ",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0293": {
      "value": "Shopify 2 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0294": {
      "value": "Meta 12 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0295": {
      "value": "Google 58 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0296": {
      "value": "Mailchimp 15 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0297": {
      "value": "Uptime 1 min",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0298": {
      "value": "HQ repo 07:39",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0299": {
      "value": "· Daily ads check still runs: parallel day 1 of 7",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0300": {
      "value": "Source actions are not built yet. ",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0301": {
      "value": "Sample presentation copied from the supplied mockup. All business numbers, reviews, feed ages and health scores here are invented examples, fixed at the sample date. Source clients and source actions arrive in later stages. Source marks are the mockup’s drawn placeholders.",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0302": {
      "value": "i",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0303": {
      "value": "×",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0304": {
      "value": "Why",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0305": {
      "value": "Rule",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0306": {
      "value": "Source",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0307": {
      "value": "Set",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0308": {
      "value": "Budget",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0309": {
      "value": "Per purchase",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0310": {
      "value": "State",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0311": {
      "value": "News article · US feed",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0312": {
      "value": "£60",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0313": {
      "value": "7d £43.52",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0314": {
      "value": "◆ Decide",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0315": {
      "value": "37 Story reply · US feed ",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0316": {
      "value": "WINNER",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0317": {
      "value": "£7.50",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0318": {
      "value": "7d £24.80",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0319": {
      "value": "! Watch",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0320": {
      "value": "hold",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0321": {
      "value": "BREAKING · US",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0322": {
      "value": "£35",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0323": {
      "value": "3d £31.20",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0324": {
      "value": "! Watch",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0325": {
      "value": "slipping",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0326": {
      "value": "captiontest v3 · UK",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0327": {
      "value": "£30",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0328": {
      "value": "3d £29.10",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0329": {
      "value": "! Watch",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0330": {
      "value": "slipping",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0331": {
      "value": "BULLETED · US",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0332": {
      "value": "£50",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0333": {
      "value": "7d £21.40",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0334": {
      "value": "✓ Good",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0335": {
      "value": "UK screen · ads 24 + 33",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0336": {
      "value": "£40",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0337": {
      "value": "7d £19.70",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0338": {
      "value": "! Watch",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0339": {
      "value": "judge 4 Oct",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0340": {
      "value": "37 Story reply · UK feed ",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0341": {
      "value": "WINNER",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0342": {
      "value": "£7.50",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0343": {
      "value": "7d £16.10",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0344": {
      "value": "✓ Good",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0345": {
      "value": "23 Cart free gift · UK feed ",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0346": {
      "value": "WINNER",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0347": {
      "value": "£7.50",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0348": {
      "value": "7d £15.30",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0349": {
      "value": "✓ Good",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0350": {
      "value": "thatgrlmaja · UK",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0351": {
      "value": "£25",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0352": {
      "value": "7d £17.80",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0353": {
      "value": "✓ Good",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0354": {
      "value": "Sample ad sets. Pause and budget changes are not built; this dashboard has no source write path.",
      "source": [
        "meta"
      ],
      "mode": "sample"
    },
    "t0355": {
      "value": "Wed 30 Sep",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0356": {
      "value": "Delivery checks 15:35 and 16:20 · month-end",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0357": {
      "value": "today",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0358": {
      "value": "Thu 1 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0359": {
      "value": "US payday",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0360": {
      "value": "1 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0361": {
      "value": "Sat 3 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0362": {
      "value": "Laszlo UK Card games and Gift sets",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0363": {
      "value": "3 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0364": {
      "value": "Sun 4 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0365": {
      "value": "Judge the UK screen test",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0366": {
      "value": "4 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0367": {
      "value": "Tue 6 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0368": {
      "value": "Gift popup test: earliest call (day 7)",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0369": {
      "value": "6 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0370": {
      "value": "Thu 8 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0371": {
      "value": "Helen back from holiday",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0372": {
      "value": "8 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0373": {
      "value": "Mon 12 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0374": {
      "value": "Mailchimp bill",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0375": {
      "value": "12 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0376": {
      "value": "Wed 14 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0377": {
      "value": "US Slabs & Label runs dry (if nothing airs)",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0378": {
      "value": "14 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0379": {
      "value": "Sun 25 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0380": {
      "value": "UK clocks go back: check the ET times",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0381": {
      "value": "25 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0382": {
      "value": "Tue 27 Oct",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0383": {
      "value": "Gift popup test: proposed read (day 28)",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0384": {
      "value": "27 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0385": {
      "value": "Mon 16 Nov",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0386": {
      "value": "Black Label lands",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0387": {
      "value": "47 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0388": {
      "value": "23–28 Nov",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0389": {
      "value": "Black Friday window",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    },
    "t0390": {
      "value": "54 d",
      "source": [
        "github-hq"
      ],
      "mode": "sample"
    }
  }
};

/** Return a fresh snapshot so one request cannot mutate another user's settings. */
export function getSampleDashboard(settings?: Settings): DashboardSnapshot {
  const snapshot: DashboardSnapshot = { ...structuredClone(fixture), generatedAt: new Date().toISOString() };
  const bar = settings?.blendedMetaTripwireGbp;
  if (bar !== undefined) applyBlendedBar(snapshot, bar);
  return snapshot;
}

function applyBlendedBar(snapshot: DashboardSnapshot, bar: number): void {
  const pounds = (value: number): string => `£${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  const amber = Math.round(bar * 90) / 100;
  const replace = (text: string): string => text.replace(/£25\.20|£28(?!\d|\.\d)/g, (value) => value === '£25.20' ? pounds(amber) : pounds(bar));
  const update = (model: DialModel): void => {
    model.min = Math.min(12, bar / 2);
    model.max = Math.max(40, bar + 12);
    model.z = [[model.min, amber, 'good'], [amber, bar, 'warn'], [bar, model.max, 'decide']];
    model.s = replace(model.s);
    if (bar !== 28 && model.d.hist) {
      const above = model.d.hist.filter((value) => value > bar).length;
      model.d.why = `${model.l} is ${model.t} for the selected sample period. ${above} of ${model.d.hist.length} sample history days are above the configured ${pounds(bar)} bar.`;
    }
    model.d.rule = replace(model.d.rule);
  };
  for (const period of Object.values(snapshot.hero)) {
    update(period.ukcpo);
    update(period.uscpo);
  }
  for (const widget of Object.values(snapshot.widgets)) {
    if (widget.kind === 'dial' && /Meta cost per order/.test(widget.value.l)) update(widget.value);
  }
  // Static narrative describes the dated mockup scenario and its original bar.
  // Only the current dial rules change when a setting changes.
}
