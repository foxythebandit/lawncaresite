export default function Footer() {
  return (
    <footer>
      <div className="footer-logo">
        <div className="logo-dot" style={{ background: 'var(--green-bright)' }} />
        QuietGreen
      </div>
      <div className="footer-links">
        <a href="#how">Services</a>
        <a href="#map-quote">Pricing</a>
        <a href="#faq">Service areas</a>
        <a href="mailto:hello@quietgreen.co">Contact</a>
        <a href="#faq">Privacy</a>
      </div>
      <div className="footer-copy">© {new Date().getFullYear()} QuietGreen · <a href="mailto:hello@quietgreen.co" style={{ color: 'inherit', textDecoration: 'none' }}>hello@quietgreen.co</a></div>
    </footer>
  )
}
