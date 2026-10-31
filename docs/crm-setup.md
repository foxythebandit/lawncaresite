# QuietGreen CRM lead workspace

> Historical implementation receipt for the earlier lead-workspace branch. Current requirements, configuration and release instructions are in [CRM SPINE](crm-revamp/SPINE.md) and [production handoff](crm-revamp/PRODUCTION-HANDOFF.md). The revamp uses dual voice/SMS alerts, required new addresses, a verified signed ConviFlo adapter, accepted-quote jobs and local app port 3102. Do not use the older SMS-only setup or test commands below to deploy the revamp.

Local implementation on `feature/crm-lead-workspace`, based on origin/main `2ff9f4562723a2158905326af25b30bb9f5fcf04`. Nothing has been deployed or applied to production. The older checkout was not edited.

## Project-manager handoff — 2026-10-21

**Built locally; not live.** This is a review branch, not a deployed release. Reuse the existing Supabase project, Twilio account/number, hosting and your friend's ConviFlo account. No new accounts or paid services are required by this implementation. Production configuration has not been inspected; local credentials are disposable test credentials, not evidence that production is ready.

| Feature | What staff/customers can do | Status |
| --- | --- | --- |
| Protected staff workspace | Sign in with an individual password, follow a lead SMS link through login, view contact/answers/source, call via the phone link, sign out | Built and tested locally. Two real accounts and allowlist still need provisioning |
| Website inquiries | Submit map/manual/legacy inquiries; safe retries create one durable inquiry; explicitly start a new manual inquiry | Built and tested locally |
| Quote work | Open prefilled property/frequency/services, draw or enter area, restore unfinished work, save notes/add-ons/override, confirm quote | Built and tested locally. Real property imagery/provider configuration and visual review still needed |
| Booking and outcomes | Explicitly create pending booking from confirmed quote, confirm date, complete job, record payment, retain acquisition on recurring visits | Built and tested locally. Payment recording is not proof of processor settlement |
| Customer isolation | Portal reads only its own bookings and approved display columns; internal notes/acquisition are unavailable through REST | Built and tested locally; production policies must pass preflight |
| Staff SMS | Both configured recipients get a summary plus protected quote link; staff sees retry/delivery/uncertain status | Built with simulated provider tests. No real SMS sent; actual Twilio readiness and receipt unverified |
| ConviFlo ingestion | Canonical authenticated endpoint accepts answers/attribution and deduplicates stable submission IDs | Partial: tested QuietGreen fixture only. Actual ConviFlo contract, mapping and delivery blocked on friend |
| Attribution/reporting | Preserve first/latest tagged visits and acquisition snapshots; show distinct confirmed-booking conversion | Built/tested locally; no historical phone-based link inference, unknown tags stay unknown |
| Meta | Optional website browser Lead after durable intake, stable event ID; ConviFlo events not echoed | Implemented, disabled unless configured; live account/event audit pending. No new CAPI or payment events |
| Operations | Inspect SMS failure/uncertainty manually | No background retry worker, automated reconciliation or password-recovery UI added |

### Independent review outcome

A separate **GPT-6 Astra** reviewer inspected security/spec behavior and another independently checked documented standards. Standards review found no substantiated violations. Spec review found two high-priority issues (customer access to internal columns/notes; conditional exposure from unexpected deployed policies) and four medium issues (addressless booking, dropped add-ons, silent delete failure, manual identity never resetting). All six were fixed locally. The second pass found an empty-services aggregation bug; it was fixed and covered by a real database upgrade test.

Customer access now uses explicit database column grants, not merely hidden UI. Staff notes stay in `notes`. The migration aborts on unknown booking policies or pre-existing column grants for review. Booking uses the saved quote address and includes add-on details, last-mow and overgrowth. History-bearing leads are deliberately retained, with a visible explanation on deletion; archive functionality is not included. Manual forms offer “Start a new inquiry” before and after success. A separate SMS formatting fix removes GSM extension separators and constrains the origin so the two-segment bound is meaningful.

### Ordered next actions and owners

