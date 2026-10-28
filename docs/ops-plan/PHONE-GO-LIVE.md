# Phone flow go-live (PLAN.md section 7)

For the deployment handoff on Paxton's laptop. Do these in order. Nothing here has been done yet.

## 1. Database
`supabase db push --dry-run`, then `supabase db push`. It applies `20261028120000_crm_board_phone.sql`, `20261028130000_private_map_screenshots.sql` and `20261028150000_phone_flow.sql`. The last one also fixes a bug in the first: without it, every intake fails with 23502 (null `board_column`). Push all three together, before the code.

## 2. Vercel environment variables (Production)
| Variable | Value |
|---|---|
| `STAFF_PEOPLE` | `Caelan:+1979…:<caelan login email>,Paxton:+1682…:<paxton login email>`. The phones must match `TWILIO_STAFF_PHONES` exactly. The emails must match their CRM logins; that is how "outcome logged" texts know who the other person is. |
| `CONNECT_MODE` | `twilio` (default). Set it to `dial-yourself` if connected calls start showing "Spam Likely" (E16). |
| `TWILIO_VERIFIED_CALLER_IDS` | Comma list of the cells verified in step 3, e.g. `+1979…,+1682…`. A cell missing from this list shows (512) 643-5722 to the customer (R14). |
| `CRON_SECRET` | Random, 32+ characters. Vercel Cron sends it as a bearer token. |
| `CRM_BASE_URL` | `https://quietgreen.co`. Twilio's signatures are checked against this origin. If it's wrong, every webhook returns 403. |
| Already set | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_STAFF_PHONES`, `STAFF_SMS_ENABLED`, `STAFF_VOICE_ENABLED`, `ALERT_RECOVERY_SECRET` |

**Vercel plan:** `vercel.json` runs `/api/cron/phone` every 5 minutes. Hobby only allows daily crons, and the deploy fails on Hobby with this file. Paxton needs to confirm the project is on Pro first. If it isn't, change the schedule to daily and accept slower reminders (or use an external scheduler that sends `GET` with `Authorization: Bearer $CRON_SECRET`).

**Before the first cron run:** the cron also runs the existing alert recovery sweep, which re-sends `pending`/`disabled` alerts. Check the backlog first: `select state, channel, count(*) from staff_alerts group by 1,2`. Old disabled SMS rows would send as texts. Voice rows older than 15 minutes are never rung; they are marked `skipped` (`expired`).

## 3. Twilio console
1. **Verify both cells as caller IDs:** Phone Numbers → Manage → Verified Caller IDs → Add. Twilio calls the cell with a code. Then add both numbers to `TWILIO_VERIFIED_CALLER_IDS`.
2. **Protect recording media:** Voice → Settings → General → "Enforce HTTP Auth on Media URLs" = on. Recordings stay in Twilio, and the CRM plays them through `/api/twilio/recordings/<lead_calls.id>` (staff login required).
3. No webhook URLs to configure. Each alert call carries its own `Url`/`StatusCallback`, and the alert number (512) needs no inbound setup (S21).
4. Both phones: save (512) 643-5722 as "QuietGreen Leads" and allow it through Focus/Do Not Disturb (R9).

## 4. Acceptance checks (PLAN.md 7.7), with a third phone as the customer
Use a lead named like a real person, with the third phone's number. A `TEST…` name rings nobody.
1. Submit the lead: both cells get the text and both ring at the same time.
2. Caelan presses 1: Paxton's ring stops, Paxton gets "Caelan took …", and the third phone rings showing Caelan's cell.
3. Don't answer on the third phone: the lead moves to In talks with attempt 1 (History: "Called, no answer").
4. Repeat with a new lead and answer for about 1 minute: History shows "Talked 1 min", the "Log this call" banner appears, and the recording plays. About 30 minutes later the claimer gets "Log your call with …".
5. New lead, both ignore it: both get "Nobody took …".
6. Phone off on one leg: a short "New lead" voicemail is fine (R7, detection off).
7. After check 2, submit a booking from the same customer (emailed-quote booking or website booking with the lead link): only Caelan gets "… just booked online", and nobody rings.
8. Lead named `TEST …`: texts arrive tagged [TEST] and nobody rings.
9. Map lead: the text arrives, then the map image as a second message. A ConviFlo lead gets text only.

Local equivalents (test database only): `node tests/phone-claim-race.mjs`, `node tests/phone-e2e.mjs` (starts its own dev server on 3202 with Twilio mocked), and `npm test`.
