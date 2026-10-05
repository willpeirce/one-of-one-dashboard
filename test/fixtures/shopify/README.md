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
