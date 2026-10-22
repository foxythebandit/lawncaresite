# QuietGreen CRM revamp — project spine

This is the authoritative planning and handoff document for this revamp. Update decisions and the execution ledger here as work proceeds; do not replace them with a fresh interpretation after a context handoff. **Build planning: confirmed requirements and delegated defaults below govern implementation. Vendor facts still require verification; they do not block unrelated local work. Parent approved the implementation spine; implementation is pending explicit worker dispatch. No coding workers are active.**

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

Planning branch: `codex/crm-revamp`, based on fetched `origin/main` **`4aebdaa6d35dc80d3943eaf73a5ed6a930b96c0b`**. Main is newer than the earlier CRM checkout `b86f9f124d03127408166d3f8751d22d7190a416`. Keep main's map/address improvements and production migration-history alignment. At the original audit the deployed revision was unverified. Parent has since verified website release `f4f7af9` live with deployment success and SEO smoke checks; actual database schema and runtime configuration remain **unverified**.

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

## Decision register — confirmed and delegated defaults

IDs remain stable. The user no longer wants an exhaustive questionnaire and delegated sensible simple defaults. CONFIRMED records explicit direction; DELEGATED DEFAULT records a reversible implementation choice, not a claimed verbatim answer. Vendor-dependent or campaign choices remain deferred.

**D01 — Call timing. CONFIRMED.** Staff chooses when to call while opening/preparing the quote; no reviewed-price gate before dialing. SMS must contain customer phone as well as name, address, services and the quote deep link. Latest customer callback goal is within 60 seconds; dispatch alerts immediately. User may work on speakerphone while quoting.

**D02 — Staff coordination. DELEGATED DEFAULT.** No automatic assignment when Call is tapped. Staff coordinate directly; record explicit call attempts/outcomes and show the latest activity. Available source/campaign/ad-set/creative details belong in SMS and the full CRM record. Do not infer a connected call from opening the dialer.

**D03 — Follow-up. DELEGATED DEFAULT.** Explicit call outcomes (no answer, reached, wrong number) plus optional follow-up date/time and a needs-follow-up view. Staff chooses the next action. No automatic customer texts or forced cadence.

**D04 — After-hours alert calls. CONFIRMED.** Both staff receive voice calls and SMS for every new lead 24/7. No quiet hours. Customer callback goal within 60 seconds.

**D05 — Outbound customer texts. CONFIRMED.** Open native personal Messages on iPhone/Mac with an editable prefilled message. Staff explicitly sends it from their own number. No shared business inbox in initial scope.

**D06 — Quote message. DELEGATED DEFAULT.** Optional editable native SMS summary after staff reviews/enters service prices, discount and frequency. Saving never sends. No customer quote portal in the first release.

**D07 — Leaf, gutter and bundle pricing. CONFIRMED.** Preserve the existing mowing estimator and allow staff-entered/adjusted prices for any service. No price required just to save/contact an inquiry. Service offerings can grow (landscaping, gutters, Christmas lights, etc.); do not invent service-specific price formulas. Preserve current discounts and other operational capabilities or explicitly replace their purpose.

**D08 — Acceptance. DELEGATED DEFAULT.** Staff records accepted/declined; later cancellation preserves history. A website booking submission accepts its displayed price but remains a pending visit until scheduling confirmation. A mere inquiry/estimate is not acceptance. Quote acceptance, job status and payment stay separate.

**D09 — Predicted-value horizon. DEFERRED TO CONVIFLO PLANNING.** User wants CRM decisions first and separate funnel questions later. Retain external scores/predicted values separately from quoted and paid amounts; horizon not chosen.

**D10 — Payment. DELEGATED DEFAULT.** Record paid amount, paid date and method per job; preserve existing manually shared Stripe-link workflow. No new processor integration, autocharge or recurring billing. Historical recorded amounts retain their provenance rather than becoming independently verified processor settlements.

**D11 — Meta qualification. DEFERRED EXTERNAL CONFIGURATION.** Capture reached/fit and quote/booking outcomes locally so a later chosen milestone can be reported accurately. Do not activate campaign optimization or export a guessed qualified event before connector/campaign verification.

