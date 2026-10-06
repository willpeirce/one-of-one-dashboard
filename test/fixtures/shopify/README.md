Invented responses for Shopify Admin GraphQL and webhook API **2026-10**.
No captured store/customer data. The webhook people and addresses are deliberately fake;
tests prove they never survive intake. The token fixture leaves access_token empty: tests
fill it with a runtime-generated value, never a committed credential.

GraphQL responses retain data/connection/pageInfo and cost/throttle envelopes. ShopifyQL
retains columns and rows. The sample reader uses these same files in production, with a
fixed 30 September clock. Subscription fixtures exercise the transport in tests only;
sample mode never creates a subscription or calls Shopify.

Tax regressions use GBP `shopMoney`, including the US order, as required by plan
section 5. `order-uk-tax-inclusive-refund` has £120 gross items less £12 discounts
= £108 inclusive subtotal (£18 item VAT), plus £6 paid shipping (£1 shipping VAT).
One of two items is returned: its £54 `subtotalSet` includes £9 VAT. Stored items
are £90 before returns and £45 returned; net item sales are £45.
`order-us-tax-exclusive` has £125 gross less £25 discounts = £100 item subtotal,
£8 separately charged item tax and £10 shipping with £0.80 shipping tax. The
£40 partial return has £3.20 separate tax; net item sales are £60.

Field semantics checked against Shopify's
[Order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order),
[LineItem](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem) and
[RefundLineItem](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/RefundLineItem)
references: order subtotals follow `taxesIncluded`; item tax lines include refunded
quantities. Refund subtotals retain the order's price basis rather than always
being tax-exclusive. The refund reference does not explicitly state that basis;
Shopify's developer-community [inclusive-tax report](https://community.shopify.dev/t/bug-shipping-refund-doesnt-include-tax-but-line-item-does/24741)
and [exclusive-tax example](https://community.shopify.dev/t/how-to-refund-tax/29399)
corroborate the two cases. Live report agreement remains a check after keys arrive.

## Stage 1b card envelopes

`card-orders.json`, `card-sessions.json` and `card-channels.json` contain 400 days of **invented** API-shaped history through 30 September 2026. Regenerate with `python scripts/generate-shopify-cards-fixtures.py` from the repository root. IDs are fake; no production orders, channel counts, stock totals, reviewer names or reviews were copied. The fixed values are a fixture scenario, not One of One's figures. The sample worker opts into these; the small source-unit fixtures stay independent.

`channels.json` is an invented ShopifyQL `tableData` envelope with day/sales_channel/orders columns. Subscription fixtures now use the 2026-10 top-level `uri`. New live queries request channel information, payment times, discount-code signals and allocated fulfilment lines without adding personal fields. The wider history intentionally covers the country-tagging guard dates and spike days; stock fixture coverage remains sparse so unavailable products/multiplier inputs show unknown.

Review regression fixtures are hand-written, invented API envelopes: `order-zero-total-paid.json` has PAID status and no money transactions; `orders-null-channel.json` has one draft-source order and two unmapped-source orders, all with null channel information; `channels-null-channel.json` is the matching ShopifyQL report. Their order/line ids are invented, and their quantities/channel totals are test scenarios. Tests vary transaction times and report totals to cover unknowns, genuine shortages and recovery.

`product.json` includes an invented unitCost. `product-costs.json` and `product-costs-before.json` are invented PulseStock-shaped sample snapshots, with a costless variant and one whose fictional cost changes between 28 and 30 September 2026. The existing sample inventory job seeds the earlier observation once; no live costs, prices or store figures were copied. Extra variants deliberately have no inventory levels, exercising cost coverage independently from warehouse stock.
