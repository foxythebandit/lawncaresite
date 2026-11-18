# Phone flow go-live (PLAN.md section 7)

This is the October 28 phone-flow handoff. Follow [AGENTS.md](../../AGENTS.md) and the reviewed feature release through `npm run release` for current production work. Calendar and first-visit behavior are documented in [Calendar and service schedules](../daily-clarity/README.md).

## 1. Database in the October release

The release introduced the lead board and call log (`20261028120000_crm_board_phone.sql`), private booking maps (`20261028130000_private_map_screenshots.sql`), phone flow (`20261028150000_phone_flow.sql`), booked-call visit creation (`20261028160000_crm_call_job.sql`), introductory pricing (`20261029120000_crm_call_job_first_visit.sql`), and the phone worker (`20261029130000_phone_cron_schedule.sql`).

## 2. Vercel environment variables (Production)
| Variable | Value |
|---|---|
| `STAFF_PEOPLE` | `Caelan:+1979…:<caelan login email>,Paxton:+1682…:<paxton login email>`. The phones must match `TWILIO_STAFF_PHONES` exactly. The emails must match their CRM logins; that is how "outcome logged" texts know who the other person is. |
| `CONNECT_MODE` | `twilio` (default). Set it to `dial-yourself` if connected calls start showing "Spam Likely" (E16). |
| `TWILIO_VERIFIED_CALLER_IDS` | Comma list of the cells verified in step 3, e.g. `+1979…,+1682…`. A cell missing from this list shows (512) 643-5722 to the customer (R14). |
| `CRON_SECRET` | Random, 32+ characters (`openssl rand -hex 24`). Put the same value in Supabase → Integrations → Vault as a secret named `crm_cron_secret`; the scheduled job sends it as a bearer token and does nothing until it exists. |
| `CRM_BASE_URL` | `https://quietgreen.co`. Twilio's signatures are checked against this origin. If it's wrong, every webhook returns 403. |
| Already set | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_STAFF_PHONES`, `STAFF_SMS_ENABLED`, `STAFF_VOICE_ENABLED`, `ALERT_RECOVERY_SECRET`. Check `STAFF_SMS_ENABLED=false` (texts wait for campaign approval) and `STAFF_VOICE_ENABLED=true`. |

**Vercel plan:** Hobby is fine. The every-5-minutes job runs in Supabase (pg_cron + pg_net), not Vercel Cron, so there is no `vercel.json`. Check it after deploy: Supabase → Integrations → Cron → `crm-phone` → recent runs, and `select status_code from net._http_response order by id desc limit 5` should show 200s.

**Before the first cron run:** the cron also runs the existing alert recovery sweep. Held alerts never replay: texts older than 1 hour and rings older than 15 minutes are marked `skipped` (`expired`) instead of sent, so turning `STAFF_SMS_ENABLED` on doesn't text old leads. Expect the first runs to mark the old `disabled` backlog as skipped (20 events per run).

## 3. Twilio console
1. **Verify both cells as caller IDs:** Phone Numbers → Manage → Verified Caller IDs → Add. Twilio calls the cell with a code. Then add both numbers to `TWILIO_VERIFIED_CALLER_IDS`.
2. **Protect recording media:** Voice → Settings → General → "Enforce HTTP Auth on Media URLs" = on. Recordings stay in Twilio, and the CRM plays them through `/api/twilio/recordings/<lead_calls.id>` (staff login required).
3. No webhook URLs to configure. Each alert call carries its own `Url`/`StatusCallback`, and the alert number (512) needs no inbound setup (S21).
4. Both phones: save (512) 643-5722 as "QuietGreen Leads" and allow it through Focus/Do Not Disturb (R9).

## 4. Deploy, then acceptance checks (PLAN.md 7.7), with a third phone as the customer
The checks below describe the October release.
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

## 5. Known limits (reviewed 28 Oct, kept on purpose)
- **Customer voicemail reads as a talked call.** With voicemail detection off (R7), Twilio reports a customer's voicemail as an answered call, so History says "Talked N min" and the "Log this call" banner appears. Log it as "Left voicemail" on the sheet; that moves the card to In talks with attempt +1. Detecting it would mean answering-machine detection on the customer leg, which adds seconds of silence when a real person picks up.
- **Winner hangs up while the customer's phone rings (R11)** relies on Twilio reporting `canceled` for that leg. Confirm during check 3: hang up before the third phone answers and the card must not move.
- **A retried keypress can dial again (R2):** only when Twilio retries the same call's keypress because it never received the first reply, so the first dial never happened. A press on any other call never dials.
- **Unlock then book within seconds (E10 overlap):** the booking's own rings can start before the first claim lands; the loser hears "… has it". Harmless.
