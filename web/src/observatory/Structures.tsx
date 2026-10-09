'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { formatInt, formatWeight } from '@/lib/format';
import type { Dictionary } from '@/i18n';
import styles from './Structures.module.css';

/* The structure strip: under the canvas, the data structure the search on
   it is using, at the step the replay shows. BFS's queue and DFS's stack
   are read off the finished tree (the queue is a slice of the discovery
   order, the stack the path to the vertex just discovered); Dijkstra's
   frontier is the library's own, replayed to the step by the wasm side and
   read as stored. Cells and heap nodes are keyed by vertex, so a step
   slides what moved instead of redrawing it. */

type Strings = Dictionary['observatory'];

/** What the strip reads of a search (the observatory's `Search` has it all). */
export interface StructureSearch {
  kind: 'bfs' | 'dfs' | 'dijkstra';
  root: number;
  order: Uint32Array;
  parents: Uint32Array;
  levels: Uint32Array;
  depth: number;
  span: number;
  distances: Float64Array | null;
  ranks: Uint32Array;
  frontier: 'vector' | 'heap' | null;
  dfs: 'iterative' | 'recursive' | null;
}

/** Dijkstra's frontier right after one settle, as the wasm side reads it. */
export interface FrontierView {
  step: number;
  /** Entries as stored: heap order, or by vertex for the vector. */
  vertices: Uint32Array;
  estimates: Float64Array;
  total: number;
  /** The estimates that settle lowered: vertex, before, after. */
  relaxed: Uint32Array;
  previous: Float64Array;
  lowered: Float64Array;
}

/** The vertices the structure holds at the step (the ones the strip draws),
    for the canvas to ring, and the one the step is about. */
export interface Members {
  vertices: number[];
  focus: number;
}

export const STRIP_DEFAULT = 220;
export const STRIP_MIN = 120;
const STRIP_MAX = 560;
/** The canvas keeps at least this much height above the strip. */
const STAGE_KEEP = 220;
export const STRIP_HEIGHT_KEY = 'graphman.strip-height';

/** The strip's height kept between the bounds and under the stage's share. */
export function clampStrip(height: number, column: number): number {
  return Math.round(Math.max(STRIP_MIN, Math.min(STRIP_MAX, column - STAGE_KEEP, height)));
}

export function storedStripHeight(): number {
  try {
    const stored = Number(localStorage.getItem(STRIP_HEIGHT_KEY));
    return stored ? Math.max(STRIP_MIN, Math.min(STRIP_MAX, stored)) : STRIP_DEFAULT;
  } catch {
    return STRIP_DEFAULT;
  }
}

/** The most chips a queue or stack draws; the middle of a longer one is a count. */
const MAX_CHIPS = 96;
/** Vertices up to which the vector is drawn whole, one cell per vertex. */
const VECTOR_WHOLE = 120;
/** Entries asked of a frontier: a heap's first five levels, or vector cells. */
const HEAP_LEVELS = 5;
export const FRONTIER_LIMIT = 240;

/** A level's colour: the canvas ramp, the origin's blue to the far end's cyan. */
function rampColour(level: number, depth: number): string {
  const share = depth > 0 ? Math.round(100 - (100 * Math.min(level, depth)) / depth) : 100;
  return `color-mix(in srgb, var(--accent) ${share}%, var(--accent-2))`;
}

function isGap(item: unknown): item is { gap: number } {
  return typeof item === 'object' && item !== null && 'gap' in item;
}

