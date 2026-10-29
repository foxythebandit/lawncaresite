# QuietGreen CRM revamp — project spine

### Address reliability repair — 27 October 2026

- User authorized a focused, thorough repair after a real ConviFlo Hutto address produced no autocomplete and CRM required a selection. Work is isolated on codex/address-reliability, based on origin/main145bb15.
- Verified missing-city map data: full text with Hutto returns no result; one structured street/ZIP request returns the house. Website/CRM share this resolver; ConviFlo collects street/unit/city plus ZIP, preserved at intake. No third provider, migration, production mutation or published form/ad changes.
- Added bounded/canceled lookup, property validation and explicit persisted/server-checked staff confirmation with manual recovery. Removed house-number-only parcel recentering; relocation clears old measurements. Historical ZIP enrichment is bound to original submitted address so staff corrections win.
- 26 focused tests and real local auth/DB UI suite pass; real browser found the property in906ms (HTTP200). No live intake or Twilio calls/texts. See docs/address-reliability/README.md for checks, limits and deployment receipt. Public-service availability and global rate limits are not guaranteed by per-page queuing.


### Readable launched-ad attribution — 24 October 2026

- Owner requested specific ad names and video versus still-image labels after a real website-service lead displayed only Meta IDs. Shared display formatting now resolves the 12 verified ads in campaign `120253769117350725`, including older website UTM-only attribution. Example: `Meta · Real People · Video · Testimonial`.
- Lead list reads the canonical first-touch attribution as well as legacy columns. Lead header and both first/latest acquisition sections use the same formatter. Raw IDs and customer records are preserved; no backfill, migration, intake changes, live submissions or calls. Unknown ads keep their original attribution rather than acquiring guessed names. Add new ad IDs to the display inventory when creatives are duplicated or new ads launch.
- Verified: seven attribution/registry tests, TypeScript and scoped ESLint. Deployment remains separate from these local checks.

This is the authoritative planning and handoff document for this revamp. Update decisions and the execution ledger here as work proceeds; do not replace them with a fresh interpretation after a context handoff. **Confirmed requirements and delegated defaults below govern the implementation. The staff redesign and release corrections are integrated at `988ca9f`, including main `72f3c68`. See the newest release receipt below and PRODUCTION-HANDOFF.md; older build/review receipts apply only to their stated checkpoints. Production remains untouched from this machine; the owner authorized deployment from Paxton’s laptop.**

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

## Historical ConviFlo and Meta evidence boundaries (superseded by verified receipts below)

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

Concrete contracts, schema candidates, task boundaries and test gates are in [BUILD-CONTRACT.md](BUILD-CONTRACT.md). It supersedes older coarse ownership assignments below where more specific. Implementation active under this plan; see latest execution checkpoint.

1. **Decisions and contracts:** Astra records confirmed direction and delegated defaults, verifies source payload/field mapping and notification semantics, reads applicable skills and installed Next.js guidance, and defines the smallest additive data change. Verification: sanitized fixtures and current-schema evidence resolve integration assumptions.
2. **Durable intake and alerts:** preserve website paths, add verified ConviFlo adapter, required property context and per-recipient/channel voice + SMS. Verification: concurrent/retried intake produces one inquiry and one intent per staff/channel; provider failure cannot lose the inquiry.
3. **Mobile response workspace:** concise contact/property/answers, ownership and follow-up according to decisions; existing prefilled map quote work retained. Verification: iPhone/Mac flow from alert through login, call action, restored quote and explicit approval.
4. **Customer lifecycle and reporting:** accepted quote, booking, payment, recurrence and attribution according to decisions. Verification: repeat completion cannot duplicate next visits; customer history and original acquisition survive.
5. **Final review and handoff:** Astra reviews integrated behavior/security/spec, fixes findings, runs appropriate local database upgrade and browser tests, prepares friend handoff. Deliver branch for review/push when authorized; no automatic deployment or production migration.

