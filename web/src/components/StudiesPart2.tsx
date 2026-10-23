'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ArrowRight, Maximize2, RotateCcw, Users, ZoomIn, ZoomOut } from 'lucide-react';
import { formatCompact, formatInt, formatMs, formatWeight } from '@/lib/format';
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

const FRONTIERS: FrontierKind[] = ['vector', 'heap', 'lazy_heap', 'quad_heap', 'pairing', 'radix'];
const FRONTIER_COLOUR: Record<FrontierKind, string> = {
  vector: 'var(--queue-vector)',
  heap: 'var(--queue-heap)',
  lazy_heap: 'var(--queue-lazy-heap)',
  quad_heap: 'var(--queue-quad-heap)',
  pairing: 'var(--queue-pairing)',
  radix: 'var(--queue-radix)',
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
      <div className={`container ${styles.content}`}>
        <SheetHead studies={studies} study={study} />
        {study === null ? (
          <OverviewSheet studies={studies} onOpen={(study) => choose(studies.indexOf(study))} />
        ) : study.names_file ? (
          <NetworkSheet key={study.name} study={study} />
        ) : (
          <GraphSheet study={study} view={viewId(study)} />
        )}
      </div>
    </>
  );
}

/** The head every view shares, as in Part 1: it stays in place when the
    view changes, and only the title and the facts crossfade (`Swap`, keyed
    by the view): the overview's means, a graph's own counts, the
    network's researchers. */
function SheetHead({ studies, study }: { studies: WeightedStudy[]; study: WeightedStudy | null }) {
  const t = useT();
  const p = t.studies.part2;
  const key = study ? viewId(study) : 'overview';
  const weightsOf = (min: number, max: number, none: boolean) => (
    <span className={styles.note}>
      {p.facts.weights(formatWeight(min), formatWeight(max), none)}
    </span>
  );
  let title: string;
  let facts: ReactNode;
  if (study === null) {
    const graphs = studies.filter((s) => !s.names_file);
    const weights = graphs.flatMap((s) => (s.weights ? [s.weights] : []));
    const mean = (pick: (s: WeightedStudy) => number) =>
      graphs.reduce((sum, s) => sum + pick(s), 0) / Math.max(graphs.length, 1);
    title = t.studies.overview;
    facts = (
      <>
        <span className={styles.subtitle}>{t.studies.average(String(graphs.length))}</span>
        <span className={`mono ${styles.fact}`}>
          {formatInt(mean((s) => s.vertices))} <em>{t.studies.facts.vertices}</em>
        </span>
        <span className={`mono ${styles.fact}`}>
          {formatInt(mean((s) => s.edges))} <em>{t.studies.facts.edges}</em>
        </span>
        {weights.length > 0 &&
          weightsOf(
            mean((s) => s.weights?.min ?? 0),
            mean((s) => s.weights?.max ?? 0),
            weights.every((w) => w.negative === 0),
          )}
      </>
    );
  } else if (study.names_file) {
    title = studyTitle(t, study);
    facts = (
      <>
        <span className={`mono ${styles.fact}`}>
          {formatInt(study.vertices)} <em>{p.facts.researchers}</em>
        </span>
        <span className={`mono ${styles.fact}`}>
          {formatInt(study.edges)} <em>{p.facts.collaborations}</em>
        </span>
        {study.weights &&
          weightsOf(study.weights.min, study.weights.max, study.weights.negative === 0)}
      </>
    );
  } else {
    title = studyTitle(t, study);
    facts = (
      <>
        <span className={`mono ${styles.fact}`}>
          {formatInt(study.vertices)} <em>{t.studies.facts.vertices}</em>
        </span>
        <span className={`mono ${styles.fact}`}>
          {formatInt(study.edges)} <em>{t.studies.facts.edges}</em>
        </span>
        {study.weights &&
          weightsOf(study.weights.min, study.weights.max, study.weights.negative === 0)}
        <span className={styles.note}>
          {t.studies.facts.dropped(
            formatInt(study.self_loops_dropped),
            formatInt(study.duplicates_dropped),
          )}
        </span>
      </>
    );
  }
  return (
    <Reveal className={styles.head}>
      <h1 className={styles.title}>
        <Swap view={key}>{title}</Swap>
      </h1>
      <div className={styles.facts}>
        <Swap view={key} className={styles.facts}>
          {facts}
        </Swap>
      </div>
    </Reveal>
  );
}

