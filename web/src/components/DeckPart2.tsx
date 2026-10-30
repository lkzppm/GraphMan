'use client';

// Part 2's slides: weights as a column beside the graph, one Dijkstra over
// six frontiers, their times and their memory on the course's weighted
// graphs, and the shortest paths the case study asks for. The words are
// the dictionary's; the numbers come from studies/weighted/results.json
// (synced as src/data/weighted.json), and until the study has run the
// results slides say so instead of showing anything made up.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Fragment, useState, type CSSProperties } from 'react';
import { siRust } from 'simple-icons';
import {
  formatBytes,
  formatCompact,
  formatInt,
  formatMs,
  formatPercent,
  formatWeight,
} from '@/lib/format';
import { logScale, TIME_SCALES, type TimeScale } from '@/lib/scale';
import {
  peakEntries,
  type FrontierKind,
  type FrontierStudy,
  type MemoryStudy,
  type PathAnswer,
  type WeightedStudy,
} from '@/lib/studies';
import { PORTRAIT_HEIGHT, PORTRAIT_PATH, PORTRAIT_WIDTH } from './dijkstra-portrait';
import BrandIcon from './BrandIcon';
import { at, Bar, Head, type T } from './deck-kit';
import styles from './Deck.module.css';

/* ---- 01 weights: a column beside the graph ---------------------------------
   The handout's Figure 1 read left to right: the file with its third
   column, the normalising step, then the CSR arrays it becomes with the
   weights as one more array parallel to the targets. Under it, three notes:
   the graph trait never reads the column, the weighted trait does, and the
   negative edge of the figure is refused rather than answered. */

/** Figure 1 of the Part 2 handout: `u v weight`, five vertices. */
const FIGURE_1: readonly [number, number, string][] = [
  [1, 2, '0.1'],
  [2, 5, '0.2'],
  [5, 3, '5'],
  [3, 4, '-9.5'],
  [4, 5, '2.3'],
  [1, 5, '1'],
];
const FIGURE_1_N = 5;

/** The CSR the library builds from Figure 1: per vertex its neighbours
    ascending, each with the weight of the edge to it. */
function figureCsr() {
  const rows = Array.from({ length: FIGURE_1_N + 1 }, () => [] as [number, string][]);
  for (const [u, v, w] of FIGURE_1) {
    rows[u].push([v, w]);
    rows[v].push([u, w]);
  }
  const offsets = [0];
  const cells: { target: number; weight: string; vertex: number }[] = [];
  for (let v = 1; v <= FIGURE_1_N; v++) {
    rows[v].sort((a, b) => a[0] - b[0]);
    for (const [target, weight] of rows[v]) cells.push({ target, weight, vertex: v });
    offsets.push(cells.length);
  }
  return { offsets, cells };
}

const CSR = figureCsr();

