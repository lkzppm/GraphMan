import type { CSSProperties } from 'react';
import styles from './RepresentationPicto.module.css';

/** The library's three storage strategies. */
export type ReprKind = 'list' | 'matrix' | 'csr';

/** The order the wasm `RepresentationKind` declares, so the value is the index. */
export const REPR_KINDS: readonly ReprKind[] = ['list', 'matrix', 'csr'];

/** Stagger for a mark, read by whichever stylesheet animates the picto. */
const at = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties;

/** An adjacency list: a column of vertices, each with its row of neighbours. */
function List({ delay }: { delay: number }) {
  const rows = [4, 2, 3, 1];
  return rows.map((count, r) => {
    const y = 10 + r * 15;
    return (
      <g key={r}>
        <rect
          data-mark="head"
          style={at(delay + r * 0.06)}
          x="6"
          y={y - 5}
          width="10"
          height="10"
          rx="2"
        />
        <line
          data-mark="link"
          style={at(delay + 0.1 + r * 0.06)}
          x1="16"
          y1={y}
          x2={22 + count * 14}
          y2={y}
          pathLength={1}
        />
        {Array.from({ length: count }, (_, i) => (
          <circle
            key={i}
            data-mark="dot"
            style={at(delay + 0.2 + r * 0.06 + i * 0.05)}
            cx={28 + i * 14}
            cy={y}
            r="3.6"
          />
        ))}
      </g>
    );
  });
}

/** A bit matrix: a symmetric grid with a few bits set. */
function Matrix({ delay }: { delay: number }) {
  const n = 6;
  const set = new Set(['0-1', '0-3', '1-2', '2-4', '3-4', '4-5', '1-5']);
  const on = (i: number, j: number) => set.has(`${i}-${j}`) || set.has(`${j}-${i}`);
  return Array.from({ length: n * n }, (_, k) => {
    const i = Math.floor(k / n);
    const j = k % n;
    return (
      <rect
        key={k}
        data-mark={on(i, j) ? 'bit-on' : 'bit'}
        style={at(delay + (i + j) * 0.04)}
        x={20 + j * 9.5}
        y={4 + i * 9.5}
        width="8"
        height="8"
        rx="1.5"
      />
    );
  });
}

/** Compressed sparse row: a short array of offsets over a long array of
    neighbours, each offset pointing at where its row starts. */
function Csr({ delay }: { delay: number }) {
  const offsets = [0, 3, 5, 8];
  const width = 9;
  return (
    <>
      {offsets.map((_, i) => (
        <rect
          key={`o${i}`}
          data-mark="head"
          style={at(delay + i * 0.05)}
          x={14 + i * 14}
          y="8"
          width="10"
          height="10"
          rx="2"
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={`n${i}`}
          data-mark="cell"
          style={at(delay + 0.3 + i * 0.04)}
          x={6 + i * width}
          y="42"
          width={width - 1.5}
          height="10"
          rx="1.5"
        />
      ))}
      {offsets.slice(0, 3).map((o, i) => (
        <line
          key={`l${i}`}
          data-mark="link"
          style={at(delay + 0.5 + i * 0.08)}
          x1={19 + i * 14}
          y1="18"
          x2={6 + o * width + (width - 1.5) / 2}
          y2="42"
          pathLength={1}
        />
      ))}
    </>
  );
}

/**
 * One storage strategy drawn as it is stored. The deck's architecture slide
 * and the observatory's picker share these marks, so the drawing lives here
 * once and each page's stylesheet decides whether it animates in.
 */
export default function RepresentationPicto({
  kind,
  delay = 0,
  className,
}: {
  kind: ReprKind;
  delay?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 96 64"
      className={className ? `${styles.picto} ${className}` : styles.picto}
      aria-hidden="true"
    >
      {kind === 'list' ? (
        <List delay={delay} />
      ) : kind === 'matrix' ? (
        <Matrix delay={delay} />
      ) : (
        <Csr delay={delay} />
      )}
    </svg>
  );
}
