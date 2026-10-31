# Research: Meta ad names and ConviFlo answer labels (PLAN.md A1, A2)

Collected 28 Oct 2026. Meta ad list from Caelan (Ads Manager, Quiet Green ad account `2240549216693180`). ConviFlo was read from each form's builder (app.conviflo.com) with Caelan signed in. Read only: no ad, form or setting was changed.

Build agent: tables 1 and 2 are the source for the CRM's name and label mapping tables. Section 4 lists what is still unverified.

## 1. Meta ads

Ad account `2240549216693180` has two campaigns:

| Campaign | Campaign ID | State |
|---|---|---|
| QuietGreen \| Leads \| AI vs Real \| LAUNCH REVIEW | `120253769117350725` (from `formatAttributionLabel` in `lib/attribution.ts`; not re-read in Ads Manager) | Active, 12 ads |
| 2026 - 101 | not collected | Off. Draft "New Leads Ad" per `docs/crm-revamp/CONVIFLO-META-SETUP.md`; never delivered |

Paxton's personal account `2096962487924428` had no campaigns or ads on 23 Oct (same doc). It was not re-checked.

All 12 ads below are in the LAUNCH REVIEW campaign. Ad set IDs and URL parameters were not collected. The ad set name is shortened here: "A" is "A | AI | 3 Videos + 3 Images | REVIEW" and "B" is "B | Real People | 3 Videos + 3 Images | REVIEW".

| Ad ID | Code | Name | Ad set | Creative | Full ad name in Meta |
|---|---|---|---|---|---|
| `120253769117370725` | AI-V01 | Everybody Loves Dave | A (AI) | Video | AI-V01 \| Everybody Loves Dave \| REVIEW |
| `120253769229100725` | AI-V02 | I Married That Guy | A (AI) | Video | AI-V02 \| I Married That Guy \| REVIEW |
| `120253769229110725` | AI-V03 | Youre Welcome | A (AI) | Video | AI-V03 \| Youre Welcome \| REVIEW |
| `120253769229120725` | AI-I01 | Electric Mowing | A (AI) | Image | AI-I01 \| Electric Mowing \| REVIEW |
| `120253769229130725` | AI-I02 | Split Yard | A (AI) | Image | AI-I02 \| Split Yard \| REVIEW |
| `120253769229140725` | AI-I03 | Weekend Back | A (AI) | Image | AI-I03 \| Weekend Back \| REVIEW |
| `120253769297420725` | REAL-V01 | Night Mowing | B (Real People) | Video | REAL-V01 \| Night Mowing \| REVIEW |
| `120253769297460725` | REAL-V02 | Testimonial | B (Real People) | Video | REAL-V02 \| Testimonial \| REVIEW |
| `120253769297470725` | REAL-V03 | Leaf Cleanup | B (Real People) | Video | REAL-V03 \| Leaf Cleanup \| REVIEW |
| `120253769297440725` | REAL-I01 | Alarm Clock | B (Real People) | Image | REAL-I01 \| Alarm Clock \| REVIEW |
| `120253769297430725` | REAL-I02 | Cleaner Cut | B (Real People) | Image | REAL-I02 \| Cleaner Cut \| REVIEW |
| `120253769297480725` | REAL-I03 | Before and After | B (Real People) | Image | REAL-I03 \| Before and After \| REVIEW |

**How this compares with `launchAds` in `lib/attribution.ts`:**
- All 12 ad IDs match.
- All 12 names match.
- Group, format and creative type agree.
- No ad is missing from the code, and the code has no extra ads.

The differences are only in wording:
- **Codes:** Meta's ad names carry short codes (AI-V01 … REAL-I03). The code doesn't store them. They're useful as a compact label.
- **Image wording:** the code says "Still image"; Meta says "Image".
- **"REVIEW" suffix:** it's a launch-stage tag in Meta's name, not part of the creative name. Leave it out of the label.

So today every lead from these 12 ads can already get a name. An ad shows as raw IDs only when it isn't one of these 12. That covers website leads carrying a Google or other `utm_*` tag, and any future or duplicated Meta ad.