Here **YOU** means the implementation agent; **USER** means the business/account owner; **FRIEND** means the ConviFlo owner.

1. **YOU — completed locally:** implement, independent review, fixes, local regression/upgrade tests, prepare this handoff and read-only `docs/crm-production-preflight.sql`.
2. **USER — provide non-secret decisions:** canonical HTTPS site origin, and confirmation of which existing Supabase/Twilio/hosting projects are in use. Do not send passwords or API keys in chat. The user supplied both intended staff users and recipients: Caelan — `liucaelan@gmail.com`, `+19798886158`; Paxton — `paxonearth.22@gmail.com`, `+16823528260`. Both will receive alerts once approved and configured. Paxton’s existing account-side number has not been verified.
3. **FRIEND — supply integration evidence:** redacted real submission JSON and headers; exact webhook setup screen/docs; stable submission ID; retry/timeout semantics; ability to set Authorization headers/map fields; signature scheme if required; form/version/consent fields; UTMs/click IDs/creative IDs; current Pixel/CAPI events and event-ID ownership. Confirm the existing Max plan actually supports these capabilities. No purchase or new account is assumed.
4. **YOU — after that evidence:** implement/test the smallest verified ConviFlo adapter if needed. Repeatedly deliver the same fake fixture to a local/staging endpoint and show one inquiry and one alert per recipient. Prepare the final production diff and migration review. No real ad events.
5. **USER + YOU — production preflight:** obtain a current backup/snapshot through the existing project's available backup mechanism; run the read-only preflight against the correct existing project, inspect actual schema/history/policies/privileges, and compare all required columns/defaults. Rehearse against a disposable copy where available. The new RPC populates full records, so additional deployed required columns/defaults need explicit compatibility review. Unknown schema/policy results block application; do not suppress the guard or replay historical migrations.
6. **USER — approve the concrete production change:** identify project, migration, release, two accounts, both recipients, and bounded live test. This is separate from reviewing code. No production migration, account grant, deployment or live message has occurred.
7. **YOU/USER — coordinated rollout after approval:** provision/verify staff accounts as below; configure existing hosting environment with flags off; apply only the reviewed new migration in one transaction and record it in migration history using the project's established process; deploy the matching app immediately. Column restrictions require the updated portal query, so use a short maintenance window. Check public intake, staff login and customer portal before enabling SMS. Do not reset production. If rollout fails, pause intake and use the reviewed rollback/backup plan; reverting only app code may break the portal under new grants.
8. **USER + YOU — approved live acceptance:** temporarily enable SMS for the two designated test recipients, run the fake-lead checklist below, inspect Twilio delivery and the phone, then approve ongoing alerts. **FRIEND + YOU** connect the actual form only after mapping passes; agree event ownership before enabling any real ad tracking.

### Exact two-user Supabase provisioning (existing project; not executed)

