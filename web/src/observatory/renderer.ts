// The WebGPU side of the observatory, built on vgpu: GPU buffers for the
// graph and the current search, a compute step for the force layout, and two
// draws (edges as a line list, vertices as instanced discs). React owns the
// state and calls into this class; it owns nothing GPU-related.
//
// Frames are drawn only when something changed, and the edges, by far the
// most expensive draw on the course graphs (grafo_2 has 1.3M of them), are
// cached in their own layer: hovering or selecting a vertex redraws the
// vertices over the cached edges, and while the picture moves (pan, zoom,
// drag, playback, simulation) only a sample of the non-tree edges is drawn,
// with every edge drawn again once the motion has settled.
import {
  compute,
  draw,
  effect,
  frameLoop,
  init,
  pingPongStorage,
  storage,
  surface,
  target,
  uniforms,
  type Compute,
  type Draw,
  type Effect,
  type FrameLoopHandle,
  type Gpu,
  type PingPongStorage,
  type SharedUniforms,
  type StorageBuffer,
  type Surface,
  type Target,
} from 'vgpu';
import { UNREACHED } from '@/lib/graphman';
import {
  COMPOSITE_SHADER,
  EDGE_SHADER,
  MORPH_SHADER,
  NEGATIVE_SHADER,
  NODE_SHADER,
  PATH_SHADER,
  SIM_SHADER,
} from './shaders';

export type Rgba = [number, number, number, number];

export interface Theme {
  background: Rgba;
  node: Rgba;
  nodeDim: Rgba;
  levelA: Rgba;
  levelB: Rgba;
  ring: Rgba;
  edge: Rgba;
  edgeDim: Rgba;
  /** The destination of a distance query. */
  target: Rgba;
  cycle: Rgba;
}

/** A graph needs a larger buffer than this GPU allows. */
export class GpuLimitError extends Error {
  constructor(
    readonly needed: number,
    readonly limit: number,
  ) {
    super(`needs a GPU buffer of ${needed} bytes, the limit is ${limit}`);
    this.name = 'GpuLimitError';
  }
}

/** What the renderer needs from a loaded graph (all indexed by vertex id). */
export interface GraphBuffers {
  vertexCount: number;
  /** Flat `[u, v, ...]` pairs. */
  edges: Uint32Array;
  csrOffsets: Uint32Array;
  csrTargets: Uint32Array;
  /** Flat `[x, y, ...]`, `(n + 1) * 2` entries. */
  positions: Float32Array;
  /** Component id per vertex, used to compute the gravity anchors. */
  componentLabels: Uint32Array;
  /** Every `[u, v]` of `edges` is the arc u → v: drawn with a head at v. */
  directed?: boolean;
}

export interface SearchBuffers {
  kind: 'bfs' | 'dfs' | 'dijkstra';
  levels: Uint32Array;
  ranks: Uint32Array;
  parents: Uint32Array;
  depth: number;
}

export interface Camera {
  /** World coordinates at the centre of the canvas. */
  x: number;
  y: number;
  /** CSS pixels per world unit. */
  zoom: number;
}

/** WebGPU's default for the largest storage buffer a device may bind. */
const DEFAULT_STORAGE_LIMIT = 128 * 1024 * 1024;

/** Above this many vertices the O(n²) repulsion is skipped by default. */
export const SIMULATION_LIMIT = 30_000;

/** Non-tree edges drawn per frame while the picture moves (see `stride`). */
const EDGE_BUDGET = 200_000;
/** Vertices drawn per frame while the picture moves. */
const NODE_BUDGET = 1_000_000;
/** Vertices per pixel kept at rest where they pile up (grafo_5 has 4.8M). */
const NODE_PILE = 3;
/** Milliseconds of stillness before the sampled edge layer is drawn in full. */
const SETTLE_MS = 120;
/** Opacity the plain edges, and the tree edges, should add up to where they
    overlap; their alpha is scaled down so a dense picture stays readable. */
const EDGE_COVERAGE = 0.4;
const TREE_COVERAGE = 0.95;
/** Faded edges below this alpha would vanish in the half-float blending
    (each one adds less than the layer can resolve), so instead of drawing
    every edge that faint, every stride-th edge is drawn that much stronger. */
const MIN_EDGE_ALPHA = 0.01;

/** wasm-bindgen types its copies as `ArrayBufferLike`; they are plain ArrayBuffers. */
const bytes = (view: ArrayBufferView): BufferSource => view as ArrayBufferView<ArrayBuffer>;

const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const WORKGROUP = 256;

type ViewValues = {
  offset: [number, number];
  viewport: [number, number];
  scale: number;
  radius: number;
  reveal: number;
  rate: number;
  maxLevel: number;
  hovered: number;
  selected: number;
  mode: number;
  n: number;
  component: number;
  stride: number;
  treeStride: number;
  nodeStride: number;
  edgeFade: number;
  treeFade: number;
  pathLength: number;
  incident: number;
  dest: number;
  mute: number;
  walk: number;
  marked: number;
  arrows: number;
  incidentOut: number;
  cycle: number;
  base: Rgba;
  dim: Rgba;
  colorA: Rgba;
  colorB: Rgba;
  ring: Rgba;
  edge: Rgba;
  edgeDim: Rgba;
  edgeTree: Rgba;
  colorTarget: Rgba;
  colorCycle: Rgba;
};

const EMPTY_VIEW: ViewValues = {
  offset: [0, 0],
  viewport: [1, 1],
  scale: 1,
  radius: 3,
  reveal: -1,
  rate: 1,
  maxLevel: 1,
  hovered: 0,
  selected: 0,
  mode: 0,
  n: 0,
  component: 0,
  stride: 1,
  treeStride: 1,
  nodeStride: 1,
  edgeFade: 1,
  treeFade: 1,
  pathLength: 0,
  incident: 0,
  dest: 0,
  mute: 0,
  marked: 0,
  arrows: 0,
  incidentOut: 0,
  cycle: 0,
  walk: -1,
  base: [0.5, 0.5, 0.5, 1],
  dim: [0.5, 0.5, 0.5, 1],
  colorA: [0, 0, 1, 1],
  colorB: [0, 1, 1, 1],
  ring: [1, 1, 1, 1],
  edge: [0.5, 0.5, 0.5, 0.2],
  edgeDim: [0.5, 0.5, 0.5, 0.05],
  edgeTree: [1, 1, 1, 0.9],
  colorTarget: [0.09, 0.64, 0.29, 1],
  colorCycle: [0.9, 0.28, 0.3, 1],
};

