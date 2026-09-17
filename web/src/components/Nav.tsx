import { useRef, useState } from 'react';
import { Liquid } from 'liquid-gooey';
import './Nav.css';

const LINKS = [
  { href: '#observatory', label: 'Observatory' },
  { href: '#anatomy', label: 'Anatomy' },
  { href: '#studies', label: 'Case studies' },
  { href: 'https://github.com/lkzppm/GraphMan', label: 'GitHub', external: true },
];

/** Top bar with a liquid highlight that flows between links on hover. */
export default function Nav() {
  const listRef = useRef<HTMLElement>(null);
  const [blob, setBlob] = useState<{ x: number; w: number } | null>(null);

  const track = (el: HTMLElement) => {
    const list = listRef.current;
    if (!list) return;
    const a = el.getBoundingClientRect();
    const b = list.getBoundingClientRect();
    setBlob({ x: a.left - b.left, w: a.width });
  };

  return (
    <header className="nav">
      <div className="nav__inner">
        <a className="nav__brand" href="#top" aria-label="GraphMan home">
          <img src="/brand/graphman-64.png" alt="" width={22} height={22} />
          <span>GraphMan</span>
        </a>
        <nav
          ref={listRef}
          className="nav__links"
          aria-label="Sections"
          onMouseLeave={() => setBlob(null)}
        >
          <div className="nav__liquid" style={{ opacity: blob ? 1 : 0 }} aria-hidden="true">
            <Liquid
              fill="rgba(255,255,255,0.16)"
              blur={6}
              contrast={18}
              style={{ width: '100%', height: '100%' }}
            >
              <Liquid.Item effect="move" move={{ springiness: 0.7, trail: 0.45, wobble: 0.35 }}>
                <div
                  className="nav__blob"
                  style={{ transform: `translateX(${blob?.x ?? 0}px)`, width: blob?.w ?? 0 }}
                />
              </Liquid.Item>
            </Liquid>
          </div>
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noreferrer' : undefined}
              onMouseEnter={(e) => track(e.currentTarget)}
              onFocus={(e) => track(e.currentTarget)}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
