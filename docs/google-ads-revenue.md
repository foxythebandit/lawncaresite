# Google Ads revenue feed and report

Sends recorded CRM money back to Google Ads, so bidding learns which clicks become paying (and recurring) customers, and shows the same numbers on the CRM Revenue page.

## How a visit is credited

- Every recorded payment counts once: dated `job_payments` rows plus the older `amount_charged` on completed jobs (the same money the Revenue page totals).
- A payment belongs to its job's own `gclid`, else to the earliest `gclid` of the same customer (legacy jobs without a customer: the same phone). Plan visits rarely carry a click ID, so this is how repeat mows reach the original ad click. This is reporting attribution, not proof the ad caused every visit. No click ID → not sent, not guessed.
- Plan vs one-time: the job belongs to a mowing plan (`agreement_id`), or is a legacy recurring job (`one_time = false` with a repeating frequency).
- Only recorded money is sent. A visit marked Done without a payment isn't revenue yet: record the payment and it appears in the next upload.

## Feed: `GET /api/google-ads/conversions.csv`

Also served at `/api/google-ads/conversions` (Google Ads requires the `.csv` URL). HTTP Basic auth with `GOOGLE_ADS_FEED_USER` / `GOOGLE_ADS_FEED_PASSWORD` (password at least 16 characters). Unset credentials → every request is 401. The CSV holds click IDs, conversion name, time, value and currency only. No names, phones or addresses.

- Conversion names: `CRM paid visit - mowing plan` and `CRM paid visit - one-time`. They must match the Google Ads conversion actions exactly.
- Time: paid date at 18:mm Central (minute varies per job), or one hour after a same-day click. Left out: payments dated before the click, more than 90 days after it, or not yet in the past.
- Re-sending the same rows each day is expected. Google ignores conversions it already has (same click, action and time).

## Report

Revenue → **Google Ads results**: customers whose first tracked visit came from a Google click, plan vs one-time, what they've paid, and their share of the ~30-mows/year forecast. Ad spend is typed in from Google Ads → Billing and kept in that browser only (localStorage), never saved to the CRM.

## Setup after deploy

1. Vercel → Environment Variables (Production): `GOOGLE_ADS_FEED_USER`, `GOOGLE_ADS_FEED_PASSWORD`. Redeploy.
2. Google Ads → Goals → Conversions → New conversion action → Import → Other data sources or CRMs → Track conversions from clicks. Create both names above: category Purchase, "Use different values for each conversion", count **Every**, click-through window 90 days, **Secondary** to start.
3. Tools → Data manager → Connect product → HTTPS → Conversions → "measure offline conversions" → skip choosing one conversion action (each row names its action). URL `https://quietgreen.co/api/google-ads/conversions.csv`, the username and password above, daily schedule. (Goals → Uploads → Schedules now points here.)
4. Check the first upload's results after a day. Consider making these Primary only once uploads succeed and enough real visits arrive. Changing the bidding goal restarts learning.

Tests: `tests/google-ads-revenue.test.ts`.
