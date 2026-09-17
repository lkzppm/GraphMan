import { createContext, useContext, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  METHOD_LABEL,
  REPRESENTATION_LABEL,
  prettyName,
  type DiameterAnswer,
  type DiameterMethod,
  type GraphStudy,
  type Representation,
  type RepresentationStudy,
} from '../lib/data.ts';
import { formatBytes, formatCompact, formatInt, formatMs } from '../lib/format.ts';
import './Studies.css';

interface Props {
  studies: GraphStudy[];
}

const REPRS: Representation[] = ['adjacency_list', 'adjacency_matrix', 'csr'];
const METHODS: DiameterMethod[] = ['sweep', 'i_fub', 'bounds', 'exact'];

interface Tip {
  x: number;
  y: number;
  body: ReactNode;
}

/** A bar whose width is a share of the panel's maximum; hover shows a tooltip. */
function Bar({
  share,
  series,
  label,
  ghost = false,
  onTip,
}: {
  share: number;
  series: string;
  label: string;
  ghost?: boolean;
  onTip: (tip: Tip | null) => void;
}) {
  return (
    <div
      className={`bar${ghost ? ' bar--ghost' : ''}`}
      onMouseEnter={(e) => {
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        onTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, body: label });
      }}
      onMouseMove={(e) => {
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        onTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, body: label });
      }}
      onMouseLeave={() => onTip(null)}
    >
      <motion.span
        className="bar__fill"
        style={{ background: `var(--series-${series})` }}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.max(share, 0.004) * 100}%` }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
      <span className="bar__label">{label}</span>
    </div>
  );
}

const PanelContext = createContext<(tip: Tip | null) => void>(() => {});
const useTip = () => useContext(PanelContext);

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div className="panel">
      <h4 className="panel__title">{title}</h4>
      <div className="panel__body">
        <PanelContext.Provider value={setTip}>{children}</PanelContext.Provider>
        {tip && (
          <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
            {tip.body}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryRows({ study, max }: { study: GraphStudy; max: number }) {
  const setTip = useTip();
  return (
    <>
      {study.representations.map((r: RepresentationStudy) => {
        const value = r.memory.resident_bytes ?? r.memory.accounted_bytes ?? 0;
        const feasible = r.memory.feasible;
        return (
          <div key={r.representation} className="row">
            <span className="row__name">{REPRESENTATION_LABEL[r.representation]}</span>
            <Bar
              share={feasible ? value / max : 1}
              series={r.representation}
              ghost={!feasible}
              label={
                feasible
                  ? `${formatBytes(value)}`
                  : `needs ${formatBytes(r.memory.required_bytes)} · does not fit`
              }
              onTip={(t) =>
                setTip(
                  t && {
                    ...t,
                    body: feasible ? (
                      <>
                        <strong>{REPRESENTATION_LABEL[r.representation]}</strong>
                        <br />
                        process {formatBytes(value, 2)} · structure{' '}
                        {formatBytes(r.memory.accounted_bytes ?? 0, 2)}
                        <br />
                        built in {formatMs(r.memory.build_ms ?? 0)}
                      </>
                    ) : (
                      <>
                        <strong>{REPRESENTATION_LABEL[r.representation]}</strong>
                        <br />
                        would need {formatBytes(r.memory.required_bytes, 2)} for{' '}
                        {formatInt(study.vertices)} vertices
                      </>
                    ),
                  },
                )
              }
            />
          </div>
        );
      })}
    </>
  );
}

function TimeRows({ study, max, algo }: { study: GraphStudy; max: number; algo: 'bfs' | 'dfs' }) {
  const setTip = useTip();
  return (
    <>
      {study.representations.map((r) => {
        const t = r[algo];
        return (
          <div key={r.representation} className="row">
            <span className="row__name">{REPRESENTATION_LABEL[r.representation]}</span>
            {t ? (
              <Bar
                share={t.mean_ms / max}
                series={r.representation}
                label={formatMs(t.mean_ms)}
                onTip={(tip) =>
                  setTip(
                    tip && {
                      ...tip,
                      body: (
                        <>
                          <strong>
                            {algo.toUpperCase()} · {REPRESENTATION_LABEL[r.representation]}
                          </strong>
                          <br />
                          mean {formatMs(t.mean_ms)} over {t.runs} runs
                          <br />
                          median {formatMs(t.median_ms)} · min {formatMs(t.min_ms)} · max{' '}
                          {formatMs(t.max_ms)}
                        </>
                      ),
                    },
                  )
                }
              />
            ) : (
              <span className="row__na">not measurable: representation does not fit</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function DiameterRows({ study }: { study: GraphStudy }) {
  const setTip = useTip();
  const n = study.vertices;
  const logMax = Math.log10(n);
  const ticks = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000, 10_000_000].filter((t) => t <= n);
  return (
    <div className="lolli">
      <div className="lolli__axis" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t}
            className="lolli__tick"
            style={{ left: `${(Math.log10(t) / logMax) * 100}%` }}
          >
            {formatCompact(t)}
          </span>
        ))}
        <span className="lolli__tick lolli__tick--n" style={{ left: '100%' }}>
          n
        </span>
      </div>
      {METHODS.map((method) => {
        const d = study.diameters.find((x: DiameterAnswer) => x.method === method);
        if (!d) {
          return (
            <div key={method} className="row">
              <span className="row__name">{METHOD_LABEL[method]}</span>
              <span className="row__na">skipped</span>
            </div>
          );
        }
        const pos = (Math.log10(Math.max(d.bfs_count, 1)) / logMax) * 100;
        const flag = d.is_exact ? '' : d.cancelled ? ' · budget' : ' · bound';
        return (
          <div key={method} className="row">
            <span className="row__name">{METHOD_LABEL[method]}</span>
            <div
              className="lolli__track"
              onMouseMove={(e) => {
                const rect = (
                  e.currentTarget.parentElement!.parentElement as HTMLElement
                ).getBoundingClientRect();
                setTip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  body: (
                    <>
                      <strong>{METHOD_LABEL[method]}</strong>
                      <br />
                      {d.is_exact ? 'diameter' : 'lower bound'} {d.value} · {formatInt(d.bfs_count)}{' '}
                      BFS runs
                      <br />
                      {formatMs(d.elapsed_ms)}
                      {d.cancelled ? ' · stopped by the time budget' : ''}
                    </>
                  ),
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <motion.span
                className="lolli__stem"
                style={{ background: `var(--series-${method})` }}
                initial={{ width: 0 }}
                whileInView={{ width: `${pos}%` }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.span
                className="lolli__dot"
                style={{ background: `var(--series-${method})` }}
                initial={{ left: 0, opacity: 0 }}
                whileInView={{ left: `${pos}%`, opacity: 1 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
              <span className="lolli__label" style={{ left: `calc(${pos}% + 14px)` }}>
                {formatInt(d.bfs_count)} runs → {d.is_exact ? '' : '≥ '}
                {d.value}
                {flag}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Studies({ studies }: Props) {
  const machine = studies[0]?.machine;
  const memMax = Math.max(
    1,
    ...studies.flatMap((s) =>
      s.representations.filter((r) => r.memory.feasible).map((r) => r.memory.resident_bytes ?? 0),
    ),
  );
  const timeMax = (algo: 'bfs' | 'dfs') =>
    Math.max(0.001, ...studies.flatMap((s) => s.representations.map((r) => r[algo]?.mean_ms ?? 0)));

  return (
    <section id="studies" className="tile tile--light studies">
      <div className="tile__inner">
        <div className="tile__head">
          <p className="eyebrow">Case studies</p>
          <h2 className="display-lg">Measured, not estimated.</h2>
          <p className="lead">
            Every number below was produced by <code className="mono">graphman study</code>: memory
            in a fresh process per representation, 100 searches per algorithm from distinct random
            roots, and four diameter strategies racing on the same graphs.
          </p>
          {machine && (
            <p className="caption studies__machine">
              {machine.cpu ?? `${machine.os} ${machine.arch}`} · {machine.threads} threads ·{' '}
              {machine.total_memory_bytes ? formatBytes(machine.total_memory_bytes, 0) : '?'} RAM ·
              times exclude reading and writing files
            </p>
          )}
        </div>

        {studies.length === 0 ? (
          <p className="studies__empty caption">
            No results yet. Run <code className="mono">graphman study graphs/grafo_1.txt</code> and{' '}
            <code className="mono">npm run data</code>.
          </p>
        ) : (
          <>
            <div className="legend" aria-label="Representations">
              {REPRS.map((r) => (
                <span key={r} className="legend__item">
                  <i style={{ background: `var(--series-${r})` }} />
                  {REPRESENTATION_LABEL[r]}
                </span>
              ))}
            </div>

            <h3 className="studies__h3">Memory after loading the graph</h3>
            <p className="studies__note">
              Resident memory of the process once the representation is built and the edge list is
              released. Dashed bars mark representations that cannot be built on this machine.
            </p>
            <div className="grid grid--3">
              {studies.map((s) => (
                <Panel
                  key={s.name}
                  title={`${prettyName(s.name)} · ${formatCompact(s.vertices)} vertices, ${formatCompact(s.edges)} edges`}
                >
                  <MemoryRows study={s} max={memMax} />
                </Panel>
              ))}
            </div>

            {(['bfs', 'dfs'] as const).map((algo) => (
              <div key={algo}>
                <h3 className="studies__h3">Mean {algo.toUpperCase()} time, 100 searches</h3>
                <p className="studies__note">
                  One search from each of 100 distinct random start vertices; the mean of the
                  wall-clock time of the algorithm alone.
                </p>
                <div className="grid grid--3">
                  {studies.map((s) => (
                    <Panel key={s.name} title={prettyName(s.name)}>
                      <TimeRows study={s} max={timeMax(algo)} algo={algo} />
                    </Panel>
                  ))}
                </div>
              </div>
            ))}

            <div className="legend" aria-label="Diameter methods">
              {METHODS.map((m) => (
                <span key={m} className="legend__item">
                  <i style={{ background: `var(--series-${m})` }} />
                  {METHOD_LABEL[m]}
                </span>
              ))}
            </div>
            <h3 className="studies__h3">Diameter: how many BFS runs each method needed</h3>
            <p className="studies__note">
              Logarithmic axis, from one BFS to one per vertex (n). The 4-sweep is a lower bound in
              four BFS runs; the other three certify the exact diameter.
            </p>
            <div className="grid grid--2">
              {studies.map((s) => (
                <Panel key={s.name} title={prettyName(s.name)}>
                  <DiameterRows study={s} />
                </Panel>
              ))}
            </div>

            <h3 className="studies__h3">Answers</h3>
            <div className="tables">
              <table className="table">
                <caption>Parents (and levels) of vertices 10, 20 and 30</caption>
                <thead>
                  <tr>
                    <th>Graph</th>
                    <th>Search</th>
                    <th>Root</th>
                    {[10, 20, 30].map((v) => (
                      <th key={v}>parent of {v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {studies.flatMap((s) =>
                    (['bfs', 'dfs'] as const).flatMap((algo) =>
                      [1, 2, 3].map((root) => (
                        <tr key={`${s.name}-${algo}-${root}`}>
                          <td>{prettyName(s.name)}</td>
                          <td>{algo.toUpperCase()}</td>
                          <td className="mono">{root}</td>
                          {[10, 20, 30].map((v) => {
                            const a = s.parents.find(
                              (p) => p.algorithm === algo && p.root === root && p.vertex === v,
                            );
                            return (
                              <td key={v} className="mono">
                                {a?.parent != null
                                  ? `${a.parent} (${a.level})`
                                  : a?.level === 0
                                    ? 'root'
                                    : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    ),
                  )}
                </tbody>
              </table>

              <table className="table">
                <caption>Distances, components and diameter</caption>
                <thead>
                  <tr>
                    <th>Graph</th>
                    <th>d(10,20)</th>
                    <th>d(10,30)</th>
                    <th>d(20,30)</th>
                    <th>Components</th>
                    <th>Largest</th>
                    <th>Smallest</th>
                    <th>Diameter</th>
                  </tr>
                </thead>
                <tbody>
                  {studies.map((s) => {
                    const best = s.diameters.filter((d) => d.is_exact)[0] ?? s.diameters[0];
                    return (
                      <tr key={s.name}>
                        <td>{prettyName(s.name)}</td>
                        {s.distances.map((d) => (
                          <td key={`${d.from}-${d.to}`} className="mono">
                            {d.distance ?? '∞'}
                          </td>
                        ))}
                        <td className="mono">{formatInt(s.components.count)}</td>
                        <td className="mono">{formatInt(s.components.largest)}</td>
                        <td className="mono">{formatInt(s.components.smallest)}</td>
                        <td className="mono">
                          {best ? `${best.is_exact ? '' : '≥ '}${best.value}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
