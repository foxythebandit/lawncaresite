# QuietGreen CRM revamp — project spine

This is the authoritative planning and handoff document for this revamp. Update decisions and the execution ledger here as work proceeds; do not replace them with a fresh interpretation after a context handoff. **Planning only: all D01–D20 decisions below remain open. Recommendations are provisional, not implementation authorization.**

## Scope and fixed requirements

- Revamp the existing same-repository CRM, preserving the marketing website, Google website intake, staff authentication, quote map builder, bookings and all production records. Do not import an entire CRM framework or start a full rewrite.
- Every new lead from the website or ConviFlo triggers **a Twilio voice call AND an SMS to BOTH Caelan and Paxton**. Call all leads immediately, including price-checkers. Voice is an attention alert; staff usually do not answer it. No customer bridge or voice-answer-dependent workflow.
- Start voice and SMS independently in parallel after durable intake. Prevent repeated intake delivery from generating duplicate alerts: track submission × recipient × channel separately. Do not claim absolute exactly-once provider delivery across ambiguous network failures; reconcile uncertain provider acceptance before resending.
- SMS includes customer name, customer phone, required address, services, useful submitted answers and a secure direct link to that lead's existing quote workspace with the property prefilled. The complete record and acquisition details remain in the CRM. Missing website names must be handled honestly rather than invented; decide how existing forms collect/fill them during adapter design.
- Address is required. Outside-area forms explain unavailability and capture a CRM waitlist entry. Do not add another CRM distance gate. Verify how the waitlist submission is distinguished from an ordinary lead without silently changing the all-lead alert requirement.
- Mobile web must work on iPhone and Mac, with native call/text actions. Preserve protected staff deep links through login. Quotes require staff review; do not assume automatically finalized pricing or promise a reviewed property quote within five seconds.
- Retain full answers, first/latest acquisition, exact available campaign/ad-set/ad/creative identifiers and creative AI/real classification. Unknown attribution remains unknown. Predicted potential value, approved quoted price and actual money are separate concepts.
- Friend has ConviFlo Max and Supabase keys. Do not assume who owns the ConviFlo account. Production remains untouched during this work; eventual deliverable is a reviewed branch, followed by the friend's migration/deployment from his machine.

## Audited baseline and evidence

Planning branch: `codex/crm-revamp`, based on fetched `origin/main` **`4aebdaa6d35dc80d3943eaf73a5ed6a930b96c0b`**. Main is newer than the earlier CRM checkout `b86f9f124d03127408166d3f8751d22d7190a416`. Keep main's map/address improvements and production migration-history alignment. Deployed revision, actual schema and runtime configuration are **unverified**.

| Area | Code evidence at baseline | Implication |
| --- | --- | --- |
| Website intake | `app/page.tsx:20`; `components/MapQuoteBuilder.tsx:976,1064`; `components/ManualQuoteForm.tsx:63`; `app/actions/submit-{lead,manual-quote,booking}.ts` | Active map/manual/booking paths share `lib/intake.ts:21`; preserve public behavior and Google tracking. |
| Intake durability | `lib/intake.ts:21–39`; `supabase/migrations/20261022000000_crm_lead_workspace.sql:85–134` | Transaction saves inquiry/event/optional booking/alert intent; retry identity is source + submission ID. Dispatch currently waits in request; automatic reconciliation worker not found. |
| Current alert regression | `lib/staff-alerts.ts:19–65`; `docs/crm-setup.md:75,121` | Current remote main sends Twilio **Messages only**. Existing setup prose explicitly replaced voice with SMS and conflicts with this revamp's requirement. Revise that prose during implementation. |
| Historical voice | At `b86f9f1^`, `lib/twilio-call.ts:16–30`, `app/actions/submit-lead.ts:82–92`, `submit-manual-quote.ts:53–61` | Website called `Calls.json` after Pushover using one `TWILIO_OWNER_PHONE`. User reports production calls; do not dispute that experience. Exact deployed behavior for both numbers needs verification. Restore/preserve voice for both sources and recipients. |
| External intake | `app/api/intake/route.ts:5–30`; `lib/canonical-intake.ts:11–42` | Protected canonical JSON endpoint exists, but explicitly is not a verified ConviFlo payload. Source currently hardcoded; address currently optional. Actual adapter still needs evidence. |
| Staff access | `lib/staff-policy.ts:7–9`, `lib/staff.ts:6–10`, `proxy.ts:18–28`, `app/admin/actions.ts:33–45` | Verified-email + staff metadata + allowlist password auth. `/admin/leads/<UUID>` survives login; retain server authorization. Production users/configuration unverified. |
| Quote handoff | `app/admin/leads/[id]/page.tsx:11,62`; `app/admin/leads/quote-actions.ts:8–17`; `lib/quote-draft.ts` | Existing staff builder restores measurements/drawings, add-ons, notes and overrides; explicit confirmation exists. Reuse it. |
| Address provider | `components/MapQuoteBuilder.tsx:149–180,523–537,875–896` | Photon suggestions, Nominatim final search with Photon fallback; shape `{label,lat,lon}`. Not Google Places. Intake currently saves text only; persist verified selected-property context through adapter design. Mapbox/Esri imagery is separate. |
| Attribution | `lib/attribution.ts:1,25–54`; `lib/meta-events.ts:2–7`; `app/admin/leads/page.tsx:23` | Google gclid/UTMs and Meta IDs plus first/latest touches exist; gbraid/wbraid absent. Optional website browser Lead exists, no CAPI sender. Existing report uses legacy top-level columns, so JSON Meta attribution needs deliberate reporting. |
| Lifecycle | `app/admin/actions.ts:267–339`; `app/admin/client/[phone]/page.tsx:16–18` | Booking completion/payment/next visits exist; customer history groups by exact phone. Completion and next-visit insert are separate writes. Lead ownership/contact/follow-up lifecycle is absent. |
| Preservation | `supabase/migrations/20261021235412_backup_before_crm_20261021.sql`; CRM migration's legacy ID mapping | Backup/migration files express intent, not proof of production state. Preserve IDs/history; no guessed historical merges or blind reruns. |

