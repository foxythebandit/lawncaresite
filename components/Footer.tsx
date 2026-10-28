import Link from 'next/link'
import styles from './Footer.module.css'

const AREAS = [
  { name: 'South Austin', slug: 'south-austin' },
  { name: 'East Austin', slug: 'east-austin' },
  { name: 'North Austin', slug: 'north-austin' },
  { name: 'Cedar Park', slug: 'cedar-park' },
  { name: 'Round Rock', slug: 'round-rock' },
  { name: 'Pflugerville', slug: 'pflugerville' },
]

export default function Footer() {
  return (
    <footer>
      <div className="footer-logo">
        <div className="logo-dot" style={{ background: 'var(--green-bright)' }} />
        QuietGreen
      </div>
      <div className="footer-links">
        <Link href="/#how">Services</Link>
        <Link href="/#map-quote">Pricing</Link>
        <a href="#service-areas">Service areas</a>
        <a href="mailto:hello@quietgreen.co">Contact</a>
        <Link href="/privacy">Privacy</Link>
      </div>
      <div id="service-areas" className={styles.areas} role="navigation" aria-label="Service areas">
        <span className={styles.areasLabel}>Where we work</span>
        <div className={styles.areasLinks}>
          {AREAS.map(area => <Link key={area.slug} href={`/areas/${area.slug}`}>{area.name}</Link>)}
        </div>
      </div>
      <div className="footer-copy">© {new Date().getFullYear()} QuietGreen · <a href="mailto:hello@quietgreen.co" style={{ color: 'inherit', textDecoration: 'none' }}>hello@quietgreen.co</a></div>
    </footer>
  )
}
