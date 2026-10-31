# Customer account page + Stripe payments: plan

Written 30 Oct 2026. Plan only; nothing here is built. Research and sources: [RESEARCH.md](RESEARCH.md). Phone mockups: [mockup.html](mockup.html). Open questions for Caelan: [§12](#12-open-decisions-for-caelan).

**In one line:** bill every completed visit through Stripe automatically (saved card charged, or an emailed pay link if no card), sync "paid" back to the CRM by webhook, and keep the customer page to one screen: next visit, what's due, card, past visits, contact.

---

## 1. What exists today (checked in code, 30 Oct)

**Customer page `/portal`** (`app/portal/page.tsx`, `login/`, `auth/callback/`)
- Sign-in: Supabase email magic link (`signInWithOtp`, `shouldCreateUser: true`). Any email can create a Supabase auth user. Staff use the same Supabase auth, told apart by `app_metadata.role = 'staff'` + `STAFF_EMAILS`.
- Data: bookings where `bookings.email` = the signed-in email (RLS `customer_read_own_bookings`, column grant to `authenticated`). Payments read with the service-role client, limited to those booking IDs.
- Shows: next confirmed visit (date, time, address, **sq ft**, frequency, price, **lawn map image**), a "booking received" notice for pending requests, past completed visits with paid amounts, a legacy `payment_link` "Pay now", Text/Email buttons, Sign out.
- Payment wording is long and uncertain ("Earlier amount recorded… not reconciled", "Please contact us to confirm the remaining balance").
- **Nothing links to it.** No email, text, footer or nav points to `/portal`; robots blocks it. Effectively unused.
- Keyed by booking email, not customer. Phone-booked jobs copy the lead's email (may be empty). Editing contact details changes one booking's email only, so a customer can lose older visits.

**Payments in the CRM**
- `job_payments` (amount, `paid_on`, method, `provenance` = `manual` | `processor_verified`, unique `operation_id`), written only by `record_job_payment` from staff ("Done + payment", Record payment). `processor_verified` exists but nothing writes it.
- `job_items` (service/discount lines) and `bookings.job_total`; `jobPrice()` = job_total → first_visit_price → price_per_visit.
- Legacy columns on bookings: `amount_charged`, `payment_method`, `payment_link`, `payment_recorded_at`.
- `extra_charges`: off-job one-offs (client name text, no booking/customer link).
- Staff button "Create Stripe payment link for job total" (`createPaymentLink` in `app/admin/actions.ts`): creates a Stripe Price + Payment Link, saves the URL on the booking. No webhook, so paying it changes nothing in the CRM.
- `customers` has no Stripe ID. No Stripe webhook route, no `STRIPE_WEBHOOK_SECRET`.

**How money actually moves:** Paxton marks the visit done, then sends a Stripe invoice by email from the Stripe dashboard, then records the payment in the CRM by hand ("Done + payment" or Record payment), if someone remembers.

**Customer-facing promises already live:**
- FAQ (`components/FAQ.tsx`): "after each visit you'll get a text with a secure payment link… Most customers save their card so future visits are charged automatically." **Doesn't match today's flow** (emailed invoice; the app never charges a saved card). Fix the copy now or build to match.
- Map quote: "No payment now · we'll email you a Stripe link after your first visit."
- Terms: "Payment is due after each completed visit unless we agree otherwise. We may send invoices or payment links by email or text." Cancel/pause "at any time by contacting us." No autopay wording yet.

**Pricing in code:** plan discount Weekly −15%, Every 2 weeks −10%, Monthly 0 (`lib/quote-offer.ts`); first visit −30% of the plan price, rounded to the dollar; phone-booked first visit now charges the −30% price (`callVisitItems()`). No sales tax anywhere in code or docs.

---

## 2. Scope

### In (each one earns its place)

| # | Item | Why it's in |
|---|---|---|
| 1 | **Auto-bill each completed visit** through Stripe | Removes Paxton's manual invoice step; the thing that costs real time today. Matches the terms ("due after each completed visit"). |
| 2 | **Saved card, charged after each visit** (opt-in per customer) | The FAQ already promises it; owners' top advice for not chasing payments; Jobber and LawnPro both offer "charge after each visit". |
| 3 | **Paid status synced by webhook** into `job_payments` | Staff stop recording Stripe payments by hand; CRM shows the truth. |
| 4 | **Next visit** on the customer page | The question customers ask most ("when are you coming?"). |
| 5 | **Due bill + Pay button** | Pay without a login or hunting an old email. |
| 6 | **Card on file: show / change / add** | Needed once autopay exists (expired cards, new cards). Stripe hosts the form. |
| 7 | **Past visits with paid chip + receipt** | "Did my payment go through?" and receipts for their records. |
| 8 | **Skip / Move / Pause / Cancel as a pre-filled text**, plus Text / Call / Email | Customers want to change dates easily; a text keeps a human in the loop and costs nothing to build. |

### Out (and why)

| Item | Why it's out |
|---|---|
| **Lawn tracing / map / sq ft** | Invites "my lawn is smaller, re-quote me." Customers don't need it to get mowed or pay. Remove the map image and sq ft the current page shows. |
| **Upsells / add-on offers** | Customers open the page to check a date or pay, then leave. Few visits, low trust in "offers" next to a bill, and a two-person crew sells better on the phone or in person after a visit. See RESEARCH.md §5. |
| Self-serve reschedule/skip/cancel that changes the schedule | None of the tools surveyed lets customers change the schedule directly; Housecall Pro sends it as a message. Routes, rain days and the plan engine stay with staff. A pre-filled text does the job. Revisit if date texts become a burden. |
| Passwords / accounts | Customers forget them; a link in each email is enough. |
| Quotes and approvals | Already handled by `/quote/[token]`. |
| Messages inbox, notifications settings | Texts and email already work. |
| Photos of each visit | Liked in reviews of bigger companies but needs a crew habit + storage. Later, if ever. |
| Monthly flat-rate / subscription billing, prepay discounts | Rain skips and first-visit pricing make it messy; see §5. |
| ACH bank debit, tips, surcharges | Not asked for; card + Link covers it. |
| Multiple properties UI | Rare; the page lists all of a customer's visits with the address on each if there's more than one. |
| Billing `extra_charges` through Stripe | Those rows have no job or customer link. Staff keep sending those by hand for now. |

---

## 3. Screens (customer)

See [mockup.html](mockup.html) for all four at 360 px.

**A. Account page** (one screen, top to bottom)
1. **Due** card, only when something is unpaid: amount, visit date chip, **Pay $X** (Stripe hosted invoice page).
2. **Next visit**: date, time window, address; chips: frequency, price for that visit.
3. **Payment**: "Visa •••• 4242 · Change" + "Autopay" chip, or "No card saved · Add card".
4. **Visits**: last 3 completed (date, amount, Paid/Due chip, Receipt link). "Show all" expands.
5. **Need something?** chips "Skip Nov 4", "Move Nov 4", "Pause" open the phone's text app to Paxton's number with a filled message ("Hi, it's Jane at 1204 Oak St. Please skip Nov 4."). Text / Call / Email buttons.

No sentences, no sign-out button needed (link-based), no map, no sq ft.

**B. Pending booking** (website booking not yet confirmed): Next visit card reads "Requested · Tue, Nov 4" with an amber chip. Nothing else changes.

**C. "Send my link"** (old link, or someone types `/account`): one field (email or phone), one button. Always answers "Link sent" whether or not we found them (no account guessing).

**D. Nothing found** (valid link, customer has no visits yet): Next visit card says "Not scheduled" + Text us.

Customer-facing words: Weekly · Every 2 weeks · Monthly · One time (staff words). Note the website quote still says "Bi-weekly"; pick one for customers (§12 Q9).

---

## 4. Getting in (auth)

**Recommend: a signed account link, no login.**
- Every customer email (visit scheduled, receipt/bill, "add your card") carries `quietgreen.co/account/<token>`. Token = customer ID + expiry, HMAC-signed with the existing server secret, same pattern as `leadToken()` for `/quote/[token]`.
- Opening it sets a short httpOnly cookie for that customer (so refreshes and "Show all" work), then shows page A. Server reads with the service-role client, filtered by `customer_id`. No Supabase auth user for customers.
- Token lifetime 60 days; each email refreshes it. Expired → screen C.
- Screen C: email or phone → if it matches exactly one customer, email them a fresh link (Resend). Same reply either way. Rate-limit by IP and target.
- Retire the Supabase magic-link sign-in for customers (`/portal/login`, `/portal/auth/callback`), redirect `/portal` → `/account`. Customer pages stop depending on `bookings.email` RLS; staff auth is untouched. (Removing the `customer_read_own_bookings` policy and column grant is a later cleanup migration, not needed for launch.)

Why not keep the Supabase magic link: it needs a trip to the inbox every time, the default Supabase mailer is not meant for customer mail (needs custom SMTP), it creates auth users for anyone, and it keys on booking email, which drifts. Why the link is acceptable: it shows a schedule and bills, not stored card numbers; card changes happen on Stripe's page. A forwarded link exposes the next visit date and address, which is the main risk (§9).

---

## 5. Payment model

### Recommendation: pay per visit, billed when the visit is marked Done
- **Card saved → charged automatically** for that visit's amount. Stripe emails the receipt.
- **No card → Stripe emails a bill** with a Pay button (what Paxton does by hand today, but automatic). Due in 7 days; Stripe sends reminders.
- Saving a card is **encouraged, not required** to book (keeps "no payment upfront" true). Default ask: link to save a card goes out with the first visit's confirmation; the first bill's email has it too. (§12 Q2 asks whether to require a card for plans.)

Why this model:
- Matches the terms and the site copy; no customer re-education.
- Prices already vary visit to visit (first visit −30%, overgrowth fee, extras). Per-visit billing just charges `jobPrice()` for that job. No proration, no credits.
- Rain skip or a paused week costs nothing to handle: no visit, no charge.
- One Stripe object per visit = one clear mapping to one CRM job for paid sync.

Rejected:
- **Monthly flat autopay** (common with bigger companies): needs a seasonal average, credits for rain-outs, and a rule for the first-visit discount. Real admin cost for two people.
- **Prepay/seasonal**: refunds when customers cancel; not asked for.
- **Stripe Subscriptions**: built for fixed recurring amounts; our amounts vary per visit.

### Simplest Stripe setup for it
One code path: **one Stripe Invoice per completed visit.**
1. Each CRM customer gets a Stripe Customer the first time they're billed (`customers.stripe_customer_id`). Email + name from the CRM.
2. Visit marked Done → server creates an Invoice for that customer with the job's lines (one "Lawn mowing · Nov 4" line at the job price; first visit adds a "First visit 30% off" line; extras as their own lines), metadata `booking_id`, idempotency key `visit-invoice-<booking_id>`. Stripe forgets keys after ~24 hours, so the job's `stripe_invoice_id` (unique) is the lasting guard: no second invoice for a job that has one.
   - Card saved: `collection_method: charge_automatically`.
   - No card: `collection_method: send_invoice`, `days_until_due: 7`.
3. Leave it as a draft with auto-advance on: Stripe finalizes and charges/emails it about an hour later. That hour is the undo window (fix a price, or un-Done and the draft is deleted). Don't subscribe the webhook to `invoice.created`: if that endpoint fails, Stripe holds finalization up to 72 hours.
4. Saving a card: a Stripe Checkout Session in `setup` mode for that Stripe customer, linked from email and the account page. It shows our autopay terms with Stripe's reuse-consent checkbox: *"We charge this card after each completed visit, for that visit's price (plan price, first-visit discount, any extras you approve). Receipt by email each time. Text or email us to stop."* On success, set the card as the customer's default for invoices. Stripe keeps the consent record.
5. Card changes later: Stripe Customer Portal session (payment methods + invoice history only, works without subscriptions) from the account page's "Change".
6. Stripe sends: receipts (turn on "Successful payments" emails), bill emails and reminders for no-card invoices, failed-payment and 3-D Secure emails. Docs disagree on whether automatic retries for one-off invoices need Invoicing Plus; check the Dashboard at setup. Either way, on `invoice.payment_failed` we send one short email of our own ("Card didn't go through · Pay $45" + the hosted invoice link) so a failure never goes silent.

Cost on a $45 visit: card $1.61 + invoice fee (Invoicing Starter, 0.4%) $0.18 = **$1.79**. At ~1,000 visits a year the invoice fee is ~$180. The trade is one code path, a hosted pay/receipt page, Customer Portal history, and Stripe-run reminders. Alternative to skip the 0.4%: charge saved cards with a bare PaymentIntent and keep invoices only for no-card customers (two code paths, our own failure handling, no hosted receipt page for autopay visits). §12 Q3.

**Sales tax decides the invoice shape.** Texas lists mowing as a taxable service with no residential exemption (RESEARCH.md §7). If QuietGreen must collect it: add one manual Stripe Tax Rate (free; Stripe Tax at 0.5% isn't needed for one metro) to every invoice, and decide whether prices include tax or add it. Austin-area cities are mostly 8.25%; confirm rates for service addresses outside city limits. This needs an answer from a tax adviser before automatic billing goes live. §12 Q13.

Retire the "Create Stripe payment link" button once this ships; existing links keep working and stay visible.

Set the hosted invoice page's "save payment details" option to **Never**, so the only way into autopay is the card link with our terms (one path, one consent wording).

### Pricing decisions this forces
- **None to the price list.** Per-visit billing charges each job's existing `jobPrice()`: plan discount stays inside the per-visit price, first visit −30% stays a job line, overgrowth fee and extras are job lines added before Done.
- **What the bill shows** (Q10): proposed one line per visit at the plan price, plus a "First visit 30% off" line on the first visit only.
- **Card fees** (Q11): absorbed. No surcharge, no cash discount.
- **Prices change mid-plan:** the next Done bills the new price. Tell the customer by text first; the autopay terms say the amount follows the plan price.
- **Off-job extras** (`extra_charges`): still billed by hand. Do the work as a job line on a visit instead when possible.
- **Sales tax** (Q13): the one real decision, and it changes every bill.

---

## 6. Paid sync (can ship before the account page)

Webhook route `app/api/stripe/webhook/route.ts` (Node runtime): read the raw body with `request.text()`, verify with `stripe.webhooks.constructEvent` and `STRIPE_WEBHOOK_SECRET`, log the event ID, handle, return 200. Stripe retries for up to 3 days and may deliver twice or out of order, so every handler is idempotent (event ID, plus object ID + type) and status changes never move backwards (e.g. a late `invoice.finalized` can't overwrite `paid`). Register the exact production host (no apex↔www redirect). Vercel preview URLs return 401 to Stripe, so test with the Stripe CLI on localhost.

| Stripe event | What we do |
|---|---|
| `invoice.finalized` | Save `stripe_invoice_status = open`, hosted invoice URL on the job. |
| `invoice.paid` | If not paid out of band: insert `job_payments` (amount paid, `paid_on` = paid time in Austin date, method `Stripe`, provenance `processor_verified`, `stripe_ref` = invoice ID; unique, so replays do nothing). Status `paid`. |
| `invoice.payment_failed` | Status `failed`. CRM shows red "Card failed". Stripe emails the customer and retries per its settings. |
| `invoice.voided` / `invoice.marked_uncollectible` | Status `void` / `uncollectible`. |
| `checkout.session.completed` (setup mode) | Set the new card as the Stripe customer's invoice default; cache "Visa 4242" on the CRM customer. |
| `customer.updated`, `payment_method.detached`, `payment_method.automatically_updated` | Refresh the cached card label. A card brand change needs the customer to re-save (new consent): show "No card" and send the card link. |
| `charge.refunded`, `charge.dispute.created` | v1: log only + staff alert. Staff fix the CRM by hand (§9). |

**Manual fallback stays first-class.** The CRM never needs the webhook to work: paid = sum of `job_payments` ≥ job price, whatever wrote them. Staff can always Record payment (cash, Venmo, Zelle, or a Stripe payment the webhook missed).
- Recording a manual payment on a job with an open Stripe invoice also marks that invoice paid out of band in Stripe (stops reminders). The resulting `invoice.paid` event is ignored because it's out of band.
- If a webhook is missed, a "Check Stripe" button on the job page re-reads the invoice and applies the same handler (no cron needed).

---

## 7. Data changes (one migration, additive)

Timestamp later than the newest file at build time (the Today/Jobs branch adds `20261030120000_crm_visit_flow.sql`).

```
customers
  + stripe_customer_id text unique
  + card_label text                 -- "Visa 4242", cached from Stripe; null = no card
  + portal_token_version int not null default 1   -- bump to kill old links

bookings (jobs)
  + stripe_invoice_id text unique
  + stripe_invoice_url text         -- hosted pay/receipt page
  + stripe_invoice_status text      -- draft | open | paid | failed | void | uncollectible
  + billed_at timestamptz

job_payments
  + stripe_ref text unique          -- invoice ID; null for manual rows
  + tax_amount numeric(12,2)        -- only if Q13 says collect tax; keeps Revenue pre-tax
  (provenance 'processor_verified' already exists)

stripe_events                       -- service-role only
  id text primary key, type text, received_at timestamptz, handled_at timestamptz, error text
```

RLS: all new columns sit on tables already locked to the service role; `stripe_events` the same. The account page reads through the server only.

Writes go through SQL functions like the rest of the CRM (`record_stripe_payment`, `set_job_invoice`), keyed on `stripe_ref` / `stripe_invoice_id` for idempotency, reusing `record_job_payment`'s exact-cents rule.

Env: `STRIPE_SECRET_KEY` (exists), `STRIPE_WEBHOOK_SECRET` (new), optional `STRIPE_PORTAL_CONFIG_ID`.

---

## 8. CRM touchpoints (minimal)

| Screen | Change |
|---|---|
| Jobs card | One payment chip: **Paid $45** · **Due $45** · **Card failed** · **Not billed** (completed, no invoice, no payment). |
| Job page | Payment card: status line + "Open in Stripe" / "Copy pay link" / Record payment / Check Stripe. Replaces the payment-link button. |
| Customer page | Header chip **Autopay · Visa 4242** or **No card**; **Owes $X** if anything is due; "Send card link" button (emails the save-card link). |
| Revenue | Paid totals already come from `job_payments`; add one **Unpaid** row (count + total, tap for list). |
| Today | Nothing. |
| Done flow | Unchanged for staff. "Paid now" (cash etc.) still records a manual payment and skips the Stripe invoice. |

These are additive to whatever the Today/Jobs redesign ships; the build pass places the chip wherever that redesign shows job status.

---

## 9. Edge cases (and the call for each)

| Case | Handling |
|---|---|
| Customer has no email (phone booking) | Can't bill through Stripe email. Job shows "Not billed · add email"; staff get the email on the next call or use a manual payment. Saved card still works without email but receipts need one. |
| Card declines / expires | Invoice stays open; Stripe retries and emails the customer a pay link; CRM shows "Card failed"; account page shows Due + Pay. |
| Card needs 3-D Secure off-session | Same as decline: customer pays on the hosted page once. |
| Price changed after Done | Within the hour: the draft updates (rebuild lines). After finalize, unpaid: void + reissue. After paid: refund the difference in Stripe, Record payment fixes in CRM. |
| Visit un-Done by mistake | Draft → delete; open → void; paid → refund in Stripe. |
| Done replayed / double-click | Idempotency key per booking + unique `stripe_invoice_id`: one invoice. |
| Paid in cash after the bill went out | Record payment → mark invoice paid out of band. |
| Webhook down or missed | CRM still works (manual); "Check Stripe" repairs a job. Stripe retries for days. |
| Refund / dispute | Done in Stripe dashboard; webhook alerts staff; staff adjust CRM. Not automated in v1 (rare). |
| Two customers share an email (couple) | Account page is per customer ID, not email. "Send my link" with a shared email sends one email listing both links, or the newest; pick at build (rare). |
| Customer changes email | CRM edit updates the Stripe customer's email. |
| Customer cancels with an unpaid visit | Bill stays; normal reminders. |
| One-time jobs | Same path: bill on Done. |
| Legacy jobs (`amount_charged`, old `payment_link`) | Show as Paid if a payment exists or `payment_method` is set; otherwise hide from Due (don't chase history). |
| `extra_charges` (off-job) | Not billed by this system. |
| Forwarded account link | Shows schedule + bills; can't see card numbers; Pay just pays. Staff can bump `portal_token_version` to kill links. |
| Test vs live | All build and tests in Stripe test mode with the Stripe CLI forwarding webhooks. Live keys only in the owner's deploy handoff. |

---

## 10. Acceptance checks (test mode)

1. Plan visit with saved card (4242) marked Done → draft invoice; after finalize, paid; `job_payments` row `processor_verified`; Jobs chip **Paid $45**; account page shows Paid + Receipt.
2. Same with a declining card (Stripe's decline test card) → **Card failed** in CRM, Due + Pay on account page; paying on the hosted page flips both to Paid.
3. No-card customer → Stripe emails a bill; paying it syncs Paid.
4. First visit bills the −30% price as two lines that sum to the job price.
5. Replay every webhook event twice (Stripe CLI `events resend`) → no duplicate payments.
6. Record a cash payment on a job with an open invoice → invoice paid out of band in Stripe, no second payment row.
7. Un-Done within the hour → draft deleted, nothing charged.
8. Webhook secret wrong → 400, nothing written; CRM still records manual payments.
9. Account link: valid → page; expired → screen C; tampered → screen C; "Send my link" answers the same for known and unknown inputs.
10. Account page at 375 px: no map, no sq ft, no horizontal scroll; 44 px tap targets; Skip chip opens SMS with date and address filled.
11. Autopay consent: the card link shows our terms and Stripe's consent checkbox; the saved card becomes the invoice default; a forced `invoice.payment_failed` sends our one "Card didn't go through" email.
12. If Q13 says collect tax: every invoice carries the tax line and the CRM's paid amount matches the invoice total.
13. CRM pages work with `STRIPE_SECRET_KEY` unset (chips fall back to manual payments; Stripe actions show "Stripe not configured").

---

## 11. Build order (one pass, three shippable steps)

1. **Bill + sync (no customer page changes).** Migration; Stripe customer creation; invoice on Done (no-card path only: emailed bill); webhook route + handlers; CRM chips, job Payment card, Unpaid row; retire payment-link button. *Ships alone; ends Paxton's manual invoicing.*
2. **Autopay.** Checkout setup link (customer page "Send card link", first-visit email), default card, `charge_automatically` path, card label sync, Customer Portal config. Update Terms (autopay wording) and FAQ.
3. **Account page.** `/account/[token]` + cookie + screen C + Resend link email; links added to visit/scheduling emails; `/portal` redirect; remove map/sq ft; Skip/Move/Pause text chips.

Owner tasks before step 1 goes live (add to the deploy handoff): sales tax answer (Q13); Stripe test + live webhook endpoints and secrets in Vercel; Stripe email settings (successful-payment receipts, invoice emails, reminders, failed-payment and 3DS emails, retries; hosted-invoice "save card" = Never) and branding; Customer Portal configuration (payment methods + invoice history only); confirm the Resend sending domain; apply the migration with `supabase db push` before the code.

Fix now regardless of build: the FAQ line about texts and saved cards (§1).

---

## 12. Open decisions for Caelan

Lean first. Each is yes/no or A/B.

1. **Payment model: per visit, billed on Done** (A) vs monthly flat autopay (B)? **Lean A.**
2. **Require a saved card for recurring plans?** Yes / No (encouraged, not required). **Lean No for now**; revisit if unpaid bills pile up.
3. **One Stripe Invoice per visit for everyone** (A, small Stripe invoice fee, Stripe handles receipts/retries/reminders) vs bare card charge for autopay + invoices only for no-card (B, cheaper, more code)? **Lean A.**
4. **Bill automatically when Done** (A, with Stripe's ~1 hour draft window to fix mistakes) vs a "Send bill" button per job (B)? **Lean A.**
5. **Account link in emails, no login** (A) vs keep the email sign-in page (B)? **Lean A.**
6. **Hide the lawn map and sq ft from customers?** Yes / No. **Lean Yes.**
7. **No upsells on the account page?** Yes / No. **Lean Yes (none).**
8. **Skip/Move/Pause as pre-filled texts** (A) vs buttons that change the schedule (B)? **Lean A.**
9. **Customer frequency words: "Every 2 weeks"** (match staff) vs "Bi-weekly" (current website)? **Lean "Every 2 weeks"** everywhere.
10. **Invoice lines: show the first-visit discount as its own line** (A) vs one net line (B)? **Lean A** for the first visit only; plan discount folded into the price (no line).
11. **Absorb card fees, no surcharge?** Yes / No. **Lean Yes.**
12. **Ship step 1 (bill + sync) before the account page?** Yes / No. **Lean Yes.**
13. **Sales tax** (blocks automatic billing): does QuietGreen collect Texas sales tax on mowing today? If it must: prices **include** tax (A, customer price unchanged, ~7.6% less margin) vs tax **added** on the bill (B, +8.25% to the customer)? **Lean: ask a tax adviser first; then B for new customers, A for existing ones until their next price change.**
14. **Build the account page at all?** Steps 1–2 alone give customers a bill with a Pay button, receipts, and Stripe's card page. The account page adds "next visit" and history in one place. **Lean Yes, small, as step 3**, after billing has run for a few weeks; drop it if nobody asks for it.
