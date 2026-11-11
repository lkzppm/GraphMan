'use client';

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatInt, formatWeight } from '@/lib/format';
import type { Dictionary } from '@/i18n';
import styles from './Structures.module.css';

/* The structure strip for the two dynamic programmes. Bellman-Ford fills a
   table d_k[v] (the estimate of v after pass k), Floyd-Warshall a matrix
   D_k[i][j] (the distance from i to j through the vertices 1..k). Both are
   read off a trace the library records (every lowering, in order) and
   shown as they stood at the moment the step's vertex got its final
   distance: the replay draws vertices in that order, so the canvas and the
   table move together. A table bigger than the strip is a window that
   follows the step. */

type Strings = Dictionary['observatory'];

/** Bellman-Ford's lowerings, in order: vertex, pass (from 1), new estimate. */
export interface BellmanTrace {
  kind: 'bellman';
  vertices: Uint32Array;
  passes: Uint32Array;
  distances: Float64Array;
  totalPasses: number;
}

/** Floyd-Warshall's D_0 (row-major) and every cell a round lowered. */
export interface FloydTraceData {
  kind: 'floyd';
  n: number;
  initial: Float64Array;
  cells: Uint32Array;
  rounds: Uint32Array;
  after: Float64Array;
}

export type DpTrace = BellmanTrace | FloydTraceData;

/** What the table reads of the search on screen. */
export interface DpSearch {
  root: number;
  order: Uint32Array;
  span: number;
}

interface Link {
  hovered: number;
  onHover: (v: number) => void;
  onSelect: (v: number) => void;
}

/** Compressed rows: the changes of one vertex (Bellman-Ford) or one cell
    (Floyd-Warshall), as indices into the trace, in order. */
interface Index {
  offsets: Uint32Array;
  items: Uint32Array;
}

function group(keys: Uint32Array, count: number): Index {
  const offsets = new Uint32Array(count + 1);
  for (const k of keys) offsets[k + 1] += 1;
  for (let i = 0; i < count; i++) offsets[i + 1] += offsets[i];
  const items = new Uint32Array(keys.length);
  const at = offsets.slice(0, count);
  keys.forEach((k, i) => {
    items[at[k]++] = i;
  });
  return { offsets, items };
}

/** How many of `items[lo..hi)` pass `ok`, which holds for a prefix. */
function prefix(items: Uint32Array, lo: number, hi: number, ok: (i: number) => boolean): number {
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if (ok(items[mid])) a = mid + 1;
    else b = mid;
  }
  return a;
}

/** A trace made ready to read: grouped by vertex or by cell. */
export interface Prepared {
  trace: DpTrace;
  index: Index;
  /** The vertex count. */
  n: number;
}

export function prepare(trace: DpTrace, n: number): Prepared {
  return trace.kind === 'bellman'
    ? { trace, n, index: group(trace.vertices, n + 1) }
    : { trace, n, index: group(trace.cells, trace.n * trace.n) };
}

/** Bellman-Ford's estimate of `v` after pass `k`, counting only the
    lowerings up to `moment` (an index into the trace, -1 before any). */
function estimate(p: Prepared, root: number, v: number, k: number, moment: number): number {
  const trace = p.trace as BellmanTrace;
  const { offsets, items } = p.index;
  const lo = offsets[v];
  const seen = prefix(items, lo, offsets[v + 1], (i) => i <= moment);
  const upto = prefix(items, lo, seen, (i) => trace.passes[i] <= k);
  if (upto > lo) return trace.distances[items[upto - 1]];
  return v === root ? 0 : Infinity;
}

/** Floyd-Warshall's D[i][j] after round `round`. */
function cellAt(p: Prepared, i: number, j: number, round: number): number {
  const trace = p.trace as FloydTraceData;
  const cell = (i - 1) * trace.n + (j - 1);
  const { offsets, items } = p.index;
  const upto = prefix(items, offsets[cell], offsets[cell + 1], (c) => trace.rounds[c] <= round);
  return upto > offsets[cell] ? trace.after[items[upto - 1]] : trace.initial[cell];
}

/** Whether round `round` lowered D[i][j]. */
function lowered(p: Prepared, i: number, j: number, round: number): boolean {
  const trace = p.trace as FloydTraceData;
  const cell = (i - 1) * trace.n + (j - 1);
  const { offsets, items } = p.index;
  for (let c = offsets[cell]; c < offsets[cell + 1]; c++) {
    if (trace.rounds[items[c]] === round) return true;
  }
  return false;
}

