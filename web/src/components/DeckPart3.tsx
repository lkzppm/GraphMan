'use client';

// Part 3's slides: direction as data, one Bellman-Ford over six schedules,
// the negative cycle it returns, one Floyd-Warshall over four sweeps, then
// the four questions of the case study. The words are the dictionary's; the
// numbers come from studies/directed/results.json (synced as
// src/data/directed.json), and until the study has run the results slides
// say so instead of showing anything made up. The figures of the first six
// slides run on one five-vertex sample digraph, and what they show is
// computed here from it: the passes of the queue schedule, the rounds of
// Floyd-Warshall, so every number on them is what the algorithm does.

import Link from 'next/link';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Fragment, useState, type CSSProperties } from 'react';
import { formatBytes, formatCompact, formatInt, formatMs, formatWeight } from '@/lib/format';
import { logScale } from '@/lib/scale';
import {
  cellTime,
  findCell,
  stoppedAtCycle,
  type AlgorithmTiming,
  type DirectedStudy,
  type NegativeCycle,
  type PathAnswer,
} from '@/lib/studies';
import { at, Bar, Head, type T } from './deck-kit';
import { CycleRing } from './StudiesPart3';
import styles from './Deck.module.css';

/* ---- the sample: five vertices, six arcs, one of them negative ------------ */

type Point = readonly [number, number];
type Arc = readonly [number, number, number];

const SAMPLE_N = 5;
/** `tail head weight`, in the order the file lists them. */
const SAMPLE: readonly Arc[] = [
  [1, 2, 4],
  [1, 3, 2],
  [2, 4, 3],
  [3, 2, -1],
  [3, 5, 5],
  [4, 5, 1],
];
const VERTICES = Array.from({ length: SAMPLE_N }, (_, i) => i + 1);
/** Where each vertex sits in a 248 × 200 box (row 0 unused). */
const SPOT: readonly Point[] = [
  [0, 0],
  [36, 100],
  [124, 36],
  [124, 164],
  [212, 36],
  [212, 164],
];
/** The side of each arc its weight is written on: away from the others. */
const WEIGHT_SIDE: readonly number[] = [-1, 1, -1, 1, 1, -1];
const RADIUS = 14;

/** Rounded, so the server and the browser write the same attribute. */
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A weight as the slides write it, with a minus sign. */
const signed = (w: number) =>
  !Number.isFinite(w) ? '∞' : w < 0 ? `−${formatWeight(-w)}` : formatWeight(w);

/** An arc from `a` to `b` between two circles: the line, its arrowhead, and
    the middle and normal its label is placed by. */
function arrow(a: Point, b: Point, radius = RADIUS, head = 7) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const tipX = b[0] - ux * radius;
  const tipY = b[1] - uy * radius;
  const baseX = tipX - ux * head;
  const baseY = tipY - uy * head;
  const px = -uy * head * 0.5;
  const py = ux * head * 0.5;
  return {
    x1: r2(a[0] + ux * radius),
    y1: r2(a[1] + uy * radius),
    x2: r2(baseX),
    y2: r2(baseY),
    head: `M ${r2(tipX)} ${r2(tipY)} L ${r2(baseX + px)} ${r2(baseY + py)} L ${r2(baseX - px)} ${r2(baseY - py)} Z`,
    mx: (a[0] + b[0]) / 2,
    my: (a[1] + b[1]) / 2,
    nx: -uy,
    ny: ux,
  };
}

/** Where the weight of arc `index` is written: beside its middle, outside. */
function weightSpot(index: number): Point {
  const [u, v] = SAMPLE[index];
  const a = arrow(SPOT[u], SPOT[v]);
  const side = WEIGHT_SIDE[index];
  return [r2(a.mx + a.nx * 13 * side), r2(a.my + a.ny * 13 * side)];
}

/** Appears at `from` and leaves at `to`; without `to` it stays, and it is
    then what a reader who asked for no motion sees. */
function span(from: number, to?: number): CSSProperties {
  const style: Record<string, string> = { '--d': `${r2(from)}s` };
  if (to !== undefined) style['--e'] = `${r2(to)}s`;
  return style as CSSProperties;
}

/** An arc's weight; a negative one is outlined, as in Part 2's figure. */
function WeightLabel({
  x,
  y,
  weight,
  delay,
}: {
  x: number;
  y: number;
  weight: number;
  delay: number;
}) {
  const text = signed(weight);
  const half = r2(4 + text.length * 3.3);
  return (
    <g className={styles.figFade} style={at(delay)}>
      {weight < 0 && (
        <rect
          className={styles.p3Negative}
          x={r2(x - half)}
          y={y - 8}
          width={r2(half * 2)}
          height={16}
          rx={4}
        />
      )}
      <text className={styles.p3Weight} x={x} y={y} dy="0.35em">
        {text}
      </text>
    </g>
  );
}

/** The sample digraph, or its transpose: the same places, every arc turned. */
function Digraph({
  reversed = false,
  muted = false,
  delay,
}: {
  reversed?: boolean;
  /** Grey arcs, for a figure that lights its own on top. */
  muted?: boolean;
  delay: number;
}) {
  return (
    <>
      {SAMPLE.map(([u, v, w], i) => {
        const g = reversed ? arrow(SPOT[v], SPOT[u]) : arrow(SPOT[u], SPOT[v]);
        const [lx, ly] = weightSpot(i);
        const d = delay + 0.3 + i * 0.12;
        return (
          <g key={`${u}-${v}`} data-muted={muted || undefined}>
            <line
              className={styles.p3Arc}
              style={at(d)}
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              pathLength={1}
            />
            <path className={styles.p3Head} style={at(d + 0.35)} d={g.head} />
            <WeightLabel x={lx} y={ly} weight={w} delay={d + 0.45} />
          </g>
        );
      })}
      {VERTICES.map((v) => (
        <g key={v} className={styles.p3Vertex} style={at(delay + v * 0.06)}>
          <circle cx={SPOT[v][0]} cy={SPOT[v][1]} r={RADIUS} />
          <text x={SPOT[v][0]} y={SPOT[v][1]} dy="0.35em">
            {v}
          </text>
        </g>
      ))}
    </>
  );
}

/** The architecture map's edge with a name riding on it. */
function Step({ name, hint, delay }: { name: string; hint: string; delay: number }) {
  return (
    <div className={styles.step}>
      <svg className={styles.edge} viewBox="0 0 48 12" aria-hidden="true" style={at(delay)}>
        <circle className={styles.edgeTail} cx="4" cy="6" r="3" />
        <line className={styles.edgeLine} x1="4" y1="6" x2="38" y2="6" pathLength={1} />
        <path className={styles.edgeHead} d="M 37 1.5 L 46 6 L 37 10.5 z" />
      </svg>
      <span className={`mono ${styles.stepName} ${styles.pop}`} style={at(delay + 0.25)}>
        {name}
      </span>
      <span className={`comment ${styles.stepHint} ${styles.pop}`} style={at(delay + 0.35)}>
        {hint}
      </span>
    </div>
  );
}

