import type { ServiceInquiryKind } from '@/app/actions/submit-service-inquiry'

export interface ServicePage {
  slug: string
  name: string
  // Preselected in the request form on the page
  inquiryService: ServiceInquiryKind
  tagline: string
  subheadline: string
  intro: string
  included: string[]
  faqs: { q: string; a: string }[]
}

export const SERVICE_PAGES: ServicePage[] = [
  {
    slug: 'gutter-cleaning',
    name: 'Gutter Cleaning',
    inquiryService: 'Gutter cleaning',
    tagline: 'Gutter cleaning for Austin homes',
    subheadline: 'QuietGreen clears leaves and debris from your gutters and downspouts so rain goes where it should. Tell us about your home and we\'ll call with a quote.',
    intro: 'Oak leaves, pollen and seed pods fill Austin gutters fast, and a clogged gutter can overflow into beds, siding and foundations during the next storm. QuietGreen cleans gutters by hand, flushes the downspouts, and bags the debris so nothing is left on your lawn.',
    included: ['Gutters cleared by hand', 'Downspouts checked and flushed', 'Debris bagged and hauled off', 'Roofline and yard left clean'],
    faqs: [
      { q: 'How often should gutters be cleaned in Austin?', a: 'Most homes need it twice a year, in late spring after oak pollen and seed drop and again in late fall once the leaves are down. Homes under heavy tree cover may need it more often.' },
      { q: 'How is gutter cleaning priced?', a: 'It depends on the length of your gutters, how many stories the home is, and how full they are. Send us your address and a few details and we\'ll call you with a quote before any work starts.' },
      { q: 'Can you combine gutter cleaning with lawn service?', a: 'Yes. If you already have mowing with us, we can schedule gutter cleaning on the same visit. Mention it in the project details.' },
    ],
  },
  {
    slug: 'leaf-cleanup',
    name: 'Leaf Cleanup',
    inquiryService: 'Yard cleanup',
    tagline: 'Quiet leaf cleanup and yard cleanup in Austin',
    subheadline: 'QuietGreen clears leaves from your lawn, beds and hard surfaces using battery-powered blowers. No gas fumes and no early-morning roar.',
    intro: 'Leaves left on the lawn block sunlight and hold moisture, which thins St. Augustine and invites fungus. QuietGreen clears leaves and storm debris from lawns, beds, patios and driveways with quiet electric equipment, then bags and hauls it away.',
    included: ['Leaves cleared from lawn and beds', 'Patios, walkways and driveways blown clean', 'Debris bagged and hauled off', 'Quiet battery-powered blowers'],
    faqs: [
      { q: 'When is leaf season in Austin?', a: 'It comes in two waves. Most deciduous trees drop in November and December, and live oaks shed heavily in late winter and early spring. We can schedule a cleanup for each.' },
      { q: 'How is leaf cleanup priced?', a: 'It depends on the size of the property and how much has built up. Send us your address and a few details and we\'ll call you with a quote before any work starts.' },
      { q: 'Is electric equipment powerful enough for heavy leaf cover?', a: 'Yes. Commercial battery blowers handle a full fall leaf drop. They are just much quieter, so we can work without disturbing you or your neighbors.' },
    ],
  },
  {
    slug: 'garden-beds-mulch',
    name: 'Garden Beds & Mulch',
    inquiryService: 'Landscaping',
    tagline: 'Garden bed cleanup and mulch installation in Austin',
    subheadline: 'QuietGreen weeds and clears your garden beds, edges them cleanly, and lays fresh mulch. Tell us about your beds and we\'ll call with a quote.',
    intro: 'Fresh mulch keeps moisture in through Austin summers, holds back weeds, and makes the whole yard look finished. QuietGreen clears weeds and old debris from your beds, sharpens the bed edges, and installs mulch at an even depth.',
    included: ['Weeds and debris cleared from beds', 'Clean, defined bed edges', 'Fresh mulch installed at an even depth', 'Cleanup of walkways and lawn after'],
    faqs: [
      { q: 'How much mulch do my beds need?', a: 'About 3 inches is the usual target. Less lets weeds through, and much more can smother roots. We measure your beds and quote the amount needed.' },
      { q: 'How is bed cleanup and mulch priced?', a: 'It depends on the size of your beds and how overgrown they are. Mulch installation starts around $150. Send us your address and a few details and we\'ll call you with a quote.' },
      { q: 'When is the best time to mulch in Austin?', a: 'Spring, before the summer heat, is the most popular time, and a fall refresh helps protect roots through winter. Any time of year is fine for a bed cleanup.' },
    ],
  },
]

export function servicePage(slug: string): ServicePage | undefined {
  return SERVICE_PAGES.find(page => page.slug === slug)
}