/** WebGPU is missing or refused to give us a device. */
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export class Renderer {
  private gpu: Gpu;
  /** The largest storage buffer this device can create and bind. */
  private storageLimit: number;
  private surface: Surface;
  private view: SharedUniforms<ViewValues>;
  private viewValues: ViewValues = { ...EMPTY_VIEW };
  private nodes: Draw;
  /** The plain edges, during a search the tree edges, and the extras on top. */
  private edges: Draw;
  private treeEdges: Draw;
  private extraEdges: Draw;
  /** The heads of a directed graph's arcs, one draw per kind of edge. */
  private edgeHeads: Draw;
  private treeHeads: Draw;
  private extraHeads: Draw;
  /** Directed only: the out- and in-arcs of every vertex, for the selection. */
  private outOffsets: Uint32Array = new Uint32Array(0);
  private outTargets: Uint32Array = new Uint32Array(0);
  private inOffsets: Uint32Array = new Uint32Array(0);
  private inTargets: Uint32Array = new Uint32Array(0);
  /** The path of a distance query, as thick segments over everything. */
  private pathEdges: Draw;
  /** The negative edges Dijkstra refused the graph for, thick and red over everything. */
  private negativeEdges: Draw;
  private composite: Effect;
  private sim: Compute;
  private morph: Compute;
  private loop: FrameLoopHandle | null = null;
  private theme: Theme;

  // The cached edge layer and what invalidates it.
  private edgeLayer: Target | null = null;
  /** Something visible changed since the last frame. */
  private dirty = true;
  /** The edge layer no longer matches the positions, camera or search. */
  private edgesDirty = true;
  /** Strides the edge layer was last drawn with (1 = every edge): plain edges, tree edges. */
  private layerStride: [number, number] = [1, 1];
  /** Stride the vertices were last drawn with. */
  private nodeStride = 1;
  /** When the edge layer last changed, to time the full redraw. */
  private lastEdgeChange = 0;

  // Per-graph resources.
  private n = 0;
  private edgeCount = 0;
  private positions: PingPongStorage | null = null;
  private velocities: StorageBuffer | null = null;
  private edgeBuffer: StorageBuffer | null = null;
  private offsets: StorageBuffer | null = null;
  private targets: StorageBuffer | null = null;
  private anchors: StorageBuffer | null = null;
  private levels: StorageBuffer | null = null;
  private ranks: StorageBuffer | null = null;
  private parents: StorageBuffer | null = null;
  private labels: StorageBuffer | null = null;
  /** The vertices of the lit path (a distance query's answer), in order. */
  private path: StorageBuffer | null = null;
  private pathVertices: Uint32Array | null = null;
  /** The extra edge segments ([a, b] pairs): the selected vertex's edges, then the path's. */
  private extras: StorageBuffer | null = null;
  /** The negative edges as [a, b] pairs, and how many are drawn (0 = none). */
  private negative: StorageBuffer | null = null;
  private negativeCount = 0;
  /** 1 per vertex, then per edge (from slot n + 1), that a distribution
      column lit: one buffer, as the vertex stage binds eight at most. */
  private marks: StorageBuffer | null = null;
  /** The CSR rows, kept to build the selected vertex's neighbourhood on the CPU. */
  private csrOffsets: Uint32Array = new Uint32Array(0);
  private csrTargets: Uint32Array = new Uint32Array(0);
  /** The edge pairs and component labels, kept to re-measure the density after a layout change. */
  private cpuEdges: Uint32Array = new Uint32Array(0);
  private cpuLabels: Uint32Array = new Uint32Array(0);

  // A layout change in progress: positions slide from `morphFrom` to
  // `morphDest` over `morphMs`, starting at `morphStart`.
  private morphFrom: StorageBuffer | null = null;
  private morphDest: StorageBuffer | null = null;
  private morphTarget: Float32Array | null = null;
  private morphStart = 0;
  private morphMs = 0;

  /** CPU mirror of the positions, refreshed from the GPU while simulating. */
  private mirror = new Float32Array(0);
  private readInFlight = false;
  private readAgain = false;

  // Simulation state.
  private alpha = 0;
  private simulate = false;
  private dragIndex = 0;
  private dragPos: [number, number] = [0, 0];
  private linkLength = 24;
  /** How far the force layout's rest state is stretched (see `setForceSpacing`). */
  private forceSpacing = 1;
  /** Counts the stretches: a position read begun before one is out of date. */
  private stretches = 0;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private nodeRadius = 3.5;
  /** The densest big component: edges and vertices per world unit of area,
      and its mean edge length (see `measure`). */
  private edgeDensity = 0;
  private vertexDensity = 0;
  private meanEdgeLength = 24;

  /** Called after each frame that changed positions (drag or simulation). */
  onPositions: ((positions: Float32Array) => void) | null = null;
  /** Called when the simulation cools down. */
  onSettled: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private constructor(gpu: Gpu, canvas: HTMLCanvasElement, theme: Theme, storageLimit: number) {
    this.gpu = gpu;
    this.storageLimit = storageLimit;
    this.theme = theme;
    this.surface = surface(gpu, canvas, {
      dpr: [1, 2],
      alphaMode: 'premultiplied',
      clearColor: theme.background,
      label: 'observatory',
    });
    this.applyTheme(theme);
    this.view = uniforms<ViewValues>(gpu, this.viewValues);
    this.nodes = draw(gpu, {
      shader: NODE_SHADER,
      label: 'nodes',
      blend: 'premultiplied',
      vertices: 6, // one quad per instance
    });
    // Each kind of edge is two draws of one shader: its lines, and on a
    // directed graph the filled heads of its arcs.
    const edgeDraws = (label: string, tree: number): [Draw, Draw] => {
      const kind = uniforms(gpu, { tree });
      return [
        draw(gpu, {
          shader: EDGE_SHADER,
          label,
          blend: 'premultiplied',
          geometry: { topology: 'line-list' },
          entry: { vertex: 'vs_main', fragment: 'fs_main' },
          set: { kind },
        }),
        draw(gpu, {
          shader: EDGE_SHADER,
          label: `${label}-heads`,
          blend: 'premultiplied',
          geometry: { topology: 'triangle-list' },
          entry: { vertex: 'vs_head', fragment: 'fs_main' },
          set: { kind },
        }),
      ];
    };
    [this.edges, this.edgeHeads] = edgeDraws('edges', 0);
    [this.treeEdges, this.treeHeads] = edgeDraws('tree-edges', 1);
    [this.extraEdges, this.extraHeads] = edgeDraws('extra-edges', 2);
    this.pathEdges = draw(gpu, {
      shader: PATH_SHADER,
      label: 'path',
      blend: 'premultiplied',
      vertices: 6, // one quad per segment
    });
    this.negativeEdges = draw(gpu, {
      shader: NEGATIVE_SHADER,
      label: 'negative',
      blend: 'premultiplied',
      vertices: 9, // a quad and, on a directed graph, a head per edge
    });
    this.composite = effect(gpu, COMPOSITE_SHADER, { label: 'composite', blend: 'premultiplied' });
    this.sim = compute(gpu, SIM_SHADER, { label: 'layout' });
    this.morph = compute(gpu, MORPH_SHADER, { label: 'morph' });
    gpu.onError((error) => this.onError?.(error.message));
  }

  static async create(canvas: HTMLCanvasElement, theme: Theme): Promise<Renderer> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new UnsupportedError('This browser does not expose WebGPU.');
    }
    let gpu: Gpu;
    let storageLimit: number;
    try {
      // A device gets WebGPU's default limits unless it asks for more, and
      // those stop at 128 MiB a buffer: about 16.7M edges.
      const powerPreference = 'high-performance';
      const limits = (await navigator.gpu.requestAdapter({ powerPreference }))?.limits;
      storageLimit = Math.min(
        limits?.maxStorageBufferBindingSize ?? DEFAULT_STORAGE_LIMIT,
        limits?.maxBufferSize ?? DEFAULT_STORAGE_LIMIT,
      );
      gpu = await init({
        powerPreference,
        label: 'graphman',
        requiredLimits: limits && {
          maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
          maxBufferSize: limits.maxBufferSize,
        },
      });
    } catch (error) {
      throw new UnsupportedError(error instanceof Error ? error.message : String(error));
    }
    return new Renderer(gpu, canvas, theme, storageLimit);
  }

  get hasGraph(): boolean {
    return this.n > 0;
  }

  get simulating(): boolean {
    return this.simulate && this.alpha > ALPHA_MIN;
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.surface.clearColor = theme.background;
    this.applyTheme(theme);
    this.touch(true);
  }

  /** Marks the frame (and, with `edges`, the edge layer) as needing a draw. */
  private touch(edges = false) {
    this.view.set(this.viewValues);
    this.dirty = true;
    if (edges) this.edgesDirty = true;
  }

  private applyTheme(theme: Theme) {
    Object.assign(this.viewValues, {
      base: theme.node,
      dim: theme.nodeDim,
      colorA: theme.levelA,
      colorB: theme.levelB,
      ring: theme.ring,
      edge: theme.edge,
      edgeDim: theme.edgeDim,
      edgeTree: [1, 1, 1, 0.95],
      colorTarget: theme.target,
      colorCycle: theme.cycle,
    });
  }

  /** Uploads a graph and starts drawing it. */
  load(graph: GraphBuffers, linkLength: number) {
    const needed = Math.max(
      graph.edges.byteLength,
      graph.csrTargets.byteLength,
      // The marks hold a slot per vertex and per edge.
      (graph.vertexCount + 1 + graph.edges.length / 2) * 4,
    );
    if (needed > this.storageLimit) throw new GpuLimitError(needed, this.storageLimit);
    this.unloadGraph();
    const n = graph.vertexCount;
    this.n = n;
    this.edgeCount = graph.edges.length / 2;
    this.viewValues.arrows = graph.directed ? 1 : 0;
    this.linkLength = linkLength;
    this.forceSpacing = 1;
    const slots = n + 1;
    const gpu = this.gpu;

    this.positions = pingPongStorage(gpu, slots * 8);
    this.positions.read.write(bytes(graph.positions));
    this.positions.write.write(bytes(graph.positions));
    this.velocities = storage(gpu, slots * 8, 'read-write');
    this.velocities.write(new Float32Array(slots * 2));
    this.edgeBuffer = storage(gpu, Math.max(graph.edges.byteLength, 8), 'read');
    this.edgeBuffer.write(bytes(graph.edges.length ? graph.edges : new Uint32Array(2)));
    this.offsets = storage(gpu, graph.csrOffsets.byteLength, 'read');
    this.offsets.write(bytes(graph.csrOffsets));
    this.targets = storage(gpu, Math.max(graph.csrTargets.byteLength, 4), 'read');
    this.targets.write(bytes(graph.csrTargets.length ? graph.csrTargets : new Uint32Array(1)));
    this.anchors = storage(gpu, slots * 8, 'read');
    this.anchors.write(bytes(componentAnchors(graph)));

    const unreached = new Uint32Array(slots).fill(UNREACHED);
    this.levels = storage(gpu, slots * 4, 'read');
    this.levels.write(unreached);
    this.ranks = storage(gpu, slots * 4, 'read');
    this.ranks.write(unreached);
    this.parents = storage(gpu, slots * 4, 'read');
    this.parents.write(new Uint32Array(slots));
    this.labels = storage(gpu, slots * 4, 'read');
    this.labels.write(bytes(graph.componentLabels));
    this.path = storage(gpu, 4, 'read');
    this.path.write(new Uint32Array(1));
    this.extras = storage(gpu, 8, 'read');
    this.extras.write(new Uint32Array(2));
    this.negative = storage(gpu, 8, 'read');
    this.negative.write(new Uint32Array(2));
    this.negativeCount = 0;
    this.marks = storage(gpu, (slots + Math.max(this.edgeCount, 1)) * 4, 'read');
    this.marks.write(new Uint32Array(slots + Math.max(this.edgeCount, 1)));

    this.mirror = new Float32Array(graph.positions);
    this.csrOffsets = graph.csrOffsets;
    this.csrTargets = graph.csrTargets;
    if (graph.directed) {
      [this.outOffsets, this.outTargets] = rows(n, graph.edges, 0);
      [this.inOffsets, this.inTargets] = rows(n, graph.edges, 1);
    } else {
      this.outOffsets = this.outTargets = this.inOffsets = this.inTargets = new Uint32Array(0);
    }
    this.cpuEdges = graph.edges;
    this.cpuLabels = graph.componentLabels;
    this.measure(graph.positions);
    [this.viewValues.edgeFade, this.viewValues.treeFade] = this.fades(this.viewValues.scale);
    this.viewValues.n = n;
    this.viewValues.mode = 0;
    this.viewValues.reveal = -1;
    this.viewValues.hovered = 0;
    this.viewValues.selected = 0;
    this.viewValues.component = 0;
    this.viewValues.pathLength = 0;
    this.viewValues.incident = 0;
    this.viewValues.dest = 0;
    this.viewValues.cycle = 0;
    this.viewValues.marked = 0;
    this.pathVertices = null;
    this.touch(true);

    this.sim.set({
      offsets: this.offsets,
      targets: this.targets,
      anchors: this.anchors,
      vel: this.velocities,
    });
    const edgeBindings = {
      view: this.view,
      edges: this.edgeBuffer,
      parents: this.parents,
      ranks: this.ranks,
      levels: this.levels,
      labels: this.labels,
      extras: this.extras,
      marks: this.marks,
    };
    for (const edgeDraw of this.edgeDraws) edgeDraw.set(edgeBindings);
    this.pathEdges.set({ view: this.view, ranks: this.ranks, path: this.path });
    this.negativeEdges.set({ view: this.view, pairs: this.negative });
    this.nodes.set({
      view: this.view,
      levels: this.levels,
      ranks: this.ranks,
      labels: this.labels,
      offsets: this.offsets,
      targets: this.targets,
      path: this.path,
      marks: this.marks,
    });

    this.simulate = n <= SIMULATION_LIMIT;
    this.alpha = this.simulate ? 1 : 0;
    this.start();
  }

  /**
   * Measures how thickly the edges pile up in a layout: the density of a
   * component is its edges over the area it occupies (the ellipse in its
   * bounding box, which for the disc layouts is the disc itself); the
   * picture is governed by the densest of the components that hold a real
   * share of the edges.
   */
  private measure(pos: Float32Array) {
    const labels = this.cpuLabels;
    const n = this.n;
    const edges = this.cpuEdges;
    const count = edges.length / 2;
    let components = 0;
    for (let v = 1; v <= n; v++) components = Math.max(components, labels[v]);
    const size = new Uint32Array(components + 1);
    const perComponent = new Uint32Array(components + 1);
    const lengthSum = new Float64Array(components + 1);
    const sampled = new Uint32Array(components + 1);
    const minX = new Float64Array(components + 1).fill(Infinity);
    const minY = new Float64Array(components + 1).fill(Infinity);
    const maxX = new Float64Array(components + 1).fill(-Infinity);
    const maxY = new Float64Array(components + 1).fill(-Infinity);
    for (let v = 1; v <= n; v++) {
      const c = labels[v];
      size[c] += 1;
      const x = pos[2 * v];
      const y = pos[2 * v + 1];
      if (x < minX[c]) minX[c] = x;
      if (x > maxX[c]) maxX[c] = x;
      if (y < minY[c]) minY[c] = y;
      if (y > maxY[c]) maxY[c] = y;
    }
    const step = Math.max(1, Math.floor(count / 50_000));
    for (let e = 0; e < count; e++) {
      const a = edges[2 * e];
      const c = labels[a];
      perComponent[c] += 1;
      if (e % step === 0) {
        const b = edges[2 * e + 1];
        lengthSum[c] += Math.hypot(pos[2 * a] - pos[2 * b], pos[2 * a + 1] - pos[2 * b + 1]);
        sampled[c] += 1;
      }
    }
    this.edgeDensity = 0;
    this.vertexDensity = 0;
    this.meanEdgeLength = this.linkLength;
    for (let c = 1; c <= components; c++) {
      if (perComponent[c] < count * 0.05 || sampled[c] === 0) continue;
      const w = Math.max(maxX[c] - minX[c], this.linkLength);
      const h = Math.max(maxY[c] - minY[c], this.linkLength);
      const area = (Math.PI / 4) * w * h;
      const density = perComponent[c] / area;
      if (density > this.edgeDensity) {
        this.edgeDensity = density;
        this.vertexDensity = size[c] / area;
        this.meanEdgeLength = Math.max(1, lengthSum[c] / sampled[c]);
      }
    }
  }

  /**
   * Alpha scales for the edges at the current zoom: where many edges cross
   * each pixel, each is faded so that together they still reach
   * `EDGE_COVERAGE`, and a graph like grafo_2 (1.3M edges) reads as a
   * texture rather than a black disc. Zooming in thins the pile and the
   * edges come back to full strength. Tree edges get their own scale.
   */
  private fades(scale: number): [number, number] {
    // Edges per pixel: density per world area, times the pixels one edge
    // covers, over the pixels one world unit of area covers.
    const perEdge = Math.max(1, this.meanEdgeLength * scale);
    const fade = (density: number, alpha: number, coverage: number) => {
      const overdraw = (density * perEdge) / (scale * scale);
      const wanted = -Math.log(1 - coverage) / Math.max(overdraw, 1e-6);
      return Math.min(1, wanted / Math.max(alpha, 1e-3));
    };
    return [
      fade(this.edgeDensity, this.theme.edge[3], EDGE_COVERAGE),
      fade(this.vertexDensity, this.viewValues.edgeTree[3], TREE_COVERAGE),
    ];
  }

  /** Drops the graph; the canvas clears on the next frame. */
  unload() {
    this.unloadGraph();
  }

  private unloadGraph() {
    this.n = 0;
    this.edgeCount = 0;
    this.alpha = 0;
    this.dragIndex = 0;
    this.mirror = new Float32Array(0);
    this.csrOffsets = new Uint32Array(0);
    this.csrTargets = new Uint32Array(0);
    this.cpuEdges = new Uint32Array(0);
    this.cpuLabels = new Uint32Array(0);
    this.touch(true);
    // vgpu frees buffers with the gpu; between graphs we simply drop the
    // handles (a page loads a handful of graphs at most).
    this.positions = null;
    this.velocities = null;
    this.edgeBuffer = null;
    this.offsets = null;
    this.targets = null;
    this.anchors = null;
    this.levels = null;
    this.ranks = null;
    this.parents = null;
    this.labels = null;
    this.path = null;
    this.pathVertices = null;
    this.extras = null;
    this.negative = null;
    this.negativeCount = 0;
    this.marks = null;
    this.morphFrom = null;
    this.morphDest = null;
    this.morphTarget = null;
  }

  /**
   * Slides every vertex to `target` (flat `[x, y, ...]`, `(n + 1) * 2`
   * entries) over `ms` milliseconds; the simulation is cooled so it does
   * not fight the new layout. `ms` of 0 jumps.
   */
  morphTo(target: Float32Array, ms: number) {
    if (this.n === 0 || !this.positions || !this.velocities) return;
    const slots = this.n + 1;
    this.alpha = 0;
    this.velocities.write(new Float32Array(slots * 2));
    // The fades are tuned to the destination: a layout that spreads a
    // component out needs less thinning than one that packs it.
    this.measure(target);
    [this.viewValues.edgeFade, this.viewValues.treeFade] = this.fades(this.viewValues.scale);
    if (ms <= 0) {
      this.positions.read.write(bytes(target));
      this.positions.write.write(bytes(target));
      this.mirror = new Float32Array(target);
      this.morphTarget = null;
      this.touch(true);
      this.onPositions?.(this.mirror);
      return;
    }
    this.morphFrom ??= storage(this.gpu, slots * 8, 'read');
    this.morphDest ??= storage(this.gpu, slots * 8, 'read');
    this.morphFrom.write(bytes(this.mirror));
    this.morphDest.write(bytes(target));
    this.morphTarget = target;
    this.morphStart = performance.now();
    this.morphMs = ms;
    this.dirty = true;
  }

  /**
   * Stretches the picture about the origin, `sx` along x and `sy` along y, with
   * no animation of its own: it follows a slider. A running layout change
   * carries on towards its stretched destination and a hot simulation keeps its
   * heat. Costs one upload, the fades being updated rather than measured again.
   */
  stretch(sx: number, sy: number) {
    if (this.n === 0 || !this.positions) return;
    const scale = (positions: Float32Array) => {
      for (let i = 2; i < positions.length; i += 2) {
        positions[i] *= sx;
        positions[i + 1] *= sy;
      }
    };
    this.stretches += 1;
    scale(this.mirror);
    if (this.morphTarget && this.morphDest) {
      scale(this.morphTarget);
      this.morphDest.write(bytes(this.morphTarget));
    } else {
      // Drawing and every next step read from here; the other side gets overwritten.
      this.positions.read.write(bytes(this.mirror));
    }
    const area = sx * sy;
    this.edgeDensity /= area;
    this.vertexDensity /= area;
    this.meanEdgeLength *= Math.sqrt(area);
    [this.viewValues.edgeFade, this.viewValues.treeFade] = this.fades(this.viewValues.scale);
    this.touch(true);
  }

  /**
   * The force layout's spacing: its equilibrium stretched `spacing` times, the
   * springs' rest length, the charge and the component homes scaled so that
   * every force grows by exactly that much. A settled picture stretched by as
   * much is therefore still settled.
   */
  setForceSpacing(spacing: number) {
    this.forceSpacing = spacing;
  }

  get morphing(): boolean {
    return this.morphTarget !== null;
  }

  /** Uploads a search tree; pass `null` to clear it. */
  setSearch(search: SearchBuffers | null) {
    if (!this.levels || !this.ranks || !this.parents) return;
    if (search) {
      this.levels.write(bytes(search.levels));
      this.ranks.write(bytes(search.ranks));
      this.parents.write(bytes(search.parents));
      this.viewValues.mode = search.kind === 'dfs' ? 2 : 1;
      this.viewValues.maxLevel = Math.max(search.depth, 1);
    } else {
      this.viewValues.mode = 0;
    }
    this.touch(true);
  }

  /** Highest discovery rank drawn as reached; `Infinity` shows the whole tree. */
  setReveal(rank: number) {
    const reveal = Number.isFinite(rank) ? rank : 4e9;
    if (reveal === this.viewValues.reveal) return;
    this.viewValues.reveal = reveal;
    this.touch(true);
  }

  /** Ranks revealed per second; times the pop and draw-in of discoveries. */
  setRevealRate(ranksPerSecond: number) {
    this.viewValues.rate = Math.max(ranksPerSecond, 1e-3);
    this.touch(true);
  }

  /**
   * Shows a distance query: `target` (0 clears) is drawn in green and the
   * origin in the accent, everything off the path shrinks, and the path
   * (vertex ids in order, `null` when the target is not reached) grows
   * with a ring, its edges drawn in the ring colour, never dropped by the
   * sampling. The path's edges must be edges of the graph. With `cycle`
   * the path is a closed walk (a negative cycle, first vertex repeated
   * last): drawn whole in the cycle's red, everything else greyed and shrunk.
   */
  setPath(target: number, path: Uint32Array | null, cycle = false) {
    if (!this.path) return;
    const length = path?.length ?? 0;
    const ring = cycle && length > 0 ? 1 : 0;
    if (
      length === 0 &&
      this.viewValues.pathLength === 0 &&
      target === this.viewValues.dest &&
      ring === this.viewValues.cycle
    ) {
      return;
    }
    this.viewValues.dest = target;
    this.viewValues.cycle = ring;
    if (ring) this.viewValues.walk = -1;
    if (length > 0 && path) {
      if (this.path.size < length * 4) this.path = storage(this.gpu, length * 4, 'read');
      this.path.write(bytes(path));
      this.nodes.set({ path: this.path });
      this.pathEdges.set({ path: this.path });
    }
    this.pathVertices = length > 0 ? path : null;
    this.viewValues.pathLength = length;
    this.updateExtras();
    this.touch(true);
  }

  /**
   * Draws the edges Dijkstra refuses the graph for (`[u, v]` pairs, the
   * arcs u -> v on a directed graph) as thick segments in the cycle's red
   * over everything, never dropped by the sampling. Only these pairs are
   * uploaded. `null` clears.
   */
  setNegative(pairs: Uint32Array | null) {
    if (!this.negative) return;
    const count = pairs ? pairs.length >> 1 : 0;
    if (count === 0 && this.negativeCount === 0) return;
    if (count > 0 && pairs) {
      if (this.negative.size < pairs.byteLength) {
        this.negative = storage(this.gpu, pairs.byteLength, 'read');
      }
      this.negative.write(bytes(pairs));
      this.negativeEdges.set({ pairs: this.negative });
    }
    this.negativeCount = count;
    this.touch(true);
  }

  /**
   * Rebuilds the extra edge segments drawn over the sample: the selected
   * vertex's edges, from the CSR row.
   */
  private updateExtras() {
    if (!this.extras) return;
    const v = this.viewValues.selected;
    let degree = this.selectedDegree;
    let pairs = new Uint32Array(Math.max(1, degree) * 2);
    let outgoing = 0;
    if (v && this.viewValues.arrows && v + 1 < this.outOffsets.length) {
      // A directed graph: the out-arcs [v, w] first, then the in-arcs
      // [u, v] (drawn dashed).
      const outs = this.outTargets.subarray(this.outOffsets[v], this.outOffsets[v + 1]);
      const ins = this.inTargets.subarray(this.inOffsets[v], this.inOffsets[v + 1]);
      outgoing = outs.length;
      degree = outs.length + ins.length;
      pairs = new Uint32Array(Math.max(1, degree) * 2);
      outs.forEach((w, i) => {
        pairs[2 * i] = v;
        pairs[2 * i + 1] = w;
      });
      ins.forEach((u, i) => {
        pairs[2 * (outgoing + i)] = u;
        pairs[2 * (outgoing + i) + 1] = v;
      });
    } else {
      for (let i = 0; i < degree; i++) {
        pairs[2 * i] = v;
        pairs[2 * i + 1] = this.csrTargets[this.csrOffsets[v] + i];
      }
    }
    this.viewValues.incidentOut = outgoing;
    if (this.extras.size < pairs.byteLength) {
      this.extras = storage(this.gpu, pairs.byteLength, 'read');
    }
    this.extras.write(bytes(pairs));
    this.extraEdges.set({ extras: this.extras });
    this.extraHeads.set({ extras: this.extras });
    this.viewValues.incident = degree;
  }

  /**
   * Walks the path of a distance query to a step (its vertex index along
   * the path, fractional while moving): the path is drawn up to it and its
   * vertex ringed. A negative step hands the path back to the wave.
   */
  setWalk(step: number) {
    const walk = step >= 0 ? step : -1;
    if (walk === this.viewValues.walk) return;
    this.viewValues.walk = walk;
    this.touch(true);
  }

  /** In a distance query, greys everything but the path (the traversal's colours otherwise). */
  setPathOnly(on: boolean) {
    const mute = on ? 1 : 0;
    if (mute === this.viewValues.mute) return;
    this.viewValues.mute = mute;
    this.touch(true);
  }

  /** Lights one component (its id, 1 = largest) and dims the rest; 0 shows all. */
  setComponent(c: number) {
    if (c === this.viewValues.component) return;
    this.viewValues.component = c;
    this.touch(true);
  }

  /** Lights only the marked vertices (`vertices[v]`, slot 0 unused) and,
      given `edges` (one per edge, in the loaded order), only those edges;
      without them, the edges between two marked vertices. `null` clears. */
  setMarks(vertices: Uint32Array | null, edges: Uint32Array | null) {
    if (!this.marks) return;
    if (!vertices) {
      if (this.viewValues.marked === 0) return;
      this.viewValues.marked = 0;
      this.touch(true);
      return;
    }
    const slots = this.n + 1;
    const joined = new Uint32Array(slots + Math.max(this.edgeCount, 1));
    joined.set(vertices.subarray(0, slots));
    if (edges) joined.set(edges.subarray(0, this.edgeCount), slots);
    this.marks.write(bytes(joined));
    this.viewValues.marked = edges ? 2 : 1;
    this.touch(true);
  }

  setHovered(v: number) {
    if (v === this.viewValues.hovered) return;
    this.viewValues.hovered = v;
    this.touch();
  }

  /** Selects a vertex: it, its neighbours and the edges between are lit. */
  setSelected(v: number) {
    if (v === this.viewValues.selected) return;
    this.viewValues.selected = v;
    this.updateExtras();
    this.touch(true);
  }

  /** Edges of the lit path, one thick segment each. */
  private get pathSegments(): number {
    return Math.max(0, this.viewValues.pathLength - 1);
  }

  /** Every edge draw: the lines and the heads of each kind. */
  private get edgeDraws(): Draw[] {
    return [
      this.edges,
      this.treeEdges,
      this.extraEdges,
      this.edgeHeads,
      this.treeHeads,
      this.extraHeads,
    ];
  }

  /** Degree of the selected vertex: how many extra segments and instances its neighbourhood needs. */
  private get selectedDegree(): number {
    const v = this.viewValues.selected;
    if (!v || v + 1 >= this.csrOffsets.length) return 0;
    return this.csrOffsets[v + 1] - this.csrOffsets[v];
  }

  setCamera(camera: Camera) {
    const same =
      camera.x === this.camera.x && camera.y === this.camera.y && camera.zoom === this.camera.zoom;
    this.camera = camera;
    if (!same) this.updateView(true);
  }

  setNodeRadius(cssPixels: number) {
    this.nodeRadius = cssPixels;
    this.updateView();
  }

  get positionsMirror(): Float32Array {
    return this.mirror;
  }

  /** Reheats the simulation (after a drag, or on request). */
  reheat(alpha = 1) {
    if (this.n === 0) return;
    this.alpha = Math.max(this.alpha, alpha);
    this.dirty = true;
  }

  /** Turns the simulation on or off; on, it reheats unless told not to
      (a restored picture stays where it was). */
  setSimulate(on: boolean, reheat = true) {
    this.simulate = on;
    if (on && reheat) this.reheat(0.6);
  }

  /** Pins vertex `v` at a world position while the pointer drags it. */
  beginDrag(v: number, x: number, y: number) {
    this.dragIndex = v;
    this.drag(x, y);
    if (this.simulate) this.reheat(0.35);
  }

  drag(x: number, y: number) {
    this.dragPos = [x, y];
    if (this.dragIndex) {
      this.mirror[2 * this.dragIndex] = x;
      this.mirror[2 * this.dragIndex + 1] = y;
      this.dirty = true;
    }
  }

  endDrag() {
    this.dragIndex = 0;
  }

  private updateView(edges = false) {
    const [w, h] = this.surface.size;
    const dpr = this.surface.dpr;
    const view = this.viewValues;
    if (view.viewport[0] !== w || view.viewport[1] !== h) {
      view.viewport = [w, h];
      edges = true;
    }
    const scale = this.camera.zoom * dpr;
    if (
      view.offset[0] !== this.camera.x ||
      view.offset[1] !== this.camera.y ||
      view.scale !== scale
    ) {
      view.offset = [this.camera.x, this.camera.y];
      view.scale = scale;
      [view.edgeFade, view.treeFade] = this.fades(scale);
      edges = true;
    }
    // Vertices scale with the zoom but stay between one and twelve pixels.
    const r = Math.min(12, Math.max(1.5, this.nodeRadius * Math.sqrt(this.camera.zoom)));
    if (view.radius !== r * dpr) {
      view.radius = r * dpr;
      this.dirty = true;
    }
    this.touch(edges);
  }

  /** Strides of the edge samples drawn at rest (1 = every edge, see
      `MIN_EDGE_ALPHA`): plain edges, tree edges. */
  private restStride(): [number, number] {
    const view = this.viewValues;
    const rest = (alpha: number) => Math.max(1, Math.ceil(MIN_EDGE_ALPHA / Math.max(alpha, 1e-6)));
    return [rest(this.theme.edge[3] * view.edgeFade), rest(view.edgeTree[3] * view.treeFade)];
  }

  /** Stride of the vertex sample drawn at rest: where more than `NODE_PILE`
      vertices land on a pixel, drawing all of them changes nothing. */
  private restNodeStride(): number {
    const scale = this.viewValues.scale;
    const perPixel = this.vertexDensity / (scale * scale);
    return Math.max(1, Math.floor(perPixel / NODE_PILE));
  }

  /** The edge layer, sized like the surface (recreated when that changes). */
  private layer(): Target {
    const [w, h] = this.surface.size;
    const size: [number, number] = [Math.max(1, w), Math.max(1, h)];
    if (!this.edgeLayer) {
      this.edgeLayer = target(this.gpu, {
        size,
        // Half floats: faded edges add far less than 1/255 each.
        format: 'rgba16float',
        clearColor: [0, 0, 0, 0],
        label: 'edge-layer',
      });
    } else if (this.edgeLayer.size[0] !== size[0] || this.edgeLayer.size[1] !== size[1]) {
      this.edgeLayer.resize(size);
      this.edgesDirty = true;
    }
    return this.edgeLayer;
  }

  private start() {
    if (this.loop) return;
    this.loop = frameLoop(this.gpu, (frame) => {
      if (this.n === 0) {
        if (!this.dirty) return;
        this.dirty = false;
        frame.pass({ target: this.surface, clear: this.theme.background }, () => {});
        return;
      }
      this.updateView();

      if (this.morphTarget && this.positions && this.morphFrom && this.morphDest) {
        const raw = Math.min(1, (performance.now() - this.morphStart) / this.morphMs);
        const t = 1 - Math.pow(1 - raw, 3); // ease out
        this.morph.set({
          morph: { n: this.n, dragIndex: this.dragIndex, t, pad: 0, dragPos: this.dragPos },
          src: this.morphFrom,
          dst: this.morphDest,
          posOut: this.positions.write,
        });
        this.morph.dispatch(Math.ceil((this.n + 1) / WORKGROUP));
        this.positions.swap();
        this.edgesDirty = true;
        if (raw >= 1) {
          // Land exactly on the target, mirror included.
          this.mirror = new Float32Array(this.morphTarget);
          this.morphTarget = null;
          this.onPositions?.(this.mirror);
        } else {
          this.scheduleRead();
        }
      }

      const stepping = !this.morphTarget && (this.dragIndex !== 0 || this.simulating);
      if (stepping && this.positions && this.velocities) {
        this.sim.set({
          params: {
            n: this.n,
            dragIndex: this.dragIndex,
            simulate: this.simulating ? 1 : 0,
            spread: this.forceSpacing,
            alpha: this.alpha,
            charge: this.linkLength * 1.1 * this.forceSpacing * this.forceSpacing,
            linkLength: this.linkLength * this.forceSpacing,
            gravity: 0.03,
            dragPos: this.dragPos,
          },
          posIn: this.positions.read,
          posOut: this.positions.write,
        });
        this.sim.dispatch(Math.ceil((this.n + 1) / WORKGROUP));
        this.positions.swap();
        if (this.simulating) {
          this.alpha *= 1 - ALPHA_DECAY;
          if (this.alpha <= ALPHA_MIN) {
            this.alpha = 0;
            this.onSettled?.();
          }
        }
        this.scheduleRead();
      }

      if (stepping) this.edgesDirty = true;

      // Nothing changed: leave the last frame on the canvas.
      const layer = this.layer();
      const now = performance.now();
      const rest = this.restStride();
      const restNodes = this.restNodeStride();
      const settle =
        (this.layerStride[0] > rest[0] ||
          this.layerStride[1] > rest[1] ||
          this.nodeStride > restNodes) &&
        now - this.lastEdgeChange > SETTLE_MS;
      if (!this.dirty && !this.edgesDirty && !settle) return;

      if (this.positions) {
        const current = this.positions.read;
        for (const edgeDraw of this.edgeDraws) edgeDraw.set({ positions: current });
        this.pathEdges.set({ positions: current });
        this.negativeEdges.set({ positions: current });
        this.nodes.set({ positions: current });
      }
      // While the picture keeps moving draw a sample of the edges and of
      // the vertices; once it has been still for a moment, draw the
      // resting samples (every edge and vertex, unless they pile up).
      const moving = this.edgesDirty;
      if (moving) this.lastEdgeChange = now;
      this.nodeStride = moving ? Math.max(restNodes, Math.ceil(this.n / NODE_BUDGET)) : restNodes;
      if (moving || settle) {
        const stride: [number, number] = moving
          ? [
              Math.max(rest[0], Math.ceil(this.edgeCount / EDGE_BUDGET)),
              Math.max(rest[1], Math.ceil(this.n / EDGE_BUDGET)),
            ]
          : rest;
        this.edgesDirty = false;
        this.layerStride = stride;
        [this.viewValues.stride, this.viewValues.treeStride] = stride;
        this.view.set(this.viewValues);
        frame.pass({ target: layer, clear: [0, 0, 0, 0] }, (pass) => {
          // Two vertices a line; on a directed graph three more a head.
          const arrows = this.viewValues.arrows !== 0;
          const plain = Math.ceil(this.edgeCount / stride[0]);
          pass.draw(this.edges, { vertices: plain * 2 });
          if (arrows) pass.draw(this.edgeHeads, { vertices: plain * 3 });
          if (this.viewValues.mode !== 0) {
            const tree = Math.ceil(this.edgeCount / stride[1]);
            pass.draw(this.treeEdges, { vertices: tree * 2 });
            if (arrows) pass.draw(this.treeHeads, { vertices: tree * 3 });
          }
          const incident = this.viewValues.selected ? this.viewValues.incident : 0;
          if (incident > 0) {
            pass.draw(this.extraEdges, { vertices: incident * 2 });
            if (arrows) pass.draw(this.extraHeads, { vertices: incident * 3 });
          }
          if (this.pathSegments > 0) pass.draw(this.pathEdges, { instances: this.pathSegments });
          if (this.negativeCount > 0) {
            pass.draw(this.negativeEdges, { instances: this.negativeCount });
          }
        });
      }
      this.dirty = false;
      this.viewValues.nodeStride = this.nodeStride;
      this.view.set(this.viewValues);
      this.composite.set({ layer: layer.color });
      frame.pass({ target: this.surface, clear: this.theme.background }, (pass) => {
        pass.draw(this.composite);
        pass.draw(this.nodes, {
          instances:
            Math.ceil(this.n / this.nodeStride) +
            this.selectedDegree +
            2 +
            this.viewValues.pathLength,
        });
      });
    });
  }

  /** Copies the latest positions back for picking, one read in flight at a time. */
  private scheduleRead() {
    if (this.readInFlight) {
      this.readAgain = true;
      return;
    }
    const buffer = this.positions?.read;
    if (!buffer) return;
    this.readInFlight = true;
    const n = this.n;
    const stretches = this.stretches;
    void buffer
      .read()
      .then((bytes) => {
        if (this.n !== n || bytes.byteLength !== this.mirror.byteLength) return;
        if (this.stretches !== stretches) {
          this.readAgain = true;
          return;
        }
        this.mirror = new Float32Array(bytes);
        if (this.dragIndex) {
          this.mirror[2 * this.dragIndex] = this.dragPos[0];
          this.mirror[2 * this.dragIndex + 1] = this.dragPos[1];
        }
        this.onPositions?.(this.mirror);
      })
      .catch(() => {})
      .finally(() => {
        this.readInFlight = false;
        if (this.readAgain) {
          this.readAgain = false;
          this.scheduleRead();
        }
      });
  }

  /** Canvas size in CSS pixels. */
  get cssSize(): [number, number] {
    const [w, h] = this.surface.size;
    const dpr = this.surface.dpr;
    return [w / dpr, h / dpr];
  }

  dispose() {
    this.loop?.stop();
    this.loop = null;
    this.gpu.dispose();
  }
}

