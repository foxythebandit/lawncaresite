# Address reliability repair — 27 October 2026

## Result and scope

Repair the shared website/CRM property lookup without another address provider, account, migration or customer-contact automation. Preserve production records, booking semantics, pricing, attribution, published ConviFlo questions and ad budgets.

The reported Hutto address is a valid lead, not an out-of-area rejection. Its numbered house exists in the map data without a city value. The old full-text query including Hutto returns no result. A structured street/ZIP lookup finds the numbered house. The CRM required an autocomplete choice before its final lookup could run, making empty suggestions a dead end.

ConviFlo's inspected preview collects street/unit/city as text and ZIP in a separate question. It does not supply a confirmed coordinate. The website inquiry form and map builder share Photon suggestions; the website map and CRM share the final resolver. We unify our lookup and preserved input; this repository cannot replace a vendor's future implementation.

## Changes

- Typed final search works without a dropdown selection. Supplied street/ZIP uses one structured final request, rather than successively looser searches.
- Retain house/street/ZIP and precision. Reject conflicting house, street, ZIP, explicit city/state or country. Broad/road-only matches cannot silently become verified houses.
- Staff confirm the displayed location before using measured ConviFlo quotes. Confirmation is bound to contact address, lookup address and coordinates, persisted in existing quote JSON and checked on the server.
- Existing unconfirmed ConviFlo pins reopen for review. Old website drafts and non-map service quotes retain their behavior. Finding a property does not change an inquiry into a booking.
- Staff recovery accepts explicit coordinates or a Google Maps selected-place URL and displays the point for confirmation. It never follows URLs; shortened links and viewport-only URLs are rejected because the camera position need not be the selected house.
- Remove house-number-only nearby-parcel marker relocation. Saved point and displayed pin agree. Relocation clears measured geometry/add-on areas; contact corrections cannot inherit the old ZIP.
- Preserve ConviFlo postcode in new addresses; historical records use their original postcode only while the current address matches the original submission. Raw answers/contact text remain intact.
- Cancel stale suggestions/searches, bound provider waits, validate/bound caches and remove background final geocoding from lead-list warmup.
- Public failures retain the personal-inquiry route; service-area checks and waitlist remain active. Public exact matches add no confirmation step; approximate candidates require confirmation. No paid dependency or new key.

## Verification

- 15 mixed query cases, 30 initial cached, low-rate provider requests: office, Austin/Hutto/Round Rock/Cedar Park/Leander/Pflugerville civic addresses, newer civic developments, partial input, fabricated addresses and an out-of-area address. This is not 15 independent residential properties or a coverage percentage.
- One additional structured Hutto lookup: HTTP 200, about 437 ms including curl startup. The point is about 15 m from independently checked Google Maps coordinates; neither is a surveyed boundary.
- Real browser on changed local website: one structured lookup, HTTP 200, 906 ms to candidate/tracing state, no retries/fallback/errors. Receipt: `tests/address-reliability/live-browser-result.json`. Imagery was mocked; this measures lookup rather than aerial imagery. An earlier live attempt reached success but its screenshot locator disappeared; the durable receipt is from the corrected second attempt.
- 26 focused tests pass: 13 resolver, 9 adapter/address-text, 4 manual-location/confirmation. Includes cached positive provider fixtures, wrong/malformed results, stalled/canceled requests, legacy/poisoned caches and comma-free typing.
- `tests/address-reliability/ui.py` passes against real local Next/auth/Supabase with external-service boundaries mocked: ZIP enrichment; corrected contact does not inherit old ZIP; no-dropdown search; confirmation/save/reload; server rejection of unconfirmed review; old-pin review; invalid/manual locations; relocation clears measurement; stale autocomplete; wrong-house rejection; public inquiry fallback; out-of-area waitlist. Phone screenshots inspected.
- TypeScript and scoped lint pass. Existing MapQuoteBuilder has 31 lint findings versus 32 in unchanged baseline, with no added finding. Unrelated baseline findings remain outside this repair.
- Optimized build outcome is recorded in the release receipt below.

All UI writes were to local database `http://127.0.0.1:56421`. Local Next used port 3103, test-only credentials and a network guard that blocked unexpected server destinations and mocked Twilio. No production rows/migrations, live submissions, calls, texts, published forms, ads or budgets changed.

## Limits

No geocoder guarantees every address, speed or rooftop accuracy. This repair removes the dropdown dead end and gives staff a confirmed-location recovery path.

The existing public providers have no availability guarantee. [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) prohibits autocomplete, requires identification/attribution and application-wide traffic below one request/second. Calls remain final-search-only; the page queue spaces requests and background final searches were removed. This is not a distributed multi-user limiter. Before traffic exceeds the policy, move the same resolver behind appropriate shared rate control or an explicitly selected hosted provider. No commercial signup was made.

Detailed sources, timings and caveats: [provider findings](provider-findings.md). Verified ConviFlo contract: [adapter notes](conviflo-contract.md).

## Handoff

Branch: `codex/address-reliability`, based on `145bb15`. Deploy through the normal reviewed release workflow. No Supabase migration, data backfill, new keys, ConviFlo republish or ad edit is needed.

After deployment, open the existing Hutto lead, choose Find my property, visually confirm the house and save after staff review. Do not mark the lead booked as a test.

### Release receipt

Optimized Next.js build passed using `npm run build -- --webpack`; TypeScript and all 21 generated pages passed. Independent final review found no remaining P1/P2 issues after geometry, waitlist and historical ZIP corrections. All 26 focused tests and the real-local-database UI suite passed at the final checkpoint. Code is prepared for reviewed deployment; production is unchanged.