Execution model: **one GPT-6 Astra lead** owns planning, contracts, integration and final review; **gpt-6-sol workers** own bounded, non-overlapping work after the decisions needed for their work are resolved. Explicit user authorization permits that model; coding workers are dispatched in bounded capacity waves.

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
- Friend verifies actual schema/migration history, backups and deployment configuration on his machine. No credentials enter repository or handoff. Use `PRODUCTION-HANDOFF.md` only after branch completion; reviewed code is ready for the friend’s guarded production preflight, not automatic deployment.

## Execution ledger and context handoff

| State | Item | Evidence / next action |
| --- | --- | --- |
| Done | Read-only remote-main audit and historical voice trace | Baseline commit above; code references recorded. No production access or notifications. |
| Done | Parent's ConviFlo UI and pinned CRM source study | Findings and exact pinned source locations recorded above. |
| Done | Planning documents and parent review | `docs/crm-revamp/SPINE.md`, `PRODUCTION-HANDOFF.md`, and `AGENTS.md` pointer. All 20 decision IDs checked; documentation whitespace check passed. Initial planning receipt; implementation evidence follows. |
| Done | Product implementation and final independent review | Integrated code `4650d79`; all six final-review findings resolved, first-visit preservation reviewed, no P1/P2 findings remain. Coding workers finished. |
| Partially verified | Integration readiness | Synthetic vendor receipts establish signature/payload/address/retry behavior. Production form configuration, Meta access/receipt and deployed DB remain unverified. |
| Done | Build/runtime/upgrade tests | Final optimized build, typecheck, real DB upgrade and behavioral suites pass; exact receipt below. |

Before handing off context, update this ledger with exact working commit, changed files, completed tests/results, unresolved decisions/findings, active worker ownership/status and a single next action. Record what is actually known; context percentage is not exposed and must not be invented. A context handoff does not restart the task or reopen settled requirements. Preserve this spine and read it first when resuming.

## Historical priority slice — general website inquiries

User requested a landscaping/general inquiry path first after door knocking; at that time the website estimated mowing only. Preserve mowing calculator and current operational features. Separate feature branch `codex/general-service-inquiries` in `/Users/caelanliu/lawncaresite-service-inquiries`, based on `origin/main` 4aebdaa; no Supabase migrations or production access. Reuse existing `record_intake`, services and answers; required name/phone/address, service selection and project description, no automatic price or booking. Deployment belongs to friend's machine. Sol implemented the narrow slice and Astra independently reviewed it; both review findings were fixed. Parent verified real local intake, attribution, replay deduplication, no booking, existing manual mowing, authenticated staff visibility, responsive layout and storage-error recovery, plus build/TypeScript/scoped lint. Feature commit `79c8595` includes `docs/general-service-inquiries.md` deployment handoff. No production access or real notifications occurred. That slice was separate from the CRM rebuild. Latest authorized website release status is recorded in the current checkpoint below; CRM production migrations remain prohibited here.

User explicitly accepted the customer + jobs + optional recurring agreement model, with multiple services/discounts per job, historical price snapshots, separate payment and preserved history. Skip/reschedule one occurrence separately from pause/end agreement. Preserve Paxton’s conservative annual forecasts. Sensible defaults are delegated; stop repeating the twenty-question questionnaire.

## Current integration checkpoint

Working merge commit **`4accb51751a8ad4ee62256cac444a251f37409b4`** includes latest `origin/main` **`f4f7af9b72153f6e19ca8ce7f61d91c8bea68c1f`**. Parent reports the general inquiry/SEO website release is live and authorized, with no database change. `app/actions/submit-service-inquiry.ts` now saves `website-service` through `recordIntake`, required name/phone/address, selected service and project notes; it does not create a booking. This path is a mandatory regression test, alongside map/manual/booking. Earlier baseline evidence remains historical, not a claim about line numbers after edits.

Revenue audit: `app/admin/revenue/page.tsx:22–24,52–71,157–182` preserves an intentional conservative **30 mows/year × recurring per-visit price** forecast, not an exact schedule prediction. Keep this capability visibly labeled with assumptions; support other service forecasts only from explicit agreement terms. Existing monthly totals combine completed-job recorded amounts and extra charges; preserve historical totals as recorded history while new paid-date reporting remains distinguishable. `RecurringClientRow.tsx:32` currently deletes a booking to remove a projection: replace that action with pause/end agreement, never delete customer history.

