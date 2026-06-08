const faqs = [
  {
    q: "What's included in every visit?",
    a: "Every service includes a full mow, crisp edging along all beds, paths, and driveways, blowing all clippings off hard surfaces, and a complete cleanup before we leave. There are no half-measures — the yard looks finished, not just cut.",
  },
  {
    q: "Do I need to be home when you come?",
    a: "No — we handle everything outside. You'll get a text when we're on our way and another when we're done. If there's anything unusual about your yard (a locked gate, a dog out back), just let us know in advance.",
  },
  {
    q: "How often should I schedule service?",
    a: "Most customers go weekly in peak season (spring and summer) and bi-weekly in fall. Grass grows fast in warm months — skipping a week can double the work and affect cut quality. We price weekly visits lower per cut to make it easy to stay on schedule.",
  },
  {
    q: "What if it rains on my scheduled day?",
    a: "We'll reschedule to the next available slot and let you know the day before or the morning of. Wet grass doesn't cut cleanly and compacts easily, so we don't force it — your lawn quality matters more than sticking to a calendar.",
  },
  {
    q: "Does battery-powered equipment cut as well as gas?",
    a: "Yes. Commercial battery mowers produce the same torque as gas and handle thick, overgrown grass without bogging down. The only things missing are the exhaust fumes and the noise. Our edgers and blowers are all-electric too — the entire visit is zero emissions.",
  },
  {
    q: "Are there any contracts or commitments?",
    a: "None. No sign-up fees, no cancellation penalties, no annual contracts. You can pause, adjust your schedule, or cancel anytime — just give us a heads-up before your next visit.",
  },
  {
    q: "What areas of Austin do you serve?",
    a: "We currently serve South Austin, East Austin, North Austin, Cedar Park, Round Rock, and Pflugerville. Drop your address into the quote builder to confirm coverage instantly — we're expanding regularly.",
  },
  {
    q: "How often should I mow in Austin's heat?",
    a: "Weekly in spring and early summer when grass grows fastest — Austin lawns can put on an inch a week in April and May. Bi-weekly works well in fall once growth slows. During the peak summer heat (July–August), grass often goes semi-dormant and bi-weekly is usually fine. We'll tell you if we think your schedule needs adjusting.",
  },
  {
    q: "Can you handle overgrown lawns?",
    a: "Yes. If your lawn has gotten away from you, we add a small first-cut cleanup fee to account for the extra time and blade wear. That fee goes away on every visit after the first. We'll never refuse a yard just because it's overgrown — that's when you need us most.",
  },
  {
    q: "Is electric equipment powerful enough for Texas grass?",
    a: "Absolutely. St. Augustine, Bermuda, and Zoysia — the grasses most Austin lawns have — respond great to battery-powered mowers. Commercial electric mowers deliver the same torque as gas and handle thick Texas turf without bogging down. The difference is you won't smell exhaust or wake up your neighbors.",
  },
]

export default function FAQ() {
  return (
    <section className="faq" id="faq">
      <div className="faq-grid">
        <div className="faq-heading-col">
          <div className="section-label reveal">FAQ</div>
          <h2 className="section-h2 reveal" data-delay="80">Questions homeowners ask</h2>
          <p className="section-sub reveal" style={{ textAlign: 'left', maxWidth: 300, marginTop: 16 }} data-delay="160">
            Everything you need to know before booking.
          </p>
        </div>

        <div className="faq-list reveal" data-delay="240">
          {faqs.map((item, i) => (
            <details key={i} className="faq-item">
              <summary className="faq-q">
                <span>{item.q}</span>
                <svg className="faq-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </summary>
              <p className="faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
