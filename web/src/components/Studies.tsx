'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { formatBytes, formatCompact, formatInt, formatMs, graphNumber } from '@/lib/format';
import { logScale } from '@/lib/scale';
import type { DiameterMethod, GraphStudy, Representation, WeightedStudy } from '@/lib/studies';
import { useT } from '@/i18n/LocaleProvider';
import Rail from './Rail';
import Reveal from './Reveal';
import { Bars, Chapter, Swap, type Bar } from './studies-kit';
import StudiesPart2 from './StudiesPart2';
import styles from './Studies.module.css';

/* The case studies: one sheet per view, the seven questions of the
   assignment on one screen and nothing else, all read from results.json.
   A menu stuck under the site's nav picks the view: the overview first
   (the same sheet, every number the mean over the six graphs) and then
   one graph each. Every bar scale is computed over all the graphs and
   shared by every sheet, so a bar's length means the same on each.
   Switching view never remounts the sheet: the same elements stay in
   place, the bars slide to their new length and every number crossfades
   (`Swap`, keyed by the view), so only the values move. */

/** The hash the overview is kept under; a graph is `#grafo-<n>`. */
const OVERVIEW = 'geral';
/** The address of Part 2's page. */
const PART_2 = '#parte-2';

/** The representations in the order the bars show them, and their blues. */
const REPRESENTATIONS: Representation[] = ['adjacency_list', 'csr', 'adjacency_matrix'];
const REPR_COLOUR: Record<Representation, string> = {
  adjacency_list: 'var(--accent)',
  csr: 'var(--level-0)',
  adjacency_matrix: 'var(--accent-2)',
};
const METHODS: DiameterMethod[] = ['exact', 'bounds', 'i_fub', 'sweep'];
const METHOD_COLOUR: Record<DiameterMethod, string> = {
  exact: 'var(--level-0)',
  bounds: 'var(--accent)',
  i_fub: 'color-mix(in srgb, var(--accent) 55%, white)',
  sweep: 'var(--accent-2)',
};

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** The bytes a representation took, or would have taken. */
function memoryBytes(
  s: GraphStudy,
  r: Representation,
): { bytes: number; feasible: boolean } | null {
  const m = s.representations.find((x) => x.representation === r)?.memory;
  if (!m) return null;
  return m.feasible
    ? { bytes: m.footprint_bytes ?? m.resident_bytes ?? m.required_bytes, feasible: true }
    : { bytes: m.required_bytes, feasible: false };
}

type DfsWay = 'iterative' | 'recursive';
const DFS_WAYS: DfsWay[] = ['iterative', 'recursive'];

function timing(
  s: GraphStudy,
  r: Representation,
  algo: 'bfs' | 'dfs' | 'dfs_recursive',
): number | null {
  return s.representations.find((x) => x.representation === r)?.[algo]?.mean_ms ?? null;
}

/* ---- the sheet: what one view shows ------------------------------------- */

interface Sheet {
  /** The view this sheet is: what `Swap` keys its crossfade on. */
  id: string;
  title: string;
  /** A note beside the title, for the mean sheet. */
  subtitle?: string;
  facts: {
    vertices: number;
    edges: number;
    degree: { min: number; max: number; mean: number; median: number };
    /** What parsing normalised away; absent on the mean sheet, where an
        average of dropped lines says nothing and only lengthens the row. */
    dropped?: { loops: number; duplicates: number };
  };
  memory: Bar[];
  bfs: Bar[];
  /** One set of bars per DFS implementation. */
  dfs: Record<DfsWay, Bar[]>;
  parents: {
    roots: number[];
    vertices: number[];
    cell: (algo: 'bfs' | 'dfs', root: number, vertex: number) => ReactNode;
  };
  /** A label per pair, null when the ends are in different components. */
  distances: { from: number; to: number; label: string | null }[];
  /** The graph split in three: the largest component, everything between,
      the smallest. Counts may be fractional on the mean sheet. */
  components: { total: number; count: number; largest: number; smallest: number };
  diameter: Bar[];
}

interface Scales {
  memory: (bytes: number) => number;
  time: (ms: number) => number;
  bfs: (count: number) => number;
}

type T = ReturnType<typeof useT>;

/** `k de n`, only when it is not everyone. */
function share(t: T, k: number, n: number): ReactNode {
  return k === n ? null : (
    <span className={styles.detail}>{t.studies.of(String(k), String(n))}</span>
  );
}

