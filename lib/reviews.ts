// Google reviews, shared by the Reviews section and the trust-strip ticker.
// `short` must stay a word-for-word excerpt of `text` — it's quoted on the site.
export type Review = {
  text: string
  short: string
  initials: string
  name: string
  loc: string
  avatarBg: string
}

export const REVIEWS: Review[] = [
  {
    text: '"Finally a lawn service that doesn\'t wake up the whole street. Showed up on time, did a great job, and actually cleaned up after himself. The electric equipment is noticeably quieter — my dog didn\'t even bark. Booking again for next month."',
    short: 'Finally a lawn service that doesn\'t wake up the whole street.',
    initials: 'JG',
    name: 'Jordan Guild',
    loc: 'Google Review',
    avatarBg: 'var(--green-mid)',
  },
  {
    text: '"Quiet Green really stands out when it comes to lawn care service. I\'ve tried many different lawn services over the years but Quiet Green delivered the best mowing by far. Their crew was super friendly and they use electric mowers — I\'m happy and so is the environment. I will 100% continue to use Quiet Green."',
    short: 'Quiet Green delivered the best mowing by far.',
    initials: 'JB',
    name: 'Jeremy Burris',
    loc: 'Google Review',
    avatarBg: 'var(--green-bright)',
  },
  {
    text: '"Quiet Green goes above and beyond. They have truly done an amazing job with my home\'s landscape. If you are looking for a great company, you found it here! On time, honest, and reasonably priced."',
    short: 'On time, honest, and reasonably priced.',
    initials: 'KC',
    name: 'Keagen Crawford',
    loc: 'Google Review',
    avatarBg: '#2d6a4f',
  },
  {
    text: '"Amazing service! Paxton took care of our lawn and did a great job mowing. He was professional, easy to work with, showed up on time, and left everything looking clean and well taken care of. Would definitely recommend him to anyone needing lawn care!!"',
    short: 'Amazing service!',
    initials: 'C',
    name: 'Caelan',
    loc: 'Google Review',
    avatarBg: '#52b788',
  },
  {
    text: '"Paxton provided outstanding service from start to finish. He was professional, friendly, attentive, and made sure everything was handled efficiently. It\'s clear he genuinely cares about his customers and takes pride in his work. Highly recommend working with Paxton!"',
    short: 'Paxton provided outstanding service from start to finish.',
    initials: 'JP',
    name: 'Joah Pinkston',
    loc: 'Google Review',
    avatarBg: 'var(--green-deep)',
  },
  {
    text: '"They\'ve been taking care of our yard for a few weeks now, and it always surprises me how clean and quiet the service is!! Our yard stays looking great, and we never have any complaints about the noise. Thanks guys!"',
    short: 'It always surprises me how clean and quiet the service is!!',
    initials: 'AL',
    name: 'Andre Lacy',
    loc: 'Google Review',
    avatarBg: '#40916c',
  },
  {
    text: '"Incredible ideal — incredible job!"',
    short: 'Incredible ideal — incredible job!',
    initials: 'AC',
    name: 'Asher Chrane',
    loc: 'Google Review',
    avatarBg: '#52b788',
  },
  {
    text: '"Paxton always does good work."',
    short: 'Paxton always does good work.',
    initials: 'TW',
    name: 'Taylor Waddell',
    loc: 'Google Review',
    avatarBg: '#1b4332',
  },
]
