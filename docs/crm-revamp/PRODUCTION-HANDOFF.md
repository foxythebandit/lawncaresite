# QuietGreen CRM — friend's machine handoff

**Prepared release — 23 October 2026; deploy from Paxton’s laptop.** The owner authorized completing and pushing this branch for deployment from Paxton’s laptop. The historical receipt below covers the earlier checkpoint only; the current release receipt at the end of this document supersedes it for the redesigned CRM. Paxton’s deployment agent uses the existing Supabase/Vercel/Twilio setup. Do not place secret values in this document or copy local test configuration to production.

## Historical release evidence

- Implementation checkpoint: **`codex/crm-revamp` at `4650d79148a596c873f0494eac21b17a914b926f`; reviewed and tested**
- Decisions/defaults: **recorded in SPINE.md; real signed synthetic ConviFlo receipt verified, production form mappings still require activation checks**
- Changed migrations, in order after verified existing baseline:
  - `20261022215624_crm_foundation.sql`: additive identity, agreements, line items, payments, activity and guarded workflow contracts.
  - `20261022220253_crm_alert_intents.sql`: four durable recipient/channel intents and safe recovery state.
  - `20261022221526_crm_lifecycle_commands.sql`: explicit job/agreement/payment operations.
  - `20261022222457_crm_lifecycle_followup.sql`: cents/ownership/recurrence preservation and stale-request behavior.
  - `20261022223001_crm_lifecycle_frequency_guard.sql`: legacy recurring completion guard.
  - `20261022223600_crm_job_items_service_delete.sql`: service-role item replacement grant; customer portal total column grant under existing row isolation.
  - `20261022224000_crm_explicit_first_occurrence.sql`: explicit first return date followed by anchored cadence.
  - `20261022224500_crm_job_command_replay.sql`: identify scheduling replays so they cannot resend confirmation email.
  - `20261023000000_crm_customer_job.sql`: additive `crm_create_customer_job` command (service role only) so staff can add one-off jobs and start mowing plans from a customer page. No table or data changes.
- Local upgrade/preservation tests: **full isolated seeded upgrade passes through the customer-job migration; website/CRM regression suites and final optimized production rebuild pass**
- Final Astra review: **no remaining P1/P2 findings at the code checkpoint; all six review findings closed and first-visit/presentation preservation reviewed**
- Hosting target, actual deployed revision and migration history: **verify on friend's machine**
- Rollback application revision: **verify current deployed revision on friend’s machine; recovery constraints below prohibit destructive down migrations**

## Deployment-agent instructions

You are deploying the reviewed QuietGreen CRM revamp from my machine. Read `AGENTS.md`, `docs/crm-revamp/SPINE.md`, this release evidence, the actual changed migrations and relevant installed framework/skill guidance before acting. Use my existing Supabase project, hosting and Twilio setup; my keys are available locally. Do not print or commit secrets. Do not provision replacement services or rewrite the marketing site.

First verify that the reviewed branch/commit and test evidence are populated and match the working tree. If they are still pending, stop deployment preparation and identify the missing release evidence. Do not treat a planning document as a completed implementation.

Inspect the actual target database schema, migration history, permissions/policies and deployed application version before choosing any migration command. Compare them with the reviewed branch. Existing SQL files or local test passes do not prove production matches. In particular, this repository already contains migration-history alignment and a historical backup-copy migration; do not blindly rerun either. Stop on an unexplained mismatch and produce a concrete reconciliation plan that preserves existing records.

Inventory existing leads, quotes, bookings, extra charges, relationships and relevant storage artifacts. Make a current recoverable backup using the project's available facilities and confirm how restoration works. The historical backup tables alone are not the current recovery plan. Record non-sensitive counts and preservation checks. Do not delete, reset, truncate or replace production data; do not silently merge customers by phone or fabricate historical attribution.

Test the reviewed migration sequence against an isolated representative copy or suitable staging database first. Verify row counts, identifiers, existing bookings/customer access, legacy links, quotes and acquisition data survive. Check the changed permissions using anonymous, customer and staff roles. Never run disposable test bootstrap/reset scripts against production. Explain any migration that cannot safely be reversed and the data-preserving recovery approach before production execution.

