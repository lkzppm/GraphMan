'use client';

import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Expand, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { siNextdotjs, siRust, siVercel, siWebassembly, siWebgpu } from 'simple-icons';
import { useT } from '@/i18n/LocaleProvider';
import { formatBytes, formatCompact, formatInt, formatMs, graphNumber } from '@/lib/format';
import type { GraphStudy } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import Constellation from './Constellation';
import HeroMark from './HeroMark';
import styles from './Deck.module.css';

const STACK_ICONS = [siRust, siWebassembly, siWebgpu, siNextdotjs, siVercel];

const TRAIT = `pub trait Graph {
    type Neighbors<'a>: Iterator<Item = Vertex>
        where Self: 'a;

    fn vertex_count(&self) -> usize;
    fn edge_count(&self) -> usize;
    fn degree(&self, v: Vertex) -> usize;
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_>;
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool;
}`;

const SLIDE_COUNT = 5;

/**
 * The 8-minute presentation as five full-height slides: ← → (or the
 * buttons) move, F toggles full screen, the counter and dots show where
 * we are. The words come from the dictionary, the numbers from the same
 * results.json as the case-studies page.
 */
export default function Deck({ studies }: { studies: GraphStudy[] }) {
  const t = useT();
  const p = t.presentation;
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(SLIDE_COUNT - 1, next)));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = deckRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === deckRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
        event.preventDefault();
        setIndex((i) => Math.min(SLIDE_COUNT - 1, i + 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (event.key === 'Home') {
        setIndex(0);
      } else if (event.key === 'End') {
        setIndex(SLIDE_COUNT - 1);
      } else if (event.key === 'f' || event.key === 'F') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  const slides = [
    <Cover key="cover" t={t} />,
    <Architecture key="architecture" t={t} />,
    <Decisions key="decisions" t={t} />,
    <Results key="results" t={t} studies={studies} />,
    <Observatory key="observatory" t={t} />,
  ];

  return (
    <div ref={deckRef} className={`${styles.deck} ${fullscreen ? styles.deckFullscreen : ''}`}>
      <div className={styles.stage}>
        {slides.map((slide, i) => (
          <section
            key={i}
            className={`${styles.slide} ${i === index ? styles.slideCurrent : ''}`}
            aria-hidden={i !== index}
            inert={i !== index}
          >
            {slide}
          </section>
        ))}
      </div>

      <div className={styles.bar}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label={p.previous}
        >
          <ChevronLeft size={16} />
        </button>
        <div className={styles.dots} role="tablist">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={i === index ? styles.dotCurrent : styles.dot}
              onClick={() => go(i)}
              aria-label={p.counter(i + 1, SLIDE_COUNT)}
            />
          ))}
        </div>
        <span className={`mono ${styles.counter}`}>{p.counter(index + 1, SLIDE_COUNT)}</span>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => go(index + 1)}
          disabled={index === SLIDE_COUNT - 1}
          aria-label={p.next}
        >
          <ChevronRight size={16} />
        </button>
        <span className={`comment ${styles.hint}`}>{p.hint}</span>
        <button
          type="button"
          className={styles.navButton}
          onClick={toggleFullscreen}
          aria-label={p.fullscreen}
          title={p.fullscreen}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
        </button>
      </div>
    </div>
  );
}

type T = ReturnType<typeof useT>;

