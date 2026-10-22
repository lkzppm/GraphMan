'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RotateCcw, Users } from 'lucide-react';
import { formatBytes, formatCompact, formatInt, formatMs, formatWeight } from '@/lib/format';
import type { FrontierKind, FrontierStudy, PathAnswer, WeightedStudy } from '@/lib/studies';
import { useT } from '@/i18n/LocaleProvider';
import Reveal from './Reveal';
import { Chapter, Swap } from './studies-kit';
import styles from './Studies.module.css';

/* Part 2 of the case studies, read from studies/weighted/results.json and
   laid out like Part 1: a menu stuck under the nav picks the view, the
   overview first, then one weighted graph each, the named networks last.
   The overview, like Part 1's, has the mean of the graphs in its head and
   only what compares them: the mean Dijkstra of each frontier against the
   graph's size, and the vector's ratio to the heap. A graph's sheet has its
   five paths from vertex 10 drawn to scale and its frontiers raced on one
   linear time axis (a dashed lane is an estimate where the budget cut the
   runs short); a network's sheet has its named paths. */

type T = ReturnType<typeof useT>;

const FRONTIERS: FrontierKind[] = ['vector', 'heap', 'lazy_heap'];
const FRONTIER_COLOUR: Record<FrontierKind, string> = {
  vector: 'var(--accent-2)',
  heap: 'var(--accent)',
  lazy_heap: 'var(--level-0)',
};

/** `grafo_W_3` → `W3`; any other name comes back whole. */
function weightedName(name: string): string {
  const match = /^grafo_w_?(\d+)$/i.exec(name);
  return match ? `W${match[1]}` : name;
}

/** A frontier's mean time, or its estimate when the budget cut every run. */
function frontierTime(study: WeightedStudy, kind: FrontierKind) {
  const run: FrontierStudy | undefined = study.frontiers.find((f) => f.frontier === kind);
  if (!run) return null;
  if (run.timing) return { ms: run.timing.mean_ms, estimated: false, run };
  if (run.partial) return { ms: run.partial.estimated_ms, estimated: true, run };
  return null;
}

/** Part 2's views: the overview, then one per graph, the named networks last. */
const PART_2 = '#parte-2';

/** A study's place in the address: `w3`, or the network's own name. */
function viewId(study: WeightedStudy): string {
  return study.names_file ? study.name.replace(/_/g, '-') : weightedName(study.name).toLowerCase();
}

/** A study as the menu and the sheet's title call it. */
function studyTitle(t: T, study: WeightedStudy): string {
  return study.names_file ? t.studies.part2.networkName : t.studies.graph(weightedName(study.name));
}

export default function StudiesPart2({ studies }: { studies: WeightedStudy[] }) {
  const t = useT();
  // The view (null: the overview, else a study's index), kept in the hash
  // like Part 1's: `#parte-2`, `#parte-2-w3`, `#parte-2-rede-colaboracao`.
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const id = location.hash.startsWith(`${PART_2}-`)
        ? location.hash.slice(PART_2.length + 1)
        : '';
      const i = studies.findIndex((study) => viewId(study) === id);
      setView(i >= 0 ? i : null);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [studies]);
  const choose = useCallback(
    (i: number | null) => {
      setView(i);
      history.replaceState(null, '', i === null ? PART_2 : `${PART_2}-${viewId(studies[i])}`);
    },
    [studies],
  );

  // The menu is a tablist, as in Part 1: the overview is stop 0, study i is
  // stop i + 1; left and right walk it from anywhere on the page.
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

  return (
    <>
      <nav className={styles.menu}>
        <div
          className={`container ${styles.menuInner}`}
          role="tablist"
          aria-label={t.studies.part2.views}
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === null}
            tabIndex={view === null ? 0 : -1}
            ref={(el) => {
              tabs.current[0] = el;
            }}
            className={styles.pick}
            data-active={view === null || undefined}
            onClick={() => choose(null)}
          >
            <span className={`mono ${styles.pickBall}`}>
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <circle cx="5" cy="5" r="3" fill="currentColor" />
              </svg>
            </span>
            <span className={styles.pickName}>{t.studies.overview}</span>
          </button>
          {studies.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={view === i}
              tabIndex={view === i ? 0 : -1}
              ref={(el) => {
                tabs.current[i + 1] = el;
              }}
              className={styles.pick}
              data-active={view === i || undefined}
              onClick={() => choose(i)}
            >
              <span className={`mono ${styles.pickBall}`}>
                {s.names_file ? <Users size={13} aria-hidden="true" /> : weightedName(s.name)}
              </span>
              <span className={styles.pickName}>{studyTitle(t, s)}</span>
            </button>
          ))}
        </div>
      </nav>
      {study === null ? (
        <OverviewSheet studies={studies} />
      ) : study.names_file ? (
        <NetworkSheet key={study.name} study={study} />
      ) : (
        <GraphSheet study={study} view={viewId(study)} />
      )}
    </>
  );
}

