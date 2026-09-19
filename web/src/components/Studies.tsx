'use client';

import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { formatBytes, formatCompact, formatInt, formatMs, graphNumber } from '@/lib/format';
import type { DiameterMethod, GraphStudy, MemoryReport, Representation } from '@/lib/studies';
import { useT } from '@/i18n/LocaleProvider';
import Reveal from './Reveal';
import styles from './Studies.module.css';

/* The case studies, one chapter per question of the assignment and nothing
   else, all read from results.json. A menu under the site's nav picks a
   view: the overview compares the six graphs (vertices on one edge with
   the output file's facts, then memory, search times and diameter as bars
   on a log scale, the parents of 10, 20 and 30, the three distances as a
   triangle per graph, the components as the largest one's share); a graph
   view puts that graph's seven answers on one screen. The bar scales are
   shared by every view, so a bar means the same wherever it is. */

/** The hash a view is kept under, so a graph can be linked to. */
const OVERVIEW = 'geral';

const RESULTS = 'https://github.com/lkzppm/GraphMan/blob/main/studies/RESULTS.md';

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

/** Where a value lands on a log scale from `floor` to `top`, 0..1. */
function logScale(floor: number, top: number) {
  const lo = Math.log10(floor);
  const hi = Math.log10(top);
  return (value: number) => Math.min(1, Math.max(0, (Math.log10(value) - lo) / (hi - lo)));
}

function repr(study: GraphStudy, r: Representation) {
  return study.representations.find((x) => x.representation === r);
}

type Name = (s: GraphStudy) => string;

export default function Studies({ studies }: { studies: GraphStudy[] }) {
  const t = useT();
  const name: Name = (study) => t.studies.graph(graphNumber(study.name));
  // The view: the overview, or the index of one graph. Kept in the hash.
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const match = /^#grafo-(\d+)$/.exec(location.hash);
      const i = match ? studies.findIndex((s) => graphNumber(s.name) === match[1]) : -1;
      setView(i >= 0 ? i : null);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [studies]);
  const choose = (i: number | null) => {
    setView(i);
    history.replaceState(
      null,
      '',
      i === null ? `#${OVERVIEW}` : `#grafo-${graphNumber(studies[i].name)}`,
    );
  };

  if (studies.length === 0) {
    return (
      <section className={styles.section}>
        <div className={`container ${styles.content}`}>
          <h1 className={styles.title}>{t.studies.emptyTitle}</h1>
          <p className={styles.lead}>{t.studies.emptyLead}</p>
        </div>
      </section>
    );
  }

  // One scale per quantity across every graph, so the views compare.
  const scales: Scales = {
    memory: logScale(
      1 << 20,
      Math.max(...studies.flatMap((s) => s.representations.map((r) => memoryBytes(r.memory)))),
    ),
    time: logScale(
      0.1,
      Math.max(
        ...studies.flatMap((s) =>
          s.representations.flatMap((r) => [r.bfs?.mean_ms ?? 0, r.dfs?.mean_ms ?? 0]),
        ),
      ),
    ),
    bfs: logScale(1, Math.max(...studies.flatMap((s) => s.diameters.map((d) => d.bfs_count)))),
  };

  return (
    <section className={styles.section}>
      <nav className={styles.menu} aria-label={t.studies.views}>
        <div className={`container ${styles.menuInner}`}>
          <button
            type="button"
            className={styles.pick}
            data-active={view === null || undefined}
            onClick={() => choose(null)}
          >
            <span className={`mono ${styles.pickBall}`}>∗</span>
            <span className={styles.pickName}>{t.studies.overview}</span>
          </button>
          {studies.map((s, i) => (
            <button
              key={s.name}
              type="button"
              className={styles.pick}
              data-active={view === i || undefined}
              onClick={() => choose(i)}
            >
              <span className={`mono ${styles.pickBall}`}>{graphNumber(s.name)}</span>
              <span className={styles.pickName}>{name(s)}</span>
            </button>
          ))}
        </div>
      </nav>

      {view === null ? (
        <Overview studies={studies} name={name} scales={scales} />
      ) : (
        <Single key={studies[view].name} study={studies[view]} name={name} scales={scales} />
      )}
    </section>
  );
}