Inspect configuration names from the completed implementation, without exposing values. Confirm both intended staff accounts, role/allowlist settings, protected-login return paths, canonical HTTPS CRM origin and both approved recipient numbers. Verify the ConviFlo adapter against actual documented/captured payload, authentication, stable submission identity and retry behavior. Do not assume native CAPI is available: it was marked SOON with no integrations connected during planning.

The non-negotiable lead behavior is: every new website or ConviFlo lead generates a Twilio attention call and an SMS to **each of Caelan and Paxton**. Calls need not be answered and must not bridge to the customer. Voice and SMS start independently, not one after another. SMS contains customer name, customer phone, address, services, useful answers and a protected direct link into the prefilled quote workspace. Full source/ad/creative details remain in the CRM. The confirmed requirement is 24/7 alerts; do not invent quiet hours.

The owner has authorized deploying this release from Paxton’s laptop and real test calls/texts to Caelan and Paxton. Prepare and execute the concrete deployment/migration sequence within that scope; do not request the same blanket permission again. Verify the intended existing project/domain, both staff recipients and designated synthetic test contact data before running acceptance. Do not notify real customers or emit live acquisition events as an accidental side effect of testing. Pause for a specific unexplained schema mismatch, missing account access or actual destructive operation, rather than inventing a new approval gate.

After migration/deployment, verify existing website forms still save correctly, login returns to the precise lead, the selected address opens the correct property, and staff quote save/approval does not automatically send or book. Exercise one controlled intake from each source with stable submission IDs; verify both phones actually ring and receive complete SMS links, then retry the same submissions and verify there are no duplicate alerts. Provider acceptance alone does not prove ringing or delivery. Capture provider identifiers/statuses privately and measure timing; do not promise a five-second reviewed quote.

Verify existing customer records and visits remain available, customer portal privacy holds, recurring completion produces one next visit, payments remain separate from estimates and acquisition survives into bookings/visits. Test only scenarios and external events authorized for production; keep destructive cases in staging.

If acceptance fails, retain the saved inquiries, pause the problematic new integration/dispatch path as appropriate, reconcile uncertain provider sends before retrying, and use the prepared application rollback or forward-fix plan. Do not drop newly created business records to make an old application version fit. Finish with exact deployed commit, applied migrations, non-sensitive preservation results, live checks performed, unresolved issues and operating instructions.

## Accepted lifecycle cutover requirements

Use BUILD-CONTRACT.md for the additive customer/jobs/optional agreement plan. Preserve booking IDs, historical job prices, extras/discounts, existing Stripe links and Paxton’s conservative 30-mow annual forecast. Never interpret forecasts as paid revenue. Keep historical recorded amounts visible with provenance; do not invent paid dates or merge customers by phone alone. Pause/end replaces deleting customer history. Repeated completion must generate at most one next occurrence. The live `website-service` inquiry path is part of production acceptance alongside map/manual/booking.

## External readiness receipts required

