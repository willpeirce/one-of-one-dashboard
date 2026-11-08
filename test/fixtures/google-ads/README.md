These are invented API response projections. Every identifier beginning with 900 is deliberately fabricated, and every campaign/ad-set name is marked Invented. Amounts are sample data, never captured from an account. OAuth access tokens are generated at runtime in tests.

`audit-hours.json` and `audit-daily.json` are invented searchStream responses using fabricated identifiers beginning with 990. They cover GMT days around the October clock change, including an omitted day with no activity, fractional pennies and multiple campaigns. They are not live account data.

`campaigns`, `networks`, `conversions`, `changes` and `daily` are invented v24 searchStream projections for the independent report worker. Network fixtures deliberately retain a mixed slice and an invented future enum value. Conversion counts include fractions. Changes contain only resource/operation/time fields; no actor or personal data is requested.