export default function Structures({
  t,
  search,
  reveal,
  playing,
  height,
  columnRef,
  frontierAt,
  hovered,
  onHover,
  onSelect,
  onResize,
  onMembers,
  closing,
  onClosed,
}: {
  t: Strings;
  search: StructureSearch | null;
  reveal: number;
  playing: boolean;
  height: number;
  /** The stage column: its height bounds the strip, and it carries the
      `--strip-height` the drag previews. */
  columnRef: RefObject<HTMLDivElement | null>;
  /** Dijkstra's frontier after the settle `step`, at most `limit` entries;
      `null` when it cannot be replayed. */
  frontierAt: (step: number, limit: number) => FrontierView | null;
  hovered: number;
  onHover: (v: number) => void;
  onSelect: (v: number) => void;
  onResize: (height: number) => void;
  /** Hears what the structure holds whenever the step changes (`null` once
      the strip closes), so the canvas can ring it. */
  onMembers: (members: Members | null) => void;
  /** Shrink away, then call `onClosed`. */
  closing: boolean;
  onClosed: () => void;
}) {
  /** While the strip grows in or shrinks away it clips its content (the
      grip pokes above its edge the rest of the time). */
  const [growing, setGrowing] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const s = t.structures;
  const step = search ? Math.max(0, Math.min(Math.round(reveal), search.span - 1)) : 0;
  const link = { hovered, onHover, onSelect };
  const frontier = useFrontier(
    search?.kind === 'dijkstra' ? search : null,
    step,
    playing,
    frontierAt,
  );

  useEffect(() => {
    onMembers(search ? members(search, step, frontier ?? null) : null);
  }, [search, step, frontier, onMembers]);
  useEffect(() => () => onMembers(null), [onMembers]);

  let title = '';
  let body: ReactNode = <p className={styles.empty}>{s.empty}</p>;

  if (search?.kind === 'bfs') {
    title = s.titles.bfs;
    body = (
      <ArrayView
        search={search}
        step={step}
        link={link}
        title={title}
        analysing={s.analysing}
        ends={[s.front, s.back]}
        sizeLabel={s.queueSize}
        read={(room) => bfsQueue(search, step, room)}
        seams
      />
    );
  } else if (search?.kind === 'dfs') {
    const recursive = search.dfs === 'recursive';
    title = recursive ? s.titles.calls : s.titles.dfs;
    body = (
      <ArrayView
        search={search}
        step={step}
        link={link}
        title={title}
        analysing={s.analysing}
        ends={[s.top, s.bottom]}
        sizeLabel={s.stackSize}
        read={(room) => dfsStack(search, step, room)}
        peek
      />
    );
  } else if (search?.kind === 'dijkstra') {
    title = search.frontier === 'vector' ? s.titles.vector : s.titles.heap;
    const lowered = new Set(frontier?.relaxed ?? []);
    body =
      frontier === undefined ? null : frontier === null ? (
        <p className={styles.empty}>{s.tooLarge}</p>
      ) : search.frontier === 'vector' ? (
        <VectorView
          t={t}
          search={search}
          step={step}
          view={frontier}
          lowered={lowered}
          link={link}
        />
      ) : (
        <HeapView t={t} view={frontier} lowered={lowered} link={link} />
      );
  }

  return (
    <section
      className={styles.strip}
      aria-label={title || s.show}
      data-moving={growing || undefined}
      data-closing={closing || undefined}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (closing) onClosed();
        else setGrowing(false);
      }}
    >
      <StripHandle label={s.resize} height={height} columnRef={columnRef} onCommit={onResize} />
      {search?.kind === 'dijkstra' && (
        <header className={styles.head}>
          <span className={`label ${styles.title}`}>{title}</span>
          <DijkstraHead t={t} search={search} step={step} view={frontier ?? null} />
        </header>
      )}
      <div className={styles.body}>{body}</div>
    </section>
  );
}

/** What the strip draws at `step`, as vertices for the canvas. */
function members(search: StructureSearch, step: number, frontier: FrontierView | null): Members {
  if (search.kind !== 'dijkstra') {
    const held = search.kind === 'bfs' ? bfsQueue(search, step) : dfsStack(search, step);
    const shown = held.items.filter((x): x is number => !isGap(x));
    return { vertices: shown, focus: search.order[step] };
  }
  const vertices = frontier ? Array.from(frontier.vertices) : [];
  let focus = 0;
  if (frontier && search.frontier === 'heap') focus = frontier.vertices[0] ?? 0;
  else if (frontier) {
    // The vector's next minimum: what the next scan will land on.
    let best = Infinity;
    frontier.vertices.forEach((v, i) => {
      const e = frontier.estimates[i];
      if (e < best || (e === best && v < focus)) [best, focus] = [e, v];
    });
  }
  return { vertices, focus };
}

