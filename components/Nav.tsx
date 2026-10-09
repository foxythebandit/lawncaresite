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
          <svg width="17" height="17" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
            <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64 0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6l-39.6 48.4C234.3 334.7 177.3 277.7 144 207.3l48.4-39.6c13.7-11.2 18.4-30 11.6-46.3l-40-96z" />
          </svg>
          <span className="nav-phone-text">(682) 352-8260</span>
        </a>
        <a href="/#map-quote" className="nav-cta">See your price</a>
      </div>
    </nav>
  )
}