function Cover({ t }: { t: T }) {
  const s = t.presentation.slides.cover;
  return (
    <div className={styles.cover}>
      <Constellation count={70} className={styles.stars} />
      <div className={styles.coverInner}>
        <div className={styles.coverMark}>
          <HeroMark size={300} />
        </div>
        <div className={styles.coverText}>
          <p className="eyebrow">{s.eyebrow}</p>
          <h1 className={`mono ${styles.wordmark}`}>
            graphman<span className="accent">.</span>
          </h1>
          <p className={styles.tagline}>{s.tagline}</p>
          <p className={`label ${styles.author}`}>{s.author}</p>
          <ul className={styles.stack}>
            {s.stack.map((label, i) => (
              <li key={label} className={styles.stackItem}>
                <BrandIcon icon={STACK_ICONS[i]} size={15} />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Architecture({ t }: { t: T }) {
  const s = t.presentation.slides.architecture;
  return (
    <div className={styles.body}>
      <header className={styles.head}>
        <p className="eyebrow">{s.eyebrow}</p>
        <h2 className={styles.title}>{s.title}</h2>
        <p className={styles.lead}>{s.lead}</p>
      </header>
      <div className={styles.split}>
        <pre className={`mono ${styles.code}`}>
          <code>{TRAIT}</code>
        </pre>
        <ol className={styles.crates}>
          {s.crates.map((c, i) => (
            <li key={c.name} className={styles.crate}>
              <span className={styles.crateHead}>
                <span className={`mono ${styles.crateIndex}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={`mono ${styles.crateName}`}>{c.name}</span>
                <span className={`label ${styles.crateRole}`}>{c.role}</span>
              </span>
              <p className={styles.crateBody}>{c.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Decisions({ t }: { t: T }) {
  const s = t.presentation.slides.decisions;
  return (
    <div className={styles.body}>
      <header className={styles.head}>
        <p className="eyebrow">{s.eyebrow}</p>
        <h2 className={styles.title}>{s.title}</h2>
      </header>
      <ul className={styles.cards}>
        {s.items.map((item, i) => (
          <li key={item.title} className={styles.card} style={{ animationDelay: `${i * 70}ms` }}>
            <span className={`mono ${styles.cardIndex}`}>{String(i + 1).padStart(2, '0')}</span>
            <h3 className={styles.cardTitle}>{item.title}</h3>
            <p className={styles.cardBody}>{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Results({ t, studies }: { t: T; studies: GraphStudy[] }) {
  const s = t.presentation.slides.results;
  const c = s.columns;
  const memory = (study: GraphStudy, repr: 'adjacency_list' | 'adjacency_matrix') => {
    const m = study.representations.find((r) => r.representation === repr)?.memory;
    if (!m) return '·';
    if (!m.feasible)
      return <span className={styles.flag}>{s.needed(formatBytes(m.required_bytes))}</span>;
    const value = m.footprint_bytes ?? m.resident_bytes;
    return value === null ? '·' : formatBytes(value);
  };
  const time = (study: GraphStudy, algo: 'bfs' | 'dfs') => {
    const timing = study.representations.find((r) => r.representation === 'adjacency_list')?.[algo];
    return timing ? formatMs(timing.mean_ms) : '·';
  };
  const diameter = (study: GraphStudy) => {
    // The best answer: an exact one if any method finished, else the largest bound.
    const exact = study.diameters.find((d) => d.is_exact && !d.cancelled);
    if (exact) return String(exact.value);
    const bound = Math.max(0, ...study.diameters.map((d) => d.value));
    return <span className={styles.flag}>≥ {bound}</span>;
  };
  return (
    <div className={styles.body}>
      <header className={styles.head}>
        <p className="eyebrow">{s.eyebrow}</p>
        <h2 className={styles.title}>{s.title}</h2>
      </header>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{c.graph}</th>
              <th className={styles.num}>{c.vertices}</th>
              <th className={styles.num}>{c.edges}</th>
              <th className={styles.num}>{c.list}</th>
              <th className={styles.num}>{c.matrix}</th>
              <th className={styles.num}>{c.bfs}</th>
              <th className={styles.num}>{c.dfs}</th>
              <th className={styles.num}>{c.components}</th>
              <th className={styles.num}>{c.diameter}</th>
            </tr>
          </thead>
          <tbody>
            {studies.map((study) => (
              <tr key={study.name}>
                <th scope="row">{t.studies.graph(graphNumber(study.name))}</th>
                <td className={`mono ${styles.num}`}>{formatCompact(study.vertices)}</td>
                <td className={`mono ${styles.num}`}>{formatCompact(study.edges)}</td>
                <td className={`mono ${styles.num}`}>{memory(study, 'adjacency_list')}</td>
                <td className={`mono ${styles.num}`}>{memory(study, 'adjacency_matrix')}</td>
                <td className={`mono ${styles.num}`}>{time(study, 'bfs')}</td>
                <td className={`mono ${styles.num}`}>{time(study, 'dfs')}</td>
                <td className={`mono ${styles.num}`}>{formatInt(study.components.count)}</td>
                <td className={`mono ${styles.num}`}>{diameter(study)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{s.note}</p>
    </div>
  );
}

function Observatory({ t }: { t: T }) {
  const s = t.presentation.slides.observatory;
  return (
    <div className={styles.body}>
      <header className={styles.head}>
        <p className="eyebrow">{s.eyebrow}</p>
        <h2 className={styles.title}>{s.title}</h2>
        <p className={styles.lead}>{s.lead}</p>
      </header>
      <dl className={styles.facts}>
        {s.facts.map((fact, i) => (
          <div key={fact.label} className={styles.fact} style={{ animationDelay: `${i * 70}ms` }}>
            <dt className="label">{fact.label}</dt>
            <dd>
              <span className={`mono ${styles.factValue}`}>{fact.value}</span>
              <span className={styles.factHint}>{fact.hint}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        <Link href="/observatory" className="button button--primary">
          {s.cta}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <a
          className={`mono ${styles.source}`}
          href="https://github.com/lkzppm/GraphMan"
          target="_blank"
          rel="noreferrer"
        >
          {s.source}
        </a>
      </div>
    </div>
  );
}