1. Open the correct existing Supabase project. Under **Authentication → Users**, search both intended email addresses first. Reuse existing users rather than creating duplicates. For a missing user choose **Add user → Create new user**, enter that person's email and an individual strong password, and enable **Auto Confirm User** only after the owner verifies that email belongs to the person. Do this separately for each of the two users. Record their UUIDs. This is project-admin provisioning, not the website's customer signup.
2. Set **administrator-controlled `app_metadata.role` to `staff`** for each verified UUID. Do not set `user_metadata.role`; it grants no access. The supported admin API is `supabase.auth.admin.updateUserById(userId, { app_metadata: { ...existingAppMetadata, role: 'staff' } })`, run only from a trusted server/admin session using the existing project's secret key. First fetch the user by UUID and verify the email, preserve other app metadata, and check the returned error. If the Dashboard does not offer an app-metadata editor, use this API; do not paste a secret key into the browser console. [Supabase admin update reference](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).
3. In the existing hosting project's server environment set `STAFF_EMAILS` to the two exact emails separated by commas. Redeploy to apply it. Empty configuration denies all staff access. Both confirmed email and server-managed role are required in addition to this allowlist. Existing customer magic-link signup stays available and never assigns a staff role.
4. Check **Authentication → Sign In / Providers → Email** is enabled. In **URL Configuration**, set Site URL to the canonical HTTPS website and allow the exact production `/portal/auth/callback` URL used by the existing customer magic-link flow; keep only intentional preview/local URLs. `/admin/login` uses password auth and a validated internal `next` pathname, not a new magic-link callback. Do not add a broad wildcard just to make staff login work. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
5. Existing password login does not require sending email. Invitations, recovery and the existing customer magic links do: inspect the project's existing SMTP sender/delivery. Supabase's default sender is restricted and unsuitable for general production customer delivery; reuse the existing SMTP setup if present. No new email provider is selected here. A staff reset-password UI was not added; use the controlled admin process until one is requested. [Supabase SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).
6. Test both accounts independently and sign out between them. Confirm a customer and a role-bearing account outside the allowlist cannot enter `/admin`, including direct URLs/actions. Staff verification runs on each privileged action and uses current server-returned user data; do not rely solely on the UI or a stale JWT claim. Review the existing project's session timeouts/revocation settings without changing them silently. Removal from allowlist/role must be checked with an already-open session as a production acceptance test; comprehensive session expiry/revocation testing remains pending.

### Configuration inventory — names only

Set production values in the **existing hosting project's environment settings**, with server-only variables never prefixed `NEXT_PUBLIC_`. Use a separate preview configuration if testing previews. Public values are included in the client build, so rebuild after changes. Local `.env.local` is ignored and contains fake test setup only. Every actual production value below is **unverified**, not necessarily absent.

| Names | Purpose / required action |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing Supabase project URL and public key; reuse/verify |
| `SUPABASE_SECRET_KEY` | Existing server-only secret; guarded DB access and signed lead reference. Never expose in client code or chat |
| `STAFF_EMAILS` | New server allowlist; `liucaelan@gmail.com,paxonearth.22@gmail.com` (provided by user; not applied) |
| `CRM_BASE_URL` | Canonical HTTPS origin for protected SMS links; no path/query; actual origin must be confirmed |
| `STAFF_SMS_ENABLED` | Keep false/unset until approved live test; set true only deliberately |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Existing Twilio account credentials and SMS-capable sender; actual configuration unverified |
| `TWILIO_STAFF_PHONES`, legacy `TWILIO_STAFF_PHONE` / `TWILIO_OWNER_PHONE` | Set plural variable to `+19798886158,+16823528260`. It takes precedence; singular/owner names remain one-number fallback. Each recipient has separate durable status/retry |
| `INTAKE_WEBHOOK_SECRET` | New random server-only secret, at least 32 characters; securely share with verified ConviFlo sender/adapter, never browser form code |
| `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_META_LEAD_EVENTS_ENABLED` | Existing optional Pixel ID; Lead opt-in disabled until ownership/account audit. No CAPI token is used |
| `NEXT_PUBLIC_MAPBOX_TOKEN`, `REGRID_TOKEN` | Existing optional property/map integrations; verify current behavior without buying replacement services |
| `RESEND_API_KEY`, `STRIPE_SECRET_KEY` | Existing customer email/payment-link features; preserve if configured. Local lifecycle tests do not prove live email/payment processing |
| `ADMIN_PASSWORD`, `ADMIN_TOKEN` | Obsolete shared-password access; remove only after successful rollout. Old admin cookies no longer grant access |

Supabase Site URL, redirect allowlist, email provider and SMTP are project Dashboard settings, not new app environment variables. Twilio number registration/verification is an account setting. ConviFlo authentication/mapping/event ownership is configured in the friend's existing integration.

### Twilio account checks and bounded live test

In the existing Twilio Console verify account/subaccount ownership, active billing/trial restrictions, the actual From number's SMS capability, destination country permissions and the designated recipients. For a US local 10-digit sender, inspect its approved A2P 10DLC brand/campaign/number association; toll-free uses toll-free verification instead. Registration type and approval are unknown until checked. Do not assume staff-only notifications bypass carrier requirements. Trial accounts have restrictions, including destination verification. [Twilio A2P](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), [toll-free onboarding](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding), [trial limits](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account).

