# QuietGreen ops plan: CRM leads + phone system

Working plan, built with Caelan on 28 October 2026. **Nothing in sections 3–7 is built yet.** We plan to a decision on every item, then execute once, review once.

Status keys: ✅ done · ⏳ waiting on someone else · 🟡 decided, not built · ❓ needs a decision · ⬜ not started

---

## 1. Where things stand (28 Oct 2026)

### Done
- ✅ Single checkout `~/lawncaresite` on `main`; old worktrees removed.
- ✅ `/privacy` page live on quietgreen.co (commit `cc57c38`), with a text-messaging section; linked from the footer and every consent checkbox.
- ✅ Twilio business profile switched from Individual to **Business: Quietgreen LLC** (EIN, Professional Services, quietgreen.co). Approved.
- ✅ Twilio A2P brand **QuietGreen** (Low-Volume Standard, $4.50) **approved** 28 Oct.
- ✅ New-lead alert **calls** already work: every website/ConviFlo lead calls Caelan and Paxton from (512) 643-5722 with a recorded "New QuietGreen lead."

### Waiting
- ⏳ Twilio campaign review (submitted 28 Oct; typically up to ~5 business days).

### Known gaps
- Texts from (512) 643-5722 are carrier-blocked until A2P is finished; `STAFF_SMS_ENABLED=false` in Vercel.
- Calls **to** (512) 643-5722 go nowhere today (webhook empty); E13 gives it a pointer message.
- Paxton's personal (682) 352-8260 is the public number on the site (staying, per 7.0).
- Unsubmitted Sole Proprietor draft brand sits in Twilio Draft Brands (harmless).
- Twilio balance $15.50.

---

## 2. Phone numbers

| Number | What it is | Today | Target |
|---|---|---|---|
| (512) 643-5722 | Twilio alert line | Places lead alert calls only | Alert texts + calls to us; never shown to customers |
| (682) 352-8260 | Paxton's mobile | On the website; gets alert calls; Twilio contact | Stays the public number; caller ID when Paxton takes a lead |
| (979) 888-6158 | Caelan's mobile | Gets alert calls | Caller ID when Caelan takes a lead |

Places Paxton's number appears on the site (no change planned): nav bar phone button (`components/Nav.tsx`), map quote "Call" link (`components/MapQuoteBuilder.tsx:2099`), Google structured data (`app/layout.tsx:73`), customer portal "Text us" (`app/portal/page.tsx:146`).
Off-site: Google Business Profile, Meta page/ads, ConviFlo forms, signs, truck, cards.

---

## 3. CRM: leads board and stages

### 3.1 How leads move today (researched 28 Oct)
The lead has a `stage` (new / contacted / quoted / booked / lost) plus a separate `quote_status` (draft / accepted / declined / canceled) and `contact_outcome` (no answer / reached / wrong number). They drift apart:

| What happens | What the CRM records | Problem |
|---|---|---|
| Lead comes in | stage `new` | none |
| You log "no answer" or "reached" | `contact_outcome` only | Stage stays `new` |
| Tap Call / Text / "Text price" | Nothing | No record a call or text happened |
| "Save as quoted" | stage `quoted` | none |
| "Email quote" | Activity row only | Stage doesn't change |
| "Customer said no" | `quote_status` declined | Stage stays `quoted`, not lost |
| Customer books online from emailed quote | stage `booked`, pending visit | Looks the same as a visit you confirmed |
| You confirm a booking | stage `booked`, customer created | none |
| First visit completed | Nothing on the lead | No "became a customer" moment |
| "Customer canceled" | stage `lost` | none |
| Jobs page "Cancel visit" | Usually nothing on the lead | Lead stays `booked` |

Today's list has only All / Needs action / Follow-ups tabs and shows raw stage words.

### 3.1b How leads arrive (checked in code 28 Oct)
| Path | Price | Booked | Notes |
|---|---|---|---|
| Website map quote ("Unlock price") | Customer **sees** an instant price; the lead stores only lawn size, **not the price** | No | Needs a call |
| …then clicks Book (same lead) | Saved on the booking | **Requested**, pending your OK | Lead stage stays `new` today |
| Manual quote form / project inquiry | None | No | Landscaping etc. priced on site |
| ConviFlo (Meta ad form) | None | No | Answers only; address may be missing |
| You email a quote → they book from the link | Your quote | Requested, pending | Stage becomes `booked` |
| Outside area | — | — | Waitlist |

### 3.2 The board (decided 28 Oct)
Six columns, kept separate so each can get its own automations later. Columns mean "what we do next". We sell by **phone**: call, tell them a price, book a date, mow, then send a Stripe invoice for the agreed price.

| Column | Who's here | Gets in by |
|---|---|---|
| **New** | Nobody on our side has talked to them. Includes "saw $45 on the website, didn't book" (sorted to the top: warmest) | Any intake |
| **In talks** | Called, no pickup yet ("tried ×2", "voicemail") | ⚪ No answer / Left voicemail |
| **Quoted** | Heard our price, didn't book, didn't say no: start later, budget, thinking, ask someone. Has a reason + check-back date | 🟡 Not now |
| **Booking request** | Wants it, date not confirmed by us (see 3.4) | Customer books online · 🟢 Yes, date TBD |
| **Customer** | First visit booked. If they cancel later they stay here with a red "Canceled" chip | 🟢 Booked · confirming a booking request |
| **Closed** | Hard no / bad number / spam / outside area, with a reason | 🔴 No · ⚫ Bad number |

