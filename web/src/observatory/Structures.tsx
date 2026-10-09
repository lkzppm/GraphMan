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
  /** Steps of the replay: `span`, or for a DFS one per push and per pop. */
  steps: number;
  /** DFS only: the stack's moves, step by step (`v` pushes v, `-v` pops it). */
  trail: Int32Array | null;
  /** DFS only: the discovery rank each step stands at. */
  rankAt: Uint32Array | null;
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
/** Entries asked of a frontier: a heap's first five levels, or vector cells. */
const HEAP_LEVELS = 5;
export const FRONTIER_LIMIT = 240;
/** A discovery rank's "not reached". */
const UNREACHED = 0xffffffff;

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
  const step = search ? Math.max(0, Math.min(Math.round(reveal), search.steps - 1)) : 0;
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
    body =
      frontier === undefined ? null : frontier === null ? (
        <p className={styles.empty}>{s.tooLarge}</p>
      ) : search.frontier === 'vector' ? (
        <VectorView t={t} search={search} view={frontier} link={link} title={title} />
      ) : (
        <HeapView t={t} search={search} view={frontier} link={link} title={title} />
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
      <div className={styles.body}>{body}</div>
    </section>
  );
}

/** What the strip draws at `step`, as vertices for the canvas. */
function members(search: StructureSearch, step: number, frontier: FrontierView | null): Members {
  if (search.kind !== 'dijkstra') {
    const held = search.kind === 'bfs' ? bfsQueue(search, step) : dfsStack(search, step);
    const shown = held.items.filter((x): x is number => !isGap(x));
    return { vertices: shown, focus: search.kind === 'bfs' ? search.order[step] : held.current };
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

  useFlip(boxRef, search, step, peek ? STACK_MOTION : QUEUE_MOTION, cell, size, String(room));

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
  /** Its width, to scale a cell into another of another size. */
  w: number;
  el: HTMLElement;
  role: string;
}

/** Every sliding cell in `frame` by key, where the layout puts it within
    the frame (offsets leave the slides' transforms out, and are summed up
    through any positioned box between, like the heap's tree). */
function places(frame: HTMLElement): Map<string, Place> {
  const at = new Map<string, Place>();
  for (const el of frame.querySelectorAll<HTMLElement>('[data-flip]')) {
    let x = 0;
    let y = 0;
    for (let e: HTMLElement | null = el; e && e !== frame;) {
      x += e.offsetLeft;
      y += e.offsetTop;
      e = e.offsetParent as HTMLElement | null;
    }
    at.set(el.dataset.flip ?? '', { x, y, w: el.offsetWidth, el, role: el.dataset.role ?? '' });
  }
  return at;
}

/** The slides running on a cell (not its CSS animations, like a flash). */
function slides(el: HTMLElement): Animation[] {
  return el
    .getAnimations()
    .filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition));
}

/** How far a cell has to slide back to show where it was `before`, and
    stops its running slide: one still moving keeps going from where it
    shows now. */
