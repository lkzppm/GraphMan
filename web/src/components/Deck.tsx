'use client';

import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Expand, Minimize2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { siNextdotjs, siRust, siVercel, siWebassembly, siWebgpu } from 'simple-icons';
import { useT } from '@/i18n/LocaleProvider';
import { formatBytes, formatCompact, formatInt, formatMs, graphNumber } from '@/lib/format';
import { logScale } from '@/lib/scale';
import type { DiameterMethod, GraphStudy } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import Constellation from './Constellation';
import { levelColour } from './GraphFigure';
import HeroMark from './HeroMark';
import styles from './Deck.module.css';

const STACK_ICONS = [siRust, siWebassembly, siWebgpu, siNextdotjs, siVercel];
const SLIDE_COUNT = 5;
/** Horizontal travel that counts as a swipe between slides. */
const SWIPE = 60;

/**
 * The 8-minute presentation as five slides that draw themselves. Each slide
 * fills the viewport under the nav; ← → (space, PageUp/Down, a swipe or the
 * buttons) move, Home/End jump, F toggles full screen. Everything animated
 * is gated on the current slide, so moving away and back replays the
 * drawing like the mark on the landing page replays on load: the
 * architecture map draws its edges in order, the decision figures run, the
 * bars of the case-study sheet grow, the observatory mock keeps a BFS wave
 * looping next to the QR code. The words come from the dictionary, the
 * numbers from the same results.json as the case-studies page.
 */