**Every card's top line** answers: booked? quoted? for how much, and from where? If not, what do they want? Price is shown with its source:
"$45/visit · website · didn't book" · "$45/visit · told by phone Oct 28" · "BOOKING REQUEST · wants Tue Nov 4 · $45/visit" · "No price · wants hedge trimming".

**Log call sheet v2** (after every call; this is how phone quotes get recorded). Step 1: *Didn't reach* or *Talked*.

| Step 1 | Outcome | Asks for | Card goes to |
|---|---|---|---|
| Didn't reach | ⚪ No answer | — (attempt +1) | In talks |
| Didn't reach | ⚪ Left voicemail | — (attempt +1) | In talks |
| Didn't reach | ⚫ Bad number | — | Closed (reason: bad number) |
| Talked | 🟢 Booked | price · frequency · first visit date | Customer |
| Talked | 🟢 Yes, date TBD | price · frequency · when to set the date | Booking request |
| Talked | 🟡 Not now | price told · reason (Start later · Budget · Thinking · Ask someone · Wants lower price · Other) · check-back (1 wk · 1 mo · Spring · pick date) | Quoted |
| Talked | 🔴 No | reason (S4) · price told (optional) | Closed |

Every outcome takes an optional note. "Not now" covers both "wants service later / can't afford it now" and "thinking it over"; the reason chip tells them apart, and the check-back date brings the card back to the top of Quoted on that day.

**Moving cards:** a mix. Cards advance automatically from what happened (intake, after-call sheet, online booking, confirming a visit); you can drag any card anywhere. Dragging to Closed asks for a reason.

**Future automations per column** (not in the first build): In talks = retry reminder and "tried calling" text; Quoted = check-back reminder/text on the date; Closed = optional seasonal "still interested?".

**Texting customers** happens from our own phones (Text button opens Messages with a ready message), so no Twilio dependency.

### 3.3 New data the board needs
- **Website instant price** saved on the lead: price per visit + frequency shown, so we know what they saw and didn't take.
- **Lawn tracing** saved on the lead: the traced shapes (today only a screenshot image is saved, and it shows on the Jobs card, not the lead page). Show it on the lead page so we can check how they traced.
- **Call outcomes, phone price, quoted reason, check-back date, closed reason** from the after-call sheet.

### 3.4 What lands in Booking request
1. Website: got the instant price, clicked Book (date + frequency chosen, not confirmed).
2. Customer books from an emailed quote link.
3. 🟢 Yes, date TBD on a call.
4. Dragged there by hand.

Later, possibly: a canceled customer asking to restart; a Quoted lead texting back "let's do it" (needs inbound texts). Not here: an existing customer asking for an extra service (a New lead tagged "existing customer"). The customer portal is view-only.

