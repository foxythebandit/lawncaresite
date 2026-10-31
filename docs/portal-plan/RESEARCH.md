# Customer portal + payments: research

Done 30 Oct 2026 for [PLAN.md](PLAN.md). Web research only. Reddit and most LawnSite/Jobber Community threads were blocked to the fetcher, so homeowner complaints come from review sites, BBB and vendor docs: treat them as anecdotes. Vendor numbers are vendor numbers.

---

## 1. Short version

- Every tool gives customers the same core: **upcoming + past visits, invoices with a Pay button, a saved card, and a way to ask for things.** That's the floor, and it's also roughly the ceiling of what customers use.
- Newer small-business tools (Jobber, Housecall Pro, GorillaDesk, CoPilot) let customers in **by a link in an email or text, no password.** Older/commercial ones (Service Autopilot, Aspire, LawnPro) use passwords.
- **No tool clearly offers self-serve skip/reschedule/cancel.** Housecall Pro sends it as a message; the rest don't document it. Businesses keep the schedule.
- Customers mostly **pay from the emailed link** without opening any portal. Portal use is thin: in one vendor survey only 30% of contractors saw most clients actively use theirs.
- The main homeowner complaint around billing is **autopay surprises**: charged for a skipped visit, after cancelling, or for work not done.
- Lawn-care owners widely push **card on file** (charged after each visit, or monthly) as the biggest fix for chasing payments.

---

## 2. What each tool gives the end customer