function travel(place: Place, before: Place, origin: DOMRect): [number, number] {
  const el = place.el;
  let rx = 0;
  let ry = 0;
  const running = slides(el);
  if (before.el === el && running.length) {
    const r = el.getBoundingClientRect();
    rx = r.left - origin.left - place.x;
    ry = r.top - origin.top - place.y;
  }
  running.forEach((a) => a.cancel());
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

/** Round cells: the analysing circle and the heap's nodes. */
const ROUND = new Set(['current', 'node']);

/** A cell turning into the analysing circle: from where `from` is (dx, dy
    away), its size and its shape. */
function grow(dx: number, dy: number, from: Place, to: Place, fade: boolean): Keyframe[] {
  return [
    {
      transform: `translate(${dx}px, ${dy}px) scale(${from.w / Math.max(to.w, 1)})`,
      transformOrigin: '0 0',
      borderRadius: ROUND.has(from.role) ? '50%' : '0px',
      ...(fade ? { opacity: 0 } : {}),
    },
    {
      transform: 'none',
      transformOrigin: '0 0',
      borderRadius: '50%',
      ...(fade ? { opacity: 1 } : {}),
    },
  ];
}

/** How a structure's cells move when the step changes. */
interface Motion {
  /** The key of the cell a new analysing circle grows out of, when the
      vertex analysed stays in the structure (the stack's top, the vector's
      slot); the circle is keyed `c` + vertex then. */
  source?: (key: string) => string | undefined;
  /** Where a new cell comes in from, as a transform. */
  enter: (cell: number) => string;
  /** Where a cell gone goes: through the analysing cell (a queue's
      vertex dequeued with nothing to enqueue), up off the structure (a
      frame popped), or nowhere, fading where it was. */
  leave: 'slot' | 'lift' | 'fade';
}

const circleOf = (key: string) => (key.startsWith('c') ? key.slice(1) : undefined);
const QUEUE_MOTION: Motion = { enter: (cell) => `translateX(${cell / 2}px)`, leave: 'slot' };
const STACK_MOTION: Motion = {
  source: circleOf,
  enter: (cell) => `translateX(${-cell / 2}px)`,
  leave: 'lift',
};
const VECTOR_MOTION: Motion = { source: circleOf, enter: () => 'scale(0.8)', leave: 'fade' };
const HEAP_MOTION: Motion = { enter: () => 'scale(0.6)', leave: 'fade' };

/** Slides every cell of `boxRef` from where it sat at the previous step
    (FLIP). Only a new step or a new layout moves anything; a hover or a
    replay frame that stays on the same step does not. The vertex the step
    analyses glides (or grows) into the analysing circle, the one analysed
    before leaves to the left, and the rest follow `motion`. */
function useFlip(
  boxRef: RefObject<HTMLElement | null>,
  search: StructureSearch,
  step: number,
  motion: Motion,
  cell: number,
  size: number,
  layout: string,
) {
  const last = useRef<{ of: StructureSearch | null; at: Map<string, Place> }>({
    of: null,
    at: new Map(),
  });
  useLayoutEffect(() => {
    const frame = boxRef.current;
    if (!frame) return;
    const moving = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fresh = last.current.of !== search;
    const origin = frame.getBoundingClientRect();
    const at = places(frame);
    const slot = [...at.values()].find((place) => place.role === 'current') ?? null;
    if (moving && !fresh) {
      for (const [key, place] of at) {
        const before = last.current.at.get(key);
        const el = place.el;
        const from =
          !before && place.role === 'current' && motion.source
            ? at.get(motion.source(key) ?? '')
            : undefined;
        if (from) {
          el.animate(grow(from.x - place.x, from.y - place.y, from, place, true), {
            duration: 460,
            easing: EASE,
          });
        } else if (before) {
          const [dx, dy] = travel(place, before, origin);
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            el.animate(
              place.role === 'current' && before.role !== 'current'
                ? grow(dx, dy, before, place, false)
                : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 460, easing: EASE },
            );
          }
        } else {
          el.animate(
            [
              { opacity: 0, transform: motion.enter(cell) },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 360, easing: EASE },
          );
        }
      }
      for (const [key, before] of last.current.at) {
        if (at.has(key) || before.el.isConnected) continue;
        const ghost = haunt(frame, before);
        const leave = before.role === 'current' ? 'left' : motion.leave;
        const to = leave === 'slot' ? slot : null;
        const end: Keyframe =
          leave === 'left'
            ? { transform: `translateX(${-size}px)` }
            : leave === 'lift'
              ? { transform: `translateY(${-cell}px)` }
              : to
                ? {
                    transform: `translate(${to.x - before.x}px, ${to.y - before.y}px) scale(${size / Math.max(before.w, 1)})`,
                    borderRadius: '50%',
                  }
                : { transform: 'scale(0.6)' };
        const pivot = leave === 'fade' ? '50% 50%' : '0 0';
        ghost.animate(
          [
            { opacity: 1, transform: 'none', transformOrigin: pivot },
            { opacity: 0, transformOrigin: pivot, ...end },
          ],
          { duration: leave === 'lift' ? 380 : 460, easing: EASE },
        ).onfinish = () => ghost.remove();
      }
    }
    last.current = { of: search, at };
  }, [boxRef, search, step, motion, cell, size, layout]);
}

