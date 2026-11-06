<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CRM revamp

For CRM revamp work, read `docs/crm-revamp/SPINE.md` before changing code. It records the confirmed requirements, open product decisions, file ownership, acceptance checks, and current handoff. Keep its execution ledger current so another agent can continue without relying on chat history.

Work on the feature branch. Preserve existing website intake, customer records, staff access, and quote functionality. Production deployment, live migrations, and live notification tests belong to the owner's deployment handoff in `docs/crm-revamp/PRODUCTION-HANDOFF.md`.

## Database and shipping

- **Merge only with `npm run release`.** It migrates prod, then merges. Merging on the GitHub website skips the migration.
- **Never change prod by hand** (dashboard SQL, raw `supabase db push`). Every database change is a migration file, shipped by `npm run release`.
- AI agents never merge, or push migrations, any other way. Paxton can still merge on GitHub; afterwards he runs `npm run release` on `main` to catch prod up.
- In a `-- destructive-ok:` migration line, the approver is Paxton. Add it only after Paxton says yes.
- `npm run dev` and tests use a local database only. `npm run dev` starts it if it's stopped, or start it yourself with `npm run db:start`. Test logins are in `supabase/seed.sql`: `staff@example.test`, `customer@example.test`, `outsider@example.test`, password `password123`. The customer portal signs in with an emailed link; local emails land in the mail page (`npm run db:status` shows its address). Before handing anyone a login, sign in with it yourself first.
- `npm run check` before saying work is done. CI runs the same thing on every push.
- If the local database won't start, run `npm run doctor`; it says what's wrong and how to fix it. AI agents: never start Docker or another database runtime by hand, leave that to Paxton. Fixed a new problem? Add a check to `scripts/doctor.mjs`.
- Plain-words setup for people, including Macs that need Docker, is in `README.md`.