| Tool | Getting in | Sees | Can do | Schedule changes |
|---|---|---|---|---|
| **Jobber Client Hub** | Link in email/text, no password; after 14 days confirms email or last 4 of phone | Past visits + next 5 (date, window, address, crew), quotes, invoices, receipts | Pay (+tip), approve quotes, card wallet, request work, refer a friend | Not self-serve; reminders have "Confirm appointment" |
| **Housecall Pro** | Magic link, 7-day life, auto re-sent when expired | Past/upcoming appointments, invoices (unpaid banner), estimates | Pay, approve estimates, manage card, book online | **Request** via "Send a message" |
| **LawnPro** | Link from invoice email, then sets a password | Invoice history, balance, upcoming visits | Pay several invoices, save card/ACH, turn on autopay (customer-controlled), service request | Not mentioned |
| **Yardbook** | Unverified | Invoices (third-party sources) | Pay via Stripe link | Unverified |
| **Service Autopilot** | Username + password (2021 docs) | Upcoming services, history, balance | Pay, update card, autopay, tickets | Unverified |
| **Aspire** (commercial) | Invite, email + password | Proposals, invoices, issues | Unverified | Unverified |
| **GorillaDesk** | "Manage portal" link in messages | Appointments (tech name/photo), estimates, overdue invoices | Pay, manage card, requests, contact form | Request, business confirms |
| **CoPilot CRM** (Augusta's affiliate) | Links in invoice/estimate emails and texts; optional login | Invoices, estimates, payments, before/after photos | Edit card, prepay credit, request work, rate visit | Not documented |

Autopay is usually **switched on by the business per job** (Jobber, GorillaDesk). Jobber can charge after each completed visit, at month end, or when the job closes; a failed charge is tried once and the business is told. LawnPro is the exception: the customer ticks two boxes (allow charges, turn on auto-charge) and is charged as soon as the invoice exists.

Sources: [Jobber Client Hub](https://help.getjobber.com/en/articles/what-do-your-clients-see-in-client-hub/), [Jobber automatic payments](https://help.getjobber.com/en/articles/automatic-payments/), [Housecall Pro portal](https://help.housecallpro.com/en/articles/8448657-using-the-customer-portal), [LawnPro portal](https://www.lawnprosoftware.com/features/client-portal), [LawnPro auto-charge](https://lawnprosoftware.com/features/auto-charge-on-file), [Yardbook (SoftwareWorld)](https://www.softwareworld.co/software/yardbook-reviews), [Service Autopilot release notes 2021](https://www.serviceautopilot.com/software-updates/release-notes-march-2021/), [Service Autopilot portal](https://serviceautopilot.com/client-portal-and-sa-payments), [Aspire portal](https://guide.youraspire.com/docs/es/customer-portal), [GorillaDesk portal](https://gorilladesk.com/features/customer-portal/), [GorillaDesk autopay](https://intercom.help/gorilladesk/en/articles/5963697-automatic-payments-using-invoice-frequency), [CoPilot portal](https://copilot.crunch.help/en/customers/the-client-portal).

---

## 3. Augusta Lawn Care

- **Billing:** monthly invoice in arrears by email, pay by card or check, optional autopay ([augustalawncareservices.com](https://augustalawncareservices.com/lawn-mowing)). Standardized pricing.
- **Software:** their 2025 franchise disclosure names **CoPilot Software LLC** (an affiliate, since Jan 2023) as the recommended, optional CRM ([FDD summary](https://www.fdd.ninja/brands/augusta_lawn_care/2025/copilot_software_llc_crm_software_required_franchisees)). CoPilot's portal: links in emails/texts, invoices, card, prepay, before/after photos. No source confirmed Jobber.
- **Warning sign:** a BBB profile for one franchise lists complaints about card-on-file charges for treatments "not performed, and not agreed to" ([BBB](https://www.bbb.org/us/wa/bellingham/profile/lawn-care/augusta-lawn-care-services-1296-1000074958/complaints)).
- Couldn't find an Aaron Ward video specifically on billing. Card-on-file is a common theme in lawn-care YouTube/podcasts, e.g. ["How getting paid wrong cost me my truck (and how card on file doubled my income)"](https://www.buzzsprout.com/2269105/episodes/18660568-ep-72-how-getting-paid-wrong-cost-me-my-truck-and-how-card-on-file-doubled-my-income).

**Take for QuietGreen:** copy the parts that fit two people (card on file, emailed invoices, simple portal by link). Skip monthly billing: it suits a franchise with office staff and standardized pricing, and our first-visit discount and rain skips make it messier (see §6).

---

## 4. What customers praise and complain about

**Praise:** easy quote approval and paying an invoice ([G2 Jobber](https://g2.com/products/jobber/reviews), [GetApp](https://www.getapp.fr/software/90723/jobber)); customers can pay straight from the email without the portal ([Capterra Housecall Pro](https://www.capterra.com/p/140363/HouseCall-Pro/reviews/?page=4)).

**Complaints:**
- **Logging in at all.** A Jobber Community owner: infrequent customers "aren't going to remember they have a client hub" ([thread](https://community.getjobber.com/discussions/customer-management-and-self-serve/client-hub-options/1259), snippet). Vendors moving to no-password links and auto-resent links point the same way.
- **Autopay surprises:** charged for skipped mows with no notice ([Yext review](https://directory.yext.com/en/buffalo-outdoor-lawn-care-pest-control-1822104585)), charged after cancelling, charged for work not done (Augusta BBB above). LawnStarter charges **3 days after** the job so customers can see the work first ([LawnStarter](https://www.lawnstarter.com/blog/lawnstarter/how-lawnstarter-handles-complaints-disputes/)).
- General navigation gripes after updates; nothing specific about portals confusing customers.

**How much portals get used (thin data):**
- ServiceTitan (commercial contractors): ~75% offer a portal; only 30% see most clients actively use it ([ServiceTitan](https://www.servicetitan.com/blog/webinar-recap-unlock-a-better-customer-experience)).
- Software Advice 2015, residential services, n≈8,000: 55% would use bill pay most, 50% scheduling ([secondary report](https://ecdonline.com.au/content/field-service/article/what-your-customers-want-868279548); original not found).
- No lawn-specific number for "logged in" vs "paid from the link."

---

## 5. Customer needs, ranked, and what that means for us

| Need | Evidence | Our answer |
|---|---|---|
| Pay easily | Every tool; top in surveys; customers pay from the email | Stripe-hosted pay page from every bill; Pay on the account page |
| Not be chased / not forget to pay | Owners' #1 billing fix is card on file | Optional autopay, charged only for visits marked Done |
| Know when you're coming | Every tool shows upcoming visits | Next visit card |
| Proof of payment | Receipts in every tool | Stripe receipts; Receipt link per visit |
| Change a date / skip / cancel | 50% want scheduling, but no tool lets customers change the schedule directly | Pre-filled text to us |
| Update a card | Every tool with autopay | Stripe-hosted card page |
| Not be surprised by charges | Main complaint | Charge only after Done; receipt every time; clear autopay terms |
| Quotes, work requests, referrals, photos, tips | Present in bigger tools | Out for v1 (quotes already have `/quote/[token]`) |

**Overkill for a two-person company:** password accounts, in-portal messaging, online booking inside the portal, multi-property dashboards, prepaid credit balances, level/flat monthly billing, tips, referral programs, per-visit photos, customer-controlled autopay toggles separate from saving a card.

**Lawn map in the portal:** no tool above shows customers a measured lawn outline in their portal. It's a quoting tool. Showing it invites re-measuring and re-quote requests without helping the customer get mowed or pay. Recommend hiding it (and sq ft).

**Upsells in the portal:** none of the tools lead with offers in the customer view; the closest are "Request work" and "Refer a friend" (Jobber). Reasons not to put upsells there: few customers open the page; those who do come to check a date or pay and leave; an offer next to a bill reads as pushy in exactly the moment trust matters most (see autopay complaints). Better places, if wanted later: a seasonal email or a word from the crew after a visit (e.g. leaf cleanup in November). *This part is our reasoning, not measured data.*

---

## 6. Lawn-care billing models

| Model | Who uses it | Good | Bad |
|---|---|---|---|
| **Pay per visit, invoice after** | Our current setup | Simple, exact | Chasing; 30-day collection claimed at 54–71% when customers must act ([MyQuoteIQ](https://myquoteiq.com/best-recurring-billing-software-lawn-care-2026/), [ReliaBills](https://www.reliabills.com/blog/recurring-billing-lawn-care-landscaping-services-setup/), vendor claims) |
| **Card on file, charged after each visit** | Jobber/LawnPro default option, common advice | No chasing; charge sits next to a finished visit; rain skips free | Some customers push back on giving a card ([LawnSite](https://www.lawnsite.com/threads/force-customers-to-put-a-credit-card-on-file.361084/), title only) |
| **Monthly invoice in arrears** | Augusta | One bill a month; fewer transactions | Month-end admin; late payers without autopay |
| **Flat monthly / level billing** | Bigger companies | Predictable winter income ([NALP](https://blog.landscapeprofessionals.org/predictable-profits-the-case-for-flat-monthly-billing-rates/), [LawnPro](https://lawnprosoftware.com/features/level-billing)) | Needs season averages, discounts expected, credits for rain-outs |
| **Prepay** | Rare | Cash up front | Refunds on cancel; nothing solid found |

No independent data compares late-payment rates across models. Jobber claims cards get paid "4x faster than checks" ([Jobber](https://help.getjobber.com/hc/en-us/articles/115009571387)), unsourced.

---

## 7. Stripe options (docs read 30 Oct 2026)

**Save a card once**
- **Checkout Session, `mode: 'setup'`**, with our own Stripe `customer` and `currency: 'usd'`. Stripe hosts the form. `consent_collection.payment_method_reuse_agreement` and `custom_text` show our autopay terms. The card comes back on `checkout.session.completed` (via its `setup_intent`); set it as the customer's `invoice_settings.default_payment_method`. ([save and reuse](https://docs.stripe.com/payments/checkout/save-and-reuse?payment-ui=stripe-hosted), [sessions API](https://docs.stripe.com/api/checkout/sessions/create))
- Consent for later charges must state: that we'll charge them, when (after each completed visit), how the amount is set, and how to cancel. It needs an explicit opt-in and a record of it. ([CITs and MITs](https://docs.stripe.com/payments/cits-and-mits)) No Stripe rule requires a notice before each charge; a receipt after each one is good practice.
- Paying a one-off invoice can also save the card: the hosted invoice page has a "save payment details" setting (Offer, the default on accounts made after 30 May 2025 / Always / Never). ([hosted invoice page](https://docs.stripe.com/invoicing/hosted-invoice-page)) Its wording isn't our autopay terms, so we use the Checkout setup link to switch autopay on.
- Payment Links can save cards, but they can't attach to an existing Customer, so every payment makes a new Stripe customer. Not a fit. ([payment link API](https://docs.stripe.com/api/payment-link/create))

**Charge after each visit: two ways**

| | Bare PaymentIntent (`off_session`, `confirm`) | Invoice (`charge_automatically`, `auto_advance`) |
|---|---|---|
| Hosted pay/receipt page + PDF | No | Yes |
| Same object for no-card customers | No (needs a separate bill flow) | Yes (`send_invoice`) |
| Undo window | None | Draft finalizes ~1 h after creation (up to 72 h if a webhook listening to `invoice.created` fails) |
| On decline / 3-D Secure | 402 error; we must email the customer a pay link ourselves | Invoice stays open with a pay page; optional Stripe failed-payment and 3DS emails |
| Automatic retries | None | Docs disagree on whether one-off invoice retries need Invoicing Plus; check in the Dashboard |
| Shows in Stripe Customer Portal history | Likely not | Yes |
| Extra fee | None | 0.4% per paid invoice (Starter) |

Sources: [invoice create](https://docs.stripe.com/api/invoices/create), [auto-advance](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection), [automatic charging](https://docs.stripe.com/invoicing/automatic-charging), [invoice emails](https://docs.stripe.com/invoicing/send-email), [smart retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries), [receipts](https://docs.stripe.com/receipts), [error codes](https://docs.stripe.com/error-codes), [idempotency](https://docs.stripe.com/api/idempotent_requests).

**Prices (US)** ([pricing](https://stripe.com/pricing), [invoicing pricing](https://stripe.com/invoicing/pricing), [ACH](https://stripe.com/pricing/local-payment-methods))
- Card 2.9% + 30¢. Dispute $15.
- Invoicing Starter 0.4% per paid invoice; Plus 0.5%. No monthly fee.
- ACH 0.8% capped at $5, settles in ~4 business days, $4 per failed debit.
- Subscriptions (Billing) 0.7% on top. Not needed.
- **$45 visit:** card alone $1.61; card + invoice $1.79; ACH $0.36.

**Card management page:** the Stripe Customer Portal works with invoices alone, no subscription. Create a session server-side (`billingPortal.sessions.create({ customer, return_url })`), and configure it to show only payment methods and invoice history. Sessions expire quickly; can't be iframed; we must know who the customer is before opening one. ([customer management](https://docs.stripe.com/customer-management), [integrate](https://docs.stripe.com/customer-management/integrate-customer-portal), [configurations](https://docs.stripe.com/api/customer_portal/configurations/create))

**Subscriptions:** built for fixed recurring amounts; usage-based billing now points to Metronome. Overkill for per-visit prices. ([usage-based](https://docs.stripe.com/billing/subscriptions/usage-based))

**Webhooks** ([webhooks](https://docs.stripe.com/webhooks), [invoice transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions))
- Invoice model: `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`. Card saving: `checkout.session.completed` (setup mode). Optional: `payment_method.automatically_updated`; a card brand change needs a fresh agreement.
- Verify with the raw body (`await request.text()`), the `stripe-signature` header and `stripe.webhooks.constructEvent`. Return 2xx fast.
- Live mode retries for up to 3 days. Events can arrive twice and out of order: dedupe on event ID and on object ID + type; never order by `created`.
- Installed `stripe` package is 22.2.0, which has `constructEvent`.
- Vercel: preview deployments return 401 to Stripe (deployment protection), so test on localhost with the Stripe CLI. Register the exact production host Stripe should call, so it isn't redirected between apex and www.

**Texas sales tax (important, not a portal question)**
- Comptroller Publication 94-112 lists "planting, mowing, trimming and edging grass" as **taxable**, and the residential exemption covers repair/remodeling only, not lawn care. ([94-112](https://comptroller.texas.gov/taxes/publications/94-112.php))
- The small self-employed exemption needs no employees *or partners*, so it likely doesn't cover two co-owners.
- We didn't find anything in the code or docs showing QuietGreen collects sales tax. **Confirm with a tax adviser before billing goes automatic**, because every Stripe invoice will either carry a tax line or not.