export function Weights({ t }: { t: T }) {
  const s = t.presentation.slides.part2.weights;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.weightsMap}>
        {/* the handout's file, the weight column in blue */}
        <div className={`${styles.side} ${styles.pop}`} style={at(0.2)}>
          <p className="label">{s.input.label}</p>
          <div className={`mono ${styles.textFile}`}>
            <span className={styles.textFileName}>{s.input.name}</span>
            <span>{FIGURE_1_N}</span>
            {FIGURE_1.map(([u, v, w]) => (
              <span key={`${u}-${v}`} data-negative={w.startsWith('-') || undefined}>
                {u} {v} <b>{w}</b>
              </span>
            ))}
          </div>
          <p className="comment">{s.input.hint}</p>
        </div>

        <div className={styles.step}>
          <svg className={styles.edge} viewBox="0 0 48 12" aria-hidden="true" style={at(0.45)}>
            <circle className={styles.edgeTail} cx="4" cy="6" r="3" />
            <line className={styles.edgeLine} x1="4" y1="6" x2="38" y2="6" pathLength={1} />
            <path className={styles.edgeHead} d="M 37 1.5 L 46 6 L 37 10.5 z" />
          </svg>
          <span className={`mono ${styles.stepName} ${styles.pop}`} style={at(0.7)}>
            {s.normalise.name}
          </span>
          <span className={`comment ${styles.stepHint} ${styles.pop}`} style={at(0.8)}>
            {s.normalise.hint}
          </span>
        </div>

        {/* the arrays: offsets, targets, and the weights beside the targets */}
        <div className={`${styles.arrays} ${styles.pop}`} style={at(0.9)}>
          <p className={`label ${styles.arraysLabel}`}>
            <BrandIcon icon={siRust} size={16} className={styles.coreIcon} />
            {s.arrays.label}
          </p>
          <div className={styles.arrayRow}>
            <span className={`mono ${styles.arrayName}`}>{s.arrays.offsets}</span>
            <span className={styles.cells}>
              {CSR.offsets.map((offset, i) => (
                <span
                  key={i}
                  className={`mono ${styles.cell} ${styles.pop}`}
                  style={at(1.05 + i * 0.04)}
                >
                  {offset}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.arrayRow}>
            <span className={`mono ${styles.arrayName}`}>{s.arrays.targets}</span>
            <span className={styles.cells}>
              {CSR.cells.map((cell, i) => (
                <span
                  key={i}
                  className={`mono ${styles.cell} ${styles.pop}`}
                  data-row-start={CSR.offsets.includes(i) || undefined}
                  style={at(1.3 + i * 0.04)}
                >
                  {cell.target}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.arrayRow} data-weights="true">
            <span className={`mono ${styles.arrayName}`}>{s.arrays.weights}</span>
            <span className={styles.cells}>
              {CSR.cells.map((cell, i) => (
                <span
                  key={i}
                  className={`mono ${styles.cell} ${styles.weightCell} ${styles.pop}`}
                  data-row-start={CSR.offsets.includes(i) || undefined}
                  data-negative={cell.weight.startsWith('-') || undefined}
                  style={at(1.9 + i * 0.05)}
                >
                  {cell.weight}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>

      <ol className={styles.steps} data-count="3">
        {s.notes.map((note, i) => (
          <li
            key={note.title}
            className={`${styles.stepItem} ${styles.rise}`}
            style={at(2.6 + i * 0.12)}
          >
            <span className={`mono ${styles.stepIndex}`}>{String(i + 1).padStart(2, '0')}</span>
            <h3 className={styles.stepTitle}>{note.title}</h3>
            <span className={`comment ${styles.caption}`}>{note.caption}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---- 02 one Dijkstra, 03 six priority queues -------------------------------
   02: the trait and the driver as the library writes them, beside Dijkstra
   in line art. 03: the six ways of keeping the estimates, each a figure
   that runs when the slide arrives: the vector scanned end to end, the
   indexed heap where a lowered key sifts up, the lazy heap where a stale
   copy is skipped; then the 4-ary heap (one level to climb, not two), the
   pairing heap (cut and meld) and the radix heap (buckets by bits). */

const CODE = `pub trait Frontier {
    fn reset(&mut self, vertex_count: usize);
    fn decrease(&mut self, v: Vertex, distance: Weight);
    fn pop_min(&mut self) -> Option<(Vertex, Weight)>;
    …
}

pub fn dijkstra_into<G, F, V>(
    graph: &G, root: Vertex, frontier: &mut F,
    tree: &mut ShortestPathTree, visitor: &mut V,
) -> Result<(), NegativeWeight>
where
    G: Weighted, F: Frontier, V: Visitor,`;

/** The code with Rust's keywords and the trait's names picked out. */
function highlight(code: string) {
  return code
    .split(/(\b(?:pub|trait|fn|mut|self|Self|where)\b|\b(?:Frontier|Weighted|dijkstra_into)\b)/)
    .map((part, i) =>
      /^(pub|trait|fn|mut|self|Self|where)$/.test(part) ? (
        <span key={i} className={styles.kw}>
          {part}
        </span>
      ) : /^(Frontier|Weighted|dijkstra_into)$/.test(part) ? (
        <span key={i} className={styles.name}>
          {part}
        </span>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

/** The vector: nine estimates, a cursor scanning all of them, the smallest lit. */
function FigVector() {
  const estimates = ['∞', '4', '∞', '2.5', '7', '∞', '1.5', '∞', '3'];
  const smallest = 6;
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {estimates.map((value, i) => (
        <g key={i}>
          <rect
            x={3 + i * 18}
            y="34"
            width="16"
            height="22"
            rx="2"
            className={i === smallest ? styles.figMin : styles.figCell}
            style={i === smallest ? at(2.2) : undefined}
          />
          <text className={styles.figValue} x={11 + i * 18} y="49">
            {value}
          </text>
        </g>
      ))}
      <rect className={styles.figScan} style={at(0.2)} x="2" y="31" width="18" height="28" rx="3" />
      <text
        className={`${styles.figLabelCentre} ${styles.figFade}`}
        style={at(2.3)}
        x={11 + smallest * 18}
        y="72"
      >
        pop_min
      </text>
    </svg>
  );
}

/** The indexed heap: a key lowered at a leaf trades places with its parent
    and then the root, found through its position, not by a search. */
function FigHeap() {
  const nodes = [
    { x: 84, y: 16, value: '2' },
    { x: 46, y: 48, value: '3' },
    { x: 122, y: 48, value: '5' },
    { x: 26, y: 82, value: '4' },
    { x: 66, y: 82, value: '1' },
    { x: 104, y: 82, value: '6' },
    { x: 142, y: 82, value: '8' },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  // The lowered key (node 4) climbs to node 1, then to the root; the two it
  // passes step down into the places it left.
  const moves: Record<number, [number, number][]> = {
    4: [
      [nodes[1].x - nodes[4].x, nodes[1].y - nodes[4].y],
      [nodes[0].x - nodes[4].x, nodes[0].y - nodes[4].y],
    ],
    1: [
      [nodes[4].x - nodes[1].x, nodes[4].y - nodes[1].y],
      [nodes[4].x - nodes[1].x, nodes[4].y - nodes[1].y],
    ],
    0: [
      [0, 0],
      [nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y],
    ],
  };
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line
          key={`${a}-${b}`}
          className={styles.figEdge}
          style={at(0.1 + i * 0.06)}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          pathLength={1}
        />
      ))}
      {nodes.map((node, i) => {
        const move = moves[i];
        return (
          <g
            key={i}
            className={move ? styles.figSift : undefined}
            style={
              move
                ? ({
                    ...at(1.1),
                    '--x1': `${move[0][0]}px`,
                    '--y1': `${move[0][1]}px`,
                    '--x2': `${move[1][0]}px`,
                    '--y2': `${move[1][1]}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            <circle
              className={i === 4 ? styles.figKey : styles.figHeapNode}
              style={at(0.2 + i * 0.05)}
              cx={node.x}
              cy={node.y}
              r="9"
            />
            <text
              className={i === 4 ? styles.figKeyText : styles.figNodeText}
              x={node.x}
              y={node.y + 3.5}
            >
              {node.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The lazy heap as its array: vertex 3 was pushed twice, at 4 and later at
    2; when the old copy reaches the top it is stale, struck out and skipped. */
function FigLazy() {
  const entries = [
    { estimate: '1.5', vertex: 7 },
    { estimate: '2', vertex: 3 },
    { estimate: '3', vertex: 9 },
    { estimate: '4', vertex: 3, stale: true },
  ];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {entries.map((entry, i) => (
        <g key={i} className={styles.figFade} style={at(0.2 + i * 0.15)}>
          <rect
            x={4 + i * 40}
            y="28"
            width="36"
            height="34"
            rx="3"
            className={entry.stale ? styles.figCell : styles.figEntry}
          />
          <text className={styles.figValue} x={22 + i * 40} y="43">
            {entry.estimate}
          </text>
          <text className={styles.figLabelCentre} x={22 + i * 40} y="56">
            v{entry.vertex}
          </text>
        </g>
      ))}
      <g className={styles.figCross} style={at(1.4)}>
        <path d="M 128 30 L 160 60" pathLength={1} />
        <path d="M 160 30 L 128 60" pathLength={1} />
      </g>
    </svg>
  );
}

/** The 4-ary heap: four children under the root; a key lowered at one of
    them climbs one level, a binary heap would have climbed two. */
function FigQuad() {
  const root = { x: 84, y: 18 };
  const children = [
    { x: 24, value: '3' },
    { x: 64, value: '5' },
    { x: 104, value: '1' },
    { x: 144, value: '8' },
  ];
  const key = 2;
  const y = 62;
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {children.map((child, i) => (
        <line
          key={i}
          className={styles.figEdge}
          style={at(0.1 + i * 0.06)}
          x1={root.x}
          y1={root.y}
          x2={child.x}
          y2={y}
          pathLength={1}
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <line
          key={`g${i}`}
          className={styles.figTrough}
          x1={children[0].x}
          y1={y + 9}
          x2={children[0].x - 12 + i * 8}
          y2={y + 26}
        />
      ))}
      <g
        className={styles.figSift}
        style={
          {
            ...at(1.1),
            '--x1': `${children[key].x - root.x}px`,
            '--y1': `${y - root.y}px`,
            '--x2': `${children[key].x - root.x}px`,
            '--y2': `${y - root.y}px`,
          } as CSSProperties
        }
      >
        <circle className={styles.figHeapNode} cx={root.x} cy={root.y} r="9" />
        <text className={styles.figNodeText} x={root.x} y={root.y + 3.5}>
          2
        </text>
      </g>
      {children.map((child, i) => (
        <g
          key={i}
          className={i === key ? styles.figSift : undefined}
          style={
            i === key
              ? ({
                  ...at(1.1),
                  '--x1': `${root.x - child.x}px`,
                  '--y1': `${root.y - y}px`,
                  '--x2': `${root.x - child.x}px`,
                  '--y2': `${root.y - y}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <circle
            className={i === key ? styles.figKey : styles.figHeapNode}
            cx={child.x}
            cy={y}
            r="9"
          />
          <text
            className={i === key ? styles.figKeyText : styles.figNodeText}
            x={child.x}
            y={y + 3.5}
          >
            {child.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** The pairing heap: a key lowered below the root's is cut from its
    parent and melded with the root; it wins, so the old root becomes its
    child. */
function FigPairing() {
  const root = { x: 84, y: 42 };
  const y = 76;
  const children = [
    { x: 40, value: '3' },
    { x: 84, value: '4' },
  ];
  const key = { x: 128, value: '0.5' };
  const top = { x: 84, y: 10 };
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {children.map((child, i) => (
        <line
          key={i}
          className={styles.figEdge}
          style={at(0.1 + i * 0.06)}
          x1={root.x}
          y1={root.y}
          x2={child.x}
          y2={y}
          pathLength={1}
        />
      ))}
      <line
        className={`${styles.figEdge} ${styles.figCutEdge}`}
        style={at(0.22)}
        x1={root.x}
        y1={root.y}
        x2={key.x}
        y2={y}
        pathLength={1}
      />
      <line
        className={styles.figEdge}
        style={at(2.9)}
        x1={top.x}
        y1={top.y}
        x2={root.x}
        y2={root.y}
        pathLength={1}
      />
      <circle className={styles.figHeapNode} cx={root.x} cy={root.y} r="9" />
      <text className={styles.figNodeText} x={root.x} y={root.y + 3.5}>
        1
      </text>
      {children.map((child, i) => (
        <g key={i}>
          <circle className={styles.figHeapNode} cx={child.x} cy={y} r="9" />
          <text className={styles.figNodeText} x={child.x} y={y + 3.5}>
            {child.value}
          </text>
        </g>
      ))}
      <g
        className={styles.figSift}
        style={
          {
            ...at(1.1),
            '--x1': `${top.x - key.x}px`,
            '--y1': `${top.y - y}px`,
            '--x2': `${top.x - key.x}px`,
            '--y2': `${top.y - y}px`,
          } as CSSProperties
        }
      >
        <circle className={styles.figKey} cx={key.x} cy={y} r="9" />
        <text className={styles.figKeyText} x={key.x} y={y + 3.5}>
          {key.value}
        </text>
      </g>
    </svg>
  );
}

/** The radix heap: buckets by the highest bit where a key differs from the
    last one popped (4). Popping 6 empties bucket 2 around it: 6 drops to
    bucket 0, equal to the new last, and 7 to bucket 1. No key is compared
    to order them; they only ever move down. */
function FigRadix() {
  const bucket = (b: number) => 8 + b * 32;
  const entries = [
    { value: '6', from: [2, 54], to: [0, 54], key: true },
    { value: '7', from: [2, 38], to: [1, 54], key: false },
    { value: '12', from: [4, 54], to: [4, 54], key: false },
  ];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((b) => (
        <g key={b}>
          <path
            className={styles.figTrough}
            d={`M ${bucket(b)} 26 V 70 H ${bucket(b) + 28} V 26`}
          />
          <text className={styles.figLabelCentre} x={bucket(b) + 14} y="82">
            {b === 0 ? '=' : b}
          </text>
        </g>
      ))}
      {entries.map((entry) => {
        const [b, y] = entry.from;
        const dx = bucket(entry.to[0]) - bucket(b);
        const dy = entry.to[1] - y;
        return (
          <g
            key={entry.value}
            className={styles.figSift}
            style={
              {
                ...at(1.1),
                '--x1': `${dx}px`,
                '--y1': `${dy}px`,
                '--x2': `${dx}px`,
                '--y2': `${dy}px`,
              } as CSSProperties
            }
          >
            <rect
              x={bucket(b) + 2}
              y={y}
              width="24"
              height="14"
              rx="2"
              className={entry.key ? styles.figKey : styles.figEntry}
            />
            <text
              className={entry.key ? styles.figKeyText : styles.figValue}
              x={bucket(b) + 14}
              y={y + 10}
            >
              {entry.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const FRONTIER_FIGURES = [FigVector, FigHeap, FigLazy, FigQuad, FigPairing, FigRadix];

/** Dijkstra's algorithm as the library writes it, once, against a
    frontier, beside the man in line art. */
export function Dijkstra({ t }: { t: T }) {
  const s = t.presentation.slides.part2.dijkstra;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.dijkstraSlide}>
        <div className={styles.dijkstraCode}>
          <div className={`${styles.codeCard} ${styles.rise}`} style={at(0.2)}>
            <pre className="mono">{highlight(CODE)}</pre>
            <p className="comment">{s.driver}</p>
          </div>
          <p className={`comment ${styles.ties} ${styles.rise}`} style={at(0.6)}>
            {s.ties}
          </p>
        </div>
        <figure className={styles.portrait}>
          <svg
            viewBox={`0 0 ${PORTRAIT_WIDTH} ${PORTRAIT_HEIGHT}`}
            className={styles.portraitArt}
            style={at(0.3)}
            role="img"
            aria-label={s.portrait.name}
          >
            <path d={PORTRAIT_PATH} fillRule="evenodd" />
          </svg>
          <figcaption className={`${styles.rise}`} style={at(1.6)}>
            <span className={styles.portraitName}>{s.portrait.name}</span>
            <span className={`mono ${styles.portraitCredit}`}>{s.portrait.credit}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

/** Every priority queue the library has, a figure each: the course's
    three, then the three that go faster in practice. */
export function Frontiers({ t }: { t: T }) {
  const s = t.presentation.slides.part2.frontiers;
  const groups = [s.items.slice(0, 3), s.items.slice(3)];
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.queueGroups}>
        {groups.map((items, g) => (
          <section key={g} className={styles.queueGroup}>
            <p
              className={`label ${styles.queueGroupLabel} ${styles.rise}`}
              style={at(0.2 + g * 0.3)}
            >
              {s.groups[g]}
            </p>
            <ol className={styles.steps} data-count="3">
              {items.map((item, j) => {
                const i = g * 3 + j;
                const Figure = FRONTIER_FIGURES[i];
                return (
                  <li
                    key={item.name}
                    className={`${styles.stepItem} ${styles.rise}`}
                    style={at(0.3 + i * 0.1)}
                  >
                    <span className={styles.figWrap} style={at(0.8 + i * 0.35)}>
                      <Figure />
                    </span>
                    <span className={`mono ${styles.stepIndex}`}>{item.name}</span>
                    <h3 className={styles.stepTitle}>{item.title}</h3>
                    <span className={`mono ${styles.cost}`}>{item.cost}</span>
                    <span className={`comment ${styles.caption}`}>{item.caption}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      <p className={`comment ${styles.ties} ${styles.rise}`} style={at(2.4)}>
        {s.ties}
      </p>
    </div>
  );
}

/* ---- 05 vector against heap: one sheet ------------------------------------
   One row per weighted graph, a bar per frontier (all six) and how many
   times slower the vector is than the heap. A switch in the bars' head
   picks their scale: one log scale shared by every row; linear, the
   vector's time as each row's 100% and the others as shares of it; or
   linear without the vector, each row's slowest other frontier as 100%.
   The bars slide from one scale to the next. The link opens the case
   studies on Part 2. A frontier whose budget ran out before any run
   finished shows its estimate as a dashed bar. */

const FRONTIERS: FrontierKind[] = ['vector', 'heap', 'lazy_heap', 'quad_heap', 'pairing', 'radix'];
const FRONTIER_COLOURS: Record<FrontierKind, string> = {
  vector: 'var(--queue-vector)',
  heap: 'var(--queue-heap)',
  lazy_heap: 'var(--queue-lazy-heap)',
  quad_heap: 'var(--queue-quad-heap)',
  pairing: 'var(--queue-pairing)',
  radix: 'var(--queue-radix)',
};

/** A frontier's mean time, or its estimate when the budget cut every run. */
function frontierTime(study: WeightedStudy, kind: FrontierKind) {
  const run: FrontierStudy | undefined = study.frontiers.find((f) => f.frontier === kind);
  if (!run) return null;
  if (run.timing) return { ms: run.timing.mean_ms, estimated: false, run };
  if (run.partial) return { ms: run.partial.estimated_ms, estimated: true, run };
  return null;
}

/** `grafo_W_3` → `W3`, apart from Part 1's graph 3; any other name comes
    back whole. */
function weightedNumber(name: string): string {
  const match = /^grafo_w_?(\d+)$/i.exec(name);
  return match ? `W${match[1]}` : name;
}

function graphLabel(t: T, study: WeightedStudy) {
  return study.names_file
    ? t.presentation.slides.part2.network.label
    : t.studies.graph(weightedNumber(study.name));
}

export function Timing({ t, studies: all }: { t: T; studies: WeightedStudy[] }) {
  const s = t.presentation.slides.part2.timing;
  // The network is only asked for paths: it has no timings to show.
  const studies = all.filter((study) => study.frontiers.length > 0);
  const c = s.columns;
  const times = studies.flatMap((study) =>
    FRONTIERS.map((kind) => frontierTime(study, kind)?.ms ?? 0),
  );
  const scale = logScale(0.1, Math.max(1, ...times));
  const machine = studies.find((study) => study.machine)?.machine;
  const scales = t.studies.part2.timing.scales;
  const [mode, setMode] = useState<TimeScale>('log');
  // Once the scale has changed the bars slide instead of growing again.
  const [moved, setMoved] = useState(false);

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

      <div className={styles.sheet} data-moved={moved || undefined}>
        <div
          className={`label ${styles.sheetHead} ${styles.timingRow} ${styles.rise}`}
          style={at(0.2)}
        >
          <span>{c.graph}</span>
          <span>{c.size}</span>
          <span className={styles.timeHead}>
            {c.time}
            <span
              className={styles.scaleSwitch}
              role="group"
              aria-label={scales.label}
              style={{ '--i': TIME_SCALES.indexOf(mode) } as CSSProperties}
            >
              <span className={styles.scaleThumb} aria-hidden="true" />
              {TIME_SCALES.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={styles.scaleButton}
                  aria-pressed={mode === key}
                  title={scales.hint[key]}
                  onClick={() => {
                    setMode(key);
                    setMoved(true);
                  }}
                >
                  {scales[key]}
                </button>
              ))}
            </span>
          </span>
          <span className={styles.centre}>{c.ratio}</span>
        </div>
        {studies.length === 0 ? (
          <p className={`comment ${styles.pending} ${styles.rise}`} style={at(0.4)}>
            {s.pending}
          </p>
        ) : (
          studies.map((study, i) => {
            const d = 0.3 + i * 0.1;
            const vector = frontierTime(study, 'vector');
            const heap = frontierTime(study, 'heap');
            // The row's 100% on the two linear scales.
            const whole =
              mode === 'vector'
                ? (vector?.ms ?? 0)
                : Math.max(
                    0,
                    ...FRONTIERS.filter((kind) => kind !== 'vector').map(
                      (kind) => frontierTime(study, kind)?.ms ?? 0,
                    ),
                  );
            return (
              <div
                key={study.name}
                className={`${styles.row} ${styles.timingRow} ${styles.rise}`}
                style={at(d)}
              >
                <span className={styles.rowName}>{graphLabel(t, study)}</span>
                <span className={styles.size}>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.vertices)} <i>{t.studies.facts.vertices}</i>
                  </span>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.edges)} <i>{t.studies.facts.edges}</i>
                  </span>
                </span>
                <span className={styles.group} data-wide="true">
                  {FRONTIERS.map((kind, k) => {
                    const time = frontierTime(study, kind);
                    const colour = FRONTIER_COLOURS[kind];
                    const delay = d + 0.2 + k * 0.08;
                    if (!time)
                      return <Bar key={kind} width={0} colour={colour} value="·" delay={delay} />;
                    const runs = time.run.timing?.runs ?? 0;
                    const short = !time.estimated && runs < time.run.requested_runs;
                    // As a share of the vector, every bar but the vector's
                    // own says its percentage instead of its time.
                    const shown =
                      mode === 'vector' && kind !== 'vector' && vector
                        ? formatPercent((100 * time.ms) / vector.ms)
                        : time.estimated
                          ? s.estimated(formatMs(time.ms))
                          : formatMs(time.ms);
                    return (
                      <Bar
                        key={kind}
                        width={mode === 'log' ? scale(time.ms) : whole > 0 ? time.ms / whole : 0}
                        colour={colour}
                        ghost={time.estimated}
                        off={mode === 'heaps' && kind === 'vector'}
                        value={short ? `${shown} · ${runs}/${time.run.requested_runs}` : shown}
                        delay={delay}
                      />
                    );
                  })}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.8)}
                >
                  {vector && heap && heap.ms > 0
                    ? `×${formatCompact(Math.round(vector.ms / heap.ms))}`
                    : '·'}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(1.3)}>
        <p className={styles.note}>
          {scales.hint[mode]}{' '}
          {machine && s.machine(machine.cpu, formatBytes(machine.total_memory_bytes))}
        </p>
        <Link href="/studies#parte-2" className={`label ${styles.more}`}>
          {s.cta}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ---- 04 what each queue keeps, 06 memory, measured -----------------------
   04: the six queues again, as the arrays they own at one moment of a run
   on four vertices: a cell indexed by vertex outlined, an entry filled, a
   stale copy struck through, the room a growing array keeps dashed. A
   dashed tick marks n entries, which a heap with decrease-key never
   passes and the lazy heap does. 06: what they hold on the course's
   graphs, a bar per frontier scaled to the row's largest, the heap's peak
   against n, and the lazy heap's entries against the heap's. */

type MemoryCell = 'slot' | 'entry' | 'stale' | 'slack' | 'gap';

interface MemoryRowLayout {
  /** The field, as the library names it. */
  label: string;
  /** Bytes a cell: 4 for an index or a link, 8 for an estimate, 16 for an
      entry (an estimate and a vertex, padded). */
  bytes: number;
  /** `gap` separates two buckets. */
  cells: MemoryCell[];
}

const SLOTS: MemoryCell[] = ['slot', 'slot', 'slot', 'slot'];

/** Each queue at one moment of a run on four vertices, three of them in
    the frontier, one estimate lowered twice. */
const MEMORY_LAYOUTS: { rows: MemoryRowLayout[]; tick: boolean }[] = [
  {
    rows: [{ label: 'estimate', bytes: 8, cells: ['entry', 'slot', 'entry', 'entry'] }],
    tick: false,
  },
  {
    rows: [
      { label: 'position', bytes: 4, cells: SLOTS },
      { label: 'heap', bytes: 16, cells: ['entry', 'entry', 'entry', 'slack'] },
    ],
    tick: true,
  },
  {
    rows: [
      { label: 'latest', bytes: 8, cells: SLOTS },
      { label: 'heap', bytes: 16, cells: ['entry', 'stale', 'entry', 'stale', 'entry', 'slack'] },
    ],
    tick: true,
  },
  {
    rows: [
      { label: 'position', bytes: 4, cells: SLOTS },
      { label: 'heap', bytes: 16, cells: ['entry', 'entry', 'entry', 'slack'] },
    ],
    tick: true,
  },
  {
    rows: [
      { label: 'key', bytes: 8, cells: ['entry', 'slot', 'entry', 'entry'] },
      { label: 'child', bytes: 4, cells: SLOTS },
      { label: 'next', bytes: 4, cells: SLOTS },
      { label: 'prev', bytes: 4, cells: SLOTS },
    ],
    tick: false,
  },
  {
    rows: [
      { label: 'latest', bytes: 8, cells: SLOTS },
      {
        label: 'buckets',
        bytes: 16,
        cells: ['entry', 'stale', 'slack', 'gap', 'entry', 'entry', 'slack', 'slack'],
      },
    ],
    tick: true,
  },
];

const MEMORY_X0 = 34;
const MEMORY_GAP = 1.5;
const MEMORY_ROW = 11;
const MEMORY_STEP = 17;

/** Where every cell of a layout goes: one pixel a byte, rows centred. */
function memoryCells(rows: MemoryRowLayout[]) {
  const top = (96 - (rows.length * MEMORY_STEP - (MEMORY_STEP - MEMORY_ROW))) / 2;
  return rows.map((row, r) => {
    const y = top + r * MEMORY_STEP;
    const cells: { x: number; width: number; cell: Exclude<MemoryCell, 'gap'> }[] = [];
    let x = MEMORY_X0;
    for (const cell of row.cells) {
      if (cell === 'gap') {
        x += 5;
        continue;
      }
      cells.push({ x, width: row.bytes, cell });
      x += row.bytes + MEMORY_GAP;
    }
    return { label: row.label, entries: row.bytes === 16, y, cells };
  });
}

const CELL_CLASS: Record<Exclude<MemoryCell, 'gap'>, string> = {
  slot: styles.figCell,
  entry: styles.figEntry,
  stale: styles.figCell,
  slack: styles.figSlack,
};

/** A queue's arrays, a pixel a byte, the cells fading in in order. */
function FigMemory({
  rows,
  tick,
  delay,
}: {
  rows: MemoryRowLayout[];
  tick: boolean;
  delay: number;
}) {
  const laid = memoryCells(rows);
  const entryRows = laid.filter((row) => row.entries);
  // n entries of 16 bytes, from the start of the row.
  const tickX = MEMORY_X0 + 4 * (16 + MEMORY_GAP) - MEMORY_GAP / 2;
  const offsets = laid.map((_, r) =>
    laid.slice(0, r).reduce((sum, row) => sum + row.cells.length, 0),
  );
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {laid.map((row, r) => (
        <g key={r}>
          <text className={styles.figLabelEnd} x={MEMORY_X0 - 4} y={row.y + MEMORY_ROW / 2 + 2.3}>
            {row.label}
          </text>
          {row.cells.map(({ x, width, cell }, c) => (
            <g key={c} className={styles.figFade} style={at(delay + (offsets[r] + c) * 0.07)}>
              <rect
                x={x}
                y={row.y}
                width={width}
                height={MEMORY_ROW}
                rx="1.5"
                className={CELL_CLASS[cell]}
              />
              {cell === 'stale' && (
                <line
                  className={styles.figStrike}
                  x1={x + 3}
                  y1={row.y + MEMORY_ROW - 2.5}
                  x2={x + width - 3}
                  y2={row.y + 2.5}
                />
              )}
            </g>
          ))}
        </g>
      ))}
      {tick && entryRows.length > 0 && (
        <g className={styles.figFade} style={at(delay + 0.9)}>
          <line
            className={styles.figTick}
            x1={tickX}
            x2={tickX}
            y1={entryRows[0].y - 5}
            y2={entryRows[entryRows.length - 1].y + MEMORY_ROW + 4}
          />
          <text className={styles.figLabelCentre} x={tickX} y={entryRows[0].y - 7}>
            n
          </text>
        </g>
      )}
    </svg>
  );
}

/** The six queues as the memory they own: what grows with n, what grows
    with the relaxations, and the bound each keeps. */
export function Memory({ t }: { t: T }) {
  const s = t.presentation.slides.part2.memory;
  const groups = [s.items.slice(0, 3), s.items.slice(3)];
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.queueGroups}>
        {groups.map((items, g) => (
          <section key={g} className={styles.queueGroup}>
            <p
              className={`label ${styles.queueGroupLabel} ${styles.rise}`}
              style={at(0.2 + g * 0.3)}
            >
              {s.groups[g]}
            </p>
            <ol className={styles.steps} data-count="3">
              {items.map((item, j) => {
                const i = g * 3 + j;
                const layout = MEMORY_LAYOUTS[i];
                return (
                  <li
                    key={item.name}
                    className={`${styles.stepItem} ${styles.rise}`}
                    style={at(0.3 + i * 0.1)}
                  >
                    <span className={styles.figWrap}>
                      <FigMemory rows={layout.rows} tick={layout.tick} delay={0.7 + i * 0.3} />
                    </span>
                    <span className={`mono ${styles.stepIndex}`}>{item.name}</span>
                    <h3 className={styles.stepTitle}>{item.title}</h3>
                    <span className={`mono ${styles.cost}`}>{item.cost}</span>
                    <span className={`comment ${styles.caption}`}>{item.caption}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      <p className={`comment ${styles.ties} ${styles.rise}`} style={at(2.6)}>
        {s.key}
      </p>
    </div>
  );
}

/** What the queues held on the course's graphs: per graph, the bytes of
    each (bars scaled to the row's largest), the indexed heap's peak as a
    share of n, and how many entries the lazy heap held against it. */
export function MemoryMeasured({ t, studies: all }: { t: T; studies: WeightedStudy[] }) {
  const s = t.presentation.slides.part2.memoryMeasured;
  const legend = t.presentation.slides.part2.timing.legend;
  const c = s.columns;
  const studies = all.filter(
    (study): study is WeightedStudy & { memory: MemoryStudy } =>
      !study.names_file && !!study.memory && study.memory.frontiers.length > 0,
  );
  const largest = studies[studies.length - 1];

  return (
    <div className={styles.body}>
      <div className={styles.benchHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        <ul className={`${styles.legend} ${styles.rise}`} style={at(0.2)}>
          {legend.map((l) => (
            <li key={l.key} className={styles.legendItem}>
              <span className={styles.swatch} data-key={l.key} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.sheet}>
        <div
          className={`label ${styles.sheetHead} ${styles.timingRow} ${styles.memoryRow} ${styles.rise}`}
          style={at(0.2)}
        >
          <span>{c.graph}</span>
          <span>{c.size}</span>
          <span>{c.bytes}</span>
          <span className={styles.centre}>{c.peak}</span>
          <span className={styles.centre}>{c.lazy}</span>
        </div>
        {studies.length === 0 ? (
          <p className={`comment ${styles.pending} ${styles.rise}`} style={at(0.4)}>
            {s.pending}
          </p>
        ) : (
          studies.map((study, i) => {
            const d = 0.3 + i * 0.1;
            const { frontiers } = study.memory;
            const max = Math.max(1, ...frontiers.map((f) => f.allocated_bytes));
            const peak = (kind: FrontierKind) => {
              const lane = frontiers.find((f) => f.frontier === kind);
              return lane ? peakEntries(lane) : null;
            };
            const heap = peak('heap');
            const lazy = peak('lazy_heap');
            return (
              <div
                key={study.name}
                className={`${styles.row} ${styles.timingRow} ${styles.memoryRow} ${styles.rise}`}
                style={at(d)}
              >
                <span className={styles.rowName}>{graphLabel(t, study)}</span>
                <span className={styles.size}>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.vertices)} <i>{t.studies.facts.vertices}</i>
                  </span>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.edges)} <i>{t.studies.facts.edges}</i>
                  </span>
                </span>
                <span className={styles.group} data-wide="true">
                  {FRONTIERS.map((kind, k) => {
                    const lane = frontiers.find((f) => f.frontier === kind);
                    const colour = FRONTIER_COLOURS[kind];
                    const delay = d + 0.2 + k * 0.08;
                    if (!lane)
                      return <Bar key={kind} width={0} colour={colour} value="·" delay={delay} />;
                    return (
                      <Bar
                        key={kind}
                        width={lane.allocated_bytes / max}
                        colour={colour}
                        value={formatBytes(lane.allocated_bytes)}
                        delay={delay}
                      />
                    );
                  })}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.8)}
                >
                  {heap !== null ? s.share(Math.round((100 * heap) / study.vertices)) : '·'}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.9)}
                >
                  {heap && lazy !== null ? `×${(lazy / heap).toFixed(1)}` : '·'}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(1.3)}>
        <p className={styles.note}>
          {largest && s.note(graphLabel(t, largest), formatBytes(largest.memory.graph_bytes))}
        </p>
        <Link href="/studies#parte-2" className={`label ${styles.more}`}>
          {s.cta}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ---- 07 shortest paths, 08 names, 09 the network ---------------------------
   07: from vertex 10 to 20, 30, 40, 50 and 60 on every weighted graph, a
   grid of distances with the edge count and the path drawn as its
   vertices at their distance from the source. 08: how a names file
   becomes `VertexNames`, built from the six lines the study asks for: one
   string, the entries sorted by vertex, and the index sorted by name.
   09: from Edsger W. Dijkstra to the five researchers, each path spelled
   by name. */

/** A path as a line, a dot per vertex at its distance from the source:
    the ends filled, the vertices between them hollow. */
function PathTrack({ answer, delay }: { answer: PathAnswer; delay: number }) {
  const total = answer.distance ?? 0;
  const stops = answer.distances ?? [];
  if (total <= 0 || stops.length === 0) return <span className={styles.pathTrack} />;
  return (
    <span className={styles.pathTrack} data-drawn="true" style={at(delay)} aria-hidden="true">
      {stops.map((d, i) => (
        <span
          key={i}
          className={styles.pathStop}
          data-end={i === 0 || i === stops.length - 1 || undefined}
          style={{ left: `${(d / total) * 100}%`, ...at(delay + 0.1 + (d / total) * 0.6) }}
        />
      ))}
    </span>
  );
}

export function Paths({ t, studies }: { t: T; studies: WeightedStudy[] }) {
  const s = t.presentation.slides.part2.paths;
  const graphs = studies.filter((study) => !study.names_file);
  const targets = [...new Set(graphs.flatMap((study) => study.paths.map((p) => p.to)))].sort(
    (a, b) => a - b,
  );

  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.2)}>
        <p className="label">{s.label}</p>
        <p className="comment">{s.caption}</p>
        {graphs.length === 0 ? (
          <p className={`comment ${styles.pending}`}>{s.pending}</p>
        ) : (
          <div
            className={styles.distanceGrid}
            style={{ '--targets': targets.length } as CSSProperties}
          >
            <span />
            {targets.map((to) => (
              <span key={to} className={`mono ${styles.distanceHead}`}>
                {to}
              </span>
            ))}
            {graphs.map((study, i) => (
              <Fragment key={study.name}>
                <span className={styles.rowName}>{graphLabel(t, study)}</span>
                {targets.map((to, k) => {
                  const answer = study.paths.find((p) => p.to === to);
                  const reached = answer && answer.distance !== null;
                  const d = 0.5 + i * 0.15 + k * 0.05;
                  return (
                    <span
                      key={to}
                      className={`${styles.distanceCell} ${styles.figFade}`}
                      style={at(d)}
                    >
                      <span className={`mono ${styles.distanceValue}`}>
                        {reached ? formatWeight(answer.distance as number) : '∞'}
                      </span>
                      <span className={styles.distanceHops}>
                        {reached ? s.hops(answer.path.length - 1) : s.unreached}
                      </span>
                      {reached && <PathTrack answer={answer} delay={d + 0.3} />}
                    </span>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )}
      </section>
      <p className={`comment ${styles.ties} ${styles.rise}`} style={at(1.6)}>
        {s.key}
      </p>
    </div>
  );
}

/** The six lines of `rede_colaboracao_vertices.txt` the study asks for,
    with their real indices, in the file's order. */
const NAMED: readonly [number, string][] = [
  [2722, 'Edsger W. Dijkstra'],
  [5709, 'Jon M. Kleinberg'],
  [11365, 'Alan M. Turing'],
  [11386, 'Éva Tardos'],
  [343930, 'Daniel R. Figueiredo'],
  [471365, 'J. B. Kruskal'],
];

/** `VertexNames` as the library builds it from those six lines alone: the
    names end to end in one string (offsets in UTF-8 bytes), an entry per
    vertex holding its span, and the entries' indices sorted by name. */
function namesLayout() {
  const encoder = new TextEncoder();
  let offset = 0;
  const entries = NAMED.map(([vertex, name]) => {
    const start = offset;
    offset += encoder.encode(name).length;
    return { vertex, name, start, end: offset };
  });
  // Code-point order is byte order for these names, as Rust compares them.
  const byName = entries
    .map((_, i) => i)
    .sort((a, b) => (entries[a].name < entries[b].name ? -1 : 1));
  return { entries, byName };
}

const NAMES = namesLayout();

/** How a names file is read: the lines, the parse, and the structure that
    answers both ways (vertex to name, name to vertex). */
export function Names({ t }: { t: T }) {
  const s = t.presentation.slides.part2.names;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.namesMap}>
        <div className={`${styles.side} ${styles.pop}`} style={at(0.2)}>
          <p className="label">{s.input.label}</p>
          <div className={`mono ${styles.textFile} ${styles.namesFile}`}>
            <span className={styles.textFileName}>{s.input.name}</span>
            <span className={styles.namesElided}>⋮</span>
            {NAMED.map(([vertex, name]) => (
              <span key={vertex}>
                <b>{vertex}</b>,{name}
              </span>
            ))}
            <span className={styles.namesElided}>⋮</span>
          </div>
          <p className="comment">{s.input.hint}</p>
        </div>

        <div className={styles.step}>
          <svg className={styles.edge} viewBox="0 0 48 12" aria-hidden="true" style={at(0.45)}>
            <circle className={styles.edgeTail} cx="4" cy="6" r="3" />
            <line className={styles.edgeLine} x1="4" y1="6" x2="38" y2="6" pathLength={1} />
            <path className={styles.edgeHead} d="M 37 1.5 L 46 6 L 37 10.5 z" />
          </svg>
          <span className={`mono ${styles.stepName} ${styles.pop}`} style={at(0.7)}>
            {s.parse.name}
          </span>
          <span className={`comment ${styles.stepHint} ${styles.pop}`} style={at(0.8)}>
            {s.parse.hint}
          </span>
        </div>

        <div className={`${styles.arrays} ${styles.pop}`} style={at(0.9)}>
          <p className={`label ${styles.arraysLabel}`}>
            <BrandIcon icon={siRust} size={16} className={styles.coreIcon} />
            {s.arrays.label}
          </p>
          <div className={styles.arrayRow}>
            <span className={`mono ${styles.arrayName}`}>{s.arrays.text}</span>
            <span className={styles.nameText}>
              {NAMES.entries.map((entry, i) => (
                <span
                  key={entry.vertex}
                  className={`${styles.nameSpan} ${styles.pop}`}
                  style={at(1.05 + i * 0.08)}
                >
                  <span className="mono">{entry.name}</span>
                  <span className={`mono ${styles.nameOffset}`}>{entry.start}</span>
                </span>
              ))}
            </span>
          </div>
          <div className={styles.arrayRow}>
            <span className={`mono ${styles.arrayName}`}>{s.arrays.entries}</span>
            <span className={styles.cells}>
              {NAMES.entries.map((entry, i) => (
                <span
                  key={entry.vertex}
                  className={`mono ${styles.cell} ${styles.nameCell} ${styles.pop}`}
                  style={at(1.6 + i * 0.06)}
                >
                  <span>{entry.vertex}</span>
                  <span className={styles.nameCellNote}>
                    #{i} · {entry.start}‥{entry.end}
                  </span>
                </span>
              ))}
            </span>
          </div>
          <div className={styles.arrayRow} data-weights="true">
            <span className={`mono ${styles.arrayName}`}>{s.arrays.byName}</span>
            <span className={styles.cells}>
              {NAMES.byName.map((index, i) => (
                <span
                  key={index}
                  className={`mono ${styles.cell} ${styles.nameCell} ${styles.weightCell} ${styles.pop}`}
                  style={at(2.1 + i * 0.06)}
                >
                  <span>#{index}</span>
                  <span className={styles.nameCellNote}>{NAMES.entries[index].name}</span>
                </span>
              ))}
            </span>
          </div>
          <p className="comment">{s.cost}</p>
        </div>
      </div>

      <ol className={styles.steps} data-count="3">
        {s.notes.map((note, i) => (
          <li
            key={note.title}
            className={`${styles.stepItem} ${styles.rise}`}
            style={at(2.6 + i * 0.12)}
          >
            <span className={`mono ${styles.stepIndex}`}>{String(i + 1).padStart(2, '0')}</span>
            <h3 className={`mono ${styles.stepTitle}`}>{note.title}</h3>
            <span className={`comment ${styles.caption}`}>{note.caption}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** From Edsger W. Dijkstra to each researcher the course names: the
    distance, the path drawn to scale and spelled out name by name. */
export function Network({ t, studies }: { t: T; studies: WeightedStudy[] }) {
  const s = t.presentation.slides.part2.network;
  const network = studies.find((study) => study.names_file);

  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.2)}>
        <p className="label">
          {s.label}
          {network && (
            <span className={styles.networkFacts}>
              {s.facts(formatInt(network.vertices), formatInt(network.edges))}
            </span>
          )}
        </p>
        <p className="comment">{s.caption}</p>
        {!network ? (
          <p className={`comment ${styles.pending}`}>{s.pending}</p>
        ) : (
          <ol className={styles.namedPaths}>
            {network.paths.map((answer, i) => {
              const d = 0.5 + i * 0.15;
              const names = answer.names ?? answer.path.map(String);
              return (
                <li
                  key={answer.to}
                  className={`${styles.namedPath} ${styles.figFade}`}
                  style={at(d)}
                >
                  <span className={styles.namedTo}>{answer.to_name ?? answer.to}</span>
                  {answer.distance === null ? (
                    <span className={`comment ${styles.namedUnreached}`}>{s.unreached}</span>
                  ) : (
                    <>
                      <PathTrack answer={answer} delay={d + 0.2} />
                      <span className={`mono ${styles.distanceValue}`}>
                        {formatWeight(answer.distance)}
                      </span>
                      <span className={styles.distanceHops}>{s.hops(names.length - 1)}</span>
                      <span className={styles.namedRoute}>
                        {names.map((name, k) => (
                          <Fragment key={k}>
                            {k > 0 && <span className={styles.namedArrow}>→</span>}
                            <span data-end={k === 0 || k === names.length - 1 || undefined}>
                              {name}
                            </span>
                          </Fragment>
                        ))}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
