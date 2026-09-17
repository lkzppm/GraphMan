import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BorderBeam } from 'border-beam';
import { Liquid } from 'liquid-gooey';
import { ThinkingOrb } from 'thinking-orbs';
import { dataUrl, prettyName, type GraphMeta } from '../../lib/data.ts';
import { formatBytes, formatCompact, formatInt } from '../../lib/format.ts';
import { loadTree, type TreeLayout } from './gmo.ts';
import { ObservatoryRenderer, type ViewState } from './renderer.ts';
import './Observatory.css';

type Mode = 'bfs' | 'dfs';

interface Props {
  graphs: GraphMeta[];
}

interface Loaded {
  meta: GraphMeta;
  bfs: TreeLayout;
  dfs: TreeLayout;
}

/** Seconds the wave takes to cross the whole tree. */
const WAVE_SECONDS = 7;
const HOLD_SECONDS = 1.6;

export default function Observatory({ graphs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ObservatoryRenderer | null>(null);
  const viewRef = useRef<ViewState>({
    morph: 0,
    frontierBfs: -1,
    frontierDfs: -1,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const playingRef = useRef(true);
  const modeRef = useRef<Mode>('bfs');
  const holdRef = useRef(0);
  const loadedRef = useRef<Loaded | null>(null);

  const [chosen, setChosen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState<{ name: string; loaded: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<{ name: string; message: string } | null>(null);
  const [mode, setMode] = useState<Mode>('bfs');
  const [playing, setPlaying] = useState(true);
  const [level, setLevel] = useState(-1);

  // The selection defaults to the first exported graph; no effect needed.
  const selected = chosen ?? graphs[0]?.name ?? null;
  const active = loaded ? (mode === 'bfs' ? loaded.bfs : loaded.dfs) : null;
  const loading = selected !== null && loaded?.meta.name !== selected && error?.name !== selected;

  // Create the renderer and the frame loop once the canvas exists. Everything
  // that touches React state happens inside callbacks, never in the effect body.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ObservatoryRenderer | null = null;
    let observer: ResizeObserver | null = null;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const view = viewRef.current;
      const data = loadedRef.current;
      if (data && renderer) {
        const target = modeRef.current === 'dfs' ? 1 : 0;
        const morphing = Math.abs(target - view.morph) > 0.002;
        view.morph += (target - view.morph) * (1 - Math.exp(-dt * 5.5));
        if (!morphing) view.morph = target;

        const tree = modeRef.current === 'bfs' ? data.bfs : data.dfs;
        const key = modeRef.current === 'bfs' ? 'frontierBfs' : 'frontierDfs';
        if (playingRef.current && !morphing) {
          if (view[key] > tree.maxLevel + 1.5) {
            holdRef.current += dt;
            if (holdRef.current > HOLD_SECONDS) {
              holdRef.current = 0;
              view[key] = -1;
            }
          } else {
            view[key] += (dt * (tree.maxLevel + 2)) / WAVE_SECONDS;
          }
        }
        const shown = Math.min(Math.floor(view[key]), tree.maxLevel);
        setLevel((prev) => (prev === shown ? prev : shown));
        renderer.render(view);
      }
      raf = requestAnimationFrame(frame);
    };

    const init = () => {
      try {
        renderer = new ObservatoryRenderer(canvas);
      } catch (e) {
        setError({
          name: '*',
          message: `WebGL2 is required: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }
      rendererRef.current = renderer;
      if (loadedRef.current) renderer.setTrees(loadedRef.current.bfs, loadedRef.current.dfs);
      observer = new ResizeObserver(() => renderer?.resize());
      observer.observe(canvas);
      renderer.resize();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(init);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Load the selected graph's two layouts; state changes only in callbacks.
  useEffect(() => {
    if (!selected) return;
    const meta = graphs.find((g) => g.name === selected);
    if (!meta) return;
    let cancelled = false;
    const total = meta.bfs.bytes + meta.dfs.bytes;
    const totals = [0, 0];
    const report = (i: number) => (l: number) => {
      totals[i] = l;
      if (!cancelled) setProgress({ name: meta.name, loaded: totals[0]! + totals[1]!, total });
    };
    void Promise.all([
      loadTree(dataUrl(meta.bfs.file), report(0)),
      loadTree(dataUrl(meta.dfs.file), report(1)),
    ])
      .then(([bfs, dfs]) => {
        if (cancelled) return;
        const next = { meta, bfs, dfs };
        rendererRef.current?.setTrees(bfs, dfs);
        loadedRef.current = next;
        viewRef.current.frontierBfs = -1;
        viewRef.current.frontierDfs = -1;
        viewRef.current.zoom = 1;
        viewRef.current.panX = 0;
        viewRef.current.panY = 0;
        holdRef.current = 0;
        setLoaded(next);
        setProgress(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError({ name: meta.name, message: e instanceof Error ? e.message : String(e) });
        setProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, graphs]);

  const switchMode = useCallback((next: Mode) => {
    if (next === modeRef.current) return;
    modeRef.current = next;
    const data = loadedRef.current;
    const view = viewRef.current;
    if (data) {
      // Show the target tree fully lit during the morph, then replay the wave.
      if (next === 'dfs') view.frontierDfs = data.dfs.maxLevel + 2;
      else view.frontierBfs = data.bfs.maxLevel + 2;
      holdRef.current = HOLD_SECONDS - 0.4;
    }
    setMode(next);
  }, []);

  const togglePlay = useCallback(() => {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  }, []);

  const scrub = useCallback((value: number) => {
    const view = viewRef.current;
    if (modeRef.current === 'bfs') view.frontierBfs = value;
    else view.frontierDfs = value;
    holdRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const replay = useCallback(() => {
    const view = viewRef.current;
    if (modeRef.current === 'bfs') view.frontierBfs = -1;
    else view.frontierDfs = -1;
    holdRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
  }, []);

  // Zoom and pan.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0016);
      view.zoom = Math.min(60, Math.max(0.5, view.zoom * factor));
    };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const view = viewRef.current;
      const size = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.92 * view.zoom;
      view.panX += ((e.clientX - lastX) / size) * 2;
      view.panY -= ((e.clientY - lastY) / size) * 2;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onDouble = () => {
      const view = viewRef.current;
      view.zoom = 1;
      view.panX = 0;
      view.panY = 0;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDouble);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDouble);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  }, []);

  const profile = useMemo(() => (active ? downsample(active.levelSizes, 160) : []), [active]);
  const ringSize = active && level >= 0 && level <= active.maxLevel ? active.levelSizes[level]! : 0;
  const reachedSoFar = useMemo(() => {
    if (!active) return 0;
    let sum = 0;
    for (let l = 0; l <= Math.min(level, active.maxLevel); l++) sum += active.levelSizes[l]!;
    return sum;
  }, [active, level]);

  return (
    <section id="observatory" className="tile tile--dark observatory">
      <div className="tile__inner">
        <div className="tile__head">
          <p className="eyebrow">Observatory</p>
          <h2 className="display-lg">The search tree is the layout.</h2>
          <p className="lead">
            Each ring is one BFS level; each wedge is one subtree. No force simulation, just the
            parent and level arrays the library already computes, drawn in one pass.
          </p>
        </div>

        <div className="console">
          <aside className="console__side">
            <div className="side__group">
              <span className="side__label">Graph</span>
              <div className="glist" role="listbox" aria-label="Graph">
                {graphs.map((g) => {
                  const isActive = g.name === selected;
                  return (
                    <button
                      key={g.name}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className="glist__item"
                      onClick={() => setChosen(g.name)}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="glist-active"
                          className="glist__active"
                          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        />
                      )}
                      <span className="glist__name">{prettyName(g.name)}</span>
                      <span className="glist__meta mono">
                        {formatCompact(g.vertices)} v · {formatCompact(g.edges)} e ·{' '}
                        {formatBytes(g.bfs.bytes + g.dfs.bytes, 0)}
                      </span>
                    </button>
                  );
                })}
                {graphs.length === 0 && (
                  <span className="side__hint">
                    No graphs exported yet. Run <code className="mono">graphman export</code>.
                  </span>
                )}
              </div>
            </div>

            <div className="side__group">
              <span className="side__label">Search</span>
              <div className="seg" role="group" aria-label="Search algorithm">
                <div className="seg__liquid" aria-hidden="true">
                  <Liquid
                    fill="#ffffff"
                    blur={5}
                    contrast={20}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <Liquid.Item
                      effect="move"
                      move={{ springiness: 0.55, trail: 0.5, wobble: 0.4 }}
                    >
                      <div
                        className="seg__thumb"
                        style={{ transform: `translateX(${mode === 'bfs' ? 0 : 100}%)` }}
                      />
                    </Liquid.Item>
                  </Liquid>
                </div>
                <button
                  type="button"
                  className="seg__option"
                  aria-pressed={mode === 'bfs'}
                  onClick={() => switchMode('bfs')}
                >
                  BFS
                </button>
                <button
                  type="button"
                  className="seg__option"
                  aria-pressed={mode === 'dfs'}
                  onClick={() => switchMode('dfs')}
                >
                  DFS
                </button>
              </div>
            </div>

            {profile.length > 0 && (
              <div className="profile" aria-hidden="true">
                <svg viewBox={`0 0 ${profile.length} 40`} preserveAspectRatio="none">
                  {profile.map((v, i) => {
                    const lit = active
                      ? (i + 0.5) / profile.length <= (level + 1) / (active.maxLevel + 1)
                      : false;
                    return (
                      <rect
                        key={i}
                        x={i}
                        y={40 - v * 38}
                        width={0.8}
                        height={v * 38}
                        fill={lit ? '#2997ff' : 'rgba(255,255,255,0.28)'}
                      />
                    );
                  })}
                </svg>
                <span className="profile__label">
                  vertices per level{active && active.kind === 'dfs' ? ' (DFS depth, binned)' : ''}
                </span>
              </div>
            )}

            <p className="side__help">Scroll to zoom · drag to pan · double-click to reset</p>
          </aside>

          <div className="console__stage">
            <BorderBeam
              size="pulse-inner"
              colorVariant="ocean"
              theme="dark"
              strength={0.55}
              borderRadius={18}
              duration={3.2}
            >
              <div ref={frameRef} className="stage">
                <canvas
                  ref={canvasRef}
                  className="stage__canvas"
                  aria-label="Search tree of the selected graph"
                />
                <button
                  type="button"
                  className="icon-btn stage__fullscreen"
                  onClick={toggleFullscreen}
                  aria-label="Toggle fullscreen"
                  title="Fullscreen"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path
                      d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <AnimatePresence>
                  {(loading || error) && (
                    <motion.div
                      className="stage__status"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {error ? (
                        <span className="stage__status-text">
                          {error.name === '*'
                            ? error.message
                            : `Could not load ${prettyName(error.name)}: ${error.message}`}
                        </span>
                      ) : (
                        <>
                          <ThinkingOrb
                            state="connecting"
                            size={64}
                            theme="dark"
                            aria-label="Loading the search trees"
                          />
                          <span className="stage__status-text">
                            {progress && progress.name === selected
                              ? `Loading ${formatBytes(progress.loaded, 1)}${progress.total > 0 ? ` of ${formatBytes(progress.total, 1)}` : ''}`
                              : 'Loading…'}
                          </span>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </BorderBeam>
            <div className="stagebar">
              <div className="stagebar__wave">
                <div className="transport">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={togglePlay}
                    aria-label={playing ? 'Pause' : 'Play'}
                    disabled={!active}
                  >
                    {playing ? (
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                        <path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                        <path d="M6 4l10 6-10 6z" fill="currentColor" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={replay}
                    aria-label="Replay the wave"
                    title="Replay"
                    disabled={!active}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <path
                        d="M4 10a6 6 0 1 1 2 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M4 6v4h4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <input
                    type="range"
                    className="transport__scrub"
                    min={-1}
                    max={active ? active.maxLevel + 1 : 0}
                    step={active && active.maxLevel > 200 ? Math.ceil(active.maxLevel / 400) : 1}
                    value={Math.min(level, active ? active.maxLevel + 1 : 0)}
                    onChange={(e) => scrub(Number(e.target.value))}
                    aria-label="Frontier level"
                    disabled={!active}
                  />
                </div>
              </div>

              <dl className="stats" aria-live="polite">
                <div className="stat">
                  <dt>Level</dt>
                  <dd className="mono">
                    {active ? Math.max(level, 0) : '—'}
                    {active && <small> / {active.maxLevel}</small>}
                  </dd>
                </div>
                <div className="stat">
                  <dt>In this ring</dt>
                  <dd className="mono">{active ? formatInt(ringSize) : '—'}</dd>
                </div>
                <div className="stat">
                  <dt>Reached</dt>
                  <dd className="mono">
                    {active ? formatCompact(Math.min(reachedSoFar, active.reached)) : '—'}
                    {active && <small> / {formatCompact(active.vertexCount)}</small>}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Level sizes reduced to at most `bins` bars, each normalised to [0, 1]. */
function downsample(sizes: Uint32Array, bins: number): number[] {
  if (sizes.length === 0) return [];
  const count = Math.min(bins, sizes.length);
  const per = sizes.length / count;
  const out = new Array<number>(count).fill(0);
  for (let i = 0; i < sizes.length; i++)
    out[Math.min(count - 1, Math.floor(i / per))]! += sizes[i]!;
  const max = Math.max(...out, 1);
  return out.map((v) => v / max);
}