Historical planning checkpoint: Supabase/Postgres skills and current RLS documentation were read before schema design. The implementation and verified build checkpoints below supersede the former pending-dispatch status.

## Historical connector review checkpoint — before isolated vendor test

Fresh read-only ConviFlo gutter-form integration inspection: **Nothing connected**; Meta Pixel and Webhook **NOT SET UP**; CAPI and Google Ads **SOON**. Webhook UI describes JSON POST with up to three retries and exposes URL plus secret controls, but no custom Authorization-header control. Our canonical endpoint expects Bearer authentication and our own JSON contract. Actual payload and secret/signature mechanism remain unavailable: this is not a plug-and-play connection. Obtain a sanitized real fixture and verified authentication contract before implementing its adapter or enabling delivery.

Google source capture is a separate website/account task: existing capture retains gclid/UTMs and first/latest touches for 90 days, but lacks gbraid/wbraid and explicit Google campaign/ad-group/ad identifiers. Add capture/validation/persistence for these fields in the website contract; verify account URL tagging independently. Official [ValueTrack mapping](https://developers.google.com/google-ads/api/docs/reporting/valuetrack-mapping) identifies `{campaignid}`, `{adgroupid}` and `{creative}` (ad ID). Never decode gclid into invented identifiers or claim person-level attribution absent evidence. Preserve source-specific first/latest fields. Normalize Meta UTM values into typed Meta IDs only for explicitly identified campaign tagging mappings; generic utm_campaign/term/content remain generic otherwise. No external account edits were made in this connector review.

## Historical implementation kickoff

Starting commit `303e65e73ebcecd953f51f051dd7b0db07f7a27e`. User authorized complete build/test, Astra lead and Sol coding. T1a `/root/astra_crm_plan/sol_foundation` owns additive SQL/types and exclusive disposable database mutation; T2 `/root/astra_crm_plan/sol_mobile` owns mobile leads/quote UI and is preparing independent styles pending foundation contract gate. No production access. Dependencies installed; revamp app uses port 3102 and API 56421, separate test notification log/mode, strict outbound fetch guard. Existing website3101 remains untouched. The later verified build checkpoint records the actual ConviFlo wire/signature evidence; canonical authentication remains intact.

## Verified build checkpoint — 22 October 2026

- Reviewed foundation commit `963461a`: additive customer/property/agreement/items/payments/activities contracts and real-database upgrade coverage. Parent review identified follow-on lifecycle hardening: reject sub-cent amounts, enforce agreement ownership consistency, prevent one-off extras recurring, and update last-mow semantics. Apply these in a new migration, not the applied foundation.
- T1b durable four-intent alerts and authenticated recovery passed independent local `crm-alerts.py` and full-chain `crm-upgrade.py`. Worst-case SMS bounds passed; committed as `b0205e5`. Signed adapter is committed as `2dd053d`. Scheduler activation remains a deployment readiness requirement.
- Sol A completed intake/alerts/adapter and now owns T3 lifecycle plus exclusive new SQL; Sol B finishes mobile lead/quote and outside-area waitlist behavior. No production mutation occurred.
- Real isolated ConviFlo receipts verify `X-Conviflow-Signature` as raw-body HMAC-SHA256, `event: lead` + `outcome: completed`, stable `formId`/`responseId`, duplicate completed deliveries despite success, and `lead.partial` without responseId. Only completed events create leads/alerts; partial events are acknowledged without intake. The adapter scopes identity to form + response, requires an allowlisted form and configured service/address mapping, and retains submitted answers.
- Verified address shape is `{street, unit, city}` with no coordinates, state or ZIP. Preserve those components and flag staff address review; do not fabricate location certainty. Real test receipts retained UTMs but omitted supplied synthetic click identifiers; this does not establish behavior for every valid click identifier. Per-form explicit Meta macro mapping may normalize known ID UTMs. Vendor `meta.events` is not proof of delivery to Meta.
- Production ConviFlo flows remain unconnected. No accessible intended Meta dataset was verified; account access, destination URLs and actual event receipt/dedup remain launch checks. The isolated test form was subsequently unpublished and its receiver/tunnel stopped, as recorded below.
- Disposable app3102/API56421 has only local database credentials, dummy Twilio values and test secrets. The preload blocks unexpected fetch destinations; it does not intercept every possible Node transport. No Stripe/Resend production keys are present. Existing website3101 is untouched.

Historical next action at this checkpoint: finish and commit reviewed intake/mobile slices, transfer exclusive SQL ownership for the lifecycle hardening migration, then complete customer/jobs/money workflows and integrated regression checks.

### Real vendor-to-local receipt

Parent completed a fresh synthetic ConviFlo browser submission through the isolated relay into local3102 with original body/signature unchanged. Partial returned200 ignored; completed returned201; duplicate completed returned200 with duplicate=true. Local lead `628981f5-ab52-48ba-8357-f4fd7a7ee9a5`, event `0b195647-2b49-42f2-9d3a-4b7563c3c0a7`, response `ff8be81d-e08f-4691-865e-4b99a713702c`. Address components and explicit mapped Meta campaign900001/adset900002/ad900003 survived. Exactly four mocked provider intents (two voice/two SMS) reached accepted with one attempt each. This establishes the tested form's vendor→adapter→CRM path, not production delivery or Meta platform receipt. Cleanup verified: the synthetic form is now DRAFT; the original four remain LIVE. Receiver and tunnel are stopped.

### Existing ConviFlo form launch changes

Parent read-only inspection found existing production contact copy still calls address/email optional, and out-of-area ZIP exits occur before contact collection. The friend must make address required and collect contact/address before the outside-area ending if a CRM waitlist is intended. Existing flows were not changed. Verify each production form's actual field names, choice values and completed address with a designated dry run before allowlisting it. Mowing choices include mowing-only, mowing + edging, cleanup and regular maintenance: a configured Lawn care category does not replace these selected answers; retain/display them as useful submitted context. The isolated synthetic form receipt does not establish compatibility for all existing flow variants.

### Reviewed implementation checkpoints

- `b0205e5`: durable dual-channel alerts and recovery; `2dd053d`: verified signed ConviFlo adapter.
- `b20ec08`: guarded lifecycle commands and real-database tests. Applied only to disposable56422. Parent findings fixed: cents precision, agreement ownership, one-off extra isolation and last-mow handling. Original accepted quote context persists into jobs. New optimistic conflicts use PT409 because intentional40001 errors retried inside local PostgREST and exhausted the test pool; stale requests now return409 promptly. Full fresh/legacy upgrade, role isolation and lifecycle tests pass.
- `a9451a1`: explicit Meta ad creative registry at signed adapter boundary; click-only source labels, filtered internal answer bookkeeping, bounded SMS. Independent alert, adapter and public service-inquiry suites pass with mocked external notifications; registry tests pass.
- Mobile workflow, native actions, manual quote acceptance and stale conflict browser tests pass. Fresh screenshot confirms marketing removed; compacting management/activity sections before final UI review. Sol A continues customer/jobs/payments/forecast UI; Sol B owns mobile plus legacy browser regressions.

Historical next action at this checkpoint: review/freeze UI slices, complete final integrated tests/build, independent parent review, update production handoff with exact final commit and pending real configuration.

## Integrated verification checkpoint (completed)

- **Implemented:** `829ba05` customer/job/recurrence/payment/forecast UI; `dfb3a53` explicit property reset after contact-address changes; `22709ba` guarded regression harness. Sol coding workers are finished. Independent Astra reviewer owns final branch spec/security review; Astra integration lead owns final tests/docs.
- **Preservation:** accepted snapshots and existing job prices stay immutable; legacy recurring jobs require reviewed agreement conversion or explicit one-time confirmation before completion. Completed one-off work can start recurrence. Explicit first next date is honored, then anchored cadence resumes. Pause/end retains history; one-visit cancel advances an active agreement. Legacy mowing forecasts remain separate from paid-date payments and non-mowing agreements.
- **Address correction:** A→B contact edits block old quote reuse. Staff cancels acceptance, starts a fresh B quote, and re-enters/reviews property context. Old geometry/area/location is cleared; old accepted snapshots/jobs remain. Geocoder formatting of the same reviewed contact address is allowed.
- **Verified at `22709ba`:** production webpack build in a separate temporary checkout; typecheck; full isolated fresh/legacy database upgrade, role isolation and lifecycle concurrency/exact-money tests; forecast/creative tests; mobile A→B regression and public manual intake→formatted map address→accepted booking→recurrence/payment browser flow. Remaining final sequential suites and independent review are recorded in the final receipt when complete.
- **Production untouched:** all SQL applied only to disposable DB56422. Preview3102 remains available with fake records and no real external credentials. No deployment, production migration, real staff calls/texts or Meta writes.
- **Next:** friend-only production preflight and activation using the completed handoff; no coding workers remain active.

### Independent final review corrections

Independent Astra review accepted the property-reset and explicit-first-date fixes. Subsequent corrections preserve legacy recorded amounts alongside new payment entries, show authorized payment totals in the customer portal, clear displayed stale payment links after price edits, and flag scheduling-command replays to prevent duplicate confirmation email. Real local provider-mock browser replay and customer portal privacy/payment tests pass. First-visit/overgrowth preservation was also completed and reviewed. No production changes.

### Final integrated candidate — `4650d79148a596c873f0494eac21b17a914b926f`

All accepted review corrections are integrated, including confirmation-email replay migration `cb612cb`, customer-authorized payment summaries, retained unreconciled legacy amounts, stale-link invalidation and preserved first-visit/cleanup/ongoing price terms. Future agreements require staff review of their template; introductory discounts and one-off cleanup are not assumed future pricing. Calendar and legacy phone history use the same exact current-job amount. User-requested phone display formatting and inset dropdown arrows are included; storage and native call/text destinations remain unchanged.

Completed local acceptance includes public map/manual/general intake, signed ConviFlo completed/partial/retry handling, both staff channels, failed/unknown recovery, customer/staff isolation and secure deep links, property normalization/reset, customer identity/history, lifecycle/recurrence, exact payment amounts and conservative forecast. Final candidate build/mobile/payment regressions pass and independent review is clear. Friend-only checks remain actual production schema/configuration, production form mappings, scheduler activation, actual calls/SMS receipt and Meta dataset/event setup.

### Final local verification receipt

At code checkpoint `4650d79`, optimized production build (`next build --webpack`, isolated temporary checkout) and TypeScript pass. Scoped changed-code lint has no errors; remaining warnings concern existing image/compatibility argument patterns. The full repository lint baseline is not claimed clean.

Behavioral suites passed against disposable local data: `crm-upgrade.py` (runs foundation/lifecycle contracts, full fresh/legacy chain and role checks), `crm-alerts.py`, `crm-conviflo.py`, `service-inquiry.py`, `crm-map-booking.py`, `crm-integration.py`, `crm-addressless.py`, `crm-customers.py`, `crm-lifecycle-ui.py`, `crm-mobile.py`, `crm-workflow.py`, `crm-portal-payments.py`, `crm-email-replay.py`, plus `crm-forecast.mjs` and `ad-registry.test.mjs`. Outside-area waitlist behavior passed `crm-waitlist.py` during the mobile checkpoint. The latest build passed and repeated the affected mobile/property, price/payment, lifecycle and email replay checks. No real Stripe processing, email delivery, phone ringing or Meta event delivery is claimed. The earlier real synthetic ConviFlo vendor receipt is recorded above.

### Release status — complete local build and review

Independent GPT-6 Astra final review at `4650d79148a596c873f0494eac21b17a914b926f` reports no remaining P1/P2 findings. Parent independently reviewed portal authorization, preservation and presentation. All final tests above pass, including real mock-provider confirmation replay and the complete migration chain. No implementation blockers remain. The subsequent documentation-only commit carries this handoff; deliver only `codex/crm-revamp`, without merge, PR or deployment. Production readiness checks in PRODUCTION-HANDOFF.md remain deliberately external. No active coding workers or unattended monitor remain.

### Staff UI revamp — 22 October 2026 (presentation only)

User requested a full visual revamp of the staff CRM (iPhone + laptop), keeping behavior identical. Changes are presentation and layout only; server actions, data flow, button labels, accessible names and test hooks (`.admin-card`, `.admin-card-summary`, `.admin-stat*`, `details.crm-details`, section `aria-label`s) are preserved.

- Shell: desktop left sidebar, phone top bar + bottom tab bar (Leads, Today, Jobs, Customers, Revenue). Week moved behind a Today / Next 7 days toggle (`app/admin/ScheduleTabs.tsx`); `/admin/week` route unchanged. Landing-page logo (`/quietgreen-logo-full.svg`) in header and sign-in.
- Styles: all admin CSS now lives in `app/admin/crm.css` (tokenized, scoped to `.admin-wrap`). Admin rules were removed from `app/globals.css`; the public booking time-window picker rules stay there. `app/admin/customers/customers.css` and its layout were folded in and deleted.
- Screens restructured: leads list rows, lead workspace (header actions, Request/Respond main column, Quote/Contact side column, save toast), job rows and expanded job card (facts grid + section cards), Today/Week route cards, calendar with day detail panel, customers list/detail, legacy phone history, revenue (HTML bar chart replacing SVG), sign-in.
- Test change: `tests/crm-lifecycle-ui.py` revenue label assertion is now case-insensitive (old CSS uppercased labels).
- Local disposable DB (56422) test fixtures were renamed to realistic Austin names/addresses for review screenshots; pre-rename data dump at `/tmp/before-realistic.dump` inside the `supabase_db_qg-crm-test` container. No production access.

### Staff flow simplification — 22 October 2026 (after owner UX review)

Owner found the lead/quote buttons confusing and upsells awkward. Independent read-only audit confirmed duplicate actions ("Save draft" = "Save draft estimate"), three meanings of "confirm", and no way to start work for an existing customer. Adopted mental model: **Lead** = inquiry until the first visit is booked; **Customer** = household, home for all later work; **Job** = one visit (To schedule → Scheduled → Done); **Plan** = recurring mowing schedule that creates jobs; **Quote** = price offered, outcome kept for pricing history.

- Lead price box: lawn care row holds checkbox, How often, calculated price and always-visible custom price; customer-facing step 3 hidden in staff mode; buttons **Save** / **Save as quoted** (= reviewed, D01/D06).
- Lead Quote panel: **Book visit** (records acceptance, creates job via `create_job_from_quote`, links new or staff-confirmed same-phone customer via `crm_link_job`, optionally starts a lawn-care-only plan via `crm_start_agreement`; all idempotent operation IDs), **Text price** (native Messages, staff sends), **Customer said no** (declined kept), **Reopen quote**. Booked leads hand off to the customer. Booking is hidden and rejected server-side when the contact address changed after quoting.
- Customer page: **+ Add job** (new `crm_create_customer_job`, staff-entered price snapshot, copies first acquisition) and **Start mowing plan** (first job + agreement). Active plan summary card.
- Job card: plain statuses, "Schedule visit", "Start mowing plan" with a single lawn-care template price, plan wording for pause/end/resume.
- Staff map pin on the Travis County parcel matching the house number (client-side public GIS query); grey approximate pin otherwise.
- Tests: label updates in mobile/workflow/addressless/lifecycle/integration suites; new `tests/crm-customer-actions.py`; `crm-upgrade.py` applies the new migration in order. All pass except the pre-existing stale `crm-integration.py` call-link assertion (expects unformatted phone).

### Quote outcomes and money display — 23 October 2026

- Quote outcome now has four honest states with price history: accepted, declined, **canceled** (said yes, backed out before the first visit), open. "Customer canceled" on a booked lead ends the plan started from that booking (canceling its upcoming visits), cancels the visit if not done, sets `quote_status='canceled'`, `stage='lost'`, keeps the accepted snapshot and adds an activity. Canceling that same latest quote job from the job card does the same (prompt warns); plan visits and Add-job extras never change the quote. "Book again" re-accepts and books. Test: `tests/crm-quote-cancel.py`.
- Money: one formatter (`formatMoney` cents for items/payments, `formatMoneyWhole` for tiles). Jobs tile is **Upcoming booked** (scheduled from today on); Revenue tiles **Paid all time / Paid this month / Upcoming booked / Completed jobs**, legacy recorded amounts moved to a footnote; completed table shows Price / Paid with Paid in full / Partly paid / Unpaid / Older record. Quotes say "per visit" only when lawn care repeats, otherwise "total".
- Jobs map "Today’s route" routes only today's scheduled visits in time order. No route optimization (owner deferred).

### Production handoff preparation — 23 October 2026

The owner authorized completing and pushing the release for Paxton’s laptop. Preserved the other agent’s staff UI/workflow changes, including the new customer-job function. Merged latest `origin/main` (`72f3c68`, Google review presentation, manual inquiry notes, hedge/tree services) to avoid regressing the current public site. No local test credentials enter Git.

Release fixes select the latest actual quote booking, excluding generated recurring jobs; require a concrete dated-visit preview before ending its plan; return the final lead version after booking/linking; report partial quote-outcome failures; allow accepted/address-changed recovery; and keep revised canceled quotes bookable. Old accepted job snapshots remain unchanged when rebooking at a new price. This work adds no migration beyond the redesigned CRM’s existing `20261023000000_crm_customer_job.sql`.

Independent Astra standards/security review found no new P1/P2 issues. Spec review found revised canceled quotes could become unbookable; the fix was reviewed and the finding closed. Final browser verification and the exact release evidence are recorded in the production handoff. The old setup document is historical; the current handoff lists the two required channel flags, exactly two recipients, actual signed webhook path and the POST recovery endpoint. Real calls/texts are authorized, but local provider credentials are placeholders. Production access, migrations, real delivery, each live ConviFlo mapping and ad-platform receipt must be verified on Paxton’s laptop.

Final release verification: optimized build/TypeScript and scoped lint passed. Isolated upgrade, alert/ConviFlo/public intake, auth/isolation, mobile/property, cancellation/revised-price history and full intake→quote→booking→recurrence/payment checks passed; full workflow ran against the production build locally. Independent review findings are closed. Branch is prepared for the authorized Paxton-laptop deployment; live configuration/phone/event acceptance remains in PRODUCTION-HANDOFF.md. No production or ad launch occurred here.

### Navigation feedback and top-lead speed — 23 October 2026 (presentation/perf only)

Owner asked for visible tap feedback and for the top lead to open instantly while on a call. No data, action or schema changes.

- `app/admin/NavProgress.tsx` (mounted in the admin layout): top loading bar plus `data-nav-pending` on the tapped in-app link until the URL commits; CSS in `crm.css` "Navigation feedback" gives tabs/lead rows/customer cards/filters a press and pending state. `loading.tsx` skeletons (`app/admin/PageSkeleton.tsx`) at `/admin`, `leads/[id]`, `customers/[id]`, `client/[phone]` make dynamic routes switch instantly.
- Leads list: the first two visible leads use `<Link prefetch>` (full route, cached ≤5 min client-side; stale saves are still rejected by the `updated_at` check). `LeadWarmup` then loads the MapQuoteBuilder/maplibre chunks, geocodes those addresses into sessionStorage (`cachedGeocode` in `lib/address-search.ts`) and pre-fetches zoom-18 imagery tiles (`lib/map-imagery.ts`). Address-needs-review leads are not geocoded.
- Staff quote map jumps straight to the house (no 4.2 s fly-in) and uses the cached geocode; the public map keeps its fly-in.
- Local `next start` cannot sign in without `STAFF_EMAILS`; verified on production after owner-authorized push to `main`.

### Lead board + press-1 phone flow — 28 October 2026

Built from `docs/ops-plan/PLAN.md` (decisions, execution ledger in section 11) on branch `claude/crm-phone-build-62cc5f`; go-live steps in `docs/ops-plan/PHONE-GO-LIVE.md`. Six-column lead board replaces the leads list (`/admin` now opens it; Jobs moved to `/admin/jobs`), lead page v2, two-step Log call sheet, Twilio press-1 claim/connect, staff texts, recordings, cron reminders. One shared module (`lib/lead-summary.ts`) produces every chip, price line and alert wording. Four additive migrations `20261028120000`–`20261028160000`. Existing leads start in New until the S8 placement script (`scripts/place-leads-on-board.mjs`) is reviewed and applied.
