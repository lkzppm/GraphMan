'use client';

import Link from 'next/link';
import { siGithub } from 'simple-icons';
import { useT } from '@/i18n/LocaleProvider';
import BrandIcon from './BrandIcon';
import Logo from './Logo';
import Reveal from './Reveal';
import styles from './Footer.module.css';

/** LinkedIn's glyph: simple-icons no longer ships it, so the path lives here. */
const LINKEDIN = {
  title: 'LinkedIn',
  path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
};

/* The footer as a small graph: one edge runs across the top and each
   column is a vertex on it (the column's heading hangs from its vertex).
   A column's vertex turns blue while it is hovered. */
export default function Footer() {
  const t = useT();
  return (
    <footer className={styles.footer}>
      <Reveal className={`container ${styles.inner}`}>
        <div className={styles.rail}>
          <div className={styles.vertex}>
            <h3 className={`label ${styles.heading}`}>{t.footer.project}</h3>
            <a href="https://github.com/lkzppm/GraphMan" target="_blank" rel="noreferrer">
              {t.footer.source}
            </a>
            <Link href="/observatory">{t.nav.observatory}</Link>
            <Link href="/library">{t.nav.library}</Link>
            <Link href="/studies">{t.nav.studies}</Link>
            <Link href="/presentation">{t.nav.presentation}</Link>
          </div>
          <div className={styles.vertex}>
            <h3 className={`label ${styles.heading}`}>{t.footer.stack}</h3>
            <span>Rust 2024 · wasm-bindgen</span>
            <span>Next.js · vgpu (WebGPU)</span>
            <span>{t.footer.licence}</span>
          </div>
          <div className={styles.vertex}>
            <h3 className={`label ${styles.heading}`}>{t.footer.author}</h3>
            <span className={styles.name}>{t.footer.authorName}</span>
            <a
              className={styles.social}
              href="https://github.com/lkzppm"
              target="_blank"
              rel="noreferrer"
            >
              <BrandIcon icon={siGithub} size={15} />
              {t.footer.github}
            </a>
            <a
              className={styles.social}
              href="https://www.linkedin.com/in/lucasppmc/"
              target="_blank"
              rel="noreferrer"
            >
              <BrandIcon icon={LINKEDIN} size={15} />
              {t.footer.linkedin}
            </a>
          </div>
          <div className={styles.vertex}>
            <h3 className={`label ${styles.heading}`}>{t.footer.course}</h3>
            <span>{t.footer.courseName}</span>
            <span>UFRJ · 2026/2</span>
          </div>
        </div>
        <div className={styles.bottom}>
          <Link href="/" className={styles.brand}>
            <Logo size={26} />
            <span className={`mono ${styles.wordmark}`}>
              graphman<span className="accent">.</span>
            </span>
          </Link>
          <span className={`mono ${styles.copyright}`}>{t.footer.copyright}</span>
        </div>
      </Reveal>
    </footer>
  );
}
