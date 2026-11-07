# Edit plan (6 Nov 2026)

Customer page → **Edit plan** (shown when the customer has an active or paused plan). One sheet per plan
(a picker when there are several):

| Part | What it does | Never changes |
| --- | --- | --- |
| Service and price | New items for visits booked from now on (`crm_agreement_command` `price_template`). Tick *Also change the booked next visit* to reprice that one visit too (`crm_replace_job_items`). | Done/past visits, and the booked visit unless ticked (it may carry a first-visit discount). |
| How often | Weekly, every 2/3 weeks, monthly. The next visit keeps its date; later open plan visits re-space from it; open visits get the new label (`crm_change_agreement_interval`). | Done, canceled, skipped and overdue-before-next visits. Refuses if a new date lands on another visit of the plan. |
| Next visit date | Moves the whole plan (`moveVisit` → `crm_shift_agreement`). Email box starts unticked. If nothing is booked: *Book the next visit*. | Past visits. |
| Pause / resume / end | Pause cancels the upcoming visits listed (kept in history). With a restart date it resumes right away on that date. Resume needs a date. End cannot be undone. | Done and overdue visits. |
| Property or customer | Explained, not offered: bookings reference `(agreement, customer, property)`, so moving a plan would rewrite past visits. End it and start a new plan at the other property. | — |

## Plan types

A plan is whatever its `items_template` says. `planName()` (`lib/crm-jobs.ts`) names it: any mowing line
(`mow`, `lawn care`, …) → "Mowing plan", otherwise "<first service> plan" ("Maintenance plan"). Start plan
asks for the service (suggestions + free text), and a property can have more than one plan (mowing and
maintenance). The revenue forecast (`mowingForecast`) still counts mowing plans only.

## Deploy

Migration `supabase/migrations/20261106120000_crm_plan_edit.sql`: adds `crm_change_agreement_interval`;
replaces `crm_agreement_command` (only change: resume restarts the plan's rhythm from the resume date).
The new code calls the new function, so the migration must reach prod with the merge: owner OKs it, then
`npm run release` (migrates prod, then merges). Not applied anywhere but local PGlite.

## Testing

`tests/plan-edit.test.mjs` (PGlite, every migration). Click-through: `node scripts/dev-pglite-api.mjs`
(seed now includes Rosa Diaz with a bi-weekly mowing plan and a monthly $300 maintenance plan), `.env.local`
pointing at `http://127.0.0.1:56421`, `STAFF_EMAILS=staff@example.test`, then `npx next dev`.
