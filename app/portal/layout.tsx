export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-wrap">
      <header className="portal-header">
        <a href="/" className="portal-header-logo">
          <span className="logo-dot" />
          <span>QuietGreen</span>
        </a>
        <span className="portal-header-label">My Account</span>
      </header>
      {children}
    </div>
  )
}