interface Link {
  hovered: number;
  onHover: (v: number) => void;
  onSelect: (v: number) => void;
}

function Gap({ count }: { count: number }) {
  return <span className={`mono ${styles.gap}`}>+{formatInt(count)}</span>;
}

// ---- BFS's queue and DFS's stack --------------------------------------------

/** A queue or a stack as the strip draws it. */
interface Sequence {
  /** The vertex being analysed (0 before the root is). */
  current: number;
  /** How many vertices the structure holds. */
  length: number;
  /** Those vertices from the end it is read at (the queue's front, the
      stack's top), the middle of a long one as a count. */
  items: (number | { gap: number })[];
}

/** BFS's queue right after the discovery of `order[step]`. The library's BFS
    keeps its queue in the discovery order itself: the front is the vertex
    after the one being expanded, the back the last vertex discovered. Only
    the chips drawn are copied, so a queue of a million costs a hundred. */
function bfsQueue(search: StructureSearch, step: number, max = MAX_CHIPS): Sequence {
  if (step === 0) return { current: 0, length: 1, items: [search.root] };
  const current = search.parents[search.order[step]];
  const from = search.ranks[current] + 1;
  const length = step + 1 - from;
  const slice = (a: number, b: number) => Array.from(search.order.subarray(from + a, from + b));
  const tail = Math.max(1, Math.floor(max / 4));
  const items =
    length <= max
      ? slice(0, length)
      : [...slice(0, max - tail - 1), { gap: length - max + 1 }, ...slice(length - tail, length)];
  return { current, length, items };
}

/** Queue cells grow with the strip, between these sizes (px). */
const CELL_MIN = 34;
const CELL_MAX = 64;
/** Room the queue's two end labels and the gaps around it take. */
const LABELS = 150;
/** Air between the strip's edges and the analysing column (and its mirror). */
const GUTTER = 28;
/** The queue's squares against the analysing circle. */
const QUEUE_SCALE = 0.72;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** A queue or a stack as an array of glued cells, centred in the strip,
    its read end on the left next to the vertex being analysed, which has
    its own cell. Every cell is keyed by vertex and slides from where it was
    (FLIP) when the step changes. BFS's queue: the front cell glides into
    the analysing cell, the queue closes up behind it, new vertices come in
    at the back, and the vertex analysed before leaves to the left. DFS's
    stack (`peek`, the analysed vertex stays on top): the vertex pushed
    comes in on the left, the analysing circle grows out of it, and the
    frames popped lift away. */
