export default function Footer() {
  return (
    <footer>
      <div className="footer-logo">
        <div className="logo-dot" style={{ background: 'var(--green-bright)' }} />
        QuietGreen
      </div>
      <div className="footer-links">
        <a href="#">Services</a>
        <a href="#">Pricing</a>
        <a href="#">Service areas</a>
        <a href="#">Contact</a>
        <a href="#">Privacy</a>
      </div>
      <div className="footer-copy">© {new Date().getFullYear()} QuietGreen. All rights reserved.</div>
    </footer>
  )
}