## 2. ConviFlo forms

The forms list shows 6 live forms and 1 draft. Caelan confirmed that the forms with "|" in the name are the real ones.

| In use? | Form | Form ID | Public link | Responses (forms list, 28 Oct) | Webhook to CRM (23 Oct doc) |
|---|---|---|---|---|---|
| ✅ **In use** | QuietGreen \| Mowing \| Review draft | `ae7c0184-fa95-40d4-8b74-cd8578083470` | conviflo.com/f/yhttwh8p | 3 | Yes |
| ✅ **In use** | QuietGreen \| Leaves & Gutters \| Review draft | `b521838c-6883-46d3-9e07-22a78a374ab4` | not read | 2 | Yes |
| ⚪ Unused, but still wired | landing page | `05212679-7c8d-4034-9a43-53b48a336548` | conviflo.com/f/landing-page (+ `--e2`, `--e3`) | 1 | Yes. Older leads came from here |
| ⚪ Unused | Fall cleanup bundle | `b4ebde94-fe0f-4b37-ae6b-481d7c3f4603` | | 0 | No |
| ⚪ Unused | Leaf cleanup | `eb8747cb-25fe-42ee-85e5-50a153c9b333` | | 0 | No |
| ⚪ Unused | Gutter cleanout | `6c79d6ed-a2ea-4f65-9322-dcc7b78fd4c7` | | 0 | No |
| ⚪ Draft (test) | TEST ONLY — QuietGreen CRM connection | `925f7fdc-70c1-4221-955d-c14f75d67ddc` | | 3 | not checked |

The CRM only accepts form IDs listed in `CONVIFLO_FORMS`, which holds the first three forms above. Leads from the three unused live forms would be rejected.

### Answer values

**Field key** is the answer's name in the webhook (`answers.<key>`). **Answer slug** is the option label run through the slug rule `convifloIntake` uses for matching: lowercase, every non-alphanumeric run becomes `_`, then trim the outer `_`. Use the slug as the lookup key and the option label as the readable label.

#### 2a. QuietGreen | Mowing | Review draft (in use)

| Field key | Question | Answer label → slug |
|---|---|---|
| `mowing_frequency` | One-time mowing or ongoing help? | One-time mowing → `one_time_mowing` · Ongoing mowing → `ongoing_mowing` · Not sure yet → `not_sure_yet` |
| `yard_size` | How big is your property? | Under 1/4 acre → `under_1_4_acre` · 1/4 – 1/2 acre → `1_4_1_2_acre` · 1/2 – 1 acre → `1_2_1_acre` · 1+ acres → `1_acres` · I'm not sure → `i_m_not_sure` |
| `urgency` | How soon do you need it? | ASAP → `asap` · This week → `this_week` · Next 1-2 weeks → `next_1_2_weeks` · Just checking prices → `just_checking_prices` |
| `lawn_condition` | How is the lawn looking? | Just needs a regular mow → `just_needs_a_regular_mow` · A little overgrown → `a_little_overgrown` · Very overgrown → `very_overgrown` · Not sure yet → `not_sure_yet` |
| `postcode` | What's the property's ZIP code? | free text (ZIP) |
| `property_address` | Where do you need mowing? | structured: `street`, `unit`, `city` |
| `contact` | Get your mowing quote | contact block. The CRM reads `name` and `phone` (and `email` if present) from `answers`; see section 4 |

The entry opener is "What would quiet lawn care cost you?". It's a lander with no answer options, and its field key was not read.

#### 2b. QuietGreen | Leaves & Gutters | Review draft (in use)

