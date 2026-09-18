'use client';

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { BODY_PATH, HEAD_PATH } from './figure-path';
import styles from './HeroMark.module.css';

/* The mark, drawn live: the same geometry as public/brand/graphman.svg but
   with every vertex and edge as its own element. The graph builds itself on
   load and breathes while idle; hovering a vertex runs a search wave from
   it; vertices can be dragged and spring back home. */

type Point = readonly [number, number];

const HOME: Point[] = [
  [511, 184],
  [242, 342],
  [512, 354],
  [358, 485],
  [511, 606],
  [241, 671],
  [511, 832],
  // The vertex in the figure's lower hand: the hand's rounded tip sits inside it.
  [600, 495],
];

const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 4],
  [1, 5],
  [3, 5],
  [5, 4],
  [5, 6],
  [4, 6],
  [3, 7],
  [4, 7],
];

/** The stub the figure's upper hand holds (it ends in the hand, not a vertex). */
const STUBS: [number, number, number][] = [[0, 655, 320]];

/** Seconds between two BFS levels of the wave. */
const STEP = 0.16;
const RADIUS = 44;

/** The hexagon as a path that starts mid-edge, so the dashed draw-in has
    its seam on a straight run instead of a notch at a corner. */
const HEXAGON = 'M694.5 184 L878 293 L878 729 L511 947 L144 729 L144 293 L511 75 Z';

/** The hexagon's 40-unit border as a filled band (outer minus inner
    outline, evenodd): the head sits in front of the border, and its white
    gap is drawn only inside this band. */
const BAND =
  'M511 51.7 L898 281.6 L898 740.4 L511 970.3 L124 740.4 L124 281.6 Z M511 98.3 L858 304.4 L858 717.6 L511 923.7 L164 717.6 L164 304.4 Z';

/** The figure's legs were traced up to the border; these run them on under
    it so no seam shows at the inner edge. */
const LEGS =
  'M629 850 L690 815 L690 863.9 L629 900.1 Z M786.7 757.6 L840.1 725.9 L861.5 762 L808.2 793.7 Z';

/** BFS levels from `root` over the seven vertices (the wave's timing). */
function levelsFrom(root: number): number[] {
  const levels = HOME.map(() => -1);
  levels[root] = 0;
  const queue = [root];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const [a, b] of EDGES) {
      const v = a === u ? b : b === u ? a : -1;
      if (v >= 0 && levels[v] < 0) {
        levels[v] = levels[u] + 1;
        queue.push(v);
      }
    }
  }
  return levels;
}

const INTRO = levelsFrom(0);

