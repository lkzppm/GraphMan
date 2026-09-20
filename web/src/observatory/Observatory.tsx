'use client';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Download,
  Expand,
  FlaskConical,
  Focus,
  Hash,
  Highlighter,
  Magnet,
  Orbit,
  Rows3,
  Shapes,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Ruler,
  Scan,
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
import { useT } from '@/i18n/LocaleProvider';
import type { Dictionary } from '@/i18n';
import styles from './Observatory.module.css';

type Strings = Dictionary['observatory'];

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
  /** Component id per vertex (1 = largest, ranked by size). */
  componentLabels: Uint32Array;
  /** Edges, minimum and maximum degree per component (index = id, 0 unused). */
  componentEdges: Uint32Array;
  componentDegree: { min: Uint32Array; max: Uint32Array };
  parseMs: number;
}

type SearchKindName = 'bfs' | 'dfs';
/** What the panel asks for: the whole traversal, or the path to a destination. */
type SearchMode = 'search' | 'distance';

interface Search {
  kind: SearchKindName;
  root: number;
  /** The distance query's other end (0 otherwise). */
  target: number;
  /** The shortest path root → target, `null` when the target is not reached. */
  path: Uint32Array | null;
  depth: number;
  reached: number;
  /** Discovery ranks the timeline covers: all of them, or up to the target. */
  span: number;
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

/** The wasm `DiameterKind` names; their labels live in the dictionary. */
const DIAMETER_METHODS = ['Sweep', 'IFub', 'Bounds', 'Exact'] as const;

const MAX_FILE_BYTES = 512 * 1024 * 1024;

type LayoutId = 'force' | 'radial' | 'layered' | 'degree';

/** The layouts of the canvas menu (words in the dictionary); the level-based ones start at the origin. */
const LAYOUTS: { id: LayoutId; icon: ReactNode }[] = [
  { id: 'force', icon: <Magnet size={14} /> },
  { id: 'radial', icon: <Orbit size={14} /> },
  { id: 'layered', icon: <Rows3 size={14} /> },
  { id: 'degree', icon: <CircleDashed size={14} /> },
];

/** How long a layout change takes to slide into place. */
const MORPH_MS = 700;
/** Share of the view a framed path fills (the path label floats over the top). */
const PATH_FILL = 0.62;
/** Pointer travel (CSS px) under which a press is a click, not a drag or a pan. */
const CLICK_SLOP = 4;

/** The sample file's lines; the first two carry the format notes. */
const FORMAT_LINES = ['5', '1 2', '2 5', '5 3', '4 5', '1 5'];

export default function Observatory() {
  const t = useT().observatory;
  const tRef = useRef(t);
  tRef.current = t;
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
  const [mode, setMode] = useState<SearchMode>('search');
  const [rootInput, setRootInput] = useState('');
  const [targetInput, setTargetInput] = useState('');
  /** In a distance query, grey everything but the path. */
  const [pathOnly, setPathOnly] = useState(false);
  const [search, setSearch] = useState<Search | null>(null);
  const [reveal, setReveal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [simulate, setSimulate] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [diameterMethod, setDiameterMethod] = useState<(typeof DIAMETER_METHODS)[number]>('IFub');
  const [diameterBudget, setDiameterBudget] = useState('2000');
  const [diameter, setDiameter] = useState<DiameterInfo | null>(null);
  const [diameterBusy, setDiameterBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** The controls popover, top left of the stage. */
  const metaRef = useRef<GraphMeta | null>(null);
  metaRef.current = meta;
  const searchRef = useRef<Search | null>(null);
  searchRef.current = search;
  const [helpOpen, setHelpOpen] = useState(false);
  /** The lit component (1 = largest), 0 for none. */
  const [component, setComponent] = useState(0);
  /** The components browser, in place of the graph summary. */
  const [componentsOpen, setComponentsOpen] = useState(false);
  /** The current layout and its menu. */
  const [layout, setLayout] = useState<LayoutId>('force');
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  /** What the arrow keys drive: the search timeline or the components. */
  const keysTarget = useRef<'search' | 'components'>('search');
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

  /** Glides the camera to frame the vertices `keep` accepts, filling `fill` of the view. */
  const fitVertices = useCallback(
    (keep: (v: number) => boolean, fill = 0.8) => {
      const renderer = rendererRef.current;
      if (!renderer || !renderer.hasGraph) return;
      const positions = renderer.positionsMirror;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let v = 1, i = 2; i < positions.length; v++, i += 2) {
        if (!keep(v)) continue;
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
      const zoom = Math.min((w * fill) / bw, (h * fill) / bh, 6);
      glideTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
    },
    [glideTo],
  );

  /** Frames the vertices discovered up to `rank` (rank → level colours already lit). */
  const fitDiscovered = useCallback(
    (ranks: Uint32Array, rank: number) => {
      const limit = Math.round(rank);
      fitVertices((v) => ranks[v] <= limit);
    },
    [fitVertices],
  );

  /**
   * Frames the positions in `positions` (flat `[x, y, ...]`, slot 0 unused),
   * or only those of the vertices `keep` accepts, gliding.
   */
  const glideToFit = useCallback(
    (positions: Float32Array, keep?: (v: number) => boolean) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let v = 1, i = 2; i < positions.length; v++, i += 2) {
        if (keep && !keep(v)) continue;
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
      glideTo({
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        zoom: Math.min((w * 0.86) / bw, (h * 0.86) / bh, 40),
      });
    },
    [glideTo],
  );

  /**
   * Rearranges the graph: the level layouts start at `root`, the force
   * layout returns to the initial placement and warms the simulation up
   * again. Vertices slide to their new places and the view follows: the
   * whole graph, or with `frame: 'component'` only the root's component
   * (a new search origin re-arranges that one, the rest just makes room).
   */
  const applyLayout = useCallback(
    (id: LayoutId, root: number, frame: 'graph' | 'component' = 'graph') => {
      const wasm = wasmRef.current;
      const graph = graphRef.current;
      const renderer = rendererRef.current;
      if (!wasm || !graph || !renderer) return;
      setLayout(id);
      let positions: Float32Array;
      try {
        positions =
          id === 'force'
            ? graph.initialLayout()
            : graph.layout(
                id === 'radial'
                  ? wasm.LayoutKind.Radial
                  : id === 'layered'
                    ? wasm.LayoutKind.Layered
                    : wasm.LayoutKind.Degree,
                root,
              );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return;
      }
      // The force layout is the simulation's business; the others are
      // exact, so it stays off until asked for (a "relax" step).
      const simulateNext = id === 'force' && graph.vertexCount <= SIMULATION_LIMIT;
      setSimulate(simulateNext);
      renderer.morphTo(positions, MORPH_MS);
      renderer.setSimulate(simulateNext);
      autoFit.current = false;
      const labels = metaRef.current?.componentLabels;
      const home = labels && frame === 'component' ? labels[root] : 0;
      glideToFit(positions, labels && home ? (v) => labels[v] === home : undefined);
    },
    [glideToFit],
  );

  /** The level layouts follow the search: a new origin re-arranges its component. */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const searchRoot = search?.root ?? 0;
  useEffect(() => {
    if (!searchRoot) return;
    const id = layoutRef.current;
    if (id === 'radial' || id === 'layered') applyLayout(id, searchRoot, 'component');
  }, [searchRoot, applyLayout]);

  /** Lights component `c` (0 clears), frames it, and hands the arrow keys to it. */
  const selectComponent = useCallback(
    (c: number) => {
      const labels = metaRef.current?.componentLabels;
      setComponent(c);
      rendererRef.current?.setComponent(c);
      keysTarget.current = c ? 'components' : 'search';
      if (c && labels) {
        autoFit.current = false;
        fitVertices((v) => labels[v] === c);
      }
    },
    [fitVertices],
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
        // Graphs too large to simulate open in the radial layout, rooted in
        // the largest component: the force placement is only a seed for
        // the simulation.
        const willSimulate = graph.vertexCount <= SIMULATION_LIMIT;
        const positions = willSimulate
          ? graph.initialLayout()
          : graph.layout(wasm.LayoutKind.Radial, Math.max(1, labels.indexOf(1)));
        const edges = graph.edges();
        // Per component: edges (by one endpoint's label) and the degree range.
        const componentEdges = new Uint32Array(sizes.length + 1);
        for (let i = 0; i < edges.length; i += 2) componentEdges[labels[edges[i]]] += 1;
        const degreeMin = new Uint32Array(sizes.length + 1).fill(0xffffffff);
        const degreeMax = new Uint32Array(sizes.length + 1);
        for (let v = 1; v < labels.length; v++) {
          const c = labels[v];
          if (degrees[v] < degreeMin[c]) degreeMin[c] = degrees[v];
          if (degrees[v] > degreeMax[c]) degreeMax[c] = degrees[v];
        }
        renderer.load(
          {
            vertexCount: graph.vertexCount,
            edges,
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
          componentLabels: labels,
          componentEdges,
          componentDegree: { min: degreeMin, max: degreeMax },
          parseMs,
        });
        setComponent(0);
        setComponentsOpen(false);
        setLayout(willSimulate ? 'force' : 'radial');
        setSearch(null);
        setDiameter(null);
        setSelected(0);
        setHovered(0);
        setRootInput('1');
        setReveal(0);
        setPlaying(false);
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
        setNotice(tRef.current.couldNotLoad(name, message));
        setStatus({ kind: 'ready' });
      }
    },
    [fit],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setNotice(
          tRef.current.tooLarge(file.name, formatBytes(file.size), formatBytes(MAX_FILE_BYTES)),
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
    // Freed outside the state updater: StrictMode runs updaters twice, and
    // a wasm object freed twice is a null pointer.
    searchRef.current?.result.free();
    setSearch(null);
    graphRef.current?.free();
    graphRef.current = null;
    rendererRef.current?.unload();
    setMeta(null);
    setDiameter(null);
    setComponent(0);
    setComponentsOpen(false);
    setLayout('force');
    setLayoutOpen(false);
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

  const followRef = useRef(false);
  followRef.current = follow;

  const runSearch = useCallback(
    (which: SearchKindName, root: number, target = 0) => {
      const wasm = wasmRef.current;
      const graph = graphRef.current;
      const renderer = rendererRef.current;
      if (!wasm || !graph || !renderer) return;
      keysTarget.current = 'search';
      try {
        search?.result.free();
        const result = graph.search(
          which === 'bfs' ? wasm.SearchKind.Bfs : wasm.SearchKind.Dfs,
          root,
        );
        const levels = result.levels();
        const parents = result.parents();
        const ranks = result.ranks();
        // A distance query is the same traversal, its wave stopping when
        // the target is discovered; the path is read back along the parents
        // (the shortest one for a BFS, the tree path for a DFS).
        let path: Uint32Array | null = null;
        let span = result.reached;
        let order = result.order();
        let levelSizes = result.levelSizes();
        let depth = result.depth;
        if (target && levels[target] !== UNREACHED) {
          path = new Uint32Array(levels[target] + 1);
          for (let v = target, i = path.length - 1; i >= 0; i--, v = parents[v]) path[i] = v;
          // The traversal stops at the target: the sidebar describes only
          // what was visited until then.
          span = ranks[target] + 1;
          order = order.slice(0, span);
          depth = 0;
          for (let r = 0; r < span; r++) depth = Math.max(depth, levels[order[r]]);
          levelSizes = new Uint32Array(depth + 1);
          for (let r = 0; r < span; r++) levelSizes[levels[order[r]]] += 1;
        }
        renderer.setSearch({ kind: which, levels, ranks, parents, depth });
        renderer.setPath(target, path);
        renderer.setPathOnly(pathOnly);
        setSearch({
          kind: which,
          root,
          target,
          path,
          depth,
          reached: span,
          span,
          elapsedMs: result.elapsedMs,
          levels,
          parents,
          levelSizes,
          order,
          ranks,
          result,
        });
        // The search picture is the tree: no selection ring or neighbourhood on the origin.
        setSelected(0);
        renderer.setSelected(0);
        revealRef.current = 0;
        setReveal(0);
        renderer.setReveal(0);
        setPlaying(true);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [search, pathOnly],
  );

  // The reveal animation: discovery ranks light up over a duration that
  // grows slowly with the tree, so small graphs stay watchable and large
  // ones finish within seconds.
  useEffect(() => {
    if (!playing || !search) return;
    const total = search.span;
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

  const scrub = (rank: number) => {
    keysTarget.current = 'search';
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
    scrub(Math.max(0, Math.min(rank, search.span - 1)));
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
        method: diameterMethod,
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
      if (moved > CLICK_SLOP) {
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
      renderer?.setSelected(g.vertex);
      // In distance mode, with an origin already chosen, a click on another
      // vertex picks the target; otherwise it picks the origin.
      if (mode === 'distance' && rootValid && g.vertex !== root) setTargetInput(String(g.vertex));
      else setRootInput(String(g.vertex));
    }
    // A click on the background (a pan that never moved) clears the selection.
    if (
      g.mode === 'pan' &&
      Math.hypot(event.clientX - g.startX, event.clientY - g.startY) <= CLICK_SLOP
    ) {
      setSelected(0);
      renderer?.setSelected(0);
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
  const keysRef = useRef({
    search,
    revealLevel: 0,
    scrub,
    scrubToLevel,
    component,
    selectComponent,
  });
  keysRef.current = { search, revealLevel, scrub, scrubToLevel, component, selectComponent };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      const k = keysRef.current;
      const arrow =
        event.key === 'ArrowUp' || event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
            ? -1
            : 0;
      const count = metaRef.current?.componentSizes.length ?? 0;
      if (arrow && k.component && (keysTarget.current === 'components' || !k.search)) {
        // Components are ranked by size: → / ↓ go to the next smaller one.
        event.preventDefault();
        const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        k.selectComponent(Math.max(1, Math.min(count, k.component + dir)));
        return;
      }
      if (k.search && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        // BFS: a level up or down; DFS: ten vertices.
        event.preventDefault();
        const dir = event.key === 'ArrowUp' ? 1 : -1;
        if (k.search.kind === 'bfs') {
          k.scrubToLevel(Math.max(0, Math.min(k.search.depth, k.revealLevel + dir)));
        } else {
          k.scrub(
            Math.max(0, Math.min(k.search.span - 1, Math.round(revealRef.current) + dir * 10)),
          );
        }
        return;
      }
      if (k.search && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowRight' ? 1 : -1);
        k.scrub(Math.max(0, Math.min(k.search.span - 1, Math.round(revealRef.current) + step)));
        return;
      }
      if (event.key === 'Escape') {
        setHelpOpen(false);
        setLayoutOpen(false);
        setSelected(0);
        rendererRef.current?.setSelected(0);
        if (k.component) k.selectComponent(0);
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
    if (!helpOpen && !layoutOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!helpRef.current?.contains(event.target as Node)) setHelpOpen(false);
      if (!layoutMenuRef.current?.contains(event.target as Node)) setLayoutOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [helpOpen, layoutOpen]);

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
  const target = Number.parseInt(targetInput, 10);
  const targetValid =
    meta !== null && Number.isInteger(target) && target >= 1 && target <= meta.vertices;
  /** Whether the run button has what the current mode needs. */
  const canRun = rootValid && (mode !== 'distance' || targetValid);
  const run = () => {
    if (canRun) runSearch(kind, root, mode === 'distance' ? target : 0);
  };
  const runLabel =
    mode === 'distance'
      ? t.runDistance(
          kind.toUpperCase(),
          rootValid ? String(root) : t.theOrigin,
          targetValid ? String(target) : t.theTarget,
        )
      : t.runFrom(kind.toUpperCase(), rootValid ? String(root) : t.theOrigin);

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

      <aside
        className={`${styles.sidebar} ${meta ? '' : styles.sidebarEmpty}`}
        data-search={search ? '' : undefined}
      >
        {meta ? (
          <>
            <Panel
              title={t.graph}
              actions={
                <>
                  <IconButton label={t.loadFile} onClick={() => fileInputRef.current?.click()}>
                    <Upload size={14} />
                  </IconButton>
                  <IconButton label={t.downloadSummary} onClick={downloadSummary}>
                    <Download size={14} />
                  </IconButton>
                  <IconButton label={t.closeGraph} onClick={closeGraph}>
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
                  {formatBytes(meta.bytes)} · {t.parsedIn(formatMs(meta.parseMs))}
                </span>
              </div>
              {componentsOpen ? (
                <ComponentsView
                  t={t}
                  meta={meta}
                  current={component}
                  onSelect={selectComponent}
                  onClose={() => {
                    selectComponent(0);
                    setComponentsOpen(false);
                  }}
                />
              ) : (
                <>
                  <div className={styles.tiles}>
                    <Tile label={t.vertices} value={formatInt(meta.vertices)} />
                    <Tile label={t.edges} value={formatInt(meta.edges)} />
                    <Tile
                      label={t.components}
                      value={formatInt(meta.components)}
                      action={
                        <button
                          type="button"
                          className={styles.tileAction}
                          aria-label={t.browseComponents}
                          title={t.browseComponents}
                          onClick={() => {
                            setComponentsOpen(true);
                            selectComponent(1);
                          }}
                        >
                          <ChevronRight size={13} />
                        </button>
                      }
                    />
                    <Tile label={t.meanDegree} value={meta.degree.mean.toFixed(2)} />
                  </div>
                  <DegreeHistogram t={t} degrees={meta.degrees} max={meta.degree.max} />
                  <div className={`${styles.chips} ${styles.shedFirst}`}>
                    <span className={styles.chip}>{t.loopsDropped(meta.selfLoops)}</span>
                    <span className={styles.chip}>{t.duplicatesDropped(meta.duplicates)}</span>
                    <span className={styles.chip}>CSR {formatBytes(meta.heapBytes)}</span>
                  </div>
                </>
              )}
            </Panel>

            <Panel
              title={t.search}
              grow
              actions={
                search && (
                  <>
                    <IconButton label={t.downloadTree} onClick={downloadTree}>
                      <Download size={14} />
                    </IconButton>
                    <IconButton
                      label={t.clearSearch}
                      onClick={() => {
                        search.result.free();
                        setSearch(null);
                        setPlaying(false);
                        rendererRef.current?.setSearch(null);
                        rendererRef.current?.setPath(0, null);
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
                  <span className={styles.fieldLabel}>{t.mode}</span>
                  <div
                    className={styles.segmented}
                    role="radiogroup"
                    aria-label={t.mode}
                    data-active={mode === 'distance' ? 'second' : 'first'}
                  >
                    <span className={styles.thumb} aria-hidden="true" />
                    {(['search', 'distance'] as const).map((which) => (
                      <button
                        key={which}
                        type="button"
                        role="radio"
                        aria-checked={mode === which}
                        className={mode === which ? styles.segmentActive : styles.segment}
                        onClick={() => setMode(which)}
                      >
                        {which === 'search' ? t.modeSearch : t.modeDistance}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t.traversal}</span>
                  <div
                    className={styles.segmented}
                    role="radiogroup"
                    aria-label={t.traversal}
                    data-active={kind === 'dfs' ? 'second' : 'first'}
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
              </div>
              <div className={styles.searchRow}>
                <div className={styles.field}>
                  <label htmlFor="root">{t.origin}</label>
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
                      if (event.key === 'Enter') run();
                    }}
                    placeholder={t.originPlaceholder}
                  />
                </div>
                {mode === 'distance' && (
                  <div className={styles.field}>
                    <label htmlFor="target">{t.target}</label>
                    <input
                      id="target"
                      className={`mono ${styles.input}`}
                      inputMode="numeric"
                      value={targetInput}
                      onChange={(event) => setTargetInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') run();
                      }}
                      placeholder={t.targetPlaceholder}
                    />
                  </div>
                )}
                <button
                  type="button"
                  className={styles.run}
                  disabled={!canRun}
                  onClick={run}
                  aria-label={runLabel}
                  title={runLabel}
                >
                  <Play size={15} aria-hidden="true" />
                </button>
              </div>

              {search ? (
                <div className={styles.result}>
                  <div className={styles.stats}>
                    {search.target ? (
                      <Stat
                        label={search.kind === 'bfs' ? t.distance : t.pathLength}
                        value={search.path ? String(search.path.length - 1) : '∞'}
                      />
                    ) : (
                      <Stat label={t.reached} value={formatInt(search.reached)} />
                    )}
                    <Stat
                      label={
                        search.target ? t.reached : search.kind === 'bfs' ? t.eccentricity : t.depth
                      }
                      value={search.target ? formatInt(search.reached) : String(search.depth)}
                    />
                    <Stat label={t.time} value={formatMs(search.elapsedMs)} />
                  </div>
                  {search.kind === 'bfs' ? (
                    <LevelProfile
                      t={t}
                      sizes={search.levelSizes}
                      kind={search.kind}
                      current={revealLevel}
                      onSelect={scrubToLevel}
                    />
                  ) : (
                    <DepthTrace
                      t={t}
                      order={search.order}
                      levels={search.levels}
                      depth={search.depth}
                      reveal={reveal}
                      onScrub={scrub}
                    />
                  )}
                  <div className={styles.playback}>
                    <IconButton
                      label={playing ? t.pause : reveal >= search.span - 1 ? t.replay : t.play}
                      onClick={() => setPlaying((p) => !p)}
                      accent
                    >
                      {playing ? (
                        <Pause size={14} />
                      ) : reveal >= search.span - 1 ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Play size={14} />
                      )}
                    </IconButton>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(search.span - 1, 0)}
                      step={1}
                      value={Math.round(reveal)}
                      onChange={(event) => scrub(Number(event.target.value))}
                      aria-label={t.progress}
                    />
                    <span className={`mono ${styles.hint}`}>
                      {formatInt(Math.min(Math.round(reveal) + 1, search.span))}
                    </span>
                  </div>
                </div>
              ) : (
                <p className={styles.hint}>{t.searchHint}</p>
              )}
            </Panel>

            <section className={`${styles.panel} ${styles.panelCollapsible}`}>
              <button
                type="button"
                className={styles.panelToggle}
                onClick={() => setDiameterOpen((o) => !o)}
                aria-expanded={diameterOpen}
              >
                <span className={styles.panelTitle}>{t.diameter}</span>
                {diameter && !diameterOpen && (
                  <span className={`mono ${styles.panelSummary}`}>
                    {diameter.isExact && !diameter.cancelled ? '' : '≥ '}
                    {diameter.value} · {t.bfsCount(formatCompact(diameter.bfsCount))}
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
                        <label htmlFor="method">{t.method}</label>
                        <select
                          id="method"
                          className={styles.select}
                          value={diameterMethod}
                          onChange={(event) =>
                            setDiameterMethod(event.target.value as typeof diameterMethod)
                          }
                        >
                          {DIAMETER_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {t.diameterMethods[m]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={`${styles.field} ${styles.fieldNarrow}`}>
                        <label htmlFor="budget">{t.bfsBudget}</label>
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
                        {diameterBusy ? t.computing : t.compute}
                      </button>
                      {diameter && (
                        <span className={styles.diameterResult}>
                          <span className={`mono ${styles.diameterValue}`}>
                            {diameter.isExact && !diameter.cancelled ? '' : '≥ '}
                            {diameter.value}
                          </span>
                          <span className={styles.hint}>
                            {diameter.from} ↔ {diameter.to} ·{' '}
                            {t.bfsCount(formatInt(diameter.bfsCount))}
                            {diameter.cancelled ? t.budgetHit : ''} · {formatMs(diameter.elapsedMs)}
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
            <Panel title={t.graph}>
              <div className={styles.starters}>
                <button
                  type="button"
                  className={styles.starter}
                  onClick={loadExample}
                  disabled={status.kind !== 'ready'}
                >
                  <FlaskConical size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.starterTitle}>{t.sample}</span>
                  <span className={styles.starterHint}>{t.sampleHint}</span>
                </button>
                <button
                  type="button"
                  className={styles.starter}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status.kind !== 'ready'}
                >
                  <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.starterTitle}>{t.openFile}</span>
                  <span className={styles.starterHint}>{t.openFileHint}</span>
                </button>
              </div>
            </Panel>
            <Panel title={t.controlsTitle} grow>
              <ul className={styles.keys}>
                {t.controls.map(([key, does]) => (
                  <li key={key}>
                    <kbd className="mono">{key}</kbd>
                    <span>{does}</span>
                  </li>
                ))}
              </ul>
              <p className={`comment ${styles.keysNote}`}>{t.keysNote}</p>
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
          aria-label={t.canvas}
        />
        <canvas ref={labelCanvasRef} className={styles.labels} aria-hidden="true" />

        {!meta && <Constellation />}
        {!meta && (
          <div className={styles.empty}>
            {status.kind === 'unsupported' ? (
              <div className={styles.emptyCard}>
                <h2>{t.noWebGpu}</h2>
                <p>{status.message}</p>
                <p className={styles.hint}>{t.noWebGpuHint}</p>
              </div>
            ) : status.kind === 'failed' ? (
              <div className={styles.emptyCard}>
                <h2>{t.failed}</h2>
                <p>{status.message}</p>
              </div>
            ) : (
              <div className={styles.dropCard}>
                <span className={styles.dropIcon} aria-hidden="true">
                  <Upload size={22} strokeWidth={1.5} />
                </span>
                <span className={styles.dropTitle}>
                  {status.kind === 'booting'
                    ? t.booting
                    : status.kind === 'parsing'
                      ? t.parsing(status.name)
                      : t.drop}
                </span>
                <div className={`mono ${styles.format}`} aria-label={t.fileFormat}>
                  <span className={styles.formatName}>sample.txt</span>
                  <span />
                  {FORMAT_LINES.map((line, i) => (
                    <Fragment key={line}>
                      <span>{line}</span>
                      <span className={styles.formatNote}>
                        {i === 0 ? t.format.vertices : i === 1 ? t.format.edge : ''}
                      </span>
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
                    {t.browse}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={loadExample}
                    disabled={status.kind !== 'ready'}
                  >
                    {t.trySample}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {meta && status.kind === 'parsing' && (
          <div className={styles.overlay}>{t.parsing(status.name)}</div>
        )}

        {meta && (
          <>
            {/* Controls, top left */}
            <div ref={helpRef} className={`${styles.floating} ${styles.floatingTopLeft}`}>
              <div className={styles.cluster}>
                <IconButton
                  label={helpOpen ? t.hideControls : t.showControls}
                  pressed={helpOpen}
                  onClick={() => setHelpOpen((o) => !o)}
                >
                  <CircleHelp size={15} />
                </IconButton>
              </div>
              {helpOpen && (
                <div className={styles.help} role="dialog" aria-label={t.controlsTitle}>
                  <span className={`label ${styles.helpTitle}`}>{t.controlsTitle}</span>
                  <ul className={styles.keys}>
                    {t.controls.map(([key, does]) => (
                      <li key={key + does}>
                        <kbd className="mono">{key}</kbd>
                        <span>{does}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* The path of a distance query, top centre */}
            {search?.target !== 0 && search && (
              <div className={`${styles.floating} ${styles.floatingTopCenter}`}>
                {search.path && (
                  <div className={styles.cluster}>
                    <IconButton
                      label={pathOnly ? t.colourSearch : t.pathOnly}
                      pressed={pathOnly}
                      onClick={() => {
                        setPathOnly(!pathOnly);
                        rendererRef.current?.setPathOnly(!pathOnly);
                      }}
                    >
                      <Highlighter size={15} />
                    </IconButton>
                    <IconButton
                      label={t.fitPath}
                      onClick={() => {
                        const onPath = new Set(search.path);
                        autoFit.current = false;
                        fitVertices((v) => onPath.has(v), PATH_FILL);
                      }}
                    >
                      <Scan size={15} />
                    </IconButton>
                  </div>
                )}
                <p className={`mono ${styles.path}`} aria-label={t.path}>
                  {search.path ? (
                    pathSteps(search.path).map((step, i, all) => (
                      <Fragment key={i}>
                        {i > 0 && <span className={styles.pathArrow}>→</span>}
                        {step === '…' ? (
                          <span className={styles.pathGap}>{step}</span>
                        ) : (
                          <span
                            className={styles.pathBall}
                            style={{
                              // The canvas gradient: the origin's blue to the destination's green.
                              background: `color-mix(in srgb, var(--accent) ${Math.round(100 - (100 * i) / Math.max(all.length - 1, 1))}%, var(--target))`,
                            }}
                          >
                            {step}
                          </span>
                        )}
                      </Fragment>
                    ))
                  ) : (
                    <span className={styles.pathGap}>{t.noPath}</span>
                  )}
                </p>
              </div>
            )}

            {/* Layout tools, top right */}
            <div ref={layoutMenuRef} className={`${styles.floating} ${styles.floatingTopRight}`}>
              <div className={styles.cluster}>
                <IconButton
                  label={showLabels ? t.hideNumbers : t.showNumbers}
                  pressed={showLabels}
                  onClick={() => setShowLabels((on) => !on)}
                >
                  <Hash size={15} />
                </IconButton>
                <IconButton
                  label={follow ? t.stopFollowing : t.follow}
                  pressed={follow}
                  onClick={() => {
                    const next = !follow;
                    setFollow(next);
                    if (next && search) fitDiscovered(search.ranks, revealRef.current);
                  }}
                >
                  <Focus size={15} />
                </IconButton>
                <span className={styles.clusterRule} aria-hidden="true" />
                <IconButton
                  label={layoutOpen ? t.hideLayouts : t.chooseLayout}
                  pressed={layoutOpen}
                  onClick={() => setLayoutOpen((o) => !o)}
                >
                  <Shapes size={15} />
                </IconButton>
              </div>
              {layoutOpen && (
                <div
                  className={`${styles.help} ${styles.menu}`}
                  role="menu"
                  aria-label={t.layoutsMenu}
                >
                  <span className={`label ${styles.helpTitle}`}>{t.layout}</span>
                  {LAYOUTS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={layout === item.id}
                      className={styles.menuItem}
                      onClick={() => {
                        setLayoutOpen(false);
                        applyLayout(item.id, search?.root ?? (selected || 1));
                      }}
                    >
                      <span className={styles.menuIcon}>{item.icon}</span>
                      <span className={styles.menuText}>
                        <span>{t.layouts[item.id].label}</span>
                        <span className={styles.menuHint}>{t.layouts[item.id].hint}</span>
                      </span>
                    </button>
                  ))}
                  {layout === 'force' && (
                    <div className={styles.menuFooter}>
                      <span className={`label ${styles.helpTitle}`}>{t.simulation}</span>
                      <span className={styles.menuButtons}>
                        <IconButton
                          label={simulate ? t.pauseSimulation : t.resumeSimulation}
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
                          label={t.reheat}
                          onClick={() => {
                            rendererRef.current?.reheat(1);
                          }}
                          disabled={!simulate}
                        >
                          <RefreshCw size={15} />
                        </IconButton>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* View tools, bottom right */}
            <div className={`${styles.floating} ${styles.floatingBottomRight}`}>
              <div className={`${styles.cluster} ${styles.clusterVertical}`}>
                <IconButton label={t.zoomIn} onClick={() => zoomBy(1.4)}>
                  <Plus size={15} />
                </IconButton>
                <IconButton label={t.zoomOut} onClick={() => zoomBy(1 / 1.4)}>
                  <Minus size={15} />
                </IconButton>
                <IconButton label={t.fit} onClick={fit}>
                  <Maximize2 size={15} />
                </IconButton>
                <IconButton
                  label={fullscreen ? t.exitFullscreen : t.fullscreen}
                  onClick={toggleFullscreen}
                >
                  {fullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
                </IconButton>
              </div>
            </div>

            <div className={styles.legend}>
              {search?.target ? (
                <>
                  <span className={styles.swatchOrigin} /> {t.origin.toLowerCase()}
                  <span className={styles.legendSep} />
                  <span className={styles.swatchTarget} /> {t.target.toLowerCase()}
                  <span className={styles.legendSep} />
                  <span className={styles.swatchDim} /> {t.notReached}
                </>
              ) : search ? (
                <>
                  <span className={styles.swatchA} /> {t.level(0)}
                  <span className={styles.swatchBar} />
                  <span className={styles.swatchB} /> {t.level(search.depth)}
                  <span className={styles.legendSep} />
                  <span className={styles.swatchDim} /> {t.notReached}
                </>
              ) : component ? (
                <>
                  <span className={styles.swatchLit} /> {t.component(component)}
                  <span className={styles.legendSep} />
                  <span className={styles.swatchDim} /> {t.theRest}
                </>
              ) : selected ? (
                t.originVertex(selected)
              ) : (
                t.chooseOrigin
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
            <span className="mono">{t.vertex(hovered)}</span>
            <span>{t.degree(hoverInfo.degree)}</span>
            {search &&
              (hoverInfo.level === null ? (
                <span>{t.notReached}</span>
              ) : (
                <span>
                  {t.level(hoverInfo.level)}
                  {hoverInfo.parent !== null && t.parent(hoverInfo.parent)}
                </span>
              ))}
          </div>
        )}
      </div>

      {notice && (
        <div className={styles.notice} role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t.dismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** The path as labels, the middle elided past ten vertices. */
function pathSteps(path: Uint32Array): string[] {
  const all = Array.from(path, String);
  if (all.length <= 10) return all;
  return [...all.slice(0, 4), '…', ...all.slice(-4)];
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

function Tile({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  /** A small control in the tile's corner. */
  action?: ReactNode;
}) {
  return (
    <div className={styles.tile}>
      <span className={`label ${styles.tileLabel}`}>{label}</span>
      <span className={`mono ${styles.tileValue}`}>{value}</span>
      {hint && <span className={styles.tileHint}>{hint}</span>}
      {action}
    </div>
  );
}

/** How many vertices have each degree, as a tiny bar chart. */
function DegreeHistogram({ t, degrees, max }: { t: Strings; degrees: Uint32Array; max: number }) {
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
    <div className={`${styles.chart} ${styles.shedThird}`} aria-label={t.degreeDistribution}>
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>{t.degreeDistribution}</span>
        <span className={styles.tileHint}>{t.verticesPerDegree}</span>
      </div>
      <div className={styles.bars}>
        {bars.map((b) => (
          <span
            key={b.from}
            style={{ height: `${Math.max(b.count > 0 ? 3 : 0, (b.count / peak) * 100)}%` }}
            title={t.degreeBucket(
              b.from === b.to ? String(b.from) : `${b.from}–${b.to}`,
              formatInt(b.count),
            )}
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
/** The components browser, in place of the graph summary: a stacked bar of
    sizes (largest first, the tail past eight bucketed) whose pieces are
    buttons, a previous / next navigator and the selected component's
    numbers as tiles. */
function ComponentsView({
  t,
  meta,
  current,
  onSelect,
  onClose,
}: {
  t: Strings;
  meta: GraphMeta;
  current: number;
  onSelect: (c: number) => void;
  onClose: () => void;
}) {
  const sizes = meta.componentSizes;
  const total = meta.vertices;
  const shown = Math.min(sizes.length, 8);
  let rest = 0;
  for (let i = shown; i < sizes.length; i++) rest += sizes[i];
  const size = current ? sizes[current - 1] : 0;
  const edges = current ? meta.componentEdges[current] : 0;
  const possible = (size * (size - 1)) / 2;
  return (
    <div className={styles.chart} aria-label={t.components}>
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>
          {t.componentsCount(formatInt(sizes.length))}
        </span>
        <span className={styles.tileHint}>
          {sizes.length === 1 ? t.connected : t.smallest(formatInt(sizes[sizes.length - 1]))}
        </span>
      </div>
      <div className={styles.segments} role="group" aria-label={t.pickComponent}>
        {Array.from({ length: shown }, (_, i) => (
          <button
            key={i}
            type="button"
            className={styles.piece}
            style={{ flexGrow: sizes[i], opacity: 1 - (i / Math.max(shown, 2)) * 0.7 }}
            data-current={current === i + 1 || undefined}
            title={t.componentTitle(i + 1, formatInt(sizes[i]))}
            aria-label={t.componentLabel(i + 1, formatInt(sizes[i]))}
            aria-pressed={current === i + 1}
            onClick={() => onSelect(i + 1)}
          />
        ))}
        {rest > 0 && (
          <button
            type="button"
            className={`${styles.piece} ${styles.pieceRest}`}
            style={{ flexGrow: rest }}
            data-current={current > shown || undefined}
            title={t.moreComponents(formatInt(sizes.length - shown), formatInt(rest))}
            aria-label={t.smallerComponents(formatInt(sizes.length - shown))}
            aria-pressed={current > shown}
            onClick={() => onSelect(shown + 1)}
          />
        )}
      </div>
      <div className={styles.componentRow}>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={t.previousComponent}
          disabled={current <= 1}
          onClick={() => onSelect(current - 1)}
        >
          <ChevronLeft size={12} />
        </button>
        <span className={`mono ${styles.componentInfo}`}>
          {t.componentWord} <b>{current}</b>
          <span className={styles.componentSep}>/</span>
          {formatInt(sizes.length)}
        </span>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={t.nextComponent}
          disabled={current >= sizes.length}
          onClick={() => onSelect(current + 1)}
        >
          <ChevronRight size={12} />
        </button>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={t.backToSummary}
          title={t.backToSummaryShort}
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
      {current > 0 && (
        <div className={styles.tiles}>
          <Tile
            label={t.vertices}
            value={formatInt(size)}
            hint={t.ofGraph(((size / total) * 100).toFixed(size === total ? 0 : 1))}
          />
          <Tile
            label={t.edges}
            value={formatInt(edges)}
            hint={t.ofEdges(
              ((edges / Math.max(meta.edges, 1)) * 100).toFixed(edges === meta.edges ? 0 : 1),
            )}
          />
          <Tile
            label={t.componentDegree}
            value={`${meta.componentDegree.min[current]} – ${meta.componentDegree.max[current]}`}
            hint={t.mean(size ? ((2 * edges) / size).toFixed(2) : '0')}
          />
          <Tile
            label={t.density}
            value={
              possible ? `${((edges / possible) * 100).toFixed(edges === possible ? 0 : 2)}%` : '·'
            }
            hint={t.ofPossible}
          />
        </div>
      )}
    </div>
  );
}

/** Vertices per level as horizontal bars, level 0 at the bottom; the index
    on the left is a button that moves the timeline to that level. */
function LevelProfile({
  t,
  sizes,
  kind,
  current,
  onSelect,
}: {
  t: Strings;
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
  const noun = kind === 'bfs' ? t.levelNoun : t.depthNoun;

  // Keep the current level in view while the wave plays.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>('[data-current="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <div className={`${styles.chart} ${styles.shedFourth}`} aria-label={t.verticesPer(noun)}>
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>{t.verticesPer(noun)}</span>
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
                title={t.goTo(noun, row.from)}
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
  t,
  order,
  levels,
  depth,
  reveal,
  onScrub,
}: {
  t: Strings;
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
    <div className={`${styles.chart} ${styles.shedFourth}`} aria-label={t.depthTrace}>
      <div className={styles.chartHeader}>
        <span className={`label ${styles.tileLabel}`}>{t.depthTrace}</span>
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
        aria-label={t.progress}
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
