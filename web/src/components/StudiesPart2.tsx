'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ArrowRight, Info, Maximize2, RotateCcw, Users, ZoomIn, ZoomOut } from 'lucide-react';
import { formatBytes, formatCompact, formatInt, formatMs, formatWeight } from '@/lib/format';
import { logScale, TIME_SCALES, type TimeScale } from '@/lib/scale';
import {
  peakEntries,
  type FrontierKind,
  type FrontierStudy,
  type PathAnswer,
  type WeightedStudy,
} from '@/lib/studies';
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
   five paths from vertex 10 drawn to scale, its frontiers raced on one
   linear time axis (a dashed lane is an estimate where the budget cut the
   runs short) and the bytes each frontier holds on one linear byte axis;
   a network's sheet has its named paths. */

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

/** What the overview's chart shows: the mean Dijkstra or the memory held. */
type Metric = 'time' | 'memory';

/** A frontier's value on a graph for the chart: its mean time (the
    estimate when the budget cut every run, with the timing for the
    panel's notes), or the bytes it held. */
function frontierValue(study: WeightedStudy, kind: FrontierKind, metric: Metric) {
  if (metric === 'time') {
    const time = frontierTime(study, kind);
    return time ? { v: time.ms, estimated: time.estimated, run: time.run } : null;
  }
  const lane = study.memory?.frontiers.find((f) => f.frontier === kind);
  return lane ? { v: lane.allocated_bytes, estimated: false, run: null } : null;
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
  const [metric, setMetric] = useState<Metric>('time');
  const timed = studies.filter((study) => !study.names_file && study.frontiers.length > 0);
  const measured = studies.filter((study) => !study.names_file && study.memory);
  const shown = metric === 'time' ? timed : measured;
  const metrics: Metric[] = measured.length > 0 ? ['time', 'memory'] : ['time'];

  return (
    <>
      {timed.length > 0 && (
        <Chapter
          index={1}
          title={p.timing.title}
          delay={0.05}
          className={styles.chapterFill}
          tools={
            metrics.length > 1 && (
              <div className={styles.chapterTools}>
                <MetricSwitch metric={metric} onChange={setMetric} />
              </div>
            )
          }
        >
          <div className={styles.timingHero}>
            <GrowthChart studies={shown} metric={metric} onOpen={onOpen} />
          </div>
        </Chapter>
      )}
    </>
  );
}

/** The switch at the right of a chapter's heading between the time and
    the memory of the frontiers: the nav's switch, a thumb sliding under
    the chosen one. */
function MetricSwitch({
  metric,
  onChange,
}: {
  metric: Metric;
  onChange: (metric: Metric) => void;
}) {
  const p = useT().studies.part2;
  return (
    <ChoiceSwitch
      label={p.chart.label}
      choices={(['time', 'memory'] as const).map((key) => ({ key, label: p.chart[key] }))}
      value={metric}
      onChange={onChange}
    />
  );
}

/** The scale of a graph's lanes in time: log, a share of the vector's
    time, or without the vector. */
function ScaleSwitch({
  scale,
  onChange,
  hidden,
}: {
  scale: TimeScale;
  onChange: (scale: TimeScale) => void;
  hidden?: boolean;
}) {
  const scales = useT().studies.part2.timing.scales;
  return (
    <ChoiceSwitch
      label={scales.label}
      choices={TIME_SCALES.map((key) => ({ key, label: scales[key], title: scales.hint[key] }))}
      value={scale}
      onChange={onChange}
      hidden={hidden}
    />
  );
}

/** A switch between a few choices: the nav's switch, a thumb sliding under
    the chosen one. A hidden switch stays laid out, faded and inert, so the
    heading keeps its layout. */