interface Lease {
  promise: Promise<Renderer>;
  claims: number;
}

const leases = new WeakMap<HTMLCanvasElement, Lease>();

/**
 * One renderer per canvas, shared by everyone who asks for it and disposed
 * only when the last claim is released. React's StrictMode mounts effects
 * twice in development; two renderers on one canvas would each configure
 * the same `GPUCanvasContext`, and disposing the stale one would unconfigure
 * it under the live one ("canvas is not configured" on the next frame).
 */
export function acquireRenderer(
  canvas: HTMLCanvasElement,
  theme: Theme,
): { renderer: Promise<Renderer>; release: () => void } {
  let lease = leases.get(canvas);
  if (!lease) {
    lease = { promise: Renderer.create(canvas, theme), claims: 0 };
    leases.set(canvas, lease);
  } else {
    void lease.promise.then((renderer) => renderer.setTheme(theme)).catch(() => {});
  }
  const current = lease;
  current.claims += 1;
  let released = false;
  return {
    renderer: current.promise,
    release: () => {
      if (released) return;
      released = true;
      current.claims -= 1;
      // A StrictMode remount re-claims synchronously; a real unmount does not.
      setTimeout(() => {
        if (current.claims > 0 || leases.get(canvas) !== current) return;
        leases.delete(canvas);
        void current.promise.then((renderer) => renderer.dispose()).catch(() => {});
      }, 0);
    },
  };
}