function unreached(t: T): ReactNode {
  return (
    <span className={styles.unreached} title={t.studies.questions.parents.unreached}>
      ·
    </span>
  );
}

function timeBar(t: T, r: Representation, ms: number | null, scales: Scales): Bar {
  return {
    key: r,
    label: t.studies.short[r],
    colour: REPR_COLOUR[r],
    width: ms === null ? null : scales.time(ms),
    value: ms === null ? '·' : formatMs(ms),
  };
}

function emptyBar(t: T, m: DiameterMethod): Bar {
  return { key: m, label: t.studies.methods[m], colour: METHOD_COLOUR[m], width: null, value: '·' };
}

/** One graph's sheet. */
function graphSheet(s: GraphStudy, t: T, scales: Scales): Sheet {
  const q = t.studies.questions;
  return {
    id: `grafo-${graphNumber(s.name)}`,
    title: t.studies.graph(graphNumber(s.name)),
    facts: {
      vertices: s.vertices,
      edges: s.edges,
      degree: s.degree,
      dropped: { loops: s.self_loops_dropped, duplicates: s.duplicates_dropped },
    },
    memory: REPRESENTATIONS.map((r) => {
      const m = memoryBytes(s, r);
      return {
        key: r,
        label: t.studies.short[r],
        colour: REPR_COLOUR[r],
        width: m ? scales.memory(m.bytes) : null,
        ghost: m ? !m.feasible : false,
        value: !m ? '·' : m.feasible ? formatBytes(m.bytes) : q.memory.needs(formatBytes(m.bytes)),
      };
    }),
    bfs: REPRESENTATIONS.map((r) => timeBar(t, r, timing(s, r, 'bfs'), scales)),
    dfs: {
      iterative: REPRESENTATIONS.map((r) => timeBar(t, r, timing(s, r, 'dfs'), scales)),
      recursive: REPRESENTATIONS.map((r) => timeBar(t, r, timing(s, r, 'dfs_recursive'), scales)),
    },
    parents: {
      roots: [...new Set(s.parents.map((p) => p.root))],
      vertices: [...new Set(s.parents.map((p) => p.vertex))],
      cell: (algo, root, vertex) => {
        const p = s.parents.find(
          (x) => x.algorithm === algo && x.root === root && x.vertex === vertex,
        );
        if (p?.parent == null) return unreached(t);
        return (
          <>
            <span className={styles.parent}>{formatInt(p.parent)}</span>
            <span className={styles.level}>
              {q.parents.level} {formatInt(p.level ?? 0)}
            </span>
          </>
        );
      },
    },
    distances: s.distances.map((d) => ({
      from: d.from,
      to: d.to,
      label: d.distance === null ? null : String(d.distance),
    })),
    components: {
      total: s.vertices,
      count: s.components.count,
      largest: s.components.largest,
      smallest: s.components.smallest,
    },
    diameter: METHODS.map((m) => {
      const d = s.diameters.find((x) => x.method === m);
      if (!d) return emptyBar(t, m);
      const bound = !d.is_exact || d.cancelled;
      return {
        key: m,
        label: t.studies.methods[m],
        colour: METHOD_COLOUR[m],
        width: scales.bfs(d.bfs_count),
        ghost: d.cancelled,
        value: (
          <>
            <span className={styles.answer} data-bound={bound || undefined}>
              {bound ? '≥ ' : ''}
              {d.value}
            </span>
            <span className={styles.detail}>
              {q.diameter.bfs(formatCompact(d.bfs_count))}
              {d.cancelled ? ` · ${q.diameter.stopped(formatMs(d.elapsed_ms))}` : ''}
            </span>
          </>
        ),
      };
    }),
  };
}

/** The mean over every graph, in the same shape; where a number is not
    measured on every graph, how many it comes from is written beside it. */