/** Three numbered notes under a slide's drawing. */
function Notes({ notes, delay }: { notes: { title: string; caption: string }[]; delay: number }) {
  return (
    <ol className={styles.steps} data-count="3">
      {notes.map((note, i) => (
        <li
          key={note.title}
          className={`${styles.stepItem} ${styles.rise}`}
          style={at(delay + i * 0.12)}
        >
          <span className={`mono ${styles.stepIndex}`}>{String(i + 1).padStart(2, '0')}</span>
          <h3 className={styles.stepTitle}>{note.title}</h3>
          <span className={`comment ${styles.caption}`}>{note.caption}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---- 01 direction: a flag and a transpose --------------------------------
   The file read left to right: the sample with its arcs, the normalising
   step, the digraph it becomes, then the transpose beside it, every arc
   turned. Under them, the three things direction changed and did not. */

export function Direction({ t }: { t: T }) {
  const s = t.presentation.slides.part3.direction;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.directionMap}>
        <div className={`${styles.side} ${styles.pop}`} style={at(0.2)}>
          <p className="label">{s.input.label}</p>
          <div className={`mono ${styles.textFile}`}>
            <span className={styles.textFileName}>{s.input.name}</span>
            <span>{SAMPLE_N}</span>
            {SAMPLE.map(([u, v, w]) => (
              <span key={`${u}-${v}`} data-negative={w < 0 || undefined}>
                {u} {v} <b>{signed(w)}</b>
              </span>
            ))}
          </div>
          <p className="comment">{s.input.hint}</p>
        </div>

        <Step name={s.normalise.name} hint={s.normalise.hint} delay={0.45} />

        <figure className={`${styles.p3Panel} ${styles.rise}`} style={at(0.8)}>
          <p className={`label ${styles.p3PanelLabel}`}>{s.graph.label}</p>
          <svg viewBox="0 0 248 200" className={styles.p3Graph} aria-hidden="true">
            <Digraph delay={0.9} />
          </svg>
          <figcaption className="comment">{s.graph.hint}</figcaption>
        </figure>

        <Step name={s.transpose.name} hint={s.transpose.hint} delay={2.0} />

        <figure className={`${styles.p3Panel} ${styles.rise}`} style={at(2.3)}>
          <p className={`label ${styles.p3PanelLabel}`}>{s.reverse.label}</p>
          <svg viewBox="0 0 248 200" className={styles.p3Graph} aria-hidden="true">
            <Digraph reversed delay={2.4} />
          </svg>
          <figcaption className="comment">{s.reverse.hint}</figcaption>
        </figure>
      </div>
      <Notes notes={s.notes} delay={3.4} />
    </div>
  );
}

/* ---- 02 one Bellman-Ford: the trait, and a run toward vertex 5 -----------
   The schedule trait and the driver as the library writes them, beside the
   queue schedule's run on the sample toward vertex 5: on the transpose, so
   every distance is a distance to 5. Each pass rings the vertices it scans,
   writes the estimates that went down, lights each vertex's arc toward the
   target, and shows the queue the next pass will scan; the negative arc
   lowers vertex 3 in the third pass, after it was settled once, which is
   what Dijkstra cannot do. It stops when the queue is empty. */

const CODE = `pub trait Schedule {
    fn reset(&mut self, vertex_count: usize, start: Start);
    fn next(&mut self) -> Option<Vertex>;
    fn lowered(&mut self, v: Vertex, distance: &[Weight]);
    fn passes(&self) -> usize;
    …
}

pub fn bellman_ford_into<G, S, V>(
    graph: &G, start: Start, schedule: &mut S,
    tree: &mut ShortestPathTree, visitor: &mut V,
) -> Result<(), NegativeCycle>
where
    G: Weighted, S: Schedule, V: Visitor,`;

const BF_NAMES = ['Schedule', 'Weighted', 'bellman_ford_into', 'NegativeCycle'];
const KEYWORDS = [
  'pub',
  'trait',
  'impl',
  'enum',
  'fn',
  'mut',
  'self',
  'Self',
  'where',
  'for',
  'in',
  'let',
  'if',
  'continue',
];

/** The code with Rust's keywords greyed and the names it is about in blue. */
function highlight(code: string, names: readonly string[]) {
  const keywords = new Set(KEYWORDS);
  const named = new Set(names);
  return code.split(new RegExp(`\\b(${[...KEYWORDS, ...names].join('|')})\\b`)).map((part, i) =>
    i % 2 === 1 && keywords.has(part) ? (
      <span key={i} className={styles.kw}>
        {part}
      </span>
    ) : i % 2 === 1 && named.has(part) ? (
      <span key={i} className={styles.name}>
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

interface Change {
  v: number;
  distance: number;
  /** The next vertex toward the target. */
  successor: number;
}

interface Pass {
  /** What the pass scanned (the start scans nothing). */
  scanned: number[];
  /** The estimates that went down, in order. */
  changes: Change[];
  /** What the next pass scans. */
  queue: number[];
}

/** The queue schedule on the sample toward `target`: Bellman-Ford from it
    on the transpose, a FIFO with an in-queue bit, one entry per pass (the
    first is the start). */
function towardTarget(target: number): Pass[] {
  const inArcs: [number, number][][] = Array.from({ length: SAMPLE_N + 1 }, () => []);
  for (const [u, v, w] of SAMPLE) inArcs[v].push([u, w]);
  for (const row of inArcs) row.sort((a, b) => a[0] - b[0]);
  const distance = Array<number>(SAMPLE_N + 1).fill(Infinity);
  distance[target] = 0;
  const passes: Pass[] = [
    { scanned: [], changes: [{ v: target, distance: 0, successor: 0 }], queue: [target] },
  ];
  let queue = [target];
  while (queue.length > 0) {
    const next: number[] = [];
    const changes: Change[] = [];
    queue.forEach((v, i) => {
      for (const [u, w] of inArcs[v]) {
        if (distance[v] + w < distance[u]) {
          distance[u] = distance[v] + w;
          changes.push({ v: u, distance: distance[u], successor: v });
          // Still waiting in this pass: it is scanned with its new estimate.
          const waiting = queue.indexOf(u) > i;
          if (!waiting && !next.includes(u)) next.push(u);
        }
      }
    });
    passes.push({ scanned: queue, changes, queue: next });
    queue = next;
  }
  return passes;
}

const TARGET = SAMPLE_N;
const TOWARD = towardTarget(TARGET);
const BF_START = 1.1;
const BF_PASS = 1.3;
const passAt = (p: number) => r2(BF_START + p * BF_PASS);
/** The moment the `j`-th change of pass `p` is written. */
const changeAt = (p: number, j: number) => (p === 0 ? passAt(0) : r2(passAt(p) + 0.4 + j * 0.32));

/** Per vertex, the estimates it shows and when; and the arc toward the
    target it lights, and when. */
function bfTimeline() {
  const values = VERTICES.map(() => [[0.8, '∞']] as [number, string][]);
  const successors = VERTICES.map(() => [] as [number, number][]);
  TOWARD.forEach((pass, p) =>
    pass.changes.forEach((change, j) => {
      const time = changeAt(p, j);
      values[change.v - 1].push([time, signed(change.distance)]);
      if (change.successor) successors[change.v - 1].push([time, change.successor]);
    }),
  );
  return { values, successors };
}

const BF_TIMELINE = bfTimeline();
/** Where each vertex's estimate is written: above, below, or for vertex 1
    above its left. */
const PILL: readonly Point[] = [
  [0, 0],
  [36, 72],
  [124, 10],
  [124, 190],
  [212, 10],
  [212, 190],
];

function FigBellmanFord({ t }: { t: T }) {
  const s = t.presentation.slides.part3.bellmanFord;
  const last = TOWARD.length - 1;
  const { values, successors } = BF_TIMELINE;
  const settle = r2(passAt(last) + 0.9);
  return (
    <svg viewBox="0 0 260 286" className={styles.p3Big} aria-hidden="true">
      {/* the pass, at the top */}
      {TOWARD.map((_, p) =>
        p === 0 ? null : (
          <text
            key={p}
            className={`${styles.p3Pass} ${styles.p3Show}`}
            style={span(passAt(p), p === last ? settle : passAt(p + 1))}
            x="130"
            y="14"
          >
            {s.pass(p)}
          </text>
        ),
      )}
      <text
        className={`${styles.p3Pass} ${styles.p3Show}`}
        style={span(settle)}
        data-final
        x="130"
        y="14"
      >
        {s.stop(last)}
      </text>

      <g transform="translate(6 34)">
        <Digraph muted delay={0.1} />
        {/* the arc toward the target each vertex holds */}
        {successors.map((history, k) =>
          history.map(([time, successor], i) => {
            const g = arrow(SPOT[k + 1], SPOT[successor]);
            const until = history[i + 1]?.[0];
            return (
              <g
                key={`${k}-${i}`}
                className={styles.p3Show}
                style={span(time, until)}
                data-final={until === undefined || undefined}
              >
                <line className={styles.p3Tree} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
                <path className={styles.p3TreeHead} d={g.head} />
              </g>
            );
          }),
        )}
        {/* the vertices each pass scans */}
        {TOWARD.map((pass, p) =>
          pass.scanned.map((v) => (
            <circle
              key={`${p}-${v}`}
              className={`${styles.p3Ring} ${styles.p3Show}`}
              style={span(passAt(p), passAt(p + 1))}
              cx={SPOT[v][0]}
              cy={SPOT[v][1]}
              r={RADIUS + 4}
            />
          )),
        )}
        {/* the estimates, each one replacing the last */}
        {VERTICES.map((v) => (
          <g key={v}>
            <rect
              className={`${styles.p3Pill} ${styles.figFade}`}
              style={at(0.7)}
              x={PILL[v][0] - 17}
              y={PILL[v][1] - 9}
              width="34"
              height="18"
              rx="9"
            />
            {values[v - 1].map(([time, text], i) => {
              const until = values[v - 1][i + 1]?.[0];
              return (
                <text
                  key={i}
                  className={`${styles.p3PillText} ${styles.p3Show}`}
                  style={span(time, until)}
                  data-final={until === undefined || undefined}
                  data-lowered={i > 0 || undefined}
                  x={PILL[v][0]}
                  y={PILL[v][1]}
                  dy="0.35em"
                >
                  {text}
                </text>
              );
            })}
          </g>
        ))}
      </g>

      {/* the queue the next pass scans */}
      <text className={`${styles.p3Code} ${styles.figFade}`} style={at(0.9)} x="4" y="268">
        {s.queue}
      </text>
      {TOWARD.map((pass, p) => {
        const from = p === 0 ? passAt(0) + 0.2 : passAt(p) + 0.9;
        const until = p === last ? undefined : passAt(p + 1) + 0.9;
        return (
          <g
            key={p}
            className={styles.p3Show}
            style={span(from, until)}
            data-final={until === undefined || undefined}
          >
            {pass.queue.length === 0 ? (
              <text className={styles.p3Code} x="64" y="268">
                ∅
              </text>
            ) : (
              pass.queue.map((v, i) => (
                <g key={v}>
                  <rect
                    className={styles.p3QueueBox}
                    x={56 + i * 28}
                    y="254"
                    width="22"
                    height="20"
                    rx="3"
                  />
                  <text className={styles.p3QueueText} x={67 + i * 28} y="264" dy="0.35em">
                    {v}
                  </text>
                </g>
              ))
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function BellmanFord({ t }: { t: T }) {
  const s = t.presentation.slides.part3.bellmanFord;
  // The figure's replays: a new key mounts it again and its clock restarts.
  const [round, setRound] = useState(0);
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.dijkstraSlide}>
        <div className={styles.dijkstraCode}>
          <div className={`${styles.codeCard} ${styles.rise}`} style={at(0.2)}>
            <pre className="mono">{highlight(CODE, BF_NAMES)}</pre>
            <p className="comment">{s.driver}</p>
          </div>
          <p className={`comment ${styles.ties} ${styles.rise}`} style={at(0.6)}>
            {s.toTarget}
          </p>
        </div>
        <figure className={`${styles.p3Figure} ${styles.rise}`} style={at(0.3)}>
          <FigBellmanFord key={round} t={t} />
          <figcaption className={styles.p3FigureFoot}>
            <span className="comment">{s.figure}</span>
            <button
              type="button"
              className={styles.p3Replay}
              onClick={() => setRound((n) => n + 1)}
              aria-label={s.replay}
              title={s.replay}
            >
              <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

/* ---- 03 six schedules ------------------------------------------------------
   The six orders of re-examining vertices, a figure each: every vertex n − 1
   times; the same until a pass changes nothing; only what went down, in a
   queue; Yen's up and down sweeps by number, and over a random order; the
   queue as a deque where a closer vertex jumps to the front. */

/** Nine vertices as cells, numbered, at the height the scan cursor expects. */
function Cells() {
  return (
    <>
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i}>
          <rect x={3 + i * 18} y="30" width="16" height="22" rx="2" className={styles.figCell} />
          <text className={styles.figValue} x={11 + i * 18} y="44.5">
            {i + 1}
          </text>
        </g>
      ))}
    </>
  );
}

/** Rounds: the cursor sweeps every vertex, over and over. */
function FigRounds() {
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <Cells />
      <rect className={styles.figScan} style={at(0.2)} x="2" y="27" width="18" height="28" rx="3" />
      <text className={`${styles.figLabelCentre} ${styles.figFade}`} style={at(0.4)} x="84" y="76">
        × (n − 1)
      </text>
    </svg>
  );
}

/** Early stop: the first sweep lowers three estimates, the second lowers
    none, and the run ends. */
function FigEarlyStop() {
  const lowered = [1, 4, 6];
  const start = 0.2;
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <Cells />
      {lowered.map((i) => (
        <rect
          key={i}
          className={`${styles.p3Lowered} ${styles.p3Show}`}
          style={span(start + i * 0.24, start + 2.4 + i * 0.24)}
          x={3 + i * 18}
          y="30"
          width="16"
          height="22"
          rx="2"
        />
      ))}
      <rect
        className={styles.p3ScanTwice}
        style={at(start)}
        x="2"
        y="27"
        width="18"
        height="28"
        rx="3"
      />
      <text
        className={`${styles.figLabelCentre} ${styles.p3Show}`}
        style={span(start + 4.7)}
        data-final
        x="84"
        y="76"
      >
        Δ = 0
      </text>
    </svg>
  );
}

/** The queue: only the vertices whose estimate went down drop into it. */
function FigQueue() {
  const lowered = [2, 6, 1];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i}>
          <rect x={3 + i * 18} y="10" width="16" height="18" rx="2" className={styles.figCell} />
          <text className={styles.figValue} x={11 + i * 18} y="22">
            {i + 1}
          </text>
        </g>
      ))}
      <path className={styles.figTrough} d="M 34 58 H 140 M 34 80 H 140" />
      {lowered.map((cell, k) => (
        <g
          key={cell}
          className={styles.figSift}
          style={
            {
              ...at(0.3 + k * 0.5),
              '--x1': `${44 + k * 32 - (3 + cell * 18)}px`,
              '--y1': '50px',
              '--x2': `${44 + k * 32 - (3 + cell * 18)}px`,
              '--y2': '50px',
            } as CSSProperties
          }
        >
          <rect
            x={3 + cell * 18}
            y="10"
            width="16"
            height="18"
            rx="2"
            className={styles.figEntry}
          />
          <text className={styles.figValue} x={11 + cell * 18} y="22">
            {cell + 1}
          </text>
        </g>
      ))}
      <text className={styles.figLabelCentre} x="152" y="72">
        ←
      </text>
    </svg>
  );
}

/** Six vertices on a line in `order`, the up sweep's arcs above (to a later
    place), the down sweep's below (to an earlier one), each sweep drawing
    in its own direction. */
function FigSweeps({ order }: { order: readonly number[] }) {
  const x = (place: number) => 14 + place * 28;
  // Each sweep is a chain of arcs in its own direction, so the up sweep
  // draws left to right and the down sweep right to left.
  const up: [number, number][] = [
    [0, 1],
    [1, 3],
    [3, 5],
  ];
  const down: [number, number][] = [
    [5, 2],
    [2, 0],
  ];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {up.map(([a, b], i) => (
        <path
          key={`u${a}-${b}`}
          className={styles.figEdge}
          style={at(0.2 + i * 0.22)}
          d={`M ${x(a)} 41 Q ${(x(a) + x(b)) / 2} ${27 - 4 * (b - a)} ${x(b)} 41`}
          pathLength={1}
        />
      ))}
      {down.map(([a, b], i) => (
        <path
          key={`d${a}-${b}`}
          className={styles.figEdge}
          style={at(1.3 + i * 0.22)}
          d={`M ${x(a)} 55 Q ${(x(a) + x(b)) / 2} ${69 + 4 * (a - b)} ${x(b)} 55`}
          pathLength={1}
        />
      ))}
      {order.map((v, place) => (
        <g key={v}>
          <circle className={styles.figHeapNode} cx={x(place)} cy="48" r="7" />
          <text className={styles.figNodeText} x={x(place)} y="51.5">
            {v}
          </text>
        </g>
      ))}
      <text className={styles.figLabelEnd} x="166" y="12">
        u &lt; v
      </text>
      <text className={styles.figLabelEnd} x="166" y="92">
        u &gt; v
      </text>
    </svg>
  );
}

const IN_ORDER = [1, 2, 3, 4, 5, 6] as const;
/** A fixed shuffle, so the server and the browser draw the same one. */
const SHUFFLED = [4, 1, 6, 2, 5, 3] as const;

/** Small label first: the deque holds 3, 5 and 8; a lowered vertex at 2 is
    below the front's 3, so it goes in at the front, not the back. */
function FigSlf() {
  const slot = (k: number) => 22 + k * 32;
  const held = ['3', '5', '8'];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <path className={styles.figTrough} d="M 16 40 H 148 M 16 66 H 148" />
      {held.map((value, k) => (
        <g key={value} className={styles.figFade} style={at(0.2 + k * 0.12)}>
          <rect x={slot(k + 1)} y="44" width="26" height="18" rx="2" className={styles.figEntry} />
          <text className={styles.figValue} x={slot(k + 1) + 13} y="56">
            {value}
          </text>
        </g>
      ))}
      <g
        className={styles.figSift}
        style={
          {
            ...at(0.8),
            '--x1': `${slot(0) - 134}px`,
            '--y1': '0px',
            '--x2': `${slot(0) - 134}px`,
            '--y2': '34px',
          } as CSSProperties
        }
      >
        <rect x="134" y="10" width="26" height="18" rx="2" className={styles.figKey} />
        <text className={styles.figKeyText} x="147" y="22.5">
          2
        </text>
      </g>
      <text className={`${styles.figLabelCentre} ${styles.figFade}`} style={at(3)} x="35" y="82">
        2 &lt; 3
      </text>
    </svg>
  );
}

const SCHEDULE_FIGURES = [
  FigRounds,
  FigEarlyStop,
  FigQueue,
  () => <FigSweeps order={IN_ORDER} />,
  () => <FigSweeps order={SHUFFLED} />,
  FigSlf,
];

export function Schedules({ t }: { t: T }) {
  const s = t.presentation.slides.part3.schedules;
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
                const Figure = SCHEDULE_FIGURES[i];
                return (
                  <li
                    key={item.name}
                    className={`${styles.stepItem} ${styles.rise}`}
                    style={at(0.3 + i * 0.1)}
                  >
                    <span className={styles.figWrap}>
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

/* ---- 04 the negative cycle, returned --------------------------------------
   A walk going round a cycle of weight −1 that reaches the target: each
   lap lowers vertex 1's estimate and adds three arcs to its walk, until
   the walk has n arcs and cannot be simple; the parents then close the
   cycle, drawn in the one red, with its weight. Beside it, what the study
   found on the course's graphs: a cycle reaching the target, and one
   anywhere in the graph. */

const CYCLE_SPOT: readonly Point[] = [
  [0, 0],
  [56, 74],
  [150, 40],
  [124, 150],
  [250, 116],
];
/** 1 → 2 → 3 → 1 weighs 2 − 4 + 1 = −1; 3 → 4 reaches the target, 4. */
const CYCLE_ARCS: readonly Arc[] = [
  [1, 2, 2],
  [2, 3, -4],
  [3, 1, 1],
  [3, 4, 3],
];
const LAP_START = 1.4;
const LAP = 1.15;
const LAPS = 3;

function FigCycle() {
  const end = r2(LAP_START + LAP * LAPS);
  const [c1, c2, c3] = [CYCLE_SPOT[1], CYCLE_SPOT[2], CYCLE_SPOT[3]];
  return (
    <svg viewBox="0 0 290 196" className={styles.p3Big} aria-hidden="true">
      {CYCLE_ARCS.map(([u, v, w], i) => {
        const g = arrow(CYCLE_SPOT[u], CYCLE_SPOT[v]);
        // The cycle runs clockwise, so its arcs' normals point inside it.
        const side = i === 3 ? 1 : -1;
        const x = r2(g.mx + g.nx * 13 * side);
        const y = r2(g.my + g.ny * 13 * side);
        const d = 0.3 + i * 0.15;
        return (
          <g key={`${u}-${v}`}>
            <line
              className={styles.p3Arc}
              style={at(d)}
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              pathLength={1}
            />
            <path className={styles.p3Head} style={at(d + 0.35)} d={g.head} />
            {i < 3 && (
              <g className={styles.p3Show} style={span(end)} data-final>
                <line className={styles.p3CycleArc} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
                <path className={styles.p3CycleHead} d={g.head} />
              </g>
            )}
            <WeightLabel x={x} y={y} weight={w} delay={d + 0.45} />
          </g>
        );
      })}
      {[1, 2, 3, 4].map((v) => (
        <g
          key={v}
          className={styles.p3Vertex}
          data-target={v === 4 || undefined}
          style={at(0.1 + v * 0.06)}
        >
          <circle cx={CYCLE_SPOT[v][0]} cy={CYCLE_SPOT[v][1]} r={RADIUS} />
          <text x={CYCLE_SPOT[v][0]} y={CYCLE_SPOT[v][1]} dy="0.35em">
            {v === 4 ? 't' : v}
          </text>
        </g>
      ))}
      {/* the walk going round, a lap at a time */}
      <g className={styles.p3Show} style={span(LAP_START - 0.2, end)}>
        <circle
          className={styles.p3Token}
          style={
            {
              ...at(LAP_START),
              '--lap': `${LAP}s`,
              '--laps': LAPS,
              '--x1': `${c2[0] - c1[0]}px`,
              '--y1': `${c2[1] - c1[1]}px`,
              '--x2': `${c3[0] - c1[0]}px`,
              '--y2': `${c3[1] - c1[1]}px`,
            } as CSSProperties
          }
          cx={c1[0]}
          cy={c1[1]}
          r="5"
        />
      </g>
      {Array.from({ length: LAPS + 1 }, (_, k) => {
        const from = k === 0 ? LAP_START - 0.2 : LAP_START + k * LAP;
        const until = k === LAPS ? end : LAP_START + (k + 1) * LAP;
        return (
          <text
            key={k}
            className={`${styles.p3Code} ${styles.p3Show}`}
            style={span(from, until)}
            x="4"
            y="14"
          >
            hops[1] = {3 * k} · d[1] = {k === 0 ? '0' : `−${k}`}
          </text>
        );
      })}
      <text
        className={`${styles.p3CycleText} ${styles.p3Show}`}
        style={span(end)}
        data-final
        x="4"
        y="14"
      >
        hops[1] = n
      </text>
      <text
        className={`${styles.p3CycleText} ${styles.p3Centre} ${styles.p3Show}`}
        style={span(end + 0.3)}
        data-final
        x="110"
        y="88"
      >
        Σ = −1
      </text>
    </svg>
  );
}

/** A cycle as the CLI prints it, shortened in the middle when long. */
function cycleText(cycle: NegativeCycle) {
  const ids = cycle.cycle;
  const closed = [...ids, ids[0]];
  const shown =
    closed.length <= 7
      ? closed.map(String)
      : [...closed.slice(0, 3).map(String), '…', ...closed.slice(-2).map(String)];
  return shown.join(' → ');
}

/** `grafo_W_3` → `W3`; any other name comes back whole. */
function shortName(name: string): string {
  const match = /^grafo_w_?(\d+)$/i.exec(name);
  return match ? `W${match[1]}` : name;
}

function graphLabel(t: T, study: DirectedStudy) {
  return t.studies.graph(shortName(study.name));
}

export function Cycle({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.cycle;
  const verdict = (cycle: NegativeCycle | null) =>
    cycle ? (
      <span className={styles.certCycle}>
        <span className="mono">{cycleText(cycle)}</span>
        <span className={styles.certDetail}>
          {s.weight(signed(cycle.weight))} · {s.arcs(cycle.cycle.length)}
        </span>
      </span>
    ) : (
      <span className={styles.certNone}>{s.none}</span>
    );
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.cycleSlide}>
        <figure className={`${styles.p3Figure} ${styles.rise}`} style={at(0.2)}>
          <FigCycle />
          <figcaption className="comment">{s.figure}</figcaption>
        </figure>
        <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.5)}>
          <p className="label">{s.label}</p>
          {studies.length === 0 ? (
            <p className={`comment ${styles.pending}`}>{s.pending}</p>
          ) : (
            <div className={styles.certGrid}>
              <span />
              <span className={`label ${styles.certHead}`}>
                {s.toTarget(String(studies[0].target))}
              </span>
              <span className={`label ${styles.certHead}`}>{s.anywhere}</span>
              {studies.map((study, i) => (
                <Fragment key={study.name}>
                  <span className={`${styles.rowName} ${styles.figFade}`} style={at(0.7 + i * 0.1)}>
                    {graphLabel(t, study)}
                  </span>
                  <span className={styles.figFade} style={at(0.75 + i * 0.1)}>
                    {verdict(study.cycle_to_target)}
                  </span>
                  <span className={styles.figFade} style={at(0.8 + i * 0.1)}>
                    {verdict(study.cycle_anywhere)}
                  </span>
                </Fragment>
              ))}
            </div>
          )}
        </section>
      </div>
      <Notes notes={s.notes} delay={2.2} />
    </div>
  );
}

