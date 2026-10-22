# General service inquiries — deploy before the CRM revamp

The homepage now offers landscaping and other outdoor project inquiries alongside the existing mowing estimator. A visible hero link and a desktop navigation link lead to the form. Name, phone, address and a service selection are required; project details and email are optional. Services are Landscaping, Yard cleanup, Gutter cleaning, Lawn mowing and Other. The required address field now offers the same Photon suggestions and address labels as the mowing estimator, with keyboard/touch selection and manual entry when lookup is unavailable. The service dropdown arrow is inset from its right edge. Scope and price are discussed by phone; submission does not quote, accept or book work.

## Storage and current limitations

This change uses the existing `record_intake` function and existing `leads.services`, `leads.answers`, attribution and consent fields. Its source is `website-service`, form version `service:1`. No new migration, database permission, storage bucket, credential or external service is introduced. Existing manual mowing and map quoting are retained. Requested services are accurately stored rather than defaulting every inquiry to Lawn care.

The existing notification dispatcher is reused unchanged. The base revision sends SMS to configured staff recipients. It does not implement the separately planned requirement for calls plus SMS to both owners. Production reportedly has voice alerts; compare the deployed revision and preserve any production-only notification work before integrating. Do not claim voice alerts were verified by this change.

The current protected lead page shows service and contact details; project description appears under Answers and acquisition details. Its existing quote builder still specializes in mowing. The broader manual pricing, service management, customer lifecycle and CRM redesign remain separate work. Photos and a service-management dashboard are not part of this release.

## Handoff to the deployment computer

1. Fetch `codex/general-service-inquiries`. Review the change relative to its base `4aebdaa`. Preserve all unrelated local or production changes; do not reset or force-push the production branch.
2. Verify the currently deployed website already uses the existing CRM intake schema/function and staff configuration. If it does, this addition needs only a website deployment, with **no Supabase changes**. If it does not, stop and adapt this small feature to the actual deployed intake path; do not run historical migrations or upgrade production merely to ship this form.
3. Check the homepage in a preview deployment, including the general form, existing mowing estimator and existing manual mowing inquiry. Confirm staff login and existing notification behavior. Merge/deploy through the usual owner-controlled workflow once compatibility is confirmed.
4. Coordinate one clearly labeled test inquiry with both staff. Verify it appears once, contains its selected service/address/details, has no booking/price, and receives the expected production alerts. This live check is for the deployment owner; no real calls/SMS were sent from the development machine.

Rollback is the website change only. Preserve any inquiries already received. Do not delete records, undo schema history or restore the database for this additive website feature.

## Local verification

`tests/service-inquiry.py` uses the existing disposable local database at 127.0.0.1:56421 and the app at localhost:3101. Start Next with `tests/twilio-mock.cjs`, fake Twilio credentials and separate QG_SMS_MODE / QG_SMS_LOG paths as in the existing CRM test instructions. It does not bootstrap, migrate or reset a database.

Coverage: responsive form/navigation, required address, persisted service/details/attribution, no invented lawn area or booking, two simulated staff SMS deliveries, replay deduplication, server validation, new-inquiry reset, existing manual mowing intake, authenticated staff visibility and browser-storage failure recovery. Build, TypeScript, scoped lint and an independent Astra review accompany this check.
