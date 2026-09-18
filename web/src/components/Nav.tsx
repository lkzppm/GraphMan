'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { siGithub } from 'simple-icons';
import BrandIcon from './BrandIcon';
import Logo from './Logo';
import styles from './Nav.module.css';

const TABS = [
  { href: '/observatory', label: 'Observatory' },
  { href: '/library', label: 'Library' },
  { href: '/studies', label: 'Case studies' },
] as const;

/**
 * Sticky top bar: the wordmark is the home link, then one tab per other
 * page. A single blue indicator (pill and underline) slides to whichever
 * tab is current, Golem-style, and hides on the home page.
 */
export default function Nav() {
  const pathname = usePathname();
  const tabsRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  const activeIndex = TABS.findIndex((tab) => pathname.startsWith(tab.href));
  const home = pathname === '/';

  useLayoutEffect(() => {
    const list = tabsRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) {
        setIndicator((i) => ({ ...i, width: 0 }));
        return;
      }
      setIndicator((i) => ({ left: el.offsetLeft, width: el.offsetWidth, ready: i.ready || true }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeIndex]);

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
        <Link
          href="/"
          className={styles.brand}
          aria-label="GraphMan home"
          aria-current={home ? 'page' : undefined}
        >
          <Logo size={30} />
          <span className={`mono ${styles.wordmark}`}>
            graphman<span className="accent">.</span>
          </span>
        </Link>
        <nav ref={tabsRef} className={styles.tabs} aria-label="Pages">
          <span
            className={`${styles.indicator} ${indicator.ready ? styles.indicatorLive : ''}`}
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
            aria-hidden="true"
          />
          {TABS.map((tab, i) => {
            const active = i === activeIndex;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={active ? styles.tabActive : styles.tab}
                data-active={active ? 'true' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <a
          className={styles.github}
          href="https://github.com/lkzppm/GraphMan"
          target="_blank"
          rel="noreferrer"
          aria-label="Source on GitHub"
        >
          <BrandIcon icon={siGithub} size={18} />
          <span>GitHub</span>
        </a>
      </div>
    </header>
  );
}