| Field key | Question | Answer label → slug |
|---|---|---|
| `cleanup_service` | What should we take care of? | Leaf cleanup → `leaf_cleanup` · Gutter cleaning → `gutter_cleaning` · Both leaves and gutters (save $30) → `both_leaves_and_gutters_save_30` ⚠️ see section 4 |
| `property_size` | How big is your property? | same five options and slugs as `yard_size` above |
| `urgency` | How soon do you need it? | same as Mowing `urgency` |
| `home_type` | What kind of home is it? | Single-story → `single_story` · Two-story → `two_story` · Three stories or a steep roof → `three_stories_or_a_steep_roof` · No gutters on my home → `no_gutters_on_my_home` · Not sure → `not_sure` |
| `postcode` | What's the property's ZIP code? | free text (ZIP) |
| `property_address` | Where do you need cleanup? | structured: `street`, `unit`, `city` |
| `contact` | Get your cleanup quote | contact block (as above) |

The entry opener was not read (same layout as Mowing).

The two forms share some keys with the same question: `urgency` in both, and `yard_size` (Mowing) / `property_size` (Leaves & Gutters).

#### 2c. landing page (unused now, but it produced the older leads)

| Field key | Question | Answer label → slug |
|---|---|---|
| `choice` | Tired of loud lawn care ruining your morning? (main opener) | Yes, it drives me crazy → `yes_it_drives_me_crazy` · Not really, I just need it done right → `not_really_i_just_need_it_done_right` |
| `opener_testimonial` | Want lawn care your neighbors rave about? (opener `--e2`) | Yes, that's what I want → `yes_that_s_what_i_want` · Just checking prices → `just_checking_prices` |
| `opener_night_mow` | Quiet enough to mow at night. Want that for your lawn? (opener `--e3`) | Yes, I want quiet lawn care → `yes_i_want_quiet_lawn_care` · Just checking prices → `just_checking_prices` |
| `choice_2` | What bothers you most about your current lawn care? | Loud equipment and gas fumes → `loud_equipment_and_gas_fumes` · No-shows and random arrival times → `no_shows_and_random_arrival_times` · Surprise bills or rising prices → `surprise_bills_or_rising_prices` · Sloppy work, missed spots, clippings left behind → `sloppy_work_missed_spots_clippings_left_behind` · I do it myself and I'm over it → `i_do_it_myself_and_i_m_over_it` |
| `choice_3` | What do you need done? | Mowing only → `mowing_only` · Mowing + Edging → `mowing_edging` · Full cleanup (mow, edge, blow) → `full_cleanup_mow_edge_blow` · Regular maintenance plan → `regular_maintenance_plan` |
| `choice_4` | How soon do you need it? | same as `urgency` |
| `choice_5` | How big is your property? | same as `yard_size` |
| `zip` | We'll confirm we service your area (What's your ZIP code?) | free text. ⚠️ The CRM reads `answers.postcode`; see section 4 |
| (blank) | Claim your free QuietGreen quote | contact block: Full name, phone, Street address, email. The CRM's `address_key` for this form is `address` |