function meanSheet(studies: GraphStudy[], t: T, scales: Scales): Sheet {
  const q = t.studies.questions;
  const n = studies.length;
  const avg = (pick: (s: GraphStudy) => number) => mean(studies.map(pick)) ?? 0;
  const some = (pick: (s: GraphStudy) => number | null) =>
    studies.map(pick).filter((v): v is number => v !== null);
  const timeBars = (algo: 'bfs' | 'dfs' | 'dfs_recursive') =>
    REPRESENTATIONS.map((r) => {
      const values = some((s) => timing(s, r, algo));
      const bar = timeBar(t, r, mean(values), scales);
      return {
        ...bar,
        value: (
          <>
            {bar.value}
            {values.length > 0 && share(t, values.length, n)}
          </>
        ),
      };
    });
  return {
    id: OVERVIEW,
    title: t.studies.overview,
    subtitle: t.studies.average(String(n)),
    facts: {
      vertices: avg((s) => s.vertices),
      edges: avg((s) => s.edges),
      degree: {
        min: avg((s) => s.degree.min),
        max: avg((s) => s.degree.max),
        mean: avg((s) => s.degree.mean),
        median: avg((s) => s.degree.median),
      },
    },
    memory: REPRESENTATIONS.map((r) => {
      const built = some((s) => {
        const m = memoryBytes(s, r);
        return m?.feasible ? m.bytes : null;
      });
      const bytes = mean(built);
      return {
        key: r,
        label: t.studies.short[r],
        colour: REPR_COLOUR[r],
        width: bytes === null ? null : scales.memory(bytes),
        value: (
          <>
            {bytes === null ? '·' : formatBytes(bytes)}
            {share(t, built.length, n)}
          </>
        ),
      };
    }),
    bfs: timeBars('bfs'),
    dfs: { iterative: timeBars('dfs'), recursive: timeBars('dfs_recursive') },
    parents: {
      roots: [...new Set(studies.flatMap((s) => s.parents.map((p) => p.root)))],
      vertices: [...new Set(studies.flatMap((s) => s.parents.map((p) => p.vertex)))],
      cell: (algo, root, vertex) => {
        const levels = some(
          (s) =>
            s.parents.find((x) => x.algorithm === algo && x.root === root && x.vertex === vertex)
              ?.level ?? null,
        );
        if (levels.length === 0) return unreached(t);
        return (
          <>
            <span className={styles.parent}>{t.studies.of(String(levels.length), String(n))}</span>
            <span className={styles.level}>
              {q.parents.meanLevel} {formatInt(mean(levels) ?? 0)}
            </span>
          </>
        );
      },
    },
    distances: studies[0].distances.map((d) => {
      const values = some(
        (s) => s.distances.find((x) => x.from === d.from && x.to === d.to)?.distance ?? null,
      );
      const m = mean(values);
      return { from: d.from, to: d.to, label: m === null ? null : m.toFixed(1) };
    }),
    components: {
      total: avg((s) => s.vertices),
      count: avg((s) => s.components.count),
      largest: avg((s) => s.components.largest),
      smallest: avg((s) => s.components.smallest),
    },
    diameter: METHODS.map((m) => {
      const runs = studies.flatMap((s) => s.diameters.filter((d) => d.method === m));
      if (runs.length === 0) return emptyBar(t, m);
      const exact = runs.filter((d) => d.is_exact && !d.cancelled).length;
      const value = mean(runs.map((d) => d.value)) ?? 0;
      const bfs = mean(runs.map((d) => d.bfs_count)) ?? 1;
      return {
        key: m,
        label: t.studies.methods[m],
        colour: METHOD_COLOUR[m],
        width: scales.bfs(bfs),
        ghost: exact === 0,
        value: (
          <>
            <span className={styles.answer} data-bound={exact < runs.length || undefined}>
              {exact < runs.length ? '≥ ' : ''}
              {value.toFixed(1)}
            </span>
            <span className={styles.detail}>
              {q.diameter.bfs(formatCompact(bfs))} ·{' '}
              {t.studies.of(String(exact), String(runs.length))} {q.diameter.exact}
            </span>
          </>
        ),
      };
    }),
  };
}

/* ---- the page ------------------------------------------------------------ */