### 3.5 Board decisions
| # | Question | Answer |
|---|---|---|
| S1 | Who moves cards | ✅ Mix: auto from events + manual drag (rules above; fine-tune during build review) |
| S2 | Columns | ✅ New · In talks · Quoted · Booking request · Customer · Closed |
| S3 | Customer means | ✅ First visit booked |
| S9 | Customer cancels later | ✅ Stays in Customer with a Canceled chip (Caelan's lean, 28 Oct) |
| S10 | Save the website instant price | ✅ Yes |
| S11 | Log call sheet | ✅ v2: two steps (Didn't reach / Talked), seven outcomes (Caelan, 28 Oct) |
| S12 | Save lawn tracing on the lead | ✅ Yes |
| S16 | 🟢 with no date | ✅ Booking request |
| S17 | Auto text after each call | ⏸ Out of scope for now |
| S18 | Booking request sources (3.4) | ✅ |
| S4 | Closed reasons | ✅ Price · Has someone else · Never responded · Outside area · Just checking prices · Spam/duplicate · Bad number · Other |
| S4b | "Not now" reasons (Quoted column) | ✅ Start later · Budget · Thinking · Checking with someone (spouse, landlord, HOA) · Comparing quotes · Wants lower price · Other |
| S6 | Board on a phone | ✅ A: column chips with counts + list below; Booking request chip outlined (Caelan, 28 Oct) |
| S7 | Desktop | ✅ Columns side by side + list toggle; clean, professional (quality bar 6.2) |
| S8 | Existing leads | 🟡 Place once by these rules after the prod data review; Caelan reviews before it's final |

## 4. CRM: lead detail page

### 4.1 What's there today, top to bottom
Header (name, raw stage, address, received date, raw source like `website-map`, ad label, Call/Text/Build quote) → Request (services, frequency, timing) → three collapsed panels (call outcome + stage + follow-up + note; message draft; activity with raw kinds and ISO dates) → Quote side panel (status, total, many state-dependent buttons, raw booking status) → Contact (phone, email, edit form, answers + acquisition details with raw IDs, consent, staff alert log with raw codes) → the full map quote builder.

### 4.1b Use cases
- **Phone, between jobs:** tap the lead text → see whether they're booked/quoted and what they want → call within seconds → log the outcome. Everything needed to call is above the fold.
- **Computer, at a desk:** same top, plus a big map with their tracing and the price tools to adjust/save a quote or confirm a booking.

### 4.1c Draft layout v1 (sketch shown 28 Oct)
Phone, top to bottom: back to board · name · column + time ago → **status banner** (booked? quoted? price + source; else what they want) → big **Call** + Text → **Where**: address, directions, map thumbnail with their tracing + sq ft → **What they want**: services, frequency, timing, their notes → **Their answers** in plain words (pulled out of today's hidden "Answers and acquisition details") → **History**: came in, who took the alert call, call outcomes → **From**: plain ad label, tap for details → **Log call** button (opens the 3.2 sheet).
Computer: same order in a left column; right column = large map with tracing + price/quote tools. "Details" (consent, tracking codes, alert delivery) collapsed at the bottom.

### 4.1d UI rules (Caelan, 28 Oct): structure, not sentences
Applies to the board, lead page and lead text.
1. **No sentences.** Every block is a header noun (Price, Property, Request, Source, History, Log call) with label → value rows. The only prose is the customer's own words, in quotes.
2. **Status = chips** from a fixed vocabulary with fixed colors: column (New, In talks, Quoted, Booking request, Customer, Closed) · booking (Not booked, Requested, Booked, Canceled) · price source (Website price, Phone price, Emailed).
3. **Numbers big, units small:** "$45" large, "/ visit · every 2 wks" small.
4. **Same fields, same order** on card, page and text, so nothing needs deciphering.
5. **Empty = "—"**, never a sentence explaining absence.
6. **History = time · icon · 2–3 words** ("2:15p ☎ Caelan took alert").
7. **Raw/technical data lives only in a collapsed Details panel.**

### 4.1e Price block, including the 30% first visit
Today: recurring plans get **first visit 30% off** (`lib/quote-offer.ts`, `FIRST_VISIT_DISCOUNT_PCT = 30`) plus a frequency discount (weekly 15%, every 2 wks 10%, monthly 0%). Shown today only inside the emailed quote text and as a sentence on the Jobs card. It doesn't apply when a quote has extra service lines or a manual discount.
Planned: the Price block always shows **$/visit + frequency**, a **1st visit $X (−30%)** row when it applies, the plan discount row, and the price source chip. The board card and lead text show "$45/visit · 1st $32".

### 4.1f Every field has a home (nothing captured goes missing)
| Data we have today | Block on the new page |
|---|---|
| Name, phone, email | Header (name) · Call/Text buttons · Contact row in Details-free "Contact" line under the name (email shown, tap to copy) |
| Column, booking status, price source | Status chips |
| Website instant price + frequency (new), quote draft/total, 1st-visit −30%, plan discount, accepted quote snapshot | **Price** |
| Booking request: wanted date, frequency, price per visit, first-visit price, cleanup/overgrowth fee, booking status | **Price** (amounts) + **Booking** row (date, status chip) |
| Address, address-needs-review / address-changed warnings, address missing (ConviFlo) | **Property** (warning chip inline) |
| Lawn size, tracing shapes (new), map screenshot | **Property** map |
| Services, frequency, timing, add-on interest, service-unmapped flag | **Request** |
| Customer notes (website/booking), ConviFlo answers, manual-form lawn-size bucket | **Request** (answers as label → value; notes in quotes) |
| Same-phone existing customer / past jobs | Chip "Existing customer" + **History** link to customer |
| Source, ad name, creative type, campaign | **Source** chips |
| Calls, outcomes, notes, quote saved/emailed/booked online, alert call taken by, stage moves | **History** |
| Follow-up / check-back date, Quoted reason, Closed reason | Status chip + **History** |
| Estimated value, score | Board card corner (value) · Details (score) |
| Consent, consent text/version/time | Details |
| Click IDs (gclid, fbclid, fbc, fbp, gbraid, wbraid), raw UTMs, Google/Meta numeric IDs, first/latest touch timestamps | Details › Tracking |
| Staff alert delivery log (recipient, channel, state, Twilio codes) | Details › Alerts (plain words: "Sent to Caelan · call · answered") |
| Intake source code (`website-map`, `conviflo`), submission id, form version | Details › Technical |

Build check: before review, open three real leads (website map, website booking, ConviFlo) and tick every row above.

### 4.2 Proposed "glance card" (also the lead text) (superseded by 4.1c–4.1e; kept for the question list)
1. Name · how long ago · stage
2. Call / Text buttons with the phone number
3. Address + small map, lawn size
4. What they want: services, how often, timing, their notes/answers in plain words
5. Price and quote status
6. Where they came from, in plain words (section 5)
7. Next step: one button for the obvious next action (call, send quote, confirm visit)

Below the card: activity timeline (plain words), quote builder, then a collapsed "Details" with consent, raw tracking and alert delivery.

| # | Question | Answer |
|---|---|---|
| L1 | Block order | ✅ v2 approved 28 Oct: Price → Property → Request → Source → History → Log call |
| L2 | Lead text = same blocks, same order, + link | 🟡 wording to draft (P5) |
| L3 | Mobile first, single column; desktop = details left, map + quote tools right | ✅ |

## 5. CRM: readable ad/source info

Why it's messy: only 12 Meta ads are named in code (`lib/attribution.ts` `launchAds`); every other ad shows raw IDs. Click IDs (gclid, fbclid, fbc, fbp) and ISO timestamps are listed as-is. ConviFlo answers show as `Choice 2: mowing_edging`. The lead text shows raw IDs too.

Proposed plain labels: "Facebook/Instagram ad · Everybody Loves Dave (video)", "Google search ad · {campaign}", "Google search (free)", "ConviFlo form", "Typed in / unknown". Click IDs and raw values move to a collapsed "Tracking details" panel.

| # | Question | Options | Answer |
|---|---|---|---|
| A1 | How unknown ads get names | Research first (pre-build task B3): list ad IDs on real leads that have no name, match them in Meta Ads Manager with Caelan logged in. Then decide: small "name this ad" box in the CRM · readable tags when creating ads · Meta API | 🟡 research |
| A2 | ConviFlo answers | Rename field keys in ConviFlo (affects new leads only) · Map them in code · both | ❓ |

## 6. CRM: small changes

| # | Change | Status |
|---|---|---|
| 6.1 | `/admin` opens **Leads** (the board), not Jobs | 🟡 |

### 6.2 Quality bar (Caelan, 28 Oct: "clean, correct, works how you expect")
- **Fast:** board and lead pages load from the server with data already in them; lead pages prefetch on hover/press; no spinners for data we already have.
- **Instant feedback:** dragging a card, logging a call or changing a column updates the screen immediately and saves in the background; if saving fails, the card snaps back with a short error.
- **Smooth:** card moves and sheet open/close animate (~150–250 ms), respecting "reduce motion"; no layout jumps while loading (skeletons the same size as the content).
- **Correct:** every number and chip comes from one shared function, so the card, lead page and alert text can't disagree.
- **Phone first:** every screen checked at 375 px wide; tap targets at least 44 px; sticky Call / Log call within thumb reach.
- **Looks professional:** consistent spacing, type scale and chip colors; matches the existing CRM styling in `app/admin/crm.css`; empty states are a dash, not a sentence.
- **Accessible:** keyboard works on desktop (move cards with keys too), labels on icon buttons, sufficient contrast.

## 7. Phone system (v2, decided 28 Oct: personal-cell model)

### 7.0 The model
- **Twilio's only jobs:** alert Caelan and Paxton about new leads, let the first to press 1 claim the lead, connect that person to the customer, and keep the other person informed.
- **Customers see our personal cells.** Twilio connects the call showing the claimer's own cell as caller ID (each cell verified once in Twilio). Customers call or text us back on our personal cells.
- **Texting customers** happens from our own phones: the lead page's Text button opens Messages with a ready-made follow-up. No Twilio texting to customers.
- **Paxton's (682) number stays on the website.** No business line, no number switch. (512) 643-5722 is the alert line only.
- Cost estimate: ~$25–35/month at 100 leads (alert texts with map image, short ring calls, bridged customer calls, number, campaign).

### 7.1 Texting registration (A2P 10DLC)
| Step | Who | Status |
|---|---|---|
| Business profile (Quietgreen LLC) | Paxton | ✅ |
| Brand QuietGreen (Low-Volume Standard) | Paxton/Claude | ✅ approved 28 Oct |
| Add Twilio funds + auto-recharge | Caelan | ✅ auto-recharge on (28 Oct) |
| Campaign `CMd34536602ab70719a7a15ac4ff6df60b`: Low Volume Mixed ($15 review + $1.50/mo), staff alerts only, verbal opt-in script, 3 samples, privacy + terms URLs; passed Twilio's pre-check | Claude + Caelan | ⏳ in review (submitted 28 Oct) |
| Attach (512) 643-5722 to Messaging Service "QuietGreen Staff Alerts" (`MG604aadfb9429a4f5f6652c4067c7d3ab`) → Add Senders | Claude | ⬜ (console page wouldn't load 28 Oct; do before or right after approval) |
| `STAFF_SMS_ENABLED=true` in Vercel + synthetic test lead | Paxton's laptop | ⬜ |
Never reply STOP to an alert text: Twilio would block alerts to that phone until START.

### 7.2 New-lead flow, step by step
| t | What happens |
|---|---|
| 0 s | Lead saved. **Alert text (with map image, 7.6)** and **both calls** start at the same time (Caelan, 28 Oct: ring immediately; you read the text on speaker while it rings). Voicemail detection runs in the background; if a voicemail answers, that leg hangs up silently. |
| on answer | (No voicemail detection, R7.) "New lead. Jane Smith, Round Rock, mowing. Booking request for Tuesday." (short) "Press 1 to call them now. Press 2 to pass." Prompt repeats once. |
| press 1 | **Atomic claim** in the database (first press wins). Winner hears "Connecting you" and Twilio dials the customer showing the winner's verified cell. The other leg ends immediately; if that person already answered they hear "Paxton has it." |
| press 2 | That leg ends; the other keeps ringing. |
| claim | **Text to the other person:** "Caelan took Jane Smith (512) 555-0142." CRM: lead shows "Taken by Caelan 2:15p". |
| customer leg ends | Twilio reports the result. **No answer / busy / voicemail** → History "Called, no answer" and the lead goes to In talks automatically (attempt +1). **Answered** → History "Talked 4 min" and the CRM shows a "Log this call" banner on the lead (sheet in 3.2). |
| ~30 s, nobody pressed 1 | Lead flagged **"Not taken"**; text both "Nobody took Jane Smith" + tap-to-call link. P1 decides whether to ring again later. |

### 7.2b How the claim and call facts are known
- **Twilio sits in the middle of every leg.** It calls your cell, it hears the keypress, it dials the customer and joins the two. So Twilio (not your phone) knows: did your leg answer, did a voicemail answer, which key you pressed, did the customer answer, and how long you talked. It sends each fact to our server as a web request ("webhook"); we store them on the lead. Calls you make straight from your phone, outside Twilio, are invisible; those go through the Log call sheet.
- **Two people press 1 at once:** each press arrives as its own request. The server runs one database statement: *set taken_by = me on this lead only if taken_by is still empty*. The database applies these one at a time, so exactly one succeeds even if the presses are milliseconds apart. The loser's request sees "already taken" and plays "Paxton has it". Each press takes about a quarter to half a second round trip; then Twilio ends the other leg and dials the customer, so the winner hears ringing within about 1–2 s.
- **Facts recorded per lead:** alert sent (per person), each leg's result (answered / voicemail / busy / no answer), who pressed what and when, customer leg result, talk duration. All shown in History; raw Twilio IDs only in Details.

### 7.2c What gets logged, and by whom
| Automatically (from Twilio) | You, on the Log call sheet (only after you talked) |
|---|---|
| Alert sent to each of you | Outcome: 🟢 Booked · 🟢 Yes, date TBD · 🟡 Not now · 🔴 No |
| Whose phone answered, who took it, when | Price you told them |
| Customer answered or not → no answer moves card to In talks | First visit date (Booked) |
| Talk time, call recording | Reason + check-back date (Not now / No) |
| Online booking requests | Optional note |
Calls made straight from your own phone (outside Twilio) need the sheet including "didn't reach".

### 7.2d What customers choose when booking online (checked 28 Oct)
A **date** plus a **time window** (Morning / Afternoon / Any time), not an exact time. The emailed-quote booking also allows "ASAP" or "Not sure yet". The booking-request text and lead page show e.g. "Wants Tue Nov 4 · morning".

### 7.3 Keeping the other person informed (texts to staff)
| Event | Who gets a text | Text |
|---|---|---|
| Lead claimed | The other person | "Caelan took Jane Smith (512) 555-0142" |
| Nobody claimed | Both | "Nobody took Jane Smith · tap to call" |
| Call outcome logged | The other person (S19) | "Jane Smith: 🟢 Booked Tue · $45/visit" |
| Booking request online | Both | Alert text starts "BOOKING REQUEST" |
| Claimed but no outcome logged after 30 min (S20) | The claimer | "Log your call with Jane Smith: link" |

### 7.4 Edge cases (trimmed 28 Oct to the ones that matter)
| # | Case | Handling |
|---|---|---|
| E1 | Both press 1 at the same instant | Atomic claim (7.2b); the second hears "Paxton has it". |
| E2 | A cell's voicemail answers the alert call | No detection (R7): it leaves a short "New lead" voicemail; the other phone keeps ringing. |
| E3 | Nobody presses 1 in ~30 s | "Not taken" flag + text to both with tap-to-call. Lead stays at the top of New. |
| E4 | Customer doesn't pick up / busy / their voicemail | Claimer can leave a voicemail. Auto-logged "Called, no answer" → In talks, attempt +1. |
| E6 | One of us is already on a call | That leg reads busy; the other rings. Both busy → E3. |
| E8 | Lead has no valid phone | No calls; alert text only, marked "No valid phone". |
| E10 | Same person submits again within 24 h (price, then booking) | No second ring. Claimed → text the claimer "Jane just booked online: Tue · $45". Not claimed → normal flow, worded "Booking request". |
| E16 | Calls get labeled "Spam Likely" | Setting `CONNECT_MODE=dial-yourself`: press 1 claims and ends the call; claimer taps to call from their own phone. |
| E17 | Twilio down / balance $0 | Alerts recorded as failed and retried by the existing recovery job; auto-recharge prevents $0; the board still shows the lead. |
| E20 | Test leads | Name starting "TEST" rings nobody; alert text tagged [TEST]. |
Not building: anything for customers calling or texting (512). Customers never see that number in this model; Twilio's default handling is enough.

### 7.5 Phone decisions
| # | Question | Answer |
|---|---|---|
| P0 | Connect mode | ✅ Twilio connects, caller ID = claimer's verified cell; fallback setting to dial-yourself (E16) |
| P1 | Nobody takes it | ✅ Text both "Nobody took Jane Smith · call now" + tap-to-call; no re-ring |
| P2 | Night leads | ✅ Ring 24/7 |
| P3 | Record customer calls | ✅ Yes, no announcement (Texas is one-party consent; we are a party; customers are Austin-area). ~$1–2/month. Recording playable from History. Transcripts later |
| P4 | Delay from alert text to ring | ✅ None: text and calls start together |
| P5 | Exact alert text and spoken prompt wording | ✅ Approved by Caelan 28 Oct (7.6) |
| S19 | Text the other person when an outcome is logged | ✅ Yes |
| S20 | Reminder to log a call after 30 min | ✅ Yes |
| S21 | Calls/texts to (512) | ✅ Nothing to build: customers never see it |
| P6 | Booking requests ring too | ✅ Yes; prompt says "Booking request" so you know they already chose a day |
| P7 | Map image link expiry | ✅ Yes. Invisible to you: the picture still shows directly in the text; only the stored web address stops working after a while |

### 7.6 Alert text wording + map image (P5)
**Image: yes, as an MMS.** (512) 643-5722 is MMS-capable, and every map lead already saves a JPEG screenshot of their map with the tracing (`booking-maps` storage bucket, `map_screenshot_url` on the lead and booking). Twilio attaches it from that URL. Costs ~2–3¢ per MMS vs ~1¢ for a long SMS (≈ +$4–6/month at 100 leads × 2 of us). Leads without a map (ConviFlo, project form) send a plain text. If the campaign form asks whether messages contain media, tick yes.
Note: those screenshots are public links today (anyone with the exact URL can open them); switching to expiring links is a small privacy improvement to include in the build (❓ P7).

Text (≤ 320 characters + image):
```
NEW LEAD · Jane Smith
Not booked · saw $45/visit, 1st $32
Mowing, edging · every 2 wks
6,200 sq ft traced
1234 Oak St, Round Rock
(512) 555-0142
Facebook ad · Dave video
quietgreen.co/l/AB12
[map image]
```
Booking request:
```
BOOKING REQUEST · Jane Smith
Wants Tue Nov 4 · morning · every 2 wks
$45/visit · 1st $32 (−30%)
Add-ons: hedge trim
"Gate code 4411, dog in yard"
1234 Oak St, Round Rock · 6,200 sq ft
(512) 555-0142
quietgreen.co/l/AB12
[map image]
```
No price (ConviFlo / project form): line 2 = `No price · wants hedge trimming`, plus the customer's top answers as `label: value`.
Spoken prompt: "New lead. Jane S., Round Rock, mowing. Press 1 to call them now. Press 2 to pass." Booking request: "Booking request. Jane S. wants Tuesday morning, mowing. Press 1 to call them now. Press 2 to pass."

### 7.7 Acceptance checks (before turning on in production)
1. Synthetic lead → both get the alert text; both cells ring after the delay.
2. Caelan presses 1 → Paxton's ring stops; Paxton gets "Caelan took…"; a third test phone (the "customer") rings showing Caelan's cell.
3. Test customer doesn't answer → lead auto-moves to In talks, attempt 1.
4. Test customer answers 1 min → History "Talked 1 min", "Log this call" banner.
5. Both ignore → "Not taken" text to both.
6. Voicemail answers one leg → no voicemail left.
7. Same phone submits a booking after claim → only the claimer gets "just booked online".
8. TEST-named lead → nobody rung.
9. Map lead → alert arrives with the map image; ConviFlo lead → plain text.

### 7.7b Reliability review (28 Oct): where it could go wrong, and the design that prevents it
| # | Risk | Design |
|---|---|---|
| R1 | Both press 1 | One conditional database update ("take it only if nobody has"); exactly one wins (7.2b). |
| R2 | Twilio retries a webhook, or a press arrives twice | Claim is idempotent: if it's already mine, carry on without dialing the customer a second time ("customer dial started" is also set once, conditionally). |
| R3 | Winner pressed 1 while the other phone is still ringing / just answering | Server cancels the other leg through Twilio's API. Every webhook for a leg first checks the claim, so if that person answers in the same instant they hear "Paxton has it" and the leg ends. |
| R4 | Slow connect | The customer is dialed inside the winner's own call (the reply to the keypress is "dial the customer"), not as a separate call, so there's no extra hop. Webhook work is one database statement; Vercel functions sit in the same region as Supabase (check during build). |
| R5 | "Nobody took it" needs a 30-second timer, and serverless functions can't wait | No timer: Twilio reports when each alert leg finishes. When the last leg finishes and the lead is still untaken, send the "Nobody took it" text (once, conditionally). |
| R6 | 30-minute "log your call" reminder (S20) needs a scheduler | Supabase pg_cron every 5 minutes (Vercel Hobby only allows daily crons) calls `/api/cron/phone`: sends due reminders and retries failed alerts (the recovery job that already exists). |
| R7 | Voicemail detection hangs up on a real person who says a long "Hello?" | ✅ **Off** (Caelan, 28 Oct). Worst case: a 5-second "New lead" voicemail when a phone is off. |
| R8 | Picture texts (MMS) arrive slower than calls, sometimes 10–30 s | Send the details as a normal text first (arrives in ~1–3 s), then the map image as a second message. |
| R9 | iPhone "Silence Unknown Callers" / Focus / Do Not Disturb blocks the alert | Setup checklist: both save (512) 643-5722 as a contact "QuietGreen Leads" and allow it through Focus/DND (iPhone: Emergency Bypass on that contact). |
| R10 | Ringing so long that your carrier voicemail picks up | Alert legs ring 20 s, then give up. |
| R11 | Winner hangs up before the customer answers | Logged as "Hung up before they answered", not "no answer"; card doesn't auto-move. |
| R12 | Fake requests to our webhooks (someone "pressing 1" from the internet) | Every Twilio webhook checks Twilio's signature; unsigned requests are rejected. |
| R13 | Recordings exposed | Recordings stay in Twilio with password-protected media; the CRM plays them through a staff-only page. Recording starts when the customer answers, both sides. |
| R14 | Verified caller ID not set up for someone | That person's connected calls show (512) instead, and the CRM shows a warning. Each of us verifies once in the Twilio console (Twilio calls the cell with a code). |
| R15 | Alert texts blocked (campaign not approved yet, or someone replied STOP) | Calls still work. Calls and texts have separate on/off settings (`STAFF_VOICE_ENABLED`, `STAFF_SMS_ENABLED`). Never reply STOP to alerts. |
| R16 | Two leads arrive at once | Each lead rings independently. Someone already on a lead call shows as busy; the other person gets the second lead. |
| R17 | Spam labels on connected calls | Watch for it in the first week of real leads; switch `CONNECT_MODE=dial-yourself` if it happens (E16). |

**Setup checklist before go-live:** add Twilio funds + auto-recharge · campaign approved · both cells verified as caller IDs · (512) saved as a contact and allowed through Do Not Disturb on both phones · recording media protected · run the 7.7 acceptance checks with a third phone as the "customer".

### 7.8 Retired from the old plan
Business line on (512), number switch, inbound customer texts to (512), auto texts to customers.

## 8. Local development against production

- Localhost runs `npm run dev` on port 3000 (`.claude/launch.json`).
- Today `.env.local` points at the **local test database** (`qg-crm-test`, Docker). Test staff login is in `tests/bootstrap-local.py`.
- To see real data: paste prod `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` into `.env.local` (from Paxton's `.env.local` or Supabase → Project Settings → API Keys for `juwvyquorsxulajrchjv`). Caelan's Vercel login cannot see the project.
- Local `STAFF_SMS_ENABLED` and `STAFF_VOICE_ENABLED` are `false`, so local test leads never phone anyone. **Edits made on localhost while pointed at prod change real records.**
- ⬜ **Prod data review:** once connected, walk through real leads with Caelan and list what looks weird (missing prices, odd stages, raw codes, duplicates). Feeds section 3.5 S8 (placing existing leads on the board).

---

## 9. Open questions (28 Oct)
| # | Question | Section |
|---|---|---|
| S8 | Placing existing leads on the board: build ships a one-time placement script + preview; run it on prod only after the prod data review | 3.5, 8 |
| A1 | How new ads get readable names. Research done (`RESEARCH-ads.md` §1, §3): all 12 live ads already match `launchAds`. Recommended: keep the ad ID → name table in code, name future ads `<SET>-<V\|I><NN> \| <Name> \| <stage>`, add a row per new ad; unknown IDs show "new ad (ID …)". Caelan to confirm | 5 |
| A2 | ConviFlo answer labels. Research done (`RESEARCH-ads.md` §2–4): in use = Mowing + Leaves & Gutters review forms. Recommended: map in code per form ID (key → question, slug → label), don't rename keys; landing-page keys shifted, so label by slug. Check §4 items (e.g. `both_leaves_and_gutters_save_30`) on real leads in S8 | 5 |

## 10. Execution order (Claude owns; drafted 28 Oct)

### Before building (needs Caelan/Paxton)
| # | Task | Who |
|---|---|---|
| B1 | Twilio: add funds + auto-recharge; approve campaign wording + fee; Claude submits campaign | You + Claude |
| B2 | Localhost on prod data (three keys into `.env.local`), then a prod data review session (section 8) | You paste keys; review together |
| B3 | Ad naming research: Caelan logs Claude into Meta Ads Manager (and ConviFlo if needed); list unnamed ads on real leads; decide A1 | Together |
| B4 | Close remaining questions (section 9) | You |

### Build (agents, in parallel where safe)
1. **Foundation (one agent, first):** database migration + shared definitions everything else uses: board column, call log table, reasons, check-back date, taken-by, website price, tracing shapes, alert/call records; the shared "lead summary" function that produces the chips, price line and alert text. Small, reviewed before anything else starts.
2. **Then two agents in parallel, separate worktrees, separate files:**
   - **CRM agent:** board (desktop + phone), lead page v2, Log call sheet, readable source/answers, `/admin` → board, saving website price + tracing, quality bar 6.2. Owns `app/admin/**` and the website quote components.
   - **Phone agent:** Twilio press-1 flow, claim, connect with caller ID, recordings, staff texts (7.3), map image, reminders cron, reliability items 7.7b. Owns `app/api/twilio/**`, `lib/staff-alerts.ts`, new `lib/phone/**`.
3. **Merge** both branches onto one branch; run typecheck, lint, existing tests, new tests for claim race + alert wording.
4. **Review (fresh agent, not one that wrote code):** checks the build against this plan (every ✅ row), code standards, security (webhook signatures, staff-only pages, recordings), and the 4.1f field checklist; findings fixed; second short review of the fixes.
5. **Verify on localhost** (test database): board flows, Log call sheet, lead page on phone width; phone flow with Twilio test credentials where possible.
6. **Go-live (owner handoff, Paxton's laptop per AGENTS.md):** `supabase db push`, deploy, setup checklist (7.7b), acceptance checks 7.7 with a third phone, then flip `STAFF_VOICE_ENABLED`/`STAFF_SMS_ENABLED`.

## 11. Execution ledger
| Date | What | Commit / evidence |
|---|---|---|
| 2026-10-28 | Privacy page shipped | `cc57c38` |
| 2026-10-28 | Twilio business profile approved; brand submitted and approved | Twilio console |
| 2026-10-28 | Terms page + carrier privacy sentence shipped | `57cc06d` |
| 2026-10-28 | Twilio campaign submitted (Low Volume Mixed) | `CMd34536602ab70719a7a15ac4ff6df60b` |
| 2026-10-28 | Build step 1 (foundation): migration `20261028120000_crm_board_phone.sql` (board column, reasons, check-back, phone/website price, tracing, short links, taken-by, `lead_calls`, auto-move triggers, RPCs `crm_move_lead` / `crm_log_call` / `crm_claim_lead` / `crm_finish_customer_leg`); shared `lib/lead-summary.ts` (chips, price line with 1st visit −30%, card headline, alert/spoken/staff texts, history rows), `lib/lead-board.ts`, `lib/lead-labels.ts` (A1/A2 tables), `lib/staff-directory.ts`, `/l/<code>` short links; `npm test` runner (`tests/ts-resolve.mjs`). Applied to local `qg-crm-test` only | `d70c4f1` |
| 2026-10-28 | P7 signed map links helper + bucket-private migration `20261028130000_private_map_screenshots.sql` | `6db9f13` |
| 2026-10-28 | Build step 2 started: CRM agent and Phone agent in separate worktrees | — |
| 2026-10-28 | Phone flow merged: Twilio signature checks, press-1 claim + connect with verified caller ID, `CONNECT_MODE`, recordings (staff-only route), staff texts (`staff_texts`), nobody-took-it, E10, cron reminders (`vercel.json` */5), migration `20261028150000_phone_flow.sql`; claim-race + e2e webhook tests pass locally. Go-live notes in `PHONE-GO-LIVE.md`. Intake-defaults fix moved into the foundation migration | `0a13e33`, merge `2c8822f` |
| 2026-10-28 | CRM merged: board (desktop columns + list, phone chips option A, drag/keyboard/menu moves, Closed reason), lead page v2 (Price · Property · Request · Source · History · Log call · Details), Log call sheet v2, `/admin` → board (Jobs at `/admin/jobs`), readable ad/ConviFlo labels from RESEARCH-ads.md, website price + tracing saved, signed map links, S8 placement script (dry run on local only) | `6a80034`, merge `970c20c` |
| 2026-10-28 | Log call Booked now schedules the confirmed first visit on Jobs, links a new customer and starts the plan (`20261028160000_crm_call_job.sql`); same-phone customers are left for staff to link | this commit |
| 2026-10-28 | Build step 4: fresh review (1 P1, 8 P2, 12 P3). Fixed: no replay of held texts when SMS is enabled (P1); Booked reuses an open booking request; canceled request → Quoted; auto-closed cards get a reason; plan visits don't reopen closed cards; History shows alert legs; all known prices shown in Price; desktop layout per L3 with the quote tools in the right column; staff builder starts from the customer's tracing; visible R14 caller-ID warning; leaner board/lead queries; 44 px targets; shared chips; staff-only secure short links; staff text retry; docs. Kept on purpose (PHONE-GO-LIVE.md §5): customer voicemail reads as talked, retried keypress re-dial, E10 overlap rings | `80bd87f`, `d2eff65`, this commit |
| 2026-10-28 | Build step 5 (localhost, test DB, 375 px + desktop): board, lead page, Log call Booked → confirmed visit on Jobs + customer + every-2-wks plan. Fixed 3 display bugs found there. Second review: all 18 findings closed; its 1 P2 (second Booked after a plan started added a job) and 2 P3s (booking price source, lost-lead closed reason) fixed. Final: `npm test` 81/81, typecheck clean, no new lint errors, claim-race + 6 phone e2e scenarios pass, 4 migrations apply cleanly to a fresh copy of the pre-build DB | `3784de2`, this commit |
| 2026-10-28 | Local demo data: `scripts/seed-demo-leads.mjs` wipes the local CRM tables and seeds 33 realistic leads (New 7, In talks 6, Quoted 5, Booking request 3, Customer 6, Closed 6) with alerts, calls, Log call outcomes, plans and two canceled customers, times relative to now. Refuses any non-local Supabase URL; run on qg-crm-test only (backup `/tmp/before-demo-seed.dump` in the container) | this commit |
| 2026-10-28 | UX polish pass (branch `claude/crm-ux-polish-f7dd65`): 3 blind screenshot reviewers + Caelan's phone notes → `UX-AUDIT.md`. Board cards = name · age · price + one status chip · services/town (new `card` in `lib/lead-summary.ts`); lead header chips trimmed, "Not taken" → "Missed alert"; plain price rows; caller-ID warning moved to one board setup note; opaque phone bars; Log call radios; alert steps folded in History; phone Jobs dates; Revenue rows on phone; UUID fallback for plain-http preview. Blind A/B: after preferred 20/21. Open: yes/no list Q1–Q11 in `UX-AUDIT.md` §4 | `9ec8227`…this branch |
| 2026-10-29 | UX audit answers built (branch `claude/crm-ux-polish-f7dd65`, details `UX-AUDIT.md` §4a): Q1 schedule on the booking-request lead; Q2 one main button per column; Q3 one Price card (quote status chip, Edit price opens calculator + map, pencil Edit contact, Add note in History); Q4 calculator closed by default; Q6 Leads search; Q7 Weekly · Every 2 weeks · Monthly · One time on staff screens; Q8 Jobs Upcoming/Past; Q9 older payments in Paid all time; Q11 Today next visit + call-backs. Shared `priceSteps()`/`bookingPrice()` + `PriceSteps` (full → plan discount → first visit, lead page and Jobs) and `LawnMap` (saved map image, else tracing; lead page and Jobs). Q5, Q10 no. Open: phone-booked first visit job total = full price (billing question) | this commit |
| 2026-10-29 | Phone-booked first visit charges the 30% first-visit price (Caelan): `callVisitItems()` (plan price + "First visit 30% off" line; plan template stays full price), migration `20261029120000_crm_call_job_first_visit.sql` (`crm_create_call_job` takes `price_per_visit`), seed aligned, local demo rows fixed in place. Applied to local qg-crm-test only; push the migration before the code (PHONE-GO-LIVE.md) | this commit |
