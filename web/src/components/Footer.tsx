'use client';

import Link from 'next/link';
import { useT } from '@/i18n/LocaleProvider';
import styles from './Footer.module.css';

export default function Footer() {
  const t = useT();
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.cols}>
          <div>
            <h3 className={`label ${styles.heading}`}>{t.footer.project}</h3>
            <a href="https://github.com/lkzppm/GraphMan" target="_blank" rel="noreferrer">
              {t.footer.source}
            </a>
            <Link href="/observatory">{t.nav.observatory}</Link>
            <Link href="/library">{t.nav.library}</Link>
            <Link href="/studies">{t.nav.studies}</Link>
            <Link href="/presentation">{t.nav.presentation}</Link>
          </div>
          <div>
            <h3 className={`label ${styles.heading}`}>{t.footer.stack}</h3>
            <span>Rust 2024 · wasm-bindgen</span>
            <span>Next.js · vgpu (WebGPU)</span>
            <span>{t.footer.licence}</span>
          </div>
          <div>
            <h3 className={`label ${styles.heading}`}>{t.footer.course}</h3>
            <span>{t.footer.courseName}</span>
            <span>UFRJ · 2026/2</span>
          </div>
        </div>
        <p className={styles.legal}>{t.footer.legal}</p>
        <p className={`comment ${styles.comment}`}>{t.footer.built}</p>
      </div>
    </footer>
  );
}