The app reuses existing credential names and sends through Twilio Messages; no old automatic lead call/Pushover/internal lead email remains. Customer confirmation/reminder emails are separate existing operations. After explicit approval, submit one fake inquiry to both designated staff numbers, match each recipient’s Message SID in Console, use CRM “Check delivery,” and confirm receipt/opening on both actual phones. An accepted SID alone is not a pass. Failed/undelivered states need the real Twilio error code resolved; unknown/sending states require log reconciliation before any resend. This has not been done live.

### Rollout acceptance checklist

Use a clearly labeled fake customer and safe contact details. Avoid real ad clicks/events until separately approved.

- Submit one tagged fake lead; verify first/latest source, campaign/creative, answers and consent as supplied. Repeat same submission ID/content: same lead/event, no duplicate SMS. Changed content with that ID must conflict.
- Receive exactly one staff SMS at each approved number; verify SID/delivery and phone receipt. Open the link signed out, log in as each approved staff user, and return to that exact lead. Customer/outsider must be denied.
- Confirm property/contact/services are prefilled. For an addressless inquiry enter an address, measure, choose an add-on, add private notes, save/reload unfinished work, finish and confirm quote. Opening/saving alone must create no booking or alert.
- Tap Call and verify the dialer contains the intended safe test number; make an actual call only if included in the test approval. The app does not record call outcomes automatically.
- Explicitly create one pending booking, verify address/add-ons/prices, confirm the agreed date, complete the fake job and record a clearly identified test payment outcome. Verify stage times and recurring acquisition; pending requests are not conversions and repeated visits do not multiply converted leads.
- Check customer portal still shows only that customer's display fields. Direct REST selection of internal notes/attribution/lead IDs must fail. Check removal of staff access with an existing session.
- Verify no duplicate Google/Meta conversion goals and agreed ConviFlo/browser ownership before enabling events. Capture evidence and remove/label test data through an approved retention process; history-bearing leads cannot be silently deleted.

## Staff authentication

Set server-only `STAFF_EMAILS=liucaelan@gmail.com,paxonearth.22@gmail.com`. These addresses were provided by the user; production configuration and accounts have not been changed. Empty configuration denies access. Each account must be manually provisioned in Supabase Auth, have a confirmed email, its own password, and administrator-controlled `app_metadata.role = "staff"`. User-editable metadata is never trusted. Provisioning real accounts requires separate approval.

Staff login uses email/password and the existing cookie-aware Supabase SSR client. Proxy refreshes sessions, and every privileged server action/read checks the verified user again. Customers who sign up through `/portal` cannot assign the staff role. The server allowlist is an additional independent check. Logout clears the session. Deep links retain only an internal `/admin/...` pathname through login; external destinations, query strings, backslashes, fragments and traversal syntax are discarded. No staff signup UI exists.

Remove obsolete `ADMIN_PASSWORD` / `ADMIN_TOKEN` configuration after rollout. Old `qg_admin` cookies confer no privilege.

## Database rollout (not executed on production)

Review and apply `supabase/migrations/20261022000000_crm_lead_workspace.sql` to the existing database **before** deploying this code. Back up and inspect the actual schema/policies first. Historical repo migrations do not fully describe the deployed schema: duplicate `002` filenames, completion preceding table creation, and missing `status`, `confirmed_date`, and `notes` definitions prevent a clean historical replay. The disposable test baseline adds these existing application prerequisites; this does not establish the actual production migration history. Do not blindly reset or replay all migrations against production.

The new migration:

