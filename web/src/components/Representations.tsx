'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useT } from '@/i18n/LocaleProvider';
import { SAMPLE_EDGES, SAMPLE_POSITIONS } from '@/lib/sample';
import styles from './Representations.module.css';

/* One small graph (five vertices, six edges) encoded the three ways the
   library stores a graph, laid straight on the page: the drawing, the list
   and the matrix in a row, CSR under them. One vertex is in focus at a
   time: its row in the list, its row and column in the matrix, its slice
   in CSR, and the vertex itself wherever it appears as a neighbour. The
   focus walks the vertices on its own and follows the pointer while the
   figure is hovered. */

const N = 5;
const EDGES = SAMPLE_EDGES;
/** Where each vertex sits in the drawing (a 200 × 176 box), 0-based here. */
const POSITIONS = SAMPLE_POSITIONS.slice(1);

/** Ascending neighbour rows, as every representation keeps them. */
const ROWS: number[][] = Array.from({ length: N }, () => []);
for (const [u, v] of EDGES) {
  ROWS[u - 1].push(v);
  ROWS[v - 1].push(u);
}
for (const row of ROWS) row.sort((a, b) => a - b);

/** CSR: `OFFSETS[v - 1] .. OFFSETS[v]` is vertex v's slice of `TARGETS`. */
const OFFSETS = ROWS.reduce<number[]>(
  (acc, row) => [...acc, acc[acc.length - 1] + row.length],
  [0],
);
const TARGETS = ROWS.flat();

/** Milliseconds the focus rests on a vertex before moving to the next. */
const PERIOD = 1800;

type State = 'focus' | 'near' | undefined;

export default function Representations() {
  const f = useT().hero.figure;
  const [focus, setFocus] = useState(1);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (hovered || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setFocus((v) => (v % N) + 1), PERIOD);
    return () => clearInterval(id);
  }, [hovered]);

  const row = ROWS[focus - 1];
  const vertexState = (v: number): State =>
    v === focus ? 'focus' : row.includes(v) ? 'near' : undefined;
  const mark = (on: boolean): State => (on ? 'focus' : undefined);
  /** The vertex whose CSR slice holds position k. */
  const ownerOf = (k: number) => OFFSETS.findIndex((o) => o > k);

  return (
    <figure
      className={styles.figure}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className={styles.pieces}>
        <div className={styles.piece}>
          <span className={`label ${styles.pieceLabel}`}>{f.graph}</span>
          <svg viewBox="0 0 200 176" className={styles.graph} aria-hidden="true">
            {EDGES.map(([u, v]) => {
              const [x1, y1] = POSITIONS[u - 1];
              const [x2, y2] = POSITIONS[v - 1];
              return (
                <line
                  key={`${u}-${v}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  data-state={mark(u === focus || v === focus)}
                />
              );
            })}
            {POSITIONS.map(([x, y], i) => (
              <g
                key={i}
                className={styles.vertex}
                data-state={vertexState(i + 1)}
                onPointerEnter={() => setFocus(i + 1)}
              >
                <circle cx={x} cy={y} r={12} />
                <text x={x} y={y} dy="0.35em" textAnchor="middle">
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className={styles.piece}>
          <span className={`label ${styles.pieceLabel}`}>{f.list}</span>
          <ol className={`mono ${styles.list}`}>
            {ROWS.map((neighbours, i) => (
              <li
                key={i}
                className={styles.row}
                data-state={mark(i + 1 === focus)}
                onPointerEnter={() => setFocus(i + 1)}
              >
                <span className={styles.rowHead}>{i + 1}</span>
                <span className={styles.rowSep}>│</span>
                {neighbours.map((v) => (
                  <span key={v} className={styles.item} data-state={mark(v === focus)}>
                    {v}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.piece}>
          <span className={`label ${styles.pieceLabel}`}>{f.matrix}</span>
          <div className={`mono ${styles.matrix}`} style={{ '--n': N } as CSSProperties}>
            <span />
            {ROWS.map((_, j) => (
              <span
                key={`c${j}`}
                className={styles.axis}
                data-state={mark(j + 1 === focus)}
                onPointerEnter={() => setFocus(j + 1)}
              >
                {j + 1}
              </span>
            ))}
            {ROWS.map((neighbours, i) => [
              <span
                key={`r${i}`}
                className={styles.axis}
                data-state={mark(i + 1 === focus)}
                onPointerEnter={() => setFocus(i + 1)}
              >
                {i + 1}
              </span>,
              ...ROWS.map((_, j) => (
                <span
                  key={`${i}-${j}`}
                  className={styles.bit}
                  data-bit={neighbours.includes(j + 1) ? 1 : 0}
                  data-state={mark(i + 1 === focus || j + 1 === focus)}
                  onPointerEnter={() => setFocus(i + 1)}
                />
              )),
            ])}
          </div>
        </div>

        <div className={`${styles.piece} ${styles.pieceWide}`}>
          <span className={`label ${styles.pieceLabel}`}>{f.csr}</span>
          <div className={`mono ${styles.arrays}`}>
            <span className={styles.arrayName}>{f.offsets}</span>
            <span
              className={styles.array}
              style={
                {
                  '--len': OFFSETS.length,
                  width: `${(OFFSETS.length / TARGETS.length) * 100}%`,
                } as CSSProperties
              }
            >
              {OFFSETS.map((offset, i) => (
                <span
                  key={i}
                  className={styles.cell}
                  data-state={mark(i === focus - 1 || i === focus)}
                  onPointerEnter={() => setFocus(Math.min(i + 1, N))}
                >
                  {offset}
                </span>
              ))}
            </span>
            <span className={styles.arrayName}>{f.targets}</span>
            <span className={styles.array} style={{ '--len': TARGETS.length } as CSSProperties}>
              {TARGETS.map((v, k) => (
                <span
                  key={k}
                  className={styles.cell}
                  data-state={mark(k >= OFFSETS[focus - 1] && k < OFFSETS[focus])}
                  onPointerEnter={() => setFocus(ownerOf(k))}
                >
                  {v}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}
