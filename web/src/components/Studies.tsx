'use client';

import { formatBytes, formatCompact, formatInt, formatMs, graphNumber } from '@/lib/format';
import type { DiameterMethod, GraphStudy, Representation } from '@/lib/studies';
import { useT } from '@/i18n/LocaleProvider';
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
  const t = useT();
  const name = (study: GraphStudy) => t.studies.graph(graphNumber(study.name));
  if (studies.length === 0) {
    return (
      <section className="section" id="studies">
        <div className="container">
          <p className="eyebrow">{t.studies.eyebrow}</p>
          <h2 className="section__title">{t.studies.emptyTitle}</h2>
          <p className="section__lead">{t.studies.emptyLead}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section" id="studies">
      <div className="container">
        <Reveal>
          <p className="eyebrow">{t.studies.eyebrow}</p>
          <h2 className="section__title">{t.studies.title}</h2>
          <p className="section__lead">{t.studies.lead}</p>
        </Reveal>

        <div className={styles.tables}>
          <Table caption={t.studies.memoryCaption}>
            <thead>
              <tr>
                <th>{t.studies.columns.graph}</th>
                <th className={styles.num}>{t.studies.columns.vertices}</th>
                <th className={styles.num}>{t.studies.columns.edges}</th>
                {REPRESENTATIONS.map((r) => (
                  <th key={r} className={styles.num}>
                    {t.studies.representations[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{name(s)}</th>
                  <td className={`mono ${styles.num}`}>{formatInt(s.vertices)}</td>
                  <td className={`mono ${styles.num}`}>{formatInt(s.edges)}</td>
                  {REPRESENTATIONS.map((r) => {
                    const m = cell(s, r)?.memory;
                    const value = m?.footprint_bytes ?? m?.resident_bytes ?? null;
                    return (
                      <td key={r} className={`mono ${styles.num}`}>
                        {m && !m.feasible ? (
                          <span className={styles.flag} title={m.error ?? t.studies.overBudget}>
                            {t.studies.needed(formatBytes(m.required_bytes))}
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
            <Table key={algo} caption={t.studies.timeCaption(algo.toUpperCase())}>
              <thead>
                <tr>
                  <th>{t.studies.columns.graph}</th>
                  {REPRESENTATIONS.map((r) => (
                    <th key={r} className={styles.num}>
                      {t.studies.representations[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {studies.map((s) => (
                  <tr key={s.name}>
                    <th scope="row">{name(s)}</th>
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

          <Table caption={t.studies.diameterCaption}>
            <thead>
              <tr>
                <th>{t.studies.columns.graph}</th>
                {METHODS.map((m) => (
                  <th key={m} className={styles.num}>
                    {t.studies.methods[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{name(s)}</th>
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
                        <span className={styles.sub}>
                          {t.studies.bfsRuns(formatCompact(d.bfs_count))}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>

          <Table caption={t.studies.componentsCaption}>
            <thead>
              <tr>
                <th>{t.studies.columns.graph}</th>
                <th className={styles.num}>{t.studies.columns.components}</th>
                <th className={styles.num}>{t.studies.columns.largest}</th>
                <th className={styles.num}>{t.studies.columns.smallest}</th>
                <th className={styles.num}>d(10, 20)</th>
                <th className={styles.num}>d(10, 30)</th>
                <th className={styles.num}>d(20, 30)</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{name(s)}</th>
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
        <p className={styles.note}>{t.studies.note}</p>
      </div>
    </section>
  );
}