interface Scales {
  memory: (bytes: number) => number;
  time: (ms: number) => number;
  bfs: (count: number) => number;
}

/** Every graph compared, question by question. */
function Overview({
  studies,
  name,
  scales,
}: {
  studies: GraphStudy[];
  name: Name;
  scales: Scales;
}) {
  const t = useT();
  const q = t.studies.questions;
  return (
    <div className={`container ${styles.content}`}>
      <Reveal>
        <GraphStrip studies={studies} name={name} />
      </Reveal>

      <Chapter index={1} title={q.memory.title} note={q.memory.note}>
        <MemoryChart studies={studies} name={name} scale={scales.memory} />
      </Chapter>

      <Chapter index={2} title={q.bfs.title} note={q.bfs.note}>
        <TimeChart algo="bfs" scale={scales.time} studies={studies} name={name} />
      </Chapter>

      <Chapter index={3} title={q.dfs.title} note={q.dfs.note}>
        <TimeChart algo="dfs" scale={scales.time} studies={studies} name={name} />
      </Chapter>

      <Chapter index={4} title={q.parents.title} note={q.parents.note}>
        <Parents studies={studies} name={name} />
      </Chapter>

      <Chapter index={5} title={q.distances.title} note={q.distances.note}>
        <div className={styles.triangles}>
          {studies.map((study, i) => (
            <Reveal key={study.name} delay={i * 0.06} className={styles.triangleCard}>
              <span className={`label ${styles.cardLabel}`}>{name(study)}</span>
              <Triangle study={study} />
            </Reveal>
          ))}
        </div>
      </Chapter>

      <Chapter index={6} title={q.components.title} note={q.components.note}>
        <ComponentsChart studies={studies} name={name} />
      </Chapter>

      <Chapter index={7} title={q.diameter.title} note={q.diameter.note}>
        <DiameterChart studies={studies} name={name} scale={scales.bfs} />
      </Chapter>

      <Reveal as="p" className={styles.source}>
        <a href={RESULTS} target="_blank" rel="noreferrer">
          {t.studies.source}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </Reveal>
    </div>
  );
}