- Removes broad authenticated reads and anonymous direct writes to CRM data. Grants service-role access explicitly. Customers can select only approved portal columns on bookings matching their authenticated email; leads, quotes, intake events and staff alerts are inaccessible to customers.
- Adds explicit `bookings.lead_id`, acquisition snapshots, quote drafts and stage timestamps.
- Atomically inserts an inquiry, optional pending booking, intake event and staff alert outbox through a service-role-only `SECURITY INVOKER` function. Concurrent retries use a transaction lock and a unique source/submission key. Conflicting payloads are rejected. JSON key order does not affect deduplication.
- Backfills existing manual-quote bookings into leads using their explicit booking IDs, without phone matching. Historical map leads are not guessed into bookings; those links remain unknown.
- Enables RLS on both new tables, indexes foreign keys, and restricts function execution. Staff access goes through server-only guards, not a broad authenticated database policy.

## Intake and stages

Map phone gate, manual quote form, legacy quote form and booking requests use durable CRM intake. Manual requests no longer create pending bookings. A booking request is `pending`; it is not a sale. The signed lead reference returned from the phone gate is kept in the browser tab, never in a URL, and explicitly associates a later booking. Independent booking submissions create their own inquiry. Form submission IDs survive retries and tab reloads; starting over in the map or choosing “Start a new inquiry” on the manual form starts a new submission. A changed payload with an already-used ID is rejected rather than creating a second alert.

The workspace at `/admin/leads/<opaque UUID>` shows known contact details, services, timing, answers and attribution. It reuses `MapQuoteBuilder` itself, including mowing, frequency, seasonal overgrowth, travel, first-visit discount and add-on pricing. Staff can trace, save unfinished points, restore measurements/add-on inputs, add notes and set a per-visit price override. Saving a draft or confirming a quote does not create a booking, notify anyone, or emit acquisition events. A confirmed quote can explicitly create one pending booking request; scheduling confirmation remains in the existing Bookings UI. An override is also the first-visit price for that staff-created request; otherwise the builder's calculated first-visit price is used.

Stages are distinct: inquiry (`created_at`), draft (`quote_saved_at`), confirmed quote (`quote_confirmed_at`), booking request (`bookings.created_at`), confirmed booking (`confirmed_at`), completed job (`completed_at`), and recorded payment (`payment_recorded_at`, amount and method). Recording a payment is a staff assertion, not a payment-processor settlement confirmation. Existing recurring copies now keep the lead ID and acquisition fields. Lead conversion reporting counts distinct leads with confirmed/completed bookings, never pending requests or phone matches. Multiple recurring visits count as one lead conversion. External scores/estimated values remain separate from charged amounts.

## Staff SMS

Existing code names are reused: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `TWILIO_OWNER_PHONE`. Set `TWILIO_STAFF_PHONES` to the comma-separated list of both approved E.164 recipients. It overrides singular `TWILIO_STAFF_PHONE` and the existing `TWILIO_OWNER_PHONE` fallback. There were no local environment files in either checkout to inspect for configured values; no production environment was fetched. Secret values are not documented here.

Set `CRM_BASE_URL` to the canonical HTTPS site origin and explicitly set `STAFF_SMS_ENABLED=true` only for an approved live test, then retain it only after acceptance. With the flag absent or credentials missing, the saved alert is marked `disabled` and remains visible in the lead workspace. The new intake pipeline replaces its old Pushover + voice + internal email notifications with a staff SMS path with one message per configured recipient; it does not invoke `callLead`. Existing customer confirmation/reminder email actions remain in place.

Messages include available name/address/services/timing and a protected quote link. The summary uses a restricted single-unit GSM character set and is capped at 306 characters total (two concatenated GSM segments), including the link. Truncated/full answers stay in CRM. The opaque link still requires staff login.

The outbox survives provider failure. States:

- `pending` / `disabled`: not submitted; explicit staff retry can claim it.
- `sending`: the request process claimed it. A crashed process can leave this state; reconcile provider logs before resending.
- `accepted`: Twilio returned a Message SID; this does **not** mean delivered.
- `delivered` / `failed`: staff's “Check delivery” performs an authenticated read of Twilio's Message resource.
- `unknown`: timeout, transport failure, ambiguous response or server error. No automatic resend; reconcile with Twilio first.

