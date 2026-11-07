import Link from 'next/link'
import { AREAS } from '@/lib/areas'
import { SERVICE_PAGES } from '@/lib/service-pages'
import styles from './Footer.module.css'

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
        <Link href="/terms">Terms</Link>
      </div>
      <div id="service-areas" className={styles.areas} role="navigation" aria-label="Service areas">
        <span className={styles.areasLabel}>Where we work</span>
        <div className={styles.areasLinks}>
          {Object.entries(AREAS).map(([slug, area]) => <Link key={slug} href={`/areas/${slug}`}>{area.name}</Link>)}
        </div>
      </div>
      <div className={styles.areas} role="navigation" aria-label="More services">
        <span className={styles.areasLabel}>More services</span>
        <div className={styles.areasLinks}>
          {SERVICE_PAGES.map(page => <Link key={page.slug} href={`/services/${page.slug}`}>{page.name}</Link>)}
        </div>
      </div>
      <div className="footer-copy">© {new Date().getFullYear()} QuietGreen · <a href="mailto:hello@quietgreen.co" style={{ color: 'inherit', textDecoration: 'none' }}>hello@quietgreen.co</a></div>
    </footer>
  )
}
