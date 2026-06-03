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
    q: "What areas do you serve?",
    a: "Drop your address into the quote builder above and it'll confirm coverage instantly. We're expanding regularly, so if you're just outside our current zone, get a quote anyway — we may be able to fit you in.",
  },
]

export default function FAQ() {
  return (
    <section className="faq" id="faq">
      <div className="section-label reveal">FAQ</div>
      <h2 className="section-h2 reveal" data-delay="80">Questions homeowners ask</h2>
      <p className="section-sub reveal" data-delay="160">Everything you need to know before booking.</p>

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
    </section>
  )
}