/** The overview, as in Part 1: the mean of the weighted graphs in its head,
    and only what compares them, the mean Dijkstra of each frontier against
    the graph's size with the vector's ratio to the heap per graph. The
    paths are each graph's own, in its tab. */
function OverviewSheet({
  studies,
  onOpen,
}: {
  studies: WeightedStudy[];
  onOpen: (study: WeightedStudy) => void;
}) {
  const t = useT();
  const p = t.studies.part2;
  const timed = studies.filter((study) => !study.names_file && study.frontiers.length > 0);

  return (
    <>
      {timed.length > 0 && (
        <Chapter index={1} title={p.timing.title} delay={0.05} className={styles.chapterFill}>
          <div className={styles.timingHero}>
            <GrowthChart studies={timed} onOpen={onOpen} />
          </div>
        </Chapter>
      )}
    </>
  );
}

/** One weighted graph: its facts, the five paths from vertex 10 in full,
    and the race of its three frontiers. Switching graphs keeps the
    elements in place: the numbers crossfade, the paths slide and the race
    runs again. */
function GraphSheet({ study, view }: { study: WeightedStudy; view: string }) {
  const t = useT();
  const p = t.studies.part2;
  // The race's replays, asked for by the button in its heading.
  const [round, setRound] = useState(0);
  return (
    <>
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
        <Chapter
          index={2}
          title={p.timing.title}
          delay={0.1}
          tools={
            <button
              type="button"
              className={styles.raceReplay}
              onClick={() => setRound((n) => n + 1)}
              aria-label={p.timing.race.replay}
              title={p.timing.race.replay}
            >
              <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
            </button>
          }
        >
          <Race study={study} view={view} round={round} />
        </Chapter>
      )}
    </>
  );
}

