'use client';

import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Expand, Minimize2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { siNextdotjs, siRust, siVercel, siWebassembly, siWebgpu } from 'simple-icons';
import { useT } from '@/i18n/LocaleProvider';
import { formatBytes, formatCompact, formatInt, formatMs, graphNumber } from '@/lib/format';
import { logScale } from '@/lib/scale';
import type { GraphStudy } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import Constellation from './Constellation';
import { levelColour } from './GraphFigure';
import HeroMark from './HeroMark';
import styles from './Deck.module.css';

const STACK_ICONS = [siRust, siWebassembly, siWebgpu, siNextdotjs, siVercel];

const SLIDE_COUNT = 5;

/**
 * The 8-minute presentation as five full-height slides: ← → (or the
 * buttons) move, F toggles full screen, the counter and dots show where we
 * are. Each topic is drawn rather than written: the architecture is a map
 * from the course's file to the two front ends, every decision carries a
 * wordless figure of what it does, the case studies are bars on two shared
 * log scales and the observatory is a browser with a search inside it. The
 * words come from the dictionary, the numbers from the same results.json
 * as the case-studies page.
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

/** The head every slide but the cover wears. */
function Head({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <header className={styles.head}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className={styles.title}>{title}</h2>
      {lead && <p className={styles.lead}>{lead}</p>}
    </header>
  );
}

/** One edge of the architecture map, a vertex at its tail and an arrow at
    its head; it turns with the map when the slide gets narrow. */
function Arrow() {
  return (
    <svg className={styles.arrow} viewBox="0 0 36 12" width="36" height="12" aria-hidden="true">
      <line x1="3" y1="6" x2="27" y2="6" />
      <circle cx="3" cy="6" r="3" />
      <path className={styles.arrowHead} d="M 26 2 L 34 6 L 26 10 z" />
    </svg>
  );
}

/** The fan joining a tier of the library to the boxes under it: one edge
    from the tier's vertex down to the centre of each box. */
function Fan({ count }: { count: number }) {
  const at = (i: number) => `${((i + 0.5) / count) * 100}%`;
  return (
    <svg className={styles.fan} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <line key={i} x1="50%" y1="3" x2={at(i)} y2="23" />
      ))}
      <circle cx="50%" cy="3" r="3" />
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} cx={at(i)} cy="23" r="3" />
      ))}
    </svg>
  );
}

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

/** Architecture as a map: the course's file on the left, the library in the
    middle (the trait, what implements it, what is written once over it) and
    the two front ends on the right. */