function ChoiceSwitch<K extends string>({
  label,
  choices,
  value,
  onChange,
  hidden,
}: {
  label: string;
  choices: { key: K; label: string; title?: string }[];
  value: K;
  onChange: (key: K) => void;
  hidden?: boolean;
}) {
  return (
    <div
      className={styles.chartSwitch}
      role="group"
      aria-label={label}
      aria-hidden={hidden || undefined}
      data-hidden={hidden || undefined}
      style={
        {
          '--n': choices.length,
          '--i': Math.max(
            0,
            choices.findIndex((choice) => choice.key === value),
          ),
        } as CSSProperties
      }
    >
      <span className={styles.chartSwitchThumb} aria-hidden="true" />
      {choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          className={styles.chartSwitchButton}
          aria-pressed={value === choice.key}
          title={choice.title}
          disabled={hidden}
          tabIndex={hidden ? -1 : undefined}
          onClick={() => onChange(choice.key)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** One weighted graph: its facts, the five paths from vertex 10 in full,
    then its frontiers in one chapter, switched between the race of their
    times and what each holds in memory, so the sheet fits one screen.
    Switching graphs keeps the elements in place: the numbers crossfade,
    the paths and the memory bars slide and the race runs again. */
function GraphSheet({ study, view }: { study: WeightedStudy; view: string }) {
  const t = useT();
  const p = t.studies.part2;
  // The race's replays, asked for by the button in its heading.
  const [round, setRound] = useState(0);
  // The frontiers' chapter shows their times or their memory; the choice
  // stays from one graph to the next.
  const [metric, setMetric] = useState<Metric>('time');
  // The lanes' scale in time, kept from one graph to the next too.
  const [scale, setScale] = useState<TimeScale>('vector');
  const memory = study.memory && study.memory.frontiers.length > 0 ? study.memory : null;
  const timed = study.frontiers.length > 0;
  const showing: Metric = !timed ? 'memory' : memory ? metric : 'time';
  const racing = showing === 'time' && scale !== 'log';
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

      {(timed || memory) && (
        <Chapter
          index={2}
          title={p.timing.title}
          delay={0.1}
          tools={
            <div className={styles.chapterTools}>
              <button
                type="button"
                className={styles.raceReplay}
                // Kept in memory and on the log scale too, faded and inert,
                // so the heading keeps its layout when there is no race.
                data-hidden={!racing || undefined}
                disabled={!racing}
                tabIndex={racing ? undefined : -1}
                onClick={() => setRound((n) => n + 1)}
                aria-label={p.timing.race.replay}
                title={p.timing.race.replay}
              >
                <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
              </button>
              {timed && (
                <ScaleSwitch scale={scale} onChange={setScale} hidden={showing !== 'time'} />
              )}
              {timed && memory && <MetricSwitch metric={metric} onChange={setMetric} />}
            </div>
          }
        >
          <FrontierLanes study={study} view={view} round={round} metric={showing} scale={scale} />
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

/** A stretch of the chart in the scale's units: graph size across, time up. */
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

/** Steps for a linear time axis, each a round amount of its unit. */
const LINEAR_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000,
  600_000, 1_800_000, 3_600_000, 7_200_000, 18_000_000, 36_000_000, 86_400_000, 172_800_000,
  432_000_000, 864_000_000, 1_728_000_000,
];

/** The chart's scale, from linear (`β = 1`) to logarithmic (`β = 0`): the
    Box-Cox transform (vᵝ − 1) / β, which tends to ln v as β shrinks, so
    the slider sweeps one into the other with every curve moving smoothly. */
function scaled(v: number, beta: number): number {
  return beta < 1e-4 ? Math.log(v) : (Math.pow(v, beta) - 1) / beta;
}

/** The value at a position of the scale; 0 below a linear-ish axis's origin. */
function unscaled(u: number, beta: number): number {
  if (beta < 1e-4) return Math.exp(u);
  const base = beta * u + 1;
  return base > 0 ? Math.pow(base, 1 / beta) : 0;
}

/** The slider's position (0 linear, 1 log) as the transform's β; cubed, so
    the middle of the slider is already half way to log in looks. */
const betaOf = (logness: number) => (1 - logness) ** 3;

const KB = 1024;
/** 1, 2 and 5 of every power of ten, in every binary unit: the byte axis's
    fine ticks and its linear steps alike. */
const BYTE_STEPS = [1, KB, KB ** 2, KB ** 3].flatMap((unit) =>
  [1, 2, 5, 10, 20, 50, 100, 200, 500].map((k) => k * unit),
);

/** Each metric's axis: the named ticks, the fine ones, the linear steps
    and how a value reads. */
const AXES: Record<
  Metric,
  { named: [number, string][]; fine: number[]; steps: number[]; format: (v: number) => string }
> = {
  time: { named: TIME_TICKS, fine: FINE_TICKS, steps: LINEAR_STEPS, format: formatMs },
  memory: {
    named: [
      [KB, '1 KB'],
      [10 * KB, '10 KB'],
      [100 * KB, '100 KB'],
      [KB ** 2, '1 MB'],
      [10 * KB ** 2, '10 MB'],
      [100 * KB ** 2, '100 MB'],
      [KB ** 3, '1 GB'],
      [10 * KB ** 3, '10 GB'],
    ],
    fine: BYTE_STEPS,
    steps: BYTE_STEPS,
    format: formatBytes,
  },
};

/**
 * The mean Dijkstra against the graph's size, or the bytes each frontier
 * held (`metric`, switched in the chapter's heading), both axes on one
 * scale that a slider sweeps from linear to logarithmic. On the log-log end a power
 * law is a straight line, so the vector's n² climbs visibly steeper than
 * the heaps' (n + m) log n, and the gap is the ratio; toward the linear
 * end the curves bend into their real shapes. A legend entry hides its
 * frontier and the fit follows the ones left, so on the linear end the
 * heaps need not lie flat under the vector's hours. A point that is an
 * estimate is hollow, its segment dashed. Graphs with the same vertex
 * count (W5 and W6, 10M each) share one mark on the axis, named after
 * both; a mark too close to a larger graph's keeps its line, not its name.
 *
 * It is a chart to handle: dragging pans it, a pinch or ctrl/⌘ + scroll
 * (or the buttons, or + and −) zooms around the pointer, a double click or
 * 0 fits it again. Hovering a point shows its graph in the panel on the
 * right; a click pins it (the other frontiers fade).
 */
function GrowthChart({
  studies,
  metric,
  onOpen,
}: {
  studies: WeightedStudy[];
  metric: Metric;
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
  // The scale (0 linear, 1 log, as the slider reads) and the frontiers
  // taken off the chart in the panel.
  const [logness, setLogness] = useState(1);
  const beta = betaOf(logness);
  const [hidden, setHidden] = useState<ReadonlySet<FrontierKind>>(() => new Set());
  const visible = useCallback((kind: FrontierKind) => !hidden.has(kind), [hidden]);
  // The points, and the view that fits the ones shown.
  const data = useMemo(() => {
    const points = studies.flatMap((study, i) =>
      FRONTIERS.flatMap((kind) => {
        const value = frontierValue(study, kind, metric);
        return value ? [{ i, kind, n: study.vertices, ...value }] : [];
      }),
    );
    if (points.length === 0) return null;
    const shown = points.filter((point) => visible(point.kind));
    const xs = studies.map((study) => scaled(study.vertices, beta));
    const ys = (shown.length > 0 ? shown : points).map((point) => scaled(point.v, beta));
    const span = (values: number[]) => Math.max(Math.max(...values) - Math.min(...values), 1e-9);
    const padX = span(xs) * 0.12;
    const padY = span(ys) * 0.06;
    const fit: Range = {
      x0: Math.min(...xs) - padX,
      x1: Math.max(...xs) + padX,
      y0: Math.min(...ys) - padY,
      y1: Math.max(...ys) + padY,
    };
    return { points, fit };
  }, [studies, metric, beta, visible]);

  // The view the reader moved to (null: the fit); another metric fits again.
  const [view, setView] = useState<Range | null>(null);
  const [viewOf, setViewOf] = useState(metric);
  if (viewOf !== metric) {
    setViewOf(metric);
    setView(null);
  }
  const drawn = box.width > 0;
  const W = Math.max(box.width, 1);
  const H = Math.max(box.height, 1);
  const { left, right, top, bottom } = CHART_MARGIN;
  const plotW = Math.max(W - left - right, 1);
  const plotH = Math.max(H - top - bottom, 1);
  const scalesFor = useCallback(
    (r: Range) => ({
      x: (n: number) => left + ((scaled(n, beta) - r.x0) / (r.x1 - r.x0)) * plotW,
      y: (v: number) => top + (1 - (scaled(v, beta) - r.y0) / (r.y1 - r.y0)) * plotH,
    }),
    [left, top, plotW, plotH, beta],
  );

  // Panning and zooming, in the scale's units.
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
      const [x0, x1] = fit(r.x0, r.x1, (f.x1 - f.x0) * 0.04, (f.x1 - f.x0) * 4);
      const [y0, y1] = fit(r.y0, r.y1, (f.y1 - f.y0) * 0.04, (f.y1 - f.y0) * 4);
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

  // A new scale or a new set of lines changes the units: the view fits again.
  const sweepTo = useCallback((next: number) => {
    setLogness(Math.min(1, Math.max(0, next)));
    setView(null);
  }, []);
  // The words at the slider's ends sweep it there over a moment.
  const sweep = useRef(0);
  const animateTo = (target: number) => {
    cancelAnimationFrame(sweep.current);
    const from = logness;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sweepTo(target);
      return;
    }
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const k = Math.min(1, (now - start) / 700);
      const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      sweepTo(from + (target - from) * eased);
      if (k < 1) sweep.current = requestAnimationFrame(step);
    };
    sweep.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(sweep.current), []);
  const hide = (kind: FrontierKind) => {
    const next = new Set(hidden);
    if (!next.delete(kind)) next.add(kind);
    // The last frontier on the chart stays.
    if (data && data.points.every((point) => next.has(point.kind))) return;
    setHidden(next);
    if (pinned && next.has(pinned.kind)) setPinned(null);
    setView(null);
  };

  // Where every point is drawn. A switch of metric or of the frontiers
  // shown glides each point from where it was to where it now belongs
  // (the lines follow their ends); panning, zooming and the scale's slider
  // move them at once.
  const { x: xAt, y: yAt } = scalesFor(current);
  const targets = new Map<string, { x: number; y: number }>();
  for (const p of data?.points ?? []) {
    targets.set(`${p.kind}-${p.i}`, { x: xAt(p.n), y: yAt(p.v) });
  }
  const [morph, setMorph] = useState<{
    from: Map<string, { x: number; y: number }>;
    k: number;
  } | null>(null);
  const eased = morph ? (morph.k < 0.5 ? 4 * morph.k ** 3 : 1 - (-2 * morph.k + 2) ** 3 / 2) : 1;
  const placed = new Map<string, { x: number; y: number }>();
  for (const [key, to] of targets) {
    const from = morph?.from.get(key) ?? to;
    placed.set(key, { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
  }
  const drawnAt = useRef(placed);
  useEffect(() => {
    drawnAt.current = placed;
  });
  const morphKey = `${metric}|${[...hidden].sort().join(',')}`;
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
    const l = scaled(ms, beta);
    return ms > 0 && l >= current.y0 - 1e-9 && l <= current.y1 + 1e-9;
  };
  // Ticks from three sources: the named powers, 1-2-5 in every decade, and
  // round linear steps. Near the log end the first two lead, near the
  // linear end the steps do; each is kept only clear of those before it.
  const low = unscaled(current.y0, beta);
  const high = unscaled(current.y1, beta);
  const axis = AXES[metric];
  const stepMs = axis.steps.find((d) => (high - low) / d <= 6) ?? axis.steps.at(-1)!;
  const linear: number[] = [];
  for (let v = Math.max(stepMs, Math.ceil(low / stepMs) * stepMs); v <= high; v += stepMs) {
    linear.push(v);
  }
  const named = axis.named.map(([v]) => v);
  const sources = beta > 0.3 ? [linear, named, axis.fine] : [named, axis.fine, linear];
  const ticks: [number, string][] = [];
  for (const source of sources) {
    if (ticks.length >= 4) break;
    for (const ms of source) {
      if (!yIn(ms) || ticks.some(([kept]) => Math.abs(y(kept) - y(ms)) < 22)) continue;
      ticks.push([ms, axis.named.find(([named]) => named === ms)?.[1] ?? axis.format(ms)]);
    }
  }
  const inX = (px: number) => px >= left - 1 && px <= W - right + 1;
  const focus = pinned ?? hot;
  // One mark on the axis per vertex count, named after every graph there;
  // from the largest down, a mark too close to a named one keeps only its line.
  const marks = studies.reduce<{ vertices: number; studies: number[] }[]>((all, study, i) => {
    const mark = all.find((m) => m.vertices === study.vertices);
    if (mark) mark.studies.push(i);
    else all.push({ vertices: study.vertices, studies: [i] });
    return all;
  }, []);
  const namedAt: number[] = [];
  const labelled = new Set<number>();
  for (const mark of [...marks].reverse()) {
    const cx = x(mark.vertices);
    if (namedAt.every((other) => Math.abs(other - cx) >= 84)) {
      namedAt.push(cx);
      labelled.add(mark.vertices);
    }
  }
  const clipId = `growth-${clipIdOf(studies)}`;

  return (
    <div className={styles.growth}>
      <div className={styles.growthMain} onPointerLeave={() => setHot(null)}>
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
              aria-label={metric === 'time' ? s.title : t.studies.part2.memory.title}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={left} y={top - 8} width={plotW} height={plotH + 16} />
                </clipPath>
              </defs>
              <g key={metric} className={styles.growthFade}>
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
              </g>
              {marks.map((mark) => {
                const cx = x(mark.vertices);
                if (!inX(cx)) return null;
                return (
                  <g key={mark.vertices}>
                    <line className={styles.growthGrid} x1={cx} x2={cx} y1={top} y2={H - bottom} />
                    {labelled.has(mark.vertices) && (
                      <>
                        <text
                          className={styles.growthLabel}
                          x={cx}
                          y={H - bottom + 16}
                          textAnchor="middle"
                          data-hot={(focus && mark.studies.includes(focus.study)) || undefined}
                        >
                          {mark.studies.map((i) => weightedName(studies[i].name)).join(' · ')}
                        </text>
                        <text
                          className={styles.growthTick}
                          x={cx}
                          y={H - bottom + 30}
                          textAnchor="middle"
                        >
                          {t.studies.part2.vertexCount(formatCompact(mark.vertices))}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
              <g clipPath={`url(#${clipId})`}>
                {FRONTIERS.map((kind, k) => {
                  if (!visible(kind)) return null;
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
                        const from = placed.get(`${kind}-${a.i}`)!;
                        const to = placed.get(`${kind}-${p.i}`)!;
                        return (
                          <line
                            key={p.i}
                            className={styles.growthLine}
                            data-estimated={p.estimated || a.estimated || undefined}
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
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
                    .filter((p) => p.kind === kind && visible(kind))
                    .map((p) => {
                      const at = placed.get(`${kind}-${p.i}`)!;
                      const isPinned = pinned?.study === p.i && pinned.kind === kind;
                      const isHot = hot?.study === p.i && hot.kind === kind;
                      const label = `${weightedName(studies[p.i].name)}, ${s.frontiers[kind]}: ${
                        p.estimated ? s.estimated(axis.format(p.v)) : axis.format(p.v)
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
                          <circle cx={at.x} cy={at.y} r={12} className={styles.growthTarget} />
                          <circle
                            className={styles.growthPoint}
                            data-estimated={p.estimated || undefined}
                            data-hot={isHot || isPinned || undefined}
                            data-pinned={isPinned || undefined}
                            cx={at.x}
                            cy={at.y}
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
        <div className={styles.growthScale}>
          <button type="button" onClick={() => animateTo(0)} data-on={logness === 0 || undefined}>
            {s.scale.linear}
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(logness * 1000)}
            aria-label={s.scale.label}
            onChange={(event) => {
              cancelAnimationFrame(sweep.current);
              sweepTo(Number(event.target.value) / 1000);
            }}
          />
          <button type="button" onClick={() => animateTo(1)} data-on={logness === 1 || undefined}>
            {s.scale.log}
          </button>
        </div>
      </div>
      <DataShow
        metric={metric}
        study={studies[focus?.study ?? shown] ?? studies[studies.length - 1]}
        focus={focus?.kind ?? null}
        hidden={hidden}
        onHide={hide}
        onOpen={onOpen}
      />
    </div>
  );
}

/** Beside the chart, and its legend: the graph a point belongs to, its
    size, then its six frontiers, the fastest or the smallest first, each
    with its swatch, its mean time or its bytes and its multiple of the
    heap's, the one pointed at or pinned lit. A row toggles its frontier
    on the chart: one taken off is struck through, until it is clicked
    back. The rows crossfade when the metric changes; the link at the foot
    opens the graph's tab. */
function DataShow({
  metric,
  study,
  focus,
  hidden,
  onHide,
  onOpen,
}: {
  metric: Metric;
  study: WeightedStudy;
  focus: FrontierKind | null;
  hidden: ReadonlySet<FrontierKind>;
  onHide: (kind: FrontierKind) => void;
  onOpen: (study: WeightedStudy) => void;
}) {
  const t = useT();
  const s = t.studies.part2.timing;
  const format = AXES[metric].format;
  const heap = frontierValue(study, 'heap', metric);
  const rows = FRONTIERS.flatMap((kind) => {
    const value = frontierValue(study, kind, metric);
    return value ? [{ kind, ...value }] : [];
  }).sort((a, b) => a.v - b.v);
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
      <ol key={metric} className={styles.dataShowRows}>
        {rows.map((row, place) => {
          const runs = row.run?.timing?.runs ?? 0;
          const requested = row.run?.requested_runs ?? 0;
          const short = row.run !== null && !row.estimated && runs < requested;
          const off = hidden.has(row.kind);
          // An estimate says how it was made in a note beside the name.
          const partial = row.estimated ? row.run?.partial : null;
          const noteId = `estimate-${study.name}-${row.kind}`;
          return (
            <li key={row.kind}>
              <button
                type="button"
                className={styles.dataShowRow}
                data-focus={focus === row.kind || undefined}
                data-off={off || undefined}
                aria-pressed={!off}
                title={partial ? undefined : s.toggle(s.frontiers[row.kind])}
                aria-describedby={partial ? noteId : undefined}
                style={{ '--colour': FRONTIER_COLOUR[row.kind] } as CSSProperties}
                onClick={() => onHide(row.kind)}
              >
                <span className={`mono ${styles.dataShowPlace}`}>{place + 1}</span>
                <span className={styles.dataShowSwatch} aria-hidden="true" />
                <span className={styles.dataShowName}>
                  {s.frontiers[row.kind]}
                  {partial && (
                    <span className={styles.dataShowInfo}>
                      <Info size={12} aria-hidden="true" />
                      <span id={noteId} className={styles.dataShowTip} role="tooltip">
                        {s.estimateNote(
                          formatInt(partial.settled),
                          formatInt(partial.reachable),
                          formatMs(partial.elapsed_ms),
                          formatMs(partial.estimated_ms),
                        )}
                      </span>
                    </span>
                  )}
                </span>
                <span className={`mono ${styles.dataShowTime}`}>
                  {row.estimated ? s.estimated(format(row.v)) : format(row.v)}
                </span>
                <span className={`mono ${styles.dataShowRatio}`}>
                  {row.kind === 'heap' || !heap ? '' : `×${formatHeapRatio(row.v / heap.v)}`}
                </span>
                {short && (
                  <span className={`mono ${styles.dataShowNote}`}>
                    {s.runs(formatInt(runs), formatInt(requested))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <span className={`mono ${styles.dataShowFoot}`}>
        {metric === 'time' ? s.versusHeap : s.versusHeapBytes}
      </span>
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

/** A graph's frontiers, a lane each, in one of two drawings that morph
    into each other in place. Time: the frontiers on one linear time axis,
    the slowest run (the vector's) across the whole width; a playhead
    sweeps it once, the vector finishes its one run at the end while each
    other lane counts the whole runs it fits in the same time, the first
    run solid. A lane is cut into blocks of one run, or of 10, 100… runs
    when one run is too thin to see (W4 and W5 fit hundreds), and says so
    under its counter. Memory: what each frontier holds during one
    Dijkstra on one linear byte axis, its arrays indexed by vertex solid,
    its entries at their peak tinted, the room its storage kept hatched,
    and beside it the most entries it held (a share of n with decrease-key,
    a multiple of the heap's for the two that push a lowered estimate
    again). Switching fades the race out while the memory bars grow, and
    back; the lanes, their names and their counters stay where they are,
    so the chapter keeps its height. The race replays when the graph
    changes, on the button in the heading (`round`), and on coming back to
    time. In time, `scale` picks the axis: the vector's run across the
    width (the race above); without the vector, the slowest of the others
    across it, the vector's lane emptied; or log, the race fading out for
    one still bar a lane on a log scale from a tenth of the fastest run to
    the slowest, its counter at the runs that fit in one of the vector's. */
function FrontierLanes({
  study,
  view,
  round,
  metric,
  scale,
}: {
  study: WeightedStudy;
  view: string;
  round: number;
  metric: Metric;
  scale: TimeScale;
}) {
  const t = useT();
  const s = t.studies.part2.timing;
  const m = t.studies.part2.memory;
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
    if (!el || !('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
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
    if (!seen || metric !== 'time' || scale === 'log') return;
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
  }, [seen, view, round, metric, scale]);

  const memory = study.memory && study.memory.frontiers.length > 0 ? study.memory : null;
  const kinds = FRONTIERS.filter(
    (kind) =>
      frontierTime(study, kind) !== null || memory?.frontiers.some((f) => f.frontier === kind),
  );
  const timed = kinds.flatMap((kind) => {
    const time = frontierTime(study, kind);
    return time ? [{ kind, ...time }] : [];
  });
  // Without the vector, its lane is left empty and the slowest of the
  // others spans the track.
  const off = (kind: FrontierKind) => scale === 'heaps' && kind === 'vector';
  const raced = timed.filter((lane) => !off(lane.kind));
  const slowest =
    (scale !== 'heaps' && frontierTime(study, 'vector')) ||
    raced.reduce<(typeof timed)[number] | null>(
      (worst, lane) => (worst && worst.ms >= lane.ms ? worst : lane),
      null,
    );
  const clock = progress * (slowest?.ms ?? 0);
  // One block size for every lane of the graph, the one the thinnest run
  // needs, so a single note under the lanes says what a block holds.
  const block =
    trackWidth > 0 && slowest
      ? Math.max(1, ...raced.map((time) => raceBlock((time.ms / slowest.ms) * trackWidth)))
      : 1;
  // The log scale: a tenth of the fastest run to the slowest.
  const showLog = seen && metric === 'time' && scale === 'log';
  const logShare = logScale(
    Math.min(...timed.map((lane) => lane.ms)) / 10,
    Math.max(...timed.map((lane) => lane.ms)),
  );

  const maxBytes = Math.max(1, ...(memory?.frontiers.map((f) => f.allocated_bytes) ?? []));
  const heap = memory?.frontiers.find((f) => f.frontier === 'heap');
  const heapPeak = heap ? peakEntries(heap) : null;
  const decreases = Math.max(
    0,
    ...(memory?.frontiers.flatMap((f) => f.runs.map((r) => r.decreases)) ?? []),
  );
  const showMemory = seen && metric === 'memory';
  const share = (bytes: number) => `${showMemory ? (bytes / maxBytes) * 100 : 0}%`;
  const percent = (part: number) => {
    const p = (100 * part) / Math.max(study.vertices, 1);
    return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
  };
  // The counters and values swap with the graph, the metric and the scale.
  const swap = `${metric}-${scale}-${view}`;

  if (kinds.length === 0) return null;
  return (
    <div
      ref={ref}
      className={styles.race}
      data-metric={metric}
      data-scale={metric === 'time' ? scale : undefined}
      style={{ '--p': progress } as CSSProperties}
    >
      <div className={styles.raceLanes}>
        {kinds.map((kind, l) => {
          const time = frontierTime(study, kind);
          const lane = memory?.frontiers.find((f) => f.frontier === kind) ?? null;
          // Time.
          const runs = time && slowest && !off(kind) ? slowest.ms / time.ms : 0;
          const done =
            progress >= 1 || scale === 'log'
              ? Math.round(runs)
              : Math.floor(progress * runs + 1e-9);
          const segment = time && slowest && !off(kind) ? time.ms / slowest.ms : 0;
          // Memory.
          const peak = lane ? peakEntries(lane) : null;
          const extra = lane ? lane.allocated_bytes - lane.base_bytes : 0;
          const used = lane && peak !== null ? Math.min(extra, peak * lane.entry_bytes) : 0;
          const pushesAgain = kind === 'lazy_heap' || kind === 'radix';
          return (
            <div
              key={kind}
              className={styles.raceLane}
              data-estimated={
                (metric === 'time' && scale !== 'log' && time?.estimated) || undefined
              }
              data-off={(metric === 'time' && off(kind)) || undefined}
              style={
                {
                  '--colour': FRONTIER_COLOUR[kind],
                  '--segment': `${Math.min(1, segment * block) * 100}%`,
                  '--k': l,
                } as CSSProperties
              }
            >
              <span className={styles.raceName}>
                <span className={`mono ${styles.raceLabel}`}>{s.frontiers[kind]}</span>
                <span className={`mono ${styles.detail}`}>
                  <Swap view={swap}>
                    {metric === 'time'
                      ? time
                        ? time.estimated
                          ? s.estimated(formatMs(time.ms))
                          : formatMs(time.ms)
                        : '·'
                      : lane
                        ? formatBytes(lane.allocated_bytes)
                        : '·'}
                  </Swap>
                </span>
              </span>
              <span
                ref={l === 0 ? trackRef : undefined}
                className={styles.raceTrack}
                role={metric === 'memory' && lane ? 'img' : undefined}
                aria-label={
                  metric === 'memory' && lane
                    ? m.label(
                        s.frontiers[kind],
                        formatBytes(lane.base_bytes),
                        formatBytes(used),
                        formatBytes(extra - used),
                      )
                    : undefined
                }
              >
                <span className={styles.raceRuns} data-ticks={runs > 1.5 || undefined} />
                <span
                  className={styles.raceFirst}
                  style={{ width: `${Math.min(progress, segment) * 100}%` }}
                  data-on={progress > 0 || undefined}
                />
                <span
                  className={styles.logBar}
                  data-estimated={time?.estimated || undefined}
                  style={{ width: `${showLog && time ? logShare(time.ms) * 100 : 0}%` }}
                />
                <span className={styles.memoryBars}>
                  <span
                    className={styles.memoryBase}
                    style={{ width: share(lane?.base_bytes ?? 0) }}
                  />
                  <span className={styles.memoryUsed} style={{ width: share(used) }} />
                  <span className={styles.memorySlack} style={{ width: share(extra - used) }} />
                </span>
              </span>
              <span className={styles.raceCount}>
                <span className={`mono ${styles.raceNumber}`}>
                  <Swap view={swap}>
                    {metric === 'time'
                      ? off(kind)
                        ? '·'
                        : formatInt(done)
                      : formatCompact(peak ?? study.vertices)}
                  </Swap>
                </span>
                {metric === 'time' ? (
                  <span key={swap} className={`${styles.detail} ${styles.laneCountDetail}`}>
                    {off(kind) ? '' : s.race.runs(done)}
                  </span>
                ) : (
                  <span
                    key={swap}
                    className={`${styles.dataShowInfo} ${styles.laneCountDetail}`}
                    tabIndex={0}
                  >
                    <Info size={12} aria-hidden="true" />
                    <span className={`${styles.dataShowTip} ${styles.tipLeft}`} role="tooltip">
                      {peak === null
                        ? m.slots
                        : pushesAgain && heapPeak
                          ? m.versusHeap(formatHeapRatio(peak / heapPeak))
                          : m.ofN(percent(peak))}
                    </span>
                  </span>
                )}
              </span>
            </div>
          );
        })}
        <span className={styles.racePlayhead} aria-hidden>
          <span className={`mono ${styles.raceClock}`}>
            {slowest?.estimated ? '≈ ' : ''}
            {formatMs(clock)}
          </span>
        </span>
      </div>
      {/* The notes under the lanes, one for each drawing, laid on the same
          spot and crossfading, so the chapter keeps its height. */}
      {(block > 1 || memory) && (
        <div className={styles.raceFoot}>
          <div className={styles.raceKey} aria-hidden={metric !== 'time'}>
            {block > 1 && <span className="mono">{s.race.block(formatInt(block))}</span>}
          </div>
          {memory && (
            <div className={styles.memoryKey} aria-hidden={metric !== 'memory'}>
              <span>
                <span className={styles.memoryKeyBase} aria-hidden="true" />
                {m.key.base}
              </span>
              <span>
                <span className={styles.memoryKeyUsed} aria-hidden="true" />
                {m.key.entries}
              </span>
              <span>
                <span className={styles.memoryKeySlack} aria-hidden="true" />
                {m.key.slack}
              </span>
              <span className={styles.dataShowInfo} tabIndex={0}>
                <Info size={12} aria-hidden="true" />
                <span className={`${styles.dataShowTip} ${styles.tipAbove}`} role="tooltip">
                  {m.scale(
                    formatBytes(memory.graph_bytes),
                    formatBytes(memory.tree_bytes),
                    formatInt(decreases),
                    formatInt(study.vertices),
                  )}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
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