export default function Deck({ studies }: { studies: GraphStudy[] }) {
  const t = useT();
  const p = t.presentation;
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ id: number; x: number } | null>(null);

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

  // A horizontal swipe on a touch screen turns the page; the cover's mark
  // captures its own pointer while a vertex is dragged, so it never reaches here.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    swipe.current = { id: event.pointerId, x: event.clientX };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (dx < -SWIPE) go(index + 1);
    else if (dx > SWIPE) go(index - 1);
  };

  const slides = [
    <Cover key="cover" t={t} />,
    <Architecture key="architecture" t={t} />,
    <Decisions key="decisions" t={t} studies={studies} />,
    <Studies key="studies" t={t} studies={studies} />,
    <Observatory key="observatory" t={t} />,
  ];

  return (
    <div ref={deckRef} className={`${styles.deck} ${fullscreen ? styles.deckFullscreen : ''}`}>
      <div className={styles.stage} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
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

/** Seconds into the slide's arrival at which an element starts moving. */
const at = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties;

/** The head every slide but the cover wears. */
function Head({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <header className={styles.head}>
      <p className={`eyebrow ${styles.rise}`} style={at(0)}>
        {eyebrow}
      </p>
      <h2 className={`${styles.title} ${styles.rise}`} style={at(0.08)}>
        {title}
      </h2>
      {lead && (
        <p className={`${styles.lead} ${styles.rise}`} style={at(0.16)}>
          {lead}
        </p>
      )}
    </header>
  );
}

/* ---- cover ---------------------------------------------------------------- */

function Cover({ t }: { t: T }) {
  const s = t.presentation.slides.cover;
  return (
    <div className={styles.cover}>
      <Constellation count={70} className={styles.stars} />
      <div className={styles.coverInner}>
        <div className={styles.coverMark}>
          <HeroMark size={320} />
        </div>
        <div className={styles.coverText}>
          <p className="eyebrow">{s.eyebrow}</p>
          <h1 className={`mono ${styles.wordmark}`}>
            graphman<span className="accent">.</span>
          </h1>
          <p className={styles.tagline}>{s.tagline}</p>
          <p className={`label ${styles.authors}`}>
            {s.authors.map((name, i) => (
              <span key={name}>
                {i > 0 && <span className={styles.authorDot}>·</span>}
                {name}
              </span>
            ))}
          </p>
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

/* ---- 01 architecture: the map ----------------------------------------------
   Read left to right: the course's file, the normalising step, the library
   (the trait in the middle, the algorithms written once above it, the three
   representations below it) and the two front ends. Edges draw in like the
   mark's, boxes pop in at the end of their edge. */

/** A horizontal edge with a vertex at its tail and an arrowhead at its
    head; it turns with the map when the slide gets narrow. */
function Edge({ delay }: { delay: number }) {
  return (
    <svg className={styles.edge} viewBox="0 0 48 12" aria-hidden="true" style={at(delay)}>
      <circle className={styles.edgeTail} cx="4" cy="6" r="3" />
      <line className={styles.edgeLine} x1="4" y1="6" x2="38" y2="6" pathLength={1} />
      <path className={styles.edgeHead} d="M 37 1.5 L 46 6 L 37 10.5 z" />
    </svg>
  );
}

/** The fan joining a tier of the library to the boxes under (or over) it:
    one edge from the tier's vertex to the centre of each box. */
function Fan({ count, up, delay }: { count: number; up?: boolean; delay: number }) {
  const x = (i: number) => `${((i + 0.5) / count) * 100}%`;
  const from = up ? 25 : 3;
  const to = up ? 3 : 25;
  return (
    <svg className={styles.fan} aria-hidden="true" style={at(delay)}>
      {Array.from({ length: count }, (_, i) => (
        <line
          key={i}
          className={styles.fanLine}
          x1="50%"
          y1={from}
          x2={x(i)}
          y2={to}
          pathLength={1}
          style={at(delay + i * 0.05)}
        />
      ))}
      <circle className={styles.fanRoot} cx="50%" cy={from} r="3" />
    </svg>
  );
}

function Architecture({ t }: { t: T }) {
  const s = t.presentation.slides.architecture;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.map}>
        {/* the file */}
        <div className={`${styles.side} ${styles.pop}`} style={at(0.2)}>
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

        {/* the normalising step rides on the first edge */}
        <div className={styles.step}>
          <Edge delay={0.45} />
          <span className={`mono ${styles.stepName} ${styles.pop}`} style={at(0.7)}>
            {s.normalise.name}
          </span>
          <span className={`comment ${styles.stepHint} ${styles.pop}`} style={at(0.8)}>
            {s.normalise.hint}
          </span>
        </div>

        {/* the library */}
        <div className={`${styles.core} ${styles.pop}`} style={at(0.85)}>
          <p className={`mono ${styles.coreName}`}>{s.core}</p>

          <ul className={styles.algos}>
            {s.algos.map((a, i) => (
              <li key={a} className={`${styles.algo} ${styles.pop}`} style={at(1.85 + i * 0.06)}>
                {a}
              </li>
            ))}
          </ul>
          <p className={`label ${styles.tier} ${styles.pop}`} style={at(1.75)}>
            {s.generic}
          </p>
          <Fan count={s.algos.length} up delay={1.55} />

          <div className={`${styles.trait} ${styles.pop}`} style={at(1.0)}>
            <span className={`mono ${styles.traitName}`}>{s.trait.name}</span>
            <ul className={styles.methods}>
              {s.trait.methods.map((m, i) => (
                <li
                  key={m}
                  className={`mono ${styles.method} ${styles.pop}`}
                  style={at(1.1 + i * 0.05)}
                >
                  {m}
                </li>
              ))}
            </ul>
          </div>

          <Fan count={s.reps.length} delay={1.3} />
          <p className={`label ${styles.tier} ${styles.pop}`} style={at(1.4)}>
            {s.implement}
          </p>
          <ul className={styles.reps}>
            {s.reps.map((r, i) => (
              <li key={r.name} className={`${styles.rep} ${styles.pop}`} style={at(1.5 + i * 0.08)}>
                <span className={`mono ${styles.repName}`}>{r.name}</span>
                <span className={`mono ${styles.repHint}`}>{r.hint}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.step}>
          <Edge delay={2.15} />
        </div>

        {/* the two front ends */}
        <div className={`${styles.side} ${styles.pop}`} style={at(2.4)}>
          <p className="label">{s.outputsLabel}</p>
          {s.outputs.map((o, i) => (
            <div
              key={o.name}
              className={`${styles.output} ${styles.pop}`}
              style={at(2.5 + i * 0.12)}
            >
              <span className={`mono ${styles.outputName}`}>{o.name}</span>
              <span className={styles.outputHint}>{o.hint}</span>
            </div>
          ))}
        </div>
      </div>
      <p className={`comment ${styles.mapCaption} ${styles.rise}`} style={at(2.9)}>
        {s.caption}
      </p>
    </div>
  );
}

/* ---- 02 decisions: five figures --------------------------------------------
   Each figure is drawn in a 168 × 96 box and runs once when the slide
   arrives; it holds no words except numbers, so it reads the same in both
   languages. The title and the mono caption are the dictionary's. */

/** Normalising once: a self-loop and a second copy of an edge appear grey,
    get struck out and fade; what the parser keeps draws in blue. */
function FigNormalise() {
  const v: [number, number][] = [
    [40, 40],
    [104, 28],
    [64, 78],
    [138, 66],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <g className={styles.figDrop} style={at(0.2)}>
        <path d="M 40 40 C 14 26, 28 8, 46 22" pathLength={1} />
        <path d="M 40 40 C 60 14, 88 10, 104 28" pathLength={1} />
      </g>
      <g className={styles.figCross} style={at(0.9)}>
        <path d="M 20 12 l 8 8 M 28 12 l -8 8" pathLength={1} />
        <path d="M 68 6 l 8 8 M 76 6 l -8 8" pathLength={1} />
      </g>
      {edges.map(([a, b], i) => (
        <line
          key={`${a}-${b}`}
          className={styles.figEdge}
          style={at(0.3 + i * 0.12)}
          x1={v[a][0]}
          y1={v[a][1]}
          x2={v[b][0]}
          y2={v[b][1]}
          pathLength={1}
        />
      ))}
      {v.map(([x, y], i) => (
        <circle key={i} className={styles.figNode} style={at(0.1 + i * 0.1)} cx={x} cy={y} r="6" />
      ))}
    </svg>
  );
}

/** A visitor stopping a search: the tree lights level by level, in the
    canvas's level colours, until a break falls and the right side stays
    undiscovered. */
function FigVisitor() {
  const nodes = [
    { x: 84, y: 14, level: 0, on: true },
    { x: 48, y: 48, level: 1, on: true },
    { x: 120, y: 48, level: 1, on: true },
    { x: 24, y: 82, level: 2, on: true },
    { x: 68, y: 82, level: 2, on: true },
    { x: 104, y: 82, level: 2, on: false },
    { x: 146, y: 82, level: 2, on: false },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  const step = 0.4;
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          className={nodes[b].on ? styles.figTree : styles.figTreeOff}
          style={
            {
              ...at(0.2 + nodes[b].level * step),
              '--c': levelColour(nodes[b].level, 2),
            } as CSSProperties
          }
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          pathLength={1}
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={i}
          className={n.on ? styles.figLit : styles.figLitOff}
          style={{ ...at(0.1 + n.level * step), '--c': levelColour(n.level, 2) } as CSSProperties}
          cx={n.x}
          cy={n.y}
          r="6"
        />
      ))}
      <line
        className={styles.figBreak}
        style={at(0.2 + 2 * step)}
        x1="86"
        y1="60"
        x2="86"
        y2="96"
        pathLength={1}
      />
    </svg>
  );
}