/** The timing note under the bars: how they were measured, and on what. */
function TimingNote({ studies }: { studies: WeightedStudy[] }) {
  const t = useT();
  const machine = studies.find((study) => study.machine)?.machine;
  const runs = Math.max(0, ...studies.flatMap((s) => s.frontiers.map((f) => f.requested_runs)));
  return (
    <p className={styles.note}>
      {t.studies.part2.timing.note(
        formatInt(runs),
        machine ? `${machine.cpu}, ${formatBytes(machine.total_memory_bytes)}.` : '',
      )}
    </p>
  );
}

/** How many times the heap's time the vector takes, when both were timed. */
function vectorRatio(study: WeightedStudy): number | null {
  const vector = frontierTime(study, 'vector');
  const heap = frontierTime(study, 'heap');
  return vector && heap && heap.ms > 0 ? Math.round(vector.ms / heap.ms) : null;
}

/** The overview, as in Part 1: the mean of the weighted graphs in its head,
    and only what compares them, the mean Dijkstra of each frontier against
    the graph's size with the vector's ratio to the heap per graph. The
    paths are each graph's own, in its tab. */
function OverviewSheet({ studies }: { studies: WeightedStudy[] }) {
  const t = useT();
  const p = t.studies.part2;
  const graphs = studies.filter((study) => !study.names_file);
  const weights = graphs.flatMap((study) => (study.weights ? [study.weights] : []));
  const timed = graphs.filter((study) => study.frontiers.length > 0);
  const mean = (pick: (study: WeightedStudy) => number) =>
    graphs.reduce((sum, study) => sum + pick(study), 0) / Math.max(graphs.length, 1);

  return (
    <div className={`container ${styles.content}`}>
      <Reveal className={styles.head}>
        <h1 className={styles.title}>{t.studies.overview}</h1>
        <div className={styles.facts}>
          <span className={styles.subtitle}>{t.studies.average(String(graphs.length))}</span>
          <span className={`mono ${styles.fact}`}>
            {formatInt(mean((study) => study.vertices))} <em>{t.studies.facts.vertices}</em>
          </span>
          <span className={`mono ${styles.fact}`}>
            {formatInt(mean((study) => study.edges))} <em>{t.studies.facts.edges}</em>
          </span>
          {weights.length > 0 && (
            <span className={styles.note}>
              {p.facts.weights(
                formatWeight(mean((study) => study.weights?.min ?? 0)),
                formatWeight(mean((study) => study.weights?.max ?? 0)),
                weights.every((w) => w.negative === 0),
              )}
            </span>
          )}
        </div>
      </Reveal>

      {timed.length > 0 && (
        <Chapter index={1} title={p.timing.title} delay={0.05} className={styles.chapterFill}>
          <div className={styles.timingHero}>
            <GrowthChart studies={timed} />
          </div>
          <TimingNote studies={timed} />
        </Chapter>
      )}
    </div>
  );
}

/** One weighted graph: its facts, the five paths from vertex 10 in full,
    and the race of its three frontiers. Switching graphs keeps the
    elements in place: the numbers crossfade, the paths slide and the race
    runs again. */
