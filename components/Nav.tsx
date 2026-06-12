import Image from 'next/image'

export default function Nav() {
  return (
    <nav>
      <a href="#" className="nav-logo">
        <Image
          src="/quietgreen-logo-full.svg"
          alt="QuietGreen"
          width={160}
          height={37}
          priority
        />
      </a>
      <ul className="nav-links">
        <li><a href="#how">How it works</a></li>
        <li><a href="#why">Why electric</a></li>
        <li><a href="#reviews">Reviews</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ul>
      <a href="#map-quote" className="nav-cta">See your price</a>
    </nav>
  )
}