- Alert recovery: bounded authenticated sweep must be tested locally, then one supported scheduler configured by the friend. Do not assume Vercel Hobby supports minute-level recovery: its cron is daily; Pro supports finer schedules. Existing Supabase pg_cron/pg_net plus Vault is an alternative after verifying project support. Keep recovery secret server-side/Vault; no scheduler is activated by this branch. Verify a deliberately pending synthetic intent is recovered before calling unattended recovery operational.
- Meta: parent read-only Events Manager inspection of account 2096962487924428 showed a welcome/connect-data screen and no accessible dataset verified. This does not establish that none exists elsewhere. Confirm the intended dataset/pixel and access, real destination URLs, actual receipt and browser/server deduplication before claiming end-to-end tracking. Do not silently activate guessed conversions.
- ConviFlo: production forms remain unconnected. An explicitly authorized isolated test verified raw-body HMAC-SHA256 in `X-Conviflow-Signature`, completed/partial event shapes, duplicate delivery and `{street, unit, city}` address fields. The separate `/api/intake/conviflo` adapter requires `CONVIFLO_WEBHOOK_SECRET` and a `CONVIFLO_FORMS` allowlist with explicit services/address field and optional Meta UTM ID mapping. Configure actual production form IDs and field mappings from each form; do not copy synthetic test IDs. Partial events are acknowledged without alerts; completed submissions require address and stable form/response identity. The canonical Bearer endpoint stays separate. Test production setup with designated synthetic contacts before claiming connected.
- Staff dispatch configuration: verify `TWILIO_STAFF_PHONES` contains exactly both approved E.164 recipients, `STAFF_SMS_ENABLED` and `STAFF_VOICE_ENABLED` are true, provider credentials/from number are valid, and `CRM_BASE_URL` is the intended HTTPS origin. `ALERT_RECOVERY_SECRET` protects the sweep endpoint; configure its trusted caller without publishing the secret.
- Attribution: verified ConviFlo synthetic receipts preserved UTMs but omitted supplied synthetic click IDs. Do not infer missing IDs. Configure explicit campaign mapping using `NEXT_PUBLIC_META_UTM_ID_CAMPAIGNS` only for website campaigns known to carry ID macros; a verified ConviFlo form may use its explicit mapping. Google website capture is independent; verify account tags and actual destination receipt separately.

- Creative classification: configure server-only `META_AD_CREATIVES` as an explicit numeric Meta ad-ID to `{creative_id, creative_type}` mapping (`creative_type` is `ai` or `real`). The signed adapter applies known mappings after explicit UTM-ID normalization. Unknown ads stay unknown; no API lookup or inference occurs. Maintain this mapping when new ads are created and verify the resulting label on a controlled receipt.

### Existing ConviFlo form launch changes

Parent read-only inspection found existing production contact copy still calls address/email optional, and out-of-area ZIP exits occur before contact collection. The friend must make address required and collect contact/address before the outside-area ending if a CRM waitlist is intended. Existing flows were not changed. Verify each production form's actual field names, choice values and completed address with a designated dry run before allowlisting it. Mowing choices include mowing-only, mowing + edging, cleanup and regular maintenance: a configured Lawn care category does not replace these selected answers; retain/display them as useful submitted context. The isolated synthetic form receipt does not establish compatibility for all existing flow variants.

## Local verification receipt

Code checkpoint `4650d79148a596c873f0494eac21b17a914b926f`: optimized production webpack build and typecheck pass. Full seeded isolated upgrade covers all eight new migrations, preservation, roles, exact cents, idempotent jobs/payments and recurrence. Browser/HTTP tests cover website map/manual/general intake, signed ConviFlo, four staff alert intents/recovery, staff/customer isolation, mobile property reset, customer history, legacy records, jobs/forecast, portal payments and scheduling email replay. Exact test filenames and historical vendor receipt are in SPINE.md. Provider boundaries were mocked; no live Stripe, email, phone or Meta delivery is claimed. Final independent review result is recorded in the release evidence above.

The test app uses `NODE_OPTIONS='--require ./tests/revamp-network-guard.cjs'` plus dedicated `QG_SMS_MODE`/`QG_SMS_LOG` files under `/tmp/qg-revamp-`. The preload mocks Twilio fetch calls and rejects unexpected fetch destinations. It is not a universal Node networking firewall: keep all real external credentials out of the disposable environment. Run alert-log suites sequentially. Do not copy local secrets/configuration or synthetic form/ad IDs into production.

### Legacy recurring cutover

Existing recurring bookings without an agreement remain visible and contribute to the conservative legacy mowing estimate. Before completing one, staff explicitly reviews/links its customer/property and creates an agreement, or deliberately marks it one-time. The completion guard prevents old recurring clients silently losing their next visit. Do not bulk merge people by phone. Review each existing client's first next date and price; completed historical jobs and prior prices stay intact.

### Recovery and rollback constraints

