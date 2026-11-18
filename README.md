# QuietGreen

## Running the site on your Mac

This gives you a private copy of the site with its own practice database. Nothing you do here touches the real site or real customers.

**The first time:**

1. Install [Node.js](https://nodejs.org) version 24 if you don't have it.
2. In Terminal, in this folder, run `npm install`.
3. Run `npm run db:start`. The first run downloads a lot, so give it a while.
4. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).

**After that:** `npm run db:start`, then `npm run dev`. If the database is already running, `db:start` only refreshes the settings, so it's always safe.

**Practice logins** (password `password123`):

| Login | What it's for |
|---|---|
| `staff@example.test` | The staff side, at [/admin](http://localhost:3000/admin) |
| `customer@example.test` | The customer portal, at [/portal](http://localhost:3000/portal). It signs in with an emailed link instead of the password. Run `npm run db:status`, open the "Mail" address, and click the link in the email |
| `outsider@example.test` | Someone who should be refused at /admin |

### If your Mac needs Docker

The database runs by itself on an Apple-chip Mac (M1 or newer) with macOS 14 or newer. Any other Mac, such as an older Intel one, needs Docker. The scripts work this out for you. You only do this once:

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
2. Wait until it says it's running.
3. Run `npm run db:start` as usual. The first time can take 10 minutes or more.

Docker Desktop must be open whenever you use the database. To see which kind your Mac is: Apple menu, About This Mac.

### If something breaks

Run `npm run doctor`. It fixes what it can and tells you what to do about the rest.

Good to know:

- If your `.env.local` points at the real database, `npm run db:start` renames it to `.env.local.before-kit`, keeps it as it was, and makes a new `.env.local` from `.env.example`. It tells you when it does this. Copy over any setting you still need, but never the Supabase lines. Git ignores the old file, so it can't be published.
- If your `.env.local` already points at the practice database, `db:start` updates its Supabase lines and blanks `TWILIO_AUTH_TOKEN`. Your other lines stay.
- `npm run dev` refuses to start if `.env.local` points at the real database or holds a live Stripe key.
- `npm run dev` also refuses if `RESEND_API_KEY` is set without `EMAIL_DEV_RECIPIENT`. Set it to your own address, and every email from your Mac goes there instead of to customers. Texts and calls are always off locally.
- `npm run db:reset` wipes the practice database and starts it fresh. So do `npm run check` and `npm run release`, demo leads included. `node scripts/seed-demo-leads.mjs` fills it with fake leads.

## Checking your work

`npm run check` runs the type check, lint, tests and a fresh rebuild of the practice database. GitHub runs the same check on every push and shows a green tick or a red cross. A red cross doesn't stop you merging; it just warns you.

## Shipping to the real site

**The easy way:** from your branch, run `npm run release`. It checks everything, updates the real database if the branch has a database change, merges the branch, and waits for the site to go live. It's safe to run again if it stops.

It needs two things, set up once:

- The GitHub command line tool: install it from [cli.github.com](https://cli.github.com), then run `gh auth login`.
- A Supabase token: make one at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens). In each new Terminal window, before releasing, run `export SUPABASE_ACCESS_TOKEN=your-token`. Don't commit the token or paste it into a file in this repo, except the git-ignored `.envrc` if you use direnv.

**Merging on GitHub still works.** A merge there doesn't update the real database, so if the branch had a database change, run this right after: `git checkout main`, `git pull`, then `npm run release`. Until you do, the new code is live without its database change, and the site can show errors.

AI agents can't merge or push database changes any other way than `npm run release`. That rule is only for them. Nothing stops you.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