/** A cell of the array: a square in its vertex's level colour (the circle
    of the analysing slot when `role` is 'current'). */
function QueueCell({
  v,
  flip = String(v),
  link,
  colour,
  role,
  state,
  title,
  children,
}: {
  v: number;
  /** The key it slides by, unique in its box. */
  flip?: string;
  link: Link;
  colour: string;
  role: 'current' | 'queue' | 'stack' | 'array';
  /** The heap array's root ('next') or an estimate just lowered. */
  state?: 'next' | 'lowered';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mono ${styles.queueCell}`}
      data-flip={flip}
      data-role={role}
      data-state={state}
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

/** DFS's stack after the timeline's step `step` (a push or a pop): the
    path from the root to its top, the frames of a recursive DFS and the
    explicit stack of the iterative one alike, the top (the vertex whose
    neighbours are being read) first. After the pops that follow the push
    of the last vertex discovered, the top is that vertex's ancestor as
    many levels up; once the search is over the stack is empty. A deep
    stack keeps its top frames and its root, the ones between counted. */
function dfsStack(search: StructureSearch, step: number, max = MAX_CHIPS): Sequence {
  let top = search.order[step];
  if (search.trail && search.rankAt) {
    const rank = search.rankAt[step];
    top = search.order[rank];
    // Steps since that push are pops, each one frame off the top.
    for (let s = step; s > 0 && search.trail[s] < 0; s--) top = search.parents[top];
  }
  if (!top) return { current: 0, length: 0, items: [] };
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

/** An estimate a settle lowered, as `∞ → 3`. */
function lowering(before: number, after: number): string {
  return `${Number.isFinite(before) ? formatWeight(before) : '∞'} → ${formatWeight(after)}`;
}

/** What a settle lowered: vertex → its `before → after`. */
function loweredBy(view: FrontierView): Map<number, string> {
  const lowered = new Map<number, string>();
  view.relaxed.forEach((v, i) => lowered.set(v, lowering(view.previous[i], view.lowered[i])));
  return lowered;
}

/** The vector's slots the strip draws: every one when they fit, otherwise
    the ones holding an estimate (and the one just settled) with the runs
    between them counted, and past `room` the rest as one count. */
function vectorCells(n: number, room: number, held: number[]): (number | { gap: number })[] {
  if (n <= room) return Array.from({ length: n }, (_, i) => i + 1);
  const cells: (number | { gap: number })[] = [];
  let previous = 0;
  for (const v of held.sort((a, b) => a - b)) {
    if (v === previous) continue;
    if (cells.length >= room - 2) break;
    if (v > previous + 1) cells.push({ gap: v - previous - 1 });
    cells.push(v);
    previous = v;
  }
  if (previous < n) cells.push({ gap: n - previous });
  return cells;
}

/** The course's vector, in the queue's layout: one glued slot per vertex
    (its number over its estimate), centred, and the vertex the step
    settles in the analysing circle with its distance under it. Each step
    a blue wash sweeps the slots (the scan for the minimum) and the circle
    grows out of the slot it lands on, which turns grey, settled; the
    estimates the settle lowered flash. */
function VectorView({
  t,
  search,
  view,
  link,
  title,
}: {
  t: Strings;
  search: StructureSearch;
  view: FrontierView;
  link: Link;
  title: string;
}) {
  const s = t.structures;
  const boxRef = useRef<HTMLDivElement>(null);
  const { size, cell, side, room } = cellSizes(useBox(boxRef));
  const step = view.step;
  const n = search.ranks.length - 1;
  const current = search.order[step];
  const estimate = new Map<number, number>();
  view.vertices.forEach((v, i) => estimate.set(v, view.estimates[i]));
  const lowered = loweredBy(view);
  const settled = (v: number) => search.ranks[v] !== UNREACHED && search.ranks[v] <= step;
  const distance = (v: number) => (search.distances ? search.distances[v] : 0);
  const cells = vectorCells(n, room, [...view.vertices, current]);
  useFlip(boxRef, search, step, VECTOR_MOTION, cell, size, String(room));

  return (
    <div ref={boxRef} className={styles.queue} style={cellVars({ size, cell, side })}>
      <span className={`label ${styles.slotLabel} ${styles.queueLabel}`}>{s.analysing}</span>
      <div className={styles.slotCell}>
        <QueueCell
          key={`c${current}`}
          v={current}
          flip={`c${current}`}
          link={link}
          colour={rampColour(search.levels[current], search.depth)}
          role="current"
        />
      </div>
      <span className={`mono ${styles.slotNote}`}>
        {s.distance(formatWeight(distance(current)))}
      </span>
      <span className={`label ${styles.queueTitle}`}>{title}</span>
      <div className={styles.queueGroup}>
        {/* Keyed by step: the sweep starts over on every settle. */}
        <ol
          key={step}
          className={styles.queueCells}
          style={{ '--cells': cells.length } as CSSProperties}
        >
          {cells.map((item, i) => {
            if (isGap(item)) {
              return (
                <li key={`gap-${i}`} className={`mono ${styles.queueGap}`}>
                  +{formatInt(item.gap)}
                </li>
              );
            }
            const v = item;
            const value = estimate.get(v);
            const done = settled(v);
            const state =
              v === current
                ? 'just'
                : lowered.has(v)
                  ? 'lowered'
                  : done
                    ? 'settled'
                    : value !== undefined
                      ? 'open'
                      : 'empty';
            return (
              <li key={v} style={{ '--i': i } as CSSProperties}>
                <button
                  type="button"
                  className={`mono ${styles.queueCell} ${styles.slot}`}
                  data-flip={v}
                  data-role="slot"
                  data-state={state}
                  data-hot={link.hovered === v || undefined}
                  onPointerEnter={() => link.onHover(v)}
                  onPointerLeave={() => link.onHover(0)}
                  onFocus={() => link.onHover(v)}
                  onBlur={() => link.onHover(0)}
                  onClick={() => link.onSelect(v)}
                  title={
                    lowered.get(v) ??
                    (state === 'settled' ? s.settled : state === 'empty' ? s.unreached : undefined)
                  }
                >
                  <small>{v}</small>
                  <span>
                    {done
                      ? formatWeight(distance(v))
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
      <p className={styles.queueSize}>
        {s.openSize}: <span className="mono">{formatInt(view.total)}</span>
      </p>
    </div>
  );
}

/** The binary heap in the queue's layout: the tree it is (index 0 at the
    top, the children of `i` at `2i + 1` and `2i + 2`) over the array that
    stores it, as glued cells with their indices, and the vertex the step
    settles in the analysing circle with its distance under it. Nodes and
    cells are keyed by vertex, so a sift slides them between places and
    the root popped glides into the circle. */
function HeapView({
  t,
  search,
  view,
  link,
  title,
}: {
  t: Strings;
  search: StructureSearch;
  view: FrontierView;
  link: Link;
  title: string;
}) {
  const s = t.structures;
  const boxRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const box = useBox(boxRef);
  const tree = useBox(treeRef);
  const { size, side } = cellSizes(box);
  // Nodes and array cells share one size, smaller than the queue's: the
  // tree needs the height.
  const unit = Math.round(Math.max(26, Math.min(36, box.height / 7)));
  const room = Math.max(
    5,
    Math.min(63, Math.floor((box.width - 2 * (side + GUTTER) - 90) / (unit + 1))),
  );
  const step = view.step;
  const current = search.order[step];
  const lowered = loweredBy(view);
  const distance = search.distances ? search.distances[current] : 0;

  const row = unit + 22;
  const levels = Math.max(
    1,
    Math.min(HEAP_LEVELS, Math.floor((tree.height - unit - 14) / row) + 1),
  );
  const count = Math.min(view.vertices.length, 2 ** levels - 1);
  const deeper = view.total - count;
  const place = (i: number): [number, number] => {
    const depth = Math.floor(Math.log2(i + 1));
    const first = 2 ** depth - 1;
    return [((i - first + 0.5) / 2 ** depth) * tree.width, unit / 2 + depth * row];
  };
  const nodes = Array.from({ length: count }, (_, i) => i);
  const shown = Math.min(view.vertices.length, room);
  const stateOf = (i: number, v: number) =>
    i === 0 ? 'next' : lowered.has(v) ? 'lowered' : undefined;
  useFlip(
    boxRef,
    search,
    step,
    HEAP_MOTION,
    unit,
    size,
    `${room}:${levels}:${tree.width}:${tree.height}`,
  );

  return (
    <div
      ref={boxRef}
      className={styles.heapBox}
      style={{ ...cellVars({ size, cell: unit, side }), '--unit': `${unit}px` } as CSSProperties}
    >
      <div className={styles.heapSide}>
        <span className={`label ${styles.slotLabel}`}>{s.analysing}</span>
        <div className={styles.slotCell}>
          <QueueCell
            key={current}
            v={current}
            link={link}
            colour={rampColour(search.levels[current], search.depth)}
            role="current"
          />
        </div>
        <span className={`mono ${styles.slotNote}`}>{s.distance(formatWeight(distance))}</span>
      </div>
      <span className={`label ${styles.heapTitle}`}>{title}</span>
      <div ref={treeRef} className={styles.tree}>
        <svg width={tree.width} height={tree.height} aria-hidden="true">
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
              data-flip={v}
              data-role="node"
              data-state={stateOf(i, v)}
              data-hot={link.hovered === v || undefined}
              style={{ left: x - unit / 2, top: y - unit / 2 }}
              onPointerEnter={() => link.onHover(v)}
              onPointerLeave={() => link.onHover(0)}
              onFocus={() => link.onHover(v)}
              onBlur={() => link.onHover(0)}
              onClick={() => link.onSelect(v)}
              title={i === 0 ? s.next : lowered.get(v)}
            >
              {v}
              <span className={styles.nodeEstimate}>{formatWeight(view.estimates[i])}</span>
            </button>
          );
        })}
        {deeper > 0 && (
          <span className={`mono ${styles.deeper}`}>{s.deeper(formatInt(deeper))}</span>
        )}
      </div>
      <div className={styles.heapArray}>
        <span className={`label ${styles.end}`}>{s.heapArray}</span>
        <ol className={styles.queueCells}>
          {Array.from(view.vertices.subarray(0, shown), (v, i) => (
            <li key={v} className={styles.indexed}>
              <QueueCell
                v={v}
                flip={`a${v}`}
                link={link}
                colour="var(--accent)"
                role="array"
                state={stateOf(i, v)}
                title={i === 0 ? s.next : lowered.get(v)}
              />
              <small className="mono">{i}</small>
            </li>
          ))}
          {view.total > shown && (
            <li key="gap" className={`mono ${styles.queueGap}`}>
              +{formatInt(view.total - shown)}
            </li>
          )}
        </ol>
      </div>
      <p className={styles.heapSize}>
        {s.heapSize}: <span className="mono">{formatInt(view.total)}</span>
      </p>
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