**D12 — Campaign result. DELEGATED DEFAULT.** Lead with confirmed bookings; show inquiries, reached leads and actual payments alongside them. Preserve useful conservative/annual revenue forecasts separately. No forecast is represented as collected money or proven acquisition ROI.

**D13 — Multiple touches. DELEGATED DEFAULT.** Default acquisition reporting to first tracked source and retain/display latest tracked source. Preserve exact identifiers; unknown remains unknown. This is reporting attribution, not a causal claim.

**D14 — Repeat customer. DELEGATED DEFAULT.** Keep each inquiry separately and suggest an existing customer match for staff confirmation. Explicitly linked subsequent jobs reuse that durable customer. No silent phone-only merge or history overwrite.

**D15 — Property reuse. DELEGATED DEFAULT.** Reopen previous measurement/quote context for review with its date. Never automatically send an old price. Each accepted job keeps its own price snapshot.

**D16 — Lead pipeline. DELEGATED DEFAULT.** New, Contacted, Quoted, Booked, Lost, with separate follow-up due time. Quoted includes spoken or written quotes. Jobs and payments have their own state; canceled work remains in history.

**D17 — Customer and properties. CONFIRMED MODEL / DELEGATED DEFAULT.** One durable customer can have jobs at distinct property addresses; retain explicit property identity so prior measurements are reused safely. Keep the UI simple: customer detail lists jobs/properties, without a separate property-management product.

**D18 — Optional recurring agreement. CONFIRMED MODEL / DELEGATED DEFAULT.** Jobs may be one-time or belong to a recurring agreement. Start with interval weeks anchored to a chosen local date and calendar-month intervals for monthly work, optional end date and explicit next-visit adjustment. Preserve legacy dates/frequency labels rather than rewriting their history. Skip/reschedule one job independently of the agreement.

**D19 — Pause/end/resume. CONFIRMED MODEL / DELEGATED DEFAULT.** Pause or end the agreement, preview and cancel its unfinished future jobs while retaining them and completed history. Resume requires an explicit next date. Future agreement price changes affect newly generated jobs only; existing job prices require an explicit individual edit.

**D20 — Mobile home. DELEGATED DEFAULT.** Needs-action leads/follow-ups first; Today jobs one tap away. SMS deep links continue to open the particular prefilled quote workspace directly.

## Minimal workflow and conceptual records

Saved intake → parallel calls and SMS to both staff → protected prefilled quote workspace → staff handles call and reviews quote → explicit quote communication/acceptance → booking confirmation → service → payment → recurring next visit where applicable. Waitlist remains visible without a new CRM service-area gate.

Conceptually distinguish customer, property, inquiry, quote, booking/visit, recurring plan, activity and attribution. This is vocabulary for decisions, **not a mandate to create eight tables**. Determine minimal storage changes after decisions and actual production-schema inspection. Preserve historical records and links throughout.

## Phased build and ownership

Concrete contracts, schema candidates, task boundaries and test gates are in [BUILD-CONTRACT.md](BUILD-CONTRACT.md). It supersedes older coarse ownership assignments below where more specific. Parent approved the plan; no coding workers are active and implementation awaits dispatch.

1. **Decisions and contracts:** Astra records confirmed direction and delegated defaults, verifies source payload/field mapping and notification semantics, reads applicable skills and installed Next.js guidance, and defines the smallest additive data change. Verification: sanitized fixtures and current-schema evidence resolve integration assumptions.
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

- Existing website map/manual/general-service/booking submissions and Google attribution/events still behave correctly; ConviFlo uses evidence-backed mapping. Required address and waitlist behavior are explicit.
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
| Parent-approved; awaiting dispatch | Product implementation | BUILD-CONTRACT.md defines foundation then intake/alerts gates; no active coding workers. Vendor-dependent configuration stays pending. |
| Pending engineering evidence | Integration readiness | Actual ConviFlo payload/security/retries/address/attribution and actual deployed schema/config unknown. |
| Not run | Build/runtime/upgrade tests | Documentation-only stage; no new runtime claims. |

Before handing off context, update this ledger with exact working commit, changed files, completed tests/results, unresolved decisions/findings, active worker ownership/status and a single next action. Record what is actually known; context percentage is not exposed and must not be invented. A context handoff does not restart the task or reopen settled requirements. Preserve this spine and read it first when resuming.