function GraphSheet({ study, view }: { study: WeightedStudy; view: string }) {
  const t = useT();
  const p = t.studies.part2;
  return (
    <div className={`container ${styles.content}`}>
      <Reveal className={styles.head}>
        <h1 className={styles.title}>
          <Swap view={view}>{studyTitle(t, study)}</Swap>
        </h1>
        <div className={styles.facts}>
          <Swap view={view} className={styles.facts}>
            <span className={`mono ${styles.fact}`}>
              {formatInt(study.vertices)} <em>{t.studies.facts.vertices}</em>
            </span>
            <span className={`mono ${styles.fact}`}>
              {formatInt(study.edges)} <em>{t.studies.facts.edges}</em>
            </span>
            {study.weights && (
              <span className={styles.note}>
                {p.facts.weights(
                  formatWeight(study.weights.min),
                  formatWeight(study.weights.max),
                  study.weights.negative === 0,
                )}
              </span>
            )}
            <span className={styles.note}>
              {t.studies.facts.dropped(
                formatInt(study.self_loops_dropped),
                formatInt(study.duplicates_dropped),
              )}
            </span>
          </Swap>
        </div>
      </Reveal>

      <Chapter index={1} title={p.paths.title} delay={0.05} className={styles.chapterFill}>
        <PathLines
          view={view}
          lines={study.paths.map((answer) => ({
            key: String(answer.to),
            title: p.paths.to(String(answer.to)),
            answer,
          }))}
        />
      </Chapter>

      {study.frontiers.length > 0 && (
        <Chapter index={2} title={p.timing.title} delay={0.1}>
          <Race study={study} view={view} />
          <TimingNote studies={[study]} />
        </Chapter>
      )}
    </div>
  );
}

/** A named network: its facts and the paths from its source, by name. */
function NetworkSheet({ study }: { study: WeightedStudy }) {
  const t = useT();
  const p = t.studies.part2;
  const from = study.paths[0]?.from_name ?? String(study.paths[0]?.from ?? '');
  return (
    <div className={`container ${styles.content}`}>
      <Reveal className={styles.head}>
        <h1 className={styles.title}>{studyTitle(t, study)}</h1>
        <div className={styles.facts}>
          <span className={`mono ${styles.fact}`}>
            {formatInt(study.vertices)} <em>{p.facts.researchers}</em>
          </span>
          <span className={`mono ${styles.fact}`}>
            {formatInt(study.edges)} <em>{p.facts.collaborations}</em>
          </span>
          {study.weights && (
            <span className={styles.note}>
              {p.facts.weights(
                formatWeight(study.weights.min),
                formatWeight(study.weights.max),
                study.weights.negative === 0,
              )}
            </span>
          )}
        </div>
      </Reveal>
      <Chapter index={1} title={p.network.from(from)} delay={0.05} className={styles.chapterFill}>
        <NetworkPaths study={study} />
      </Chapter>
    </div>
  );
}

/** The network's answers: each researcher, the distance, the path by name. */
function NetworkPaths({ study }: { study: WeightedStudy }) {
  const t = useT();
  const p = t.studies.part2;
  return (
    <>
      <p className="comment">{p.network.caption}</p>
      <PathLines
        view={study.name}
        routes
        lines={study.paths.map((answer) => ({
          key: String(answer.to),
          title: answer.to_name ?? String(answer.to),
          answer,
        }))}
      />
    </>
  );
}

/* ---- the drawings ------------------------------------------------------- */

/** The distance from the origin to step `i` of a path: the study's own
    running distances, or, for an older file without them, an even split. */
function stepDistance(answer: PathAnswer, i: number): number {
  const known = answer.distances?.[i];
  if (known !== undefined) return known;
  const hops = Math.max(answer.path.length - 1, 1);
  return ((answer.distance ?? 0) * i) / hops;
}

interface PathLine {
  key: string;
  title: string;
  answer: PathAnswer;
}