export default function Studies({
  studies,
  weighted,
}: {
  studies: GraphStudy[];
  /** Part 2: the weighted course graphs and the collaboration network. */
  weighted: WeightedStudy[];
}) {
  const t = useT();
  // The part of the project (the rail on the left), and in Part 1 the view:
  // the overview, or the index of one graph. Both kept in the hash.
  const [part, setPart] = useState<1 | 2>(1);
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      // Part 2 keeps its own views under its prefix (`#parte-2-w3`, ...).
      setPart(location.hash.startsWith(PART_2) ? 2 : 1);
      const match = /^#grafo-(\d+)$/.exec(location.hash);
      const i = match ? studies.findIndex((s) => graphNumber(s.name) === match[1]) : -1;
      setView(i >= 0 ? i : null);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [studies]);
  const choose = useCallback(
    (i: number | null) => {
      setPart(1);
      setView(i);
      history.replaceState(
        null,
        '',
        i === null ? `#${OVERVIEW}` : `#grafo-${graphNumber(studies[i].name)}`,
      );
    },
    [studies],
  );
  const choosePart = (next: 1 | 2) => {
    if (next === 1) choose(view);
    else {
      setPart(2);
      history.replaceState(null, '', PART_2);
    }
  };

  // The menu is a tablist: the overview is stop 0, graph i is stop i + 1.
  // Left and right walk it from anywhere on the page, Home and End jump,
  // and when the menu has the focus it follows the chosen tab.
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stop = view === null ? 0 : view + 1;
  const last = studies.length;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Part 2 has no graph menu to walk.
      if (part === 2) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const active = document.activeElement;
      const inMenu = active instanceof HTMLElement && tabs.current.includes(active as never);
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName))
      ) {
        return;
      }
      // Up and down only inside the menu: elsewhere they scroll the page.
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
  }, [choose, last, stop, part]);

  const rail = (
    <Rail
      label={t.studies.parts.label}
      stops={[
        { id: '1', title: t.studies.parts.one },
        { id: '2', title: t.studies.parts.two },
      ]}
      active={String(part)}
      onSelect={(id) => choosePart(id === '2' ? 2 : 1)}
      numbered={false}
    />
  );

  if (part === 2 && weighted.length > 0) {
    return (
      <section className={`${styles.section} ${styles.sectionFill}`}>
        {rail}
        <StudiesPart2 studies={weighted} />
      </section>
    );
  }

  // A part whose study has not run yet: the page says so.
  if (part === 2 || studies.length === 0) {
    const empty = part === 2 ? t.studies.part2 : null;
    return (
      <section className={styles.section}>
        {rail}
        <div key={part} className={`container ${styles.content} ${styles.partEmpty}`}>
          <h1 className={styles.title}>{empty ? empty.title : t.studies.emptyTitle}</h1>
          <p className={styles.lead}>{empty ? empty.lead : t.studies.emptyLead}</p>
        </div>
      </section>
    );
  }

  // One scale per quantity across every graph, so the sheets compare.
  const scales: Scales = {
    memory: logScale(
      1 << 20,
      Math.max(
        ...studies.flatMap((s) => REPRESENTATIONS.map((r) => memoryBytes(s, r)?.bytes ?? 0)),
      ),
    ),
    time: logScale(
      0.1,
      Math.max(
        ...studies.flatMap((s) =>
          REPRESENTATIONS.flatMap((r) => [
            timing(s, r, 'bfs') ?? 0,
            timing(s, r, 'dfs') ?? 0,
            timing(s, r, 'dfs_recursive') ?? 0,
          ]),
        ),
      ),
    ),
    bfs: logScale(1, Math.max(...studies.flatMap((s) => s.diameters.map((d) => d.bfs_count)))),
  };
  const sheet =
    view === null ? meanSheet(studies, t, scales) : graphSheet(studies[view], t, scales);

  return (
    <section className={styles.section}>
      {rail}
      <nav className={styles.menu}>
        <div
          className={`container ${styles.menuInner}`}
          role="tablist"
          aria-label={t.studies.views}
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
              <span className={`mono ${styles.pickBall}`}>{graphNumber(s.name)}</span>
              <span className={styles.pickName}>{t.studies.graph(graphNumber(s.name))}</span>
            </button>
          ))}
        </div>
      </nav>
      <SheetView sheet={sheet} />
    </section>
  );
}

/** The seven answers on one screen: the facts on top, then the three bar
    charts in a row, the two parent tables side by side, and the triangle
    beside the components bar over the diameter bars. */
