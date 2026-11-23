'use client';

// Part 3's last measured slide: the three ways to all pairs as curves of n,
// the arcs m on a slider. The costs are operation counts with no constants;
// the switch trades Bellman-Ford's worst case for the scans a vertex the
// studies measured.
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { formatCompact, formatInt } from '@/lib/format';
import { findCell, stoppedAtCycle, type DirectedStudy } from '@/lib/studies';
import { at, Head, type T } from './deck-kit';
import styles from './Deck.module.css';

const M_MAX = 100;

const W = 860;
const H = 470;
const PAD = { l: 52, r: 14, t: 12, b: 34 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The part of the plane on show: n across, operations up. Both start at the
    origin or right of it, and zoom by the same factor. */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
const HOME: View = { x: 0, y: 0, w: 70, h: 5500 };
const ZOOM_IN = 1 / 40;
const ZOOM_OUT = 30;

/** `view` scaled by `k`, the point at the fractions `fx`, `fy` (from the
    bottom left) kept in place. */
function zoomed(view: View, k: number, fx: number, fy: number): View {
  const scale = Math.min(ZOOM_OUT, Math.max(ZOOM_IN, (view.w / HOME.w) * k));
  const w = HOME.w * scale;
  const h = HOME.h * scale;
  return {
    x: Math.max(0, view.x + (view.w - w) * fx),
    y: Math.max(0, view.y + (view.h - h) * fy),
    w,
    h,
  };
}

/** Round marks (1, 2 or 5 times a power of ten) across a span. */
function ticks(from: number, size: number, target: number): number[] {
  const raw = size / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = power * (raw / power < 1.5 ? 1 : raw / power < 3.5 ? 2 : raw / power < 7.5 ? 5 : 10);
  const marks: number[] = [];
  for (let i = Math.ceil(from / step - 1e-9); i * step <= from + size + step * 1e-6; i++)
    marks.push(Number((i * step).toPrecision(10)));
  return marks;
}

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

/** The curve across the view, until just past its top (every cost grows with n). */
function curve(
  key: Key,
  m: number,
  c: number | null,
  view: View,
  px: (n: number) => number,
  py: (cost: number) => number,
): string {
  const points: string[] = [];
  const from = Math.max(1, view.x);
  const step = view.w / 400;
  for (let n = from; n <= view.x + view.w + step; n += step) {
    const y = cost(key, n, m, c);
    points.push(`${px(n)},${py(y)}`);
    if (y > view.y + view.h) break;
  }
  return points.length > 1 ? `M${points.join('L')}` : '';
}

/** Where two of the curves cross, from n = 1 to `to`: a sign change on a grid
    even in log n (the crossings crowd near the origin), then bisection. */
function crossings(
  m: number,
  c: number | null,
  to: number,
): { n: number; v: number; id: string }[] {
  const found: { n: number; v: number; id: string }[] = [];
  const STEPS = 600;
  KEYS.forEach((a, i) =>
    KEYS.slice(i + 1).forEach((b) => {
      const gap = (n: number) => cost(a, n, m, c) - cost(b, n, m, c);
      let last = 1;
      let before = gap(last);
      const push = (n: number) =>
        found.push({ n, v: cost(a, n, m, c), id: `${a}-${b}-${found.length}` });
      if (before === 0) push(1);
      for (let k = 1; k <= STEPS; k++) {
        const next = to ** (k / STEPS);
        const after = gap(next);
        if (before !== 0 && (after === 0 || before > 0 !== after > 0)) {
          let lo = last;
          let hi = next;
          for (let j = 0; j < 40; j++) {
            const mid = (lo + hi) / 2;
            if (gap(mid) > 0 === before > 0) lo = mid;
            else hi = mid;
          }
          push(hi);
        }
        last = next;
        before = after;
      }
    }),
  );
  return found;
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

/** Where a pointer is in the drawing's own units: it keeps its ratio inside
    its box, centred. */
function place(el: SVGSVGElement, event: { clientX: number; clientY: number }): [number, number] {
  const box = el.getBoundingClientRect();
  const k = Math.min(box.width / W, box.height / H);
  return [
    (event.clientX - box.left - (box.width - W * k) / 2) / k,
    (event.clientY - box.top - (box.height - H * k) / 2) / k,
  ];
}

export function Curves({ t, studies }: { t: T; studies: DirectedStudy[] }) {
  const s = t.presentation.slides.part3.curves;
  const [m, setM] = useState(10);
  const [n, setN] = useState(20);
  const [practice, setPractice] = useState(false);
  const [view, setView] = useState(HOME);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; view: View } | null>(null);
  const plot = useRef<SVGSVGElement>(null);
  const px = (v: number) => r2(PAD.l + ((v - view.x) / view.w) * IW);
  const py = (v: number) => r2(PAD.t + IH - ((v - view.y) / view.h) * IH);
  const measured = measuredScans(studies);
  const scans = measured?.scans ?? null;
  const c = practice ? scans : null;
  const cText = scans === null ? '' : scans.toFixed(2);

  const values = KEYS.map((key) => ({ key, v: cost(key, n, m, c) }));
  const least = Math.min(...values.map((x) => x.v));

  // A simple digraph has at most n(n − 1) arcs, and one where every vertex
  // reaches every other has at least n: the n the m arcs allow.
  const low = (1 + Math.sqrt(1 + 4 * m)) / 2;
  const left = Math.max(PAD.l, px(low));
  const right = Math.min(W - PAD.r, px(m));

  const crossed = crossings(m, c, view.x + view.w).filter(
    (p) => p.n >= view.x && p.v >= view.y && p.v <= view.y + view.h,
  );

  // The wheel (or a trackpad pinch) zooms at the pointer. React's own wheel
  // handler cannot stop the page from scrolling, so the listener is native.
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const [x, y] = place(el, event);
      const speed = event.ctrlKey ? 0.012 : event.deltaMode === 1 ? 0.05 : 0.002;
      const k = Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY * speed)));
      setView((v) => zoomed(v, k, (x - PAD.l) / IW, (PAD.t + IH - y) / IH));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const [x, y] = place(event.currentTarget, event);
    const start = drag.current;
    if (start) {
      if (start.id !== event.pointerId) return;
      setView({
        ...start.view,
        x: Math.max(0, start.view.x - ((x - start.x) / IW) * start.view.w),
        y: Math.max(0, start.view.y + ((y - start.y) / IH) * start.view.h),
      });
      return;
    }
    setN(Math.max(2, Math.round(view.x + ((x - PAD.l) / IW) * view.w)));
  };

  const onDown = (event: PointerEvent<SVGSVGElement>) => {
    // A swipe here moves the plot, not the deck.
    event.stopPropagation();
    if (event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = place(event.currentTarget, event);
    drag.current = { id: event.pointerId, x, y, view };
    setDragging(true);
  };

  const onEnd = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
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
                <b className="mono">{v >= 1e7 ? formatCompact(v) : formatInt(v)}</b>
              </li>
            ))}
          </ul>
          <p className={styles.curveCaption}>{s.at(String(n))}</p>
        </div>

        <div className={`${styles.curveBox} ${styles.rise}`} style={at(0.35)}>
          <svg
            ref={plot}
            viewBox={`0 0 ${W} ${H}`}
            className={styles.curvePlot}
            data-dragging={dragging || undefined}
            role="img"
            aria-label={s.plot}
            onPointerMove={onMove}
            onPointerDown={onDown}
            onPointerUp={onEnd}
            onPointerCancel={onEnd}
            onDoubleClick={() => setView(HOME)}
          >
            <clipPath id="curves-clip">
              <rect x={PAD.l} y={PAD.t} width={IW} height={IH} />
            </clipPath>
            {/* Takes the pointer where nothing is drawn. */}
            <rect width={W} height={H} fill="transparent" />
            {right > left && (
              <g className={styles.curveZone}>
                <rect x={left} y={PAD.t} width={r2(right - left)} height={IH} />
                <text x={right - 6} y={PAD.t + 16} textAnchor="end">
                  {right - left > 200 ? s.zone : ''}
                </text>
              </g>
            )}
            {ticks(view.y, view.h, 11).map((v) => (
              <g key={v} className={styles.curveGrid}>
                <line x1={PAD.l} x2={W - PAD.r} y1={py(v)} y2={py(v)} />
                <text x={PAD.l - 8} y={py(v)} dy="0.32em" textAnchor="end">
                  {formatCompact(v)}
                </text>
              </g>
            ))}
            {ticks(view.x, view.w, 8).map((v) => (
              <g key={v} className={styles.curveGrid}>
                <line x1={px(v)} x2={px(v)} y1={PAD.t} y2={PAD.t + IH} />
                <text x={px(v)} y={H - 18} textAnchor="middle">
                  {formatCompact(v)}
                </text>
              </g>
            ))}
            <text x={W - PAD.r} y={H - 3} textAnchor="end" className={styles.curveAxis}>
              {s.axis}
            </text>
            <g clipPath="url(#curves-clip)">
              <line
                x1={px(n)}
                x2={px(n)}
                y1={PAD.t}
                y2={PAD.t + IH}
                className={styles.curveCursor}
              />
              {KEYS.map((key) => (
                <path
                  key={key}
                  d={curve(key, m, c, view, px, py)}
                  className={styles.curveLine}
                  style={{ stroke: COLOUR[key] }}
                />
              ))}
              {crossed.map((p) => (
                <g key={p.id} className={styles.curveCross}>
                  <circle cx={px(p.n)} cy={py(p.v)} r={5} />
                  {p.n >= 2 && (
                    <text x={px(p.n) + 10} y={py(p.v) + 14}>
                      {s.cross(p.n.toFixed(1))}
                    </text>
                  )}
                </g>
              ))}
              {values.map(
                ({ key, v }) =>
                  v >= view.y &&
                  v <= view.y + view.h && (
                    <circle key={key} cx={px(n)} cy={py(v)} r={5} style={{ fill: COLOUR[key] }} />
                  ),
              )}
            </g>
          </svg>
          <div className={styles.curveTools} onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={s.tools.zoomIn}
              title={s.tools.zoomIn}
              onClick={() => setView((v) => zoomed(v, 1 / 1.5, 0.5, 0.5))}
            >
              <ZoomIn size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={s.tools.zoomOut}
              title={s.tools.zoomOut}
              onClick={() => setView((v) => zoomed(v, 1.5, 0.5, 0.5))}
            >
              <ZoomOut size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={s.tools.reset}
              title={s.tools.reset}
              onClick={() => setView(HOME)}
            >
              <Maximize2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(0.6)}>
        <p className={styles.note}>
          {practice ? s.notes.practice(cText, measured?.name ?? '') : s.notes.worst}
        </p>
      </div>
    </div>
  );
}