/**
 * Shortest paths drawn to scale, one line each on a shared distance axis:
 * the origin at the left, every vertex of the path a dot where its
 * distance puts it, the destination at the line's end. A line draws itself
 * in from the origin and its dots pop as it reaches them. Hovering a dot
 * names its vertex and its distance under the drawing; a line that never
 * reaches its destination is a dashed, faded track.
 */
function PathLines({
  lines,
  view,
  routes = false,
}: {
  lines: PathLine[];
  /** The view shown: lines keep their elements from one view to the next,
      so their length and dots slide while the numbers crossfade. */
  view: string;
  /** Spell each path's vertices under its line (the named network). */
  routes?: boolean;
}) {
  const t = useT();
  const s = t.studies.part2.paths;
  const [hot, setHot] = useState<{ line: number; step: number } | null>(null);
  const max = Math.max(1e-9, ...lines.map((line) => line.answer.distance ?? 0));
  const vertexName = (answer: PathAnswer, i: number) => answer.names?.[i] ?? String(answer.path[i]);
  const hotLine = hot ? lines[hot.line] : null;

  return (
    <div className={styles.lines} onPointerLeave={() => setHot(null)}>
      {lines.map((line, k) => {
        const { answer } = line;
        const reached = answer.distance !== null;
        const hops = answer.path.length - 1;
        return (
          <div
            key={line.key}
            className={styles.line}
            data-unreached={!reached || undefined}
            data-hot={hot?.line === k || undefined}
            style={{ '--k': k } as CSSProperties}
          >
            <span className={styles.lineTitle}>{line.title}</span>
            <span className={styles.lineTrack}>
              <span
                className={styles.lineRail}
                style={{ '--to': reached ? (answer.distance as number) / max : 1 } as CSSProperties}
              />
              {reached &&
                answer.path.map((v, i) => {
                  const at = stepDistance(answer, i) / max;
                  return (
                    <button
                      // The two ends keep their element from one graph to
                      // the next and slide; only the dots between come and go.
                      key={i === 0 ? 'origin' : i === hops ? 'destination' : i}
                      type="button"
                      className={styles.lineDot}
                      data-end={i === 0 || i === hops || undefined}
                      data-hot={(hot?.line === k && hot.step === i) || undefined}
                      style={{ left: `${at * 100}%`, '--at': at } as CSSProperties}
                      aria-label={`${vertexName(answer, i)}, ${formatWeight(stepDistance(answer, i))}`}
                      onPointerEnter={() => setHot({ line: k, step: i })}
                      onFocus={() => setHot({ line: k, step: i })}
                    />
                  );
                })}
            </span>
            <span className={`mono ${styles.lineValue}`}>
              <Swap view={view}>
                {reached ? formatWeight(answer.distance as number) : '∞'}
                <span className={styles.detail}>{reached ? s.hops(hops) : s.unreached}</span>
              </Swap>
            </span>
            {routes && reached && (
              <span className={styles.lineRoute}>
                <Route answer={answer} />
              </span>
            )}
          </div>
        );
      })}
      <div className={`mono ${styles.lineAxis}`}>
        <span>0</span>
        <Swap view={view}>{formatWeight(max)}</Swap>
      </div>
      <p className={styles.lineCaption}>
        {hot && hotLine ? (
          <>
            <span className={styles.lineCaptionName}>{vertexName(hotLine.answer, hot.step)}</span>
            {s.at(
              formatWeight(stepDistance(hotLine.answer, hot.step)),
              String(hot.step),
              String(hotLine.answer.path.length - 1),
            )}
          </>
        ) : (
          <span className="comment">{s.lineHint}</span>
        )}
      </p>
    </div>
  );
}

/** Human ticks for a time axis, each a power of ten or a round unit. */
const CHART_MARGIN = { left: 54, right: 18, top: 12, bottom: 40 };

const TIME_TICKS: [number, string][] = [
  [1, '1 ms'],
  [10, '10 ms'],
  [100, '100 ms'],
  [1_000, '1 s'],
  [10_000, '10 s'],
  [60_000, '1 min'],
  [600_000, '10 min'],
  [3_600_000, '1 h'],
  [36_000_000, '10 h'],
];

