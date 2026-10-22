# QuietGreen CRM — friend's machine handoff

**Reusable prompt; not ready to deploy.** This branch currently contains planning only. Populate the release evidence below after implementation, local tests and final Astra review. The friend runs deployment/migrations on his machine using his existing credentials; do not place secret values in this document.

## Release evidence to complete

- Reviewed branch and exact commit: **pending**
- Decisions/defaults: **recorded in SPINE.md; final release contract/connector evidence still pending**
- Changed migration files and expected schema effects: **pending**
- Local upgrade/preservation tests and results: **pending**
- Final Astra review and outstanding findings: **pending**
- Hosting target, actual deployed revision and migration history: **verify on friend's machine**
- Rollback application revision and data-preserving recovery procedure: **pending**

## Prompt to use after the branch is complete

You are deploying the reviewed QuietGreen CRM revamp from my machine. Read `AGENTS.md`, `docs/crm-revamp/SPINE.md`, this release evidence, the actual changed migrations and relevant installed framework/skill guidance before acting. Use my existing Supabase project, hosting and Twilio setup; my keys are available locally. Do not print or commit secrets. Do not provision replacement services or rewrite the marketing site.

First verify that the reviewed branch/commit and test evidence are populated and match the working tree. If they are still pending, stop deployment preparation and identify the missing release evidence. Do not treat a planning document as a completed implementation.

Inspect the actual target database schema, migration history, permissions/policies and deployed application version before choosing any migration command. Compare them with the reviewed branch. Existing SQL files or local test passes do not prove production matches. In particular, this repository already contains migration-history alignment and a historical backup-copy migration; do not blindly rerun either. Stop on an unexplained mismatch and produce a concrete reconciliation plan that preserves existing records.

Inventory existing leads, quotes, bookings, extra charges, relationships and relevant storage artifacts. Make a current recoverable backup using the project's available facilities and confirm how restoration works. The historical backup tables alone are not the current recovery plan. Record non-sensitive counts and preservation checks. Do not delete, reset, truncate or replace production data; do not silently merge customers by phone or fabricate historical attribution.

Test the reviewed migration sequence against an isolated representative copy or suitable staging database first. Verify row counts, identifiers, existing bookings/customer access, legacy links, quotes and acquisition data survive. Check the changed permissions using anonymous, customer and staff roles. Never run disposable test bootstrap/reset scripts against production. Explain any migration that cannot safely be reversed and the data-preserving recovery approach before production execution.

Inspect configuration names from the completed implementation, without exposing values. Confirm both intended staff accounts, role/allowlist settings, protected-login return paths, canonical HTTPS CRM origin and both approved recipient numbers. Verify the ConviFlo adapter against actual documented/captured payload, authentication, stable submission identity and retry behavior. Do not assume native CAPI is available: it was marked SOON with no integrations connected during planning.

The non-negotiable lead behavior is: every new website or ConviFlo lead generates a Twilio attention call and an SMS to **each of Caelan and Paxton**. Calls need not be answered and must not bridge to the customer. Voice and SMS start independently, not one after another. SMS contains customer name, customer phone, address, services, useful answers and a protected direct link into the prefilled quote workspace. Full source/ad/creative details remain in the CRM. Respect the eventual recorded D04 after-hours decision rather than inventing hours.

Prepare the concrete deployment/migration sequence and acceptance test before seeking any needed final release approval. Confirm the intended target and authorization for real test calls/texts, with designated safe test contact data and both staff recipients. Do not notify real leads or emit live acquisition events as an accidental side effect of testing. Run production changes only within that authorization.

After migration/deployment, verify existing website forms still save correctly, login returns to the precise lead, the selected address opens the correct property, and staff quote save/approval does not automatically send or book. Exercise one controlled intake from each source with stable submission IDs; verify both phones actually ring and receive complete SMS links, then retry the same submissions and verify there are no duplicate alerts. Provider acceptance alone does not prove ringing or delivery. Capture provider identifiers/statuses privately and measure timing; do not promise a five-second reviewed quote.

Verify existing customer records and visits remain available, customer portal privacy holds, recurring completion produces one next visit, payments remain separate from estimates and acquisition survives into bookings/visits. Test only scenarios and external events authorized for production; keep destructive cases in staging.

If acceptance fails, retain the saved inquiries, pause the problematic new integration/dispatch path as appropriate, reconcile uncertain provider sends before retrying, and use the prepared application rollback or forward-fix plan. Do not drop newly created business records to make an old application version fit. Finish with exact deployed commit, applied migrations, non-sensitive preservation results, live checks performed, unresolved issues and operating instructions.

## Accepted lifecycle cutover requirements

Use BUILD-CONTRACT.md for the additive customer/jobs/optional agreement plan. Preserve booking IDs, historical job prices, extras/discounts, existing Stripe links and Paxton’s conservative 30-mow annual forecast. Never interpret forecasts as paid revenue. Keep historical recorded amounts visible with provenance; do not invent paid dates or merge customers by phone alone. Pause/end replaces deleting customer history. Repeated completion must generate at most one next occurrence. The live `website-service` inquiry path is part of production acceptance alongside map/manual/booking.
