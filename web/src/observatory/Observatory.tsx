'use client';

import {
  ChevronDown,
  CircleHelp,
  Download,
  Expand,
  FlaskConical,
  Focus,
  Hash,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Ruler,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { formatBytes, formatCompact, formatInt, formatMs } from '@/lib/format';
import {
  FIGURE_ONE,
  loadGraphman,
  UNREACHED,
  type Graph,
  type GraphmanModule,
  type SearchResult,
} from '@/lib/graphman';
import {
  acquireRenderer,
  SIMULATION_LIMIT,
  UnsupportedError,
  readTheme,
  type Camera,
  type Renderer,
} from './renderer';
import Constellation from '@/components/Constellation';
import styles from './Observatory.module.css';

type Status =
  | { kind: 'booting' }
  | { kind: 'ready' }
  | { kind: 'parsing'; name: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'failed'; message: string };

interface GraphMeta {
  name: string;
  bytes: number;
  vertices: number;
  edges: number;
  selfLoops: number;
  duplicates: number;
  heapBytes: number;
  degree: { min: number; max: number; mean: number; median: number };
  components: number;
  largest: number;
  smallest: number;
  degrees: Uint32Array;
  componentSizes: Uint32Array;
  parseMs: number;
}

type SearchKindName = 'bfs' | 'dfs';

interface Search {
  kind: SearchKindName;
  root: number;
  depth: number;
  reached: number;
  elapsedMs: number;
  levels: Uint32Array;
  parents: Uint32Array;
  levelSizes: Uint32Array;
  /** Reached vertices in discovery order (rank → vertex). */
  order: Uint32Array;
  /** Discovery rank of each vertex (UNREACHED if not reached). */
  ranks: Uint32Array;
  result: SearchResult;
}

interface DiameterInfo {
  method: string;
  value: number;
  from: number;
  to: number;
  bfsCount: number;
  isExact: boolean;
  cancelled: boolean;
  elapsedMs: number;
}

const DIAMETER_METHODS = [
  { id: 'Sweep', label: '4-sweep (lower bound)' },
  { id: 'IFub', label: 'iFUB (exact)' },
  { id: 'Bounds', label: 'Takes–Kosters (exact)' },
  { id: 'Exact', label: 'Brute force (exact)' },
] as const;

const MAX_FILE_BYTES = 512 * 1024 * 1024;

/** The empty sidebar's cheat sheet: gesture or key, what it does. */
const CONTROLS: [string, string][] = [
  ['click', 'pick the origin'],
  ['drag', 'move a vertex'],
  ['drag bg', 'pan'],
  ['scroll', 'zoom'],
  ['dbl-click', 'fit the graph'],
  ['F', 'fit the graph'],
  ['space', 'play / pause'],
  ['← →', 'step a vertex'],
  ['↑ ↓', 'step a level'],
  ['esc', 'clear the origin'],
  ['drop file', 'load a graph'],
];

/** The sample file, line by line, as the format explanation. */
const FORMAT_LINES: [string, string][] = [
  ['5', '// vertices'],
  ['1 2', '// one edge per line'],
  ['2 5', ''],
  ['5 3', ''],
  ['4 5', ''],
  ['1 5', ''],
];

export default function Observatory() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const wasmRef = useRef<GraphmanModule | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const fitRef = useRef<() => void>(() => {});

  const [status, setStatus] = useState<Status>({ kind: 'booting' });
  const [meta, setMeta] = useState<GraphMeta | null>(null);
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [kind, setKind] = useState<SearchKindName>('bfs');
  const [rootInput, setRootInput] = useState('');
  const [search, setSearch] = useState<Search | null>(null);
  const [reveal, setReveal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [simulate, setSimulate] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [diameterMethod, setDiameterMethod] =
    useState<(typeof DIAMETER_METHODS)[number]['id']>('IFub');
  const [diameterBudget, setDiameterBudget] = useState('2000');
  const [diameter, setDiameter] = useState<DiameterInfo | null>(null);
  const [diameterBusy, setDiameterBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** The controls popover, top left of the stage. */
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);
  /** Keep the discovered part of the tree in view while the search plays or is
      scrubbed. Off by default; running a search leaves it as it is. */
  const [follow, setFollow] = useState(false);
  const glideFrame = useRef(0);
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  const [diameterOpen, setDiameterOpen] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  // Pointer interaction state lives in refs: it changes every frame.
  const gesture = useRef<{
    mode: 'none' | 'pan' | 'drag' | 'maybe-click';
    startX: number;
    startY: number;
    camX: number;
    camY: number;
    vertex: number;
    pointerId: number;
  }>({ mode: 'none', startX: 0, startY: 0, camX: 0, camY: 0, vertex: 0, pointerId: -1 });
  const hoverFrame = useRef(0);
  const revealRef = useRef(0);
  /** Keep the whole graph in view while the layout settles, until the user takes over. */
  const autoFit = useRef(false);

  // ---- boot: wasm + WebGPU -------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lease = acquireRenderer(canvas, readTheme());
    (async () => {
      try {
        const [wasm, renderer] = await Promise.all([loadGraphman(), lease.renderer]);
        if (cancelled) return;
        wasmRef.current = wasm;
        rendererRef.current = renderer;
        renderer.onError = (message) => setNotice(message);
        renderer.onPositions = () => {
          if (autoFit.current) fitRef.current();
        };
        setStatus({ kind: 'ready' });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(
          error instanceof UnsupportedError
            ? { kind: 'unsupported', message }
            : { kind: 'failed', message },
        );
      }
    })();
    return () => {
      cancelled = true;
      rendererRef.current = null;
      lease.release();
    };
  }, []);

  // ---- camera ----------------------------------------------------------------

  const applyCamera = useCallback((camera: Camera) => {
    cameraRef.current = camera;
    rendererRef.current?.setCamera(camera);
  }, []);

  const fit = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.hasGraph) return;
    const positions = renderer.positionsMirror;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 2; i < positions.length; i += 2) {
      const x = positions[i];
      const y = positions[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return;
    const [w, h] = renderer.cssSize;
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const zoom = Math.min((w * 0.86) / bw, (h * 0.86) / bh, 40);
    applyCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
  }, [applyCamera]);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  /** Eases the camera towards `target` over a few frames (restarts on each call). */
  const glideTo = useCallback(
    (target: Camera) => {
      cancelAnimationFrame(glideFrame.current);
      const step = () => {
        const c = cameraRef.current;
        const next = {
          x: c.x + (target.x - c.x) * 0.18,
          y: c.y + (target.y - c.y) * 0.18,
          zoom: c.zoom + (target.zoom - c.zoom) * 0.18,
        };
        applyCamera(next);
        const settled =
          Math.abs(target.x - next.x) < 0.05 &&
          Math.abs(target.y - next.y) < 0.05 &&
          Math.abs(target.zoom - next.zoom) < 0.0005;
        if (!settled) glideFrame.current = requestAnimationFrame(step);
      };
      glideFrame.current = requestAnimationFrame(step);
    },
    [applyCamera],
  );

  /** Frames the vertices discovered up to `rank` (rank → level colours already lit). */
  const fitDiscovered = useCallback(
    (ranks: Uint32Array, rank: number) => {
      const renderer = rendererRef.current;
      if (!renderer || !renderer.hasGraph) return;
      const positions = renderer.positionsMirror;
      const limit = Math.round(rank);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let v = 1, i = 2; i < positions.length; v++, i += 2) {
        if (ranks[v] > limit) continue;
        const x = positions[i];
        const y = positions[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minX)) return;
      const [w, h] = renderer.cssSize;
      // A lone origin still gets a neighbourhood, not a giant disc.
      const bw = Math.max(maxX - minX, 220);
      const bh = Math.max(maxY - minY, 220);
      const zoom = Math.min((w * 0.8) / bw, (h * 0.8) / bh, 6);
      glideTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
    },
    [glideTo],
  );

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    const camera = cameraRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    return { x: camera.x + px / camera.zoom, y: camera.y + py / camera.zoom };
  }, []);

  /** Nearest vertex within a few pixels of the pointer, or 0. */
  const pick = useCallback(
    (clientX: number, clientY: number): number => {
      const renderer = rendererRef.current;
      if (!renderer || !renderer.hasGraph) return 0;
      const { x, y } = toWorld(clientX, clientY);
      const threshold = 10 / cameraRef.current.zoom;
      const positions = renderer.positionsMirror;
      let best = 0;
      let bestD = threshold * threshold;
      for (let v = 1, i = 2; i < positions.length; v++, i += 2) {
        const dx = positions[i] - x;
        const dy = positions[i + 1] - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      return best;
    },
    [toWorld],
  );

  // ---- loading graphs --------------------------------------------------------

  const loadBytes = useCallback(
    async (name: string, bytes: Uint8Array) => {
      const wasm = wasmRef.current;
      const renderer = rendererRef.current;
      if (!wasm || !renderer) return;
      setStatus({ kind: 'parsing', name });
      setNotice(null);
      // Let the status paint before the (synchronous) parse.
      await new Promise((resolve) => setTimeout(resolve, 30));
      try {
        graphRef.current?.free();
        graphRef.current = null;
        const t0 = performance.now();
        const graph = new wasm.Graph(bytes);
        const parseMs = performance.now() - t0;
        graphRef.current = graph;
        const stats = graph.degreeStats();
        const sizes = graph.componentSizes();
        const degrees = graph.degrees();
        const labels = graph.componentLabels();
        const positions = graph.initialLayout();
        renderer.load(
          {
            vertexCount: graph.vertexCount,
            edges: graph.edges(),
            csrOffsets: graph.csrOffsets(),
            csrTargets: graph.csrTargets(),
            positions,
            componentLabels: labels,
          },
          wasm.edgeLength(),
        );
        setMeta({
          name,
          bytes: bytes.byteLength,
          vertices: graph.vertexCount,
          edges: graph.edgeCount,
          selfLoops: graph.selfLoopsDropped,
          duplicates: graph.duplicatesDropped,
          heapBytes: graph.heapBytes,
          degree: { min: stats.min, max: stats.max, mean: stats.mean, median: stats.median },
          components: sizes.length,
          largest: sizes[0] ?? 0,
          smallest: sizes[sizes.length - 1] ?? 0,
          degrees,
          componentSizes: sizes,
          parseMs,
        });
        setSearch(null);
        setDiameter(null);
        setSelected(0);
        setHovered(0);
        setRootInput('1');
        setReveal(0);
        setPlaying(false);
        const willSimulate = graph.vertexCount <= SIMULATION_LIMIT;
        setSimulate(willSimulate);
        renderer.setSimulate(willSimulate);
        renderer.setSearch(null);
        renderer.setSelected(0);
        renderer.setHovered(0);
        setStatus({ kind: 'ready' });
        // The mirror is filled synchronously by load(); fit on the next frame
        // so the canvas has its size, then follow the simulation.
        autoFit.current = true;
        requestAnimationFrame(fit);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setNotice(`Could not load ${name}: ${message}`);
        setStatus({ kind: 'ready' });
      }
    },
    [fit],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setNotice(
          `${file.name} is ${formatBytes(file.size)}; the observatory accepts files up to ${formatBytes(MAX_FILE_BYTES)}.`,
        );
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadBytes(file.name, bytes);
    },
    [loadBytes],
  );

  const loadExample = useCallback(() => {
    void loadBytes('sample.txt', new TextEncoder().encode(FIGURE_ONE));
  }, [loadBytes]);

  /** Unloads the graph: back to the empty stage, memory returned to wasm. */
  const closeGraph = useCallback(() => {
    setSearch((current) => {
      current?.result.free();
      return null;
    });
    graphRef.current?.free();
    graphRef.current = null;
    rendererRef.current?.unload();
    setMeta(null);
    setDiameter(null);
    setSelected(0);
    setHovered(0);
    setReveal(0);
    setPlaying(false);
    setHelpOpen(false);
    setNotice(null);
  }, []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  // ---- searches --------------------------------------------------------------

  const runSearch = useCallback(
    (which: SearchKindName, root: number) => {
      const wasm = wasmRef.current;
      const graph = graphRef.current;
      const renderer = rendererRef.current;
      if (!wasm || !graph || !renderer) return;
      try {
        search?.result.free();
        const result = graph.search(
          which === 'bfs' ? wasm.SearchKind.Bfs : wasm.SearchKind.Dfs,
          root,
        );
        const levels = result.levels();
        const parents = result.parents();
        const ranks = result.ranks();
        renderer.setSearch({ kind: which, levels, ranks, parents, depth: result.depth });
        setSearch({
          kind: which,
          root,
          depth: result.depth,
          reached: result.reached,
          elapsedMs: result.elapsedMs,
          levels,
          parents,
          levelSizes: result.levelSizes(),
          order: result.order(),
          ranks,
          result,
        });
        setSelected(root);
        renderer.setSelected(root);
        revealRef.current = 0;
        setReveal(0);
        renderer.setReveal(0);
        setPlaying(true);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [search],
  );

  // The reveal animation: discovery ranks light up over a duration that
  // grows slowly with the tree, so small graphs stay watchable and large
  // ones finish within seconds.
  useEffect(() => {
    if (!playing || !search) return;
    const total = search.reached;
    const duration = Math.min(8000, Math.max(1600, total * 6));
    rendererRef.current?.setRevealRate((Math.max(total - 1, 1) / duration) * 1000);
    let frame = 0;
    let start: number | null = null;
    const from = revealRef.current >= total - 1 ? 0 : revealRef.current;
    const tick = (now: number) => {
      if (start === null) start = now - (from / Math.max(total - 1, 1)) * duration;
      const t = Math.min(1, (now - start) / duration);
      const rank = t * (total - 1);
      revealRef.current = rank;
      setReveal(rank);
      rendererRef.current?.setReveal(rank);
      if (followRef.current) fitDiscovered(search.ranks, rank);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, search, fitDiscovered]);

  const followRef = useRef(false);
  followRef.current = follow;

  const scrub = (rank: number) => {
    setPlaying(false);
    revealRef.current = rank;
    setReveal(rank);
    rendererRef.current?.setReveal(rank);
    if (follow && search) fitDiscovered(search.ranks, rank);
  };

  /** Moves the timeline to a level: a BFS shows the whole level, a DFS jumps
      to the first vertex discovered at that depth. */
  const scrubToLevel = (level: number) => {
    if (!search) return;
    let rank = 0;
    if (search.kind === 'bfs') {
      for (let l = 0; l <= level; l++) rank += search.levelSizes[l];
      rank -= 1;
    } else {
      while (rank < search.order.length - 1 && search.levels[search.order[rank]] !== level) rank++;
    }
    scrub(Math.max(0, Math.min(rank, search.reached - 1)));
  };

  /** The level of the vertex the timeline is at. */
  const revealLevel = search ? search.levels[search.order[Math.round(reveal)]] : 0;

  const downloadTree = () => {
    if (!search || !meta) return;
    const blob = new Blob([search.result.toText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.name.replace(/\.[^.]+$/, '')}.${search.kind}.${search.root}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSummary = () => {
    const graph = graphRef.current;
    if (!graph || !meta) return;
    const blob = new Blob([graph.summary()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.name.replace(/\.[^.]+$/, '')}.summary.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runDiameter = async () => {
    const wasm = wasmRef.current;
    const graph = graphRef.current;
    if (!wasm || !graph) return;
    setDiameterBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const budget = Math.max(1, Number.parseInt(diameterBudget, 10) || 1);
      const result = graph.diameter(wasm.DiameterKind[diameterMethod], budget);
      setDiameter({
        method: DIAMETER_METHODS.find((m) => m.id === diameterMethod)?.label ?? diameterMethod,
        value: result.value,
        from: result.from,
        to: result.to,
        bfsCount: result.bfsCount,
        isExact: result.isExact,
        cancelled: result.cancelled,
        elapsedMs: result.elapsedMs,
      });
      result.free();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDiameterBusy(false);
    }
  };

  // ---- pointer interaction ---------------------------------------------------

  /** True when the event started on the canvas itself, not on a floating control. */
  const onCanvas = (event: { target: EventTarget | null; currentTarget: HTMLDivElement }) =>
    event.target === event.currentTarget || event.target instanceof HTMLCanvasElement;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!meta || event.button !== 0 || !onCanvas(event)) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    autoFit.current = false;
    cancelAnimationFrame(glideFrame.current);
    const g = gesture.current;
    g.pointerId = event.pointerId;
    g.startX = event.clientX;
    g.startY = event.clientY;
    g.camX = cameraRef.current.x;
    g.camY = cameraRef.current.y;
    const v = pick(event.clientX, event.clientY);
    g.vertex = v;
    g.mode = v ? 'maybe-click' : 'pan';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!meta) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const g = gesture.current;
    const { clientX, clientY } = event;
    if (g.mode === 'pan') {
      if (followRef.current) setFollow(false);
      const zoom = cameraRef.current.zoom;
      applyCamera({
        x: g.camX - (clientX - g.startX) / zoom,
        y: g.camY - (clientY - g.startY) / zoom,
        zoom,
      });
      return;
    }
    if (g.mode === 'maybe-click') {
      const moved = Math.hypot(clientX - g.startX, clientY - g.startY);
      if (moved > 4) {
        g.mode = 'drag';
        const { x, y } = toWorld(clientX, clientY);
        renderer.beginDrag(g.vertex, x, y);
      }
      return;
    }
    if (g.mode === 'drag') {
      const { x, y } = toWorld(clientX, clientY);
      renderer.drag(x, y);
      setPointer({ x: clientX, y: clientY });
      return;
    }
    // Hover: pick at most once per frame (nothing under the floating controls).
    setPointer({ x: clientX, y: clientY });
    if (hoverFrame.current) return;
    const overCanvas = onCanvas(event);
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const v = overCanvas ? pick(clientX, clientY) : 0;
      setHovered(v);
      renderer.setHovered(v);
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current;
    const g = gesture.current;
    if (g.mode === 'maybe-click' && g.vertex) {
      setSelected(g.vertex);
      setRootInput(String(g.vertex));
      renderer?.setSelected(g.vertex);
    }
    if (g.mode === 'drag') {
      renderer?.endDrag();
    }
    g.mode = 'none';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerLeave = () => {
    setPointer(null);
    if (hovered) {
      setHovered(0);
      rendererRef.current?.setHovered(0);
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!meta) return;
    const stage = stageRef.current;
    if (!stage) return;
    autoFit.current = false;
    cancelAnimationFrame(glideFrame.current);
    if (followRef.current) setFollow(false);
    const camera = cameraRef.current;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const zoom = Math.min(80, Math.max(0.005, camera.zoom * factor));
    // Zoom around the cursor: the world point under it stays put.
    const rect = stage.getBoundingClientRect();
    const px = event.clientX - rect.left - rect.width / 2;
    const py = event.clientY - rect.top - rect.height / 2;
    applyCamera({
      x: camera.x + px / camera.zoom - px / zoom,
      y: camera.y + py / camera.zoom - py / zoom,
      zoom,
    });
  };

  // Wheel events must be non-passive to prevent page scroll; React attaches
  // them passively, so register natively.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const prevent = (event: WheelEvent) => event.preventDefault();
    stage.addEventListener('wheel', prevent, { passive: false });
    return () => stage.removeEventListener('wheel', prevent);
  }, []);

  // Latest search state for the key handler, without re-subscribing every frame.
  const keysRef = useRef({ search, revealLevel: 0, scrub, scrubToLevel });
  keysRef.current = { search, revealLevel, scrub, scrubToLevel };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      const k = keysRef.current;
      if (k.search && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        // BFS: a level up or down; DFS: ten vertices.
        event.preventDefault();
        const dir = event.key === 'ArrowUp' ? 1 : -1;
        if (k.search.kind === 'bfs') {
          k.scrubToLevel(Math.max(0, Math.min(k.search.depth, k.revealLevel + dir)));
        } else {
          k.scrub(
            Math.max(0, Math.min(k.search.reached - 1, Math.round(revealRef.current) + dir * 10)),
          );
        }
        return;
      }
      if (k.search && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowRight' ? 1 : -1);
        k.scrub(Math.max(0, Math.min(k.search.reached - 1, Math.round(revealRef.current) + step)));
        return;
      }
      if (event.key === 'Escape') {
        setHelpOpen(false);
        setSelected(0);
        rendererRef.current?.setSelected(0);
      } else if (event.key === ' ' && search) {
        event.preventDefault();
        setPlaying((p) => !p);
      } else if (event.key === 'f' && meta) {
        fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, meta, search]);

  useEffect(() => {
    const onResize = () => {
      if (meta) rendererRef.current?.setCamera(cameraRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [meta]);

  /** Zooms around the centre of the stage. */
  const zoomBy = useCallback(
    (factor: number) => {
      autoFit.current = false;
      const camera = cameraRef.current;
      applyCamera({ ...camera, zoom: Math.min(80, Math.max(0.005, camera.zoom * factor)) });
    },
    [applyCamera],
  );

  const toggleFullscreen = () => {
    const el = appRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  };

  useEffect(() => {
    if (!helpOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!helpRef.current?.contains(event.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [helpOpen]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Vertex indices: a 2D canvas over the WebGPU one, redrawn every frame
  // from the position mirror. Skipped when the discs are too small to read.
  useEffect(() => {
    const canvas = labelCanvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || !meta || !showLabels) {
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const renderer = rendererRef.current;
      if (!renderer) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = stage.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const camera = cameraRef.current;
      const radius = Math.min(12, Math.max(1.5, 3.5 * Math.sqrt(camera.zoom)));
      if (radius < 5) return;
      const positions = renderer.positionsMirror;
      const fontSize = Math.min(11, Math.round(radius * 1.05));
      ctx.font = `500 ${fontSize}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      let drawn = 0;
      for (let v = 1, i = 2; i < positions.length && drawn < 3000; v++, i += 2) {
        const x = (positions[i] - camera.x) * camera.zoom + cx;
        const y = (positions[i + 1] - camera.y) * camera.zoom + cy;
        if (x < -20 || y < -20 || x > rect.width + 20 || y > rect.height + 20) continue;
        ctx.fillText(String(v), x, y + 0.5);
        drawn += 1;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [meta, showLabels]);

  // ---- derived -----------------------------------------------------------

  const root = Number.parseInt(rootInput, 10);
  const rootValid = meta !== null && Number.isInteger(root) && root >= 1 && root <= meta.vertices;

  const hoverInfo = useMemo(() => {
    if (!hovered || !meta) return null;
    const degree = meta.degrees[hovered];
    if (!search) return { degree, level: null as number | null, parent: null as number | null };
    const level = search.levels[hovered];
    return {
      degree,
      level: level === UNREACHED ? null : level,
      parent: level === UNREACHED || level === 0 ? null : search.parents[hovered],
    };
  }, [hovered, meta, search]);

  const canvasVisible = meta !== null;

  return (
    <div
      ref={appRef}
      className={`${styles.app} ${dragOver ? styles.dragOver : ''} ${fullscreen ? styles.fullscreen : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={onFileChange}
      />

      <aside className={`${styles.sidebar} ${meta ? '' : styles.sidebarEmpty}`}>
        {meta ? (
          <>
            <Panel
              title="Graph"
              actions={
                <>
                  <IconButton
                    label="Load a graph file"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} />
                  </IconButton>
                  <IconButton label="Download the summary file" onClick={downloadSummary}>
                    <Download size={14} />
                  </IconButton>
                  <IconButton label="Close the graph" onClick={closeGraph}>
                    <X size={14} />
                  </IconButton>
                </>
              }
            >
              <div className={styles.fileRow}>
                <span className={`mono ${styles.fileName}`} title={meta.name}>
                  {meta.name}
                </span>
                <span className={styles.fileMeta}>
                  {formatBytes(meta.bytes)} · parsed in {formatMs(meta.parseMs)}
                </span>
              </div>
              <div className={styles.tiles}>
                <Tile label="Vertices" value={formatInt(meta.vertices)} />
                <Tile label="Edges" value={formatInt(meta.edges)} />
                <Tile
                  label="Components"
                  value={formatInt(meta.components)}
                  hint={`largest ${formatCompact(meta.largest)}`}
                />
                <Tile
                  label="Mean degree"
                  value={meta.degree.mean.toFixed(2)}
                  hint={`${meta.degree.min} – ${meta.degree.max} · median ${meta.degree.median}`}
                />
              </div>
              <DegreeHistogram degrees={meta.degrees} max={meta.degree.max} />
              <ComponentBar sizes={meta.componentSizes} total={meta.vertices} />
              <div className={`${styles.chips} ${styles.shedFirst}`}>
                <span className={styles.chip}>{meta.selfLoops} loops dropped</span>
                <span className={styles.chip}>{meta.duplicates} duplicates dropped</span>
                <span className={styles.chip}>CSR {formatBytes(meta.heapBytes)}</span>
              </div>
            </Panel>

            <Panel
              title="Search"
              grow
              actions={
                search && (
                  <>
                    <IconButton label="Download the tree file" onClick={downloadTree}>
                      <Download size={14} />
                    </IconButton>
                    <IconButton
                      label="Clear the search"
                      onClick={() => {
                        search.result.free();
                        setSearch(null);
                        setPlaying(false);
                        rendererRef.current?.setSearch(null);
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                )
              }
            >
              <div className={styles.searchRow}>
                <div className={styles.field}>
                  <label htmlFor="root">Origin</label>
                  <input
                    id="root"
                    className={`mono ${styles.input}`}
                    inputMode="numeric"
                    value={rootInput}
                    onChange={(event) => setRootInput(event.target.value)}
                    onBlur={() => {
                      if (rootValid) {
                        setSelected(root);
                        rendererRef.current?.setSelected(root);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && rootValid) runSearch(kind, root);
                    }}
                    placeholder="click a vertex"
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Traversal</span>
                  <div
                    className={styles.segmented}
                    role="radiogroup"
                    aria-label="Traversal"
                    data-active={kind}
                  >
                    <span className={styles.thumb} aria-hidden="true" />
                    {(['bfs', 'dfs'] as const).map((which) => (
                      <button
                        key={which}
                        type="button"
                        role="radio"
                        aria-checked={kind === which}
                        className={kind === which ? styles.segmentActive : styles.segment}
                        onClick={() => setKind(which)}
                      >
                        {which.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.run}
                  disabled={!rootValid}
                  onClick={() => rootValid && runSearch(kind, root)}
                  aria-label={`Run ${kind.toUpperCase()} from ${rootValid ? root : 'the origin'}`}
                  title={`Run ${kind.toUpperCase()} from ${rootValid ? root : 'the origin'}`}
                >
                  <Play size={15} aria-hidden="true" />
                </button>
              </div>

              {search ? (
                <div className={styles.result}>
                  <div className={styles.stats}>
                    <Stat label="Reached" value={formatInt(search.reached)} />
                    <Stat
                      label={search.kind === 'bfs' ? 'Eccentricity' : 'Depth'}
                      value={String(search.depth)}
                    />
                    <Stat label="Time" value={formatMs(search.elapsedMs)} />
                  </div>
                  {search.kind === 'bfs' ? (
                    <LevelProfile
                      sizes={search.levelSizes}
                      kind={search.kind}
                      current={revealLevel}
                      onSelect={scrubToLevel}
                    />
                  ) : (
                    <DepthTrace
                      order={search.order}
                      levels={search.levels}
                      depth={search.depth}
                      reveal={reveal}
                      onScrub={scrub}
                    />
                  )}
                  <div className={styles.playback}>
                    <IconButton
                      label={playing ? 'Pause' : reveal >= search.reached - 1 ? 'Replay' : 'Play'}
                      onClick={() => setPlaying((p) => !p)}
                      accent
                    >
                      {playing ? (
                        <Pause size={14} />
                      ) : reveal >= search.reached - 1 ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Play size={14} />
                      )}
                    </IconButton>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(search.reached - 1, 0)}
                      step={1}
                      value={Math.round(reveal)}
                      onChange={(event) => scrub(Number(event.target.value))}
                      aria-label="Discovery progress"
                    />
                    <span className={`mono ${styles.hint}`}>
                      {formatInt(Math.min(Math.round(reveal) + 1, search.reached))}
                    </span>
                  </div>
                </div>
              ) : (
                <p className={styles.hint}>
                  Click a vertex on the canvas to make it the origin, or type its number.
                </p>
              )}
            </Panel>

            <section className={`${styles.panel} ${styles.panelCollapsible}`}>
              <button
                type="button"
                className={styles.panelToggle}
                onClick={() => setDiameterOpen((o) => !o)}
                aria-expanded={diameterOpen}
              >
                <span className={styles.panelTitle}>Diameter</span>
                {diameter && !diameterOpen && (
                  <span className={`mono ${styles.panelSummary}`}>
                    {diameter.isExact && !diameter.cancelled ? '' : '≥ '}
                    {diameter.value} · {formatCompact(diameter.bfsCount)} BFS
                  </span>
                )}
                <ChevronDown
                  size={14}
                  className={diameterOpen ? styles.chevronOpen : styles.chevron}
                  aria-hidden="true"
                />
              </button>
              <div className={styles.collapse} data-open={diameterOpen} inert={!diameterOpen}>
                <div className={styles.collapseInner}>
                  <div className={styles.panelBody}>
                    <div className={styles.searchRow}>
                      <div className={styles.field}>
                        <label htmlFor="method">Method</label>
                        <select
                          id="method"
                          className={styles.select}
                          value={diameterMethod}
                          onChange={(event) =>
                            setDiameterMethod(event.target.value as typeof diameterMethod)
                          }
                        >
                          {DIAMETER_METHODS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={`${styles.field} ${styles.fieldNarrow}`}>
                        <label htmlFor="budget">BFS budget</label>
                        <input
                          id="budget"
                          className={`mono ${styles.input}`}
                          inputMode="numeric"
                          value={diameterBudget}
                          onChange={(event) => setDiameterBudget(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className={styles.row}>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => void runDiameter()}
                        disabled={diameterBusy}
                      >
                        <Ruler size={14} aria-hidden="true" />
                        {diameterBusy ? 'Computing…' : 'Compute'}
                      </button>
                      {diameter && (
                        <span className={styles.diameterResult}>
                          <span className={`mono ${styles.diameterValue}`}>
                            {diameter.isExact && !diameter.cancelled ? '' : '≥ '}
                            {diameter.value}
                          </span>
                          <span className={styles.hint}>
                            {diameter.from} ↔ {diameter.to} · {formatInt(diameter.bfsCount)} BFS
                            {diameter.cancelled ? ' (budget hit)' : ''} ·{' '}
                            {formatMs(diameter.elapsedMs)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <Panel title="Graph">
              <div className={styles.starters}>
                <button
                  type="button"
                  className={styles.starter}
                  onClick={loadExample}
                  disabled={status.kind !== 'ready'}
                >
                  <FlaskConical size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.starterTitle}>Sample</span>
                  <span className={styles.starterHint}>5 vertices · 5 edges</span>
                </button>
                <button
                  type="button"
                  className={styles.starter}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status.kind !== 'ready'}
                >
                  <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.starterTitle}>Open a file</span>
                  <span className={styles.starterHint}>.txt · course format</span>
                </button>
              </div>
            </Panel>
            <Panel title="Controls" grow>
              <ul className={styles.keys}>
                {CONTROLS.map(([key, does]) => (
                  <li key={key}>
                    <kbd className="mono">{key}</kbd>
                    <span>{does}</span>
                  </li>
                ))}
              </ul>
              <p className={`comment ${styles.keysNote}`}>
                {'// rust → wasm · webgpu · runs in your tab'}
              </p>
            </Panel>
          </>
        )}
      </aside>

      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        onDoubleClick={(event) => {
          if (onCanvas(event) && !pick(event.clientX, event.clientY)) fit();
        }}
        style={{
          cursor: gesture.current.mode === 'pan' ? 'grabbing' : hovered ? 'pointer' : 'default',
        }}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ opacity: canvasVisible ? 1 : 0 }}
          aria-label="Graph canvas"
        />
        <canvas ref={labelCanvasRef} className={styles.labels} aria-hidden="true" />

        {!meta && <Constellation />}
        {!meta && (
          <div className={styles.empty}>
            {status.kind === 'unsupported' ? (
              <div className={styles.emptyCard}>
                <h2>WebGPU is not available</h2>
                <p>{status.message}</p>
                <p className={styles.hint}>
                  The observatory needs a browser with WebGPU (Chrome, Edge, Safari 26 or Firefox
                  141 and newer).
                </p>
              </div>
            ) : status.kind === 'failed' ? (
              <div className={styles.emptyCard}>
                <h2>Something went wrong</h2>
                <p>{status.message}</p>
              </div>
            ) : (
              <div className={styles.dropCard}>
                <span className={styles.dropIcon} aria-hidden="true">
                  <Upload size={22} strokeWidth={1.5} />
                </span>
                <span className={styles.dropTitle}>
                  {status.kind === 'booting'
                    ? 'Starting the library…'
                    : status.kind === 'parsing'
                      ? `Parsing ${status.name}…`
                      : 'Drop a graph file anywhere'}
                </span>
                <div className={`mono ${styles.format}`} aria-label="File format">
                  <span className={styles.formatName}>sample.txt</span>
                  <span />
                  {FORMAT_LINES.map(([line, note]) => (
                    <Fragment key={line}>
                      <span>{line}</span>
                      <span className={styles.formatNote}>{note}</span>
                    </Fragment>
                  ))}
                </div>
                <div className={styles.dropActions}>
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status.kind !== 'ready'}
                  >
                    Browse files
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={loadExample}
                    disabled={status.kind !== 'ready'}
                  >
                    Try the sample
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {meta && status.kind === 'parsing' && (
          <div className={styles.overlay}>Parsing {status.name}…</div>
        )}

        {meta && (
          <>
            {/* Controls, top left */}
            <div ref={helpRef} className={`${styles.floating} ${styles.floatingTopLeft}`}>
              <div className={styles.cluster}>
                <IconButton
                  label={helpOpen ? 'Hide the controls' : 'Show the controls'}
                  pressed={helpOpen}
                  onClick={() => setHelpOpen((o) => !o)}
                >
                  <CircleHelp size={15} />
                </IconButton>
              </div>
              {helpOpen && (
                <div className={styles.help} role="dialog" aria-label="Controls">
                  <span className={`label ${styles.helpTitle}`}>Controls</span>
                  <ul className={styles.keys}>
                    {CONTROLS.map(([key, does]) => (
                      <li key={key + does}>
                        <kbd className="mono">{key}</kbd>
                        <span>{does}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Layout tools, top right */}
            <div className={`${styles.floating} ${styles.floatingTopRight}`}>
              <div className={styles.cluster}>
                <IconButton
                  label={simulate ? 'Pause the force simulation' : 'Resume the force simulation'}
                  pressed={simulate}
                  onClick={() => {
                    const next = !simulate;
                    setSimulate(next);
                    rendererRef.current?.setSimulate(next);
                  }}
                >
                  <Magnet size={15} />
                </IconButton>
                <IconButton
                  label="Reheat the simulation"
                  onClick={() => {
                    rendererRef.current?.reheat(1);
                  }}
                  disabled={!simulate}
                >
                  <RefreshCw size={15} />
                </IconButton>
                <IconButton
                  label={showLabels ? 'Hide vertex numbers' : 'Show vertex numbers'}
                  pressed={showLabels}
                  onClick={() => setShowLabels((on) => !on)}
                >
                  <Hash size={15} />
                </IconButton>
                <IconButton
                  label={
                    follow
                      ? 'Stop following the search'
                      : 'Follow the search (keep discovered vertices in view)'
                  }
                  pressed={follow}
                  onClick={() => {
                    const next = !follow;
                    setFollow(next);
                    if (next && search) fitDiscovered(search.ranks, revealRef.current);
                  }}
                >
                  <Focus size={15} />
                </IconButton>
              </div>
            </div>

            {/* View tools, bottom right */}
            <div className={`${styles.floating} ${styles.floatingBottomRight}`}>
              <div className={`${styles.cluster} ${styles.clusterVertical}`}>
                <IconButton label="Zoom in" onClick={() => zoomBy(1.4)}>
                  <Plus size={15} />
                </IconButton>
                <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
                  <Minus size={15} />
                </IconButton>
                <IconButton label="Fit the graph to the view (F)" onClick={fit}>
                  <Maximize2 size={15} />
                </IconButton>
                <IconButton
                  label={fullscreen ? 'Exit full screen' : 'Full screen'}
                  onClick={toggleFullscreen}
                >
                  {fullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
                </IconButton>
              </div>
            </div>

            <div className={styles.legend}>
              {search ? (
                <>
                  <span className={styles.swatchA} /> level 0
                  <span className={styles.swatchBar} />
                  <span className={styles.swatchB} /> level {search.depth}
                  <span className={styles.legendSep} />
                  <span className={styles.swatchDim} /> not reached
                </>
              ) : selected ? (
                `Origin: vertex ${selected}`
              ) : (
                'Click a vertex to choose the origin'
              )}
            </div>
          </>
        )}

        {meta && hovered !== 0 && pointer && hoverInfo && (
          <div
            className={styles.tooltip}
            style={{ left: pointer.x + 14, top: pointer.y + 14 }}
            role="status"
          >
            <span className="mono">vertex {hovered}</span>
            <span>degree {hoverInfo.degree}</span>
            {search &&
              (hoverInfo.level === null ? (
                <span>not reached</span>
              ) : (
                <span>
                  level {hoverInfo.level}
                  {hoverInfo.parent !== null && ` · parent ${hoverInfo.parent}`}
                </span>
              ))}
          </div>
        )}
      </div>

      {notice && (
        <div className={styles.notice} role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  actions,
  grow = false,
  children,
}: {
  title: string;
  actions?: ReactNode;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${styles.panel} ${grow ? styles.panelGrow : ''}`}>
      <header className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {actions && <div className={styles.panelActions}>{actions}</div>}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
  pressed,
  accent = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.iconButton} ${accent ? styles.iconButtonAccent : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** A compact stat: small label over a small blue mono value. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={`label ${styles.tileLabel}`}>{label}</span>
      <span className={`mono ${styles.statValue}`}>{value}</span>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.tile}>
      <span className={`label ${styles.tileLabel}`}>{label}</span>
      <span className={`mono ${styles.tileValue}`}>{value}</span>
      {hint && <span className={styles.tileHint}>{hint}</span>}
    </div>
  );
}

/** How many vertices have each degree, as a tiny bar chart. */
function DegreeHistogram({ degrees, max }: { degrees: Uint32Array; max: number }) {
  const bars = useMemo(() => {
    const counts = new Uint32Array(max + 1);
    for (let v = 1; v < degrees.length; v++) counts[degrees[v]] += 1;
    // Bucket wide ranges to at most 48 bars.
    const buckets = Math.min(48, max + 1);
    const per = (max + 1) / buckets;
    const out: { from: number; to: number; count: number }[] = [];
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor(b * per);
      const to = Math.max(from, Math.floor((b + 1) * per) - 1);
      let count = 0;
      for (let d = from; d <= to; d++) count += counts[d];
      out.push({ from, to, count });
    }
    return out;
  }, [degrees, max]);
  const peak = bars.reduce((m, b) => Math.max(m, b.count), 1);
  return (
    <div className={`${styles.chart} ${styles.shedThird}`} aria-label="Degree distribution">
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>Degree distribution</span>
        <span className={styles.tileHint}>vertices per degree</span>
      </div>
      <div className={styles.bars}>
        {bars.map((b) => (
          <span
            key={b.from}
            style={{ height: `${Math.max(b.count > 0 ? 3 : 0, (b.count / peak) * 100)}%` }}
            title={`degree ${b.from === b.to ? b.from : `${b.from}–${b.to}`}: ${formatInt(b.count)}`}
          />
        ))}
      </div>
      <div className={styles.axis}>
        <span>0</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

/** The components as proportional segments, largest first. */
function ComponentBar({ sizes, total }: { sizes: Uint32Array; total: number }) {
  const shown = Math.min(sizes.length, 8);
  let rest = 0;
  for (let i = shown; i < sizes.length; i++) rest += sizes[i];
  return (
    <div className={`${styles.chart} ${styles.shedSecond}`} aria-label="Component sizes">
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>Components</span>
        <span className={styles.tileHint}>
          {sizes.length === 1 ? 'connected' : `smallest ${formatInt(sizes[sizes.length - 1])}`}
        </span>
      </div>
      <div className={styles.segments}>
        {Array.from({ length: shown }, (_, i) => (
          <span
            key={i}
            style={{ flexGrow: sizes[i], opacity: 1 - (i / Math.max(shown, 2)) * 0.7 }}
            title={`component ${i + 1}: ${formatInt(sizes[i])} vertices`}
          />
        ))}
        {rest > 0 && (
          <span
            className={styles.segmentRest}
            style={{ flexGrow: rest }}
            title={`${formatInt(sizes.length - shown)} more components: ${formatInt(rest)} vertices`}
          />
        )}
      </div>
      <div className={styles.axis}>
        <span>
          {((sizes[0] / total) * 100).toFixed(sizes[0] === total ? 0 : 1)}% in the largest
        </span>
        <span>{formatInt(total)}</span>
      </div>
    </div>
  );
}

/** Vertices per level as horizontal bars, level 0 at the bottom; the index
    on the left is a button that moves the timeline to that level. */
function LevelProfile({
  sizes,
  kind,
  current,
  onSelect,
}: {
  sizes: Uint32Array;
  kind: SearchKindName;
  current: number;
  onSelect: (level: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // DFS trees can be thousands of levels deep; bucket them to 64 rows.
  const rows = useMemo(() => {
    const limit = 64;
    const out: { from: number; to: number; count: number }[] = [];
    if (sizes.length <= limit) {
      sizes.forEach((count, i) => out.push({ from: i, to: i, count }));
    } else {
      const per = sizes.length / limit;
      for (let b = 0; b < limit; b++) {
        const from = Math.floor(b * per);
        const to = Math.max(from, Math.floor((b + 1) * per) - 1);
        let count = 0;
        for (let i = from; i <= to; i++) count += sizes[i];
        out.push({ from, to, count });
      }
    }
    return out;
  }, [sizes]);
  const peak = rows.reduce((m, r) => Math.max(m, r.count), 1);
  const noun = kind === 'bfs' ? 'level' : 'depth';

  // Keep the current level in view while the wave plays.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>('[data-current="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <div className={`${styles.chart} ${styles.shedFourth}`} aria-label={`Vertices per ${noun}`}>
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>Vertices per {noun}</span>
      </div>
      <div ref={listRef} className={styles.levels}>
        {rows.map((row) => {
          const lit = row.from <= current;
          const isCurrent = current >= row.from && current <= row.to;
          return (
            <div
              key={row.from}
              className={`${styles.level} ${lit ? styles.levelLit : ''} ${isCurrent ? styles.levelCurrent : ''}`}
              data-current={isCurrent ? 'true' : undefined}
            >
              <button
                type="button"
                className={`mono ${styles.levelIndex}`}
                onClick={() => onSelect(row.from)}
                title={`Go to ${noun} ${row.from}`}
              >
                {row.from === row.to ? row.from : `${row.from}–${row.to}`}
              </button>
              <span className={styles.levelTrack}>
                <span
                  className={styles.levelBar}
                  style={{ width: `${Math.max(1.5, (row.count / peak) * 100)}%` }}
                />
              </span>
              <span className={`mono ${styles.levelCount}`}>{formatInt(row.count)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A DFS as the stack depth over discovery time: it plunges and backtracks.
    Click or drag on the trace to move the timeline. */
function DepthTrace({
  order,
  levels,
  depth,
  reveal,
  onScrub,
}: {
  order: Uint32Array;
  levels: Uint32Array;
  depth: number;
  reveal: number;
  onScrub: (rank: number) => void;
}) {
  const W = 300;
  const H = 72;
  const total = order.length;
  // Downsample to at most W columns, keeping the deepest point of each.
  const path = useMemo(() => {
    const columns = Math.min(W, total);
    const pts: string[] = [];
    for (let c = 0; c < columns; c++) {
      const from = Math.floor((c * total) / columns);
      const to = Math.max(from, Math.floor(((c + 1) * total) / columns) - 1);
      let deepest = 0;
      for (let r = from; r <= to; r++) deepest = Math.max(deepest, levels[order[r]]);
      const x = (c / Math.max(columns - 1, 1)) * W;
      const y = H - (deepest / Math.max(depth, 1)) * (H - 2) - 1;
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' L');
  }, [order, levels, depth, total]);
  const cursorX = (Math.min(reveal, total - 1) / Math.max(total - 1, 1)) * W;
  const currentDepth = levels[order[Math.min(Math.round(reveal), total - 1)]];

  const scrubAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onScrub(Math.round(t * (total - 1)));
  };

  return (
    <div className={`${styles.chart} ${styles.shedFourth}`} aria-label="Depth over the traversal">
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>Depth over the traversal</span>
        <span className={`mono ${styles.tileHint}`}>
          {currentDepth} / {depth}
        </span>
      </div>
      <svg
        className={styles.trace}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubAt(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubAt(event);
        }}
        role="slider"
        aria-label="Discovery progress"
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={Math.round(reveal)}
        tabIndex={0}
      >
        <path className={styles.traceDim} d={`M${path}`} />
        <clipPath id="trace-lit">
          <rect x={0} y={0} width={cursorX} height={H} />
        </clipPath>
        <path
          className={styles.traceLit}
          d={`M${path} L${W} ${H} L0 ${H} Z`}
          clipPath="url(#trace-lit)"
        />
        <path className={styles.traceLine} d={`M${path}`} clipPath="url(#trace-lit)" />
        <line className={styles.traceCursor} x1={cursorX} x2={cursorX} y1={0} y2={H} />
      </svg>
    </div>
  );
}
