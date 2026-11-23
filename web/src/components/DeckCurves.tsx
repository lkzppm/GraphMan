'use client';

// Part 3's last measured slide: the three ways to all pairs as curves of n,
// the arcs m on a slider. The costs are operation counts with no constants;
// the switch trades Bellman-Ford's worst case for the scans a vertex the
// studies measured.
import { useState, type CSSProperties, type PointerEvent } from 'react';
import { formatInt } from '@/lib/format';
import { findCell, stoppedAtCycle, type DirectedStudy } from '@/lib/studies';
import { at, Head, type T } from './deck-kit';
import styles from './Deck.module.css';

const N_MAX = 70;
const COST_MAX = 5500;
const M_MAX = 100;

const W = 860;
const H = 470;
const PAD = { l: 52, r: 14, t: 12, b: 34 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const r2 = (v: number) => Math.round(v * 100) / 100;
const px = (n: number) => r2(PAD.l + (n / N_MAX) * IW);
const py = (cost: number) => r2(PAD.t + IH - (cost / COST_MAX) * IH);

type Key = 'bellman' | 'dijkstra' | 'floyd';
const KEYS: Key[] = ['bellman', 'dijkstra', 'floyd'];
const COLOUR: Record<Key, string> = {
  bellman: 'var(--queue-heap)',
  dijkstra: 'var(--queue-quad-heap)',
  floyd: 'var(--queue-vector)',
};

/** The cost of all pairs; `c` is the measured scans a vertex, or `null` for
    Bellman-Ford's worst case (every vertex scanned in each of n passes). */
function cost(key: Key, n: number, m: number, c: number | null): number {
  if (key === 'floyd') return n ** 3;
  if (key === 'dijkstra') return n <= 1 ? 0 : n * (n + m) * Math.log2(n);
  return c === null ? n * n * m : c * n * m;
}

/** The curve from n = 1 until just past the top of the plot. */
function curve(key: Key, m: number, c: number | null): string {
  const points: string[] = [];
  for (let n = 1; n <= N_MAX; n += 0.25) {
    const y = cost(key, n, m, c);
    points.push(`${px(n)},${py(Math.min(y, COST_MAX * 3))}`);
    if (y > COST_MAX * 1.2) break;
  }
  return `M${points.join('L')}`;
}

/** The scans a vertex of a queue Bellman-Ford, from the smallest graph whose
    all-pairs run was measured to the end without a negative cycle. */
function measuredScans(studies: DirectedStudy[]): { scans: number; name: string } | null {
  for (const study of studies) {
    const cell = findCell(study.all_pairs, 'bellman-ford-all', 'queue');
    if (cell?.timing && cell.counts && !stoppedAtCycle(cell))
      return {
        scans: cell.counts.scans / Math.max(1, study.vertices),
        name: study.name.replace(/^grafo_W_/, 'W'),
      };
  }
  return null;
}

export function Curves({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.curves;
  const [m, setM] = useState(10);
  const [n, setN] = useState(20);
  const [practice, setPractice] = useState(false);
  const measured = measuredScans(studies);
  const scans = measured?.scans ?? null;
  const c = practice ? scans : null;
  const cText = scans === null ? '' : scans.toFixed(2);

  const values = KEYS.map((key) => ({ key, v: cost(key, n, m, c) }));
  const least = Math.min(...values.map((x) => x.v));

  // A simple digraph has at most n(n − 1) arcs, and one where every vertex
  // reaches every other has at least n: the n the m arcs allow.
  const low = (1 + Math.sqrt(1 + 4 * m)) / 2;
  const high = Math.min(N_MAX, m);

  const read = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // The drawing keeps its ratio inside the box, centred.
    const k = Math.min(box.width / W, box.height / H);
    const x = (event.clientX - box.left - (box.width - W * k) / 2) / k;
    setN(Math.round(Math.min(N_MAX, Math.max(2, ((x - PAD.l) / IW) * N_MAX))));
  };

  return (
    <div className={styles.body}>
      <div className={styles.benchHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        {scans !== null && (
          <span
            className={`label ${styles.scaleSwitch} ${styles.curveSwitch} ${styles.rise}`}
            role="group"
            aria-label={s.modes.label}
            style={{ ...at(0.2), '--i': practice ? 1 : 0 } as CSSProperties}
          >
            <span className={styles.scaleThumb} aria-hidden="true" />
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                type="button"
                className={styles.scaleButton}
                aria-pressed={practice === mode}
                onClick={() => setPractice(mode)}
              >
                {mode ? s.modes.practice : s.modes.worst}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className={styles.curves}>
        <div className={`${styles.curvePanel} ${styles.rise}`} style={at(0.25)}>
          <label className={styles.curveSlider}>
            <span className="mono">m = {m}</span>
            <input
              type="range"
              min={1}
              max={M_MAX}
              value={m}
              aria-label={s.arcs}
              onChange={(event) => setM(Number(event.target.value))}
              // The deck turns the page on arrows and swipes: the slider keeps
              // its own, and gives the arrows back once the pointer lets go.
              onKeyDown={(event) => {
                if (/^(Arrow|Home|End|Page)/.test(event.key)) event.nativeEvent.stopPropagation();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.currentTarget.blur()}
            />
            <span className={styles.curveCaption}>{s.arcs}</span>
          </label>
          <ul className={styles.curveList}>
            {values.map(({ key, v }) => (
              <li key={key} data-least={v === least || undefined}>
                <span
                  className={styles.swatch}
                  style={{ background: COLOUR[key] }}
                  aria-hidden="true"
                />
                <span>
                  {s.names[key]}
                  <i className="mono">
                    {key === 'bellman' && practice ? s.formulas.practice(cText) : s.formulas[key]}
                  </i>
                </span>
                <b className="mono">{formatInt(Math.round(v))}</b>
              </li>
            ))}
          </ul>
          <p className={styles.curveCaption}>{s.at(String(n))}</p>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`${styles.curvePlot} ${styles.rise}`}
          style={at(0.35)}
          role="img"
          aria-label={s.plot}
          onPointerMove={read}
          onPointerDown={(event) => {
            event.stopPropagation();
            read(event);
          }}
        >
          <clipPath id="curves-clip">
            <rect x={PAD.l} y={PAD.t} width={IW} height={IH} />
          </clipPath>
          {high > low && (
            <g className={styles.curveZone}>
              <rect x={px(low)} y={PAD.t} width={r2(px(high) - px(low))} height={IH} />
              <text x={px(high) - 6} y={PAD.t + 16} textAnchor="end">
                {px(high) - px(low) > 170 ? s.zone : ''}
              </text>
            </g>
          )}
          {Array.from({ length: 12 }, (_, i) => i * 500).map((v) => (
            <g key={v} className={styles.curveGrid}>
              <line x1={PAD.l} x2={W - PAD.r} y1={py(v)} y2={py(v)} />
              <text x={PAD.l - 8} y={py(v)} dy="0.32em" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {Array.from({ length: N_MAX / 10 + 1 }, (_, i) => i * 10).map((v) => (
            <g key={v} className={styles.curveGrid}>
              <line x1={px(v)} x2={px(v)} y1={PAD.t} y2={PAD.t + IH} />
              <text x={px(v)} y={H - 14} textAnchor="middle">
                {v}
              </text>
            </g>
          ))}
          <text x={W - PAD.r} y={H - 1} textAnchor="end" className={styles.curveAxis}>
            {s.axis}
          </text>
          <g clipPath="url(#curves-clip)">
            <line x1={px(n)} x2={px(n)} y1={PAD.t} y2={PAD.t + IH} className={styles.curveCursor} />
            {KEYS.map((key) => (
              <path
                key={key}
                d={curve(key, m, c)}
                className={styles.curveLine}
                style={{ stroke: COLOUR[key] }}
              />
            ))}
            {values.map(
              ({ key, v }) =>
                v <= COST_MAX && (
                  <circle key={key} cx={px(n)} cy={py(v)} r={5} style={{ fill: COLOUR[key] }} />
                ),
            )}
          </g>
        </svg>
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(0.6)}>
        <p className={styles.note}>{practice ? s.notes.practice(cText, measured?.name ?? '') : s.notes.worst}</p>
      </div>
    </div>
  );
}
