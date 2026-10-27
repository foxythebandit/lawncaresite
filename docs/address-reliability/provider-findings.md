# Address provider audit — 27 October 2026

## Finding

The complete Hutto address fails both existing providers, despite a matching house existing in Nominatim. Removing the city while retaining street, state and ZIP finds it. Photon returns only a road for that same relaxed query. This is a data/locality matching gap, not proof that the address is invalid.

Supplied Google Maps ground truth: `30.5106347,-97.5865912`. Nominatim without city: `30.510755,-97.586527` (about 15 m away). That distance supports a useful house candidate; it does not establish a surveyed rooftop or parcel boundary.

## Method and limits

One serial request per provider/query, 1.2 s pause after each request, descriptive User-Agent, system TLS verification, cached full responses. This is a deliberately small 15-query set (30 requests), not a representative coverage estimate. Photon uses the application suggestion parameters (limit=10 before US filtering; same bias). Nominatim uses the exact final-search parameters (limit=1). No addressdetails was added; house evidence comes from returned fields/display labels. Final Photon fallback asks for limit=2 rather than10, so its raw response can differ. No live lead submissions or database access occurred.

Initial Python certificate-store errors were local and occurred before HTTP requests. Switched to system curl without disabling certificate checks. All recorded provider responses then returned HTTP 200; the reported browser429 was not reproduced here. These are server-side audit requests; browser CORS, per-IP throttling, and aggregate production traffic are not measured.

Positive civic queries test visible number/street agreement, not independent coordinate accuracy. The office is a user-supplied known good address. Only Jim has supplied independent coordinates. Newer-development proxies: Round Rock library opened 2023 and Cedar Park library opened 2024; no claim is made about broad new residential subdivision coverage.

| Query | Photon first US result | Nominatim first result | ms P/N |
|---|---|---|---|
| 162 Danish Dr, Hutto, TX 78634 | empty | empty | 923/816 |
| 162 Danish Dr, TX 78634 | Danish Drive [street]; 30.5100854,-97.5856193 | 162, Danish Drive, Williamson County, Texas, 78634, United States; 30.5107550,-97.5865270 | 1397/615 |
| 807 E 47th St, Austin, TX | 807 East 47th Street [house]; 30.307429,-97.7187552 | 807, East 47th Street, Ideal Place, Austin, Travis County, Texas, 78751, United States; 30.3074290,-97.7187552 | 909/453 |
| 301 W 2nd St, Austin, TX 78701 | 301 West 2nd Street [house]; 30.2648103,-97.7472145 | Austin City Hall, 301, West 2nd Street, Warehouse District, Austin, Travis County, Texas, 78701, United States; 30.2648103,-97.7472145 | 789/676 |
| 500 W Live Oak St, Hutto, TX 78634 | 500 West Live Oak Street [house]; 30.5453121,-97.5520382 | Hutto City Hall, 500, West Live Oak Street, Hutto, Williamson County, Texas, 78634, United States; 30.5453121,-97.5520382 | 1075/955 |
| 500 W Live Oak St, Hutto, TX | 500 West Live Oak Street [house]; 30.5453121,-97.5520382 | Hutto City Hall, 500, West Live Oak Street, Hutto, Williamson County, Texas, 78634, United States; 30.5453121,-97.5520382 | 987/775 |
| 200 E Liberty Ave, Round Rock, TX 78664 | 200 East Liberty Avenue [house]; 30.5104255,-97.6780521 | Round Rock Public Library, 200, East Liberty Avenue, Round Rock, Williamson County, Texas, 78664, United States; 30.5104255,-97.6780521 | 1173/667 |
| 425 S Parkwest Dr, Cedar Park, TX 78613 | 425 South Parkwest Drive [house]; 30.5050369,-97.8227266 | Cedar Park Public Library, 425, South Parkwest Drive, Cedar Park, Williamson County, Texas, 78613, United States; 30.5050369,-97.8227266 | 1367/445 |
| 105 N Brushy St, Leander, TX 78641 | 105 North Brushy Street [house]; 30.5787755,-97.8546515 | City Hall, 105, North Brushy Street, Leander, Williamson County, Texas, 78641, United States; 30.5787755,-97.8546515 | 1131/422 |
| 100 E Main St, Pflugerville, TX 78660 | 100 East Main street [house]; 30.440994,-97.619908 | Pflugerville City Hall, 100, Main Street East, Old Town, Pflugerville, Travis County, Texas, 78660, United States; 30.4408898,-97.6201335 | 1172/2278 |
| 162 Danish | empty | 162, Danish Drive, Williamson County, Texas, 78634, United States; 30.5107550,-97.5865270 | 1688/972 |
| Danish Dr, Hutto, TX | Danish Drive [street]; 30.5100854,-97.5856193 | empty | 1818/704 |
| 999999 Danish Dr, Hutto, TX 78634 | empty | empty | 869/522 |
| 123 Imaginary Unicorn Lane, Hutto, TX 78634 | empty | empty | 899/3258 |
| 1600 Pennsylvania Ave NW, Washington, DC | 1600 Pennsylvania Avenue Northwest [house]; 38.8976387,-77.0365525 | White House, 1600, Pennsylvania Avenue Northwest, Ward 2, Washington, District of Columbia, 20500, United States; 38.8976387,-77.0365525 | 744/795 |