/** A named network: its facts and the paths from its source, by name. */
function NetworkSheet({ study }: { study: WeightedStudy }) {
  const t = useT();
  const p = t.studies.part2;
  const from = study.paths[0]?.from_name ?? String(study.paths[0]?.from ?? '');
  return (
    <>
      <Chapter index={1} title={p.network.from(from)} delay={0.05} className={styles.chapterFill}>
        <NetworkPaths study={study} />
      </Chapter>
    </>
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

/** A stretch of the chart in log₁₀ units: graph size across, time up. */
interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 1, 2 and 5 in every decade, for a view zoomed in past the named ticks. */
const FINE_TICKS = Array.from({ length: 12 }, (_, k) => 10 ** (k - 2)).flatMap((d) => [
  d,
  2 * d,
  5 * d,
]);

/**
 * The mean Dijkstra against the graph's size, both axes logarithmic: one
 * line per frontier through the graphs, smallest first. On a log-log plot
 * a power law is a straight line, so the vector's n² climbs visibly
 * steeper than the heaps' (n + m) log n, and the gap is the ratio. A point
 * that is an estimate is hollow, its segment dashed.
 *
 * It is a chart to handle: dragging pans it, a pinch or ctrl/⌘ + scroll
 * (or the buttons, or + and −) zooms around the pointer, a double click or
 * 0 fits it again. Hovering a point shows its graph in the panel on the
 * right; a click pins it (the other frontiers fade).
 */
function GrowthChart({
  studies,
  onOpen,
}: {
  studies: WeightedStudy[];
  /** Opens a graph's own tab. */
  onOpen: (study: WeightedStudy) => void;
}) {
  const t = useT();
  const s = t.studies.part2.timing;
  const [hot, setHot] = useState<{ study: number; kind: FrontierKind } | null>(null);
  const [pinned, setPinned] = useState<{ study: number; kind: FrontierKind } | null>(null);
  // The graph the panel shows: the last one pointed at, the largest at first.
  const [shown, setShown] = useState(studies.length - 1);
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
  // The points, and the view that fits them.
  const data = useMemo(() => {
    const points = studies.flatMap((study, i) =>
      FRONTIERS.flatMap((kind) => {
        const time = frontierTime(study, kind);
        return time ? [{ i, kind, n: study.vertices, ...time }] : [];
      }),
    );
    if (points.length === 0) return null;
    const xs = studies.map((study) => Math.log10(study.vertices));
    const ys = points.map((point) => Math.log10(point.ms));
    const fit: Range = {
      x0: Math.min(...xs) - 0.35,
      x1: Math.max(...xs) + 0.35,
      y0: Math.floor(Math.min(...ys)),
      y1: Math.max(Math.ceil(Math.max(...ys)), Math.floor(Math.min(...ys)) + 1),
    };
    return { points, fit };
  }, [studies]);

  // The view the reader moved to (null: the fit).
  const [view, setView] = useState<Range | null>(null);
  const drawn = box.width > 0;
  const W = Math.max(box.width, 1);
  const H = Math.max(box.height, 1);
  const { left, right, top, bottom } = CHART_MARGIN;
  const plotW = Math.max(W - left - right, 1);
  const plotH = Math.max(H - top - bottom, 1);
  const scalesFor = useCallback(
    (r: Range) => ({
      x: (n: number) => left + ((Math.log10(n) - r.x0) / (r.x1 - r.x0)) * plotW,
      y: (ms: number) => top + (1 - (Math.log10(ms) - r.y0) / (r.y1 - r.y0)) * plotH,
    }),
    [left, top, plotW, plotH],
  );

  // Panning and zooming, in log units.
  const current = view ?? data?.fit ?? { x0: 0, x1: 1, y0: 0, y1: 1 };
  const clamp = useCallback(
    (r: Range): Range => {
      if (!data) return r;
      const f = data.fit;
      const fit = (a: number, b: number, min: number, max: number): [number, number] => {
        const mid = (a + b) / 2;
        const span = Math.min(Math.max(b - a, min), max);
        return [mid - span / 2, mid + span / 2];
      };
      const [x0, x1] = fit(r.x0, r.x1, 0.12, (f.x1 - f.x0) * 4);
      const [y0, y1] = fit(r.y0, r.y1, 0.25, (f.y1 - f.y0) * 4);
      return { x0, x1, y0, y1 };
    },
    [data],
  );
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setView((v) => {
        const r = v ?? data?.fit;
        if (!r) return v;
        const lx = r.x0 + ((px - left) / plotW) * (r.x1 - r.x0);
        const ly = r.y1 - ((py - top) / plotH) * (r.y1 - r.y0);
        return clamp({
          x0: lx - (lx - r.x0) * factor,
          x1: lx + (r.x1 - lx) * factor,
          y0: ly - (ly - r.y0) * factor,
          y1: ly + (r.y1 - ly) * factor,
        });
      });
    },
    [data, left, top, plotW, plotH, clamp],
  );
  const panBy = useCallback(
    (dx: number, dy: number) => {
      setView((v) => {
        const r = v ?? data?.fit;
        if (!r) return v;
        const sx = (dx / plotW) * (r.x1 - r.x0);
        const sy = (dy / plotH) * (r.y1 - r.y0);
        return { x0: r.x0 - sx, x1: r.x1 - sx, y0: r.y0 + sy, y1: r.y1 + sy };
      });
    },
    [data, plotW, plotH],
  );
  const reset = () => {
    setView(null);
  };

  // A pinch on a trackpad arrives as a wheel with ctrl held; so does
  // ctrl + scroll. A plain scroll is the page's.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // One pointer drags; two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [dragging, setDragging] = useState(false);
  const local = (event: ReactPointerEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[data-point], button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const was = pointers.current.get(event.pointerId);
    if (!was) return;
    const now = local(event);
    if (pointers.current.size === 1) {
      panBy(now.x - was.x, now.y - was.y);
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(was.x - other.x, was.y - other.y);
        const after = Math.hypot(now.x - other.x, now.y - other.y);
        if (before > 0 && after > 0)
          zoomAt(before / after, (now.x + other.x) / 2, (now.y + other.y) / 2);
      }
    }
    pointers.current.set(event.pointerId, now);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  if (!data) return null;
  const { points } = data;
  const { x, y } = scalesFor(current);
  const yIn = (ms: number) => {
    const l = Math.log10(ms);
    return l >= current.y0 - 1e-9 && l <= current.y1 + 1e-9;
  };
  const named = TIME_TICKS.filter(([ms]) => yIn(ms));
  const ticks: [number, string][] =
    named.length >= 3 ? named : FINE_TICKS.filter(yIn).map((ms) => [ms, formatMs(ms)]);
  const inX = (px: number) => px >= left - 1 && px <= W - right + 1;
  const focus = pinned ?? hot;
  const clipId = `growth-${clipIdOf(studies)}`;

  return (
    <div className={styles.growth}>
      <div className={styles.growthMain} onPointerLeave={() => setHot(null)}>
        <ul className={styles.growthLegend}>
          {FRONTIERS.map((kind) => (
            <li key={kind} data-dim={(pinned && pinned.kind !== kind) || undefined}>
              <span style={{ background: FRONTIER_COLOUR[kind] }} />
              {s.frontiers[kind]}
            </li>
          ))}
        </ul>
        <div
          ref={boxRef}
          className={styles.growthBox}
          data-dragging={dragging || undefined}
          tabIndex={0}
          aria-label={s.chartHint}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onDoubleClick={(event) => {
            if (!(event.target as Element).closest('[data-point], button')) reset();
          }}
          onKeyDown={(event) => {
            const middle = [left + plotW / 2, top + plotH / 2] as const;
            const step = 40;
            const keys: Record<string, () => void> = {
              '+': () => zoomAt(0.8, ...middle),
              '=': () => zoomAt(0.8, ...middle),
              '-': () => zoomAt(1.25, ...middle),
              '0': reset,
              ArrowLeft: () => panBy(step, 0),
              ArrowRight: () => panBy(-step, 0),
              ArrowUp: () => panBy(0, step),
              ArrowDown: () => panBy(0, -step),
              Escape: () => setPinned(null),
            };
            const run = keys[event.key];
            if (!run) return;
            event.preventDefault();
            event.stopPropagation();
            run();
          }}
        >
          {drawn && (
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className={styles.growthChart}
              role="img"
              aria-label={s.title}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={left} y={top - 8} width={plotW} height={plotH + 16} />
                </clipPath>
              </defs>
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
              {studies.map((study, i) => {
                const cx = x(study.vertices);
                if (!inX(cx)) return null;
                return (
                  <g key={study.name}>
                    <line className={styles.growthGrid} x1={cx} x2={cx} y1={top} y2={H - bottom} />
                    <text
                      className={styles.growthLabel}
                      x={cx}
                      y={H - bottom + 16}
                      textAnchor="middle"
                      data-hot={focus?.study === i || undefined}
                    >
                      {weightedName(study.name)}
                    </text>
                    <text
                      className={styles.growthTick}
                      x={cx}
                      y={H - bottom + 30}
                      textAnchor="middle"
                    >
                      {t.studies.part2.vertexCount(formatCompact(study.vertices))}
                    </text>
                  </g>
                );
              })}
              <g clipPath={`url(#${clipId})`}>
                {FRONTIERS.map((kind, k) => {
                  const series = points.filter((p) => p.kind === kind);
                  return (
                    <g
                      key={kind}
                      className={styles.growthSeries}
                      data-dim={(pinned && pinned.kind !== kind) || undefined}
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
                    </g>
                  );
                })}
                {FRONTIERS.map((kind, k) =>
                  points
                    .filter((p) => p.kind === kind)
                    .map((p) => {
                      const isPinned = pinned?.study === p.i && pinned.kind === kind;
                      const isHot = hot?.study === p.i && hot.kind === kind;
                      const label = `${weightedName(studies[p.i].name)}, ${s.frontiers[kind]}: ${
                        p.estimated ? s.estimated(formatMs(p.ms)) : formatMs(p.ms)
                      }`;
                      const toggle = () => setPinned(isPinned ? null : { study: p.i, kind });
                      return (
                        <g
                          key={`${kind}-${p.i}`}
                          data-point
                          className={styles.growthHit}
                          data-dim={(pinned && pinned.kind !== kind) || undefined}
                          style={{ '--colour': FRONTIER_COLOUR[kind], '--k': k } as CSSProperties}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isPinned}
                          aria-label={label}
                          onPointerEnter={() => {
                            setHot({ study: p.i, kind });
                            setShown(p.i);
                          }}
                          onClick={() => {
                            setShown(p.i);
                            toggle();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              toggle();
                            }
                          }}
                        >
                          <circle cx={x(p.n)} cy={y(p.ms)} r={12} className={styles.growthTarget} />
                          <circle
                            className={styles.growthPoint}
                            data-estimated={p.estimated || undefined}
                            data-hot={isHot || isPinned || undefined}
                            data-pinned={isPinned || undefined}
                            cx={x(p.n)}
                            cy={y(p.ms)}
                            r={isHot || isPinned ? 6 : 4.5}
                          />
                        </g>
                      );
                    }),
                )}
              </g>
            </svg>
          )}
          {drawn && (
            <div className={styles.growthTools}>
              <button
                type="button"
                aria-label={s.zoomIn}
                title={s.zoomIn}
                onClick={() => zoomAt(0.7, left + plotW / 2, top + plotH / 2)}
              >
                <ZoomIn size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={s.zoomOut}
                title={s.zoomOut}
                onClick={() => zoomAt(1 / 0.7, left + plotW / 2, top + plotH / 2)}
              >
                <ZoomOut size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={s.fit}
                title={s.fit}
                disabled={view === null}
                onClick={reset}
              >
                <Maximize2 size={13} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
      <DataShow
        study={studies[focus?.study ?? shown] ?? studies[studies.length - 1]}
        index={focus?.study ?? shown}
        focus={focus?.kind ?? null}
        pinned={pinned}
        onPick={(study, kind) => {
          setShown(study);
          setPinned(pinned?.study === study && pinned.kind === kind ? null : { study, kind });
        }}
        onOpen={onOpen}
      />
    </div>
  );
}

