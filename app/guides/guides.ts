// Seasonal lawn care articles at /guides. Facts follow Texas A&M AgriLife guidance;
// each guide lists its sources, so check them before changing a number.
export interface GuideSection {
  heading: string
  paragraphs: string[]
  list?: string[]
}

export interface Guide {
  slug: string
  title: string
  // Meta description and the summary on the index page
  description: string
  // ISO dates
  published: string
  updated: string
  sections: GuideSection[]
  sources: { label: string; url: string }[]
}

export const GUIDES: Guide[] = [
  {
    slug: 'when-to-start-mowing-austin',
    title: 'When to start mowing in Austin',
    description: 'When Austin lawns wake up in spring, how short to cut each grass type, and why the first mow of the year should never be a scalp.',
    published: '2026-11-18',
    updated: '2026-11-18',
    sections: [
      {
        heading: 'The short answer',
        paragraphs: [
          'Start mowing when your grass is green and actively growing, not on a set date. Texas A&M AgriLife\'s advice is to begin a regular mowing schedule as soon as the lawn greens up in spring.',
          'In the Austin area, St. Augustine usually needs its first real mow sometime in April. A warm March can move that earlier and a late cold snap can push it back, so watch the lawn rather than the calendar.',
          'Weeds often wake up first. If the only thing growing in March is clover, henbit or ryegrass, cutting it back is fine, but it isn\'t a sign the lawn itself is ready.',
        ],
      },
      {
        heading: 'How to tell your lawn is ready',
        paragraphs: ['Your lawn is ready for its first mow when:'],
        list: [
          'New green blades are showing through the brown, not just at the edges of beds and sidewalks',
          'The grass, not the weeds, is growing past your mowing height',
          'The hard freezes are behind you',
        ],
      },
      {
        heading: 'How short to cut each grass',
        paragraphs: ['Mowing height matters more than most people think. These ranges come from AgriLife guidance for Texas lawns:'],
        list: [
          'St. Augustine: 2.5 to 4 inches. In Austin, the higher end helps it handle shade and summer heat.',
          'Common Bermuda: 1 to 2 inches',
          'Zoysia: 1 to 2 inches',
          'Buffalograss: 2 to 3 inches',
        ],
      },
      {
        heading: 'The one-third rule',
        paragraphs: [
          'Never take off more than about a third of the blade in one mow. If you keep St. Augustine at 3 inches, mow it before it passes about 4½ inches. Cutting off more than that stresses the grass and leaves the lawn looking brown for a few days.',
          'That\'s why spring usually means mowing every week. Austin lawns grow fastest in April and May, and skipping a week can mean taking off half the blade to catch up.',
        ],
      },
      {
        heading: 'Should you scalp your lawn in spring?',
        paragraphs: [
          'Not if it\'s St. Augustine. It spreads by runners that lie along the surface of the soil, and scalping cuts into them. A scalped St. Augustine lawn is slow to recover and leaves room for weeds.',
          'Bermuda handles a lower cut, and some homeowners lower it once in spring to clear out last year\'s brown growth. If you do, wait until the lawn has started greening up, and bag or rake up what you cut.',
        ],
      },
      {
        heading: 'Before the first mow',
        paragraphs: ['A little prep makes the first mow of the year go better:'],
        list: [
          'Pick up sticks, pinecones and oak debris that came down over winter',
          'Sharpen or replace your mower blade. A dull blade tears the grass instead of cutting it.',
          'Run your sprinklers once to check for broken heads before the dry months',
        ],
      },
    ],
    sources: [
      { label: 'Texas A&M AgriLife: Maintaining St. Augustinegrass lawns', url: 'https://williamson.agrilife.org/files/2014/10/Maitaining-St-Augustine.pdf' },
      { label: 'Texas A&M AgriLife: Lawn maintenance guide', url: 'https://agrilifeextension.tamu.edu/wp-content/uploads/2025/06/Lawn-Maintenance-Guide-1.pdf' },
      { label: 'Texas A&M AgriLife: Bermudagrass home lawn management calendar', url: 'https://agrilifeextension.tamu.edu/library/landscaping/bermudagrass-home-lawn-management-calendar' },
    ],
  },
  {
    slug: 'pre-emergent-timing-austin',
    title: 'When to put down pre-emergent in Austin',
    description: 'Pre-emergent only works if it goes down before weed seeds sprout. Here\'s how to time it in Austin using soil temperature, not the calendar.',
    published: '2026-11-18',
    updated: '2026-11-18',
    sections: [
      {
        heading: 'What pre-emergent does (and doesn\'t do)',
        paragraphs: [
          'Pre-emergent herbicide stops weed seeds from taking root as they sprout. It doesn\'t kill weeds that are already growing, so if you can already see crabgrass, you\'re too late for that batch.',
          'That makes timing everything. Put it down too early and it can wear off before the weeds sprout. Put it down too late and the weeds are already up.',
        ],
      },
      {
        heading: 'The spring trigger: 55°F soil',
        paragraphs: [
          'Texas A&M AgriLife recommends the spring application once the soil stays around 55°F for several days in a row. That\'s when crabgrass and other summer weeds start to sprout.',
          'In Central Texas that often lands in late February or March, but AgriLife notes it can shift by several weeks from one year to the next. Measuring beats guessing.',
        ],
      },
      {
        heading: 'How to check soil temperature',
        paragraphs: ['You don\'t need special equipment:'],
        list: [
          'Push a soil thermometer (or a kitchen thermometer) about 2 inches into the lawn',
          'Check in the morning, when the soil is coolest',
          'Wait until it reads around 55°F for several days in a row, not just after one warm afternoon',
        ],
      },
      {
        heading: 'Don\'t forget the fall application',
        paragraphs: [
          'Winter weeds like henbit and annual bluegrass sprout in fall. AgriLife times that second application for when the soil cools to about 70°F, usually in early fall. Many of the weeds you see in March sprouted the previous fall.',
        ],
      },
      {
        heading: 'Tips that save you a redo',
        paragraphs: [],
        list: [
          'Follow the label. Most products need to be watered in to work.',
          'Don\'t use it where you plan to seed, sod or plug new grass. Many pre-emergents keep new grass from rooting too.',
          'Be careful with "weed and feed" products in early spring. Fertilizer that goes down before the grass is actively growing mostly feeds the weeds. AgriLife recommends waiting until after you\'ve mowed the grass twice.',
        ],
      },
      {
        heading: 'The best weed control is a thick lawn',
        paragraphs: [
          'Grass mowed at the right height shades the soil, and weed seeds need light to sprout. Mowing St. Augustine too short is a common reason Austin lawns fill with weeds by June.',
        ],
      },
    ],
    sources: [
      { label: 'Texas A&M AgriLife: Preemergence herbicides for warm-season turfgrass lawns', url: 'https://extension.scsc.tamu.edu/weeds/wp-content/uploads/sites/31/2025/02/Preemergence-Herbicides-for-Warm-Season-Turfgrass-Lawns.pdf' },
      { label: 'Texas A&M AgriLife: Preemergence herbicide guide', url: 'https://aggieturf.tamu.edu/wp-content/uploads/sites/24/Preemergence-Herbicide-Guide-4.pdf' },
      { label: 'Texas A&M AgriLife: Fertilizing Texas lawns', url: 'https://agrilifeextension.tamu.edu/wp-content/uploads/2025/06/Fertilizing-Texas-Lawns.pdf' },
    ],
  },
  {
    slug: 'st-augustine-spring-care-austin',
    title: 'Spring care for St. Augustine lawns in Austin',
    description: 'How to mow, feed and water St. Augustine in an Austin spring, plus the two problems to watch for before summer.',
    published: '2026-11-18',
    updated: '2026-11-18',
    sections: [
      {
        heading: 'Why so many Austin lawns are St. Augustine',
        paragraphs: [
          'St. Augustine handles shade better than most warm-season grasses, which makes it the default in neighborhoods with big oaks and pecans. It also needs more water and a little more care than Bermuda or Zoysia, and spring is when that care counts.',
        ],
      },
      {
        heading: 'Mow high, and never scalp',
        paragraphs: [
          'AgriLife recommends keeping St. Augustine between 2.5 and 4 inches. Most Austin yards do best around 3 to 4 inches, and shady areas do better at the top of that range.',
          'Start mowing once the lawn is green and actively growing, usually in April, and mow often enough that you never take off more than a third of the blade. Don\'t scalp it to "wake it up". St. Augustine spreads by runners on the surface, and scalping damages them.',
        ],
      },
      {
        heading: 'Feed it after it\'s growing, not before',
        paragraphs: [
          'AgriLife\'s guidance is to make the first fertilizer application after the second mowing of the grass, not the weeds. Before that the grass can\'t use the nitrogen, and the weeds can. For most Austin lawns, that pushes the first feeding to late April or May.',
        ],
      },
      {
        heading: 'Water deeply, on your schedule',
        paragraphs: [
          'Water less often and more deeply rather than a little every day. Deep watering pushes roots down, which helps the lawn make it through July and August.',
          'Austin\'s watering rules change with drought conditions, so check which days and hours apply to your address on the City of Austin\'s Find Your Watering Day page before you set your sprinkler timer for the season.',
        ],
      },
      {
        heading: 'Two problems to watch for',
        paragraphs: [],
        list: [
          'Large patch, often called brown patch: circles of yellow-brown grass that spread during cool, wet weather in spring and fall. Avoid watering in the evening, and hold off on heavy fertilizer while the weather is cool.',
          'Chinch bugs: yellowing, then browning patches in the hottest, sunniest parts of the lawn, often along driveways and sidewalks, that don\'t green up when you water. They show up as the weather heats up in late spring and summer.',
        ],
      },
      {
        heading: 'Thin spots under trees',
        paragraphs: [
          'Even St. Augustine needs a few hours of sun a day. If the lawn is thinning under a tree, raise the mowing height, ease off the fertilizer there, and consider having the tree thinned to let more light through. Mowing shorter only makes thin spots worse.',
        ],
      },
    ],
    sources: [
      { label: 'Texas A&M AgriLife: Maintaining St. Augustinegrass lawns', url: 'https://williamson.agrilife.org/files/2014/10/Maitaining-St-Augustine.pdf' },
      { label: 'Texas A&M AgriLife: St. Augustinegrass home lawn guide', url: 'https://hardin.agrilife.org/files/2021/02/StAugustine-Home-Lawn-Guide.pdf' },
      { label: 'Texas A&M AgriLife: Fertilizing Texas lawns', url: 'https://agrilifeextension.tamu.edu/wp-content/uploads/2025/06/Fertilizing-Texas-Lawns.pdf' },
      { label: 'City of Austin: Find your watering day', url: 'https://www.austintexas.gov/department/find-your-watering-day' },
    ],
  },
]

export function guide(slug: string) {
  return GUIDES.find(g => g.slug === slug)
}