/* ---- 05 one Floyd-Warshall: the code, and the tables folding into one ----
   The sweep trait, the handle a sweep is given and the entry point as the
   library writes them, beside the sample's run. First the recurrence as it reads: n + 1
   tables, D⁰ to Dⁿ, dealt one on top of the other with their values, each
   lighting the row and column of its k (which it copies unchanged) and the
   cells it lowered. Then they collide back into the first one, and the
   same rounds run on that one table in place: round k lights row k and
   column k, and every cell that improves through k flashes and takes its
   new value. Beside it, what that one table costs on the course graphs. */

const FW_CODE = `pub trait Sweep {
    fn run(&mut self, table: &mut SweepTable<'_>) -> ControlFlow<()>;
    fn name(&self) -> &str;
}

impl SweepTable<'_> {
    pub fn round(&mut self, k: usize, keep: impl Fn(usize, Weight) -> bool);
    pub fn rounds_done(&mut self, rounds: usize) -> ControlFlow<()>;
    …
}

pub fn floyd_warshall<G: Weighted, S: Sweep>(
    graph: &G, sweep: S, budget: MemoryBudget,
) -> Result<AllPairs, FloydError>`;
const FW_NAMES = ['Sweep', 'SweepTable', 'floyd_warshall', 'AllPairs', 'FloydError', 'Weighted'];