function Architecture({ t }: { t: T }) {
  const s = t.presentation.slides.architecture;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className={styles.map}>
        <div className={styles.mapSide}>
          <p className="label">{s.input.label}</p>
          <div className={styles.file}>
            <span className={`mono ${styles.fileName}`}>{s.input.name}</span>
            <span className={styles.fileLines} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <p className="comment">{s.input.hint}</p>
        </div>

        <Arrow />

        <div className={styles.core}>
          <p className={styles.coreHead}>
            <span className={`mono ${styles.coreName}`}>{s.core.name}</span>
            <span className={`label ${styles.coreLabel}`}>{s.core.label}</span>
          </p>
          <div className={styles.trait}>
            <span className={`mono ${styles.traitName}`}>{s.trait.name}</span>
            <span className="comment">{s.trait.hint}</span>
            <ul className={styles.methods}>
              {s.trait.methods.map((m) => (
                <li key={m} className={`mono ${styles.method}`}>
                  {m}
                </li>
              ))}
            </ul>
          </div>
          <p className={`label ${styles.tier}`}>{s.implement}</p>
          <Fan count={s.reps.length} />
          <ul className={styles.reps}>
            {s.reps.map((r) => (
              <li key={r.name} className={styles.rep}>
                <span className={`mono ${styles.repName}`}>{r.name}</span>
                <span className={`mono ${styles.repHint}`}>{r.hint}</span>
              </li>
            ))}
          </ul>
          <p className={`label ${styles.tier}`}>{s.generic}</p>
          <Fan count={s.algos.length} />
          <ul className={styles.algos}>
            {s.algos.map((a) => (
              <li key={a} className={styles.algo}>
                {a}
              </li>
            ))}
          </ul>
        </div>

        <Arrow />

        <div className={styles.mapSide}>
          <p className="label">{s.outputsLabel}</p>
          {s.outputs.map((o) => (
            <div key={o.name} className={styles.output}>
              <span className={`mono ${styles.outputName}`}>{o.name}</span>
              <span className={styles.outputHint}>{o.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- the five decision figures ------------------------------------------
   Each figure is drawn in a 168 × 76 box and holds no words, so it reads
   the same in both languages; the caption under it is the dictionary's. */

/** Normalising once: the self-loop and the second copy of an edge are grey
    and struck through, what the parser keeps is the graph in blue. */
function FigNormalise() {
  const v: [number, number][] = [
    [36, 28],
    [98, 20],
    [60, 62],
    [130, 54],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  return (
    <svg viewBox="0 0 168 76" className={styles.fig} aria-hidden="true">
      {/* what the parser drops: a self-loop on the first vertex and a
          second copy of the edge to the second one */}
      <g className={styles.figDrop}>
        <path d="M 36 28 C 12 14, 26 0, 42 14" />
        <path d="M 36 28 C 56 6, 82 4, 98 20" />
      </g>
      <g className={styles.figCross}>
        <path d="M 18 4 l 8 8 M 26 4 l -8 8" />
        <path d="M 64 2 l 8 8 M 72 2 l -8 8" />
      </g>
      <g className={styles.figEdge}>
        {edges.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={v[a][0]} y1={v[a][1]} x2={v[b][0]} y2={v[b][1]} />
        ))}
      </g>
      {v.map(([x, y]) => (
        <circle key={`${x}-${y}`} className={styles.figNode} cx={x} cy={y} r="5.5" />
      ))}
    </svg>
  );
}

/** A visitor stopping a search: the left of the tree is walked in level
    colours, the right stays undiscovered behind the break. */
function FigVisitor() {
  const nodes = [
    { x: 84, y: 12, level: 0, on: true },
    { x: 50, y: 40, level: 1, on: true },
    { x: 118, y: 40, level: 1, on: true },
    { x: 26, y: 66, level: 2, on: true },
    { x: 68, y: 66, level: 2, on: true },
    { x: 102, y: 66, level: 2, on: false },
    { x: 144, y: 66, level: 2, on: false },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  return (
    <svg viewBox="0 0 168 76" className={styles.fig} aria-hidden="true">
      {edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          className={styles.figTree}
          style={{ stroke: nodes[b].on ? levelColour(nodes[b].level, 2) : 'var(--edge-dim)' }}
        />
      ))}
      {nodes.map((n) => (
        <circle
          key={`${n.x}-${n.y}`}
          cx={n.x}
          cy={n.y}
          r="5.5"
          style={{ fill: n.on ? levelColour(n.level, 2) : 'var(--node-dim)' }}
        />
      ))}
      <line className={styles.figBreak} x1="85" y1="50" x2="85" y2="76" />
    </svg>
  );
}

/** A reused SearchTree: only the cells the last search touched have to be
    cleared before the next one, however long the row is. */
function FigReuse() {
  const touched = new Set([3, 4, 5, 6, 16, 17, 18]);
  return (
    <svg viewBox="0 0 168 76" className={styles.fig} aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => (
        <rect
          key={i}
          x={9 + (i % 13) * 12}
          y={14 + Math.floor(i / 13) * 20}
          width="10"
          height="10"
          rx="2"
          className={touched.has(i) ? styles.figCellOn : styles.figCell}
        />
      ))}
      {/* the reset walks back over those cells, and nothing else */}
      <path className={styles.figLoop} d="M 92 50 C 92 66, 46 70, 46 56" />
      <path className={styles.figLoop} d="M 42 60 l 4 -5 l 4 5" />
    </svg>
  );
}

/** The memory budget: the adjacency list fits under the line, the bitset
    matrix runs past it and off the figure. */
function FigBudget() {
  return (
    <svg viewBox="0 0 168 76" className={styles.fig} aria-hidden="true">
      <rect className={styles.figTrack} x="8" y="18" width="142" height="12" rx="2" />
      <rect x="8" y="18" width="44" height="12" rx="2" fill="var(--accent)" />
      <rect className={styles.figTrack} x="8" y="46" width="142" height="12" rx="2" />
      <rect className={styles.figOver} x="8" y="46" width="164" height="12" rx="2" />
      <line className={styles.figLimit} x1="150" y1="8" x2="150" y2="68" />
    </svg>
  );
}

/** The four diameter methods, each bar as long as the searches it runs. */
function FigDiameter() {
  const bars = [
    { width: 152, colour: 'var(--level-0)' },
    { width: 44, colour: 'color-mix(in srgb, var(--accent) 55%, white)' },
    { width: 58, colour: 'var(--accent)' },
    { width: 18, colour: 'var(--accent-2)' },
  ];
  return (
    <svg viewBox="0 0 168 76" className={styles.fig} aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x="8" y={11 + i * 16} width={b.width} height="10" rx="2" fill={b.colour} />
      ))}
    </svg>
  );
}

const DECISION_FIGURES = [FigNormalise, FigVisitor, FigReuse, FigBudget, FigDiameter];