⚠️ **Keys have shifted on this form.** PLAN.md section 5 quotes `Choice 2: mowing_edging`, but today "What do you need done?" is `choice_3` and `choice_2` is "What bothers you most". The `choice_N` keys were renumbered when a question was added. Older leads therefore use different keys for the same question. Label landing-page answers by **slug first** (the slugs don't collide across questions), and use the key only to pick the question text when the slug is unknown.

#### 2d. Unused live forms (for completeness; not in `CONVIFLO_FORMS`)

Each of these forms has an opener with key `choice`, questions `choice_2` … `choice_5`, then `zip`, a contact block, and an ending with key `question`.

- **Fall cleanup bundle**
  - `choice`: Gutters, leaves, and a messy yard? (Yes, all of it / Some of it)
  - `choice_2`: What should we take care of? (The works: gutters + leaves + yard cleanup (save $50, best value) / Gutters + leaf blowout (save $30) / Leaf blowout + yard cleanup (save $30) / Gutters + yard cleanup (save $30) / Just one service for now)
  - `choice_3`: property size (5 standard options)
  - `choice_4`: urgency (4 standard options)
  - `choice_5`: home type (same as `home_type`)
- **Leaf cleanup**
  - `choice`: Yard buried in leaves? (Yes, I can't see the grass / Not yet, but they're coming down)
  - `choice_2`: How many leaves are we talking? (A light layer / Ankle-deep in spots / The whole yard is covered / Wet, matted, and piled up / Not sure yet)
  - `choice_3`: property size
  - `choice_4`: urgency
  - `choice_5`: One-time cleanup or all fall? (One-time, bagged at the curb / One-time, hauled away / Every 2 weeks until the trees are bare / Weekly through fall / Not sure yet)
- **Gutter cleanout**
  - `choice`: Gutters overflowing or clogged with leaves? (Yes, they're a mess / Not yet, just due for a cleaning)
  - `choice_2`: What's going on with your gutters? (Overflowing when it rains / Heavy leaf buildup / Clogged downspouts / Sagging or pulling away from the house / Just routine maintenance)
  - `choice_3`: What kind of home is it? (Small single-story home / Average single-story home / Two-story home / Three stories or a steep roof / Not sure)
  - `choice_4`: urgency
  - `choice_5`: When were they last cleaned? (In the last 6 months / About a year ago / 2+ years ago / Never, as far as I know / Can't remember)

## 3. Recommendations

**A1: how ads get readable names.** Keep the ad ID → name table in code as the single source, since the ad ID is the only reliable key. For the build:
- Seed the table from section 1, adding the short code (e.g. "AI-V01 · Everybody Loves Dave · Video").
- Name every future ad in Meta as `<SET>-<V|I><NN> | <Name> | <stage>`, as the launch ads already are.
- Keep the URL parameters on every ad as `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`.
- When a new ad launches, add one row to the table.

For an ad that isn't in the table yet, the CRM should show "Facebook/Instagram ad · new ad (ID …)" rather than a row of raw IDs. With one ad set launch every few weeks, a code row is cheaper than a "name this ad" box or the Meta API.

If the code edit becomes a chore, there's an optional next step. Add a `{{ad.name}}` URL parameter, which Meta fills in automatically, and show it for unknown IDs, marked as unverified, because visitors can edit URLs.

**A2: ConviFlo answer labels.** Map them in code; don't rename keys in ConviFlo. The two in-use forms already have readable keys (`mowing_frequency`, `cleanup_service`, `urgency` …). ConviFlo also warns that renaming a key on a live form changes it for every later lead, which would split old and new leads.
- Build a per-form-ID table from section 2: field key → question text, and answer slug → option label.
- Label the landing-page form by slug, because its `choice_N` keys shifted.
- For any key or slug that isn't in the table, show it humanized (`next_1_2_weeks` → "Next 1 2 weeks") instead of the raw value, so a new question never shows up as a code.

## 4. Unverified; check against a real lead before relying on it

The two in-use forms have real responses (3 and 2), so their payloads exist in prod. Checking one lead from each during the prod data review (S8) settles all of these:

1. ⚠️ **`cleanup_service` "both" option.** The live label is "Both leaves and gutters (save $30)", so its slug is `both_leaves_and_gutters_save_30`. The `CONVIFLO_FORMS` service map (23 Oct doc) only has `both_leaves_and_gutters`. If ConviFlo sends the label slug, "both" leads fall back to the default services with `service_unmapped: true`. The fix is to add the `_save_30` slug to the map in Vercel `CONVIFLO_FORMS` (config, not code). Confirm on a real lead first.
2. **Contact block keys.** The builder shows the key `contact` (blank on the landing page). The 23 Oct doc and `convifloIntake` read `answers.name`, `answers.phone` and `answers.email`, so ConviFlo seems to send the contact fields flattened. That needs confirming from a real payload from these two forms.
3. **ZIP key on the landing page.** The builder says `zip`, but `convifloIntake` reads `answers.postcode`. The two in-use forms use `postcode`, so this matters only for old landing-page leads.
4. **Option slugs.** These were derived from labels using the code's rule. They weren't read from a payload. If an option label was edited after leads came in, older leads may carry the old slug. That's handled by the humanized fallback.
5. **Meta ad set IDs, campaign IDs and actual URL parameters** were not collected for each ad. The Ads Manager tab couldn't be read in Claude in Chrome: an extension conflict blocked it. The campaign ID above comes from code.