interface Round {
  k: number;
  changes: { i: number; j: number; distance: number }[];
}

/** The sample's rounds, and the table after each: `tables[k]` is Dᵏ. */
function floydRounds() {
  const table = VERTICES.map((i) => VERTICES.map((j) => (i === j ? 0 : Infinity)));
  for (const [u, v, w] of SAMPLE) table[u - 1][v - 1] = Math.min(table[u - 1][v - 1], w);
  const tables = [table.map((row) => [...row])];
  const rounds: Round[] = [];
  for (let k = 0; k < SAMPLE_N; k++) {
    const changes: Round['changes'] = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      if (table[i][k] === Infinity) continue;
      for (let j = 0; j < SAMPLE_N; j++) {
        const through = table[i][k] + table[k][j];
        if (through < table[i][j]) {
          table[i][j] = through;
          changes.push({ i, j, distance: through });
        }
      }
    }
    rounds.push({ k, changes });
    tables.push(table.map((row) => [...row]));
  }
  return { tables, rounds };
}

const FLOYD = floydRounds();
/** When table Dᵏ of the stack is dealt. */
const dealAt = (k: number) => r2(0.4 + k * 0.42);
/** When the stack collides back into D⁰, and when it has landed. */
const COLLIDE = r2(dealAt(SAMPLE_N) + 0.85);
const LANDED = r2(COLLIDE + 0.75);
const FW_START = r2(LANDED + 0.45);
const FW_ROUND = 1;
const roundAt = (k: number) => r2(FW_START + k * FW_ROUND);
const FW_END = roundAt(SAMPLE_N);
const CELL_W = 40;
const CELL_H = 30;
/** The one table, which is also where D⁰ is dealt. */
const TABLE_X = 34;
const TABLE_Y = 60;
/** How far up and right each table of the stack sits from the last. */
const STACK = 7;
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const tableName = (k: number) => `D${SUPERSCRIPT[k]}`;