## Historical priority slice — general website inquiries

User requested a landscaping/general inquiry path first after door knocking; at that time the website estimated mowing only. Preserve mowing calculator and current operational features. Separate feature branch `codex/general-service-inquiries` in `/Users/caelanliu/lawncaresite-service-inquiries`, based on `origin/main` 4aebdaa; no Supabase migrations or production access. Reuse existing `record_intake`, services and answers; required name/phone/address, service selection and project description, no automatic price or booking. Deployment belongs to friend's machine. Sol implemented the narrow slice and Astra independently reviewed it; both review findings were fixed. Parent verified real local intake, attribution, replay deduplication, no booking, existing manual mowing, authenticated staff visibility, responsive layout and storage-error recovery, plus build/TypeScript/scoped lint. Feature commit `79c8595` includes `docs/general-service-inquiries.md` deployment handoff. No production access or real notifications occurred. That slice was separate from the CRM rebuild. Latest authorized website release status is recorded in the current checkpoint below; CRM production migrations remain prohibited here.

User explicitly accepted the customer + jobs + optional recurring agreement model, with multiple services/discounts per job, historical price snapshots, separate payment and preserved history. Skip/reschedule one occurrence separately from pause/end agreement. Preserve Paxton’s conservative annual forecasts. Sensible defaults are delegated; stop repeating the twenty-question questionnaire.

## Current integration checkpoint

Working merge commit **`4accb51751a8ad4ee62256cac444a251f37409b4`** includes latest `origin/main` **`f4f7af9b72153f6e19ca8ce7f61d91c8bea68c1f`**. Parent reports the general inquiry/SEO website release is live and authorized, with no database change. `app/actions/submit-service-inquiry.ts` now saves `website-service` through `recordIntake`, required name/phone/address, selected service and project notes; it does not create a booking. This path is a mandatory regression test, alongside map/manual/booking. Earlier baseline evidence remains historical, not a claim about line numbers after edits.

Revenue audit: `app/admin/revenue/page.tsx:22–24,52–71,157–182` preserves an intentional conservative **30 mows/year × recurring per-visit price** forecast, not an exact schedule prediction. Keep this capability visibly labeled with assumptions; support other service forecasts only from explicit agreement terms. Existing monthly totals combine completed-job recorded amounts and extra charges; preserve historical totals as recorded history while new paid-date reporting remains distinguishable. `RecurringClientRow.tsx:32` currently deletes a booking to remove a projection: replace that action with pause/end agreement, never delete customer history.

Latest ledger: planning docs updated; Supabase/Postgres skills and current RLS documentation read before schema candidates. No code, migrations or runtime tests performed in this update. Next action: parent finishes connector-review response; implementation remains pending dispatch under the approved BUILD-CONTRACT.md.

## Connector review checkpoint — parent verified

Fresh read-only ConviFlo gutter-form integration inspection: **Nothing connected**; Meta Pixel and Webhook **NOT SET UP**; CAPI and Google Ads **SOON**. Webhook UI describes JSON POST with up to three retries and exposes URL plus secret controls, but no custom Authorization-header control. Our canonical endpoint expects Bearer authentication and our own JSON contract. Actual payload and secret/signature mechanism remain unavailable: this is not a plug-and-play connection. Obtain a sanitized real fixture and verified authentication contract before implementing its adapter or enabling delivery.

Google source capture is a separate website/account task: existing capture retains gclid/UTMs and first/latest touches for 90 days, but lacks gbraid/wbraid and explicit Google campaign/ad-group/ad identifiers. Add capture/validation/persistence for these fields in the website contract; verify account URL tagging independently. Official [ValueTrack mapping](https://developers.google.com/google-ads/api/docs/reporting/valuetrack-mapping) identifies `{campaignid}`, `{adgroupid}` and `{creative}` (ad ID). Never decode gclid into invented identifiers or claim person-level attribution absent evidence. Preserve source-specific first/latest fields. Normalize Meta UTM values into typed Meta IDs only for explicitly identified campaign tagging mappings; generic utm_campaign/term/content remain generic otherwise. No external account edits were made in this connector review.
