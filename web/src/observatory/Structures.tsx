'use client';

import {
  Fragment,
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
   read as stored. Chips and heap nodes are keyed by vertex, so a step
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
  neighbors,
  frontierAt,
  hovered,
  onHover,
  onSelect,
  onResize,
  onMembers,
}: {
  t: Strings;
  search: StructureSearch | null;
  reveal: number;
  playing: boolean;
  height: number;
  /** The stage column: its height bounds the strip, and it carries the
      `--strip-height` the drag previews. */
  columnRef: RefObject<HTMLDivElement | null>;
  neighbors: (v: number) => Uint32Array;
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
}) {
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
  let op: ReactNode = null;
  let size = '';
  let body: ReactNode = <p className={styles.empty}>{s.empty}</p>;

  if (search?.kind === 'bfs') {
    title = s.titles.bfs;
    body = <QueueView t={t} search={search} step={step} link={link} />;
  } else if (search?.kind === 'dfs') {
    const st = dfsStack(search, step);
    const recursive = search.dfs === 'recursive';
    title = s.titles.dfs;
    size = s.size.dfs(formatInt(st.depth + 1));
    const top = search.order[step];
    const popped = st.popped.join(', ');
    op = recursive
      ? [st.popped.length ? s.ops.ret(popped) : '', s.ops.call(String(top))]
          .filter(Boolean)
          .join(' · ')
      : [st.popped.length ? s.ops.pop(popped) : '', s.ops.push(String(top))]
          .filter(Boolean)
          .join(' · ');
    body = (
      <StackView
        t={t}
        search={search}
        step={step}
        stack={st}
        recursive={recursive}
        neighbors={neighbors}
        link={link}
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
    <section className={styles.strip} aria-label={title || s.show}>
      <StripHandle label={s.resize} height={height} columnRef={columnRef} onCommit={onResize} />
      {search && search.kind !== 'bfs' && (
        <header className={styles.head}>
          <span className={`label ${styles.title}`}>{title}</span>
          {search.kind === 'dijkstra' ? (
            <DijkstraHead t={t} search={search} step={step} view={frontier ?? null} />
          ) : (
            <>
              <span className={`mono ${styles.op}`}>{op}</span>
              <span className={`mono ${styles.meta}`}>
                {size} · {s.step(formatInt(step + 1), formatInt(search.span))}
              </span>
            </>
          )}
        </header>
      )}
      <div className={styles.body}>{body}</div>
    </section>
  );
}

/** What the strip draws at `step`, as vertices for the canvas. */
function members(search: StructureSearch, step: number, frontier: FrontierView | null): Members {
  if (search.kind === 'bfs') {
    const q = bfsQueue(search, step);
    const shown = q.items.filter((x): x is number => !isGap(x));
    return { vertices: shown, focus: search.order[step] };
  }
  if (search.kind === 'dfs') {
    return { vertices: dfsStack(search, step).frames, focus: search.order[step] };
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

/** A vertex as a chip: hovering it lights the vertex on the canvas,
    clicking selects it there. */
function Chip({
  v,
  link,
  colour,
  state,
  children,
}: {
  v: number;
  link: Link;
  colour?: string;
  state?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mono ${styles.chip}`}
      data-state={state}
      data-hot={link.hovered === v || undefined}
      style={colour ? ({ '--chip': colour } as CSSProperties) : undefined}
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

function Gap({ count }: { count: number }) {
  return <span className={`mono ${styles.gap}`}>+{formatInt(count)}</span>;
}

// ---- BFS: the queue --------------------------------------------------------

interface Queue {
  /** The vertex being expanded (0 before the root is), dequeued already. */
  current: number;
  /** How many vertices are discovered and not yet expanded. */
  length: number;
  /** Those vertices, front first, the middle of a long queue as a count. */
  items: (number | { gap: number })[];
}

/** BFS's queue right after the discovery of `order[step]`. The library's BFS
    keeps its queue in the discovery order itself: the front is the vertex
    after the one being expanded, the back the last vertex discovered. Only
    the chips drawn are copied, so a queue of a million costs a hundred. */
function bfsQueue(search: StructureSearch, step: number, max = MAX_CHIPS): Queue {
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
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** BFS's queue as an array of glued cells, centred in the strip, and the
    vertex being analysed in its own cell on the left. Every cell is keyed
    by vertex and slides from where it was (FLIP) when the step changes:
    the front cell glides into the analysing cell, the queue closes up
    behind it, new vertices come in at the back, and the vertex analysed
    before leaves to the left. */
function QueueView({
  t,
  search,
  step,
  link,
}: {
  t: Strings;
  search: StructureSearch;
  step: number;
  link: Link;
}) {
  const s = t.structures;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The cells take the strip's height (the label over the analysing cell
  // and some air above and below), and as many fit as the width allows
  // once the analysing column is mirrored on the right to keep the queue
  // centred.
  const size = Math.round(Math.max(CELL_MIN, Math.min(CELL_MAX, (box.height - 40) * 0.62)));
  const side = Math.max(size + 40, 130);
  const room = Math.max(
    5,
    Math.min(MAX_CHIPS, Math.floor((box.width - 2 * (side + GUTTER) - LABELS) / (size + 1))),
  );
  const queue = bfsQueue(search, step, room);
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
    const at = new Map<string, Place>();
    let slot: Place | null = null;
    for (const el of frame.querySelectorAll<HTMLElement>('[data-flip]')) {
      const place = { x: el.offsetLeft, y: el.offsetTop, el, role: el.dataset.role ?? '' };
      if (place.role === 'current') slot = place;
      at.set(el.dataset.flip ?? '', place);
    }
    if (motion && !fresh) {
      for (const [key, place] of at) {
        const before = last.current.at.get(key);
        const el = place.el;
        if (before) {
          // A cell still sliding keeps going from where it shows now.
          let rx = 0;
          let ry = 0;
          if (before.el === el && el.getAnimations().length) {
            const r = el.getBoundingClientRect();
            rx = r.left - origin.left - place.x;
            ry = r.top - origin.top - place.y;
          }
          const dx = before.x - place.x + rx;
          const dy = before.y - place.y + ry;
          el.getAnimations().forEach((a) => a.cancel());
          // Out of the queue into the analysing slot: the square becomes a circle.
          const morph = place.role === 'current' && before.role === 'queue';
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            el.animate(
              [
                {
                  transform: `translate(${dx}px, ${dy}px)`,
                  ...(morph ? { borderRadius: '0px' } : {}),
                },
                { transform: 'none', ...(morph ? { borderRadius: '50%' } : {}) },
              ],
              { duration: 460, easing: EASE },
            );
          }
        } else {
          el.animate(
            [
              { opacity: 0, transform: `translateX(${size / 2}px)` },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 360, easing: EASE },
          );
        }
      }
      // The cells gone since the previous step: the vertex analysed before
      // leaves to the left; a vertex dequeued with nothing new to enqueue
      // passes through the analysing cell on its way out.
      for (const [key, before] of last.current.at) {
        if (at.has(key) || before.el.isConnected) continue;
        const ghost = before.el;
        ghost.getAnimations().forEach((a) => a.cancel());
        ghost.removeAttribute('data-flip');
        ghost.style.position = 'absolute';
        ghost.style.left = `${before.x}px`;
        ghost.style.top = `${before.y}px`;
        ghost.style.pointerEvents = 'none';
        frame.appendChild(ghost);
        const to: Place | null = before.role === 'current' ? null : slot;
        const dx = to ? to.x - before.x : -size;
        const dy = to ? to.y - before.y : 0;
        ghost.animate(
          [
            { opacity: 1, transform: 'none' },
            {
              opacity: 0,
              transform: `translate(${dx}px, ${dy}px)`,
              ...(to ? { borderRadius: '50%' } : {}),
            },
          ],
          { duration: 460, easing: EASE },
        ).onfinish = () => ghost.remove();
      }
    }
    last.current = { of: search, at };
  }, [search, step, size, room]);

  return (
    <div
      ref={boxRef}
      className={styles.queue}
      style={
        { '--cell': `${size}px`, '--side': `${side}px`, '--gutter': `${GUTTER}px` } as CSSProperties
      }
    >
      <span className={`label ${styles.slotLabel} ${styles.queueLabel}`}>{s.analysing}</span>
      <div className={styles.slotCell}>
        {queue.current ? (
          <QueueCell
            key={queue.current}
            v={queue.current}
            link={link}
            colour={colour(queue.current)}
            role="current"
          />
        ) : (
          <span className={styles.slotEmpty} />
        )}
      </div>
      <div className={styles.queueGroup}>
        <span className={`label ${styles.end}`}>{s.front}</span>
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
                  (before !== undefined && !isGap(before) && search.levels[before] !== level) ||
                  undefined
                }
              >
                <QueueCell v={item} link={link} colour={colour(item)} role="queue" />
              </li>
            );
          })}
        </ol>
        <span className={`label ${styles.end}`}>{s.back}</span>
      </div>
      <p className={styles.queueSize}>
        {s.queueSize}: <span className="mono">{formatInt(queue.length)}</span>
      </p>
    </div>
  );
}

interface Place {
  x: number;
  y: number;
  el: HTMLElement;
  role: string;
}

/** A queue cell: a square of the array, in its vertex's level colour. */
function QueueCell({
  v,
  link,
  colour,
  role,
  state,
}: {
  v: number;
  link: Link;
  colour: string;
  role: 'current' | 'queue';
  state?: string;
}) {
  return (
    <button
      type="button"
      className={`mono ${styles.queueCell}`}
      data-flip={v}
      data-role={role}
      data-state={state}
      data-hot={link.hovered === v || undefined}
      style={{ '--chip': colour } as CSSProperties}
      onPointerEnter={() => link.onHover(v)}
      onPointerLeave={() => link.onHover(0)}
      onFocus={() => link.onHover(v)}
      onBlur={() => link.onHover(0)}
      onClick={() => link.onSelect(v)}
    >
      {v}
    </button>
  );
}

// ---- DFS: the stack --------------------------------------------------------

interface Stack {
  /** Depth of the top frame (the stack holds depth + 1 frames). */
  depth: number;
  /** The frames from the root up to the top, windowed: the root, then the
      top ones; `skipped` frames in between are not listed. */
  frames: number[];
  skipped: number;
  /** Frames popped since the previous step, the deepest first. */
  popped: number[];
}

/** DFS's stack right after the discovery of `order[step]`: the path from
    the root to it, the frames of a recursive DFS and the explicit stack of
    the iterative one alike. Whatever was on top of the previous step's
    stack and is not an ancestor of the new vertex was popped in between. */
function dfsStack(search: StructureSearch, step: number): Stack {
  const top = search.order[step];
  const depth = search.levels[top];
  const keep = MAX_CHIPS - 2;
  const frames: number[] = [];
  for (let v = top; frames.length < keep && v; v = search.parents[v]) frames.push(v);
  let skipped = 0;
  if (frames[frames.length - 1] !== search.root) {
    skipped = depth + 1 - frames.length - 1;
    frames.push(search.root);
  }
  frames.reverse();
  const popped: number[] = [];
  if (step > 0) {
    const parent = search.parents[top];
    for (let v = search.order[step - 1]; v && v !== parent; v = search.parents[v]) {
      popped.push(v);
      if (popped.length > 8) break;
    }
  }
  return { depth, frames, skipped, popped };
}

/** Where `child` sits among `parent`'s neighbours (ascending rows), + 1:
    how far the frame of `parent` has read its neighbour list. */
function cursor(row: Uint32Array, child: number): number {
  let lo = 0;
  let hi = row.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (row[mid] < child) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function StackView({
  t,
  search,
  step,
  stack,
  recursive,
  neighbors,
  link,
}: {
  t: Strings;
  search: StructureSearch;
  step: number;
  stack: Stack;
  recursive: boolean;
  neighbors: (v: number) => Uint32Array;
  link: Link;
}) {
  const s = t.structures;
  const { frames, skipped, popped } = stack;
  const top = search.order[step];
  return (
    <div className={styles.tape}>
      <div className={styles.lane}>
        <span className={`label ${styles.end}`}>{s.bottom}</span>
        <ol className={styles.chips}>
          {frames.map((v, i) => {
            const row = neighbors(v);
            // How far the frame has read its neighbours: up to the child it
            // went down to (the frame above), none yet for the top.
            const hidden = skipped > 0 && i === 0;
            const read = i + 1 < frames.length ? cursor(row, frames[i + 1]) : 0;
            return (
              <Fragment key={v}>
                <li>
                  <Chip
                    v={v}
                    link={link}
                    colour={rampColour(search.levels[v], search.depth)}
                    state={v === top ? 'just' : undefined}
                  >
                    <span className={styles.frame}>
                      <span>{recursive ? `explore(${v})` : v}</span>
                      {!hidden && (
                        <small>
                          {read}/{row.length}
                        </small>
                      )}
                    </span>
                  </Chip>
                </li>
                {skipped > 0 && i === 0 && (
                  <li>
                    <Gap count={skipped} />
                  </li>
                )}
              </Fragment>
            );
          })}
          {popped.map((v) => (
            <li key={`popped-${v}`} className={styles.popped} aria-hidden="true">
              <span className={`mono ${styles.ghost}`}>{recursive ? `explore(${v})` : v}</span>
            </li>
          ))}
        </ol>
        <span className={`label ${styles.end}`}>{s.top}</span>
      </div>
    </div>
  );
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