export default function HeroMark({ size = 260 }: { size?: number }) {
  const card = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Point[]>(HOME);
  const [root, setRoot] = useState(0);
  const [hot, setHot] = useState(-1);
  const drag = useRef<{ vertex: number; frame: number }>({ vertex: -1, frame: 0 });

  const levels = useMemo(() => levelsFrom(root), [root]);

  /** Pointer position in viewBox units (the card is square). */
  const toLocal = (event: PointerEvent): Point => {
    const rect = card.current!.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * 1024,
      ((event.clientY - rect.top) / rect.height) * 1024,
    ];
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current.vertex < 0) return;
    const [x, y] = toLocal(event);
    const v = drag.current.vertex;
    setPositions((p) =>
      p.map((q, i) =>
        i === v ? [Math.min(940, Math.max(84, x)), Math.min(940, Math.max(84, y))] : q,
      ),
    );
  };

  const onLeave = () => {
    setRoot(0);
    setHot(-1);
  };

  /** Starts dragging the vertex whose circle carries `data-vertex`. */
  const grab = (event: PointerEvent<SVGCircleElement>) => {
    if (event.button !== 0) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current.vertex = Number(event.currentTarget.dataset.vertex);
    card.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  /** Release: the vertex springs back home over 600 ms. */
  const release = () => {
    const v = drag.current.vertex;
    if (v < 0) return;
    drag.current.vertex = -1;
    let start: number | null = null;
    let from: Point | null = null;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / 600);
      // A damped spring: overshoots once, then settles.
      const s = 1 - Math.exp(-6 * t) * Math.cos(9 * t);
      setPositions((p) => {
        from ??= p[v];
        const [fx, fy] = from;
        const [hx, hy] = HOME[v];
        return p.map((q, i) => (i === v ? [fx + (hx - fx) * s, fy + (hy - fy) * s] : q));
      });
      if (t < 1) drag.current.frame = requestAnimationFrame(tick);
    };
    drag.current.frame = requestAnimationFrame(tick);
  };

  const delay = (level: number) => ({ '--d': `${level * STEP}s` }) as CSSProperties;

  return (
    <div
      ref={card}
      className={styles.card}
      style={{ width: size, height: size }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onPointerUp={release}
      onPointerCancel={release}
      data-mark
    >
      <svg
        viewBox="0 0 1024 1024"
        className={styles.svg}
        data-wave={hot >= 0 ? 'true' : undefined}
        role="img"
        aria-label="GraphMan"
      >
        <defs>
          <clipPath id="hero-band" clipRule="evenodd">
            <path d={BAND} />
          </clipPath>
        </defs>
        {/* Layers, bottom to top: the body (its legs end beneath the border),
            the hexagon, the graph (so dragged vertices cross the border), the
            head (over the border, with a white gap). */}
        <g className={styles.figure}>
          <path fillRule="evenodd" d={BODY_PATH} />
          <path d={LEGS} />
        </g>
        {/* Two hexagons: one draws itself in and fades, one static takes over
            (a dashed stroke has no join at its ends). */}
        <path className={styles.hexagonDraw} d={HEXAGON} pathLength={1} />
        <path className={styles.hexagon} d={HEXAGON} />
        <g>
          {EDGES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              className={`${styles.edge} ${hot === a || hot === b ? styles.edgeHot : ''}`}
              style={delay(Math.max(INTRO[a], INTRO[b]))}
              x1={positions[a][0]}
              y1={positions[a][1]}
              x2={positions[b][0]}
              y2={positions[b][1]}
              pathLength={1}
            />
          ))}
          {STUBS.map(([a, x, y]) => (
            <line
              key={`stub-${a}`}
              className={`${styles.edge} ${hot === a ? styles.edgeHot : ''}`}
              style={delay(INTRO[a] + 1)}
              x1={positions[a][0]}
              y1={positions[a][1]}
              x2={x}
              y2={y}
              pathLength={1}
            />
          ))}
        </g>
        {/* The wave: bright edge copies and halos, remounted when the root
            changes so the animation restarts from the new vertex. */}
        <g key={root} className={styles.wave}>
          {EDGES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              className={styles.edgeFlash}
              style={delay(Math.max(levels[a], levels[b]))}
              x1={positions[a][0]}
              y1={positions[a][1]}
              x2={positions[b][0]}
              y2={positions[b][1]}
              pathLength={1}
            />
          ))}
          {positions.map(([x, y], i) => (
            <circle
              key={i}
              className={styles.halo}
              style={delay(levels[i])}
              cx={x}
              cy={y}
              r={RADIUS}
            />
          ))}
        </g>
        <g>
          {positions.map(([x, y], i) => (
            <circle
              key={i}
              className={styles.node}
              style={{ ...delay(INTRO[i]), '--i': `${i * 0.37}s` } as CSSProperties}
              cx={x}
              cy={y}
              r={hot === i ? RADIUS * 1.3 : RADIUS}
              onPointerEnter={() => {
                if (drag.current.vertex < 0) {
                  setHot(i);
                  setRoot(i);
                }
              }}
              onPointerLeave={() => {
                if (drag.current.vertex < 0) setHot(-1);
              }}
              data-vertex={i}
              onPointerDown={grab}
            />
          ))}
        </g>
        {/* The head, over the border, with a white gap where it crosses it. */}
        <g className={styles.figure}>
          <path className={styles.gap} clipPath="url(#hero-band)" d={HEAD_PATH} />
          <path d={HEAD_PATH} />
        </g>
      </svg>
    </div>
  );
}
