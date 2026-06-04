@AGENTS.md

# QuietGreen — Project Context

## What this is
A lawn care business landing page called **QuietGreen** — electric/battery-powered lawn care, zero emissions, quiet. Inspired by yellowstonelandscape.com/services. The design came from a complete HTML/CSS prototype the user provided, which was converted into this Next.js app.

## Stack
- **Next.js 16** (App Router, Turbopack)
- **Supabase** — stores quote form submissions
- **Vercel** — deployment target
- **TypeScript**
- **Tailwind v4** installed but barely used — all styling is custom CSS in `app/globals.css` using CSS custom properties. Do NOT try to replace with Tailwind utilities; the design depends on the custom CSS.

## Repo
`github.com/foxythebandit/lawncaresite` — pushed to `main`

## Project structure
```
app/
  layout.tsx          — DM Serif Display + DM Sans via next/font (variables --font-display, --font-body)
  page.tsx            — composes all section components
  globals.css         — ALL styling lives here (CSS custom properties, no Tailwind utilities)
  actions/
    submit-quote.ts   — server action, inserts quote into Supabase
components/
  Nav.tsx
  Hero.tsx            — SVG lawn illustration + floating stat cards
  TrustBar.tsx
  HowItWorks.tsx
  WhyElectric.tsx
  NoiseComparison.tsx
  Testimonials.tsx
  QuoteForm.tsx       — 'use client', uses React 19 useActionState
  MapQuoteBuilder.tsx — user added this (uses leaflet + leaflet-draw)
  Footer.tsx
lib/supabase/
  client.ts           — browser client (@supabase/ssr createBrowserClient)
  server.ts           — server client (@supabase/ssr createServerClient, cookie-aware)
supabase/migrations/
  001_create_quotes.sql — quotes table + RLS (public insert, authenticated read)
```

## Env vars needed
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   ← new Supabase key format (not anon key)
```
Set these in Vercel dashboard AND in a local `.env.local` (see `.env.local.example`).

## Supabase setup not done yet
The migration SQL (`supabase/migrations/001_create_quotes.sql`) still needs to be run in the Supabase dashboard SQL editor. The project hasn't been created in Supabase yet.

## Things learned / gotchas
- **node_modules must be installed with the active Node version.** The machine had Node 18 installed via a direct `.pkg`. We installed Node 24 LTS via `n` (npm package) to `~/.n`. If node_modules ever breaks with a native binding error (`@tailwindcss/oxide-darwin-arm64`), delete `node_modules`, `package-lock.json`, and `.next`, then `npm install` again with the correct Node.
- **Always prepend PATH** in new shell sessions: `source ~/.zshrc` or open a new tab. Node 24 is at `~/.n/bin/node`. The old Node 18 is still at `/usr/local/bin/node` and will be used if PATH isn't right.
- **MacPorts is broken** on this machine (OS upgraded from Monterey → Ventura without migration). It's been removed from PATH in `~/.zprofile` but still exists at `/opt/local`. Don't try to use `port` commands — they will fail.
- **Homebrew is ~3 years out of date** (last updated Feb 2023). `brew install` triggers massive updates. Run `brew update && brew upgrade` when you have 20+ min.
- **Google Fonts timeout locally** — `next/font` falls back to system fonts in dev when it can't reach Google. This is a local network/firewall thing, not a code bug. Works fine on Vercel.
- **MapQuoteBuilder uses leaflet** — user added this component with `leaflet` and `leaflet-draw`. These are already in `node_modules`.

## Deploy checklist
1. Create Supabase project → run `supabase/migrations/001_create_quotes.sql`
2. Copy URL + publishable key
3. Import repo in Vercel (`github.com/foxythebandit/lawncaresite`)
4. Add env vars in Vercel project settings
5. Deploy