/** A reused SearchTree: a search lights a few cells of a long row, then
    the reset sweeps back over those cells and nothing else. */
function FigReuse() {
  const touched = [3, 4, 5, 6, 16, 17, 18];
  const order = new Map(touched.map((cell, i) => [cell, i]));
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => {
        const k = order.get(i);
        return (
          <rect
            key={i}
            x={9 + (i % 13) * 12}
            y={22 + Math.floor(i / 13) * 20}
            width="10"
            height="10"
            rx="2"
            className={k === undefined ? styles.figCell : styles.figCellOn}
            style={k === undefined ? undefined : at(0.2 + k * 0.1)}
          />
        );
      })}
      <path
        className={styles.figLoop}
        style={at(1.4)}
        d="M 92 60 C 92 80, 46 84, 46 68"
        pathLength={1}
      />
      <path className={styles.figLoopHead} style={at(1.9)} d="M 40 72 l 6 -6 l 6 6" />
    </svg>
  );
}

/** The memory budget: the adjacency list grows to a fraction of the
    machine, the bitset matrix grows past the line and off the figure. */
function FigBudget() {
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <line
        className={styles.figLimit}
        style={at(0.1)}
        x1="150"
        y1="14"
        x2="150"
        y2="84"
        pathLength={1}
      />
      <rect className={styles.figTrack} x="8" y="26" width="142" height="12" rx="2" />
      <rect
        className={styles.figFill}
        style={{ ...at(0.5), '--w': '44px' } as CSSProperties}
        x="8"
        y="26"
        height="12"
        rx="2"
      />
      <rect className={styles.figTrack} x="8" y="58" width="142" height="12" rx="2" />
      <rect
        className={styles.figOver}
        style={{ ...at(0.9), '--w': '166px' } as CSSProperties}
        x="8"
        y="58"
        height="12"
        rx="2"
      />
    </svg>
  );
}