Choose the last verified deployed application revision on the friend's machine; `f4f7af9` is the historical website receipt, not proof of today's deployment. The additive database changes retain legacy data, but reverting the application after new agreements/payments exist can hide or bypass new workflows. Prefer stopping new external intake/dispatch and a reviewed forward fix; reconcile in-flight provider acceptance. A database restore is a controlled recovery operation with an explicit plan for any records created since the backup, never an automatic down migration.

### Final-review payment safeguards

New dated payment records and historical `amount_charged` records remain separately visible; no reconciliation relationship is invented and they are not combined into a claimed settled balance. Customer portal totals are loaded server-side only for bookings already authorized by customer row policies. New partial/full payments suppress the old full-price Pay link; full payments show paid-in-full. Changing an individual job price clears both its stored and displayed old payment link. Scheduling operation replays do not resend the confirmation email; a local boundary mock verified this without real email.

First-visit prices (including introductory discounts and the already-discounted cleanup total) remain distinct from ongoing price. The authoritative current-job amount is `job_total`, then original `first_visit_price`, then legacy ongoing price. Forecasts use ongoing terms, not introductory discounts. Before starting an agreement, explicitly review future service/discount items; do not carry one-time cleanup or introductory discounts forward unintentionally.

## Current deployment configuration

Read this section instead of the historical SMS-only instructions in `docs/crm-setup.md`. Inspect existing Vercel **Production** values securely and preserve unrelated settings. Verify the target Supabase project before changing anything. Public variables require a rebuild; server settings must be present on the deployment that will receive leads.

| Setting | Required production value or check |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Existing project credentials; no local Docker URL or test key. |
| `STAFF_EMAILS` | Both intended staff emails, matching confirmed Auth users with server-controlled `app_metadata.role = "staff"`. Reuse existing accounts. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Reuse and verify existing live credentials and a number capable of voice and SMS. Prior working calls do not establish SMS delivery. |
| `TWILIO_STAFF_PHONES` | Exactly two distinct approved numbers in international format, comma-separated. This release has **no singular/owner-number fallback**. Verify recipients with the owners. |
| `STAFF_VOICE_ENABLED`, `STAFF_SMS_ENABLED` | Both `true` for the approved live acceptance and ongoing operation. Missing flags disable that channel. |
| `CRM_BASE_URL` | Canonical HTTPS origin, normally `https://quietgreen.co`; verify actual deployed domain. Never localhost. |
| `ALERT_RECOVERY_SECRET` | Server-only random secret, at least 32 characters, shared securely with the trusted recovery scheduler. |
| `CONVIFLO_WEBHOOK_SECRET` | Signing secret matching the production ConviFlo webhook; at least 32 characters. Not the local test secret. |
| `CONVIFLO_FORMS` | JSON mapping of actual production form IDs to explicit `services` and `address_key`; enable `map_meta_utm_ids` only for forms using the verified numeric Meta macros. |
| `META_AD_CREATIVES` | Actual Meta ad IDs mapped to `creative_id` and `creative_type` (`ai`/`real`); never use test IDs. |

Optional website Meta settings (`NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_META_LEAD_EVENTS_ENABLED`, `NEXT_PUBLIC_META_UTM_ID_CAMPAIGNS`) require verified event ownership and campaign IDs before activation. Keep existing Google/Maps/payment/email settings unless the reviewed release requires a concrete change. No new Stripe billing or CAPI integration is introduced.

ConviFlo webhook destination is `https://quietgreen.co/api/intake/conviflo` after confirming the canonical domain. Its HMAC header is `X-Conviflow-Signature`. Configure and verify **each real form**; the previous isolated test form is not a production mapping. The last inspected landing-page form had no webhook or Pixel configured.

Recovery endpoint: `POST /api/staff-alerts/recover` with `Authorization: Bearer <ALERT_RECOVERY_SECRET>`. Choose a supported scheduler that can send this POST/header securely; a plain Vercel cron URL entry issues GET and does not match this endpoint. Test the chosen scheduler without indiscriminately replaying historical disabled alerts. Inspect pending/disabled/unknown backlog before first enabling recovery; uncertain provider sends require reconciliation, not blind retry.