function ArrayView({
  search,
  step,
  link,
  title,
  analysing,
  ends,
  sizeLabel,
  read,
  seams = false,
  peek = false,
}: {
  search: StructureSearch;
  step: number;
  link: Link;
  title: string;
  analysing: string;
  /** The labels of the left (read) end and the right one. */
  ends: [string, string];
  sizeLabel: string;
  /** The structure at the step, at most `room` cells of it. */
  read: (room: number) => Sequence;
  /** A wider seam where the level changes (BFS holds two levels at most). */
  seams?: boolean;
  /** The analysed vertex is also the first cell (the stack's top). */
  peek?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { size, cell, side, room } = cellSizes(useBox(boxRef));
  const queue = read(room);
  // The analysing circle shares its vertex with the top cell when peeking,
  // so it slides by its own key.
  const slotKey = (v: number) => (peek ? `c${v}` : String(v));
  const colour = (v: number) => rampColour(search.levels[v], search.depth);

  // Where every cell sat at the previous step (layout positions, which
  // offsetLeft/Top give without the slides' transforms), to slide it from
  // there. Only a new step or a new size moves anything; a hover or a
  // replay frame that stays on the same step does not.
  const last = useRef<{ of: StructureSearch | null; at: Map<string, Place> }>({
    of: null,
    at: new Map(),
  });
  useLayoutEffect(() => {
    const frame = boxRef.current;
    if (!frame) return;
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fresh = last.current.of !== search;
    const origin = frame.getBoundingClientRect();
    const at = places(frame);
    const slot = [...at.values()].find((place) => place.role === 'current') ?? null;
    if (motion && !fresh) {
      for (const [key, place] of at) {
        const before = last.current.at.get(key);
        const el = place.el;
        const square = peek && place.role === 'current' ? at.get(key.slice(1)) : undefined;
        if (!before && square) {
          // The top just pushed is the vertex analysed: the circle grows
          // out of its square.
          place.el.animate(
            [
              {
                transform: `translate(${square.x - place.x}px, ${square.y - place.y}px) scale(${cell / size})`,
                transformOrigin: '0 0',
                borderRadius: '0px',
                opacity: 0,
              },
              { transform: 'none', transformOrigin: '0 0', borderRadius: '50%', opacity: 1 },
            ],
            { duration: 460, easing: EASE },
          );
        } else if (before) {
          const [dx, dy] = travel(place, before, origin);
          // Out of the queue into the analysing slot: the square grows into
          // the circle, from the queue cell's corner and size.
          const morph = place.role === 'current' && before.role === 'queue';
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            el.animate(
              morph
                ? [
                    {
                      transform: `translate(${dx}px, ${dy}px) scale(${cell / size})`,
                      transformOrigin: '0 0',
                      borderRadius: '0px',
                    },
                    { transform: 'none', transformOrigin: '0 0', borderRadius: '50%' },
                  ]
                : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 460, easing: EASE },
            );
          }
        } else {
          el.animate(
            [
              // A stack's cells come in on the left (the top), a queue's
              // at the back.
              { opacity: 0, transform: `translateX(${peek ? -cell / 2 : cell / 2}px)` },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 360, easing: EASE },
          );
        }
      }
      // The cells gone since the previous step: the vertex analysed before
      // leaves to the left; a vertex dequeued with nothing new to enqueue
      // passes through the analysing cell on its way out; a frame popped
      // lifts off the stack.
      for (const [key, before] of last.current.at) {
        if (at.has(key) || before.el.isConnected) continue;
        const ghost = haunt(frame, before);
        if (peek && before.role !== 'current') {
          ghost.animate(
            [
              { opacity: 1, transform: 'none' },
              { opacity: 0, transform: `translateY(${-cell}px)` },
            ],
            { duration: 380, easing: EASE },
          ).onfinish = () => ghost.remove();
          continue;
        }
        const to: Place | null = before.role === 'current' ? null : slot;
        const dx = to ? to.x - before.x : -size;
        const dy = to ? to.y - before.y : 0;
        ghost.animate(
          [
            { opacity: 1, transform: 'none', transformOrigin: '0 0' },
            {
              opacity: 0,
              transform: `translate(${dx}px, ${dy}px)${to ? ` scale(${size / cell})` : ''}`,
              transformOrigin: '0 0',
              ...(to ? { borderRadius: '50%' } : {}),
            },
          ],
          { duration: 460, easing: EASE },
        ).onfinish = () => ghost.remove();
      }
    }
    last.current = { of: search, at };
  }, [search, step, size, cell, room, peek]);

  return (
    <div ref={boxRef} className={styles.queue} style={cellVars({ size, cell, side })}>
      <span className={`label ${styles.slotLabel} ${styles.queueLabel}`}>{analysing}</span>
      <div className={styles.slotCell}>
        {queue.current ? (
          <QueueCell
            key={slotKey(queue.current)}
            v={queue.current}
            flip={slotKey(queue.current)}
            link={link}
            colour={colour(queue.current)}
            role="current"
          />
        ) : (
          <span className={styles.slotEmpty} />
        )}
      </div>
      <span className={`label ${styles.queueTitle}`}>{title}</span>
      <div className={styles.queueGroup}>
        <span className={`label ${styles.end}`}>{ends[0]}</span>
        <ol className={styles.queueCells}>
          {queue.items.map((item, i) => {
            if (isGap(item)) {
              return (
                <li key="gap" className={`mono ${styles.queueGap}`}>
                  +{formatInt(item.gap)}
                </li>
              );
            }
            const before = queue.items[i - 1];
            const level = search.levels[item];
            return (
              <li
                key={item}
                data-level-break={
                  (seams &&
                    before !== undefined &&
                    !isGap(before) &&
                    search.levels[before] !== level) ||
                  undefined
                }
              >
                <QueueCell
                  v={item}
                  link={link}
                  colour={colour(item)}
                  role={peek ? 'stack' : 'queue'}
                />
              </li>
            );
          })}
        </ol>
        <span className={`label ${styles.end}`}>{ends[1]}</span>
      </div>
      <p className={styles.queueSize}>
        {sizeLabel}: <span className="mono">{formatInt(queue.length)}</span>
      </p>
    </div>
  );
}

