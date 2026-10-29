# Handoff: CRM leads + phone system (28 Oct 2026)

Read this first, then `PLAN.md` (the decisions) and `mockups.html` (the approved layouts; open it in a browser). The planning conversation is not needed.

## Where things stand

| Area | State |
|---|---|
| Plan | `PLAN.md` sections 3–7 are decided. Open: S8, A1, A2 only (section 9). |
| Mockups | `docs/ops-plan/mockups.html`: lead board (phone option A + desktop), lead page v2, log call sheet v2, alert texts. Layout/content approved; style must follow `app/admin/crm.css` and quality bar 6.2. |
| Website | `/privacy` (with the carrier sentence) and `/terms` (SMS Terms) are live (`cc57c38`, `57cc06d`). |
| Twilio account | Business profile Quietgreen LLC approved. Brand QuietGreen (Low-Volume Standard) approved. Auto-recharge on. |
| Twilio campaign | `CMd34536602ab70719a7a15ac4ff6df60b`, Low Volume Mixed, staff alerts only. **In review** (submitted 28 Oct). Messaging Service "QuietGreen Staff Alerts" `MG604aadfb9429a4f5f6652c4067c7d3ab`. |
| Code | Built, reviewed twice and verified on localhost on branch `claude/crm-phone-build-62cc5f` (not pushed, not deployed). Go-live steps: `PHONE-GO-LIVE.md`. Ledger: PLAN.md section 11. |

## Waiting on

1. **Twilio campaign approval** (email to Paxton's address; typically ≤ 5 business days). Then:
   - Attach (512) 643-5722 to the Messaging Service (Messaging → Services → QuietGreen Staff Alerts → Add Senders). The new Twilio console's page for this 404'd on 28 Oct; retry or use the classic console.
   - Set `STAFF_SMS_ENABLED=true` in Vercel (project is on Paxton's Vercel account) and send a synthetic lead.

## Next work (parallel)

| Track | Who | Needs |
|---|---|---|
| **Build** (PLAN.md section 10): foundation → CRM + phone in parallel → fresh review → localhost verification | Build session, in its own worktree/branch | Nothing from Caelan until review. Uses the local test database, not prod. |
| **Ad + ConviFlo research** (A1, A2): list every Meta ad ID → name, creative type; each live ConviFlo form's field keys → question text. Output `docs/ops-plan/RESEARCH-ads.md` | Research session with Caelan logged into Meta Ads Manager and ConviFlo in Chrome | Caelan's logins (he types them) |
| **Prod data review** (S8) | Later, with Caelan | Prod keys in `.env.local` (below) |

## Why the prod keys (optional, not needed to build)
Localhost talks to a local test database, which has fake leads. Pasting prod's three Supabase lines into `~/lawncaresite/.env.local` lets localhost show real leads, only to (a) review real data for oddities and (b) preview where existing leads land on the new board (S8). Building and testing do not need it. Source: Paxton's `.env.local`, or Supabase → project `juwvyquorsxulajrchjv` → Project Settings → API Keys. Local alert sending is off (`STAFF_SMS_ENABLED=false`, `STAFF_VOICE_ENABLED=false`), but edits on localhost would change real records.

## Gotchas learned
- **Node:** v24.7.0 lives at `~/.nvm/versions/node/v24.7.0/bin` (CLAUDE.md's `~/.n` path is outdated). `.claude/launch.json` (uncommitted, machine-specific) starts `npm run dev` on 3000.
- **Local DB:** Docker Supabase `qg-crm-test` on port 56421; staff test login is in `tests/bootstrap-local.py`.
- **Twilio console in Claude in Chrome:** dropdowns and some buttons inside Twilio's embedded (Persona) forms don't respond to automated clicks; ask Caelan to click them. The new console ("One Console") often 404s on deep links; navigate via the sidebar.
- **Vercel** project `lawncaresite` is on Paxton's account; Caelan's Vercel login can't see it. Production deploys happen by pushing `main`; migrations go through Paxton's laptop (`AGENTS.md`).
- **Twilio local credentials** in `.env.local` are placeholders; real ones are only in Vercel.