function Decisions({ t }: { t: T }) {
  const s = t.presentation.slides.decisions;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <ul className={styles.cards}>
        {s.items.map((item, i) => {
          const Figure = DECISION_FIGURES[i];
          return (
            <li key={item.title} className={styles.card} style={{ animationDelay: `${i * 70}ms` }}>
              <span className={styles.figWrap}>
                <Figure />
              </span>
              <span className={`comment ${styles.caption}`}>{item.caption}</span>
              <span className={styles.cardHead}>
                <span className={`mono ${styles.cardIndex}`}>{String(i + 1).padStart(2, '0')}</span>
                <h3 className={styles.cardTitle}>{item.title}</h3>
              </span>
              <p className={styles.cardBody}>{item.body}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One bar of the case-studies sheet: a track, a fill on the shared log
    scale, the measurement after it. A refused representation gets a dashed
    bar and what it would have needed. */
function Bar({
  width,
  colour,
  value,
  ghost,
}: {
  width: number;
  colour: string;
  value: ReactNode;
  ghost?: boolean;
}) {
  return (
    <span className={styles.barRow} data-ghost={ghost || undefined}>
      <span className={styles.track}>
        <span
          className={styles.fill}
          style={{ '--w': `${Math.max(1.5, width * 100)}%`, '--colour': colour } as CSSProperties}
        />
      </span>
      <span className={`mono ${styles.barValue}`}>{value}</span>
    </span>
  );
}

const MEMORY_COLOURS = { adjacency_list: 'var(--accent)', adjacency_matrix: 'var(--accent-2)' };
const TIME_COLOURS = { bfs: 'var(--accent)', dfs: 'var(--level-0)' };

/** The six graphs on one sheet: how big each one is, what the two
    representations cost, how long a search took, how many components it has
    and its diameter. */
function Results({ t, studies }: { t: T; studies: GraphStudy[] }) {
  const s = t.presentation.slides.results;
  const c = s.columns;

  const memory = (study: GraphStudy, repr: keyof typeof MEMORY_COLOURS) =>
    study.representations.find((r) => r.representation === repr)?.memory ?? null;
  const footprint = (study: GraphStudy, repr: keyof typeof MEMORY_COLOURS) => {
    const m = memory(study, repr);
    if (!m || !m.feasible) return null;
    return m.footprint_bytes ?? m.resident_bytes;
  };
  const timing = (study: GraphStudy, algo: keyof typeof TIME_COLOURS) =>
    study.representations.find((r) => r.representation === 'adjacency_list')?.[algo]?.mean_ms ??
    null;

  // Both scales run over every graph, so a bar's length means the same on
  // every row. Memory tops out at the largest representation that fitted;
  // the ones that did not fit are the dashed bars that run past the end.
  const bytes = studies.flatMap((study) =>
    (['adjacency_list', 'adjacency_matrix'] as const)
      .map((r) => footprint(study, r))
      .filter((b): b is number => b !== null),
  );
  const times = studies.flatMap((study) =>
    (['bfs', 'dfs'] as const).map((a) => timing(study, a) ?? 0),
  );
  const memoryScale = logScale(1 << 20, Math.max(...bytes));
  const timeScale = logScale(0.1, Math.max(...times));

  const memoryBar = (study: GraphStudy, repr: keyof typeof MEMORY_COLOURS) => {
    const m = memory(study, repr);
    const colour = MEMORY_COLOURS[repr];
    if (!m) return <Bar width={0} colour={colour} value="·" />;
    if (!m.feasible)
      return (
        <Bar width={1} colour={colour} value={s.needed(formatBytes(m.required_bytes))} ghost />
      );
    const value = m.footprint_bytes ?? m.resident_bytes;
    if (value === null) return <Bar width={0} colour={colour} value="·" />;
    return <Bar width={memoryScale(value)} colour={colour} value={formatBytes(value)} />;
  };
  const timeBar = (study: GraphStudy, algo: keyof typeof TIME_COLOURS) => {
    const ms = timing(study, algo);
    const colour = TIME_COLOURS[algo];
    if (ms === null) return <Bar width={0} colour={colour} value="·" />;
    return <Bar width={timeScale(ms)} colour={colour} value={formatMs(ms)} />;
  };
  const diameter = (study: GraphStudy) => {
    // The best answer: an exact one if any method finished, else the largest bound.
    const exact = study.diameters.find((d) => d.is_exact && !d.cancelled);
    if (exact) return <span className={`mono ${styles.answer}`}>{exact.value}</span>;
    const bound = Math.max(0, ...study.diameters.map((d) => d.value));
    return <span className={`mono ${styles.answer} ${styles.bound}`}>≥ {bound}</span>;
  };

  return (
    <div className={styles.body}>
      <div className={styles.resultsHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        <ul className={styles.legend}>
          {s.legend.map((l) => (
            <li key={l.key} className={styles.legendItem}>
              <span className={styles.swatch} data-key={l.key} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.sheet}>
        <div className={`label ${styles.sheetHead}`}>
          <span>{c.graph}</span>
          <span>{c.size}</span>
          <span>{c.memory}</span>
          <span>{c.time}</span>
          <span className={styles.centre}>{c.components}</span>
          <span className={styles.centre}>{c.diameter}</span>
        </div>
        {studies.map((study, i) => (
          <div key={study.name} className={styles.row} style={{ animationDelay: `${i * 60}ms` }}>
            <span className={styles.rowName}>{t.studies.graph(graphNumber(study.name))}</span>
            <span className={styles.size}>
              <span className={`mono ${styles.sizeValue}`}>
                {formatCompact(study.vertices)} <i>{t.studies.facts.vertices}</i>
              </span>
              <span className={`mono ${styles.sizeValue}`}>
                {formatCompact(study.edges)} <i>{t.studies.facts.edges}</i>
              </span>
            </span>
            {/* the memory column leaves room for what a refused
                representation would have needed */}
            <span className={styles.group} data-wide="true">
              {memoryBar(study, 'adjacency_list')}
              {memoryBar(study, 'adjacency_matrix')}
            </span>
            <span className={styles.group}>
              {timeBar(study, 'bfs')}
              {timeBar(study, 'dfs')}
            </span>
            <span className={`mono ${styles.answer} ${styles.centre}`}>
              {formatInt(study.components.count)}
            </span>
            <span className={styles.centre}>{diameter(study)}</span>
          </div>
        ))}
      </div>
      <p className={styles.note}>{s.note}</p>
    </div>
  );
}

/* The graph inside the observatory mock: BFS rings around one origin with a
   few chords inside each ring, coloured on the same level ramp as the
   canvas. Built once from a fixed seed, so the drawing is the same on the
   server, in the browser and in the room. */
const MOCK = buildMock();

function buildMock() {
  let seed = 20260920;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const counts = [1, 6, 12, 17, 21];
  const radius = [0, 30, 58, 84, 108];
  const nodes: { x: number; y: number; level: number }[] = [];
  const rings: number[][] = [];
  counts.forEach((count, level) => {
    const start = random() * Math.PI * 2;
    const ring: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = start + (i + random() * 0.7 - 0.35) * ((Math.PI * 2) / count);
      const r = radius[level] * (0.84 + random() * 0.28);
      ring.push(nodes.length);
      nodes.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r * 0.9, level });
    }
    rings.push(ring);
  });
  const edges: { a: number; b: number; tree: boolean }[] = [];
  for (let level = 1; level < rings.length; level++) {
    for (const id of rings[level]) {
      // The nearest vertex of the ring above is the parent: that is the tree edge.
      let parent = rings[level - 1][0];
      let best = Infinity;
      for (const up of rings[level - 1]) {
        const d = (nodes[up].x - nodes[id].x) ** 2 + (nodes[up].y - nodes[id].y) ** 2;
        if (d < best) {
          best = d;
          parent = up;
        }
      }
      edges.push({ a: parent, b: id, tree: true });
    }
  }
  // A handful of chords, because a graph is not a tree.
  for (let i = 0; i < 18; i++) {
    const ring = rings[1 + Math.floor(random() * (rings.length - 1))];
    const a = ring[Math.floor(random() * ring.length)];
    const b = ring[Math.floor(random() * ring.length)];
    if (a !== b) edges.push({ a, b, tree: false });
  }
  return { nodes, edges, maxLevel: counts.length - 1 };
}

function Observatory({ t }: { t: T }) {
  const s = t.presentation.slides.observatory;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className={styles.observatory}>
        <div className={styles.browser}>
          <div className={styles.browserBar}>
            <span className={styles.lights} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className={`mono ${styles.url}`}>{s.url}</span>
          </div>
          <svg viewBox="-132 -118 264 236" className={styles.mock} aria-hidden="true">
            {MOCK.edges.map((e, i) => (
              <line
                key={i}
                x1={MOCK.nodes[e.a].x}
                y1={MOCK.nodes[e.a].y}
                x2={MOCK.nodes[e.b].x}
                y2={MOCK.nodes[e.b].y}
                stroke={
                  e.tree ? levelColour(MOCK.nodes[e.b].level, MOCK.maxLevel) : 'var(--edge-dim)'
                }
                strokeWidth={e.tree ? 1 : 0.8}
              />
            ))}
            {MOCK.nodes.map((n, i) => (
              <circle
                key={i}
                cx={n.x}
                cy={n.y}
                r={n.level === 0 ? 5 : 3.4}
                fill={levelColour(n.level, MOCK.maxLevel)}
              />
            ))}
          </svg>
        </div>
        <div className={styles.side}>
          <dl className={styles.facts}>
            {s.facts.map((fact, i) => (
              <div
                key={fact.label}
                className={styles.fact}
                style={{ animationDelay: `${i * 70}ms` }}
              >
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
      </div>
    </div>
  );
}
