'use client';

import {
  Fragment,
  useId,
  useLayoutEffect,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { formatBytes, formatCompact, formatInt, formatMs, formatWeight } from '@/lib/format';
import {
  cellTime,
  findCell,
  stoppedAtCycle,
  type AlgorithmTiming,
  type DirectedStudy,
  type NegativeCycle,
} from '@/lib/studies';
import { Info, Table2 } from 'lucide-react';
import { useT } from '@/i18n/LocaleProvider';
import Reveal from './Reveal';
import { Chapter, Swap } from './studies-kit';
import { ChoiceSwitch } from './StudiesPart2';
import base from './Studies.module.css';
import styles from './StudiesPart3.module.css';

/* Part 3 of the case studies, read from studies/directed/results.json. The
   page is a board that fills the window under the menu, every panel a
   drawing sized to its cell, every mark answering the pointer.

   The overview compares the graphs: how each algorithm's time grows with
   the number of vertices (log-log, so a slope is an exponent), which
   Bellman-Ford schedule wins on each graph (a heatmap of times over the
   best), and the all-pairs race on a ruler of human durations (a second,
   an hour, a year), with the memory Floyd-Warshall's table would need.
   A graph's sheet answers its four questions: the paths to vertex 100 to
   scale (or the negative cycle that leaves them undefined), the 5 × 5
   table as a heatmap whose hover shows the way back, the time of every
   schedule, sweep and search with the other graphs as ghosts behind, and
   the race with this graph lit.

   Every time sits on one log axis shared by all panels and graphs, so a
   position means the same everywhere. A filled point was measured, a
   hollow one is an estimate, a red ring stopped at a negative cycle. */

type T = ReturnType<typeof useT>;
type Words = T['studies']['part3'];
type Name = keyof Words['names'];

const PART_3 = '#parte-3';

/** `grafo_W_3` → `W3`; any other name comes back whole. */
function shortName(name: string): string {
  const match = /^grafo_w_?(\d+)$/i.exec(name);
  return match ? `W${match[1]}` : name;
}

/** A study's place in the address: `w3`. */
function viewId(study: DirectedStudy): string {
  return shortName(study.name).toLowerCase();
}

/** A weight with a true minus sign. */
const signed = (w: number) =>
  !Number.isFinite(w) ? '∞' : w < 0 ? `−${formatWeight(-w)}` : formatWeight(w);

/* ---- readings: what a cell says, on one time axis ------------------------ */

type Kind = 'measured' | 'cut' | 'standIn' | 'cycle';

interface Reading {
  ms: number;
  kind: Kind;
  cell: AlgorithmTiming;
}

/** A cell's time and what kind of number it is; `null` when it was not run. */
function reading(cell: AlgorithmTiming | undefined): Reading | null {
  const time = cellTime(cell);
  if (!time || !cell || !(time.ms > 0)) return null;
  if (stoppedAtCycle(cell)) return { ms: time.ms, kind: 'cycle', cell };
  if (!time.estimated) return { ms: time.ms, kind: 'measured', cell };
  return { ms: time.ms, kind: cell.refusal ? 'standIn' : 'cut', cell };
}

const estimated = (kind: Kind) => kind === 'cut' || kind === 'standIn';

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

/** The durations the time axes are ruled at. */
const LANDMARKS: { ms: number; key: keyof Words['time']['landmarks'] }[] = [
  { ms: 1, key: 'ms' },
  { ms: 1e3, key: 's' },
  { ms: 6e4, key: 'min' },
  { ms: 3.6e6, key: 'h' },
  { ms: DAY, key: 'day' },
  { ms: YEAR, key: 'year' },
  { ms: 1000 * YEAR, key: 'millennium' },
];

/** A duration in the largest unit that reads: ms to hours, then days, years. */
function span(w: Words, ms: number): string {
  if (ms < 2 * DAY) return formatMs(ms);
  if (ms < YEAR) return w.time.days((ms / DAY).toFixed(1));
  const years = ms / YEAR;
  return w.time.years(years < 100 ? years.toFixed(1) : formatInt(years));
}

/** A reading as text: `≈` in front of an estimate. */
function spanOf(w: Words, r: Reading): string {
  return estimated(r.kind) ? w.time.estimated(span(w, r.ms)) : span(w, r.ms);
}

/** One log axis over every time of every graph: 0 at `lo`, 1 at `hi`. */
interface Axis {
  lo: number;
  hi: number;
  at: (ms: number) => number;
}

function timeAxis(studies: DirectedStudy[]): Axis {
  const times = studies
    .flatMap((s) => [...s.timings, ...s.all_pairs])
    .map((c) => reading(c)?.ms ?? 0)
    .filter((ms) => ms > 0);
  const lo = Math.max(1e-4, Math.min(1, ...times) / 2);
  const hi = Math.max(10, ...times) * 2;
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  return { lo, hi, at: (ms) => (Math.log10(Math.max(ms, lo)) - a) / (b - a) };
}

/* ---- the series ----------------------------------------------------------- */

interface Series {
  key: string;
  source: 'timings' | 'all_pairs';
  algorithm: string;
  variant: string;
  colour: string;
  name: Name;
}

/* Five hues (validated as a set, light and dark) and grey for the textbook
   baseline of a family. Bellman-Ford is blue and Floyd-Warshall orange
   wherever they meet. */
const GREY = 'var(--fg-3)';
const BLUE = 'var(--accent)';
const AMBER = 'var(--queue-lazy-heap)';
const GREEN = 'var(--queue-quad-heap)';
const PURPLE = 'var(--queue-pairing)';
const ORANGE = 'var(--queue-vector)';

const series = (
  source: Series['source'],
  algorithm: string,
  variant: string,
  colour: string,
  name: Name,
): Series => ({
  key: `${source}:${algorithm}:${variant}`,
  source,
  algorithm,
  variant,
  colour,
  name,
});

const BELLMAN: Series[] = [
  series('timings', 'bellman-ford', 'rounds', GREY, 'rounds'),
  series('timings', 'bellman-ford', 'early-stop', AMBER, 'earlyStop'),
  series('timings', 'bellman-ford', 'queue', BLUE, 'queue'),
  series('timings', 'bellman-ford', 'yen', GREEN, 'yen'),
  series('timings', 'bellman-ford', 'random-yen', PURPLE, 'randomYen'),
  series('timings', 'bellman-ford', 'slf', ORANGE, 'slf'),
];
const FLOYD: Series[] = [
  series('timings', 'floyd-warshall', 'plain', GREY, 'plain'),
  series('timings', 'floyd-warshall', 'pruned', ORANGE, 'pruned'),
  series('timings', 'floyd-warshall', 'parallel', AMBER, 'parallel'),
  series('timings', 'floyd-warshall', 'blocked', PURPLE, 'blocked'),
];
const SEARCHES: Series[] = [
  series('timings', 'bfs', 'queue', GREY, 'bfs'),
  series('timings', 'dfs', 'iterative', PURPLE, 'dfs'),
  series('timings', 'dijkstra', 'heap', GREEN, 'dijkstra'),
];
const PAIRS: Series[] = [
  series('all_pairs', 'bellman-ford-all', 'queue', BLUE, 'bellmanAll'),
  series('all_pairs', 'floyd-warshall', 'pruned', ORANGE, 'floydAllPruned'),
  series('all_pairs', 'floyd-warshall', 'parallel', AMBER, 'floydAllParallel'),
  series('all_pairs', 'dijkstra-all', 'heap', GREEN, 'dijkstraAll'),
  series('all_pairs', 'johnson', 'heap', PURPLE, 'johnson'),
];

type Family = 'headline' | 'bellman' | 'floyd' | 'pairs';
const FAMILIES: Record<Family, Series[]> = {
  headline: [
    series('timings', 'bellman-ford', 'queue', BLUE, 'bellmanQueue'),
    series('timings', 'floyd-warshall', 'pruned', ORANGE, 'floydPruned'),
    series('timings', 'dijkstra', 'heap', GREEN, 'dijkstra'),
    series('timings', 'bfs', 'queue', GREY, 'bfs'),
  ],
  bellman: BELLMAN,
  floyd: FLOYD,
  pairs: PAIRS,
};
const FAMILY_KEYS: Family[] = ['headline', 'bellman', 'floyd', 'pairs'];

const read = (study: DirectedStudy, s: Series) =>
  reading(findCell(study[s.source], s.algorithm, s.variant));

/** The exponent k of time ∝ n^k, fitted over the points that answered. */
function slope(points: { n: number; ms: number }[]): number | null {
  const xs = points.map((p) => Math.log10(p.n));
  if (new Set(xs).size < 2) return null;
  const ys = points.map((p) => Math.log10(p.ms));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  return den === 0 ? null : num / den;
}

/** `2.04` → `²·⁰`: an exponent, in superscript digits. */
function superscript(value: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return value
    .toFixed(1)
    .split('')
    .map((c) => (c === '.' ? '·' : c === '-' ? '⁻' : digits[Number(c)]))
    .join('');
}

/** `1.5625e13` → `1.6 × 10¹³`. */
function power(value: number): string {
  if (value <= 0) return '0';
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / 10 ** exponent;
  const sup = String(exponent)
    .split('')
    .map((digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)])
    .join('');
  return `${mantissa.toFixed(1)} × 10${sup}`;
}

/** A count as short as it reads on an axis: `25K`, `100K`, `1M`, `10M`. */
function shortCount(value: number): string {
  return formatCompact(value).replace(/\.0+(?=[KMB])/, '');
}

/** A ratio as it reads beside a `×`: `1.4`, `37`, `2.9K`. */
function ratioText(ratio: number): string {
  if (ratio < 10) return ratio.toFixed(1);
  if (ratio < 1e4) return formatInt(ratio);
  return formatCompact(ratio);
}

/* ---- measuring and pointing ---------------------------------------------- */