## ConviFlo and Meta evidence boundaries

Parent inspected the current ConviFlo UI: no integrations connected; native CAPI marked **SOON**. Actual webhook payload, authentication/signature, stable submission identity, retry behavior and address selection output remain unknown. These are engineering verification tasks, not questions for the user to guess.

The current ad destination is Website. A ConviFlo-hosted form is an external website form, not a Meta Instant Form; do not assume a Meta lead-ad `lead_id` or Instant Form performance-goal eligibility. Verify the website event and CRM feedback route appropriate to the actual account. Separate exact source capture in our CRM from aggregate, attributed results shown by Meta.

Address compatibility means the same property reaches the quote map, not necessarily that two products use the same autocomplete vendor. Verify ConviFlo's selected-address output. Preserve the submitted address and any trustworthy selected coordinates; if it supplies only text, resolve it through the existing lookup and flag ambiguous results for staff rather than silently choosing a different property.

The current mowing form has internal values: mow-only **40**, mow + edge **50**, cleanup **75**, maintenance **300**, plus timing **0–50** and yard-size **0–60**; total **40–410 before multipliers**. These are potential-money estimates, not customer prices or collected revenue. D09 defines their business horizon before integration. Sending value/currency alone does not establish value optimization; eligibility, campaign objective and correctly configured signals must also be verified. No ROI guarantee.

Read-only Meta UI evidence: draft AI image ad `120247992042830144` already has `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`. The native URL-parameter builder confirmed these macros; it was canceled without applying changes. Normalize those actual IDs into explicit attribution fields and retain a fixed internal creative ID/type mapping. Verify that this context survives ConviFlo into the submitted payload; URL parameters alone do not prove end-to-end capture.

Capture a real sanitized submission fixture and documented delivery contract before writing an adapter. Validate identifiers and creative classification from explicit source fields/tags; do not infer AI versus real from an ad ID. Select one owner for each browser/server conversion event and a shared deduplication identity where applicable. Do not presume ConviFlo already sends usable CAPI events.

## Source-code patterns studied

Study patterns and implement the small parts locally. Literal reuse requires license-compatible use and attribution. Frappe CRM is AGPL; most Twenty code is AGPL with some Enterprise material, while `twenty-ui` is MIT. Do not treat the entire Twenty repository as MIT.

