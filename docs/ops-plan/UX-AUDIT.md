# Staff CRM UX audit (28–29 Oct 2026)

Branch `claude/crm-ux-polish-f7dd65` (on top of `claude/crm-phone-build-62cc5f`). Scope: `app/admin/**`, phone first (iPhone 13, 390 pt), then desktop (1440 px). Rule for every fix: present information better, never delete it. Decisions in `PLAN.md` stand; anything that would change them is a question in section 4.

**Caelan: answer the yes/no list in section 4.** Preview on home Wi-Fi: http://192.168.1.67:3002/admin (test login in `tests/bootstrap-local.py`).

## 1. How this was done

1. **Capture.** Playwright, test database `qg-crm-test` with the demo seed (33 leads). 25 screens and states at iPhone 13 (3×, scrolled one screen at a time so the fixed bars sit where a thumb sees them) and 1440 px full page. 86 shots before, 88 after.
2. **Blind review.** Three subagents saw only the screenshots and the words "a small lawn-care company's staff app": a **busy owner** on a phone between jobs, a **first-day employee**, and a **picky product designer**. Each answered, per screen: what is it for, what would you tap first, what's confusing, cluttered, redundant or falsely clickable, and what's missing. Each then ranked a top 15. Full reviews are in the session scratchpad; the merged list is below.
3. **Caelan's own notes** from using it on his phone (28 Oct, evening) rank first.
4. **Fix** the clear wins (sections 2–3). Layout and navigation changes go to the yes/no list (section 4).
5. **Re-shoot** the same screens (section 5) and run a fourth blind reviewer on unlabeled before/after pairs (section 6).

Score = number of reviewers who hit it (out of 3) × worst severity (3 = would cause a mistake or make me give up, 2 = slows or confuses every time, 1 = polish). Caelan's notes are marked **C**.

## 2. Ranked issues

