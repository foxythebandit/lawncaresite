export default function Nav() {
  return (
    <nav>
      <a href="#" className="nav-logo">
        <div className="logo-dot" />
        QuietGreen
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