- [Frappe CRM pinned source](https://github.com/frappe/crm/tree/0baa1e8ea462b92d2920bcfdc7a532a730329b6c): `frontend/src/pages/MobileLead.vue` — compact mobile header, status/assignee and Details/Activity tabs; `frontend/src/components/Activities/Activities.vue` — chronological notes/tasks/call history; `crm/fcrm/doctype/crm_lead/crm_lead.py` — ownership, status-change history and lost reason.
- [Twenty pinned source](https://github.com/twentyhq/twenty/tree/427087165dd4cc6497ad623378b824be0b1f150d): `packages/twenty-front/src/modules/activities/timeline-activities/hooks/useTimelineActivities.ts` — timestamped record history; `packages/twenty-front/src/modules/object-record/hooks/useDeleteOneRecord.ts` — soft deletion represented by `deletedAt`, with optimistic-cache rollback when the request fails; `packages/twenty-front/src/modules/object-record/record-field/ui/meta-types/display/components/PhonesFieldDisplay.tsx` — delegates phone display and configured copy action, not a complete telephony system. Parent downloaded/read these files and `LICENSE` plus `packages/twenty-ui/LICENSE` from the official pinned source.

## Twenty open product decisions

Each ID is stable. Record the user's answer beside its ID; do not implement the provisional recommendation until decided. Fixed requirements above are not reopened by these questions.

**D01 — Call timing. OPEN.** A newly submitted property may take longer than five seconds to measure, even with its address already open. Should staff **A)** call immediately while preparing the quote, or **B)** review a price before calling? Provisional recommendation: A, with property and answers ready first; the five-second aspiration should not become a promise of completed measurement.

**D02 — Prevent duplicate customer calls. OPEN.** Both staff receive every voice and SMS alert, so they can otherwise call the same customer simultaneously. Should **A)** tapping Call automatically claim the lead, **B)** staff first tap an explicit “I'm handling it” control, or **C)** there be no assignment? Provisional recommendation: A with visible ownership and easy reassignment; dialing does not prove contact occurred.

**D03 — No-answer follow-up. OPEN.** When a customer does not answer, should the CRM **A)** offer a consistent follow-up cadence for staff to accept, or **B)** let staff choose every next contact time manually? Provisional recommendation: A with an editable suggested next action. Decide the actual cadence together; this does not authorize automatic customer texts or assume a missed call means rejection.

**D04 — After-hours alert calls. OPEN.** The current requirement rings both staff for every lead. Keep **A)** that behavior around the clock, or introduce **B)** an explicit overnight exception with defined hours? Provisional recommendation: A unless you choose an exception. Intake records and SMS must not change silently; choosing B requires the timezone, deferred-call behavior and a clear customer response expectation.

**D05 — Outbound customer texts. OPEN.** Should staff send customer messages through **A)** native Messages from their personal phone with an editable prefilled draft, or **B)** a shared business Twilio number and CRM inbox? Provisional recommendation: A for the smallest initial release. B adds conversation storage, delivery handling and shared-inbox work; either choice must keep customer sending an explicit staff action.

**D06 — Written reviewed quote. OPEN.** After staff approves the price, should the customer receive **A)** an editable plain-text SMS, **B)** a secure customer quote link, or **C)** both? Provisional recommendation: A initially unless a structured customer acceptance page is important. The content should clearly state service, visit price and frequency; staff explicitly sends it after review rather than saving a draft triggering delivery.

**D07 — Leaf, gutter and bundle pricing. OPEN.** The existing builder is strongest for mowing, while new services may need different inputs. Should **A)** staff enter reviewed prices for leaf cleanup, gutters and bundles initially, or **B)** the user supply service-specific pricing rules for implementation? Provisional recommendation: A to preserve flexibility while real quoting patterns emerge, without inventing rates or presenting estimates as final offers.

**D08 — Customer acceptance. OPEN.** Should a quote become accepted when **A)** staff records the customer's agreement after a call/text, or **B)** the customer presses an acceptance button on a quote page? Provisional recommendation: A initially, recording who marked it and when. Acceptance and booking confirmation remain distinct: accepting a price should not silently commit a visit date or create duplicate bookings.

**D09 — Predicted-value horizon. OPEN.** What should ConviFlo's internal potential-money estimate represent: **A)** the first job, **B)** the first 30 days, or **C)** the first 12 months? The current 40–410 scoring range does not establish its meaning. Provisional recommendation: A for the easiest comparison with realized results, unless the business explicitly wants a recurring forecast with a documented retention assumption.

**D10 — Actual money. OPEN.** Should the first release record money through **A)** staff marking a payment with paid amount and date, or **B)** an invoicing/payment integration? Provisional recommendation: A, with any later synchronization clearly scoped. A quoted amount or completed job alone must not count as collected money, and forecast value must remain distinguishable from the actual payments used in reporting.

**D11 — Qualified Meta milestone. OPEN.** Which event should count as a qualified lead: **A)** a serviceable address and valid contact details, **B)** staff reaches the person and confirms fit, or **C)** staff sends an approved quote? Provisional recommendation: B for a human-verified signal. Keep raw Lead separate and verify the chosen event's technical/campaign setup before assuming Meta will optimize toward it.