/** Table Dᵏ of the recurrence, at its place in the stack; it slides onto
    D⁰ and melts into it when the stack collides. */
function StackedTable({ k }: { k: number }) {
  const x = TABLE_X + k * STACK;
  const y = TABLE_Y - k * STACK;
  const before = FLOYD.tables[k - 1];
  const style = {
    ...span(dealAt(k)),
    '--c': `${COLLIDE}s`,
    '--x': `${-k * STACK}px`,
    '--y': `${k * STACK}px`,
  } as CSSProperties;
  return (
    <g className={styles.p3Card} style={style}>
      <rect
        className={styles.p3CardFrame}
        x={x}
        y={y}
        width={CELL_W * SAMPLE_N}
        height={CELL_H * SAMPLE_N}
        rx="3"
      />
      <rect
        className={styles.p3Cross}
        x={x}
        y={y + (k - 1) * CELL_H}
        width={CELL_W * SAMPLE_N}
        height={CELL_H}
      />
      <rect
        className={styles.p3Cross}
        x={x + (k - 1) * CELL_W}
        y={y}
        width={CELL_W}
        height={CELL_H * SAMPLE_N}
      />
      {FLOYD.tables[k].map((row, i) =>
        row.map((distance, j) => (
          <text
            key={`${i}-${j}`}
            className={styles.p3CellText}
            data-improved={distance < before[i][j] || undefined}
            data-infinite={distance === Infinity || undefined}
            x={x + j * CELL_W + CELL_W / 2}
            y={y + i * CELL_H + CELL_H / 2}
            dy="0.35em"
          >
            {signed(distance)}
          </text>
        )),
      )}
    </g>
  );
}

function FigFloyd() {
  // Each cell of the one table: its values and when it takes them.
  const history = FLOYD.tables[0].map((row) =>
    row.map((d) => [[dealAt(0), d]] as [number, number][]),
  );
  FLOYD.rounds.forEach((round) =>
    round.changes.forEach(({ i, j, distance }, c) =>
      history[i][j].push([r2(roundAt(round.k) + 0.35 + c * 0.12), distance]),
    ),
  );
  // What the label at the top says, and from when.
  const labels: [number, string][] = [
    ...VERTICES.map((_, k) => [dealAt(k), tableName(k)] as [number, string]),
    [dealAt(SAMPLE_N), tableName(SAMPLE_N)],
    [LANDED, 'D'],
    ...FLOYD.rounds.map(({ k }) => [roundAt(k), `k = ${k + 1}`] as [number, string]),
    [FW_END, 'D = Dⁿ'],
  ];
  return (
    <svg viewBox="0 0 270 232" className={styles.p3Big} aria-hidden="true">
      {labels.map(([time, text], i) => {
        const until = labels[i + 1]?.[0];
        return (
          <text
            key={i}
            className={`${styles.p3Pass} ${styles.p3Show}`}
            style={span(time, until)}
            data-final={until === undefined || undefined}
            x="135"
            y="14"
          >
            {text}
          </text>
        );
      })}

      {/* D⁰, which the stack lands on and which stays the one table */}
      <g
        className={styles.p3Base}
        style={{ ...at(dealAt(0)), '--c': `${LANDED - 0.1}s` } as CSSProperties}
      >
        <rect
          className={styles.p3CardFrame}
          x={TABLE_X}
          y={TABLE_Y}
          width={CELL_W * SAMPLE_N}
          height={CELL_H * SAMPLE_N}
          rx="3"
        />
      </g>
      {/* round k of the one table: its row and its column, which it never changes */}
      {FLOYD.rounds.map(({ k }) => (
        <g key={k} className={styles.p3Show} style={span(roundAt(k), roundAt(k + 1))}>
          <rect
            className={styles.p3Cross}
            x={TABLE_X}
            y={TABLE_Y + k * CELL_H}
            width={CELL_W * SAMPLE_N}
            height={CELL_H}
          />
          <rect
            className={styles.p3Cross}
            x={TABLE_X + k * CELL_W}
            y={TABLE_Y}
            width={CELL_W}
            height={CELL_H * SAMPLE_N}
          />
        </g>
      ))}
      {VERTICES.map((v, i) => (
        <g key={v} className={styles.figFade} style={at(LANDED)}>
          <text
            className={styles.figLabelCentre}
            x={TABLE_X + i * CELL_W + CELL_W / 2}
            y={TABLE_Y - 8}
          >
            {v}
          </text>
          <text
            className={styles.figLabelCentre}
            x={TABLE_X - 12}
            y={TABLE_Y + i * CELL_H + CELL_H / 2 + 2.5}
          >
            {v}
          </text>
        </g>
      ))}
      {history.map((row, i) =>
        row.map((cell, j) => {
          const x = TABLE_X + j * CELL_W;
          const y = TABLE_Y + i * CELL_H;
          return (
            <g key={`${i}-${j}`}>
              {cell.slice(1).map(([time], c) => (
                <rect
                  key={`f${c}`}
                  className={`${styles.p3Flash} ${styles.p3Show}`}
                  style={span(time, r2(time + 0.6))}
                  x={x + 3}
                  y={y + 3}
                  width={CELL_W - 6}
                  height={CELL_H - 6}
                  rx="2"
                />
              ))}
              {cell.map(([time, distance], c) => {
                const until = cell[c + 1]?.[0];
                return (
                  <text
                    key={c}
                    className={`${styles.p3CellText} ${styles.p3Show}`}
                    style={span(time, until)}
                    data-final={until === undefined || undefined}
                    data-improved={c > 0 || undefined}
                    data-infinite={distance === Infinity || undefined}
                    x={x + CELL_W / 2}
                    y={y + CELL_H / 2}
                    dy="0.35em"
                  >
                    {signed(distance)}
                  </text>
                );
              })}
            </g>
          );
        }),
      )}

      {/* D¹ to Dⁿ of the recurrence, each dealt on top of the last */}
      {FLOYD.rounds.map(({ k }) => (
        <StackedTable key={k} k={k + 1} />
      ))}
    </svg>
  );
}

/** Bytes a cell of Floyd-Warshall's tables: an 8-byte distance and a
    4-byte predecessor. */
const CELL_BYTES = 12;