The atomic intake creates a durable unresolved alert intent. Before sending, dispatch expands it into unique event/recipient rows and removes the unresolved row only after all recipient rows are durable. Recipients are then fixed for that event; later configuration changes apply to new events, not already resolved ones. A compare-and-set claim per recipient prevents simultaneous duplicate sends. Explicit retries target only that recipient and never resend an accepted sibling. Known API rejection without a SID can be explicitly retried. A provider-accepted message is never blindly resent. There is no new scheduler or hosting; retry/status controls are in the lead workspace. Review pending/disabled/unknown alerts operationally. An eventual background worker can use this outbox if required, but it is not installed by this change.

## Canonical external intake / ConviFlo prerequisites

`POST /api/intake` accepts JSON up to 32 KiB and requires `Authorization: Bearer <INTAKE_WEBHOOK_SECRET>` (server-only, random secret of at least 32 characters). Use HTTPS in production; do not put the secret in the URL. Authentication fails closed. Successful new submissions return 201; duplicate submissions return 200 with the same lead/event IDs; changed content using an existing ID returns 409. Validation errors return 400/415/413; transient persistence failures return 503, for retry with the **same** submission ID.

`tests/fixtures/canonical-intake.json` is the tested **QuietGreen contract**, not a claimed ConviFlo payload:

| Canonical field | Mapping requirement |
| --- | --- |
| `version` | Integer `1` |
| `submission_id` | Stable vendor submission identifier, 8–128 alphanumeric/underscore/hyphen characters |
| `form_version` | Stable form identifier and version |
| `contact` | Name, required phone, optional email/address |
| `services`, `frequency`, `timing`, `answers` | Explicit selected services and bounded answer object |
| `attribution` | UTMs, Google/Meta click IDs, explicit campaign/ad-set/ad/creative tags; optional first/latest touch objects |
| `consent` | Actual granted boolean, shown text/version/timestamp; omit if unknown |
| `score`, `estimated_value` | Optional numeric external estimates; never actual revenue |

