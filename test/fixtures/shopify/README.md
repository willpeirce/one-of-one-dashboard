Invented responses for Shopify Admin GraphQL and webhook API **2026-10**.
No captured store/customer data. The webhook people and addresses are deliberately fake;
tests prove they never survive intake. The token fixture leaves access_token empty: tests
fill it with a runtime-generated value, never a committed credential.

GraphQL responses retain data/connection/pageInfo and cost/throttle envelopes. ShopifyQL
retains columns and rows. The sample reader uses these same files in production, with a
fixed 30 September clock. Subscription fixtures exercise the transport in tests only;
sample mode never creates a subscription or calls Shopify.