export function Floyd({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.floyd;
  // The figure's replays: a new key mounts it again and its clock restarts.
  const [round, setRound] = useState(0);
  const memory = studies.find((study) => study.machine)?.machine?.total_memory_bytes ?? null;
  // The course's sizes, each with what its table needs, smallest first.
  const sizes = [
    ...new Map(
      studies.map((study) => [
        study.vertices,
        study.pairs?.table_bytes ?? CELL_BYTES * study.vertices * study.vertices,
      ]),
    ),
  ].sort((a, b) => a[0] - b[0]);
  const fitting = memory === null ? [] : sizes.filter(([, bytes]) => bytes <= memory);
  const fits = fitting[fitting.length - 1];
  const over = memory === null ? undefined : sizes.find(([, bytes]) => bytes > memory);
  const price =
    memory !== null && fits && over
      ? s.price(
          formatInt(fits[0]),
          formatBytes(fits[1]),
          formatInt(over[0]),
          formatBytes(over[1]),
          formatBytes(memory),
        )
      : s.noMachine;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.dijkstraSlide}>
        <div className={styles.dijkstraCode}>
          <div className={`${styles.codeCard} ${styles.rise}`} style={at(0.2)}>
            <pre className="mono">{highlight(FW_CODE, FW_NAMES)}</pre>
            <p className="comment">{s.driver}</p>
          </div>
          <p className={`comment ${styles.ties} ${styles.rise}`} style={at(0.6)}>
            {price}
          </p>
        </div>
        <figure className={`${styles.p3Figure} ${styles.rise}`} style={at(0.3)}>
          <FigFloyd key={round} />
          <figcaption className={styles.p3FigureFoot}>
            <span className={styles.p3Captions}>
              <span className={`comment ${styles.p3Show}`} style={span(0.3, LANDED)}>
                {s.stack}
              </span>
              <span className={`comment ${styles.p3Show}`} style={span(LANDED)} data-final>
                {s.one}
              </span>
            </span>
            <button
              type="button"
              className={styles.p3Replay}
              onClick={() => setRound((n) => n + 1)}
              aria-label={s.replay}
              title={s.replay}
            >
              <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

/* ---- 06 four sweeps ---------------------------------------------------------
   The same round k of the triple loop, walked four ways over a 6 × 6 table:
   row by row; skipping the rows that cannot reach k; three rows at once on
   three cores; by tiles, the diagonal one first, then its row and its
   column, then the rest. Each keeps looping while the slide is up. */

const SWEEP_N = 6;
const SWEEP_CELL = 11;
const SWEEP_X = 51;
const SWEEP_Y = 8;
const SWEEP_K = 2;

/** The table, with round k's row and column outlined. */
function SweepGrid({ skipped = [] as number[] }: { skipped?: number[] }) {
  return (
    <>
      {Array.from({ length: SWEEP_N * SWEEP_N }, (_, c) => {
        const i = Math.floor(c / SWEEP_N);
        const j = c % SWEEP_N;
        return (
          <rect
            key={c}
            className={skipped.includes(i) ? styles.figSlack : styles.figCell}
            x={SWEEP_X + j * SWEEP_CELL}
            y={SWEEP_Y + i * SWEEP_CELL}
            width={SWEEP_CELL - 2}
            height={SWEEP_CELL - 2}
            rx="1.5"
          />
        );
      })}
      <rect
        className={styles.p3Outline}
        x={SWEEP_X - 1.5}
        y={SWEEP_Y + SWEEP_K * SWEEP_CELL - 1.5}
        width={SWEEP_N * SWEEP_CELL + 1}
        height={SWEEP_CELL + 1}
        rx="2"
      />
      <rect
        className={styles.p3Outline}
        x={SWEEP_X + SWEEP_K * SWEEP_CELL - 1.5}
        y={SWEEP_Y - 1.5}
        width={SWEEP_CELL + 1}
        height={SWEEP_N * SWEEP_CELL + 1}
        rx="2"
      />
    </>
  );
}

/** A row of the table lighting up at `delay` in every loop. */
function RowPulse({ row, delay }: { row: number; delay: number }) {
  return (
    <rect
      className={styles.p3Pulse}
      style={at(delay)}
      x={SWEEP_X - 1}
      y={SWEEP_Y + row * SWEEP_CELL - 1}
      width={SWEEP_N * SWEEP_CELL}
      height={SWEEP_CELL}
      rx="2"
    />
  );
}

function SweepLabel({ children }: { children: string }) {
  return (
    <text className={styles.figLabelCentre} x="84" y="90">
      {children}
    </text>
  );
}

function FigPlain() {
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <SweepGrid />
      {Array.from({ length: SWEEP_N }, (_, i) => (
        <RowPulse key={i} row={i} delay={0.3 + i * 0.5} />
      ))}
      <SweepLabel>k = 3</SweepLabel>
    </svg>
  );
}

const PRUNED = [1, 4];

function FigPruned() {
  const kept = Array.from({ length: SWEEP_N }, (_, i) => i).filter((i) => !PRUNED.includes(i));
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <SweepGrid skipped={PRUNED} />
      {kept.map((i, k) => (
        <RowPulse key={i} row={i} delay={0.3 + k * 0.5} />
      ))}
      <SweepLabel>D[i][k] = ∞</SweepLabel>
    </svg>
  );
}

function FigParallel() {
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <SweepGrid />
      {Array.from({ length: SWEEP_N }, (_, i) => (
        <RowPulse key={i} row={i} delay={0.3 + Math.floor(i / 3) * 1.2} />
      ))}
      <SweepLabel>rayon</SweepLabel>
    </svg>
  );
}

function FigBlocked() {
  const tile = 3 * SWEEP_CELL;
  const tiles: { row: number; col: number; phase: number }[] = [
    { row: 0, col: 0, phase: 0 },
    { row: 0, col: 1, phase: 1 },
    { row: 1, col: 0, phase: 1 },
    { row: 1, col: 1, phase: 2 },
  ];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      <SweepGrid />
      {tiles.map(({ row, col, phase }) => (
        <rect
          key={`${row}-${col}`}
          className={styles.p3Pulse}
          data-long
          style={at(0.3 + phase * 0.9)}
          x={SWEEP_X - 1 + col * tile}
          y={SWEEP_Y - 1 + row * tile}
          width={tile}
          height={tile}
          rx="2"
        />
      ))}
      <path
        className={styles.p3TileLine}
        d={`M ${SWEEP_X + tile - 1} ${SWEEP_Y - 3} V ${SWEEP_Y + 2 * tile + 1} M ${SWEEP_X - 3} ${SWEEP_Y + tile - 1} H ${SWEEP_X + 2 * tile + 1}`}
      />
      <SweepLabel>B × B</SweepLabel>
    </svg>
  );
}

const SWEEP_FIGURES = [FigPlain, FigPruned, FigParallel, FigBlocked];