## Current release receipt — 23 October 2026

- Application checkpoint: **`988ca9f95475235832a14bbfd4b0b7d77a96c407`**, branch **`codex/crm-revamp`**. Subsequent receipt/test-selector changes do not change application behavior. Includes public-site main `72f3c68aeb7490afa20ef06b22cee11d6be8caf4`; preserve newer main changes too if any arrive before deployment.
- Preserved redesigned staff screens, customer/job/plan model and money presentation. Corrected quote-origin selection, final lead version after booking, partial cancellation error reporting, explicit cancellation preview, changed-address recovery, and revised-price rebooking without overwriting prior accepted job snapshots.
- Optimized production build and TypeScript passed for this application checkpoint. Scoped lint of the changed quote actions/workspace/helper, customer actions and public inquiry files passed. Full repository lint is not claimed clean; existing admin page `any`/unused compatibility arguments remain outside this fix.
- Real isolated database upgrade passed: existing-row preservation, role isolation, exact amounts, identity, recurrence and idempotency, including the customer-job migration. No production database was queried or changed.
- Local connector/browser checks passed during this release: `crm-alerts.py`, `crm-conviflo.py`, `service-inquiry.py`, `crm-map-booking.py`, `crm-customer-actions.py`, `crm-lifecycle-ui.py`, `crm-portal-payments.py`, `crm-integration.py`, `crm-quote-cancel.py`, `crm-mobile.py`, `crm-workflow.py`; forecast and creative-registry tests passed. Final integration/cancellation/mobile/full-workflow checks ran against `next start` using the optimized build, avoiding the development overlay. The cancellation test includes changing the new price to $87.25, preserving old snapshots, immediate note saving after booking and later recurring cancellation keeping the original quote accepted.
- Independent GPT-6 Astra standards/security review found no additional P1/P2 issues. Spec review’s canceled-quote rebooking finding was corrected and closed on re-review.
- Tests used a separate local application copy on port 3104, local Supabase 56421/56422 and mocked provider boundaries. The previously captured real signed synthetic ConviFlo receipt remains the vendor-contract evidence. No real calls/texts, live Meta events, publication of production forms or production deployment is claimed.

### On Paxton’s laptop

1. Fetch `origin/codex/crm-revamp` in the `foxythebandit/lawncaresite` repository. Preserve any local work; use a clean checkout. Read this document, AGENTS.md and SPINE.md. Verify the release includes the checkpoint above and current main.
2. Inspect the existing Vercel/Supabase targets and migration history; take a current recoverable backup. Apply only verified unapplied migrations, preserving existing rows and accounts. Do not blindly replay the historical backup/alignment migrations.
3. Verify the current configuration table above, deploy the matching application, and check staff login and existing customer/job records before introducing ad traffic.
4. Verify controlled website and ConviFlo submissions, exact available source/ad IDs, both real calls and SMS, working protected quote links and duplicate protection. Inspect the notification backlog before enabling scheduled recovery.
5. Connect each actual ConviFlo form and verify the selected Meta/Google conversion goals and destination receipt. **CRM deployment and ad launch are separate gates**: CRM source capture is locally verified; live ad-platform reporting and production form configuration still require this acceptance.

Do not copy `.env.local`, local test users, synthetic form/ad IDs, or temporary tunnel addresses to production. Finish by recording the deployed commit, migration results, preservation counts and actual call/SMS/event receipts.

## Production deployment receipt — 23 October 2026 (Paxton's laptop)

