import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { siNextdotjs, siRust, siVercel, siWebassembly, siWebgpu } from 'simple-icons';
import { formatCompact, formatMs } from '@/lib/format';
import type { GraphStudy } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import Constellation from './Constellation';
import HeroMark from './HeroMark';
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
  const largest = studies.reduce<GraphStudy | null>(
    (best, s) => (best === null || s.edges > best.edges ? s : best),
    null,
  );

  const facts = [
    {
      value: largest ? formatCompact(largest.edges) : '46.5M',
      label: 'edges in the largest graph',
      hint: largest ? `parsed in ${formatMs(largest.parse_ms)}` : undefined,
    },
    { value: '3', label: 'representations', hint: 'one Graph trait' },
    { value: '4', label: 'diameter methods', hint: 'all cancellable' },
    { value: '0', label: 'servers', hint: 'the library runs in your tab' },
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
            <p className="eyebrow">built for cos 242 · graph theory · ufrj 2026/2</p>
            <h1 className={`mono ${styles.wordmark}`}>
              graphman<span className="accent">.</span>
            </h1>
            <p className={styles.brief}>
              A Rust graph library that measures itself — one <code>Graph</code> trait, three ways
              to store a graph, four ways to find its diameter — running in your browser.
            </p>
            <div className={styles.cta}>
              <Link href="/observatory" className="button button--primary">
                Open the observatory
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <Link href="/library" className="button button--secondary">
                The library
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
        <a href="#more" className={styles.arrow} aria-label="Discover more">
          <span className="comment">{'// discover more'}</span>
          <ChevronDown size={20} aria-hidden="true" />
        </a>
      </section>

      <section className="section" id="more">
        <div className="container">
          <Reveal>
            <p className="eyebrow">what it is</p>
            <h2 className="section__title">
              One trait, three representations, four diameters
              <span className="accent">.</span>
            </h2>
            <p className="section__lead">
              GraphMan reads the course&apos;s edge-list format into an adjacency list, a bitset
              matrix or CSR, and runs BFS, DFS, distances, components and the diameter on any of
              them through one small <code className="mono">Graph</code> trait. It measures its own
              memory and time on the six course graphs, and compiled to WebAssembly it is the engine
              of the observatory.
            </p>
          </Reveal>
          <dl className={styles.facts}>
            {facts.map((fact, i) => (
              <Reveal key={fact.label} className={styles.fact} delay={0.15 + i * 0.07}>
                <dt className="label">{fact.label}</dt>
                <dd>
                  <span className={`mono ${styles.value}`}>{fact.value}</span>
                  {fact.hint && <span className={styles.hint}>{fact.hint}</span>}
                </dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