Both fake inputs returned empty from both providers. Road-only `Danish Dr,Hutto,TX` returns a Photon street lacking house number; it must never be represented as a verified property. Partial `162 Danish` unexpectedly resolves the correct Nominatim house despite full locality failing. Out-of-area Washington DC resolves despite Austin bias: bias is not a service-area boundary.

photon: median 1075ms; min 744ms; max 1818ms (15 single samples, not a load test).
nominatim: median 704ms; min 422ms; max 3258ms (15 single samples, not a load test).

## Minimal recommendation

1. Retain typed input and permit final resolution even when suggestions are empty. Empty suggestions are not proof of invalidity.
2. Keep house number, street, ZIP, returned feature granularity and provider provenance until validation. A road/town or conflicting house number cannot silently become the selected property. Photon type=house alone is insufficient: POIs without a housenumber can also carry that type.
3. Use one structured explicit search for parseable house/street/state/ZIP, omitting city where a missing OSM locality would prevent recovery, then require matching house and normalized street plus ZIP before offering a candidate. Reject an explicitly conflicting returned city or state. Jim demonstrates why this can recover a valid property. Do not repeatedly relax into an unrelated result.
4. Preserve a staff-reviewed coordinate/manual pin recovery path for provider outages and remaining coverage gaps. Reuse persisted selected coordinates instead of repeatedly geocoding known properties. No public geocoder can guarantee every real address.
5. Public Nominatim needs shared application-wide rate control, cache, attribution, identifying headers and user-triggered final search only. Existing per-browser fetch/sessionStorage cannot enforce aggregate <= 1 request/sec; background LeadWarmup is also not an explicit user search. A small server endpoint with bounded requests and cache is the appropriate place for fallback. Public Photon is a best-effort demo; do not promise availability.

No additional commercial provider is necessary to demonstrate this repair. Both current providers consume OSM data, so cascading them is not independent coverage. If production volume requires a commercial service, evaluate an explicitly chosen provider and licensing separately; no signup, purchase or vendor guarantee was made.

## Official evidence