/** Mean position of each component, assigned to every vertex in it. */
function componentAnchors(graph: GraphBuffers): Float32Array {
  const n = graph.vertexCount;
  const labels = graph.componentLabels;
  let count = 0;
  for (let v = 1; v <= n; v++) count = Math.max(count, labels[v]);
  const sum = new Float64Array((count + 1) * 2);
  const size = new Uint32Array(count + 1);
  for (let v = 1; v <= n; v++) {
    const c = labels[v];
    sum[2 * c] += graph.positions[2 * v];
    sum[2 * c + 1] += graph.positions[2 * v + 1];
    size[c] += 1;
  }
  const anchors = new Float32Array((n + 1) * 2);
  for (let v = 1; v <= n; v++) {
    const c = labels[v];
    anchors[2 * v] = sum[2 * c] / size[c];
    anchors[2 * v + 1] = sum[2 * c + 1] / size[c];
  }
  return anchors;
}

/** Reads the theme colours from the CSS variables on `:root`. */
export function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: Rgba): Rgba =>
    parseColor(style.getPropertyValue(name)) ?? fallback;
  return {
    background: get('--bg', [1, 1, 1, 1]),
    node: get('--node', [0.56, 0.56, 0.56, 1]),
    nodeDim: get('--node-dim', [0.84, 0.84, 0.84, 1]),
    levelA: get('--accent', [0, 0.44, 0.95, 1]),
    levelB: get('--accent-2', [0, 0.72, 0.85, 1]),
    ring: get('--fg', [0.09, 0.09, 0.09, 1]),
    edge: get('--canvas-edge', [0.09, 0.09, 0.09, 0.34]),
    edgeDim: get('--canvas-edge-dim', [0.09, 0.09, 0.09, 0.12]),
    target: get('--target', [0.09, 0.64, 0.29, 1]),
    cycle: get('--cycle', [0.9, 0.28, 0.3, 1]),
  };
}

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim();
  if (!s) return null;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const parts =
      hex.length <= 4
        ? hex.split('').map((c) => parseInt(c + c, 16))
        : (hex.match(/../g) ?? []).map((c) => parseInt(c, 16));
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] / 255 : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const parts = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

/** The arcs `[u, v, ...]` as rows by tail (`end` 0) or by head (`end` 1):
    offsets (`n + 2`, index 0 unused) and the other ends, by a counting sort. */
function rows(n: number, arcs: Uint32Array, end: 0 | 1): [Uint32Array, Uint32Array] {
  const offsets = new Uint32Array(n + 2);
  for (let i = end; i < arcs.length; i += 2) offsets[arcs[i] + 1] += 1;
  for (let v = 1; v < offsets.length; v++) offsets[v] += offsets[v - 1];
  const cursor = offsets.slice(0, n + 1);
  const targets = new Uint32Array(arcs.length / 2);
  for (let i = 0; i < arcs.length; i += 2) {
    const [from, to] = end === 0 ? [arcs[i], arcs[i + 1]] : [arcs[i + 1], arcs[i]];
    targets[cursor[from]++] = to;
  }
  return [offsets, targets];
}
