import type { Edge } from '@/lib/sample';
import { UNREACHED } from '@/lib/sample';
import styles from './GraphFigure.module.css';

/* A small graph drawn from given positions (the same units and look as
   the home's three-representations figure), with whatever the chapter wants
   to show on top: tree edges, levels, a path, components, marked vertices. */

/** Room around the drawing, in the positions' units, and how many pixels
    one unit takes: the same as the home's figure, so both look alike. */
const PAD = 16;
const PX_PER_UNIT = 1.35;

/** The level ramp, from the origin's navy to the far end's light blue. */
const LEVEL_FROM = [0x00, 0x2f, 0x66];
const LEVEL_TO = [0xa9, 0xdc, 0xff];

function levelColour(level: number, max: number): string {
  const t = max === 0 ? 0 : level / max;
  const c = LEVEL_FROM.map((a, i) => Math.round(a + (LEVEL_TO[i] - a) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Component k's blue: the largest solid, the rest lighter and lighter. */
function componentColour(k: number): string {
  const share = Math.max(18, 100 - (k - 1) * 22);
  return `color-mix(in srgb, var(--accent) ${share}%, white)`;
}

interface Props {
  edges: Edge[];
  /** Position per vertex, index 0 unused; any units, the box is fitted. */
  positions: [number, number][];
  /** Level per vertex (UNREACHED for unreached): colours the vertices. */
  levels?: number[];
  /** Parent per vertex: draws the tree edges in blue. */
  parents?: number[];
  /** Vertices in order along a path: drawn as a thick blue line. */
  path?: number[];
  /** Component id per vertex: colours the vertices by component. */
  components?: number[];
  /** Vertices to ring in blue. */
  marks?: number[];
}

export default function GraphFigure({
  edges,
  positions,
  levels,
  parents,
  path,
  components,
  marks,
}: Props) {
  const n = positions.length - 1;
  const xs = positions.slice(1).map((p) => p[0]);
  const ys = positions.slice(1).map((p) => p[1]);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const width = Math.max(...xs) + PAD - minX;
  const height = Math.max(...ys) + PAD - minY;
  const pos = positions;

  const maxLevel = levels ? Math.max(0, ...levels.filter((l) => l !== UNREACHED)) : 0;
  const onPath = new Set<string>();
  if (path) for (let i = 1; i < path.length; i++) onPath.add(key(path[i - 1], path[i]));
  const marked = new Set(marks ?? []);
  const coloured = components !== undefined || levels !== undefined;

  const fill = (v: number) => {
    if (components) return componentColour(components[v]);
    if (levels)
      return levels[v] === UNREACHED ? 'var(--node-dim)' : levelColour(levels[v], maxLevel);
    return 'var(--bg)';
  };
  const isTree = (u: number, v: number) =>
    parents !== undefined && (parents[u] === v || parents[v] === u);

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className={styles.figure}
      style={{ width: width * PX_PER_UNIT }}
      aria-hidden="true"
    >
      {edges.map(([u, v]) => (
        <line
          key={`${u}-${v}`}
          x1={pos[u][0]}
          y1={pos[u][1]}
          x2={pos[v][0]}
          y2={pos[v][1]}
          className={styles.edge}
          data-kind={onPath.has(key(u, v)) ? 'path' : isTree(u, v) ? 'tree' : undefined}
        />
      ))}
      {Array.from({ length: n }, (_, i) => i + 1).map((v) => (
        <g key={v} className={styles.vertex} data-marked={marked.has(v) || undefined}>
          <circle
            cx={pos[v][0]}
            cy={pos[v][1]}
            r={12}
            style={{ fill: fill(v) }}
            data-coloured={coloured || undefined}
          />
          <text
            x={pos[v][0]}
            y={pos[v][1]}
            dy="0.35em"
            textAnchor="middle"
            data-light={(coloured && levels?.[v] !== UNREACHED) || undefined}
          >
            {v}
          </text>
        </g>
      ))}
    </svg>
  );
}

function key(u: number, v: number) {
  return u < v ? `${u}-${v}` : `${v}-${u}`;
}