| # | Issue | Hit by | Score | Screens | Fix (information kept) | Status |
|---|---|---|---|---|---|---|
| C1 | **Board cards and lead page feel cluttered; sentence-like card lines** ("$140/visit · 1st $98 · website · didn't book", "Mowing · Round Rock · Facebook ad · Dave") | Caelan, newhire (#6), owner (#9) | C | [board-phone](ux-audit/board-phone.jpg), [board-desktop](ux-audit/board-desktop.jpg) | Card = **name · age**, then **price** (big number, small "/visit · website") + **one status chip** ("Missed alert", "Didn't book", "No answer ×2", "Start later · Jan 11", "Wants Tue Nov 3 · morning", "First visit Mon Nov 2", "Canceled Oct 23", "Price"), then one grey line (services · town). Ad source, first-visit price and the exact "didn't book" wording are on the lead page (Price and Source blocks). Estimate shows in the price slot only when there's no price. All words still come from `summarizeLead` (new `card` field). | ✅ |
| C2 | **Orange "(500) 555-0009 calls show (500) 555-0006" chips on every lead**: read as "the app changes the customer's number" | Caelan | C | [lead-top-phone](ux-audit/lead-top-phone.jpg) | One amber **Setup** note at the top of the board: "Caller ID not verified · Caelan · Paxton · Customers see (512) 643-5722". Per lead, the same fact is in Details › Alerts. | ✅ |
| C3 | **Too many header chips; "Not taken" unexplained** ("New · Not booked · Website price · Not taken") | Caelan, designer (#7), newhire (#12), owner (#15) | C | [lead-top-phone](ux-audit/lead-top-phone.jpg) | Header keeps the column chip and exception chips only. "Not booked" and "Website price" stay in the Price block's Booking and Source rows (they were shown twice). "Not taken" → **"Missed alert"** (nobody pressed 1). | ✅ |
| C4 | **Price block needs decoding** ("1st visit $98 −30%", "Plan disc. −10% every 2 wks") | Caelan, newhire (#6) | C | [lead-top-phone](ux-audit/lead-top-phone.jpg) | "$140 / visit · every 2 wks" big; rows **"First visit $98 · 30% off"** and **"Plan discount 10% off · every 2 wks"** (muted). The booked-date row is now "Start date" so it can't be confused with the first-visit price. | ✅ |
| C5 | **Demo tracings unrealistic** (two boxes on a road/parking lot; Megan Carter) | Caelan, newhire (#14) | C | [lead-desktop](ux-audit/lead-desktop.jpg) | Seed script: one plausible tracing per lead, on a residential lot; reseed after the screenshot pass. | see section 7 |
| 1 | **Two prices on one lead** (header $140, calculator $150; Patricia $193 phone vs $203 calculated) | all 3 | 9 | [lead-desktop](ux-audit/lead-desktop.jpg), [lead-closed-phone](ux-audit/lead-closed-phone.jpg) | Cause, Megan: the demo seed left out the website's travel fee (Round Rock = +$10), so its "website price" is one the real site never shows. Fixed in the seed. Cause, Patricia: phone price told ($193) vs today's calculation ($203); both are real. Presentation: the calculator's heading "Price" → **"Price calculator"** so it no longer looks like a second price of record; "Quote · No quote" → **"Saved quote · None yet"**. Merging the three into one Price card is Q3. | ✅ partly · Q3 |
| 2 | **Duplicate actions on the lead page**: Call ×2–3, Log call ×3, a "LOG CALL" card holding one button | all 3 | 9 | [lead-history-phone](ux-audit/lead-history-phone.jpg) | The "Log call" card is gone; **Log call** sits in the History header (where its result lands), plus the sticky phone bar and the desktop header. Top Call + sticky Call kept (the owner reviewer asked to keep both). | ✅ |
| 3 | **Booking request: no visible way to confirm it** | all 3 | 9 | [lead-booking-request-phone](ux-audit/lead-booking-request-phone.jpg) | Booking row now reads "Tue Nov 3 · morning [Requested] **Schedule in Jobs →**" (opens Jobs filtered to that request, where "Confirm & email customer" lives). Log call › Booked also confirms it (PLAN 3.2). Confirming on the lead page itself is Q1. | ✅ link · Q1 |
| 4 | **Log call: "Bad number" looks pre-selected** (⚫ emoji = only solid dot), emoji traffic lights read as radios, grey "Save" gives no reason | all 3 | 9 | [logcall-didnt-reach-phone](ux-audit/logcall-didnt-reach-phone.jpg), [logcall-booked-phone](ux-audit/logcall-booked-phone.jpg) | Real radio circles (empty until tapped, filled when chosen); destination tag "**→ In talks**" in that column's chip colour; Save reads **"Pick an outcome"** until one is chosen. Emoji stay in staff texts (S19). | ✅ |
| 5 | **Phone bars see-through**: content readable behind header, sticky Call bar and tab bar | designer (#2), Caelan's brief | 6 | [lead-top-phone](ux-audit/lead-top-phone.jpg) | All three bars opaque, hairline border kept. | ✅ |
| 6 | **Jobs on phone shows no dates**; Map button covers the last row | all 3 | 9 | [jobs-phone](ux-audit/jobs-phone.jpg), [jobs-desktop](ux-audit/jobs-desktop.jpg) | Date ("Nov 2, 2026" / "Req. Nov 3") under the address on phone; page bottom padding clears the Map button. Grouping Upcoming/Past by date is Q8. | ✅ · Q8 |
| 7 | **Column chip row**: starts flush at x=0, "Booking request" clipped with no hint more chips exist, selected Booking request still amber | all 3 | 9 | [board-phone](ux-audit/board-phone.jpg), [board-booking-request-phone](ux-audit/board-booking-request-phone.jpg) | 16 pt gutter kept when it snaps; right-edge fade shows it scrolls; tapped chip scrolls fully into view; one selected style for all six. In List view no chip is shown as selected. | ✅ |
| 8 | **Lead page long; History is alert plumbing** ("Alert to Paxton", "Paxton's phone: stopped", "Nobody took it") | all 3 | 6 | [lead-history-phone](ux-audit/lead-history-phone.jpg) | Alert-call steps fold into one row named by how it ended ("Nobody took it · 5 alert steps ▸"); tap to see every step. Calls, quotes, bookings stay on top-level rows. | ✅ |
| 9 | **Staff map written for customers** ("Your address", "Trace your lawn") | all 3 | 6 | [lead-desktop](ux-audit/lead-desktop.jpg) | Staff mode only: "Property address", "Lawn trace". Website wording unchanged. Two maps (thumbnail + builder) kept; opening the builder from the thumbnail is part of Q3. | ✅ |
| 10 | **Numbers disagree between tabs** (Today/Week "Jobs this week 3" vs Jobs "This week 4") | owner, newhire | 4 | [week-phone](ux-audit/week-phone.jpg) | Week view's card counted the next 7 days but said "this week": now **"Jobs next 7 days"**. Jobs "This week" is the calendar week. Map pin counts differ while addresses are still being located (timing, not data). | ✅ |
| 11 | **Revenue completed-jobs table unusable on phone** (one word per line, Paid column cut off) | all 3 | 6 | [revenue-phone](ux-audit/revenue-phone.jpg) | Phone: one stacked row per job: date, client, status, address on the left; price and "Paid …" on the right. Desktop table unchanged. "$0 paid all time" next to "$406 older records" is Q9. | ✅ · Q9 |
| 12 | **Week view mostly empty dashed boxes** | designer (#9) | 2 | [week-phone](ux-audit/week-phone.jpg) | Empty day = its header line only, "No jobs" on the right. Stop cards say "every 2 wks", not "biweekly". | ✅ |
| 13 | **Closed and Customer leads look like live leads** (big Call, price calculator, "Save as quoted") | designer (#4), newhire (#10) | 6 | [lead-closed-phone](ux-audit/lead-closed-phone.jpg), [lead-customer-phone](ux-audit/lead-customer-phone.jpg) | Q2 (stage-specific main action) and Q4 (collapse the calculator for Customer/Closed). | Q2 · Q4 |
| 14 | **Move menu: "Now" looks like an action; one tap moves anywhere** | newhire (#3), owner | 6 | [move-menu-phone](ux-audit/move-menu-phone.jpg) | "Now" → **"Current"**. Moves stay one tap (PLAN S1); Closed and Quoted still ask for a reason. A confirm for Customer is Q10. | ✅ · Q10 |
| 15 | **Raw words**: "Last mow: thisweek", "1 visits", "Customer history (1 visits)" | all 3 | 3 | [lead-history-phone](ux-audit/lead-history-phone.jpg) | "This week", "2–3 weeks ago" … ; "1 visit". | ✅ |
| 16 | **Customer page**: buttons ordered Email, Text, Call (lead page is Call, Text); explainer paragraph on Customers | designer, owner, newhire | 2 | [customers-phone](ux-audit/customers-phone.jpg) | Call (primary), Text, Email. Explainer folded behind "How customers get here". | ✅ |
| 17 | **Customer page crashed** ("This page couldn't load") when opened over home Wi-Fi | found during capture | — | [customer-page-phone](ux-audit/customer-page-phone.jpg) | `crypto.randomUUID` exists only on HTTPS/localhost, so the customer page, Log call save and quote tools broke on `http://192.168.1.67`. `lib/uuid.ts` falls back to `crypto.getRandomValues`. Production (HTTPS) was not affected. | ✅ `9ec8227` |
| 18 | **Frequency words vary** ("every 2 wks", "Bi-weekly (−10%)", "biweekly", "Every 1 week") | all 3 | 3 | [logcall-booked-phone](ux-audit/logcall-booked-phone.jpg) | Q7 (the calculator's dropdown is shared with the website builder). | Q7 |
| 19 | **Calls only from inside a lead; no search on Leads** | owner (#9), newhire (#13) | 4 | [board-phone](ux-audit/board-phone.jpg) | Q5, Q6. | Q5 · Q6 |
| 20 | **Today empty state is a dead end** | owner, designer | 4 | — | Q11. | Q11 |
| 21 | **Sign-out icon in the top-right action slot** | designer (#15), newhire (#15) | 2 | all phone screens | Not changed (polish; a menu would add a tap). | — |

### Reviewers disagreed with a PLAN.md decision (kept as decided)
- **"Quoted" holds Not now leads** (owner #11: "rename to Thinking it over"). PLAN S2/S4b. Kept; the card chip now names the reason and date ("Start later · Jan 11"), which answers most of the confusion.
- **Customer column keeps canceled customers** with a red chip (owner #13). PLAN S9. Kept.
- **Drag/move a card anywhere** (newhire #3). PLAN S1. Kept; see Q10.

### Not real (screenshot artifacts)
- Desktop sidebar "ends at ~900 px": the sidebar is fixed and full height; full-page screenshots stop it at the first viewport.
- A strip above the phone header in some scrolled shots: the last scroll position of a page; the header measures at top 0 at every scroll position.

### What all three said to keep
Big Call + Text at the top of a lead and the sticky Call / Log call bar; Log call's two-step start with outcomes that show where the card goes; reason chips; Navigate/Call/Text on each stop in the week view; Directions and the traced-area thumbnail; the desktop board; the bottom tab bar; the History recording button.

## 3. What changed (commits)

| Commit | What |
|---|---|
| `9ec8227` | UUID fallback for plain-http preview (issue 17) |
| `c51d87f` | Board cards (C1), header chips + "Missed alert" (C3), price rows (C4), one caller-ID setup note (C2), opaque phone bars (5) |
| `61622c2` | Log call radios + stage tags (4), chip row (7), alert steps folded (8), Log call into History header (2), "Schedule in Jobs →" (3), staff map wording (9), "Price calculator" / "Saved quote" (1), Jobs dates on phone + Map clearance (6), compact week + "Jobs next 7 days" (10, 12), Revenue rows on phone (11), "Current", "This week", "1 visit", customer buttons, folded explainer (14–16) |

No database, API, route or permission changes. Shared logic: `lib/lead-summary.ts` gains `card` (one status chip + price parts, tested through `tests/crm-board.test.ts`); "Not taken" chip label → "Missed alert".

## 4. Yes/no for Caelan

Each one changes layout, navigation or a PLAN.md decision, so it waited for your answer. **Answered 29 Oct: yes on Q1–4, 6–9, 11; no on Q5 and Q10.** What was built is in §4a.

| # | Question | Lean |
|---|---|---|
| Q1 | On a **booking request** lead, put a "Schedule visit" button right on the lead page (date + Confirm & email), instead of the link to Jobs? | yes |
| Q2 | Give each lead page **one main button for its column**: Booking request → Schedule · Quoted → Call back (due date) · Closed → Reopen · Customer → Open customer. Call stays. | yes |
| Q3 | **One Price card**: price of record + source, saved-quote status in its header, calculator behind "Edit price" (opening the big map), "Edit contact" as a pencil by the name, "Add note" in History? | yes |
| Q4 | For **Customer and Closed** leads, start the price calculator and map collapsed? | yes |
| Q5 | Add a small **Call button on each board card** (phone)? | no: cards just got calmer; the lead page is one tap |
| Q6 | Add a **search box** to Leads (name, phone, address)? | yes |
| Q7 | Use one set of frequency words everywhere: **Weekly · Every 2 weeks · Monthly · One time** (discount as a small label), including the calculator dropdown? | yes |
| Q8 | **Jobs list**: group by Upcoming (soonest first) and Past (newest first) instead of by status? | yes |
| Q9 | **Revenue**: count "older record" payments in "Paid all time" (today it says $0 with $406 in a footnote)? | yes |
| Q10 | Ask "Move to Customer? No visit is scheduled" when a card is moved to Customer by hand? | no: S1 says moves are quick; Closed already asks |
| Q11 | **Today, no jobs**: show the next scheduled visit and today's check-backs from Leads? | yes |

## 4a. Built after the answers (29 Oct)

| # | What changed |
|---|---|
| Q1 | Booking request lead: date + time + **Confirm & email customer** inside the Price card (same action as Jobs). The "Schedule in Jobs →" link is gone. |
| Q2 | Header main button per column: Booking request → **Schedule visit** · Quoted → **Call back · date** · Closed → **Reopen** (to In talks) · Customer → **Open customer**. New and In talks keep Call. Call stays in the phone bar and on desktop. |
| Q3 | **One Price card**: price, steps (below), source, other prices, booking, quote actions (Book visit, Text price, Email quote, Said no), Visits. Saved-quote status is a "Quote · Draft" chip in the card header. The calculator and staff map open from **Edit price** (Add price when there is none). Edit contact is a pencil by the name; Add note sits in the History header. The separate "Saved quote" card is gone (its total is the "Draft/Saved quote" price row). |
| Q4 | Calculator and map start closed for every column (Q3), so Customer and Closed too. A changed contact address still shows its review panel. |
| Q6 | Search box on Leads (name, address words, or 3+ phone digits). While searching, matches show as one list across columns. |
| Q7 | Staff frequency words everywhere: **Weekly · Every 2 weeks · Monthly · One time**, including the calculator dropdown ("Every 2 weeks · 10% off") and staff texts. Customer-facing quote pages and emails still say "Bi-weekly" (not changed). |
| Q8 | Jobs list: **Upcoming** (undated requests first, then soonest) and **Past** (newest first). Status filters still apply. |
| Q9 | Revenue "Paid all time" includes payments recorded before dates existed; the note says so and that they aren't in the monthly chart. Completed rows show the paid amount with "older record · method". |
| Q11 | Today with no jobs: **Next visit** and **Call back today** (due and overdue check-backs). Today's date is now Austin's, not UTC. |

**Price, Leads and Jobs (Caelan's note A).** One helper, `priceSteps()` in `lib/lead-summary.ts`, and one component, `app/admin/PriceSteps.tsx`, on the lead Price card and the Jobs card:

| Row | Example |
|---|---|
| Full price | $117 /visit |
| Every 2 weeks −10% | $105 /visit |
| First visit −30% | $74 |

Monthly has no full-price row (0% plan discount); one-time reads "One time $120 total". Prices are stored after the plan discount, so "Full price" is worked back from it to the whole dollar. Jobs gets the same numbers through `bookingPrice()`. Plan visits after the first don't show the first-visit row. The board card keeps "$105 /visit", the same number as the plan row.

**Lawn map (note B).** Prod's lead page has no lawn map at all (main has no `TracingMap`), and Jobs shows the website's saved map image. Now both use `app/admin/LawnMap.tsx`: the saved map image when there is one (what the customer drew), else the tracing drawn on satellite tiles. Jobs fetches the lead's tracing for visits without an image, so local demo jobs show the lawn too.

**Phone-booked first visit (answered 29 Oct: yes, 30% off).** Log call → Booked now saves the first visit as the plan price plus a "First visit 30% off" line, so its job total is the first-visit price ($74), like a website booking; the Jobs total, the confirmation email and the price rows agree. Later plan visits charge the plan price ($105). Helper `callVisitItems()` in `lib/crm-jobs.ts` (tested in `tests/call-visit-price.test.ts`); migration `20261029120000_crm_call_job_first_visit.sql` lets `crm_create_call_job` keep the plan price as `price_per_visit`. The demo seed does the same; the local demo rows were corrected in place (no reseed, lead IDs unchanged).

## 5. Before / after

Left = before, right = after. Phone shots are one screen; desktop is cropped to the first 1,100 px.

| Screen | Pair |
|---|---|
| Board, phone | ![](ux-audit/board-phone.jpg) |
| Board, Booking request chip | ![](ux-audit/board-booking-request-phone.jpg) |
| Board, desktop | ![](ux-audit/board-desktop.jpg) |
| Board list, desktop | ![](ux-audit/board-list-desktop.jpg) |
| Move menu | ![](ux-audit/move-menu-phone.jpg) |
| Lead, top (website lead) | ![](ux-audit/lead-top-phone.jpg) |
| Lead, History | ![](ux-audit/lead-history-phone.jpg) |
| Lead, ConviFlo without address | ![](ux-audit/lead-conviflo-phone.jpg) |
| Lead, booking request | ![](ux-audit/lead-booking-request-phone.jpg) |
| Lead, customer | ![](ux-audit/lead-customer-phone.jpg) |
| Lead, closed | ![](ux-audit/lead-closed-phone.jpg) |
| Lead, desktop | ![](ux-audit/lead-desktop.jpg) |
| Log call, Didn't reach | ![](ux-audit/logcall-didnt-reach-phone.jpg) |
| Log call, Talked › Booked | ![](ux-audit/logcall-booked-phone.jpg) |
| Next 7 days | ![](ux-audit/week-phone.jpg) |
| Jobs, phone | ![](ux-audit/jobs-phone.jpg) |
| Jobs, desktop | ![](ux-audit/jobs-desktop.jpg) |
| Customers | ![](ux-audit/customers-phone.jpg) |
| Customer page (before = crash over Wi-Fi) | ![](ux-audit/customer-page-phone.jpg) |
| Revenue, completed jobs | ![](ux-audit/revenue-phone.jpg) |

## 6. Confirmation review (blind A/B)

A fourth subagent, persona "busy owner on a phone", got 21 before/after pairs labeled only X (after) and Y (before), with no hint which is newer.

**Verdict: X (after) on 20 of 21 pairs, Y on 0, 1 the same** (desktop Jobs, apart from the Map badge). Its reasons: one price and one status pill per card instead of a wrapping orange sentence; one setup note instead of cryptic number strings on every lead; History folded to "5 alert steps ▸"; dates on phone Jobs; a readable Revenue list; solid bars; clear Log call radios. It noted that Y showed no price at all on Quoted cards.

Moved, not lost (the reviewer noticed): the first-visit price, the ad source and the full services list left the card. All three are on the lead page (Price, Source, Request).

Its remaining points, and what happened:

| Point | Done |
|---|---|
| Setup note takes the top of Leads on phone | Compact one-to-two-line strip on phone. It disappears once both cells are verified caller IDs (go-live checklist 7.7b). |
| "How customers get here" doesn't look tappable | Green with ▸, like other disclosures |
| Lead page still repeats (two Calls, Website row restating the headline price, empty "Saved quote —" card, two maps on desktop) | Q2, Q3 (the Website row is kept on purpose: PLAN 4.1f keeps the website price visible after a phone price replaces it) |
| Revenue "Paid — · $102.00 older record · Zelle" reads oddly | Q9 |
| "→ In talks" tags look like buttons | Kept: they sit inside the tappable outcome row, so a tap there does the right thing |
| Closed card chip "Price" is vague | Kept: S4 reason label, and the card sits in the Closed column, and the lead page shows "Closed" and "Price" chips side by side |

## 7. Demo data

- `scripts/fetch-demo-properties.mjs` (run once; needs internet) picks a real detached house from OpenStreetMap for every demo lead with an address: right town, house on its own named residential street, 14–40 m back from the street. It traces **one** lawn: the front yard between the house and the curb. Output: `scripts/demo-properties.json` (29 homes).
- `scripts/seed-demo-leads.mjs` uses those addresses and lawns, and now adds the website's **travel fee** (straight-line miles from the office, as `MapQuoteBuilder` does), so a lead's website price equals what the calculator shows. Lawns are front yards (1,350–4,350 sq ft), so demo prices are lower than before ($78 instead of $140 for Megan Carter).
- Reseeded `qg-crm-test` after the screenshot pass. The before/after pairs above use the old data. Without the JSON file the seed falls back to the old rectangles.