/** An element's content box, kept up to date. */
function useSize<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((old) =>
        Math.abs(old.width - width) < 0.5 && Math.abs(old.height - height) < 0.5
          ? old
          : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The pointer in an element's own coordinates. */
function local(event: ReactPointerEvent<Element>) {
  const box = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

interface TipAt {
  x: number;
  y: number;
  /** The drawing's size, so the tip opens away from the near edges. */
  width: number;
  height: number;
}

/** The floating card that reads a mark: a material over the drawing, near
    the pointer, opening away from the edges it is close to. */
function Tip({ at, children }: { at: TipAt | null; children: ReactNode }) {
  if (!at) return null;
  const left = at.x > at.width * 0.5;
  const up = at.y > at.height * 0.55;
  return (
    <div
      className={styles.tip}
      data-left={left || undefined}
      data-up={up || undefined}
      style={{ left: at.x, top: at.y } as CSSProperties}
      role="status"
    >
      {children}
    </div>
  );
}

function TipHead({ colour, children }: { colour?: string; children: ReactNode }) {
  return (
    <p className={styles.tipHead}>
      {colour && <span className={styles.swatch} style={{ '--c': colour } as CSSProperties} />}
      {children}
    </p>
  );
}

/** What a reading is, in the tip's words. */
function kindLine(w: Words, r: Reading): string {
  if (r.kind === 'cycle') return w.kinds.atCycle;
  if (r.kind === 'cut') return w.kinds.cut;
  if (r.kind === 'standIn') return w.kinds.standIn;
  return w.kinds.mean(String(r.cell.timing?.runs ?? 0), String(r.cell.requested_runs));
}

/** The body every timing tip shares: graph, time, kind, work. */
function ReadingTip({
  w,
  study,
  r,
  colour,
  title,
  open,
}: {
  w: Words;
  study: DirectedStudy;
  r: Reading;
  colour: string;
  title: string;
  open?: boolean;
}) {
  const counts = r.cell.counts;
  return (
    <>
      <TipHead colour={colour}>{title}</TipHead>
      <p className={styles.tipSub}>
        {w.tip.graph(
          shortName(study.name),
          formatCompact(study.vertices),
          formatCompact(study.edges),
        )}
      </p>
      <p className={`mono ${styles.tipValue}`} data-kind={r.kind}>
        {spanOf(w, r)}
      </p>
      <p className={styles.tipNote}>{kindLine(w, r)}</p>
      {counts && counts.scans > 0 && (
        <p className={`mono ${styles.tipSub}`}>
          {w.tip.work(formatInt(counts.passes), formatCompact(counts.scans))}
        </p>
      )}
      {open && <p className={styles.tipHint}>{w.tip.open(shortName(study.name))}</p>}
    </>
  );
}

/** A point on a time axis: filled when measured, hollow when estimated, a
    red ring around it when the run stopped at a negative cycle. */
function Mark({
  x,
  y,
  r,
  colour,
  kind,
  lit,
  instant,
}: {
  x: number;
  y: number;
  r: number;
  colour: string;
  kind: Kind;
  lit?: boolean;
  /** Placed at once, for a chart that animates itself frame by frame. */
  instant?: boolean;
}) {
  const radius = lit ? r + 1.5 : r;
  // Placed by a transform, so a mark that changes place glides there.
  return (
    <g
      className={`${styles.mark} ${instant ? '' : styles.glide}`}
      data-lit={lit || undefined}
      style={at(x, y)}
    >
      {kind === 'cycle' && <circle r={radius + 3.5} className={styles.cycleRing} />}
      <circle
        r={radius}
        style={{ '--c': colour } as CSSProperties}
        className={estimated(kind) ? styles.hollow : styles.filled}
      />
    </g>
  );
}

/** A place on a drawing, as the transform that puts an element there. */
function at(x: number, y: number): CSSProperties {
  return { transform: `translate(${x}px, ${y}px)` };
}

/** A horizontal line from `x1` to `x2` at `y`, drawn as a unit line moved
    and stretched by a transform, so a change of either end glides; the
    stroke keeps its width (and its dashes) whatever the stretch. */
function HLine({
  x1,
  x2,
  y,
  className,
  instant,
  ...rest
}: {
  x1: number;
  x2: number;
  y: number;
  className?: string;
  /** Placed at once, for a chart that animates itself frame by frame. */
  instant?: boolean;
  [data: `data-${string}`]: boolean | undefined;
}) {
  const left = Math.min(x1, x2);
  const span = Math.max(1e-3, Math.abs(x2 - x1));
  return (
    <line
      x1={0}
      x2={1}
      y1={0}
      y2={0}
      vectorEffect="non-scaling-stroke"
      className={`${instant ? '' : styles.glide} ${className ?? ''}`}
      style={{ transform: `translate(${left}px, ${y}px) scaleX(${span})` }}
      {...rest}
    />
  );
}

/** SVG text whose words crossfade when `view` changes (keyed, so React
    swaps it and the new one fades up). */
function SvgSwap({ view, children }: { view: string; children: ReactNode }) {
  return (
    <g key={view} className={styles.svgSwap}>
      {children}
    </g>
  );
}

/** A number that runs to its new value instead of jumping: an ease-out
    from wherever it is now, so a change mid-run turns smoothly. */
function useTween(target: number, ms = 520): number {
  const [value, setValue] = useState(target);
  const now = useRef(target);
  useEffect(() => {
    const from = now.current;
    if (from === target || !Number.isFinite(target) || !Number.isFinite(from)) {
      const raf = requestAnimationFrame(() => {
        now.current = target;
        setValue(target);
      });
      return () => cancelAnimationFrame(raf);
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const step = (time: number) => {
      const t = still ? 1 : Math.min(1, (time - start) / ms);
      const v = from + (target - from) * (1 - (1 - t) ** 3);
      now.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** `useTween` for a list of numbers of fixed length, run together on one
    curve (a `null` has no place and lands at once). */
function useTweens(targets: (number | null)[], ms = 520): number[] {
  const key = targets.map((t) => (t === null ? '·' : t.toFixed(6))).join('|');
  const [values, setValues] = useState(() => targets.map((t) => t ?? NaN));
  const now = useRef(values);
  useEffect(() => {
    // The targets, read back from the key the effect runs on.
    const to = key === '' ? [] : key.split('|').map((t) => (t === '·' ? NaN : Number(t)));
    const from = now.current.map((v, i) => (Number.isFinite(v) ? v : to[i]));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const step = (time: number) => {
      const t = still ? 1 : Math.min(1, (time - start) / ms);
      const e = 1 - (1 - t) ** 3;
      const next = to.map((b, i) => (Number.isFinite(b) ? from[i] + (b - from[i]) * e : NaN));
      now.current = next;
      setValues(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, ms]);
  return values;
}

/** A number written by `format` that runs to each new value. */
function Tweened({ value, format }: { value: number; format: (v: number) => string }) {
  return <>{format(useTween(value))}</>;
}

/** The keys under a time drawing: what filled, hollow and ringed mean. */
function MarkKeys({ w, ghosts }: { w: Words; ghosts?: boolean }) {
  return (
    <span className={styles.keys}>
      {ghosts && (
        <span className={styles.key}>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="3" className={styles.ghost} />
          </svg>
          {w.timing.others}
        </span>
      )}
      <span className={styles.key}>
        <svg width="12" height="12" aria-hidden="true">
          <circle
            cx="6"
            cy="6"
            r="4"
            className={styles.filled}
            style={{ '--c': 'var(--fg-2)' } as CSSProperties}
          />
        </svg>
        {w.scaling.keys.measured}
      </span>
      <span className={styles.key}>
        <svg width="12" height="12" aria-hidden="true">
          <circle
            cx="6"
            cy="6"
            r="4"
            className={styles.hollow}
            style={{ '--c': 'var(--fg-2)' } as CSSProperties}
          />
        </svg>
        {w.scaling.keys.estimated}
      </span>
      <span className={styles.key}>
        <svg width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" className={styles.cycleRing} />
          <circle
            cx="8"
            cy="8"
            r="3"
            className={styles.filled}
            style={{ '--c': 'var(--fg-2)' } as CSSProperties}
          />
        </svg>
        {w.scaling.keys.cycle}
      </span>
    </span>
  );
}

/** The landmark rules of a time axis, vertical (`x`) or horizontal (`y`). */
/** Every rule is drawn; a label only when it clears the last one shown,
    so a narrow axis keeps its rules and loses only the crowded names. */
function thinLabels<M extends { p: number; text: string }>(
  marks: M[],
  along: 'x' | 'y',
): (M & { shown: boolean })[] {
  const out: (M & { shown: boolean })[] = [];
  let last = -Infinity;
  let lastLength = 0;
  for (const mark of marks) {
    const room = along === 'y' ? 14 : Math.max(mark.text.length, lastLength) * 6.4 + 6;
    const shown = Math.abs(mark.p - last) >= room;
    if (shown) {
      last = mark.p;
      lastLength = mark.text.length;
    }
    out.push({ ...mark, shown });
  }
  return out;
}

function Landmarks({
  w,
  axis,
  place,
  from,
  to,
  along,
  labelAt,
}: {
  w: Words;
  axis: Axis;
  /** Where on screen a 0..1 position of the axis lands. */
  place: (t: number) => number;
  /** The rule's extent across the axis. */
  from: number;
  to: number;
  along: 'x' | 'y';
  /** Where the labels sit across the axis. */
  labelAt: number;
}) {
  const marks = thinLabels(
    LANDMARKS.filter((l) => l.ms > axis.lo && l.ms < axis.hi).map((l) => ({
      key: l.key,
      p: place(axis.at(l.ms)),
      text: w.time.landmarks[l.key],
    })),
    along,
  );
  return (
    <g className={styles.landmarks}>
      {marks.map(({ key, p, text, shown }) =>
        along === 'y' ? (
          <g key={key}>
            <line x1={from} x2={to} y1={p} y2={p} />
            {shown && (
              <text x={labelAt} y={p} dy="0.32em" textAnchor="end">
                {text}
              </text>
            )}
          </g>
        ) : (
          <g key={key}>
            <line x1={p} x2={p} y1={from} y2={to} />
            {shown && (
              <text x={p} y={labelAt} textAnchor="middle">
                {text}
              </text>
            )}
          </g>
        ),
      )}
    </g>
  );
}

/* ---- the page ------------------------------------------------------------- */

export default function StudiesPart3({ studies }: { studies: DirectedStudy[] }) {
  const t = useT();
  // The view (null: the overview, else a study's index), kept in the hash:
  // `#parte-3`, `#parte-3-w1`.
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const readHash = () => {
      const id = location.hash.startsWith(`${PART_3}-`)
        ? location.hash.slice(PART_3.length + 1)
        : '';
      const i = studies.findIndex((study) => viewId(study) === id);
      setView(i >= 0 ? i : null);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [studies]);
  const choose = useCallback(
    (i: number | null) => {
      setView(i);
      history.replaceState(null, '', i === null ? PART_3 : `${PART_3}-${viewId(studies[i])}`);
    },
    [studies],
  );
  const open = useCallback((s: DirectedStudy) => choose(studies.indexOf(s)), [choose, studies]);

  // The menu is a tablist, as in Parts 1 and 2: left and right walk it from
  // anywhere on the page.
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stop = view === null ? 0 : view + 1;
  const last = studies.length;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName))
      ) {
        return;
      }
      const inMenu = active instanceof HTMLElement && tabs.current.includes(active as never);
      const keys: Record<string, number | undefined> = {
        ArrowRight: stop + 1,
        ArrowLeft: stop - 1,
        ArrowDown: inMenu ? stop + 1 : undefined,
        ArrowUp: inMenu ? stop - 1 : undefined,
        Home: inMenu ? 0 : undefined,
        End: inMenu ? last : undefined,
      };
      const wanted = keys[event.key];
      if (wanted === undefined) return;
      const next = Math.min(last, Math.max(0, wanted));
      event.preventDefault();
      if (next === stop) return;
      choose(next === 0 ? null : next - 1);
      if (inMenu) tabs.current[next]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, last, stop]);

  const study = view === null ? null : studies[view];
  const axis = timeAxis(studies);

  return (
    <>
      <nav className={base.menu}>
        <div className={`container ${base.menuInner}`}>
          <span className={base.menuLabel} aria-hidden="true">
            {t.studies.graphsLabel}
          </span>
          <div className={base.menuTrack} role="tablist" aria-label={t.studies.part3.views}>
            <button
              title={t.studies.overview}
              type="button"
              role="tab"
              aria-selected={view === null}
              tabIndex={view === null ? 0 : -1}
              ref={(el) => {
                tabs.current[0] = el;
              }}
              className={base.pick}
              data-active={view === null || undefined}
              onClick={() => choose(null)}
            >
              <span className={`mono ${base.pickBall}`}>
                <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                  <circle cx="5" cy="5" r="3" fill="currentColor" />
                </svg>
              </span>
              <span className={base.pickName}>{t.studies.overview}</span>
            </button>
            {studies.map((s, i) => (
              <button
                title={t.studies.graph(shortName(s.name))}
                key={s.name}
                type="button"
                role="tab"
                aria-selected={view === i}
                tabIndex={view === i ? 0 : -1}
                ref={(el) => {
                  tabs.current[i + 1] = el;
                }}
                className={base.pick}
                data-active={view === i || undefined}
                onClick={() => choose(i)}
              >
                <span className={`mono ${base.pickBall}`}>{shortName(s.name)}</span>
                <span className={base.pickName}>{t.studies.graph(shortName(s.name))}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
      <div className={`container ${base.content} ${styles.page}`}>
        <SheetHead studies={studies} study={study} />
        {study === null ? (
          <div className={styles.board} data-board="overview">
            <div className={styles.column}>
              <ScalingPanel studies={studies} onOpen={open} />
            </div>
          </div>
        ) : (
          <div className={styles.board} data-board="graph">
            {/* The two answers on the left; the thirteen times take the
                tall column on the right, the race of this graph under them. */}
            <div className={styles.column}>
              <TargetPanel study={study} studies={studies} />
              <PairsPanel study={study} />
            </div>
            <div className={styles.column}>
              <TimesPanel studies={studies} study={study} axis={axis} onOpen={open} />
              <RacePanel studies={studies} axis={axis} selected={study} onOpen={open} index={4} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** The head every view shares: the title and the facts crossfade. */
function SheetHead({ studies, study }: { studies: DirectedStudy[]; study: DirectedStudy | null }) {
  const t = useT();
  const p = t.studies.part3;
  const key = study ? viewId(study) : 'overview';
  let title: string;
  let facts: ReactNode;
  if (study === null) {
    const cycles = studies.filter((s) => s.cycle_anywhere).length;
    title = t.studies.overview;
    facts = (
      <>
        <span className={`mono ${base.fact}`}>
          {formatCompact(Math.min(...studies.map((s) => s.vertices)))}–
          {formatCompact(Math.max(...studies.map((s) => s.vertices)))}{' '}
          <em>{t.studies.facts.vertices}</em>
        </span>
        <span className={`mono ${base.fact}`}>
          {formatCompact(Math.min(...studies.map((s) => s.edges)))}–
          {formatCompact(Math.max(...studies.map((s) => s.edges)))} <em>{p.facts.arcs}</em>
        </span>
        <span className={base.note}>{p.facts.cycles(cycles, studies.length)}</span>
      </>
    );
  } else {
    title = t.studies.graph(shortName(study.name));
    facts = (
      <>
        <span className={`mono ${base.fact}`}>
          {formatInt(study.vertices)} <em>{t.studies.facts.vertices}</em>
        </span>
        <span className={`mono ${base.fact}`}>
          {formatInt(study.edges)} <em>{p.facts.arcs}</em>
        </span>
        {study.weights && (
          <span className={base.note}>
            {p.facts.weights(
              signed(study.weights.min),
              signed(study.weights.max),
              study.weights.negative,
            )}
          </span>
        )}
        <span className={base.note}>
          {t.studies.facts.dropped(
            formatInt(study.self_loops_dropped),
            formatInt(study.duplicates_dropped),
          )}
        </span>
      </>
    );
  }
  return (
    <Reveal className={base.head}>
      <h1 className={base.title}>
        <Swap view={key}>{title}</Swap>
      </h1>
      <div className={base.facts}>
        <Swap view={key} className={base.facts}>
          {facts}
        </Swap>
      </div>
    </Reveal>
  );
}

/* ---- overview: how the time grows ----------------------------------------- */

type Measure = 'time' | 'memory';

/** The bytes the library prices a directed, weighted CSR graph at: the
    offsets (n + 2 of them, 4 bytes each) and one 4-byte head and 8-byte
    weight per arc (`Csr::required_bytes_oriented`). */
function csrBytes(study: DirectedStudy): number {
  return 4 * (study.vertices + 2) + 12 * study.edges;
}

const KIB = 1024;
/** 1, 2 and 5 of every power of ten in every binary unit, kilobytes to
    petabytes: the byte axis's fine marks and its linear steps alike. */
const BYTE_STEPS = [KIB, KIB ** 2, KIB ** 3, KIB ** 4, KIB ** 5].flatMap((unit) =>
  [1, 2, 5, 10, 20, 50, 100, 200, 500].map((k) => k * unit),
);
/** A byte count as an axis writes it: `1 GB`, `500 MB`, `2.5 TB`. */
const byteTick = (v: number) => formatBytes(v).replace(/\.0+ /, ' ');

/** The overview: how each algorithm's time (or what the library reserves
    in memory) grows with the graph, one chart for the whole board; for
    the six Bellman-Ford schedules, a table of which wins on each graph is
    the chart's other view. */
function ScalingPanel({
  studies,
  onOpen,
}: {
  studies: DirectedStudy[];
  onOpen: (s: DirectedStudy) => void;
}) {
  const w = useT().studies.part3;
  const [measure, setMeasure] = useState<Measure>('time');
  const [family, setFamily] = useState<Family>('headline');
  const [table, setTable] = useState(false);
  const [heat, setHeat] = useState<Metric>('time');
  // The scale (0 linear, 1 log, as the slider reads) and the lines taken
  // off each chart; all outlive a change of family or measure.
  const [logness, setLogness] = useState(1);
  const [off, setOff] = useState<Record<string, ReadonlySet<number>>>({});
  const chartKey = measure === 'memory' ? 'memory' : family;
  const showTable = measure === 'time' && family === 'bellman' && table;
  const memory = studies.find((s) => s.machine)?.machine?.total_memory_bytes ?? null;

  const timeLines: Line[] = FAMILIES[family].map((s) => ({
    key: s.key,
    name: w.names[s.name],
    colour: s.colour,
    points: studies.map((study) => {
      const r = read(study, s);
      return r ? { v: r.ms, kind: r.kind } : null;
    }),
  }));
  const memoryLines: Line[] = [
    {
      key: 'table',
      name: w.memory.table,
      colour: ORANGE,
      points: studies.map((study) =>
        study.pairs ? { v: study.pairs.table_bytes, kind: 'measured' as Kind } : null,
      ),
    },
    {
      key: 'graph',
      name: w.memory.graph,
      colour: GREY,
      points: studies.map((study) => ({ v: csrBytes(study), kind: 'measured' as Kind })),
    },
  ];
  const timeAxisSpec: AxisSpec = {
    named: LANDMARKS.map((l) => ({ v: l.ms, label: w.time.landmarks[l.key] })),
    fine: FINE_MS,
    steps: LINEAR_MS,
    format: (v) => tickText(w, v),
  };
  const byteAxisSpec: AxisSpec = {
    named: [1, 2, 3, 4, 5].flatMap((p) =>
      [1, 10, 100].map((k) => ({ v: k * KIB ** p, label: byteTick(k * KIB ** p) })),
    ),
    fine: BYTE_STEPS,
    steps: BYTE_STEPS,
    format: byteTick,
  };

  const timeTip = (line: number, j: number) => {
    const s = FAMILIES[family][line];
    const r = read(studies[j], s);
    return r ? (
      <ReadingTip w={w} study={studies[j]} r={r} colour={s.colour} title={w.names[s.name]} open />
    ) : null;
  };
  const memoryTip = (line: number, j: number) => {
    const point = memoryLines[line].points[j];
    if (!point) return null;
    const study = studies[j];
    return (
      <>
        <TipHead colour={memoryLines[line].colour}>{memoryLines[line].name}</TipHead>
        <p className={styles.tipSub}>
          {w.tip.graph(
            shortName(study.name),
            formatCompact(study.vertices),
            formatCompact(study.edges),
          )}
        </p>
        <p className={`mono ${styles.tipValue}`}>{formatBytes(point.v)}</p>
        <p className={styles.tipNote}>{line === 0 ? w.memory.tableNote : w.memory.graphNote}</p>
        {memory !== null && (
          <p className={`mono ${styles.tipSub}`}>
            {point.v > memory ? w.memory.over(ratioText(point.v / memory)) : w.memory.fits}
          </p>
        )}
        <p className={styles.tipHint}>{w.tip.open(shortName(study.name))}</p>
      </>
    );
  };

  return (
    <Chapter
      index={1}
      title={
        <Swap view={measure}>{measure === 'time' ? w.scaling.title : w.scaling.titleMemory}</Swap>
      }
      delay={0.05}
      className={`${styles.panel} ${styles.scalingPanel}`}
      tools={
        <div className={base.chapterTools}>
          <ChoiceSwitch
            label={w.scaling.measureLabel}
            choices={(['time', 'memory'] as Measure[]).map((key) => ({
              key,
              label: w.scaling.measure[key],
            }))}
            value={measure}
            onChange={setMeasure}
          />
        </div>
      }
    >
      <div className={styles.controls}>
        {/* Memory has one set of lines: the families fade and go inert. */}
        <div className={styles.controlsFamily} data-hidden={measure === 'memory' || undefined}>
          <Segmented
            label={w.scaling.familyLabel}
            choices={FAMILY_KEYS.map((key) => ({ key, label: w.scaling.families[key] }))}
            value={family}
            onChange={setFamily}
            disabled={measure === 'memory'}
          />
          <button
            type="button"
            className={styles.tableToggle}
            aria-pressed={table}
            data-hidden={family !== 'bellman' || measure === 'memory' || undefined}
            disabled={family !== 'bellman' || measure === 'memory'}
            onClick={() => setTable((on) => !on)}
          >
            <Table2 size={14} aria-hidden="true" />
            {w.scaling.tableView}
          </button>
        </div>
        {/* At the row's right: the table's measure, or what the marks mean. */}
        {measure === 'time' && !showTable && <MarkKeys w={w} />}
        {showTable && (
          <ChoiceSwitch
            label={w.heat.metricLabel}
            choices={(['time', 'scans'] as Metric[]).map((key) => ({
              key,
              label: w.heat.metric[key],
            }))}
            value={heat}
            onChange={setHeat}
          />
        )}
      </div>
      <div key={showTable ? 'table' : 'chart'} className={styles.swapBlock}>
        {showTable ? (
          <HeatTable studies={studies} metric={heat} onOpen={onOpen} />
        ) : (
          <ScalingChart
            studies={studies}
            lines={measure === 'time' ? timeLines : memoryLines}
            axis={measure === 'time' ? timeAxisSpec : byteAxisSpec}
            rules={
              measure === 'memory' && memory !== null
                ? [{ v: memory, label: w.memory.ram(byteTick(memory)) }]
                : []
            }
            unit={measure}
            tip={measure === 'time' ? timeTip : memoryTip}
            onOpen={onOpen}
            logness={logness}
            onLogness={setLogness}
            off={off[chartKey] ?? new Set()}
            onOff={(next) => setOff((all) => ({ ...all, [chartKey]: next }))}
          />
        )}
      </div>
    </Chapter>
  );
}

/** A switch between a few choices of unequal widths: the thumb is measured
    against the chosen button and slides (and stretches) to it, on the same
    critically damped curve as everything else that moves here. */
function Segmented<K extends string>({
  label,
  choices,
  value,
  onChange,
  disabled,
}: {
  label: string;
  choices: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  disabled?: boolean;
}) {
  const buttons = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const [thumb, setThumb] = useState<{ x: number; w: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = buttons.current[value];
    if (!el) return;
    // Measured when the chosen button is first observed and whenever it
    // resizes (a font arriving, a wrap), never by a jump.
    const observer = new ResizeObserver(() =>
      setThumb((old) => ({ x: el.offsetLeft, w: el.offsetWidth, moved: old !== null })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {thumb && (
        <span
          className={styles.segmentedThumb}
          data-moved={thumb.moved || undefined}
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
          aria-hidden="true"
        />
      )}
      {choices.map((choice) => (
        <button
          key={choice.key}
          ref={(el) => {
            buttons.current[choice.key] = el;
          }}
          type="button"
          className={styles.segmentedButton}
          aria-pressed={value === choice.key}
          disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          onClick={() => onChange(choice.key)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** The chart's scale, from linear (`β = 1`) to logarithmic (`β = 0`): the
    Box-Cox transform (vᵝ − 1) / β, which tends to ln v as β shrinks, so the
    slider sweeps one into the other with every line moving smoothly (the
    same transform as Part 2's chart). */
function scaled(v: number, beta: number): number {
  return beta < 1e-4 ? Math.log(v) : (Math.pow(v, beta) - 1) / beta;
}

/** The value at a position of the scale; 0 below a linear axis's origin. */
function unscaled(u: number, beta: number): number {
  if (beta < 1e-4) return Math.exp(u);
  const base = beta * u + 1;
  return base > 0 ? Math.pow(base, 1 / beta) : 0;
}

/** The slider's position (0 linear, 1 log) as the transform's β; cubed, so
    the middle of the slider is already half way to log in looks. */
const betaOf = (logness: number) => (1 - logness) ** 3;

/** 1, 2 and 5 of every power of ten, from a microsecond to millennia: the
    fine ticks of a log axis. */
const FINE_MS = Array.from({ length: 20 }, (_, k) => 10 ** (k - 3)).flatMap((d) => [
  d,
  2 * d,
  5 * d,
]);

/** The steps of a linear time axis, each a round amount of its own unit
    (milliseconds, seconds, minutes, hours, days, years). */
const LINEAR_MS = [
  ...[0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500],
  ...[1, 2, 5, 10, 15, 30].map((k) => k * 1e3),
  ...[1, 2, 5, 10, 15, 30].map((k) => k * 6e4),
  ...[1, 2, 3, 6, 12].map((k) => k * 3.6e6),
  ...[1, 2, 5, 10, 30, 60, 120].map((k) => k * DAY),
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4].map((k) => k * YEAR),
];

/** A tick's words: the duration, without the trailing zeros a reading keeps. */
function tickText(w: Words, ms: number): string {
  return span(w, ms)
    .replace(/(\.\d*?)0+(?=\D*$)/, '$1')
    .replace(/\.(?=\D*$)/, '');
}

interface Hover {
  series: number;
  study: number;
  x: number;
  y: number;
}

/** A point of the growth chart: a time or a byte count, and how it was had. */
interface Point {
  v: number;
  kind: Kind;
}

/** One line of the growth chart: a value per graph (`null` where none). */
interface Line {
  key: string;
  name: string;
  colour: string;
  points: (Point | null)[];
}

/** What the value axis reads: its named marks, its 1-2-5 marks, the steps
    of its linear end, and how any other value is written. */
interface AxisSpec {
  named: { v: number; label: string }[];
  fine: number[];
  steps: number[];
  format: (v: number) => string;
}

/** A level drawn across the chart (the machine's memory). */
interface Rule {
  v: number;
  label: string;
}

/** The growth chart: a value per graph against its vertices, for times or
    bytes alike; the slider sweeps both axes from log to linear, and the
    value axis fits the lines shown. */
function ScalingChart({
  studies,
  lines,
  axis,
  unit,
  rules = [],
  tip,
  onOpen,
  logness,
  onLogness,
  off,
  onOff,
}: {
  studies: DirectedStudy[];
  lines: Line[];
  axis: AxisSpec;
  /** What the values are (`time`, `memory`): a new unit crossfades the ticks. */
  unit: string;
  rules?: Rule[];
  /** What the tip says about a line's point on a graph. */
  tip: (line: number, study: number) => ReactNode;
  onOpen: (s: DirectedStudy) => void;
  /** 0 linear, 1 log. */
  logness: number;
  onLogness: (logness: number) => void;
  /** The lines taken off the chart. */
  off: ReadonlySet<number>;
  onOff: (off: ReadonlySet<number>) => void;
}) {
  const w = useT().studies.part3;
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const beta = betaOf(logness);
  const points = lines.map((line) => line.points);

  // The value axis fits the lines shown; a change of lines (another family,
  // time for memory, a line hidden) glides every point from where it was
  // drawn to where it now belongs, as in Part 2's chart, while the slider
  // moves them at once, so a drag is never behind the hand.
  const shownMs = points
    .flatMap((row, i) => (off.has(i) ? [] : row))
    .filter((p): p is Point => p !== null)
    .map((p) => p.v);
  const allMs = points
    .flat()
    .filter((p): p is Point => p !== null)
    .map((p) => p.v);
  const fitMs = [
    ...(shownMs.length > 0 ? shownMs : allMs.length > 0 ? allMs : [1, 10]),
    ...rules.map((rule) => rule.v),
  ];
  const lowMs = Math.min(...fitMs);
  const highMs = Math.max(...fitMs);

  // On a phone the names at the lines' ends give way to the legend.
  const narrow = width < 420;
  const M = { l: narrow ? 50 : 74, r: narrow ? 14 : 200, t: 14, b: narrow ? 34 : 46 };
  const iw = Math.max(1, width - M.l - M.r);
  const ih = Math.max(1, height - M.t - M.b);
  const ns = studies.map((s) => s.vertices);
  const nLo = scaled(Math.min(...ns), beta);
  const nHi = scaled(Math.max(...ns), beta);
  const x0 = nLo - (nHi - nLo) * 0.1;
  const x1 = nHi + (nHi - nLo) * 0.03;
  const yLo = scaled(lowMs, beta);
  const yHi = scaled(highMs, beta);
  const ySpan = Math.max(yHi - yLo, 1e-9);
  const y0 = yLo - ySpan * 0.07;
  const y1 = yHi + ySpan * 0.07;
  const X = (n: number) => M.l + (iw * (scaled(n, beta) - x0)) / Math.max(x1 - x0, 1e-9);
  const Y = (ms: number) => M.t + ih * (1 - (scaled(ms, beta) - y0) / (y1 - y0));

  // Ticks from three sources: the named durations, 1-2-5 in every decade,
  // and round linear steps. Near the log end the first two lead, near the
  // linear end the steps do; each is kept only clear of those before it.
  const low = unscaled(y0, beta);
  const high = unscaled(y1, beta);
  const step = axis.steps.find((d) => (high - low) / d <= 6) ?? axis.steps.at(-1)!;
  const linearTicks: number[] = [];
  for (let v = Math.max(step, Math.ceil(low / step) * step); v <= high; v += step) {
    linearTicks.push(v);
  }
  const named = axis.named.map((n) => n.v);
  const sources = beta > 0.3 ? [linearTicks, named, axis.fine] : [named, axis.fine, linearTicks];
  const ticks: { ms: number; label: string }[] = [];
  for (const source of sources) {
    if (ticks.length >= 5) break;
    for (const ms of source) {
      const y = Y(ms);
      if (ms <= 0 || y < M.t - 0.5 || y > M.t + ih + 0.5) continue;
      if (ticks.some((t) => Math.abs(Y(t.ms) - y) < 22)) continue;
      const mark = axis.named.find((n) => n.v === ms);
      ticks.push({ ms, label: mark ? mark.label : axis.format(ms) });
    }
  }

  // Every point of every line, and each line's fitted exponent.
  const answered = (i: number) =>
    studies
      .map((study, j) => ({ study, r: points[i][j], j }))
      .filter((p): p is { study: DirectedStudy; r: Point; j: number } =>
        Boolean(p.r && p.r.kind !== 'cycle'),
      )
      .sort((a, b) => a.study.vertices - b.study.vertices || a.study.edges - b.study.edges);
  const slopes = lines.map((_, i) =>
    slope(answered(i).map((p) => ({ n: p.study.vertices, ms: p.r.v }))),
  );

  // Where every point is drawn: its place on the axes, or, while a change
  // of lines settles, on its way there from where it was. The lines are
  // matched by their place in the list, so each one turns into the next
  // family's (its colour blending); one the old set lacked grows out of
  // the line before it.
  const targets = new Map<string, { x: number; y: number }>();
  points.forEach((row, i) => {
    if (off.has(i)) return;
    row.forEach((p, j) => {
      if (p) targets.set(`${i}-${j}`, { x: X(studies[j].vertices), y: Y(p.v) });
    });
  });
  const [morph, setMorph] = useState<{
    from: Map<string, { x: number; y: number }>;
    k: number;
  } | null>(null);
  const eased = morph ? (morph.k < 0.5 ? 4 * morph.k ** 3 : 1 - (-2 * morph.k + 2) ** 3 / 2) : 1;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [key, to] of targets) {
    let from = morph?.from.get(key);
    if (morph && !from) {
      const [line, study] = key.split('-').map(Number);
      for (let k = line - 1; k >= 0 && !from; k--) from = morph.from.get(`${k}-${study}`);
    }
    from ??= to;
    pos.set(key, { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
  }
  const at2 = (i: number, j: number) => pos.get(`${i}-${j}`) ?? { x: 0, y: 0 };
  const drawnAt = useRef(pos);
  useEffect(() => {
    drawnAt.current = pos;
  });
  const morphKey = `${lines.map((line) => line.key).join(',')}|${[...off].sort().join(',')}`;
  const morphFrame = useRef(0);
  const morphedFor = useRef(morphKey);
  useLayoutEffect(() => {
    if (morphedFor.current === morphKey) return;
    morphedFor.current = morphKey;
    cancelAnimationFrame(morphFrame.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = new Map(drawnAt.current);
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const k = Math.min(1, (now - start) / 650);
      setMorph(k < 1 ? { from, k } : null);
      if (k < 1) morphFrame.current = requestAnimationFrame(step);
    };
    setMorph({ from, k: 0 });
    morphFrame.current = requestAnimationFrame(step);
  }, [morphKey]);
  useEffect(() => () => cancelAnimationFrame(morphFrame.current), []);

  // The names at each line's right end, pushed apart so none overlap.
  const labels = lines
    .map((s, i) => {
      const end = answered(i).at(-1);
      // A hidden line's end may lie off the refitted axis: its name stays
      // on the chart (it is how the line comes back), clamped to the edge.
      const drawn = off.has(i) ? null : pos.get(`${i}-${end?.j}`);
      return end
        ? {
            i,
            y: Math.min(M.t + ih, Math.max(M.t, drawn?.y ?? Y(end.r.v))),
            x: drawn?.x ?? X(end.study.vertices),
          }
        : null;
    })
    .filter((l): l is { i: number; y: number; x: number } => l !== null)
    .sort((a, b) => a.y - b.y);
  const gap = 17;
  const placed = labels.map((l) => ({ ...l, ly: l.y }));
  for (let k = 1; k < placed.length; k++) {
    placed[k].ly = Math.max(placed[k].ly, placed[k - 1].ly + gap);
  }
  const overflow = (placed.at(-1)?.ly ?? 0) - (M.t + ih);
  if (overflow > 0) {
    for (let k = placed.length - 1; k >= 0; k--) {
      placed[k].ly -= overflow;
      if (k > 0) placed[k - 1].ly = Math.min(placed[k - 1].ly, placed[k].ly - gap);
    }
  }

  const lit = hover?.series ?? focus;
  const toggle = (i: number) => {
    const next = new Set(off);
    if (!next.delete(i)) next.add(i);
    // The last line on the chart stays.
    if (next.size >= lines.length) return;
    onOff(next);
  };
  // The words at the slider's ends sweep it there over a moment; a drag
  // takes over at once.
  const sweep = useRef(0);
  useEffect(() => () => cancelAnimationFrame(sweep.current), []);
  const sweepTo = (target: number) => {
    cancelAnimationFrame(sweep.current);
    const from = logness;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onLogness(target);
      return;
    }
    let start: number | null = null;
    const frame = (now: number) => {
      start ??= now;
      const k = Math.min(1, (now - start) / 700);
      const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      onLogness(from + (target - from) * eased);
      if (k < 1) sweep.current = requestAnimationFrame(frame);
    };
    sweep.current = requestAnimationFrame(frame);
  };
  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(event);
    let best: Hover | null = null;
    let bestD = 30 * 30;
    points.forEach((row, i) => {
      if (off.has(i)) return;
      row.forEach((r, j) => {
        if (!r) return;
        const dx = at2(i, j).x - x;
        const dy = at2(i, j).y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { series: i, study: j, x, y };
        }
      });
    });
    setHover(best);
  };

  const columns = [...new Set(ns)].sort((a, b) => a - b);
  // Columns close together drop the spaces between the names they share;
  // from the largest down, a column too close to a named one (the linear
  // end crowds the small graphs) keeps only its line.
  const tight = narrow || columns.some((n, k) => k > 0 && X(n) - X(columns[k - 1]) < 64);
  const namedAt: number[] = [];
  const labelled = new Set<number>();
  for (const n of [...columns].reverse()) {
    if (namedAt.every((x) => Math.abs(x - X(n)) >= 44)) {
      namedAt.push(X(n));
      labelled.add(n);
    }
  }

  return (
    <div className={styles.chartBlock}>
      <div className={styles.legend} role="group" aria-label={w.scaling.legend}>
        {/* On a phone the lines' names live here; wider, at their ends. */}
        {narrow &&
          lines.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className={styles.legendItem}
              aria-pressed={!off.has(i)}
              data-dim={lit !== null && lit !== i ? true : undefined}
              onPointerEnter={() => setFocus(i)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              onClick={() => toggle(i)}
            >
              <span className={styles.legendLine} style={{ '--c': s.colour } as CSSProperties} />
              {s.name}
              {slopes[i] !== null && (
                <span className={`mono ${styles.legendSlope}`} title={w.scaling.slope}>
                  n{superscript(slopes[i] as number)}
                </span>
              )}
            </button>
          ))}
      </div>
      <div ref={ref} className={styles.chart}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className={styles.svg}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover && onOpen(studies[hover.study])}
            data-pointing={hover ? true : undefined}
          >
            <g key={unit} className={`${styles.landmarks} ${styles.svgSwap}`}>
              {ticks.map((t) => (
                <g key={t.ms}>
                  <line x1={M.l} x2={M.l + iw + 8} y1={Y(t.ms)} y2={Y(t.ms)} />
                  <text x={M.l - 10} y={Y(t.ms)} dy="0.32em" textAnchor="end">
                    {t.label}
                  </text>
                </g>
              ))}
            </g>
            {rules.map((rule) => (
              <g key={rule.label} className={styles.rule}>
                <line x1={M.l} x2={M.l + iw + 8} y1={Y(rule.v)} y2={Y(rule.v)} />
                <text x={M.l + 6} y={Y(rule.v) - 6}>
                  {rule.label}
                </text>
              </g>
            ))}
            {/* One column per size of graph, named under the axis. */}
            <g className={styles.columns}>
              {columns.map((n) => {
                const here = studies.filter((s) => s.vertices === n);
                const on = hover !== null && studies[hover.study].vertices === n;
                return (
                  <g key={n} data-on={on || undefined}>
                    <line x1={X(n)} x2={X(n)} y1={M.t} y2={M.t + ih} />
                    {!narrow && labelled.has(n) && (
                      <text x={X(n)} y={M.t + ih + 18} textAnchor="middle" className="mono">
                        {shortCount(n)}
                      </text>
                    )}
                    {labelled.has(n) && (
                      <text
                        x={X(n)}
                        y={M.t + ih + (narrow ? 18 : 34)}
                        textAnchor="middle"
                        className={styles.columnNames}
                      >
                        {here.map((s, k) => (
                          <tspan
                            key={s.name}
                            className={styles.columnName}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(s);
                            }}
                          >
                            {k > 0 ? (tight ? '·' : ' · ') : ''}
                            {shortName(s.name)}
                          </tspan>
                        ))}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={M.l + iw} y={M.t + ih + 18} dx="34" className={styles.axisName}>
                {w.scaling.axis}
              </text>
            </g>
            {/* The lines: a dashed stretch reaches an estimate. */}
            <g className={styles.lines}>
              {lines.map((s, i) => {
                if (off.has(i)) return null;
                const run = answered(i);
                return (
                  <g
                    key={i}
                    className={styles.series}
                    data-dim={lit !== null && lit !== i ? true : undefined}
                    style={{ '--c': s.colour, '--i': i } as CSSProperties}
                  >
                    {run.slice(1).map((p, k) => {
                      const q = run[k];
                      return (
                        <line
                          key={p.study.name}
                          x1={at2(i, q.j).x}
                          y1={at2(i, q.j).y}
                          x2={at2(i, p.j).x}
                          y2={at2(i, p.j).y}
                          className={styles.seg}
                          data-estimate={estimated(q.r.kind) || estimated(p.r.kind) || undefined}
                        />
                      );
                    })}
                    {studies.map((study, j) => {
                      const r = points[i][j];
                      if (!r) return null;
                      return (
                        <Mark
                          key={study.name}
                          x={at2(i, j).x}
                          y={at2(i, j).y}
                          r={4}
                          colour={s.colour}
                          kind={r.kind}
                          lit={hover?.series === i && hover.study === j}
                          instant
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
            {/* Each line named at its right end. */}
            <g className={styles.endLabels}>
              {(narrow ? [] : placed).map((l) => (
                <g
                  key={l.i}
                  className={styles.endLabel}
                  data-dim={lit !== null && lit !== l.i ? true : undefined}
                  data-off={off.has(l.i) || undefined}
                  role="button"
                  tabIndex={0}
                  aria-pressed={!off.has(l.i)}
                  aria-label={`${w.scaling.legend}: ${lines[l.i].name}`}
                  onPointerEnter={() => setFocus(l.i)}
                  onPointerLeave={() => setFocus(null)}
                  onFocus={() => setFocus(l.i)}
                  onBlur={() => setFocus(null)}
                  onPointerMove={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(l.i);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(l.i);
                    }
                  }}
                >
                  {!off.has(l.i) && (
                    <path
                      d={`M${l.x + 8},${l.y} C${l.x + 20},${l.y} ${l.x + 14},${l.ly} ${l.x + 26},${l.ly}`}
                      className={styles.leader}
                    />
                  )}
                  <rect
                    x={l.x + 26}
                    y={l.ly - 9}
                    width={M.r - 30}
                    height={18}
                    rx={4}
                    className={styles.endHit}
                  />
                  <line
                    x1={l.x + 30}
                    x2={l.x + 42}
                    y1={l.ly}
                    y2={l.ly}
                    className={styles.endSwatch}
                    style={{ '--c': lines[l.i].colour } as CSSProperties}
                  />
                  <text x={l.x + 48} y={l.ly} dy="0.32em">
                    {lines[l.i].name}
                    {slopes[l.i] !== null && (
                      <tspan className={styles.endSlope}>
                        {' '}
                        n{superscript(slopes[l.i] as number)}
                      </tspan>
                    )}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        )}
        <Tip at={hover ? { x: hover.x, y: hover.y, width, height } : null}>
          {hover && tip(hover.series, hover.study)}
        </Tip>
      </div>
      <div className={base.growthScale}>
        <button type="button" onClick={() => sweepTo(0)} data-on={logness === 0 || undefined}>
          {w.scaling.scale.linear}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(logness * 1000)}
          aria-label={w.scaling.scale.label}
          onChange={(event) => {
            cancelAnimationFrame(sweep.current);
            onLogness(Number(event.target.value) / 1000);
          }}
        />
        <button type="button" onClick={() => sweepTo(1)} data-on={logness === 1 || undefined}>
          {w.scaling.scale.log}
        </button>
      </div>
    </div>
  );
}

/* ---- overview: which schedule wins ---------------------------------------- */

type Metric = 'time' | 'scans';

/** The six schedules by graph, each cell how many times the graph's best
    schedule it took (by time or by scans): the growth chart's table view. */
function HeatTable({
  studies,
  metric,
  onOpen,
}: {
  studies: DirectedStudy[];
  metric: Metric;
  onOpen: (s: DirectedStudy) => void;
}) {
  const w = useT().studies.part3;
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; j: number; at: TipAt } | null>(null);

  const value = (r: Reading | null) =>
    !r ? null : metric === 'time' ? r.ms : (r.cell.counts?.scans ?? null);
  const grid = BELLMAN.map((s) => studies.map((study) => read(study, s)));
  const best = studies.map((_, j) => Math.min(...grid.map((row) => value(row[j]) ?? Infinity)));
  // Colour by how many times the best: ×1 palest, ×10 and beyond darkest.
  const shade = (ratio: number) => Math.min(1, Math.log10(Math.max(1, ratio)));

  return (
    <div className={styles.heatBlock}>
      <div
        ref={ref}
        className={styles.heat}
        style={{ '--cols': studies.length } as CSSProperties}
        onPointerLeave={() => setHover(null)}
      >
        <span />
        {studies.map((study) => (
          <button
            key={study.name}
            type="button"
            className={styles.heatHead}
            onClick={() => onOpen(study)}
            title={w.tip.open(shortName(study.name))}
          >
            <span className="mono">{shortName(study.name)}</span>
            {study.cycle_anywhere ? (
              <em className={styles.cycleWord}>{w.heat.cycle}</em>
            ) : (
              <em className="mono">{shortCount(study.vertices)}</em>
            )}
          </button>
        ))}
        {BELLMAN.map((s, i) => (
          <Fragment key={s.key}>
            <span className={`mono ${styles.heatName}`}>
              <span className={styles.swatch} style={{ '--c': s.colour } as CSSProperties} />
              {w.names[s.name]}
            </span>
            {studies.map((study, j) => {
              const r = grid[i][j];
              const v = value(r);
              if (v === null || !r) {
                return (
                  <span key={study.name} className={styles.heatCell} data-empty>
                    ·
                  </span>
                );
              }
              const ratio = v / best[j];
              const top = ratio < 1.0005;
              const k = shade(ratio);
              return (
                <span
                  key={study.name}
                  className={styles.heatCell}
                  data-best={top || undefined}
                  data-dark={k > 0.55 || undefined}
                  data-lit={hover?.i === i && hover.j === j ? true : undefined}
                  data-cross={
                    hover && (hover.i === i || hover.j === j) && !(hover.i === i && hover.j === j)
                      ? true
                      : undefined
                  }
                  style={{ '--k': k } as CSSProperties}
                  onPointerEnter={(event) => {
                    const box = ref.current?.getBoundingClientRect();
                    const cell = event.currentTarget.getBoundingClientRect();
                    if (!box) return;
                    setHover({
                      i,
                      j,
                      at: {
                        x: cell.left - box.left + cell.width / 2,
                        y: cell.top - box.top + cell.height / 2,
                        width,
                        height,
                      },
                    });
                  }}
                  onClick={() => onOpen(study)}
                >
                  <span className="mono">
                    {top ? w.heat.best : w.heat.times(ratioText(ratio))}
                    {estimated(r.kind) && '≈'}
                  </span>
                </span>
              );
            })}
          </Fragment>
        ))}
        <Tip at={hover?.at ?? null}>
          {hover && grid[hover.i][hover.j] && (
            <>
              <ReadingTip
                w={w}
                study={studies[hover.j]}
                r={grid[hover.i][hover.j] as Reading}
                colour={BELLMAN[hover.i].colour}
                title={`Bellman-Ford, ${w.names[BELLMAN[hover.i].name]}`}
              />
              {(() => {
                const v = value(grid[hover.i][hover.j]);
                const ratio = v === null ? 1 : v / best[hover.j];
                return ratio >= 1.0005 ? (
                  <p className={styles.tipNote}>{w.heat.ratio(ratioText(ratio))}</p>
                ) : null;
              })()}
            </>
          )}
        </Tip>
      </div>
      <div className={styles.heatScale}>
        <span className="mono">×1</span>
        <span className={styles.heatRamp} />
        <span className="mono">×10+</span>
        <span>{w.heat.scale}</span>
      </div>
    </div>
  );
}

/* ---- all pairs: the race --------------------------------------------------- */

function RacePanel({
  studies,
  axis,
  selected,
  onOpen,
  index,
}: {
  studies: DirectedStudy[];
  axis: Axis;
  selected: DirectedStudy | null;
  onOpen: (s: DirectedStudy) => void;
  index: number;
}) {
  const t = useT();
  const w = t.studies.part3;
  const verdict = selected ? allPairsVerdict(w, selected) : null;
  return (
    <Chapter
      index={index}
      title={w.race.title}
      delay={0.1}
      className={`${styles.panel} ${styles.racePanel} ${selected ? styles.raceOne : ''}`}
    >
      <RaceChart studies={studies} axis={axis} selected={selected} onOpen={onOpen} />
      {selected && (
        <div className={styles.verdict}>
          {verdict ? (
            <>
              <p className={styles.verdictLine}>
                <Swap view={viewId(selected)}>{verdict.long}</Swap>
                {verdict.why && <Why label={w.allPairs.whyLabel}>{verdict.why}</Why>}
              </p>
            </>
          ) : (
            <p className="comment">{w.pending}</p>
          )}
        </div>
      )}
    </Chapter>
  );
}

/** The measured reason behind a verdict, behind an info button: shown
    while the button is hovered or focused, so the board keeps its fit. */
function Why({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.why}>
      <button
        type="button"
        className={styles.whyButton}
        aria-label={label}
        aria-expanded={open}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open && (
        <span className={styles.whyTip} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}

function RaceChart({
  studies: every,
  axis,
  selected,
  onOpen,
}: {
  studies: DirectedStudy[];
  axis: Axis;
  selected: DirectedStudy | null;
  onOpen: (s: DirectedStudy) => void;
}) {
  const w = useT().studies.part3;
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ row: number; s: number; x: number; y: number } | null>(null);
  // A graph's sheet races that graph alone, on the axis of them all.
  const studies = selected ? [selected] : every;
  // On a phone the memory column gives way to the race.
  const narrow = width < 380;
  const M = { l: 44, r: narrow ? 14 : 150, t: 26, b: selected ? 4 : 22 };
  const iw = Math.max(1, width - M.l - M.r);
  const ih = Math.max(1, height - M.t - M.b);
  const rowH = ih / Math.max(1, studies.length);
  // The race spans the times it shows: one graph's own, so its marks use
  // the whole width (at least a decade and a half, padded each side). A
  // change of graph runs the axis to the new span, every mark with it.
  const times = studies.flatMap((s) => PAIRS.map((p) => read(s, p)?.ms ?? 0)).filter((v) => v > 0);
  const fitLo = Math.log10(Math.max(axis.lo, times.length > 0 ? Math.min(...times) : 1));
  const fitHi = Math.log10(times.length > 0 ? Math.max(...times) : 10);
  const middle = (fitLo + fitHi) / 2;
  const reach = Math.max(fitHi - fitLo, 1.5);
  const a = useTween(middle - reach * 0.62);
  const b = useTween(middle + reach * 0.62);
  const X = (ms: number) => M.l + (iw * (Math.log10(ms) - a)) / (b - a);
  // Its marks: the named durations first, then round amounts of each unit,
  // each kept only where its label clears the ones already placed.
  const raceTicks: { ms: number; label: string; x: number }[] = [];
  for (const [ms, label] of [
    ...LANDMARKS.map((l) => [l.ms, w.time.landmarks[l.key]] as const),
    ...LINEAR_MS.map((ms) => [ms, tickText(w, ms)] as const),
  ]) {
    const x = X(ms);
    const width = label.length * 6.4;
    if (x < M.l + width / 2 || x > M.l + iw - width / 2) continue;
    if (raceTicks.some((t) => Math.abs(t.x - x) < (width + t.label.length * 6.4) / 2 + 12)) {
      continue;
    }
    raceTicks.push({ ms, label, x });
  }
  const memory = every.find((s) => s.machine)?.machine?.total_memory_bytes ?? null;

  const rows = studies.map((study) => PAIRS.map((p) => read(study, p)));
  // On a graph's sheet the times run to the new graph's on the same curve
  // as the axis does: each mark's place, a share of the axis at both ends,
  // stays a share of it all the way, so nothing is drawn outside the row.
  const runs = useTweens(selected ? (rows[0] ?? []).map((r) => (r ? Math.log10(r.ms) : null)) : []);
  const P = (row: number, s: number) => {
    const r = rows[row][s];
    if (!r) return 0;
    return X(selected && Number.isFinite(runs[s]) ? 10 ** runs[s] : r.ms);
  };

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(event);
    const row = Math.floor((y - M.t) / rowH);
    if (row < 0 || row >= studies.length) {
      setHover(null);
      return;
    }
    let best: { row: number; s: number; x: number; y: number } | null = null;
    let bestD = 24;
    rows[row].forEach((r, s) => {
      if (!r) return;
      const d = Math.abs(P(row, s) - x);
      if (d < bestD) {
        bestD = d;
        best = { row, s, x, y };
      }
    });
    setHover(best);
  };
  const hovered = hover ? rows[hover.row][hover.s] : null;

  return (
    <div className={styles.chartBlock}>
      <div className={styles.legend}>
        {PAIRS.map((p) => (
          <span key={p.key} className={styles.legendItem} data-static>
            <span className={styles.legendDot} style={{ '--c': p.colour } as CSSProperties} />
            {w.names[p.name]}
          </span>
        ))}
      </div>
      <div ref={ref} className={styles.chart}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className={styles.svg}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover && onOpen(studies[hover.row])}
            data-pointing={hover ? true : undefined}
          >
            <g className={styles.landmarks}>
              {raceTicks.map((t) => (
                <g key={t.ms}>
                  <line x1={t.x} x2={t.x} y1={M.t - 6} y2={M.t + ih} />
                  <text x={t.x} y={M.t - 12} textAnchor="middle">
                    {t.label}
                  </text>
                </g>
              ))}
            </g>
            {!narrow && (
              <text x={M.l + iw + 14} y={M.t - 12} className={styles.axisName}>
                {w.race.table}
              </text>
            )}

            {studies.map((study, row) => {
              const y = M.t + rowH * (row + 0.5);
              const marks = rows[row];
              const there = marks.filter((r): r is Reading => r !== null);
              const bf = marks[0];
              const fw = marks[1];
              const cycle = there.some((r) => r.kind === 'cycle');
              const dim = selected !== null && selected !== study;
              const bytes = study.pairs?.table_bytes ?? null;
              const ratio = bf && fw ? (bf.ms < fw.ms ? fw.ms / bf.ms : bf.ms / fw.ms) : null;
              const xs = marks.flatMap((r, s) => (r ? [P(row, s)] : []));
              const minX = xs.length ? Math.min(...xs) : 0;
              const maxX = xs.length ? Math.max(...xs) : 0;
              return (
                <g
                  // A graph's sheet keeps its one row from graph to graph,
                  // so its marks glide to the new times.
                  key={selected ? 'one' : study.name}
                  className={styles.raceRow}
                  data-dim={dim || undefined}
                  data-selected={selected === study || undefined}
                >
                  <rect
                    x={0}
                    y={M.t + rowH * row + 2}
                    width={width}
                    height={rowH - 4}
                    rx={4}
                    className={styles.rowBand}
                  />
                  <SvgSwap view={study.name}>
                    <text
                      x={10}
                      y={y}
                      dy="0.32em"
                      className={`mono ${styles.rowName}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(study);
                      }}
                    >
                      {shortName(study.name)}
                    </text>
                  </SvgSwap>
                  {there.length > 0 && (
                    <HLine x1={minX} x2={maxX} y={y} className={styles.raceSpan} instant />
                  )}
                  {bf && fw && (
                    <HLine
                      instant
                      x1={P(row, 0)}
                      x2={P(row, 1)}
                      y={y}
                      className={styles.raceGap}
                      data-cycle={cycle || undefined}
                    />
                  )}
                  {bf &&
                    fw &&
                    rowH > 30 &&
                    (() => {
                      const words = cycle
                        ? w.race.noAnswer
                        : w.race.faster(
                            bf.ms < fw.ms ? w.race.bellman : w.race.floyd,
                            ratioText(ratio ?? 1),
                          );
                      // Centred over the gap, but kept clear of both columns.
                      const half = words.length * 3.4;
                      const mid = (P(row, 0) + P(row, 1)) / 2;
                      const x = Math.min(M.l + iw - half, Math.max(M.l + half, mid));
                      const who = bf.ms < fw.ms ? w.race.bellman : w.race.floyd;
                      return (
                        <text
                          style={at(x, y - 10)}
                          textAnchor="middle"
                          className={styles.raceRatio}
                          data-cycle={cycle || undefined}
                        >
                          {cycle ? (
                            words
                          ) : (
                            <Tweened
                              value={ratio ?? 1}
                              format={(v) => w.race.faster(who, ratioText(v))}
                            />
                          )}
                        </text>
                      );
                    })()}
                  {marks.map((r, s) =>
                    r ? (
                      <Mark
                        key={PAIRS[s].key}
                        x={P(row, s)}
                        y={y}
                        r={s < 2 ? 5 : 3.5}
                        colour={PAIRS[s].colour}
                        kind={r.kind}
                        lit={hover?.row === row && hover.s === s}
                        instant
                      />
                    ) : null,
                  )}
                  <SvgSwap view={study.name}>
                    {bytes !== null &&
                      !narrow &&
                      (() => {
                        const over = memory !== null && bytes > memory;
                        const verdict = over
                          ? w.race.over(ratioText(bytes / (memory as number)))
                          : w.race.fits;
                        // Two lines when the row has room, one when it is tight.
                        return rowH >= 32 ? (
                          <text x={M.l + iw + 14} y={y} className={`mono ${styles.memory}`}>
                            <tspan x={M.l + iw + 14} dy="-0.2em">
                              {formatBytes(bytes)}
                            </tspan>
                            <tspan
                              x={M.l + iw + 14}
                              dy="1.25em"
                              className={styles.memoryVerdict}
                              data-over={over || undefined}
                            >
                              {verdict}
                            </tspan>
                          </text>
                        ) : (
                          <text
                            x={M.l + iw + 14}
                            y={y}
                            dy="0.32em"
                            className={`mono ${styles.memory}`}
                          >
                            <title>{verdict}</title>
                            {formatBytes(bytes)}
                            <tspan className={styles.memoryVerdict} data-over={over || undefined}>
                              {' '}
                              {over ? `${ratioText(bytes / (memory as number))}×` : '✓'}
                            </tspan>
                          </text>
                        );
                      })()}
                  </SvgSwap>
                </g>
              );
            })}
          </svg>
        )}
        <Tip at={hover ? { x: hover.x, y: hover.y, width, height } : null}>
          {hover && hovered && (
            <ReadingTip
              w={w}
              study={studies[hover.row]}
              r={hovered}
              colour={PAIRS[hover.s].colour}
              title={w.names[PAIRS[hover.s].name]}
              open={selected !== studies[hover.row]}
            />
          )}
        </Tip>
      </div>
    </div>
  );
}

/** Which of n Bellman-Fords and Floyd-Warshall (pruned) was faster, by how
    much, and the measured scans per vertex behind it. */
function allPairsVerdict(w: Words, study: DirectedStudy) {
  const a = w.allPairs;
  const bellman = findCell(study.all_pairs, 'bellman-ford-all', 'queue');
  const floyd = findCell(study.all_pairs, 'floyd-warshall', 'pruned');
  if (stoppedAtCycle(bellman) || stoppedAtCycle(floyd)) return { long: a.cycleVerdict, why: null };
  const bf = cellTime(bellman)?.ms;
  const fw = cellTime(floyd)?.ms;
  if (!bf || !fw) return null;
  const bellmanWins = bf < fw;
  const ratio = ratioText(bellmanWins ? fw / bf : bf / fw);
  const scans = bellman?.counts ? bellman.counts.scans / Math.max(1, study.vertices) : null;
  return {
    long: a.verdict(bellmanWins ? a.bellman : a.floyd, ratio),
    why:
      scans === null
        ? null
        : a.why(
            scans.toFixed(2),
            power(study.vertices * scans * study.edges),
            power(study.vertices ** 3),
          ),
  };
}

/* ---- a graph: question 1, the paths to the target -------------------------- */

function TargetPanel({ study, studies }: { study: DirectedStudy; studies: DirectedStudy[] }) {
  const w = useT().studies.part3;
  const q = w.target;
  return (
    <Chapter
      index={1}
      title={q.title(String(study.target))}
      delay={0.05}
      className={`${styles.panel} ${styles.targetPanel}`}
    >
      {/* The ruler stays and glides from graph to graph; only a cycle,
          which leaves no distance to draw, swaps it for the ring. */}
      <div key={study.cycle_to_target ? 'ring' : 'ruler'} className={styles.swapBlock}>
        {study.cycle_to_target ? (
          // The ring in the ruler's box, the problem in the ruler's caption:
          // the panel keeps its height from graph to graph.
          <div className={styles.chartBlock}>
            <div
              className={styles.chart}
              style={{ flex: 'none', minHeight: 0, height: rulerHeight(3) }}
              aria-label={cycleText(study.cycle_to_target)}
            >
              <CycleRing cycle={study.cycle_to_target} />
            </div>
            <p className={`${styles.hint} ${styles.caption}`}>
              <span className={styles.cycleWord}>
                {q.cycle(String(study.target), signed(study.cycle_to_target.weight))}
              </span>
            </p>
          </div>
        ) : study.paths.length === 0 ? (
          <p className="comment">{w.pending}</p>
        ) : (
          <PathRuler study={study} studies={studies} />
        )}
      </div>
    </Chapter>
  );
}

/** A cycle as the CLI prints it, shortened in the middle when long. */
function cycleText(cycle: NegativeCycle) {
  const closed = [...cycle.cycle, cycle.cycle[0]];
  const shown =
    closed.length <= 7
      ? closed.map(String)
      : [...closed.slice(0, 3).map(String), '…', ...closed.slice(-2).map(String)];
  return shown.join(' → ');
}

/** The paths to the target on one distance axis: each vertex a dot at its
    distance from the source, the target at the far end. */
function PathRuler({ study, studies }: { study: DirectedStudy; studies: DirectedStudy[] }) {
  const w = useT().studies.part3;
  const q = w.target;
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ row: number; k: number; x: number; y: number } | null>(null);
  const paths = study.paths;
  const M = { l: 72, r: width < 560 ? 112 : 128, t: 8, b: 26 };
  const iw = Math.max(1, width - M.l - M.r);
  const ih = Math.max(1, height - M.t - M.b);
  const rowH = ih / Math.max(1, paths.length);
  const top = Math.max(1e-9, ...paths.map((p) => p.distance ?? 0));
  const X = (d: number) => M.l + (iw * d) / top;
  // The study writes each vertex's distance to the target; from the source
  // it is the total less that.
  const along = paths.map((p) =>
    (p.distances ?? []).map((d) => Math.min(p.distance ?? 0, Math.max(0, (p.distance ?? 0) - d))),
  );
  const ticks = niceTicks(top, 5);
  // Each row keeps as many dots as the longest path any graph has there, so
  // a change of graph slides the dots it shares and fades the rest into the
  // target, instead of redrawing the row.
  const slots = paths.map((_, row) =>
    Math.max(...studies.map((s) => s.paths[row]?.path.length ?? 0), 1),
  );

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(event);
    const row = Math.floor((y - M.t) / rowH);
    if (row < 0 || row >= paths.length) return setHover(null);
    let best: { row: number; k: number; x: number; y: number } | null = null;
    let bestD = 16;
    along[row].forEach((d, k) => {
      const dx = Math.abs(X(d) - x);
      if (dx < bestD) {
        bestD = dx;
        best = { row, k, x, y };
      }
    });
    setHover(best);
  };

  const hp = hover && hover.k < (along[hover.row]?.length ?? 0) ? paths[hover.row] : null;
  return (
    <div className={styles.chartBlock}>
      <div
        ref={ref}
        className={styles.chart}
        style={{ flex: 'none', minHeight: 0, height: rulerHeight(paths.length) }}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className={styles.svg}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <g className={styles.landmarks}>
              {ticks.map((d) => (
                <g key={d} className={`${styles.glide} ${styles.fadeIn}`} style={at(X(d), 0)}>
                  <line x1={0} x2={0} y1={M.t} y2={M.t + ih} />
                  <text x={0} y={M.t + ih + 16} textAnchor="middle">
                    {formatWeight(d)}
                  </text>
                </g>
              ))}
            </g>
            {paths.map((p, row) => {
              const y = M.t + rowH * (row + 0.5);
              const ds = along[row];
              const hops = Math.max(0, p.path.length - 1);
              return (
                <g
                  key={p.from}
                  className={styles.pathRow}
                  data-dim={hover && hover.row !== row ? true : undefined}
                >
                  <text x={0} y={y} dy="0.32em" className={styles.pathFrom}>
                    {q.from(String(p.from))}
                  </text>
                  {p.distance === null ? (
                    <text x={M.l} y={y} dy="0.32em" className={styles.unreached}>
                      {q.unreached}
                    </text>
                  ) : (
                    <>
                      <HLine x1={M.l} x2={X(p.distance)} y={y} className={styles.pathLine} />
                      {Array.from({ length: slots[row] }, (_, k) => {
                        const here = k < ds.length;
                        const end = k >= ds.length - 1;
                        const start = k === 0;
                        const lit = hover?.row === row && hover.k === k;
                        return (
                          <circle
                            key={k}
                            r={lit ? 6 : start || end ? 5 : 3.2}
                            style={at(X(here ? ds[k] : (ds.at(-1) ?? 0)), y)}
                            data-gone={here ? undefined : true}
                            className={`${styles.glide} ${
                              end ? styles.pathTarget : start ? styles.pathSource : styles.pathStop
                            }`}
                          />
                        );
                      })}
                      <text
                        dy="0.32em"
                        style={at(X(p.distance) + 14, y)}
                        className={`mono ${styles.glide} ${styles.pathEnd}`}
                      >
                        <Tweened value={p.distance} format={signed} />
                        <tspan className={styles.pathHops}>
                          {' '}
                          <Tweened value={hops} format={(v) => q.hops(Math.round(v))} />
                        </tspan>
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <Tip at={hover ? { x: hover.x, y: hover.y, width, height } : null}>
          {hover && hp && (
            <>
              <TipHead>
                {hover.k === 0 ? q.source(String(hp.path[0])) : q.vertex(String(hp.path[hover.k]))}
              </TipHead>
              <p className={`mono ${styles.tipValue}`}>
                {q.fromSource(signed(along[hover.row][hover.k]), String(hp.from))}
              </p>
              <p className={styles.tipNote}>
                {q.toTarget(signed(hp.distances?.[hover.k] ?? 0), String(study.target))}
                {hover.k > 0 && ` · ${q.step(String(hover.k), String(hp.path.length - 1))}`}
              </p>
            </>
          )}
        </Tip>
      </div>
      <p className={`${styles.hint} ${styles.caption}`}>{q.hint}</p>
    </div>
  );
}

/** The height of the paths' ruler: a row a source, and its axis. */
function rulerHeight(rows: number): number {
  return 34 * Math.max(1, rows) + 34;
}

/** Round ticks from 0 to about `top`. */
function niceTicks(top: number, count: number): number[] {
  const raw = top / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** The negative cycle that leaves the distances undefined, drawn as the
    ring it is: its vertices on a circle, its arcs in order, its weight in
    the middle. */
export function CycleRing({
  cycle,
  across = false,
}: {
  cycle: NegativeCycle;
  /** For a wide, short box: the first vertex on the left, the ring as tall
      as the box, and the weight left to the words beside it. */
  across?: boolean;
}) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const arrow = `p3-arrow-${useId().replace(/:/g, '')}`;
  const shown = cycle.cycle.length > 12 ? cycle.cycle.slice(0, 12) : cycle.cycle;
  const cx = width / 2;
  const cy = height / 2;
  const R = across
    ? Math.max(10, Math.min(height / 2 - 4, width / 2 - 34))
    : Math.max(10, Math.min(width, height) / 2 - 14);
  const angleOf = (k: number) =>
    (across ? Math.PI : -Math.PI / 2) + (2 * Math.PI * k) / shown.length;
  const at = (k: number) => {
    const angle = angleOf(k);
    return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
  };
  // Half of a vertex's pill, and how far round the circle an arc must keep
  // from it: along the tangent there, out of the pill and a little more.
  const half = (v: number) => 12 + 3.4 * String(v).length;
  const clearance = (k: number) => {
    const angle = angleOf(k);
    const tx = Math.abs(Math.sin(angle));
    const ty = Math.abs(Math.cos(angle));
    const out = Math.min(
      tx > 1e-6 ? half(shown[k]) / tx : Infinity,
      ty > 1e-6 ? 11 / ty : Infinity,
    );
    return Math.asin(Math.min(0.95, (out + 5) / R));
  };
  const point = (angle: number) => ({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) });
  return (
    <div ref={ref} className={styles.ringBox}>
      {width > 0 && (
        <svg width={width} height={height} className={styles.svg} aria-label={cycleText(cycle)}>
          <defs>
            <marker
              id={arrow}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className={styles.arrowHead} />
            </marker>
          </defs>
          {shown.map((v, k) => {
            // Each arc runs along the circle itself, clockwise from one
            // vertex to the next, so together they close the ring.
            const next = (k + 1) % shown.length;
            const from = angleOf(k) + clearance(k);
            const to = angleOf(k) + (2 * Math.PI) / shown.length - clearance(next);
            const p = point(from);
            const q = point(to);
            const large = to - from > Math.PI ? 1 : 0;
            return (
              <path
                key={`${v}-arc`}
                d={`M${p.x},${p.y} A${R},${R} 0 ${large} 1 ${q.x},${q.y}`}
                className={styles.ringArc}
                pathLength={1}
                markerEnd={`url(#${arrow})`}
                style={{ '--k': k } as CSSProperties}
              />
            );
          })}
          {shown.map((v, k) => {
            const p = at(k);
            return (
              <g key={v}>
                <rect
                  x={p.x - half(v)}
                  y={p.y - 11}
                  width={2 * half(v)}
                  height={22}
                  rx={11}
                  className={styles.ringNode}
                />
                <text x={p.x} y={p.y} dy="0.34em" textAnchor="middle" className="mono">
                  {v}
                </text>
              </g>
            );
          })}
          {!across && (
            <text
              x={cx}
              y={cy}
              dy="0.34em"
              textAnchor="middle"
              className={`mono ${styles.ringWeight}`}
            >
              {signed(cycle.weight)}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

/* ---- a graph: question 2, the table of five --------------------------------- */

function PairsPanel({ study }: { study: DirectedStudy }) {
  const w = useT().studies.part3;
  const pairs = study.pairs;
  const [hover, setHover] = useState<{ a: number; b: number } | null>(null);
  if (!pairs) {
    return (
      <Chapter
        index={2}
        title={w.pairs.title('10, 20, 30, 40, 50')}
        delay={0.1}
        className={styles.panel}
      >
        <p className="comment">{w.pending}</p>
      </Chapter>
    );
  }
  const vs = pairs.vertices;
  const cycle = pairs.negative_cycle;
  const off = vs.flatMap((_, a) =>
    vs.map((_, b) => (a === b ? null : (pairs.distances[a]?.[b] ?? null))),
  );
  const finite = off.filter((d): d is number => d !== null && Number.isFinite(d));
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const shade = (d: number) => (hi > lo ? (d - lo) / (hi - lo) : 0.5);
  const there = hover ? (pairs.distances[hover.a]?.[hover.b] ?? null) : null;
  const back = hover ? (pairs.distances[hover.b]?.[hover.a] ?? null) : null;

  return (
    <Chapter
      index={2}
      title={w.pairs.title(vs.join(', '))}
      delay={0.1}
      className={`${styles.panel} ${styles.pairsPanel}`}
    >
      <div className={styles.pairsBody}>
        <div
          className={styles.pairs}
          style={{ '--n': vs.length } as CSSProperties}
          onPointerLeave={() => setHover(null)}
          data-cycle={cycle ? true : undefined}
        >
          <span className={`mono ${styles.pairsCorner}`}>{w.pairs.corner}</span>
          {vs.map((v, b) => (
            <span
              key={v}
              className={`mono ${styles.pairsHead}`}
              data-on={hover?.b === b || undefined}
            >
              {v}
            </span>
          ))}
          {vs.map((u, a) => (
            <Fragment key={u}>
              <span className={`mono ${styles.pairsHead}`} data-on={hover?.a === a || undefined}>
                {u}
              </span>
              {vs.map((v, b) => {
                const d = pairs.distances[a]?.[b] ?? null;
                const self = a === b;
                const k = d === null || self ? 0 : shade(d);
                return (
                  <span
                    key={v}
                    className={styles.pairsCell}
                    data-self={self || undefined}
                    data-dark={k > 0.6 || undefined}
                    data-lit={hover?.a === a && hover.b === b ? true : undefined}
                    data-mirror={
                      hover && !self && hover.a === b && hover.b === a ? true : undefined
                    }
                    style={{ '--k': k } as CSSProperties}
                    onPointerEnter={() => setHover(self || cycle ? null : { a, b })}
                  >
                    {/* The value runs to the new graph's; the shade blends. */}
                    <span className="mono">
                      {cycle || d === null ? (
                        cycle ? (
                          '·'
                        ) : (
                          '∞'
                        )
                      ) : (
                        <Tweened value={d} format={signed} />
                      )}
                    </span>
                  </span>
                );
              })}
            </Fragment>
          ))}
          {/* A cycle leaves the table undefined: it is drawn over the table's
              cells, where the distances would be. */}
          {cycle && (
            <div className={styles.pairsRing} aria-label={cycleText(cycle)}>
              <CycleRing cycle={cycle} />
            </div>
          )}
        </div>
        <div className={styles.pairsSide}>
          {hover && there !== null && back !== null ? (
            <div className={styles.pairsRead}>
              <p className={`mono ${styles.tipValue}`}>
                {w.pairs.there(String(vs[hover.a]), String(vs[hover.b]), signed(there))}
              </p>
              <p className={`mono ${styles.pairsBack}`}>
                {w.pairs.back(String(vs[hover.a]), String(vs[hover.b]), signed(back))}
              </p>
              <p className={styles.tipNote}>
                {Math.abs(there - back) < 1e-9
                  ? w.pairs.same
                  : back > there
                    ? w.pairs.asymmetry(ratioText(back / Math.max(1e-9, there)))
                    : w.pairs.asymmetryThere(ratioText(there / Math.max(1e-9, back)))}
              </p>
            </div>
          ) : (
            <p className={`${styles.hint} ${styles.caption}`}>
              <Swap view={viewId(study)}>
                {cycle && (
                  <span className={styles.cycleWord}>{w.pairs.cycle(signed(cycle.weight))} </span>
                )}
                {pairs.method !== 'floyd-warshall' &&
                  w.pairs.byBellman(formatBytes(pairs.table_bytes))}
              </Swap>
            </p>
          )}
        </div>
      </div>
    </Chapter>
  );
}

/* ---- a graph: question 3, every time ---------------------------------------- */

const GROUPS: { key: keyof Words['timing']['groups']; series: Series[] }[] = [
  { key: 'bellman', series: BELLMAN },
  { key: 'floyd', series: FLOYD },
  { key: 'searches', series: SEARCHES },
];

function TimesPanel({
  studies,
  study,
  axis,
  onOpen,
}: {
  studies: DirectedStudy[];
  study: DirectedStudy;
  axis: Axis;
  onOpen: (s: DirectedStudy) => void;
}) {
  const w = useT().studies.part3;
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{
    row: number;
    x: number;
    y: number;
    ghost: number | null;
  } | null>(null);
  const rows = GROUPS.flatMap((g, gi) => g.series.map((s) => ({ s, gi })));
  const narrow = width < 560;
  const M = { l: narrow ? 128 : 118, r: narrow ? 80 : 176, t: 20, b: 4 };
  const head = 16;
  const iw = Math.max(1, width - M.l - M.r);
  const ih = Math.max(1, height - M.t - M.b - head * GROUPS.length);
  const rowH = ih / rows.length;
  const X = (ms: number) => M.l + iw * axis.at(ms);
  const rowY = (k: number) => M.t + head * (rows[k].gi + 1) + rowH * (k + 0.5);
  const me = studies.indexOf(study);

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(event);
    let row = -1;
    rows.forEach((_, k) => {
      if (Math.abs(rowY(k) - y) <= rowH / 2) row = k;
    });
    if (row < 0) return setHover(null);
    // A ghost under the pointer is read instead of the graph's own point.
    let ghost: number | null = null;
    let bestD = 7;
    studies.forEach((other, j) => {
      if (j === me) return;
      const r = read(other, rows[row].s);
      if (!r) return;
      const d = Math.abs(X(r.ms) - x);
      if (d < bestD) {
        bestD = d;
        ghost = j;
      }
    });
    setHover({ row, x, y, ghost });
  };

  const hs = hover ? rows[hover.row].s : null;
  const hj = hover ? (hover.ghost ?? me) : me;
  const hr = hs ? read(studies[hj], hs) : null;

  return (
    <Chapter
      index={3}
      title={w.timing.title}
      delay={0.15}
      className={`${styles.panel} ${styles.timesPanel}`}
    >
      <div ref={ref} className={styles.chart}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className={styles.svg}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover?.ghost != null && onOpen(studies[hover.ghost])}
            data-pointing={hover?.ghost != null ? true : undefined}
          >
            <Landmarks
              w={w}
              axis={axis}
              place={(t) => M.l + iw * t}
              from={M.t - 4}
              to={height - M.b}
              along="x"
              labelAt={M.t - 10}
            />
            {GROUPS.map((g, gi) => {
              const first = rows.findIndex((r) => r.gi === gi);
              return (
                <text key={g.key} x={0} y={rowY(first) - rowH / 2 - 6} className={styles.groupName}>
                  {w.timing.groups[g.key]}
                </text>
              );
            })}
            {rows.map(({ s }, k) => {
              const y = rowY(k);
              const r = read(study, s);
              const on = hover?.row === k;
              return (
                <g key={s.key} className={styles.timeRow} data-on={on || undefined}>
                  <rect
                    x={0}
                    y={y - rowH / 2 + 1}
                    width={width}
                    height={rowH - 2}
                    rx={3}
                    className={styles.rowBand}
                  />
                  <text x={10} y={y} dy="0.32em" className={`mono ${styles.rowLabel}`}>
                    {w.names[s.name]}
                  </text>
                  <line x1={M.l} x2={M.l + iw} y1={y} y2={y} className={styles.rowRule} />
                  {studies.map((other, j) => {
                    if (j === me) return null;
                    const g = read(other, s);
                    if (!g) return null;
                    return (
                      <g
                        key={other.name}
                        className={`${styles.glide} ${styles.fadeIn}`}
                        style={at(X(g.ms), y)}
                      >
                        <circle
                          r={hover?.row === k && hover.ghost === j ? 4.5 : 3}
                          className={styles.ghost}
                          data-hollow={estimated(g.kind) || undefined}
                        />
                        {on && (
                          <text y={-8} textAnchor="middle" className={`mono ${styles.ghostName}`}>
                            {shortName(other.name)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {r ? (
                    <>
                      <Mark
                        x={X(r.ms)}
                        y={y}
                        r={5}
                        colour={s.colour}
                        kind={r.kind}
                        lit={on && hover?.ghost == null}
                      />
                      <SvgSwap view={viewId(study)}>
                        <text
                          x={M.l + iw + 16}
                          y={y}
                          dy="0.32em"
                          className={`mono ${styles.rowValue}`}
                        >
                          {spanOf(w, r)}
                          {!narrow && r.cell.counts && r.cell.counts.passes > 0 && (
                            <tspan className={styles.rowDetail}>
                              {' '}
                              {w.timing.passes(formatInt(r.cell.counts.passes))}
                            </tspan>
                          )}
                          {r.kind === 'cycle' && (
                            <tspan className={styles.cycleWord}> {w.timing.atCycle}</tspan>
                          )}
                        </text>
                      </SvgSwap>
                    </>
                  ) : (
                    <text
                      x={M.l + iw + 16}
                      y={y}
                      dy="0.32em"
                      className={`mono ${styles.rowDetail}`}
                    >
                      {w.timing.refused}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <Tip at={hover && hr ? { x: hover.x, y: hover.y, width, height } : null}>
          {hover && hs && hr && (
            <>
              <ReadingTip
                w={w}
                study={studies[hj]}
                r={hr}
                colour={hover.ghost == null ? hs.colour : 'var(--fg-3)'}
                title={w.names[hs.name]}
                open={hover.ghost != null}
              />
              {hr.cell.counts && hr.cell.counts.scans > 0 && (
                <p className={`mono ${styles.tipSub}`}>
                  {w.tip.perVertex(
                    (hr.cell.counts.scans / Math.max(1, studies[hj].vertices)).toFixed(2),
                  )}
                </p>
              )}
            </>
          )}
        </Tip>
      </div>
      <MarkKeys w={w} ghosts />
    </Chapter>
  );
}
