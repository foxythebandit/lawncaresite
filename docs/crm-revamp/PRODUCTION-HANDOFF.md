# QuietGreen CRM — friend's machine handoff

**Reviewed implementation handoff; production activation requires preflight.** Implementation, local tests and independent Astra review are complete. The code checkpoint below is followed only by the documentation commit containing this receipt. The friend runs deployment/migrations on his machine using his existing credentials; do not place secret values in this document.

## Release evidence

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
- Local upgrade/preservation tests: **full isolated seeded upgrade passes through the scheduling-replay migration; website/CRM regression suites and final optimized production rebuild pass**
- Final Astra review: **no remaining P1/P2 findings at the code checkpoint; all six review findings closed and first-visit/presentation preservation reviewed**
- Hosting target, actual deployed revision and migration history: **verify on friend's machine**
- Rollback application revision: **verify current deployed revision on friend’s machine; recovery constraints below prohibit destructive down migrations**

## Prompt to use after the branch is complete

You are deploying the reviewed QuietGreen CRM revamp from my machine. Read `AGENTS.md`, `docs/crm-revamp/SPINE.md`, this release evidence, the actual changed migrations and relevant installed framework/skill guidance before acting. Use my existing Supabase project, hosting and Twilio setup; my keys are available locally. Do not print or commit secrets. Do not provision replacement services or rewrite the marketing site.

First verify that the reviewed branch/commit and test evidence are populated and match the working tree. If they are still pending, stop deployment preparation and identify the missing release evidence. Do not treat a planning document as a completed implementation.

Inspect the actual target database schema, migration history, permissions/policies and deployed application version before choosing any migration command. Compare them with the reviewed branch. Existing SQL files or local test passes do not prove production matches. In particular, this repository already contains migration-history alignment and a historical backup-copy migration; do not blindly rerun either. Stop on an unexplained mismatch and produce a concrete reconciliation plan that preserves existing records.

Inventory existing leads, quotes, bookings, extra charges, relationships and relevant storage artifacts. Make a current recoverable backup using the project's available facilities and confirm how restoration works. The historical backup tables alone are not the current recovery plan. Record non-sensitive counts and preservation checks. Do not delete, reset, truncate or replace production data; do not silently merge customers by phone or fabricate historical attribution.

Test the reviewed migration sequence against an isolated representative copy or suitable staging database first. Verify row counts, identifiers, existing bookings/customer access, legacy links, quotes and acquisition data survive. Check the changed permissions using anonymous, customer and staff roles. Never run disposable test bootstrap/reset scripts against production. Explain any migration that cannot safely be reversed and the data-preserving recovery approach before production execution.

Inspect configuration names from the completed implementation, without exposing values. Confirm both intended staff accounts, role/allowlist settings, protected-login return paths, canonical HTTPS CRM origin and both approved recipient numbers. Verify the ConviFlo adapter against actual documented/captured payload, authentication, stable submission identity and retry behavior. Do not assume native CAPI is available: it was marked SOON with no integrations connected during planning.

The non-negotiable lead behavior is: every new website or ConviFlo lead generates a Twilio attention call and an SMS to **each of Caelan and Paxton**. Calls need not be answered and must not bridge to the customer. Voice and SMS start independently, not one after another. SMS contains customer name, customer phone, address, services, useful answers and a protected direct link into the prefilled quote workspace. Full source/ad/creative details remain in the CRM. The confirmed requirement is 24/7 alerts; do not invent quiet hours.

Prepare the concrete deployment/migration sequence and acceptance test before seeking any needed final release approval. Confirm the intended target and authorization for real test calls/texts, with designated safe test contact data and both staff recipients. Do not notify real leads or emit live acquisition events as an accidental side effect of testing. Run production changes only within that authorization.

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