/** One graph, its seven answers on one screen. */
function Single({ study, name, scales }: { study: GraphStudy; name: Name; scales: Scales }) {
  const t = useT();
  const q = t.studies.questions;
  const one = [study];
  return (
    <div className={`container ${styles.content} ${styles.single}`}>
      <Reveal className={styles.singleHead}>
        <h1 className={styles.singleTitle}>{name(study)}</h1>
        <Facts study={study} />
      </Reveal>
      <div className={styles.columns}>
        <div className={styles.column}>
          <Chapter index={1} title={q.memory.title} note={q.memory.note} compact>
            <MemoryChart studies={one} name={name} scale={scales.memory} single />
          </Chapter>
          <Chapter index={2} title={q.bfs.title} note={q.bfs.note} compact>
            <TimeChart algo="bfs" scale={scales.time} studies={one} name={name} single />
          </Chapter>
          <Chapter index={3} title={q.dfs.title} note={q.dfs.note} compact>
            <TimeChart algo="dfs" scale={scales.time} studies={one} name={name} single />
          </Chapter>
          <Chapter index={7} title={q.diameter.title} note={q.diameter.note} compact>
            <DiameterChart studies={one} name={name} scale={scales.bfs} single />
          </Chapter>
        </div>
        <div className={styles.column}>
          <Chapter index={4} title={q.parents.title} note={q.parents.note} compact>
            <ParentTables study={study} />
          </Chapter>
          <div className={styles.pair}>
            <Chapter index={5} title={q.distances.title} note={q.distances.note} compact>
              <Triangle study={study} />
            </Chapter>
            <Chapter index={6} title={q.components.title} note={q.components.note} compact>
              <ComponentsChart studies={one} name={name} single />
            </Chapter>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The output file's facts about one graph, in a row. */
function Facts({ study }: { study: GraphStudy }) {
  const c = useT().studies.graphs;
  return (
    <div className={styles.facts}>
      <span className={`mono ${styles.stripFact}`}>
        {formatInt(study.vertices)} <em>{c.vertices}</em>
      </span>
      <span className={`mono ${styles.stripFact}`}>
        {formatInt(study.edges)} <em>{c.edges}</em>
      </span>
      <span className={styles.stripNote}>
        {c.degree(
          formatInt(study.degree.min),
          formatInt(study.degree.max),
          study.degree.mean.toFixed(1),
          formatInt(study.degree.median),
        )}
      </span>
      <span className={styles.stripNote}>
        {c.dropped(formatInt(study.self_loops_dropped), formatInt(study.duplicates_dropped))}
      </span>
    </div>
  );
}

/** The bytes a representation took, or would have taken. */
function memoryBytes(m: MemoryReport): number {
  return m.feasible
    ? (m.footprint_bytes ?? m.resident_bytes ?? m.required_bytes)
    : m.required_bytes;
}

/** A question of the assignment: mono index, title, a note on the right. */
function Chapter({
  index,
  title,
  note,
  compact,
  children,
}: {
  index: number;
  title: string;
  note: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <Reveal as="article" className={`${styles.chapter} ${compact ? styles.compact : ''}`}>
      <header className={styles.chapterHead}>
        <span className={`mono ${styles.chapterIndex}`}>{String(index).padStart(2, '0')}</span>
        <h2 className={styles.chapterTitle}>{title}</h2>
        <span className={styles.chapterNote}>{note}</span>
      </header>
      {children}
    </Reveal>
  );
}

/* ---- the six graphs ------------------------------------------------------ */

/** One vertex per graph on a single edge, its radius the vertex count on a
    log scale, the output file's facts under it. */
function GraphStrip({ studies, name }: { studies: GraphStudy[]; name: Name }) {
  const c = useT().studies.graphs;
  const radius = (n: number) => 16 + (Math.log10(n) - 4) * 9;
  return (
    <ol className={styles.strip}>
      {studies.map((study) => {
        const r = radius(study.vertices);
        return (
          <li key={study.name} className={styles.stripItem}>
            <span className={styles.stripVertex}>
              <span
                className={`mono ${styles.stripBall}`}
                style={{ width: r * 2, height: r * 2, fontSize: 11 + (r - 16) / 3 }}
              >
                {graphNumber(study.name)}
              </span>
            </span>
            <span className={`label ${styles.stripName}`}>{name(study)}</span>
            <span className={`mono ${styles.stripFact}`}>
              {formatInt(study.vertices)} <em>{c.vertices}</em>
            </span>
            <span className={`mono ${styles.stripFact}`}>
              {formatInt(study.edges)} <em>{c.edges}</em>
            </span>
            <span className={styles.stripNote}>
              {c.degree(
                formatInt(study.degree.min),
                formatInt(study.degree.max),
                study.degree.mean.toFixed(1),
                formatInt(study.degree.median),
              )}
            </span>
            <span className={styles.stripNote}>
              {c.dropped(formatInt(study.self_loops_dropped), formatInt(study.duplicates_dropped))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---- bars ---------------------------------------------------------------- */

interface Bar {
  key: string;
  label: string;
  colour: string;
  /** 0..1 of the track; null draws nothing but the value. */
  width: number | null;
  value: ReactNode;
  /** Dashed outline instead of a fill: something that was not measured. */
  ghost?: boolean;
}

/** Rows of horizontal bars, one row per graph, with a legend on top. */
function Bars({
  rows,
  legend,
  scaleNote,
  single,
}: {
  rows: { key: string; name: string; bars: Bar[] }[];
  legend?: { label: string; colour: string }[];
  scaleNote?: string;
  /** One graph only: no row names. */
  single?: boolean;
}) {
  return (
    <div className={styles.bars} data-single={single || undefined}>
      {(legend || scaleNote) && (
        <div className={styles.legend}>
          {legend?.map((item) => (
            <span key={item.label} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: item.colour }} />
              {item.label}
            </span>
          ))}
          {scaleNote && <span className={`mono ${styles.scaleNote}`}>{scaleNote}</span>}
        </div>
      )}
      {rows.map((row) => (
        <div key={row.key} className={styles.row}>
          {!single && <span className={`label ${styles.rowName}`}>{row.name}</span>}
          <div className={styles.rowBars}>
            {row.bars.map((bar) => (
              <div
                key={bar.key}
                className={styles.bar}
                data-ghost={bar.ghost || undefined}
                data-bare={bar.label === '' || undefined}
              >
                {bar.label !== '' && <span className={`mono ${styles.barLabel}`}>{bar.label}</span>}
                <span className={styles.track}>
                  {bar.width !== null && (
                    <span
                      className={styles.fill}
                      style={
                        {
                          '--w': `${Math.max(0.6, bar.width * 100)}%`,
                          '--colour': bar.colour,
                        } as CSSProperties
                      }
                    />
                  )}
                  <span className={`mono ${styles.value}`}>{bar.value}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- 1: memory ----------------------------------------------------------- */

function MemoryChart({
  studies,
  name,
  scale,
  single,
}: {
  studies: GraphStudy[];
  name: Name;
  scale: (bytes: number) => number;
  single?: boolean;
}) {
  const t = useT();
  const c = t.studies.questions.memory;
  return (
    <Bars
      single={single}
      scaleNote={t.studies.logScale}
      legend={REPRESENTATIONS.map((r) => ({
        label: t.studies.representations[r],
        colour: REPR_COLOUR[r],
      }))}
      rows={studies.map((s) => ({
        key: s.name,
        name: name(s),
        bars: REPRESENTATIONS.map((r) => {
          const m = repr(s, r)?.memory;
          const b = m ? memoryBytes(m) : null;
          return {
            key: r,
            label: t.studies.short[r],
            colour: REPR_COLOUR[r],
            width: b === null ? null : scale(b),
            ghost: m ? !m.feasible : false,
            value: b === null ? '·' : m?.feasible ? formatBytes(b) : c.needs(formatBytes(b)),
          };
        }),
      }))}
    />
  );
}

/* ---- 2 and 3: search times ----------------------------------------------- */

function TimeChart({
  algo,
  scale,
  studies,
  name,
  single,
}: {
  algo: 'bfs' | 'dfs';
  scale: (ms: number) => number;
  studies: GraphStudy[];
  name: Name;
  single?: boolean;
}) {
  const t = useT();
  return (
    <Bars
      single={single}
      scaleNote={t.studies.logScale}
      legend={REPRESENTATIONS.map((r) => ({
        label: t.studies.representations[r],
        colour: REPR_COLOUR[r],
      }))}
      rows={studies.map((s) => ({
        key: s.name,
        name: name(s),
        bars: REPRESENTATIONS.map((r) => {
          const timing = repr(s, r)?.[algo];
          return {
            key: r,
            label: t.studies.short[r],
            colour: REPR_COLOUR[r],
            width: timing ? scale(timing.mean_ms) : null,
            value: timing ? formatMs(timing.mean_ms) : '·',
          };
        }),
      }))}
    />
  );
}

/* ---- 4: parents ---------------------------------------------------------- */

/** The six graphs as a row of vertices to pick from; the chosen one's
    parents and levels in two grids, BFS and DFS. */
function Parents({ studies, name }: { studies: GraphStudy[]; name: Name }) {
  const [chosen, setChosen] = useState(0);
  return (
    <div className={styles.parents}>
      <div className={styles.picker} role="tablist">
        {studies.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={i === chosen}
            className={styles.pick}
            data-active={i === chosen || undefined}
            onClick={() => setChosen(i)}
          >
            <span className={`mono ${styles.pickBall}`}>{graphNumber(s.name)}</span>
            <span className={styles.pickName}>{name(s)}</span>
          </button>
        ))}
      </div>
      <ParentTables study={studies[chosen]} />
    </div>
  );
}

/** Parent over level for every root and vertex asked, BFS beside DFS. */
function ParentTables({ study }: { study: GraphStudy }) {
  const c = useT().studies.questions.parents;
  const roots = [...new Set(study.parents.map((p) => p.root))];
  const vertices = [...new Set(study.parents.map((p) => p.vertex))];
  return (
    <div className={styles.split}>
      {(['bfs', 'dfs'] as const).map((algo) => (
        <table key={algo} className={styles.table}>
          <thead>
            <tr>
              <th>{algo.toUpperCase()}</th>
              {vertices.map((v) => (
                <th key={v}>{c.vertex(String(v))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roots.map((root) => (
              <tr key={root}>
                <th scope="row">{c.root(String(root))}</th>
                {vertices.map((v) => {
                  const p = study.parents.find(
                    (x) => x.algorithm === algo && x.root === root && x.vertex === v,
                  );
                  return (
                    <td key={v} className="mono">
                      {p?.parent == null ? (
                        <span className={styles.unreached} title={c.unreached}>
                          ·
                        </span>
                      ) : (
                        <>
                          <span className={styles.parent}>{formatInt(p.parent)}</span>
                          <span className={styles.level}>
                            {c.level} {formatInt(p.level ?? 0)}
                          </span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

/* ---- 5: distances -------------------------------------------------------- */

/** Vertices 10, 20 and 30 as a triangle, each side labelled with the
    distance between its ends, dashed when they are in different components. */
function Triangle({ study }: { study: GraphStudy }) {
  const pos: Record<number, [number, number]> = { 10: [70, 22], 20: [16, 108], 30: [124, 108] };
  const ids = Object.keys(pos).map(Number);
  return (
    <svg viewBox="0 0 140 130" className={styles.triangle} aria-hidden="true">
      {study.distances.map((d) => {
        const [x1, y1] = pos[d.from];
        const [x2, y2] = pos[d.to];
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        return (
          <g key={`${d.from}-${d.to}`} data-apart={d.distance === null || undefined}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.side} />
            <rect x={mx - 11} y={my - 8} width={22} height={16} rx={8} className={styles.pill} />
            <text x={mx} y={my} dy="0.35em" textAnchor="middle" className={styles.sideLabel}>
              {d.distance ?? '∞'}
            </text>
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

/* ---- 6: components ------------------------------------------------------- */

/** One bar per graph, the whole graph, its largest component the blue part. */
function ComponentsChart({
  studies,
  name,
  single,
}: {
  studies: GraphStudy[];
  name: Name;
  single?: boolean;
}) {
  const c = useT().studies.questions.components;
  return (
    <Bars
      single={single}
      rows={studies.map((s) => {
        const { count, largest, smallest } = s.components;
        return {
          key: s.name,
          name: name(s),
          bars: [
            {
              key: 'largest',
              label: '',
              colour: 'var(--accent)',
              width: largest / s.vertices,
              value: (
                <>
                  <span className={styles.answer}>
                    {count === 1 ? c.one : c.count(formatInt(count))}
                  </span>
                  <span className={styles.detail}>
                    {c.largest(formatInt(largest))} · {c.smallest(formatInt(smallest))}
                  </span>
                </>
              ),
            },
          ],
        };
      })}
    />
  );
}

/* ---- 7: diameter --------------------------------------------------------- */

function DiameterChart({
  studies,
  name,
  scale,
  single,
}: {
  studies: GraphStudy[];
  name: Name;
  scale: (count: number) => number;
  single?: boolean;
}) {
  const t = useT();
  const c = t.studies.questions.diameter;
  return (
    <Bars
      single={single}
      scaleNote={t.studies.logScale}
      legend={METHODS.map((m) => ({ label: t.studies.methods[m], colour: METHOD_COLOUR[m] }))}
      rows={studies.map((s) => ({
        key: s.name,
        name: name(s),
        bars: METHODS.map((m) => {
          const d = s.diameters.find((x) => x.method === m);
          if (!d) {
            return {
              key: m,
              label: t.studies.methods[m],
              colour: METHOD_COLOUR[m],
              width: null,
              value: '·',
            };
          }
          const bound = !d.is_exact || d.cancelled;
          return {
            key: m,
            label: t.studies.methods[m],
            colour: METHOD_COLOUR[m],
            width: scale(d.bfs_count),
            ghost: d.cancelled,
            value: (
              <>
                <span className={styles.answer} data-bound={bound || undefined}>
                  {bound ? '≥ ' : ''}
                  {d.value}
                </span>
                <span className={styles.detail}>
                  {c.bfs(formatCompact(d.bfs_count))}
                  {d.cancelled ? ` · ${c.stopped(formatMs(d.elapsed_ms))}` : ''}
                </span>
              </>
            ),
          };
        }),
      }))}
    />
  );
}