type Size = { w: number; h: number };
type Box = { x: number; y: number; w: number; h: number };
type Segment = [number, number, number, number];

/** How much of a segment runs inside a box (Liang-Barsky clipping). */
function clipLength([ax, ay, bx, by]: Segment, box: Box): number {
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - box.x, box.x + box.w - ax, ay - box.y, box.y + box.h - ay];
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return 0;
      continue;
    }
    const t = q[k] / p[k];
    if (p[k] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return 0;
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where each graph's ratio card goes inside the chart: every place in the
 * plot is tried, and the card takes the one that crosses the fewest
 * lines, points, brackets and cards already placed, the nearest to its
 * own bracket among equals. The bracket, heap to vector, stands on the
 * side of the column the card is on.
 */
function placeRatios<R extends { i: number; col: number; hy: number; vy: number }>(
  ratios: R[],
  segments: Segment[],
  points: (readonly [number, number])[],
  sizes: Record<number, Size>,
  bounds: Box,
) {
  const STEP = 8;
  const placed: Box[] = [];
  const brackets: Segment[] = [];
  return ratios.map((r) => {
    const size = sizes[r.i] ?? { w: 200, h: 80 };
    const mid = (r.hy + r.vy) / 2;
    let best: { cost: number; card: Box; side: 'left' | 'right'; bx: number } | null = null;
    for (let cx = bounds.x; cx + size.w <= bounds.x + bounds.w; cx += STEP) {
      const side = cx + size.w / 2 < r.col ? 'left' : 'right';
      const bx = r.col + (side === 'right' ? 10 : -10);
      const own: Segment = [bx, r.hy, bx, r.vy];
      // How far the card's nearest edge is from the bracket's middle.
      const dx = Math.max(cx - bx, bx - (cx + size.w), 0);
      for (let cy = bounds.y; cy + size.h <= bounds.y + bounds.h; cy += STEP) {
        const card = { x: cx, y: cy, w: size.w, h: size.h };
        const pad = { x: cx - 4, y: cy - 4, w: size.w + 8, h: size.h + 8 };
        let cost = 0;
        for (const segment of [...segments, ...brackets, own])
          cost += 40 * clipLength(segment, pad);
        for (const [px, py] of points)
          if (px > pad.x && px < pad.x + pad.w && py > pad.y && py < pad.y + pad.h) cost += 400;
        for (const other of placed) cost += 4 * overlap(pad, other);
        const dy = Math.max(cy - mid, mid - (cy + size.h), 0);
        cost += Math.hypot(dx, dy);
        if (!best || cost < best.cost) best = { cost, card, side, bx };
      }
    }
    const chosen = best ?? {
      cost: 0,
      card: { x: r.col + 18, y: r.vy, w: size.w, h: size.h },
      side: 'right' as const,
      bx: r.col + 10,
    };
    placed.push(chosen.card);
    brackets.push([chosen.bx, r.hy, chosen.bx, r.vy]);
    return { ...r, ...chosen };
  });
}

/**
 * The mean Dijkstra against the graph's size, both axes logarithmic: one
 * line per frontier through the graphs, smallest first. On a log-log plot
 * a power law is a straight line, so the vector's n² climbs visibly
 * steeper than the heaps' (n + m) log n, and the gap is the ratio. A point
 * that is an estimate is hollow, its segment dashed. Hovering a point
 * reads it out under the chart.
 */
function GrowthChart({ studies }: { studies: WeightedStudy[] }) {
  const t = useT();
  const s = t.studies.part2.timing;
  const [hot, setHot] = useState<{ study: number; kind: FrontierKind } | null>(null);
  // Drawn at the size of its box, one unit a pixel, so the chart takes the
  // room the page gives it and its text stays the size it is set in.
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The ratio cards' measured sizes, which their placement needs.
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const drawn = box.width > 0;
  useEffect(() => {
    if (!drawn) return;
    const observer = new ResizeObserver(() => {
      const next: Record<number, Size> = {};
      cardRefs.current.forEach((el, i) => {
        next[i] = { w: el.offsetWidth, h: el.offsetHeight };
      });
      setSizes((prev) =>
        Object.keys(next).every((i) => prev[+i]?.w === next[+i].w && prev[+i]?.h === next[+i].h) &&
        Object.keys(prev).length === Object.keys(next).length
          ? prev
          : next,
      );
    });
    cardRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [drawn, studies]);
  const W = Math.max(box.width, 1);
  const H = Math.max(box.height, 1);
  const { left, right, top, bottom } = CHART_MARGIN;
  // The scales and the cards' places change with the box, not on hover.
  const layout = useMemo(() => {
    const m = CHART_MARGIN;
    const points = studies.flatMap((study, i) =>
      FRONTIERS.flatMap((kind) => {
        const time = frontierTime(study, kind);
        return time ? [{ i, kind, n: study.vertices, ...time }] : [];
      }),
    );
    if (points.length === 0) return null;
    const lx = (n: number) => Math.log10(n);
    const xs = studies.map((study) => lx(study.vertices));
    const x0 = Math.min(...xs) - 0.35;
    const x1 = Math.max(...xs) + 0.35;
    const ys = points.map((point) => Math.log10(point.ms));
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.ceil(Math.max(...ys));
    const x = (n: number) => m.left + ((lx(n) - x0) / (x1 - x0)) * (W - m.left - m.right);
    const y = (ms: number) =>
      m.top + (1 - (Math.log10(ms) - y0) / Math.max(y1 - y0, 1)) * (H - m.top - m.bottom);
    const ticks = TIME_TICKS.filter(([ms]) => Math.log10(ms) >= y0 && Math.log10(ms) <= y1);
    const ratios = placeRatios(
      studies.flatMap((study, i) => {
        const vector = frontierTime(study, 'vector');
        const heap = frontierTime(study, 'heap');
        const ratio = vectorRatio(study);
        if (!vector || !heap || ratio === null) return [];
        return [
          { i, vector, heap, ratio, col: x(study.vertices), hy: y(heap.ms), vy: y(vector.ms) },
        ];
      }),
      FRONTIERS.flatMap((kind) => {
        const series = points.filter((p) => p.kind === kind);
        return series
          .slice(1)
          .map((p, j): Segment => [x(series[j].n), y(series[j].ms), x(p.n), y(p.ms)]);
      }),
      points.map((p) => [x(p.n), y(p.ms)] as const),
      sizes,
      { x: m.left, y: 0, w: W - m.left, h: H - m.bottom },
    );
    return { points, x, y, ticks, ratios };
  }, [studies, W, H, sizes]);
  if (!layout) return null;
  const { points, x, y, ticks, ratios } = layout;
  const hotPoint = hot ? points.find((p) => p.i === hot.study && p.kind === hot.kind) : null;

  return (
    <div className={styles.growth} onPointerLeave={() => setHot(null)}>
      <ul className={styles.growthLegend}>
        {FRONTIERS.map((kind) => (
          <li key={kind}>
            <span style={{ background: FRONTIER_COLOUR[kind] }} />
            {s.frontiers[kind]}
          </li>
        ))}
      </ul>
      <div ref={boxRef} className={styles.growthBox}>
        {drawn && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className={styles.growthChart}
            role="img"
            aria-label={s.title}
          >
            {ticks.map(([ms, label]) => (
              <g key={ms}>
                <line
                  className={styles.growthGrid}
                  x1={left}
                  x2={W - right}
                  y1={y(ms)}
                  y2={y(ms)}
                />
                <text
                  className={styles.growthTick}
                  x={left - 8}
                  y={y(ms)}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {label}
                </text>
              </g>
            ))}
            {studies.map((study) => (
              <g key={study.name}>
                <line
                  className={styles.growthGrid}
                  x1={x(study.vertices)}
                  x2={x(study.vertices)}
                  y1={top}
                  y2={H - bottom}
                />
                <text
                  className={styles.growthLabel}
                  x={x(study.vertices)}
                  y={H - bottom + 16}
                  textAnchor="middle"
                >
                  {weightedName(study.name)}
                </text>
                <text
                  className={styles.growthTick}
                  x={x(study.vertices)}
                  y={H - bottom + 30}
                  textAnchor="middle"
                >
                  {t.studies.part2.vertexCount(formatCompact(study.vertices))}
                </text>
              </g>
            ))}
            {FRONTIERS.map((kind, k) => {
              const series = points.filter((p) => p.kind === kind);
              return (
                <g
                  key={kind}
                  style={{ '--colour': FRONTIER_COLOUR[kind], '--k': k } as CSSProperties}
                >
                  {series.slice(1).map((p, j) => {
                    const a = series[j];
                    return (
                      <line
                        key={p.i}
                        className={styles.growthLine}
                        data-estimated={p.estimated || a.estimated || undefined}
                        x1={x(a.n)}
                        y1={y(a.ms)}
                        x2={x(p.n)}
                        y2={y(p.ms)}
                        pathLength={1}
                        style={{ '--j': j } as CSSProperties}
                      />
                    );
                  })}
                  {series.map((p) => (
                    <circle
                      key={p.i}
                      className={styles.growthPoint}
                      data-estimated={p.estimated || undefined}
                      data-hot={(hot?.study === p.i && hot.kind === kind) || undefined}
                      cx={x(p.n)}
                      cy={y(p.ms)}
                      r={hot?.study === p.i && hot.kind === kind ? 6 : 4.5}
                      onPointerEnter={() => setHot({ study: p.i, kind })}
                    />
                  ))}
                </g>
              );
            })}
            {ratios.map((r) => (
              <g
                key={r.i}
                className={styles.growthBracket}
                data-estimated={r.vector.estimated || undefined}
                style={{ '--k': r.i } as CSSProperties}
              >
                <line x1={r.bx} x2={r.bx} y1={r.hy} y2={r.vy} />
                <line x1={r.bx - 3} x2={r.bx + 3} y1={r.hy} y2={r.hy} />
                <line x1={r.bx - 3} x2={r.bx + 3} y1={r.vy} y2={r.vy} />
              </g>
            ))}
          </svg>
        )}
        {drawn &&
          ratios.map((r) => (
            <div
              key={r.i}
              ref={(el) => {
                if (el) cardRefs.current.set(r.i, el);
                else cardRefs.current.delete(r.i);
              }}
              className={styles.growthRatio}
              data-side={r.side}
              style={{ left: r.card.x, top: r.card.y, '--k': r.i } as CSSProperties}
            >
              <span className={`mono ${styles.growthRatioValue}`}>
                {r.vector.estimated ? '≈ ' : ''}×{formatInt(r.ratio)}
              </span>
              <span className={styles.growthRatioCaption}>{s.ratioCaption}</span>
              <span className={`mono ${styles.detail}`}>
                {s.versus(
                  r.vector.estimated ? s.estimated(formatMs(r.vector.ms)) : formatMs(r.vector.ms),
                  formatMs(r.heap.ms),
                )}
              </span>
            </div>
          ))}
      </div>
      <p className={styles.lineCaption}>
        {hotPoint ? (
          <>
            <span className={styles.lineCaptionName}>
              {weightedName(studies[hotPoint.i].name)}, {s.frontiers[hotPoint.kind]}
            </span>
            {hotPoint.estimated
              ? `${s.estimated(formatMs(hotPoint.ms))} (${s.estimate})`
              : formatMs(hotPoint.ms)}
            {!hotPoint.estimated &&
              (hotPoint.run.timing?.runs ?? 0) < hotPoint.run.requested_runs &&
              ` · ${s.runs(formatInt(hotPoint.run.timing?.runs ?? 0), formatInt(hotPoint.run.requested_runs))}`}
          </>
        ) : (
          <span className="comment">{s.chartHint}</span>
        )}
      </p>
    </div>
  );
}

/** How long the race takes on screen, whatever the graph. */
const RACE_MS = 3200;
/** Past this many runs a lane's segments are thinner than a hairline,
    so it draws the fill alone and lets the counter speak. */
const RACE_TICKS = 160;

/** The three frontiers on one linear time axis, the slowest run (the
    vector's) across the whole width. A playhead sweeps it once: the
    vector finishes its one run at the end, while each heap lane counts
    the whole runs it fits in the same time, one segment each, the first
    one solid. Replays when the graph changes, or on the button. */
function Race({ study, view }: { study: WeightedStudy; view: string }) {
  const t = useT();
  const s = t.studies.part2.timing;
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [round, setRound] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -15% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now;
      const at = still ? 1 : Math.min(1, (now - start) / RACE_MS);
      setProgress(at);
      if (at < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, view, round]);

  const lanes = FRONTIERS.flatMap((kind) => {
    const time = frontierTime(study, kind);
    return time ? [{ kind, ...time }] : [];
  });
  const slowest =
    frontierTime(study, 'vector') ??
    lanes.reduce<(typeof lanes)[number] | null>(
      (worst, lane) => (worst && worst.ms >= lane.ms ? worst : lane),
      null,
    );
  if (!slowest || lanes.length === 0) return null;
  const clock = progress * slowest.ms;

  return (
    <div ref={ref} className={styles.race} style={{ '--p': progress } as CSSProperties}>
      <div className={styles.raceLanes}>
        {lanes.map((lane) => {
          const runs = slowest.ms / lane.ms;
          const done = progress >= 1 ? Math.round(runs) : Math.floor(progress * runs + 1e-9);
          const segment = lane.ms / slowest.ms;
          return (
            <div
              key={lane.kind}
              className={styles.raceLane}
              data-estimated={lane.estimated || undefined}
              style={
                {
                  '--colour': FRONTIER_COLOUR[lane.kind],
                  '--segment': `${segment * 100}%`,
                } as CSSProperties
              }
            >
              <span className={styles.raceName}>
                <span className="mono">{s.frontiers[lane.kind]}</span>
                <span className={`mono ${styles.detail}`}>
                  <Swap view={view}>
                    {lane.estimated ? s.estimated(formatMs(lane.ms)) : formatMs(lane.ms)}
                  </Swap>
                </span>
              </span>
              <span className={styles.raceTrack}>
                <span className={styles.raceRuns} data-ticks={runs <= RACE_TICKS || undefined} />
                <span
                  className={styles.raceFirst}
                  style={{ width: `${Math.min(progress, segment) * 100}%` }}
                  data-on={progress > 0 || undefined}
                />
              </span>
              <span className={styles.raceCount}>
                <span className={`mono ${styles.raceNumber}`}>{formatInt(done)}</span>
                <span className={styles.detail}>{s.race.runs(done)}</span>
              </span>
            </div>
          );
        })}
        <span className={styles.racePlayhead} aria-hidden>
          <span className={`mono ${styles.raceClock}`}>
            {slowest.estimated ? '≈ ' : ''}
            {formatMs(clock)}
          </span>
        </span>
      </div>
      <div className={styles.raceFoot}>
        <p className={`mono ${styles.lineCaption} ${styles.raceHint}`}>{s.race.hint}</p>
        <button
          type="button"
          className={styles.raceReplay}
          onClick={() => setRound((n) => n + 1)}
          aria-label={s.race.replay}
          title={s.race.replay}
        >
          <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A path as its vertices one after another, by name when the graph has
    names; each step fades in after the one before it. */
function Route({ answer }: { answer: PathAnswer }) {
  const steps = answer.names && answer.names.length > 0 ? answer.names : answer.path.map(String);
  return (
    <ol className={styles.route}>
      {steps.map((step, i) => (
        <li
          key={i}
          className={`${answer.names ? '' : 'mono'} ${styles.routeStep}`}
          data-end={i === 0 || i === steps.length - 1 || undefined}
          style={{ '--i': i } as CSSProperties}
        >
          {step}
        </li>
      ))}
    </ol>
  );
}
