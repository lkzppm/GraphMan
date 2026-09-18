import { formatBytes, formatCompact, formatInt, formatMs, prettyName } from '@/lib/format';
import {
  DIAMETER_LABEL,
  REPRESENTATION_LABEL,
  type DiameterMethod,
  type GraphStudy,
  type Representation,
} from '@/lib/studies';
import Reveal from './Reveal';
import styles from './Studies.module.css';

const REPRESENTATIONS: Representation[] = ['adjacency_list', 'adjacency_matrix', 'csr'];
const METHODS: DiameterMethod[] = ['sweep', 'i_fub', 'bounds', 'exact'];

function Table({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <Reveal className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        {children}
      </table>
    </Reveal>
  );
}

function cell(study: GraphStudy, repr: Representation) {
  return study.representations.find((r) => r.representation === repr);
}

export default function Studies({ studies }: { studies: GraphStudy[] }) {
  if (studies.length === 0) {
    return (
      <section className="section" id="studies">
        <div className="container">
          <p className="eyebrow">Case studies</p>
          <h2 className="section__title">No results yet.</h2>
          <p className="section__lead">
            Run <code className="mono">graphman study</code> on the course graphs and rebuild the
            site; the tables fill themselves from studies/results.json.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="section" id="studies">
      <div className="container">
        <Reveal>
          <p className="eyebrow">Case studies</p>
          <h2 className="section__title">Measured, not estimated.</h2>
          <p className="section__lead">
            Six course graphs, from 10 thousand to 4.8 million vertices. Every number below comes
            from <code className="mono">graphman study</code>; memory is the process footprint
            measured in a fresh subprocess per representation, times are wall-clock means over 100
            searches from distinct random roots.
          </p>
        </Reveal>

        <div className={styles.tables}>
          <Table caption="Process memory after loading the graph">
            <thead>
              <tr>
                <th>Graph</th>
                <th className={styles.num}>Vertices</th>
                <th className={styles.num}>Edges</th>
                {REPRESENTATIONS.map((r) => (
                  <th key={r} className={styles.num}>
                    {REPRESENTATION_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{prettyName(s.name)}</th>
                  <td className={`mono ${styles.num}`}>{formatInt(s.vertices)}</td>
                  <td className={`mono ${styles.num}`}>{formatInt(s.edges)}</td>
                  {REPRESENTATIONS.map((r) => {
                    const m = cell(s, r)?.memory;
                    const value = m?.footprint_bytes ?? m?.resident_bytes ?? null;
                    return (
                      <td key={r} className={`mono ${styles.num}`}>
                        {m && !m.feasible ? (
                          <span className={styles.flag} title={m.error ?? 'over budget'}>
                            {formatBytes(m.required_bytes)} needed
                          </span>
                        ) : value !== null ? (
                          formatBytes(value)
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>

          {(['bfs', 'dfs'] as const).map((algo) => (
            <Table key={algo} caption={`Mean ${algo.toUpperCase()} time, 100 searches`}>
              <thead>
                <tr>
                  <th>Graph</th>
                  {REPRESENTATIONS.map((r) => (
                    <th key={r} className={styles.num}>
                      {REPRESENTATION_LABEL[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {studies.map((s) => (
                  <tr key={s.name}>
                    <th scope="row">{prettyName(s.name)}</th>
                    {REPRESENTATIONS.map((r) => {
                      const t = cell(s, r)?.[algo];
                      return (
                        <td key={r} className={`mono ${styles.num}`}>
                          {t ? formatMs(t.mean_ms) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

          <Table caption="Diameter: value and BFS runs per method">
            <thead>
              <tr>
                <th>Graph</th>
                {METHODS.map((m) => (
                  <th key={m} className={styles.num}>
                    {DIAMETER_LABEL[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{prettyName(s.name)}</th>
                  {METHODS.map((m) => {
                    const d = s.diameters.find((x) => x.method === m);
                    if (!d) {
                      return (
                        <td key={m} className={`mono ${styles.num}`}>
                          —
                        </td>
                      );
                    }
                    const flagged = !d.is_exact || d.cancelled;
                    return (
                      <td key={m} className={`mono ${styles.num}`}>
                        <span className={flagged ? styles.flag : undefined}>
                          {flagged ? '≥ ' : ''}
                          {d.value}
                        </span>
                        <span className={styles.sub}>{formatCompact(d.bfs_count)} BFS</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>

          <Table caption="Components and distances">
            <thead>
              <tr>
                <th>Graph</th>
                <th className={styles.num}>Components</th>
                <th className={styles.num}>Largest</th>
                <th className={styles.num}>Smallest</th>
                <th className={styles.num}>d(10, 20)</th>
                <th className={styles.num}>d(10, 30)</th>
                <th className={styles.num}>d(20, 30)</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{prettyName(s.name)}</th>
                  <td className={`mono ${styles.num}`}>{formatInt(s.components.count)}</td>
                  <td className={`mono ${styles.num}`}>{formatInt(s.components.largest)}</td>
                  <td className={`mono ${styles.num}`}>{formatInt(s.components.smallest)}</td>
                  {s.distances.map((d) => (
                    <td key={`${d.from}-${d.to}`} className={`mono ${styles.num}`}>
                      {d.distance ?? '∞'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className={styles.note}>
          A flagged diameter (≥) is a lower bound: the 4-sweep never certifies, and the exact
          methods were stopped by their time budget on the two largest graphs. Random graphs are the
          worst case for iFUB and the bounding algorithm, and the BFS counts are reported as
          measured.
        </p>
      </div>
    </section>
  );
}
