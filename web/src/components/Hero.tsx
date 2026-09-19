'use client';

import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { siNextdotjs, siRust, siVercel, siWebassembly, siWebgpu } from 'simple-icons';
import { formatCompact, formatMs } from '@/lib/format';
import { useT } from '@/i18n/LocaleProvider';
import type { GraphStudy } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import Constellation from './Constellation';
import HeroMark from './HeroMark';
import Representations from './Representations';
import Reveal from './Reveal';
import styles from './Hero.module.css';

const STACK = [
  { icon: siRust, label: 'Rust 2024', href: 'https://www.rust-lang.org' },
  { icon: siWebassembly, label: 'WebAssembly', href: 'https://webassembly.org' },
  { icon: siWebgpu, label: 'WebGPU · vgpu', href: 'https://vgpu.sh' },
  { icon: siNextdotjs, label: 'Next.js', href: 'https://nextjs.org' },
  { icon: siVercel, label: 'Vercel', href: 'https://vercel.com' },
];

export default function Hero({ studies }: { studies: GraphStudy[] }) {
  const t = useT();
  const largest = studies.reduce<GraphStudy | null>(
    (best, s) => (best === null || s.edges > best.edges ? s : best),
    null,
  );

  const facts = [
    {
      value: largest ? formatCompact(largest.edges) : '46.5M',
      label: t.hero.facts.edges,
      hint: largest ? t.hero.facts.parsedIn(formatMs(largest.parse_ms)) : undefined,
    },
    { value: '3', label: t.hero.facts.representations, hint: t.hero.facts.oneTrait },
    { value: '4', label: t.hero.facts.methods, hint: t.hero.facts.cancellable },
  ];

  return (
    <>
      {/* One viewport: the live mark on the left, the wordmark and brief on
          the right, the arrow down. */}
      <section className={styles.hero}>
        <Constellation count={90} className={styles.stars} />
        <div className={`container ${styles.inner}`}>
          <div className={styles.float}>
            <HeroMark size={360} />
          </div>
          <div className={styles.text}>
            <p className="eyebrow">{t.hero.eyebrow}</p>
            <h1 className={`mono ${styles.wordmark}`}>
              graphman<span className="accent">.</span>
            </h1>
            <p className={styles.brief}>{t.hero.brief}</p>
            <div className={styles.cta}>
              <Link href="/observatory" className="button button--primary">
                {t.hero.open}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <Link href="/library" className="button button--secondary">
                {t.hero.library}
              </Link>
            </div>
            <ul className={styles.stack}>
              {STACK.map((item) => (
                <li key={item.label}>
                  <a className={styles.stackItem} href={item.href} target="_blank" rel="noreferrer">
                    <BrandIcon icon={item.icon} size={16} />
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <a href="#more" className={styles.arrow} aria-label={t.hero.discoverLabel}>
          <span className="comment">{t.hero.discover}</span>
          <ChevronDown size={20} aria-hidden="true" />
        </a>
      </section>

      {/* What it is: the words and the three facts on the left, the same
          small graph stored three ways on the right. */}
      <section className="section" id="more">
        <div className={`container ${styles.what}`}>
          <div className={styles.whatText}>
            <Reveal as="h2" className="section__title">
              {t.hero.whatTitle}
              <span className="accent">.</span>
            </Reveal>
            <Reveal as="p" className="section__lead" delay={0.1}>
              {t.hero.whatLead}
            </Reveal>
            <dl className={styles.facts}>
              {facts.map((fact, i) => (
                <Reveal key={fact.label} className={styles.fact} delay={0.2 + i * 0.08}>
                  <dt className="label">{fact.label}</dt>
                  <dd>
                    <span className={`mono ${styles.value}`}>{fact.value}</span>
                    {fact.hint && <span className={styles.hint}>{fact.hint}</span>}
                  </dd>
                </Reveal>
              ))}
            </dl>
          </div>
          <Reveal delay={0.25}>
            <Representations />
          </Reveal>
        </div>
      </section>
    </>
  );
}