**D12 — Primary campaign result. OPEN.** Which result should lead the campaign report: qualified leads, confirmed bookings, first-job payments, or 90-day customer revenue? Show the available stages separately, but choose one primary comparison so cheap inquiries do not automatically look best. Provisional recommendation: confirmed bookings initially, supplemented by paid revenue as it matures; disclose incomplete observation periods rather than comparing young customers unfairly.

**D13 — Multiple marketing touches. OPEN.** If someone first clicks an AI creative and later returns through real footage or Google, should the main report credit **A)** first tracked acquisition or **B)** most recent tracked touch? Both remain stored regardless. Provisional recommendation: A for acquisition reporting with latest touch alongside it; this is a reporting convention, not proof that one exposure alone caused the sale.

**D14 — Repeat inquiry. OPEN.** When a submitted phone resembles an existing customer's, should **A)** the new inquiry automatically link to that customer while remaining a separate inquiry, or **B)** the CRM flag a possible match for staff review? Provisional recommendation: B initially. Shared numbers and changed details make silent identity decisions risky; never overwrite the previous inquiry, property, answers or acquisition record.

**D15 — Known property. OPEN.** For a returning property's quote, should **A)** the CRM reopen previous measurements and price for staff review, or **B)** require a fresh measurement every time? Provisional recommendation: A, showing when the prior work was saved so staff can judge changes. Reuse saves preparation time, but it must never automatically send an old quote or imply old pricing remains valid.

**D16 — Lead pipeline. OPEN.** Is **New → Contacted → Quoted → Booked / Lost**, plus a follow-up due field, enough to manage leads, or should any stage be renamed or added? Provisional recommendation: start with those few visible stages and allow Quoted to mean a price spoken by phone or sent in writing. Keep quote preparation and booking status meaningful without turning every internal action into another pipeline column.

**D17 — Multiple properties. OPEN.** Should the first release support **A)** one customer with multiple separately quoted and scheduled properties, or **B)** one property per customer as an explicit initial limitation? Provisional recommendation: A only if this occurs in current operations; otherwise document B's limit. The choice affects customer navigation and recurrence, so decide it before assuming phone number alone identifies a job or property.

**D18 — Recurring schedule. OPEN.** Which schedule must the initial CRM support: **A)** a custom interval from the chosen start date, or **B)** a specific weekday with a start and optional end date? Provisional recommendation: implement only what current customers need, with explicit next-visit adjustment. Choose the operational rule once; do not hide it behind another hardcoded cadence or imply monthly always means thirty days.

**D19 — Pause, resume and cancel. OPEN.** When a recurring plan pauses or ends, should **A)** all its uncompleted future visits be canceled by default, or **B)** staff review each scheduled visit before deciding? Provisional recommendation: A with a clear preview and preservation of history. Resuming always needs an explicit next date; neither choice should rewrite completed work or quietly reactivate canceled visits.

**D20 — Mobile home. OPEN.** For the general CRM home, should the first screen show **A)** new leads and overdue/due follow-ups, or **B)** today's scheduled jobs? Provisional recommendation: A for this sales-response revamp, with Today one tap away. The other view remains immediately accessible; the SMS link already goes directly into the prefilled quote workspace, independent of this home-screen decision.

## Minimal workflow and conceptual records

Saved intake → parallel calls and SMS to both staff → protected prefilled quote workspace → staff handles call and reviews quote → explicit quote communication/acceptance → booking confirmation → service → payment → recurring next visit where applicable. Waitlist remains visible without a new CRM service-area gate.

Conceptually distinguish customer, property, inquiry, quote, booking/visit, recurring plan, activity and attribution. This is vocabulary for decisions, **not a mandate to create eight tables**. Determine minimal storage changes after decisions and actual production-schema inspection. Preserve historical records and links throughout.

## Phased build and ownership

1. **Decisions and contracts:** Astra records D01–D20 answers, confirms source payload/field mapping and notification semantics, reads applicable skills and installed Next.js guidance, and defines the smallest additive data change. Verification: sanitized fixtures and current-schema evidence resolve integration assumptions.
2. **Durable intake and alerts:** preserve website paths, add verified ConviFlo adapter, required property context and per-recipient/channel voice + SMS. Verification: concurrent/retried intake produces one inquiry and one intent per staff/channel; provider failure cannot lose the inquiry.
3. **Mobile response workspace:** concise contact/property/answers, ownership and follow-up according to decisions; existing prefilled map quote work retained. Verification: iPhone/Mac flow from alert through login, call action, restored quote and explicit approval.
4. **Customer lifecycle and reporting:** accepted quote, booking, payment, recurrence and attribution according to decisions. Verification: repeat completion cannot duplicate next visits; customer history and original acquisition survive.
5. **Final review and handoff:** Astra reviews integrated behavior/security/spec, fixes findings, runs appropriate local database upgrade and browser tests, prepares friend handoff. Deliver branch for review/push when authorized; no automatic deployment or production migration.

