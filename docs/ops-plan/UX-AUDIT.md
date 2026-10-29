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

Each one changes layout, navigation or a PLAN.md decision, so it waits for your answer. My lean is in brackets.

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

_Pending._

## 7. Demo data

_Pending._
