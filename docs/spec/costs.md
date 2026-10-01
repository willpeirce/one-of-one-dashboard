---
name: Costs
description: Blank costs table behind net margin and overall ROAS (landed cost per SKU, fulfilment per parcel, fees, fixed growth costs per month), sources named; Will fills it once on 1 Oct 2026 or after, then on every supplier price change
type: reference
---

# Costs

Nothing here is filled in yet. Every blank is a number Will has or can get in about an hour. Until it is filled, the control centre's net margin is a sample (non-ad costs assumed at 25% of net sales) and ad decisions run on cost per purchase alone. The Source column holds the invoice or order id, never the invoice itself.

Net sales is gross minus discounts minus refunds, excluding shipping and tax (`docs/dashboard-plan.md`, metric definitions), so every cost here is ex-VAT too.

## Landed cost per unit

| SKU | Market | Unit cost | Freight and duty per unit | Landed cost | Source | Valid from |
| --- | --- | --- | --- | --- | --- | --- |
| Kit | US | | | | Series 1 production invoice from Helen (not in the repo); duty on air shipments | |
| Kit | UK | | | | Same invoice, UK leg | |
| Slabs and label pack | US | | | | Helen H-26011 (3-slab Slabs & Label packs) and Hedy slabs, `knowledge/stock-and-supply.md` | |
| Slabs and label pack | UK | | | | Helen H-26011, UK leg | |
| Colour expansion pack | US | | | | Penny order 315128702501029579 | |
| Black Label set (H-26013, 333 sets) | US / UK | | | | Helen H-26013, air, due 16 Nov | |
| Free slab gift, arm A (EasyGift `_Gifted` line) | UK / US | | | | Landed cost of the 3-slab pack | |
| SLABPACK discount, arm B (DiscountCodeNode 2298260783438) | UK / US | | | | Discount value per use | |

## Fulfilment per parcel

| Warehouse | Market | Total per parcel | Source | Valid from |
| --- | --- | --- | --- | --- |
| J&J, Northampton (location 106790748494) | UK | | Last month's J&J invoice | |
| Ohio (location 106790781262) | US | | Last month's Ohio invoice | |

## Fees and rates

| Item | Rate | Source | Valid from |
| --- | --- | --- | --- |
| Shopify Payments fee | | Shopify billing | |
| Shopify plan and apps per month | | Shopify billing | |
| Duty on US air shipments | | Last customs entry | |

## Fixed growth costs per month

One line each, totals only. Freelancer and creator rates as a total line, never per person.

| Item | Per month | Source | Valid from |
| --- | --- | --- | --- |
| Ads management (Meta freelancer and Google) | | | |
| Artlist | | | |
| Mailchimp (plan 5,000 contacts, $144 on 30 Sep) | | `knowledge/mailchimp-flows.md` | |
| Apps and tools | | | |
| Cloud routines and sessions | | | |
| Total fixed growth cost | | | |

## How it is used

- Overall ROAS = net sales ÷ all ad spend (Meta, TikTok, Google).
- Net margin (live estimate) = (net sales − landed cost − fulfilment per parcel − payment fee − discount cost − ad spend) ÷ net sales. Fulfilment per parcel comes from the last month's shipping invoices.
- At about 1.5× overall ROAS, ads alone take about two thirds of net sales, so the real margin may be close to zero. This table is how to find out.
- The monthly sitting checks whether any Valid-from date is older than the last supplier invoice.