const METHODS: DiameterMethod[] = ['exact', 'i_fub', 'bounds', 'sweep'];
const METHOD_COLOURS: Record<DiameterMethod, string> = {
  exact: 'var(--level-0)',
  i_fub: 'color-mix(in srgb, var(--accent) 55%, white)',
  bounds: 'var(--accent)',
  sweep: 'var(--accent-2)',
};

/** The four diameter methods on one graph, each bar as long (on a log
    scale) as the BFS runs it spent, the count after it. */
function FigDiameter({ t, study }: { t: T; study: GraphStudy | undefined }) {
  const rows = METHODS.map((method) => ({
    method,
    run: study?.diameters.find((d) => d.method === method),
  }));
  const top = Math.max(1, ...rows.map((r) => r.run?.bfs_count ?? 0));
  const scale = logScale(1, top);
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {rows.map(({ method, run }, i) => {
        const y = 10 + i * 21;
        const width = run ? Math.max(3, 4 + scale(run.bfs_count) * 92) : 0;
        return (
          <g key={method}>
            <text className={styles.figLabel} x="0" y={y + 9}>
              {t.studies.methods[method]}
            </text>
            <rect
              className={styles.figFill}
              style={
                {
                  ...at(0.2 + i * 0.15),
                  '--w': `${width}px`,
                  fill: METHOD_COLOURS[method],
                } as CSSProperties
              }
              x="58"
              y={y}
              height="12"
              rx="2"
            />
            <text
              className={`${styles.figCount} ${styles.figFade}`}
              style={at(0.7 + i * 0.15)}
              x={58 + width + 4}
              y={y + 9.5}
            >
              {run ? formatInt(run.bfs_count) : '·'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Decisions({ t, studies }: { t: T; studies: GraphStudy[] }) {
  const s = t.presentation.slides.decisions;
  // The diameter figure shows the graph on which every method finished, the
  // largest such graph: that is where the counts differ most.
  const shown = [...studies]
    .reverse()
    .find((study) =>
      METHODS.every((m) => study.diameters.some((d) => d.method === m && !d.cancelled)),
    );
  const figures: ReactNode[] = [
    <FigNormalise key="normalise" />,
    <FigVisitor key="visitor" />,
    <FigReuse key="reuse" />,
    <FigBudget key="budget" />,
    <FigDiameter key="diameter" t={t} study={shown} />,
  ];
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <ul className={styles.cards}>
        {s.items.map((item, i) => (
          <li
            key={item.title}
            className={`${styles.card} ${styles.rise}`}
            style={at(0.15 + i * 0.08)}
          >
            <span className={styles.figWrap} style={at(0.5 + i * 0.25)}>
              {figures[i]}
            </span>
            <span className={`mono ${styles.cardIndex}`}>{String(i + 1).padStart(2, '0')}</span>
            <h3 className={styles.cardTitle}>{item.title}</h3>
            <span className={`comment ${styles.caption}`}>
              {item.caption}
              {i === 4 && shown && ` ${s.on(t.studies.graph(graphNumber(shown.name)))}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- 03 case studies: one brief sheet ---------------------------------------
   One row per graph, bars on two shared log scales (memory of the list and
   the matrix, mean BFS and DFS on the list), the component count and the
   best diameter answer. Everything else lives on the case-studies page,
   which the button under the sheet opens. */

/** One bar: a track, a fill that grows to its share of the shared scale,
    the measurement after it. A refused representation gets a dashed bar
    running off the track and what it would have needed. */
function Bar({
  width,
  colour,
  value,
  ghost,
  delay,
}: {
  width: number;
  colour: string;
  value: ReactNode;
  ghost?: boolean;
  delay: number;
}) {
  return (
    <span className={styles.barRow} data-ghost={ghost || undefined}>
      <span className={styles.track}>
        <span
          className={styles.fill}
          style={
            {
              ...at(delay),
              '--w': `${Math.max(1.5, width * 100)}%`,
              '--colour': colour,
            } as CSSProperties
          }
        />
      </span>
      <span className={`mono ${styles.barValue} ${styles.figFade}`} style={at(delay + 0.5)}>
        {value}
      </span>
    </span>
  );
}

const MEMORY_COLOURS = { adjacency_list: 'var(--accent)', adjacency_matrix: 'var(--accent-2)' };
const TIME_COLOURS = { bfs: 'var(--accent)', dfs: 'var(--level-0)' };

function Studies({ t, studies }: { t: T; studies: GraphStudy[] }) {
  const s = t.presentation.slides.studies;
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
  // every row: memory tops out at the largest representation that fitted.
  const bytes = studies.flatMap((study) =>
    (['adjacency_list', 'adjacency_matrix'] as const)
      .map((r) => footprint(study, r))
      .filter((b): b is number => b !== null),
  );
  const times = studies.flatMap((study) =>
    (['bfs', 'dfs'] as const).map((a) => timing(study, a) ?? 0),
  );
  const memoryScale = logScale(1 << 20, Math.max(1 << 21, ...bytes));
  const timeScale = logScale(0.1, Math.max(1, ...times));

  const memoryBar = (study: GraphStudy, repr: keyof typeof MEMORY_COLOURS, delay: number) => {
    const m = memory(study, repr);
    const colour = MEMORY_COLOURS[repr];
    if (!m) return <Bar width={0} colour={colour} value="·" delay={delay} />;
    if (!m.feasible)
      return (
        <Bar
          width={1}
          colour={colour}
          value={s.needed(formatBytes(m.required_bytes))}
          ghost
          delay={delay}
        />
      );
    const value = m.footprint_bytes ?? m.resident_bytes;
    if (value === null) return <Bar width={0} colour={colour} value="·" delay={delay} />;
    return (
      <Bar width={memoryScale(value)} colour={colour} value={formatBytes(value)} delay={delay} />
    );
  };
  const timeBar = (study: GraphStudy, algo: keyof typeof TIME_COLOURS, delay: number) => {
    const ms = timing(study, algo);
    const colour = TIME_COLOURS[algo];
    if (ms === null) return <Bar width={0} colour={colour} value="·" delay={delay} />;
    return <Bar width={timeScale(ms)} colour={colour} value={formatMs(ms)} delay={delay} />;
  };
  const diameter = (study: GraphStudy) => {
    // The best answer: an exact one if any method finished, else the largest bound.
    const exact = study.diameters.find((d) => d.is_exact && !d.cancelled);
    if (exact) return <span className={`mono ${styles.answer}`}>{exact.value}</span>;
    const bound = Math.max(0, ...study.diameters.map((d) => d.value));
    return <span className={`mono ${styles.answer} ${styles.bound}`}>≥ {bound}</span>;
  };

  const machine = studies.find((study) => study.machine)?.machine;

  return (
    <div className={styles.body}>
      <div className={styles.studiesHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        <ul className={`${styles.legend} ${styles.rise}`} style={at(0.2)}>
          {s.legend.map((l) => (
            <li key={l.key} className={styles.legendItem}>
              <span className={styles.swatch} data-key={l.key} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.sheet}>
        <div className={`label ${styles.sheetHead} ${styles.rise}`} style={at(0.2)}>
          <span>{c.graph}</span>
          <span>{c.size}</span>
          <span>{c.memory}</span>
          <span>{c.search}</span>
          <span className={styles.centre}>{c.components}</span>
          <span className={styles.centre}>{c.diameter}</span>
        </div>
        {studies.map((study, i) => {
          const d = 0.3 + i * 0.1;
          return (
            <div key={study.name} className={`${styles.row} ${styles.rise}`} style={at(d)}>
              <span className={styles.rowName}>{t.studies.graph(graphNumber(study.name))}</span>
              <span className={styles.size}>
                <span className={`mono ${styles.sizeValue}`}>
                  {formatCompact(study.vertices)} <i>{t.studies.facts.vertices}</i>
                </span>
                <span className={`mono ${styles.sizeValue}`}>
                  {formatCompact(study.edges)} <i>{t.studies.facts.edges}</i>
                </span>
              </span>
              <span className={styles.group} data-wide="true">
                {memoryBar(study, 'adjacency_list', d + 0.2)}
                {memoryBar(study, 'adjacency_matrix', d + 0.3)}
              </span>
              <span className={styles.group}>
                {timeBar(study, 'bfs', d + 0.4)}
                {timeBar(study, 'dfs', d + 0.5)}
              </span>
              <span
                className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                style={at(d + 0.7)}
              >
                {formatInt(study.components.count)}
              </span>
              <span className={`${styles.centre} ${styles.figFade}`} style={at(d + 0.8)}>
                {diameter(study)}
              </span>
            </div>
          );
        })}
      </div>

      <div className={`${styles.studiesFoot} ${styles.rise}`} style={at(1.2)}>
        <p className={styles.note}>
          {machine && `${s.machine(machine.cpu, formatBytes(machine.total_memory_bytes))} `}
          {s.more}
        </p>
        <Link href="/studies" className={`button button--primary ${styles.more}`}>
          {s.cta}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ---- 04 try it: the observatory and the QR code ----------------------------
   A browser frame with a BFS drawn on the canvas's level ramp, its wave
   looping level by level while the slide is up, and beside it the QR code
   that takes the room to the observatory. The graph is built once from a
   fixed seed, so it is the same on the server, in the browser and in the
   room. */

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

/** Seconds between two levels of the looping wave. */
const WAVE_STEP = 0.45;

function Observatory({ t }: { t: T }) {
  const s = t.presentation.slides.observatory;
  const wave = (level: number) =>
    ({ '--d': `${level * WAVE_STEP}s`, '--c': levelColour(level, MOCK.maxLevel) }) as CSSProperties;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} lead={s.lead} />
      <div className={styles.tryIt}>
        <div className={`${styles.browser} ${styles.rise}`} style={at(0.2)}>
          <div className={styles.browserBar}>
            <span className={styles.lights} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className={`mono ${styles.url}`}>{s.url}</span>
          </div>
          <svg viewBox="-132 -118 264 236" className={styles.mock} aria-hidden="true">
            {MOCK.edges.map((e, i) =>
              e.tree ? (
                <line
                  key={i}
                  className={styles.mockEdge}
                  style={wave(MOCK.nodes[e.b].level)}
                  x1={MOCK.nodes[e.a].x}
                  y1={MOCK.nodes[e.a].y}
                  x2={MOCK.nodes[e.b].x}
                  y2={MOCK.nodes[e.b].y}
                />
              ) : (
                <line
                  key={i}
                  className={styles.mockChord}
                  x1={MOCK.nodes[e.a].x}
                  y1={MOCK.nodes[e.a].y}
                  x2={MOCK.nodes[e.b].x}
                  y2={MOCK.nodes[e.b].y}
                />
              ),
            )}
            {MOCK.nodes.map((n, i) => (
              <circle
                key={i}
                className={styles.mockNode}
                style={wave(n.level)}
                cx={n.x}
                cy={n.y}
                r={n.level === 0 ? 5 : 3.4}
              />
            ))}
          </svg>
          <dl className={styles.facts}>
            {s.facts.map((fact, i) => (
              <div
                key={fact.label}
                className={`${styles.fact} ${styles.rise}`}
                style={at(0.6 + i * 0.1)}
              >
                <dt className="label">{fact.label}</dt>
                <dd className={`mono ${styles.factValue}`}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={`${styles.qr} ${styles.rise}`} style={at(0.4)}>
          <p className={`label ${styles.scan}`}>{s.scan}</p>
          <a href={`https://${s.url}`} className={styles.qrCard} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, drawn at build */}
            <img src="/brand/qr-observatory.svg" alt={s.url} width={280} height={280} />
          </a>
          <p className={`mono ${styles.qrUrl}`}>{s.url}</p>
          <p className="comment">{s.browsers}</p>
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