Execution model: **one GPT-6 Astra lead** owns planning, contracts, integration and final review; **gpt-6-sol workers** own bounded, non-overlapping work after the decisions needed for their work are resolved. Explicit user authorization permits that model; no coding workers are running during this planning stage.

| Owner | File/responsibility boundary |
| --- | --- |
| Astra | This spine, migration design/files unless explicitly assigned to one worker, shared contracts, integration, final review and handoff. |
| Sol A | Intake/alert modules (`lib/{canonical-intake,intake,website-intake,staff-alerts}.ts`, future voice sender, `app/api/intake/route.ts`, public intake actions) and matching boundary tests. |
| Sol B | `app/admin/leads/**`, `AdminNav.tsx`, scoped CRM styling and mobile response tests. Any `MapQuoteBuilder.tsx` change requires an agreed interface/ownership transfer; preserve public builder behavior. |
| Sol C | Booking/customer/revenue pages, `app/admin/actions.ts`, lifecycle/reporting behavior tests. Coordinate shared attribution-helper changes through Astra. |

Integrate contract/schema foundation first; intake/alerts and UI may proceed in parallel only against fixed interfaces; lifecycle/reporting follows those contracts. Every worker is told others share the repository and must not revert others' edits. The active lead waits for/checks workers, resolves integration issues and verifies completion rather than merely dispatching. No background automation unless requested.

## Acceptance and production boundary

- Existing website map/manual/booking submissions and Google attribution/events still behave correctly; ConviFlo uses evidence-backed mapping. Required address and waitlist behavior are explicit.
- Each new lead creates four distinct alert intents: two voice, two SMS. Repeated provider submission delivery does not repeat accepted alerts; uncertain outcomes reconcile before retry. All required SMS content and protected deep link are verified. Measure real latency later; no five-second guarantee from local mocks.
- Expired staff sessions return to the intended lead; unauthorized staff/customer/anonymous callers cannot read or mutate internal records. Customer portal excludes internal notes and acquisition.
- Selected property context opens correctly; draft/unfinished drawing/add-ons/notes survive reload. Staff reviews/confirms pricing; save alone does not send customer messages or create a booking.
- Product stages and explicit customer sends follow recorded decisions. Repeated completion cannot create duplicate recurring visits; pause/cancel preserves history and resume uses an explicit date.
- Actual payments and predicted value remain separate. Available first/latest ad identifiers and creative classification survive inquiry → booking → repeat visits; unknowns are labeled rather than inferred.
- Local upgrade tests start with representative existing records and verify preservation. Test behavior through public interfaces with real disposable database/auth; mock only external network systems. Do not send real calls, SMS or Meta events during local tests.
- Friend verifies actual schema/migration history, backups and deployment configuration on his machine. No credentials enter repository or handoff. Use `PRODUCTION-HANDOFF.md` only after branch completion; current document is not a release-ready claim.

## Execution ledger and context handoff

| State | Item | Evidence / next action |
| --- | --- | --- |
| Done | Read-only remote-main audit and historical voice trace | Baseline commit above; code references recorded. No production access or notifications. |
| Done | Parent's ConviFlo UI and pinned CRM source study | Findings and exact pinned source locations recorded above. |
| Done | Planning documents and parent review | `docs/crm-revamp/SPINE.md`, `PRODUCTION-HANDOFF.md`, and `AGENTS.md` pointer. All 20 decision IDs checked; documentation whitespace check passed. No runtime implementation changes. |
| Blocked on decisions | Product implementation | D01–D20 all OPEN; user answers are next action. |
| Pending engineering evidence | Integration readiness | Actual ConviFlo payload/security/retries/address/attribution and actual deployed schema/config unknown. |
| Not run | Build/runtime/upgrade tests | Documentation-only stage; no new runtime claims. |

Before handing off context, update this ledger with exact working commit, changed files, completed tests/results, unresolved decisions/findings, active worker ownership/status and a single next action. Record what is actually known; context percentage is not exposed and must not be invented. A context handoff does not restart the task or reopen settled requirements. Preserve this spine and read it first when resuming.
