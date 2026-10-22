import Link from "next/link";

export function TopBar({ crumbs = [], right }: { crumbs?: { href?: string; label: string }[]; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 21c0-6 0-9 0-12" stroke="#3f6b4a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M12 12c-4 0-7-2-7-6 4 0 7 2 7 6Z" fill="#7fa36a" />
          <path d="M12 9c3 0 6-2 6-5-3 0-6 2-6 5Z" fill="#3f6b4a" />
          <circle cx="12" cy="5" r="2" fill="#e0662b" />
        </svg>
        Native Bed Planner
      </Link>
      <nav className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 6 }}>
            <span>/</span>
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="spacer" />
      {right}
    </header>
  );
}
