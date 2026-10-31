# Plan customers: log, pay, move (30 Oct 2026)

Owner report: no clear way to log each visit for an existing plan customer; Liz Watson's data looked
inconsistent; no obvious way to move Dmitre's visit a week earlier.

## Why Liz's data looked wrong

From the code paths (production rows were not read; run the check below to confirm):

1. **Two separate first visits.** Her Oct 30 visit ($65, "biweekly", 3,500 sq ft) came from the lead
   booking and was linked to her customer record. "Start mowing plan" on the customer page then created
   a *new* first visit (Aug 28, $85, staff-typed price) instead of using the Oct 30 one. Nothing could
   connect a lead's recurring booking to an existing plan afterwards.
2. **Oct 30 can't be completed.** It says recurring but belongs to no plan, and completion refuses that
   (so the plan isn't silently dropped). The job card only offered "mark one-time" or starting a second plan.
3. **"Next visit Sep 11" is stale.** The plan's `next_on` is the date it will book *after* the current
   visit is done. Customer-page plans created their first visit as "To schedule", and only a
   "Scheduled" visit can be completed, so Aug 28 was never done and the plan never advanced.
4. **$65 vs $72 vs $85.** $65 is the quoted every-2-weeks price; the job card shows "$72 full" by working
   the 10% plan discount back out of $65. $85 is what was typed into Start mowing plan. Pick one; later
   plan visits use the plan price ($85) until it is changed.

## The flow now (customer page)

Customer → **Upcoming visits** → on a visit:
- **Done** → date + optional "Paid now" amount/method → *Mark done & record payment*. A plan visit books
  the next one (never in the past, never a second open one). A "To schedule" visit can be marked done directly.
- **Move** → new date (+ optional "Move the rest of the plan too", optional email to the customer).
  Only-this-visit keeps the plan's rhythm; whole-plan shifts this and later visits by the same days.
- **Add to mowing plan** on a recurring visit that isn't in the customer's plan (keeps its own price;
  the plan continues from its date). **Cancel visit** for a visit that will not happen.
- The plan card shows the real next booked visit (and "overdue" when it is past).
- **Start mowing plan** offers a visit already booked at that property as the first visit, so it is
  not duplicated, and schedules the first visit on its date.

The Jobs card gets the same "Add to mowing plan" and "Move the rest of the plan too".

## Fixing Liz (and anyone like her) — in the app, after deploy

1. Open her customer page. Oct 30 shows *Recurring, not in a plan* → **Add to mowing plan**.
2. Aug 28 (overdue, never happened) → **Cancel visit**. No extra visit is created.
3. If the plan price should be $65, open the Oct 30 job card → Job items and price → set Lawn care
   to 65 → *Use these items for future visits*.
4. Oct 30 → **Done** (+ payment). Nov 13 appears.

No data migration is needed; every step is an existing-style command with history kept.

## Read-only check (needs the owner's OK to run on prod)

```sql
-- Recurring visits outside a plan while the customer has an active plan at that property
select b.id, b.name, b.status, coalesce(b.confirmed_date,b.preferred_date) as on, b.frequency, a.id as plan
from bookings b join recurring_agreements a on a.customer_id = b.customer_id and a.property_id = b.property_id
where b.agreement_id is null and a.status = 'active' and b.status in ('pending','confirmed')
  and not coalesce(b.one_time,false) and coalesce(btrim(b.frequency),'') !~* '^(one[ -]?time|single|once)?$';
-- Active plans whose next booked visit is overdue, or with none booked
select a.id, c.name, a.next_on, min(coalesce(b.confirmed_date,b.preferred_date,b.occurrence_on)) as next_open
from recurring_agreements a join customers c on c.id = a.customer_id
left join bookings b on b.agreement_id = a.id and b.status in ('pending','confirmed')
where a.status = 'active' group by a.id, c.name, a.next_on
having min(coalesce(b.confirmed_date,b.preferred_date,b.occurrence_on)) is null
    or min(coalesce(b.confirmed_date,b.preferred_date,b.occurrence_on)) < (now() at time zone 'America/Chicago')::date;
```

## Deploy

Migration `supabase/migrations/20261030120000_crm_visit_flow.sql` (replaces `crm_generate_next_job`, adds
`crm_attach_to_agreement` and `crm_shift_agreement`). Not applied anywhere but local PGlite. Order:
`supabase db push --dry-run`, `supabase db push`, then merge. The new code calls the new functions, so
push the migration first.

## Testing without Docker

`tests/visit-flow.test.mjs` runs every migration in PGlite (`tests/pglite-db.mjs`) and is part of
`npm test`. For clicking through the CRM: `node scripts/dev-pglite-api.mjs` (local Supabase stand-in
with demo customers) plus `.env.local` pointing at `http://127.0.0.1:56421` and
`STAFF_EMAILS=staff@example.test`; sign in as that address with any password.
