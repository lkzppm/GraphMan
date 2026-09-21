'use client';

import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Expand, Minimize2, Terminal } from 'lucide-react';
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
import type { DiameterMethod, GraphStudy, Representation } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import Constellation from './Constellation';
import { levelColour } from './GraphFigure';
import HeroMark from './HeroMark';
import Logo from './Logo';
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
 * bars of the benchmark sheet grow, the browser mock keeps a BFS wave
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
    <Decisions key="decisions" t={t} studies={studies} active={index === 2} />,
    <Benchmark key="benchmark" t={t} studies={studies} />,
    <TryIt key="try" t={t} />,
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

/** The head every slide but the cover wears: the slide's number and one word. */
function Head({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className={styles.head}>
      <p className={`mono ${styles.index} ${styles.rise}`} style={at(0)}>
        {eyebrow}
      </p>
      <h2 className={`${styles.title} ${styles.rise}`} style={at(0.08)}>
        {title}
      </h2>
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
          <HeroMark size={380} />
        </div>
        <div className={styles.coverText}>
          <p className="eyebrow">{s.eyebrow}</p>
          <h1 className={`mono ${styles.wordmark}`}>
            graphman<span className="accent">.</span>
          </h1>
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
   Read left to right: the course's file, the normalising step riding on the
   first edge, the library (one Rust crate: three ways to store a graph,
   drawn as what they are, and the algorithms written once over them), then
   an edge that forks to the two front ends. Edges draw in like the mark's,
   boxes pop in at the end of their edge. */

/** A horizontal edge with a vertex at its tail and an arrowhead at its head. */
function Edge({ delay }: { delay: number }) {
  return (
    <svg className={styles.edge} viewBox="0 0 48 12" aria-hidden="true" style={at(delay)}>
      <circle className={styles.edgeTail} cx="4" cy="6" r="3" />
      <line className={styles.edgeLine} x1="4" y1="6" x2="38" y2="6" pathLength={1} />
      <path className={styles.edgeHead} d="M 37 1.5 L 46 6 L 37 10.5 z" />
    </svg>
  );
}

/** An edge that forks: one vertex at the tail, two arrowheads. */
function Fork({ delay }: { delay: number }) {
  return (
    <svg className={styles.fork} viewBox="0 0 64 120" aria-hidden="true" style={at(delay)}>
      <circle className={styles.edgeTail} cx="5" cy="60" r="3" />
      <path
        className={styles.edgeLine}
        d="M 5 60 L 22 60 C 36 60, 38 30, 54 30"
        pathLength={1}
        style={at(delay)}
      />
      <path
        className={styles.edgeLine}
        d="M 5 60 L 22 60 C 36 60, 38 90, 54 90"
        pathLength={1}
        style={at(delay + 0.1)}
      />
      <path className={styles.edgeHead} d="M 53 25.5 L 62 30 L 53 34.5 z" style={at(delay)} />
      <path className={styles.edgeHead} d="M 53 85.5 L 62 90 L 53 94.5 z" style={at(delay + 0.1)} />
    </svg>
  );
}

/** An adjacency list: a column of vertices, each with its row of neighbours. */
function PictoList({ delay }: { delay: number }) {
  const rows = [4, 2, 3, 1];
  return (
    <svg viewBox="0 0 96 64" className={styles.picto} aria-hidden="true">
      {rows.map((count, r) => {
        const y = 10 + r * 15;
        return (
          <g key={r}>
            <rect
              className={styles.pictoHead}
              style={at(delay + r * 0.06)}
              x="6"
              y={y - 5}
              width="10"
              height="10"
              rx="2"
            />
            <line
              className={styles.pictoLine}
              style={at(delay + 0.1 + r * 0.06)}
              x1="16"
              y1={y}
              x2={22 + count * 14}
              y2={y}
              pathLength={1}
            />
            {Array.from({ length: count }, (_, i) => (
              <circle
                key={i}
                className={styles.pictoDot}
                style={at(delay + 0.2 + r * 0.06 + i * 0.05)}
                cx={28 + i * 14}
                cy={y}
                r="3.6"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** A bit matrix: a symmetric grid with a few bits set. */
function PictoMatrix({ delay }: { delay: number }) {
  const n = 6;
  const set = new Set(['0-1', '0-3', '1-2', '2-4', '3-4', '4-5', '1-5']);
  const on = (i: number, j: number) => set.has(`${i}-${j}`) || set.has(`${j}-${i}`);
  return (
    <svg viewBox="0 0 96 64" className={styles.picto} aria-hidden="true">
      {Array.from({ length: n * n }, (_, k) => {
        const i = Math.floor(k / n);
        const j = k % n;
        return (
          <rect
            key={k}
            className={on(i, j) ? styles.pictoBitOn : styles.pictoBit}
            style={at(delay + (i + j) * 0.04)}
            x={20 + j * 9.5}
            y={4 + i * 9.5}
            width="8"
            height="8"
            rx="1.5"
          />
        );
      })}
    </svg>
  );
}

/** Compressed sparse row: a short array of offsets over a long array of
    neighbours, each offset pointing at where its row starts. */
function PictoCsr({ delay }: { delay: number }) {
  const offsets = [0, 3, 5, 8];
  const width = 9;
  return (
    <svg viewBox="0 0 96 64" className={styles.picto} aria-hidden="true">
      {offsets.map((_, i) => (
        <rect
          key={`o${i}`}
          className={styles.pictoHead}
          style={at(delay + i * 0.05)}
          x={14 + i * 14}
          y="8"
          width="10"
          height="10"
          rx="2"
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={`n${i}`}
          className={styles.pictoCell}
          style={at(delay + 0.3 + i * 0.04)}
          x={6 + i * width}
          y="42"
          width={width - 1.5}
          height="10"
          rx="1.5"
        />
      ))}
      {offsets.slice(0, 3).map((o, i) => (
        <line
          key={`l${i}`}
          className={styles.pictoLine}
          style={at(delay + 0.5 + i * 0.08)}
          x1={19 + i * 14}
          y1="18"
          x2={6 + o * width + (width - 1.5) / 2}
          y2="42"
          pathLength={1}
        />
      ))}
    </svg>
  );
}

const PICTOS = [PictoList, PictoMatrix, PictoCsr];

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
        <div className={`${styles.core} ${styles.pop}`} style={at(0.9)}>
          <div className={styles.coreHead}>
            <BrandIcon icon={siRust} size={30} className={styles.coreIcon} />
            <span className={`mono ${styles.coreName}`}>{s.core.name}</span>
            <span className={`comment ${styles.coreHint}`}>{s.core.hint}</span>
          </div>
          <ul className={styles.reps}>
            {s.reps.map((r, i) => {
              const Picto = PICTOS[i];
              return (
                <li
                  key={r.name}
                  className={`${styles.rep} ${styles.pop}`}
                  style={at(1.1 + i * 0.15)}
                >
                  <Picto delay={1.2 + i * 0.15} />
                  <span className={`mono ${styles.repName}`}>{r.name}</span>
                  <span className={`mono ${styles.repHint}`}>{r.hint}</span>
                </li>
              );
            })}
          </ul>
          <div className={`${styles.algos} ${styles.rise}`} style={at(1.9)}>
            <p className={`label ${styles.algoRow}`}>
              {s.algos.map((a, i) => (
                <span key={a}>
                  {i > 0 && <span className={styles.algoDot}>·</span>}
                  {a}
                </span>
              ))}
            </p>
            <p className="comment">{s.generic}</p>
          </div>
        </div>

        <div className={styles.step}>
          <Fork delay={2.2} />
        </div>

        {/* the two front ends */}
        <div className={styles.side}>
          <div className={`${styles.output} ${styles.pop}`} style={at(2.5)}>
            <Terminal
              size={26}
              strokeWidth={1.6}
              className={styles.outputIcon}
              aria-hidden="true"
            />
            <span className={`mono ${styles.outputName}`}>{s.outputs[0].name}</span>
            <span className={styles.outputHint}>{s.outputs[0].hint}</span>
          </div>
          <div className={`${styles.output} ${styles.pop}`} style={at(2.6)}>
            <BrandIcon icon={siWebassembly} size={26} className={styles.outputIcon} />
            <span className={`mono ${styles.outputName}`}>{s.outputs[1].name}</span>
            <span className={styles.outputHint}>{s.outputs[1].hint}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- 02 decisions: five figures --------------------------------------------
   Five columns under one rule, each a figure drawn in a 168 × 96 box that
   runs once when the slide arrives; it holds no words except numbers, so it
   reads the same in both languages. The title and the mono caption are the
   dictionary's. */

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

/** Seconds between two runs of the decision figures while their slide is up. */
const DECISIONS_LOOP = 5200;

function Decisions({ t, studies, active }: { t: T; studies: GraphStudy[]; active: boolean }) {
  const s = t.presentation.slides.decisions;
  // The figures loop: while the slide is current a timer remounts them, so
  // every animation inside restarts with its delays intact. Leaving the
  // slide stops the timer; coming back starts a fresh run.
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setCycle((c) => c + 1), DECISIONS_LOOP);
    return () => window.clearInterval(id);
  }, [active]);
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
      <ol className={styles.steps}>
        {s.items.map((item, i) => (
          <li
            key={item.title}
            className={`${styles.stepItem} ${styles.rise}`}
            style={at(0.15 + i * 0.1)}
          >
            <span key={cycle} className={styles.figWrap} style={at(0.5 + i * 0.3)}>
              {figures[i]}
            </span>
            <span className={`mono ${styles.stepIndex}`}>{String(i + 1).padStart(2, '0')}</span>
            <h3 className={styles.stepTitle}>{item.title}</h3>
            <span className={`comment ${styles.caption}`}>
              {item.caption}
              {i === 4 && shown && ` ${s.on(t.studies.graph(graphNumber(shown.name)))}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---- 03 benchmark: one sheet ----------------------------------------------
   One row per graph, three bars per measure (one per representation) on
   shared log scales: memory after loading, mean BFS, mean DFS. Then the
   component count and the best diameter answer. Everything else lives on
   the case-studies page, which the button under the sheet opens. */

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

const REPRESENTATIONS: Representation[] = ['adjacency_list', 'adjacency_matrix', 'csr'];
const REP_COLOURS: Record<Representation, string> = {
  adjacency_list: 'var(--accent)',
  adjacency_matrix: 'var(--accent-2)',
  csr: 'var(--level-0)',
};

function Benchmark({ t, studies }: { t: T; studies: GraphStudy[] }) {
  const s = t.presentation.slides.studies;
  const c = s.columns;

  const rep = (study: GraphStudy, r: Representation) =>
    study.representations.find((x) => x.representation === r);
  const footprint = (study: GraphStudy, r: Representation) => {
    const m = rep(study, r)?.memory;
    if (!m || !m.feasible) return null;
    return m.footprint_bytes ?? m.resident_bytes;
  };
  const timing = (study: GraphStudy, r: Representation, algo: 'bfs' | 'dfs') =>
    rep(study, r)?.[algo]?.mean_ms ?? null;

  // Both scales run over every graph and representation, so a bar's length
  // means the same on every row.
  const bytes = studies.flatMap((study) =>
    REPRESENTATIONS.map((r) => footprint(study, r)).filter((b): b is number => b !== null),
  );
  const times = studies.flatMap((study) =>
    REPRESENTATIONS.flatMap((r) => (['bfs', 'dfs'] as const).map((a) => timing(study, r, a) ?? 0)),
  );
  const memoryScale = logScale(1 << 20, Math.max(1 << 21, ...bytes));
  const timeScale = logScale(0.1, Math.max(1, ...times));

  const memoryBar = (study: GraphStudy, r: Representation, delay: number) => {
    const m = rep(study, r)?.memory;
    const colour = REP_COLOURS[r];
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
  const timeBar = (study: GraphStudy, r: Representation, algo: 'bfs' | 'dfs', delay: number) => {
    const ms = timing(study, r, algo);
    const colour = REP_COLOURS[r];
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
      <div className={styles.benchHead}>
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
          <span>{c.bfs}</span>
          <span>{c.dfs}</span>
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
                {REPRESENTATIONS.map((r, k) => (
                  <span key={r}>{memoryBar(study, r, d + 0.2 + k * 0.08)}</span>
                ))}
              </span>
              <span className={styles.group}>
                {REPRESENTATIONS.map((r, k) => (
                  <span key={r}>{timeBar(study, r, 'bfs', d + 0.4 + k * 0.08)}</span>
                ))}
              </span>
              <span className={styles.group}>
                {REPRESENTATIONS.map((r, k) => (
                  <span key={r}>{timeBar(study, r, 'dfs', d + 0.5 + k * 0.08)}</span>
                ))}
              </span>
              <span
                className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                style={at(d + 0.8)}
              >
                {formatInt(study.components.count)}
              </span>
              <span className={`${styles.centre} ${styles.figFade}`} style={at(d + 0.9)}>
                {diameter(study)}
              </span>
            </div>
          );
        })}
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(1.3)}>
        <p className={styles.note}>
          {machine && s.machine(machine.cpu, formatBytes(machine.total_memory_bytes))}
        </p>
        <Link href="/studies" className={`label ${styles.more}`}>
          {s.cta}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ---- 04 try it: the site in a browser, and the QR code ---------------------
   A browser frame showing the site's front: the mark and the wordmark on
   the left, a BFS drawn on the canvas's level ramp on the right, its wave
   looping level by level while the slide is up. Beside it the QR code that
   takes the room to the home page. The graph is built once from a fixed
   seed, so it is the same on the server, in the browser and in the room. */

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

function TryIt({ t }: { t: T }) {
  const s = t.presentation.slides.observatory;
  const wave = (level: number) =>
    ({ '--d': `${level * WAVE_STEP}s`, '--c': levelColour(level, MOCK.maxLevel) }) as CSSProperties;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
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
          <div className={styles.site}>
            <div className={`${styles.siteBrand} ${styles.rise}`} style={at(0.5)}>
              <Logo size={72} shake={false} />
              <span className={`mono ${styles.siteWordmark}`}>
                graphman<span className="accent">.</span>
              </span>
              <span className="eyebrow">{t.presentation.slides.cover.eyebrow}</span>
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
          </div>
        </div>

        <div className={`${styles.qr} ${styles.rise}`} style={at(0.4)}>
          <p className={`label ${styles.scan}`}>{s.scan}</p>
          <a href={`https://${s.url}`} className={styles.qrCard} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, drawn at build */}
            <img src="/brand/qr-home.svg" alt={s.url} width={300} height={300} />
          </a>
          <a
            href={`https://${s.url}`}
            className={`mono ${styles.qrUrl}`}
            target="_blank"
            rel="noreferrer"
          >
            {s.url}
          </a>
          <p className={`comment ${styles.browsers}`}>{s.browsers}</p>
        </div>
      </div>
    </div>
  );
}