export function Sweeps({ t }: { t: T }) {
  const s = t.presentation.slides.part3.sweeps;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <ol className={styles.steps} data-count="4">
        {s.items.map((item, i) => {
          const Figure = SWEEP_FIGURES[i];
          return (
            <li
              key={item.name}
              className={`${styles.stepItem} ${styles.rise}`}
              style={at(0.2 + i * 0.12)}
            >
              <span className={styles.figWrap}>
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
      <p className={`comment ${styles.ties} ${styles.rise}`} style={at(1.4)}>
        {s.ties}
      </p>
    </div>
  );
}

/* ---- 07 question 1: Bellman-Ford to vertex 100 ----------------------------
   A grid of distances to the target, one row per graph and one column per
   source, each with its arc count and the path drawn to scale; a row whose
   target a negative cycle reaches says so instead, the cycle beside it.
   The last column is the queue schedule's work for the run. */

/** A path drawn to scale from its source: a dot per vertex at its distance
    from the source (the study writes each vertex's distance to the target,
    so it is the total less that). */
function PathTrack({ answer, delay }: { answer: PathAnswer; delay: number }) {
  const total = answer.distance ?? 0;
  const toTarget = answer.distances ?? [];
  if (total <= 0 || toTarget.length === 0) return <span className={styles.pathTrack} />;
  return (
    <span className={styles.pathTrack} data-drawn="true" style={at(delay)} aria-hidden="true">
      {toTarget.map((left, i) => {
        const share = Math.min(1, Math.max(0, (total - left) / total));
        return (
          <span
            key={i}
            className={styles.pathStop}
            data-end={i === 0 || i === toTarget.length - 1 || undefined}
            style={{ left: `${r2(share * 100)}%`, ...at(delay + 0.1 + share * 0.6) }}
          />
        );
      })}
    </span>
  );
}

export function Target({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.target;
  const target = studies[0]?.target ?? 100;
  const sources = studies.length
    ? [...new Set(studies.flatMap((study) => study.paths.map((p) => p.from)))].sort((a, b) => a - b)
    : [10, 20, 30];
  const columns = sources.length > 0 ? sources : [10, 20, 30];
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title(String(target))} />
      <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.2)}>
        <p className="label">{s.label(String(target))}</p>
        <p className="comment">{s.caption}</p>
        {studies.length === 0 ? (
          <p className={`comment ${styles.pending}`}>{s.pending}</p>
        ) : (
          <div
            className={`${styles.distanceGrid} ${styles.targetGrid}`}
            style={{ '--targets': columns.length } as CSSProperties}
          >
            <span />
            {columns.map((from) => (
              <span key={from} className={`mono ${styles.distanceHead}`}>
                {s.from(String(from))}
              </span>
            ))}
            <span className={`label ${styles.certHead}`}>{s.work}</span>
            {studies.map((study, i) => (
              <Fragment key={study.name}>
                <span className={styles.rowName}>{graphLabel(t, study)}</span>
                {study.cycle_to_target ? (
                  <span
                    className={`${styles.distanceCell} ${styles.targetCycle} ${styles.figFade}`}
                    style={{ gridColumn: `span ${columns.length}`, ...at(0.5 + i * 0.15) }}
                  >
                    {/* The cycle as the ring it is, as on the case-study page. */}
                    <span className={styles.targetRing}>
                      <CycleRing cycle={study.cycle_to_target} across />
                    </span>
                    <span className={styles.certCycle}>
                      {s.cycle(signed(study.cycle_to_target.weight))}
                    </span>
                  </span>
                ) : (
                  columns.map((from, k) => {
                    const answer = study.paths.find((p) => p.from === from);
                    const reached = answer && answer.distance !== null;
                    const d = 0.5 + i * 0.15 + k * 0.05;
                    return (
                      <span
                        key={from}
                        className={`${styles.distanceCell} ${styles.figFade}`}
                        style={at(d)}
                      >
                        <span className={`mono ${styles.distanceValue}`}>
                          {reached ? signed(answer.distance as number) : '∞'}
                        </span>
                        <span className={styles.distanceHops}>
                          {reached ? s.hops(answer.path.length - 1) : s.unreached}
                        </span>
                        {reached && <PathTrack answer={answer} delay={d + 0.3} />}
                      </span>
                    );
                  })
                )}
                <span className={`${styles.workCell} ${styles.figFade}`} style={at(0.7 + i * 0.15)}>
                  {study.counts ? (
                    <>
                      <span className="mono">{s.passes(formatInt(study.counts.passes))}</span>
                      <span className={styles.distanceHops}>
                        {s.scans(formatCompact(study.counts.scans))}
                      </span>
                    </>
                  ) : (
                    '·'
                  )}
                </span>
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

/* ---- 08 question 2: the table of five vertices ------------------------------
   The 5 × 5 table of one graph at a time, picked by the cover's pill with a
   place per graph, and how it was produced: Floyd-Warshall when its table
   fits, five Bellman-Fords when it does not (with what the table would
   have needed). A negative cycle leaves the table undefined and says so. */

export function Pairs({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.pairs;
  const answered = studies.filter((study) => study.pairs);
  const [view, setView] = useState(0);
  const shown = answered[Math.min(view, answered.length - 1)];
  const pairs = shown?.pairs ?? null;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      {!pairs || !shown ? (
        <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.2)}>
          <p className="label">{s.label}</p>
          <p className={`comment ${styles.pending}`}>{s.pending}</p>
        </section>
      ) : (
        <div className={styles.pairsSlide}>
          <div className={styles.repColumn}>
            <div
              className={`${styles.parts} ${styles.views} ${styles.graphViews} ${styles.pop}`}
              role="radiogroup"
              aria-label={s.viewsLabel}
              style={{ ...at(0.3), '--view': view, '--count': answered.length } as CSSProperties}
            >
              <span className={styles.partsThumb} aria-hidden="true" />
              {answered.map((study, i) => (
                <button
                  key={study.name}
                  type="button"
                  role="radio"
                  aria-checked={view === i}
                  className={styles.partButton}
                  onClick={() => setView(i)}
                >
                  {shortName(study.name)}
                </button>
              ))}
            </div>
            <div className={`${styles.arrays} ${styles.pop}`} style={at(0.5)}>
              <p className={`label ${styles.arraysLabel}`}>
                <span key={shown.name} className={styles.pairValue}>
                  {pairs.method === 'floyd-warshall'
                    ? s.byFloyd(formatBytes(pairs.table_bytes))
                    : s.byBellman(formatBytes(pairs.table_bytes))}
                </span>
              </p>
              <div className={styles.matrix}>
                <span
                  className={styles.pairsGrid}
                  style={{ '--n': pairs.vertices.length } as CSSProperties}
                >
                  <span className={`mono ${styles.matrixIndex}`}>{s.corner}</span>
                  {/* Keyed by place, so a new graph changes the cells instead
                      of replacing them; a value keyed by itself fades in. */}
                  {pairs.vertices.map((v, b) => (
                    <span key={b} className={`mono ${styles.matrixIndex}`}>
                      <span key={v} className={styles.pairValue}>
                        {v}
                      </span>
                    </span>
                  ))}
                  {pairs.vertices.map((u, a) => (
                    <Fragment key={a}>
                      <span className={`mono ${styles.matrixIndex}`}>
                        <span key={u} className={styles.pairValue}>
                          {u}
                        </span>
                      </span>
                      {pairs.vertices.map((v, b) => {
                        const d = pairs.distances[a]?.[b] ?? null;
                        // A negative cycle leaves the table undefined, not infinite.
                        const undefinedCell = pairs.negative_cycle !== null;
                        const text = undefinedCell ? '·' : d === null ? '∞' : signed(d);
                        return (
                          <span
                            key={b}
                            className={`mono ${styles.cell} ${styles.pairCell} ${undefinedCell || d === null || a === b ? styles.cellAbsent : styles.weightCell}`}
                          >
                            <span key={`${shown.name}-${text}`} className={styles.pairValue}>
                              {text}
                            </span>
                          </span>
                        );
                      })}
                    </Fragment>
                  ))}
                  {/* A cycle leaves the table undefined: it is drawn over the
                      cells, where the distances would be, as on the
                      case-study page. */}
                  {pairs.negative_cycle && (
                    <span
                      key={shown.name}
                      className={styles.pairsRing}
                      aria-label={cycleText(pairs.negative_cycle)}
                    >
                      <CycleRing cycle={pairs.negative_cycle} />
                    </span>
                  )}
                </span>
              </div>
              <div className={styles.pairsCycle}>
                {pairs.negative_cycle && (
                  <p key={shown.name} className={`${styles.certCycle} ${styles.pairValue}`}>
                    {s.cycle(signed(pairs.negative_cycle.weight))}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className={`${styles.pairsNotes} ${styles.rise}`} style={at(0.8)}>
            {s.notes.map((note) => (
              <div key={note.title} className={styles.pairsNote}>
                <h3 className={styles.stepTitle}>{note.title}</h3>
                <span className={`comment ${styles.caption}`}>{note.caption}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- 09 question 3: the mean time of every algorithm -----------------------
   One row per graph and one bar per variant of the family the switch picks:
   Bellman-Ford's six schedules, Floyd-Warshall's four sweeps, or BFS, DFS
   and Dijkstra for scale. One log scale over every cell of every family,
   so a bar means the same whichever is shown; a dashed bar is an estimate
   (a run the budget cut short, or a table that does not fit, timed on a
   smaller stand-in). The last column names the family's fastest. */

type Family = 'bellman' | 'floyd' | 'searches';
const FAMILIES: Family[] = ['bellman', 'floyd', 'searches'];

/** The cells a family shows, in order, with their colours. */
const FAMILY_CELLS: Record<Family, { algorithm: string; variant: string; colour: string }[]> = {
  bellman: [
    { algorithm: 'bellman-ford', variant: 'rounds', colour: 'var(--queue-vector)' },
    { algorithm: 'bellman-ford', variant: 'early-stop', colour: 'var(--queue-lazy-heap)' },
    { algorithm: 'bellman-ford', variant: 'queue', colour: 'var(--queue-heap)' },
    { algorithm: 'bellman-ford', variant: 'yen', colour: 'var(--queue-quad-heap)' },
    { algorithm: 'bellman-ford', variant: 'random-yen', colour: 'var(--queue-pairing)' },
    { algorithm: 'bellman-ford', variant: 'slf', colour: 'var(--queue-radix)' },
  ],
  floyd: [
    { algorithm: 'floyd-warshall', variant: 'plain', colour: 'var(--queue-vector)' },
    { algorithm: 'floyd-warshall', variant: 'pruned', colour: 'var(--queue-heap)' },
    { algorithm: 'floyd-warshall', variant: 'parallel', colour: 'var(--queue-quad-heap)' },
    { algorithm: 'floyd-warshall', variant: 'blocked', colour: 'var(--queue-pairing)' },
  ],
  searches: [
    { algorithm: 'bfs', variant: 'queue', colour: 'var(--accent)' },
    { algorithm: 'dfs', variant: 'iterative', colour: 'var(--level-0)' },
    { algorithm: 'dijkstra', variant: 'heap', colour: 'var(--accent-2)' },
  ],
};

/** A timing cell as a bar: its share of the shared scale, its value. */
function timingBar(
  cell: AlgorithmTiming | undefined,
  colour: string,
  scale: (ms: number) => number,
  delay: number,
  words: { estimated: (time: string) => string; refused: string; atCycle: string },
  key: string,
) {
  const time = cellTime(cell);
  if (!cell) return <Bar key={key} width={0} colour={colour} value="·" delay={delay} />;
  if (!time) return <Bar key={key} width={0} colour={colour} value={words.refused} delay={delay} />;
  const runs = time.cell.timing?.runs ?? 0;
  const short = !time.estimated && runs < time.cell.requested_runs;
  const shown = time.estimated ? words.estimated(formatMs(time.ms)) : formatMs(time.ms);
  return (
    <Bar
      key={key}
      width={scale(time.ms)}
      colour={colour}
      ghost={time.estimated}
      value={
        <>
          {short ? `${shown} · ${runs}/${time.cell.requested_runs}` : shown}
          {/* A run that stopped at a negative cycle timed the search for it. */}
          {stoppedAtCycle(time.cell) && (
            <span className={styles.p3AtCycle}> · {words.atCycle}</span>
          )}
        </>
      }
      delay={delay}
    />
  );
}

/** The scale every Part 3 sheet shares: from 1 µs to the slowest cell. */
function sharedScale(studies: DirectedStudy[]) {
  const times = studies.flatMap((study) =>
    [...study.timings, ...study.all_pairs].map((cell) => cellTime(cell)?.ms ?? 0),
  );
  return logScale(0.001, Math.max(1, ...times));
}

export function Timing({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.timing;
  const [family, setFamily] = useState<Family>('bellman');
  const [moved, setMoved] = useState(false);
  const scale = sharedScale(studies);
  const cells = FAMILY_CELLS[family];
  const legend = s.legend[family];
  const machine = studies.find((study) => study.machine)?.machine;
  const runs = Math.max(
    0,
    ...studies.flatMap((study) => study.timings.map((c) => c.requested_runs)),
  );
  return (
    <div className={styles.body}>
      <div className={styles.benchHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        <ul key={family} className={`${styles.legend} ${styles.rise}`} style={at(0.2)}>
          {cells.map((cell, i) => (
            <li key={cell.variant} className={styles.legendItem}>
              <span
                className={styles.swatch}
                style={{ background: cell.colour }}
                aria-hidden="true"
              />
              {legend[i]}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.sheet} data-moved={moved || undefined}>
        <div
          className={`label ${styles.sheetHead} ${styles.timingRow} ${styles.rise}`}
          style={at(0.2)}
        >
          <span>{s.columns.graph}</span>
          <span>{s.columns.size}</span>
          <span className={styles.timeHead}>
            {s.columns.time(String(runs || 10))}
            <span
              className={styles.scaleSwitch}
              role="group"
              aria-label={s.families.label}
              style={{ '--i': FAMILIES.indexOf(family) } as CSSProperties}
            >
              <span className={styles.scaleThumb} aria-hidden="true" />
              {FAMILIES.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={styles.scaleButton}
                  aria-pressed={family === key}
                  onClick={() => {
                    setFamily(key);
                    setMoved(true);
                  }}
                >
                  {s.families[key]}
                </button>
              ))}
            </span>
          </span>
          <span className={styles.centre}>{s.columns.best}</span>
        </div>
        {studies.length === 0 ? (
          <p className={`comment ${styles.pending} ${styles.rise}`} style={at(0.4)}>
            {s.pending}
          </p>
        ) : (
          studies.map((study, i) => {
            const d = 0.3 + i * 0.1;
            const measured = cells
              .map((cell, k) => ({
                k,
                time: cellTime(findCell(study.timings, cell.algorithm, cell.variant)),
              }))
              .filter((x) => x.time && !x.time.estimated);
            const best = measured.reduce<(typeof measured)[number] | null>(
              (a, b) => (!a || (b.time?.ms ?? Infinity) < (a.time?.ms ?? Infinity) ? b : a),
              null,
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
                    {formatCompact(study.edges)} <i>{s.arcs}</i>
                  </span>
                </span>
                <span className={styles.group} data-wide="true" data-family={family}>
                  {/* Six places whatever the family, keyed by place, so a
                      switch moves the bars instead of replacing them; the
                      places a family does not use fold away and the rest
                      stay centred. */}
                  {Array.from({ length: 6 }, (_, k) => {
                    const cell = cells[k];
                    if (!cell)
                      return (
                        <Bar
                          key={k}
                          width={0}
                          colour="transparent"
                          value=""
                          off
                          empty
                          delay={d + 0.2 + k * 0.08}
                        />
                      );
                    return timingBar(
                      findCell(study.timings, cell.algorithm, cell.variant),
                      cell.colour,
                      scale,
                      d + 0.2 + k * 0.08,
                      s,
                      String(k),
                    );
                  })}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.8)}
                >
                  {best ? legend[best.k] : '·'}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(1.3)}>
        <p className={styles.note}>
          {machine && s.machine(machine.cpu, formatBytes(machine.total_memory_bytes))}
        </p>
        <Link href="/studies#parte-3" className={`label ${styles.more}`}>
          {s.cta}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ---- 10 question 4: all pairs ------------------------------------------------
   One row per graph: all pairs by n Bellman-Fords (the queue schedule, one
   per target), by Floyd-Warshall (the pruned and the parallel sweep), by
   n Dijkstras when no arc is negative, and by Johnson. Then which of the
   two the handout compares was faster, by how much, and the measured
   scans per vertex that explain it: n queue Bellman-Fords examine about
   n · c · m arcs, Floyd-Warshall n³ cells whatever the arcs. */

const ALL_PAIRS: { algorithm: string; variant: string; colour: string }[] = [
  { algorithm: 'bellman-ford-all', variant: 'queue', colour: 'var(--queue-heap)' },
  { algorithm: 'floyd-warshall', variant: 'pruned', colour: 'var(--queue-vector)' },
  { algorithm: 'floyd-warshall', variant: 'parallel', colour: 'var(--queue-quad-heap)' },
  { algorithm: 'dijkstra-all', variant: 'heap', colour: 'var(--accent-2)' },
  { algorithm: 'johnson', variant: 'heap', colour: 'var(--queue-pairing)' },
];

export function AllPairs({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.allPairs;
  const words = t.presentation.slides.part3.timing;
  const scale = sharedScale(studies);
  return (
    <div className={styles.body}>
      <div className={styles.benchHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        <ul className={`${styles.legend} ${styles.rise}`} style={at(0.2)}>
          {ALL_PAIRS.map((cell, i) => (
            <li key={`${cell.algorithm}-${cell.variant}`} className={styles.legendItem}>
              <span
                className={styles.swatch}
                style={{ background: cell.colour }}
                aria-hidden="true"
              />
              {s.legend[i]}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.sheet}>
        <div
          className={`label ${styles.sheetHead} ${styles.timingRow} ${styles.allPairsRow} ${styles.rise}`}
          style={at(0.2)}
        >
          <span>{s.columns.graph}</span>
          <span>{s.columns.size}</span>
          <span>{s.columns.time}</span>
          <span className={styles.centre}>{s.columns.winner}</span>
          <span className={styles.centre}>{s.columns.why}</span>
        </div>
        {studies.length === 0 ? (
          <p className={`comment ${styles.pending} ${styles.rise}`} style={at(0.4)}>
            {s.pending}
          </p>
        ) : (
          studies.map((study, i) => {
            const d = 0.3 + i * 0.1;
            const bellman = findCell(study.all_pairs, 'bellman-ford-all', 'queue');
            const floyd = findCell(study.all_pairs, 'floyd-warshall', 'pruned');
            const bf = cellTime(bellman)?.ms ?? null;
            const fw = cellTime(floyd)?.ms ?? null;
            const cycle = stoppedAtCycle(bellman) || stoppedAtCycle(floyd);
            // A run that stopped at a cycle scanned its way round it: no c to read.
            const scans =
              bellman?.counts && !cycle ? bellman.counts.scans / Math.max(1, study.vertices) : null;
            return (
              <div
                key={study.name}
                className={`${styles.row} ${styles.timingRow} ${styles.allPairsRow} ${styles.rise}`}
                style={at(d)}
              >
                <span className={styles.rowName}>{graphLabel(t, study)}</span>
                <span className={styles.size}>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.vertices)} <i>{t.studies.facts.vertices}</i>
                  </span>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.edges)} <i>{words.arcs}</i>
                  </span>
                </span>
                <span className={styles.group} data-wide="true">
                  {ALL_PAIRS.map((cell, k) =>
                    timingBar(
                      findCell(study.all_pairs, cell.algorithm, cell.variant),
                      cell.colour,
                      scale,
                      d + 0.2 + k * 0.08,
                      words,
                      `${cell.algorithm}-${cell.variant}`,
                    ),
                  )}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.8)}
                >
                  {cycle ? (
                    <span className={styles.p3AtCycle}>{s.noAnswer}</span>
                  ) : bf !== null && fw !== null && bf > 0 && fw > 0 ? (
                    s.winner(
                      bf < fw ? s.bellman : s.floyd,
                      (bf < fw ? fw / bf : bf / fw).toFixed(1),
                    )
                  ) : (
                    '·'
                  )}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.9)}
                >
                  {scans !== null ? s.why(scans.toFixed(2)) : '·'}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(1.3)}>
        <p className={styles.note}>{s.key}</p>
        <Link href="/studies#parte-3" className={`label ${styles.more}`}>
          {s.cta}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
