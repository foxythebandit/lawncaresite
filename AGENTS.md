<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CRM revamp

For CRM revamp work, read `docs/crm-revamp/SPINE.md` before changing code. It records the confirmed requirements, open product decisions, file ownership, acceptance checks, and current handoff. Keep its execution ledger current so another agent can continue without relying on chat history.

Work on the feature branch. Preserve existing website intake, customer records, staff access, and quote functionality. Production deployment, live migrations, and live notification tests belong to the owner's deployment handoff in `docs/crm-revamp/PRODUCTION-HANDOFF.md`.