/** The moment the step's vertex got its final distance: a Bellman-Ford
    lowering (its index, -1 for the origin) and the pass it ran in, or the
    Floyd-Warshall round that last lowered the origin's cell for it. */
function momentOf(p: Prepared, search: DpSearch, step: number): { at: number; pass: number } {
  const v = search.order[Math.min(step, search.order.length - 1)] ?? search.root;
  const { offsets, items } = p.index;
  if (p.trace.kind === 'bellman') {
    const last = offsets[v + 1] > offsets[v] ? items[offsets[v + 1] - 1] : -1;
    return { at: last, pass: last >= 0 ? p.trace.passes[last] : 0 };
  }
  const cell = (search.root - 1) * p.trace.n + (v - 1);
  const last = offsets[cell + 1] > offsets[cell] ? items[offsets[cell + 1] - 1] : -1;
  const round = last >= 0 ? p.trace.rounds[last] : 0;
  return { at: round, pass: round };
}

/** The vertices the table is about at the step, for the canvas to ring. */
export function dpMembers(
  p: Prepared,
  search: DpSearch,
  step: number,
): { vertices: number[]; focus: number } {
  const v = search.order[Math.min(step, search.order.length - 1)] ?? search.root;
  if (p.trace.kind === 'bellman') return { vertices: [v], focus: v };
  const { pass: k } = momentOf(p, search, step);
  const vertices = [search.root, v];
  if (k) vertices.push(k);
  return { vertices, focus: v };
}

/** A window of `size` out of `count` (positions 0..count-1) that holds
    `keep` (and `also` when both fit), centred where it can be. */
function windowOf(count: number, size: number, keep: number, also = keep): number {
  if (count <= size) return 0;
  const lo = Math.min(keep, also);
  const hi = Math.max(keep, also);
  const centre = hi - lo < size ? (lo + hi) / 2 : keep;
  return Math.max(0, Math.min(count - size, Math.round(centre - size / 2)));
}

const CELL_W = 52;
const CELL_H = 22;
const LABEL_W = 46;
/** The caption, the column labels and the air around them. */
const CHROME = 74;

/** A value as the table writes it. */
const show = (d: number) => (d === Infinity ? '∞' : formatWeight(d));