- Deployed commit **`f7a3552`** (`codex/crm-revamp`, fast-forwarded onto `main` from `72f3c68`). Vercel production deployment `lawncaresite-3omm6s89r` is Ready and aliased to `quietgreen.co` and `www.quietgreen.co`.
- Before migrating: prod history matched the repository through `20261022000000`, and none of the CRM tables existed. A JSON export of every public table was taken locally (26 bookings, 28 leads, 0 quotes, 3 extra charges, 4 intake events, 7 staff alerts). Both Auth users (Caelan and Paxton) are confirmed with `app_metadata.role = staff`.
- Rehearsal: all nine migrations ran against real prod data inside a transaction that was forced to roll back. Counts and ID hashes were unchanged, and nothing persisted.
- Applied with `supabase db push`: the nine migrations listed above, `20261022215624` through `20261023000000`. Afterwards the bookings/leads counts and ID hashes matched the backup exactly. anon/authenticated have no select on the new CRM tables and no execute on `record_intake_v2`/`crm_job_command`. Every public table has RLS enabled.
- Vercel production env added: `STAFF_SMS_ENABLED=true`, `STAFF_VOICE_ENABLED=true` and `ALERT_RECOVERY_SECRET`, which is also saved in the main checkout's gitignored `.env.local`. ConviFlo (`CONVIFLO_WEBHOOK_SECRET`/`CONVIFLO_FORMS`) and `META_AD_CREATIVES` are deliberately unset, so the ConviFlo endpoint returns 503.
- Smoke checks: `/` 200, `/admin` 307 to login, `/portal/login` 200, ConviFlo 503, recovery endpoint 401 without the bearer token.
- Live acceptance: one synthetic `website-service` inquiry ("TEST Release Check (ignore)", fictional 555 number) created one v2 intake event and four alert intents, to two distinct recipients ending 8260 and 6158. Twilio accepted all four about 1.6 s after intake. **Both voice calls rang (confirmed by Caelan and Paxton). Both SMS were undelivered with Twilio error 30034**: the account has no A2P 10DLC brand/campaign and no Messaging Service, so carriers block texts from +1 512-643-5722.
- Not done live: duplicate-retry replay (covered by local tests and the unique `(source, submission)` constraint), protected SMS-link login (blocked by SMS delivery), ConviFlo intake, recovery scheduler, Meta/Google conversion receipt.

### Open items
1. Register A2P 10DLC in the Twilio console (Sole Proprietor or Low-Volume Standard brand, plus a campaign for staff lead notifications), attach the number through a Messaging Service, then resubmit a synthetic lead and confirm both texts arrive with working quote links. A toll-free number with toll-free verification is the alternative.
2. Mark the synthetic "TEST Release Check (ignore)" lead lost in the CRM.
3. Configure a POST-capable recovery scheduler only after reviewing the pending/undelivered alert backlog.
4. Connect the real ConviFlo forms and the Meta dataset before the ad launch. The "New Leads Ad" draft is in the Quiet Green ad account (2240549216693180), not the personal account.

### Update — 23 October 2026, ConviFlo connected and texts off
- `STAFF_SMS_ENABLED=false` (owners no longer want texts); voice is still on for both staff numbers. New SMS intents are recorded as `disabled` with 0 attempts.
- ConviFlo "landing page" form (`05212679-7c8d-4034-9a43-53b48a336548`, `conviflo.com/f/landing-page`) is connected. The webhook goes to `https://quietgreen.co/api/intake/conviflo`, and the signing secret matches Vercel's `CONVIFLO_WEBHOOK_SECRET` (a local copy is in the main checkout's gitignored `.env.local`). `CONVIFLO_FORMS` maps it to service "Lawn mowing", `address_key` "address", with Meta UTM-ID mapping on. The other three live forms are not connected.
- Commit `4ee0e22`: ConviFlo leads without an address are accepted with `answers.address_missing = true`, and the CRM shows "Address not yet provided". The canonical Bearer endpoint still requires an address.
- Verified on production:
  - A signed synthetic delivery returned 201, and the identical retry returned 200 with `duplicate: true` (one intake event, four intents).
  - A signed addressless delivery was saved.
  - A real submission through the live public form reached the CRM 1.3 s after submit, with answers, ZIP and the test UTMs kept. Both calls completed (3–4 s) and there were no duplicate events after ConviFlo's retry window.
- The question slides use generic field keys (`choice`, `choice_2`, …). Renaming them in ConviFlo would make CRM answers easier to read. It only affects leads captured after the change.
- Meta: dataset 27435240816118469 is connected only to ad account 2240549216693180, not to 2096962487924428.