- [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/): maximum 1 request/sec across application users; valid identifying UA/Referer; no autocomplete; cache single-thread one-time tasks; switchable service; avoid personal/confidential data.
- [Photon project](https://github.com/komoot/photon#demo-server): public demo reasonable usage only; throttling/bans possible; no availability guarantee.
- [Hutto official contact address](https://www.huttotx.gov/portal):500 W Live Oak Street.
- [Round Rock official library history](https://www.roundrocktexas.gov/city-departments/library-home/about-us/):200 E Liberty Avenue; January 2023 opening.
- [Cedar Park official library](https://www.cedarparktexas.gov/159/Library):425 South Parkwest Drive.

Raw cached responses and exact request URLs: `tests/address-reliability/provider-results.json`. Re-run script only intentionally; successful cached requests are reused, and cached 403/429 prevents further requests to that provider.

## Implementation follow-up

The final resolver now uses one structured Nominatim call for parseable street+ZIP inputs, rather than making an extra relaxed query. Verified separately with `street=162 Danish Dr&postalcode=78634&state=TX&addressdetails=1&countrycodes=us&limit=1`: house 162, road Danish Drive, ZIP 78634, no city, coordinates 30.510755,-97.586527; HTTP 200, observed wall time 437 ms including curl startup. This additional structured request follows the 30 cached benchmark requests; the original benchmark table remains unchanged.

Result metadata retains house/street/ZIP/provider and address versus approximate precision. Final results must match supplied house, normalized street, supplied ZIP, and any explicit returned city; roads cannot replace numbered addresses. Photon and final searches have bounded abort signals, caller cancellation stops fallback, and a versioned finite cache rejects invalid/legacy coordinates. The final resolver uses one Nominatim call plus at most one Photon call, with a 6.5 s total budget and 3.5 s provider budget. The page's final-search queue spaces starts by 1.1 s. It is explicitly **not an application-wide multi-user limiter**. A shared production limiter or different hosted provider remains necessary if aggregate traffic cannot stay within the public-service policy. No autocomplete was added to Nominatim.

Verification: 13 offline behavioral tests passed, including comma-free complete addresses, prefix/suffix directions, wrong house/street/ZIP/city/state/country, malformed JSON, finite provider timeout, cancellation before fallback and while queued, cache validation/bounds, and final-resolver replay using nine original live Photon positive fixtures. TypeScript and scoped ESLint passed. These tests replace only HTTP/storage boundaries; the resolver and validation code run unchanged. Original benchmark responses have no Nominatim addressdetails, so the positive final-resolver replays explicitly use an empty Nominatim response followed by the original Photon response; they do not invent unseen Nominatim fields.

## Browser and policy boundaries

The one-primary-query change addresses the locality gap; it does not remove public-provider throttling or establish universal address coverage. A successful curl request does not reproduce a browser request from production: origin/referrer, CORS response headers, IP rate limits and provider availability can differ. A browser network error must therefore lead to the coordinate/manual confirmation recovery path rather than a guessed property. The structured request has the same one-request count as the previous primary final search and Nominatim remains excluded from autocomplete and background warmup.

The site sets `Referrer-Policy: strict-origin-when-cross-origin`, so ordinary browser requests identify the website origin to the provider. It does not set a custom User-Agent, which browsers control. Local command-line benchmark requests use their own descriptive User-Agent. Nominatim policy restricts aggregate application traffic to at most one request/sec, requires attribution and identifying Referer/User-Agent, requests caching, and prohibits autocomplete. The client page queue provides spacing within a page only; multiple tabs/users still require deployment-level traffic control if their combined traffic exceeds that limit. The benchmark's HTTP200 results neither prove production CORS success nor disprove the reported HTTP429.

Refined precision rule: garbled/non-number final queries that happen to produce fuzzy house candidates remain approximate and require confirmation; they cannot acquire property confidence from the provider's feature alone. A genuinely numbered but mismatched street is rejected. Explicit suggestion selection can still present the full returned address. Empty/null/non-finite provider coordinates are rejected. No provider result is a parcel-boundary or surveyed-rooftop guarantee.

Final review also rejects a numbered street with additional conflicting road text instead of truncating it to an earlier matching suffix. The parser remains intentionally limited; unusual street forms without punctuation can require explicit map confirmation. Final 13-test rerun, TypeScript, scoped ESLint and diff whitespace checks passed after these precision changes.
