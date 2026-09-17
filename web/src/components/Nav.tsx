import './Nav.css';

const LINKS = [
  { href: '#observatory', label: 'Observatory' },
  { href: '#anatomy', label: 'Anatomy' },
  { href: '#studies', label: 'Case studies' },
  { href: 'https://github.com/lkzppm/GraphMan', label: 'GitHub', external: true },
];

export default function Nav() {
  return (
    <header className="nav">
      <div className="nav__inner">
        <a className="nav__brand" href="#top" aria-label="GraphMan home">
          <img src="/brand/graphman-64.png" alt="" width={22} height={22} />
          <span>GraphMan</span>
        </a>
        <nav className="nav__links" aria-label="Sections">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noreferrer' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