/** The size of an element, kept as it resizes. */
function useBox(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

/** The analysing circle takes the strip's height (its label above and some
    air around it); the squares are a size smaller, and as many fit as the
    width allows once the analysing column is mirrored on the right to keep
    the array centred. */
function cellSizes(box: { width: number; height: number }) {
  const size = Math.round(Math.max(CELL_MIN, Math.min(CELL_MAX, (box.height - 40) * 0.62)));
  const cell = Math.round(Math.max(28, size * QUEUE_SCALE));
  const side = Math.max(size + 40, 130);
  const room = Math.max(
    5,
    Math.min(MAX_CHIPS, Math.floor((box.width - 2 * (side + GUTTER) - LABELS) / (cell + 1))),
  );
  return { size, cell, side, room };
}

/** The box's custom properties for those sizes. */
function cellVars({ size, cell, side }: { size: number; cell: number; side: number }) {
  return {
    '--cell': `${cell}px`,
    '--slot': `${size}px`,
    '--side': `${side}px`,
    '--gutter': `${GUTTER}px`,
  } as CSSProperties;
}

interface Place {
  x: number;
  y: number;
  el: HTMLElement;
  role: string;
}

/** Every sliding cell in `frame` by key, where the layout puts it
    (offsetLeft/Top leave the slides' transforms out). */
function places(frame: HTMLElement): Map<string, Place> {
  const at = new Map<string, Place>();
  for (const el of frame.querySelectorAll<HTMLElement>('[data-flip]')) {
    at.set(el.dataset.flip ?? '', {
      x: el.offsetLeft,
      y: el.offsetTop,
      el,
      role: el.dataset.role ?? '',
    });
  }
  return at;
}

/** How far a cell has to slide back to show where it was `before`, and
    stops its running slide: one still moving keeps going from where it
    shows now. */
function travel(place: Place, before: Place, origin: DOMRect): [number, number] {
  const el = place.el;
  let rx = 0;
  let ry = 0;
  if (before.el === el && el.getAnimations().length) {
    const r = el.getBoundingClientRect();
    rx = r.left - origin.left - place.x;
    ry = r.top - origin.top - place.y;
  }
  el.getAnimations().forEach((a) => a.cancel());
  return [before.x - place.x + rx, before.y - place.y + ry];
}

/** A cell React has just removed, put back where it was, inert, to be
    animated out (and removed when its animation ends). */
function haunt(frame: HTMLElement, before: Place): HTMLElement {
  const ghost = before.el;
  ghost.getAnimations().forEach((a) => a.cancel());
  ghost.removeAttribute('data-flip');
  ghost.style.position = 'absolute';
  ghost.style.left = `${before.x}px`;
  ghost.style.top = `${before.y}px`;
  ghost.style.pointerEvents = 'none';
  frame.appendChild(ghost);
  return ghost;
}

/** A cell of the array: a square in its vertex's level colour (the circle
    of the analysing slot when `role` is 'current'). */
function QueueCell({
  v,
  flip = String(v),
  link,
  colour,
  role,
  title,
  children,
}: {
  v: number;
  /** The key it slides by, unique in its box. */
  flip?: string;
  link: Link;
  colour: string;
  role: 'current' | 'queue' | 'stack';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mono ${styles.queueCell}`}
      data-flip={flip}
      data-role={role}
      data-hot={link.hovered === v || undefined}
      style={{ '--chip': colour } as CSSProperties}
      title={title}
      onPointerEnter={() => link.onHover(v)}
      onPointerLeave={() => link.onHover(0)}
      onFocus={() => link.onHover(v)}
      onBlur={() => link.onHover(0)}
      onClick={() => link.onSelect(v)}
    >
      {children ?? v}
    </button>
  );
}

/** DFS's stack right after the discovery of `order[step]`: the path from
    the root to it, the frames of a recursive DFS and the explicit stack of
    the iterative one alike, the top (the vertex just discovered, whose
    neighbours are read next) first. A deep stack keeps its top frames and
    its root, the ones between counted. */
function dfsStack(search: StructureSearch, step: number, max = MAX_CHIPS): Sequence {
  const top = search.order[step];
  const length = search.levels[top] + 1;
  const items: (number | { gap: number })[] = [];
  for (let v = top; items.length < max - 2 && v; v = search.parents[v]) items.push(v);
  if (items[items.length - 1] !== search.root) {
    const hidden = length - items.length - 1;
    if (hidden > 0) items.push({ gap: hidden });
    items.push(search.root);
  }
  return { current: top, length, items };
}

// ---- Dijkstra: the frontier ------------------------------------------------

/** The frontier at `step`, replayed by the wasm side. While the replay
    plays, a replay that cost more than a frame is not asked for again
    until a few times its cost has passed, so a large graph keeps playing. */
function useFrontier(
  search: StructureSearch | null,
  step: number,
  playing: boolean,
  frontierAt: (step: number, limit: number) => FrontierView | null,
): FrontierView | null | undefined {
  /** The last replay and the search it belongs to: a new search shows
      nothing (undefined) until its own first replay, never the old one's. */
  const [state, setState] = useState<{ of: StructureSearch; view: FrontierView | null } | null>(
    null,
  );
  const cost = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    if (!search) return;
    const wait = playing ? Math.max(0, cost.current * 4 - (performance.now() - last.current)) : 0;
    const id = window.setTimeout(() => {
      const start = performance.now();
      setState({ of: search, view: frontierAt(step, FRONTIER_LIMIT) });
      cost.current = performance.now() - start;
      last.current = performance.now();
    }, wait);
    return () => window.clearTimeout(id);
  }, [search, step, playing, frontierAt]);
  if (!search) return null;
  return state?.of === search ? state.view : undefined;
}

/** One estimate lowered by a settle, as `4: ∞ → 3`. */
function lowering(v: number, before: number, after: number): string {
  return `${v}: ${Number.isFinite(before) ? formatWeight(before) : '∞'} → ${formatWeight(after)}`;
}

function DijkstraHead({
  t,
  search,
  step,
  view,
}: {
  t: Strings;
  search: StructureSearch;
  step: number;
  view: FrontierView | null;
}) {
  const s = t.structures;
  const v = search.order[step];
  const distance = search.distances ? search.distances[v] : 0;
  const lowered =
    view && view.step === step
      ? Array.from(view.relaxed, (w, i) => lowering(w, view.previous[i], view.lowered[i]))
      : [];
  const shown = lowered.slice(0, 6);
  return (
    <>
      <span className={`mono ${styles.op}`}>
        {s.ops.settle(String(v), formatWeight(distance))}
        {' · '}
        {lowered.length
          ? s.ops.lower(shown.join(', ') + (lowered.length > shown.length ? ', …' : ''))
          : s.ops.nothingLowered}
      </span>
      <span className={`mono ${styles.meta}`}>
        {view ? s.size.dijkstra(formatInt(view.total)) : ''} ·{' '}
        {s.step(formatInt(step + 1), formatInt(search.span))}
      </span>
    </>
  );
}

/** The course's vector: one slot per vertex. Each step the scan sweeps the
    slots and lands on the vertex it settles; the slots it lowered flash. */
function VectorView({
  t,
  search,
  step,
  view,
  lowered,
  link,
}: {
  t: Strings;
  search: StructureSearch;
  step: number;
  view: FrontierView;
  lowered: Set<number>;
  link: Link;
}) {
  const s = t.structures;
  const n = search.ranks.length - 1;
  const settledNow = search.order[step];
  const estimate = new Map<number, number>();
  view.vertices.forEach((v, i) => estimate.set(v, view.estimates[i]));
  const settled = (v: number) => search.ranks[v] !== 0xffffffff && search.ranks[v] <= step;

  // Every slot of a small graph; on a large one only the slots that hold an
  // estimate, in vertex order, with the runs of empty ones between counted.
  let cells: (number | { gap: number })[];
  if (n <= VECTOR_WHOLE) {
    cells = Array.from({ length: n }, (_, i) => i + 1);
  } else {
    cells = [];
    let previous = 0;
    for (const v of [...view.vertices, settledNow].sort((a, b) => a - b)) {
      if (v === previous) continue;
      if (v > previous + 1) cells.push({ gap: v - previous - 1 });
      cells.push(v);
      previous = v;
    }
    if (previous < n) cells.push({ gap: n - previous });
  }
  return (
    <div className={styles.vector}>
      {n > VECTOR_WHOLE && (
        <span className={`mono ${styles.note}`}>
          {s.slots(formatInt(view.total), formatInt(n))}
        </span>
      )}
      {/* Keyed by step: the sweep starts over on every settle. */}
      <ol key={step} className={styles.cells} style={{ '--cells': cells.length } as CSSProperties}>
        {cells.map((cell, i) => {
          if (isGap(cell)) {
            return (
              <li key={`gap-${i}`} className={styles.cellGap}>
                <Gap count={cell.gap} />
              </li>
            );
          }
          const v = cell;
          const value = estimate.get(v);
          const isSettled = settled(v);
          const state =
            v === settledNow
              ? 'just'
              : lowered.has(v)
                ? 'lowered'
                : isSettled
                  ? 'settled'
                  : value !== undefined
                    ? 'open'
                    : 'empty';
          return (
            <li key={v} style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                className={`mono ${styles.cell}`}
                data-state={state}
                data-hot={link.hovered === v || undefined}
                onPointerEnter={() => link.onHover(v)}
                onPointerLeave={() => link.onHover(0)}
                onClick={() => link.onSelect(v)}
                title={
                  state === 'settled' ? s.settled : state === 'empty' ? s.unreached : undefined
                }
              >
                <small>{v}</small>
                <span>
                  {isSettled && search.distances
                    ? formatWeight(search.distances[v])
                    : value !== undefined
                      ? formatWeight(value)
                      : '∞'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The binary heap as the tree it is (index 0 at the top, the children of
    `i` at `2i + 1` and `2i + 2`) over the array that stores it. Nodes are
    keyed by vertex, so a sift slides them between places. */
function HeapView({
  t,
  view,
  lowered,
  link,
}: {
  t: Strings;
  view: FrontierView;
  lowered: Set<number>;
  link: Link;
}) {
  const s = t.structures;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 600, height: 160 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ROW = 46;
  const levels = Math.max(1, Math.min(HEAP_LEVELS, Math.floor((box.height - 18) / ROW)));
  const count = Math.min(view.vertices.length, 2 ** levels - 1);
  const deeper = view.total - count;
  const place = (i: number): [number, number] => {
    const depth = Math.floor(Math.log2(i + 1));
    const first = 2 ** depth - 1;
    const slots = 2 ** depth;
    return [((i - first + 0.5) / slots) * box.width, 18 + depth * ROW];
  };
  const nodes = Array.from({ length: count }, (_, i) => i);

  return (
    <div className={styles.heap}>
      <div ref={boxRef} className={styles.tree}>
        <svg width={box.width} height={box.height} aria-hidden="true">
          {nodes.slice(1).map((i) => {
            const [x1, y1] = place((i - 1) >> 1);
            const [x2, y2] = place(i);
            return (
              <line key={`e${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className={styles.treeEdge} />
            );
          })}
        </svg>
        {nodes.map((i) => {
          const v = view.vertices[i];
          const [x, y] = place(i);
          return (
            <button
              key={v}
              type="button"
              className={`mono ${styles.node}`}
              data-state={i === 0 ? 'next' : lowered.has(v) ? 'lowered' : undefined}
              data-hot={link.hovered === v || undefined}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              onPointerEnter={() => link.onHover(v)}
              onPointerLeave={() => link.onHover(0)}
              onClick={() => link.onSelect(v)}
              title={i === 0 ? s.next : undefined}
            >
              <span className={styles.nodeVertex}>{v}</span>
              <span className={styles.nodeEstimate}>{formatWeight(view.estimates[i])}</span>
            </button>
          );
        })}
        {deeper > 0 && (
          <span className={`mono ${styles.deeper}`}>{s.deeper(formatInt(deeper))}</span>
        )}
      </div>
      <div className={styles.array}>
        <span className={`label ${styles.arrayLabel}`}>{s.heapArray}</span>
        <ol className={styles.arrayCells}>
          {Array.from(view.vertices.subarray(0, Math.min(view.vertices.length, 63)), (v, i) => (
            <li
              key={`${i}-${v}`}
              className={`mono ${styles.arrayCell}`}
              data-state={i === 0 ? 'next' : lowered.has(v) ? 'lowered' : undefined}
              data-hot={link.hovered === v || undefined}
              onPointerEnter={() => link.onHover(v)}
              onPointerLeave={() => link.onHover(0)}
            >
              <small>{i}</small>
              <span>{v}</span>
            </li>
          ))}
          {view.total > 63 && (
            <li>
              <Gap count={view.total - 63} />
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}

// ---- the drag handle -------------------------------------------------------

/** The strip's top edge: a grip in the middle drags its height, like the
    sidebar's; a double click resets it, the arrow keys nudge it. */
function StripHandle({
  label,
  height,
  columnRef,
  onCommit,
}: {
  label: string;
  height: number;
  columnRef: RefObject<HTMLDivElement | null>;
  onCommit: (height: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const live = useRef(height);
  const heightAt = (clientY: number) => {
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return height;
    return clampStrip(rect.bottom - clientY, rect.height);
  };
  const column = () => columnRef.current?.getBoundingClientRect().height ?? 800;
  const preview = (next: number) => {
    live.current = next;
    columnRef.current?.style.setProperty('--strip-height', `${next}px`);
  };
  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    onCommit(live.current);
  };
  return (
    <div className={styles.handle} data-dragging={dragging || undefined}>
      <div
        className={styles.grip}
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        aria-valuemin={STRIP_MIN}
        aria-valuemax={STRIP_MAX}
        aria-valuenow={height}
        title={label}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          live.current = height;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (dragging) preview(heightAt(event.clientY));
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => onCommit(clampStrip(STRIP_DEFAULT, column()))}
        onKeyDown={(event) => {
          const by = event.shiftKey ? 64 : 16;
          if (event.key === 'ArrowUp') onCommit(clampStrip(height + by, column()));
          else if (event.key === 'ArrowDown') onCommit(clampStrip(height - by, column()));
          else return;
          event.preventDefault();
        }}
      />
    </div>
  );
}