function SheetView({ sheet }: { sheet: Sheet }) {
  const t = useT();
  const q = t.studies.questions;
  const f = sheet.facts;
  const view = sheet.id;
  /** Which DFS the third chapter shows; the switch appears once a study
      has timed the recursive one. */
  const [way, setWay] = useState<DfsWay>('iterative');
  const bothWays = sheet.dfs.recursive.some((bar) => bar.width !== null);
  const shownWay = bothWays ? way : 'iterative';
  return (
    <div className={`container ${styles.content}`}>
      <Reveal className={styles.head}>
        <h1 className={styles.title}>
          <Swap view={view}>{sheet.title}</Swap>
        </h1>
        <div className={styles.facts}>
          <Swap view={view} className={styles.facts}>
            {sheet.subtitle && <span className={styles.subtitle}>{sheet.subtitle}</span>}
            <span className={`mono ${styles.fact}`}>
              {formatInt(f.vertices)} <em>{t.studies.facts.vertices}</em>
            </span>
            <span className={`mono ${styles.fact}`}>
              {formatInt(f.edges)} <em>{t.studies.facts.edges}</em>
            </span>
            <span className={styles.note}>
              {t.studies.facts.degree(
                formatInt(f.degree.min),
                formatInt(f.degree.max),
                f.degree.mean.toFixed(1),
                formatInt(f.degree.median),
              )}
            </span>
            {f.dropped && (
              <span className={styles.note}>
                {t.studies.facts.dropped(
                  formatInt(f.dropped.loops),
                  formatInt(f.dropped.duplicates),
                )}
              </span>
            )}
          </Swap>
        </div>
      </Reveal>

      <div className={styles.rowThree}>
        <Chapter index={1} title={q.memory.title} delay={0.05}>
          <Bars bars={sheet.memory} view={view} />
        </Chapter>
        {/* One label over both timing chapters: what their bars measure. */}
        <p className={`label ${styles.spanLabel}`}>{q.meanTime}</p>
        <Chapter index={2} title={q.bfs.title} delay={0.1}>
          <Bars bars={sheet.bfs} view={view} />
        </Chapter>
        <Chapter
          index={3}
          title={q.dfs.title}
          delay={0.15}
          tools={
            bothWays && (
              <span className={styles.waySwitch} role="group" aria-label={q.dfs.way}>
                {DFS_WAYS.map((which) => (
                  <button
                    key={which}
                    type="button"
                    className="label"
                    aria-pressed={shownWay === which}
                    onClick={() => setWay(which)}
                  >
                    {q.dfs.ways[which]}
                  </button>
                ))}
              </span>
            )
          }
        >
          <Bars bars={sheet.dfs[shownWay]} view={view} />
        </Chapter>
      </div>

      <Chapter index={4} title={q.parents.title} delay={0.2}>
        <div className={styles.tables}>
          {(['bfs', 'dfs'] as const).map((algo) => (
            <table key={algo} className={styles.table}>
              <thead>
                <tr>
                  <th>{algo.toUpperCase()}</th>
                  {sheet.parents.vertices.map((v) => (
                    <th key={v}>{q.parents.vertex(String(v))}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.parents.roots.map((root) => (
                  <tr key={root}>
                    <th scope="row">{q.parents.root(String(root))}</th>
                    {sheet.parents.vertices.map((v) => (
                      <td key={v} className="mono">
                        <Swap view={view}>{sheet.parents.cell(algo, root, v)}</Swap>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </Chapter>

      <div className={styles.rowLast}>
        <Chapter index={5} title={q.distances.title} delay={0.25}>
          <Triangle distances={sheet.distances} view={view} />
        </Chapter>
        <Chapter index={6} title={q.components.title} delay={0.3}>
          <Components split={sheet.components} view={view} />
        </Chapter>
        <Chapter index={7} title={q.diameter.title} delay={0.35}>
          <Bars bars={sheet.diameter} view={view} />
        </Chapter>
      </div>
    </div>
  );
}

/** The graph as one bar cut into its components: the largest, everything
    between it and the smallest, and the smallest, each segment as wide as
    its share of the vertices (a hair wide at least, so a 48-vertex
    component in five million is still visible). Under it, the count and
    what each segment is worth. */
function Components({ split, view }: { split: Sheet['components']; view: string }) {
  const t = useT();
  /** The part under the pointer, on the ring or in the legend. */
  const [hot, setHot] = useState<string | null>(null);
  const c = t.studies.questions.components;
  const { total, count, largest, smallest } = split;
  const others = count <= 1 ? 0 : Math.max(0, total - largest - smallest);
  const pct = (n: number) => `${((n / total) * 100).toFixed(n / total < 0.01 ? 2 : 1)} %`;
  const segments = [
    {
      key: 'largest',
      value: largest,
      colour: 'var(--accent)',
      label: c.largest(formatInt(largest)),
    },
    {
      key: 'others',
      value: others,
      colour: 'color-mix(in srgb, var(--accent) 45%, white)',
      label: c.others(formatInt(Math.max(0, count - 2))),
    },
    {
      key: 'smallest',
      value: count <= 1 ? 0 : smallest,
      colour: 'var(--accent-2)',
      label: c.smallest(formatInt(smallest)),
    },
  ];
  // The ring is 100 units long (`pathLength`); each arc is its share of the
  // graph, drawn clockwise from the top, with a hairline gap between arcs
  // when there is more than one.
  const shown = segments.filter((seg) => seg.value > 0);
  const gap = shown.length > 1 ? 1.2 : 0;
  let start = 0;
  const arcs = segments.map((seg) => {
    const share = (seg.value / total) * 100;
    const arc = { ...seg, length: Math.max(0, share - gap), offset: start + gap / 2 };
    start += share;
    return arc;
  });
  return (
    <div className={styles.components} data-hover={hot ?? undefined}>
      <svg className={styles.donut} viewBox="0 0 120 120" role="img" aria-label={c.title}>
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            className={styles.arc}
            cx="60"
            cy="60"
            r="50"
            pathLength={100}
            data-empty={arc.value <= 0 || undefined}
            data-hot={hot === arc.key || undefined}
            onMouseEnter={() => setHot(arc.key)}
            onMouseLeave={() => setHot(null)}
            style={
              {
                '--colour': arc.colour,
                strokeDasharray: `${arc.length} ${100 - arc.length}`,
                strokeDashoffset: -arc.offset,
              } as CSSProperties
            }
          >
            <title>{`${arc.label} · ${pct(arc.value)}`}</title>
          </circle>
        ))}
        <g key={view} className={styles.swap}>
          <text className={styles.donutValue} x="60" y="58">
            {formatCount(count)}
          </text>
          <text className={styles.donutUnit} x="60" y="74">
            {c.unit(count)}
          </text>
        </g>
      </svg>
      <ul className={styles.legend}>
        {shown.map((seg) => (
          <li
            key={seg.key}
            className={styles.legendItem}
            data-hot={hot === seg.key || undefined}
            onMouseEnter={() => setHot(seg.key)}
            onMouseLeave={() => setHot(null)}
          >
            <span className={styles.swatch} style={{ background: seg.colour }} />
            <span className={`mono ${styles.legendText}`}>
              <Swap view={view}>
                {seg.label} <span className={styles.detail}>{pct(seg.value)}</span>
              </Swap>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A count that may be fractional on the mean sheet. */
function formatCount(n: number): string {
  return Number.isInteger(n) ? formatInt(n) : n.toFixed(1);
}

/** Vertices 10, 20 and 30 as a triangle, each side labelled with the
    distance between its ends, dashed when they are in different components. */
function Triangle({ distances, view }: { distances: Sheet['distances']; view: string }) {
  const pos: Record<number, [number, number]> = { 10: [70, 22], 20: [16, 108], 30: [124, 108] };
  const ids = Object.keys(pos).map(Number);
  return (
    <svg viewBox="0 0 140 130" className={styles.triangle} aria-hidden="true">
      {distances.map((d) => {
        const [x1, y1] = pos[d.from];
        const [x2, y2] = pos[d.to];
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const half = (d.label?.length ?? 1) > 2 ? 15 : 11;
        return (
          <g key={`${d.from}-${d.to}`} data-apart={d.label === null || undefined}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.side} />
            <g key={view} className={styles.swap}>
              <rect
                x={mx - half}
                y={my - 8}
                width={half * 2}
                height={16}
                rx={8}
                className={styles.pill}
              />
              <text x={mx} y={my} dy="0.35em" textAnchor="middle" className={styles.sideLabel}>
                {d.label ?? '∞'}
              </text>
            </g>
          </g>
        );
      })}
      {ids.map((v) => (
        <g key={v} className={styles.vertex}>
          <circle cx={pos[v][0]} cy={pos[v][1]} r={13} />
          <text x={pos[v][0]} y={pos[v][1]} dy="0.35em" textAnchor="middle">
            {v}
          </text>
        </g>
      ))}
    </svg>
  );
}