/** Beside the chart, the graph a point belongs to: its size, then its six
    frontiers fastest first, each with its mean time and its multiple of the
    heap's, the one pointed at or pinned lit. A row pins its point; the
    link at the foot opens the graph's tab. */
function DataShow({
  study,
  index,
  focus,
  pinned,
  onPick,
  onOpen,
}: {
  study: WeightedStudy;
  index: number;
  focus: FrontierKind | null;
  pinned: { study: number; kind: FrontierKind } | null;
  onPick: (study: number, kind: FrontierKind) => void;
  onOpen: (study: WeightedStudy) => void;
}) {
  const t = useT();
  const s = t.studies.part2.timing;
  const heap = frontierTime(study, 'heap');
  const rows = FRONTIERS.flatMap((kind) => {
    const time = frontierTime(study, kind);
    return time ? [{ kind, ...time }] : [];
  }).sort((a, b) => a.ms - b.ms);
  const name = t.studies.graph(weightedName(study.name));
  return (
    <aside className={styles.dataShow} aria-live="polite">
      <div className={styles.dataShowHead}>
        <span className={styles.dataShowTitle}>
          <Swap view={study.name}>{name}</Swap>
        </span>
        <span className={`mono ${styles.detail}`}>
          <Swap view={study.name}>
            {formatCompact(study.vertices)} {t.studies.facts.vertices} ·{' '}
            {formatCompact(study.edges)} {t.studies.facts.edges}
          </Swap>
        </span>
      </div>
      <span className={`label ${styles.dataShowOrder}`}>{s.order}</span>
      <ol className={styles.dataShowRows}>
        {rows.map((row, place) => {
          const runs = row.run.timing?.runs ?? 0;
          const short = !row.estimated && runs < row.run.requested_runs;
          const isPinned = pinned?.study === index && pinned.kind === row.kind;
          return (
            <li key={row.kind}>
              <button
                type="button"
                className={styles.dataShowRow}
                data-focus={focus === row.kind || undefined}
                aria-pressed={isPinned}
                style={{ '--colour': FRONTIER_COLOUR[row.kind] } as CSSProperties}
                onClick={() => onPick(index, row.kind)}
              >
                <span className={`mono ${styles.dataShowPlace}`}>{place + 1}</span>
                <span className={styles.dataShowSwatch} aria-hidden="true" />
                <span className={styles.dataShowName}>{s.frontiers[row.kind]}</span>
                <span className={`mono ${styles.dataShowTime}`}>
                  {row.estimated ? s.estimated(formatMs(row.ms)) : formatMs(row.ms)}
                </span>
                <span className={`mono ${styles.dataShowRatio}`}>
                  {row.kind === 'heap' || !heap ? '' : `×${formatHeapRatio(row.ms / heap.ms)}`}
                </span>
                {(row.estimated || short) && (
                  <span className={`mono ${styles.dataShowNote}`}>
                    {row.estimated
                      ? s.estimate
                      : s.runs(formatInt(runs), formatInt(row.run.requested_runs))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <span className={`mono ${styles.dataShowFoot}`}>{s.versusHeap}</span>
      <button type="button" className={styles.growthOpen} onClick={() => onOpen(study)}>
        {s.open(name)}
        <ArrowRight size={12} aria-hidden="true" />
      </button>
    </aside>
  );
}

/** A ratio to the heap's time: two significant digits under 10, whole above. */
function formatHeapRatio(ratio: number): string {
  return ratio < 10 ? ratio.toFixed(ratio < 1 ? 2 : 1) : formatInt(Math.round(ratio));
}

/** A stable id for a chart's clip path (one chart per sheet). */
function clipIdOf(studies: WeightedStudy[]): string {
  return studies.map((study) => viewId(study)).join('-');
}

/** How long the race takes on screen, whatever the graph. */
const RACE_MS = 3200;
/** The narrowest block a lane draws, in pixels. */
const RACE_BLOCK_PX = 6;

/** How many runs one block of a lane stands for: 1, 10, 100…, the
    fewest that keep a block at least `RACE_BLOCK_PX` wide. */
function raceBlock(runPx: number): number {
  let unit = 1;
  while (runPx * unit < RACE_BLOCK_PX && unit < 1e6) unit *= 10;
  return unit;
}

/** The frontiers on one linear time axis, the slowest run (the vector's)
    across the whole width. A playhead sweeps it once: the vector finishes
    its one run at the end, while each other lane counts the whole runs it
    fits in the same time, the first run solid. A lane is cut into blocks of
    one run, or of 10, 100… runs when one run is too thin to see (W4 and W5
    fit hundreds), and says so under its counter. Replays when the graph
    changes, or on the button in the chapter's heading (`round`). */
function Race({ study, view, round }: { study: WeightedStudy; view: string; round: number }) {
  const t = useT();
  const s = t.studies.part2.timing;
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [progress, setProgress] = useState(0);
  // The tracks' width, which decides how many runs a block holds.
  const trackRef = useRef<HTMLSpanElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
        {lanes.map((lane, l) => {
          const runs = slowest.ms / lane.ms;
          const done = progress >= 1 ? Math.round(runs) : Math.floor(progress * runs + 1e-9);
          const segment = lane.ms / slowest.ms;
          const block = raceBlock(segment * trackWidth);
          return (
            <div
              key={lane.kind}
              className={styles.raceLane}
              data-estimated={lane.estimated || undefined}
              style={
                {
                  '--colour': FRONTIER_COLOUR[lane.kind],
                  '--segment': `${Math.min(1, segment * block) * 100}%`,
                } as CSSProperties
              }
            >
              <span className={styles.raceName}>
                <span className={`mono ${styles.raceLabel}`}>{s.frontiers[lane.kind]}</span>
                <span className={`mono ${styles.detail}`}>
                  <Swap view={view}>
                    {lane.estimated ? s.estimated(formatMs(lane.ms)) : formatMs(lane.ms)}
                  </Swap>
                </span>
              </span>
              <span ref={l === 0 ? trackRef : undefined} className={styles.raceTrack}>
                <span className={styles.raceRuns} data-ticks={runs > 1.5 || undefined} />
                <span
                  className={styles.raceFirst}
                  style={{ width: `${Math.min(progress, segment) * 100}%` }}
                  data-on={progress > 0 || undefined}
                />
              </span>
              <span className={styles.raceCount}>
                <span className={`mono ${styles.raceNumber}`}>{formatInt(done)}</span>
                <span className={styles.detail}>{s.race.runs(done)}</span>
                {block > 1 && (
                  <span className={`mono ${styles.raceBlock}`}>
                    {s.race.block(formatInt(block))}
                  </span>
                )}
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