export default function DpTable({
  t,
  search,
  step,
  round,
  prepared,
  link,
}: {
  t: Strings;
  search: DpSearch;
  step: number;
  /** Floyd-Warshall's table on its own: the round to show, in place of the
      moment the step's vertex became final. */
  round?: number;
  prepared: Prepared;
  link: Link;
}) {
  const s = t.structures;
  // The table takes the strip's body: as many columns and rows as fit.
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor((box.width - LABEL_W - 36) / CELL_W));
  const rows = Math.max(1, Math.floor((box.height - CHROME) / CELL_H));
  const moment =
    round !== undefined ? { at: round, pass: round } : momentOf(prepared, search, step);
  const v =
    round !== undefined
      ? 0
      : (search.order[Math.min(step, search.order.length - 1)] ?? search.root);

  let caption: ReactNode;
  let rowHead: string;
  let head: { key: number; label: string; vertex: number; mark?: 'focus' | 'pivot' }[];
  let body: {
    key: number;
    label: string;
    vertex: number;
    mark?: 'origin' | 'pivot' | 'current';
    cells: { key: number; value: number; changed: boolean; mark?: 'focus' | 'pivot' }[];
  }[];

  if (prepared.trace.kind === 'bellman') {
    const trace = prepared.trace;
    // Columns: the vertices in the order they became final (the replay's);
    // rows: the passes so far, the one running last.
    const order = search.order.subarray(0, search.span);
    const start = windowOf(order.length, columns, step);
    const shown = Array.from(order.subarray(start, start + columns));
    const last = moment.pass;
    const first = Math.max(0, last - rows + 1);
    head = shown.map((u) => ({
      key: u,
      label: String(u),
      vertex: u,
      mark: u === v ? 'focus' : undefined,
    }));
    rowHead = s.dp.pass;
    body = [];
    for (let k = first; k <= last; k++) {
      body.push({
        key: k,
        label: String(k),
        vertex: 0,
        mark: k === last ? 'current' : undefined,
        cells: shown.map((u) => {
          const value = estimate(prepared, search.root, u, k, moment.at);
          const before = k > 0 ? estimate(prepared, search.root, u, k - 1, moment.at) : value;
          return {
            key: u,
            value,
            changed: k > 0 && value !== before,
            mark: u === v ? 'focus' : undefined,
          };
        }),
      });
    }
    caption = (
      <>
        <span className={`label ${styles.dpTitle}`}>{s.dp.bellmanTitle}</span>
        <span className={`mono ${styles.dpFormula}`}>
          d<sub>k</sub>[v] = min(d<sub>k−1</sub>[v], d<sub>k−1</sub>[u] + w(u, v))
        </span>
        <span className={`mono ${styles.dpMoment}`}>
          {s.dp.passOf(formatInt(last), formatInt(trace.totalPasses))}
        </span>
      </>
    );
  } else {
    const trace = prepared.trace;
    const n = trace.n;
    const k = moment.pass;
    // Rows hold the origin's (and the pivot's, when both fit); columns
    // follow the step's vertex.
    // With no row picked, both follow the pivot.
    const pivot = Math.max(k - 1, 0);
    const anchorRow = search.root ? search.root - 1 : pivot;
    const anchorCol = v ? v - 1 : pivot;
    const rowStart = windowOf(n, rows, anchorRow, k ? k - 1 : anchorRow);
    const colStart = windowOf(n, columns, anchorCol, k ? k - 1 : anchorCol);
    const cols: number[] = [];
    for (let j = colStart + 1; j <= Math.min(n, colStart + columns); j++) cols.push(j);
    head = cols.map((j) => ({
      key: j,
      label: String(j),
      vertex: j,
      mark: j === v ? 'focus' : j === k ? 'pivot' : undefined,
    }));
    rowHead = 'i \\ j';
    body = [];
    for (let i = rowStart + 1; i <= Math.min(n, rowStart + rows); i++) {
      body.push({
        key: i,
        label: String(i),
        vertex: i,
        mark: i === search.root ? 'origin' : i === k ? 'pivot' : undefined,
        cells: cols.map((j) => ({
          key: j,
          value: cellAt(prepared, i, j, k),
          changed: k > 0 && lowered(prepared, i, j, k),
          mark: i === search.root && j === v ? 'focus' : j === k ? 'pivot' : undefined,
        })),
      });
    }
    caption = (
      <>
        <span className={`label ${styles.dpTitle}`}>{s.dp.floydTitle}</span>
        <span className={`mono ${styles.dpFormula}`}>
          D<sub>k</sub>[i][j] = min(D<sub>k−1</sub>[i][j], D<sub>k−1</sub>[i][k] + D<sub>k−1</sub>
          [k][j])
        </span>
        <span className={`mono ${styles.dpMoment}`}>
          {k ? s.dp.roundOf(formatInt(k), formatInt(n)) : s.dp.start}
        </span>
      </>
    );
  }

  return (
    <div ref={ref} className={styles.dp}>
      <div className={styles.dpCaption}>{caption}</div>
      <table className={`mono ${styles.dpTable}`}>
        <thead>
          <tr>
            <th className={styles.dpCorner}>{rowHead}</th>
            {head.map((c) => (
              <th
                key={c.key}
                className={styles.dpHead}
                data-mark={c.mark}
                data-hovered={link.hovered === c.vertex || undefined}
                onPointerEnter={() => link.onHover(c.vertex)}
                onPointerLeave={() => link.onHover(0)}
                onClick={() => link.onSelect(c.vertex)}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r) => (
            <tr key={r.key}>
              <th
                className={styles.dpRowHead}
                data-mark={r.mark}
                onPointerEnter={r.vertex ? () => link.onHover(r.vertex) : undefined}
                onPointerLeave={r.vertex ? () => link.onHover(0) : undefined}
              >
                {r.label}
              </th>
              {r.cells.map((c) => (
                <td
                  key={`${c.key}:${c.value}`}
                  className={styles.dpCell}
                  data-mark={c.mark}
                  data-row={r.mark}
                  data-changed={c.changed || undefined}
                  data-infinite={c.value === Infinity || undefined}
                >
                  {show(c.value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One prepared trace per trace object. */
export function usePrepared(trace: DpTrace | null | undefined, n: number): Prepared | null {
  return useMemo(() => (trace ? prepare(trace, n) : null), [trace, n]);
}
