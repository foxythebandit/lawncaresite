# ConviFlo forms and Meta tracking — setup and findings

Last checked 23 October 2026, from Paxton's laptop. No forms or ads were published, no budgets changed, and no existing customer records were touched. Secrets are not in this file.

## Status at a glance

| Item | Status |
| --- | --- |
| Live "landing page" form → CRM | ✅ Working. A real public submission reached the CRM in 1.3 s and both calls completed. |
| New Mowing review draft → CRM | ⚙️ Allowlisted and webhook connected. A signed synthetic delivery passed. Not published, so no real ConviFlo payload yet. |
| New Leaves & Gutters review draft → CRM | ⚙️ Same as the mowing draft. `cleanup_service` sets the services. |
| Staff alerts | ✅ Calls to both staff numbers are on. Texts are off (`STAFF_SMS_ENABLED=false`). |
| Meta campaign / ad set / ad IDs in the CRM | ✅ Verified with two distinct sets of synthetic numeric IDs. |
| AI / Real creative labels (`META_AD_CREATIVES`) | ❌ Empty. No ads were found in account 2096962487924428. |
| Dataset 27435240816118469 ↔ ad account 2096962487924428 | ❌ Not connected. It is connected only to "Quiet Green" (2240549216693180). |
| Caelan's access to that dataset | ❌ None. Caelan isn't in the business portfolio. |

## ConviFlo forms in the CRM allowlist (`CONVIFLO_FORMS`, Vercel production)

| Form | ID | Address key | Services |
| --- | --- | --- | --- |
| landing page (live) | `05212679-7c8d-4034-9a43-53b48a336548` | `address` | Lawn mowing |
| QuietGreen \| Mowing \| Review draft | `ae7c0184-fa95-40d4-8b74-cd8578083470` | `property_address` | Lawn mowing (`mowing_frequency` is kept as an answer) |
| QuietGreen \| Leaves & Gutters \| Review draft | `b521838c-6883-46d3-9e07-22a78a374ab4` | `property_address` | From `cleanup_service`: `leaf_cleanup` → Leaf cleanup, `gutter_cleaning` → Gutter cleaning, `both_leaves_and_gutters` → both |

- All three forms have `map_meta_utm_ids: true`.
- The live form's entry is unchanged.
- The field keys were read from each form's builder:
  - Mowing draft: `mowing_frequency`, `property_address` (street / unit / city), `name`, `phone`.
  - Cleanup draft: `cleanup_service`, `property_address`, `name`, `phone`.

**Webhooks:** all three forms post to `https://quietgreen.co/api/intake/conviflo` with the same signing secret as Vercel's `CONVIFLO_WEBHOOK_SECRET`. A copy is in the main checkout's gitignored `.env.local`. On each draft, the secret survived a page reload (64 characters). The secret was pasted by a person, not by the agent.

## Code changes (deployed to `main`, no database migration)

- `4ee0e22`: ConviFlo leads without an address are accepted, with `address_missing: true`. The CRM shows "Address not yet provided".
- `4415723`: a form can set `service_key` + `service_map`, so one answer chooses the services. An unknown or missing choice keeps the form's default services and adds `service_unmapped: true` for staff to check. Creative types display as "AI creative" / "Real creative".
- `49c8548`: service choices match by label slug, so `both_leaves_and_gutters`, "Both leaves and gutters" and similar spellings all map the same way.
- Tests: `tests/conviflo-services.test.ts` (4 passing). Run it with `npx tsx --test tests/conviflo-services.test.ts`. `tests/crm-conviflo.py` was updated for addressless leads but needs a local Supabase (Docker), which isn't on this machine.

## What was verified on production

1. **Live landing-page form, real public submission:**
   - It saved to the CRM with source `conviflo`, all answers, ZIP and the test UTMs.
   - Both calls completed and the texts were disabled.
   - There was no duplicate after ConviFlo's retry window.
2. **Signed synthetic deliveries** (same payload shape as verified ConviFlo receipts):
   - **Cleanup draft:** `cleanup_service: both_leaves_and_gutters` → services Leaf cleanup + Gutter cleaning. The address was assembled from street/city. Meta IDs `9100000001 / 9100000002 / 9100000003` → campaign / ad set / ad.
   - **Mowing draft:** `mowing_frequency: ongoing_mowing` was kept, services Lawn mowing, and the address included the unit. Meta IDs `9200000001 / 9200000002 / 9200000003`. That's distinct from the cleanup lead, and each value landed in the right field.
   - **Duplicate check:** an identical repeat returned `duplicate: true`, with no new lead or alerts.
   - **Addressless lead:** saved, and the call went out.
   - **Alerts:** each new lead produced 2 calls (accepted) and 2 texts (disabled, 0 attempts).

**Not verified:** a real payload from either draft. ConviFlo's preview says "Preview — no data is recorded" and doesn't send webhooks, so the exact option values can only be confirmed by submitting after publishing. The mapping is safe either way, because an unrecognised choice is saved and flagged rather than lost.

**Smallest check after publishing:** submit each form once with test details and `?utm_source=meta&utm_medium=paid_social&utm_campaign=1&utm_term=2&utm_content=3`. Then confirm in the CRM that services are correct and that `service_unmapped` is absent.

## Meta findings

- **Ad account 2096962487924428** (Paxton's personal ad account) shows no campaigns or ads for any date from January 2025 on. It also has a payment-method warning that blocks publishing.
- **The only ad visible to this login** is the draft campaign "2026 - 101" / "New Leads Ad" in "Quiet Green" (2240549216693180). If the AI vs Real campaign is under another login, its ad IDs are needed for `META_AD_CREATIVES`.
- **Dataset "Quiet Green Website" 27435240816118469** (owned by the "Paxton Reynolds" business portfolio):
  - Connected assets: the Quiet Green ad account only.
  - People assigned: 0. Partners: 0.
  - Events received: PageView only. No Lead event has ever arrived.
- **Caelan Liu** isn't a member of the business portfolio (Meta suggests "Add Caelan Liu"). Caelan has Quiet Green Facebook Page access only, so no dataset or ad account access through the portfolio.
- **Lead events:** the website's Meta Lead event is still off (`NEXT_PUBLIC_META_LEAD_EVENTS_ENABLED` unset). There's no Conversions API, and CRM outcomes aren't sent to Meta.

## To do (owner actions)

1. **Use the dataset from 2096962487924428:**
   - In Business settings → Accounts → Ad accounts, add 2096962487924428 to the "Paxton Reynolds" portfolio.
   - Then in Datasets & pixels → Quiet Green Website → Connected assets → Connect assets, choose that ad account.
   - Or run the campaign from the Quiet Green account, which is already connected.
2. **Give Caelan access:** Business settings → People → Add person (Caelan). Then assign the dataset (and the ad accounts) under the dataset's People tab.
3. **Fill `META_AD_CREATIVES`** once real ads exist. It's a JSON map of numeric ad ID → `{ "creative_id": "<readable name>", "creative_type": "ai" | "real" }` in Vercel production, followed by a redeploy. Each ad's URL parameters must be `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`. Draft ad IDs may change on publish, so map the published IDs.
4. Publish the drafts only when approved, then run the smallest check above.
5. Clean up the synthetic CRM leads named "TEST … (ignore)" (mark them lost).
