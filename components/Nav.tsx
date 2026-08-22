import Image from 'next/image'

export default function Nav() {
  return (
    <nav>
      <a href="/" className="nav-logo">
        <Image
          src="/quietgreen-logo-full.svg"
          alt="QuietGreen"
          width={160}
          height={37}
          priority
        />
      </a>
      <ul className="nav-links">
        <li><a href="/#how">How it works</a></li>
        <li><a href="/#why">Why electric</a></li>
        <li><a href="/#reviews">Reviews</a></li>
        <li><a href="/#faq">FAQ</a></li>
      </ul>
      <div className="nav-actions">
        <a href="tel:+16823528260" className="nav-phone" aria-label="Call (682) 352-8260">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span className="nav-phone-text">(682) 352-8260</span>
        </a>
        <a href="/#map-quote" className="nav-cta">See your price</a>
      </div>
    </nav>
  )
}