Official [integrations](https://conviflo.com/features/integrations) and [server-side events](https://conviflo.com/features/server-side-events) pages were reviewed on 2026-10-21. They advertise per-submission webhooks and attribution context, but do not establish exact JSON keys, signatures, secret headers, retry rules or stable event IDs. No authenticated ConviFlo app or real delivery was tested.

Still required: a redacted real payload, stable submission/event ID semantics, exact authentication/signature support, whether custom Authorization headers and mapping are configurable, retry/backoff/timeout behavior, form/version fields, actual consent evidence, attribution fields, and enabled ad event ownership. If ConviFlo cannot produce this canonical contract, implement the verified adapter after seeing its real contract. Do not assume this endpoint can be pasted into ConviFlo unchanged.

## Attribution and Meta ownership

The first tagged acquisition visit is fixed for 90 days; the latest tagged visit updates on tagged arrivals. Untagged/direct visits preserve both; they do not invent “organic” attribution. The booking and recurring visit retain the inquiry's acquisition snapshot; later browser visits do not rewrite the original lead record. Browser local storage avoids overflowing a cookie with multiple attribution snapshots; old `qg_attr` cookies can be read for continuity. Source URL retains only the origin, excluding query/path personal data. Missing fields are unknown. Explicit tags are `meta_campaign_id`, `meta_adset_id`, `meta_ad_id`, `creative_id`, and `creative_type` (e.g. `ai` or `real`), alongside UTMs and click IDs. A click ID does not reveal an ad ID. `_fbp` is read when present; `fbc` is derived from a captured `fbclid` or an existing `_fbc`. Attribution from clients is descriptive, not authorization or proof of a sale.

Active map events were Google-only; legacy `QuoteForm` had a standalone Meta Lead call. Public Pixel PageView remains optional. Direct loads of `/admin` and `/portal` omit public analytics components; already-loaded third-party scripts across client-side navigation require a separate live audit, and staff use of the shared quote builder suppresses acquisition events. `NEXT_PUBLIC_META_LEAD_EVENTS_ENABLED=true` opt-in enables website browser Lead only after durable map/manual/legacy intake, using the persisted intake event ID and per-tab replay suppression. No form answers, contact data, scores or estimated revenue are sent by this implementation. No new CAPI requests are made.

Event owners: website browser owns website Lead; ConviFlo owns ConviFlo Lead/pixel/CAPI deduplication. CRM ingestion never echoes ConviFlo Lead. Booking requests are not Purchase events. Future confirmed-booking/payment server events require agreed event names, actual stage data, consent policy and integration approval; they are deliberately not emitted here. If website CAPI is added, it must share this same `event_id` with the browser. Existing Google conversion configuration still needs an account-side audit for duplicate conversion goals. Attribution is incomplete where tracking is blocked or identifiers are absent.

## Verification

Tests use real disposable local Supabase Auth/Postgres/PostgREST plus a running Next app. Only actual external systems (Twilio and map/analytics requests) are mocked at their network boundaries. Real staff/customer users are created **only in the disposable local Auth instance**, using reserved `.test` emails. No live SMS/calls, Meta events, production users or production database operations are authorized by this implementation.

- `tests/crm-integration.py`: canonical intake authentication/validation, concurrent retries/conflicts, customer data isolation, email login/deep links/logout, persisted draft, anonymous replay of a privileged action, no alerts on reload, provider rejection/retry/acceptance/delivery/unknown outcomes for two fake recipients, targeted retry without resending the sibling, exact recipient send counts on replay.
- `tests/crm-workflow.py`: public form intake/retry/new inquiry, first/latest attribution, staff property lookup/tracing, unfinished trace restore, quote confirmation and explicit linked booking, visible retention error.
- `tests/crm-addressless.py`: addressless external inquiry, staff-entered address/add-ons/overgrowth, private notes and booking.
- `tests/crm-upgrade.py`: separate disposable database with historical rows; upgrade/backfill preservation, unexpected-policy rejection, portal column grants, RPC replay and empty-services booking. Does not reset the browser-test database.
- `tests/twilio-mock.cjs`: test-only fetch interception for Twilio; never imported by application code.

Current test environment uses `/tmp/qg-crm-test`, ports 56421/56422, and Next on 3100. `.env.local` contains disposable local credentials only and is ignored. Do not copy that file into production. For a rerun use the bootstrap script and commands added alongside these tests. The browser tests are functional checks; full-width visual review in the user's cmux pane was unavailable because cmux's socket refused the connection.

Reproduce locally (Node 24+, Docker, Supabase CLI, Python Playwright/Pillow and Chromium installed):

```sh
python3 tests/bootstrap-local.py
QG_SMS_MODE=/tmp/qg-sms-mode QG_SMS_LOG=/tmp/qg-sms-log \
NODE_OPTIONS="--require $(pwd)/tests/twilio-mock.cjs" npm run dev -- --port 3100
# In another terminal:
python3 tests/crm-integration.py
python3 tests/crm-workflow.py
python3 tests/crm-map-booking.py
python3 tests/crm-addressless.py
python3 tests/crm-upgrade.py
npx tsc --noEmit
npm run build
supabase db advisors --workdir /tmp/qg-crm-test --local --type security --level warn
```

The bootstrap refuses to overwrite a non-test `.env.local`. It prepares a fresh baseline but does not reset an already-running test database; use a fresh disposable project when testing revised migrations. The optional manual-form consent checkbox records the exact text/version/timestamp when checked; an unchecked box remains false/unknown and is never fabricated as consent.

Final checks also cover `tests/crm-map-booking.py`: the real public map phone gate, exact consent evidence, signed linkage into a pending booking, and customer access to only their own bookings. Run it after the other suites. All five suites passed after rebuilding the disposable local database from the combined baseline and reviewed migration. The two-recipient regression used only fake test numbers; neither supplied real number was contacted. The independent reviewer closed all original findings and found no blocking issue in the two-recipient extension. TypeScript and production build passed. The security advisor returned no warnings. Repository-wide lint remains blocked by existing map/admin/portal issues; newly added server/auth/intake files pass targeted lint.
