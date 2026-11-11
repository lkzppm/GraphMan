// WGSL for the observatory. Shaders are plain strings so no bundler loader
// is involved; vgpu reflects the bindings and packs the uniform structs.
//
// Every per-vertex buffer is indexed by vertex id (1-based, slot 0 unused),
// mirroring the library's raw arrays.

/** Shared by the node and edge draws; one `uniforms()` object feeds both. */
const VIEW = /* wgsl */ `
struct View {
  offset: vec2f,      // world coordinates at the centre of the viewport
  viewport: vec2f,    // device pixels
  scale: f32,         // device pixels per world unit
  radius: f32,        // node radius in device pixels
  reveal: f32,        // discovery ranks <= reveal are lit
  rate: f32,          // ranks revealed per second (drives the discovery animation)
  maxLevel: f32,
  hovered: u32,
  selected: u32,
  mode: u32,          // 0 = no search, 1 = BFS, 2 = DFS
  n: u32,
  component: u32,     // > 0: only this component is lit, the rest is dimmed
  stride: u32,        // > 1 while moving: only every stride-th non-tree edge is drawn
  treeStride: u32,    // the same for the tree edges of a search
  nodeStride: u32,    // > 1 where vertices pile up: only every nodeStride-th is drawn
  edgeFade: f32,      // alpha scale of the plain and dim edges (thins dense pictures)
  treeFade: f32,      // alpha scale of the tree edges
  pathLength: u32,    // vertices in the lit path (0 = none), see the path buffer
  incident: u32,      // edges at the selected vertex: the first segments of the extras buffer
  dest: u32,          // a distance query's destination (0 = none): the picture is the path; "target" is a reserved word
  mute: u32,          // 1: only the path keeps its colours, the rest of the search goes grey
  walk: f32,          // >= 0: the path is walked to this step (vertex index along it, fractional while moving); < 0: it follows the wave
  marked: u32,        // 1: only the marked vertices (and the edges between them) keep their colour; 2: the marked edges and their ends; the rest goes ghostly
  arrows: u32,        // 1: the graph is directed, every edge [a, b] is the arc a -> b and gets a head at b
  incidentOut: u32,   // directed: the first incidentOut extras are the selected vertex's out-arcs (solid), the rest its in-arcs (dashed)
  cycle: u32,         // 1: the lit path is a negative cycle, drawn whole in colorCycle over a greyed graph
  base: vec4f,        // node colour without a search
  dim: vec4f,         // node not (yet) reached
  colorA: vec4f,      // level 0
  colorB: vec4f,      // deepest level
  ring: vec4f,        // hover / selection ring
  edge: vec4f,
  edgeDim: vec4f,
  edgeTree: vec4f,
  colorTarget: vec4f, // the destination of a distance query
  colorCycle: vec4f,  // a negative cycle or Dijkstra's refused negative edges, the one red
}
@group(0) @binding(0) var<uniform> view: View;

fn toClip(px: vec2f) -> vec4f {
  return vec4f(px.x / view.viewport.x * 2.0, -px.y / view.viewport.y * 2.0, 0.0, 1.0);
}

// Level ramp with real contrast: a deep navy at the origin, the accent in
// the middle, the light blue at the deepest level.
fn levelColor(level: u32) -> vec4f {
  let t = clamp(f32(level) / max(view.maxLevel, 1.0), 0.0, 1.0);
  let dark = vec4f(view.colorA.rgb * 0.42, view.colorA.a);
  if (t < 0.5) {
    return mix(dark, view.colorA, t * 2.0);
  }
  return mix(view.colorA, view.colorB, (t - 0.5) * 2.0);
}

// Seconds since rank was revealed (negative: not yet).
fn age(rank: u32) -> f32 {
  return (view.reveal - f32(rank)) / max(view.rate, 1e-3);
}

// 1 at the instant of discovery, fading to 0 over seconds.
fn freshness(rank: u32, seconds: f32) -> f32 {
  if (rank == 0xffffffffu || f32(rank) > view.reveal) { return 0.0; }
  return 1.0 - smoothstep(0.0, seconds, age(rank));
}
`;

export const NODE_SHADER = /* wgsl */ `
${VIEW}
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
@group(0) @binding(2) var<storage, read> levels: array<u32>;
@group(0) @binding(3) var<storage, read> ranks: array<u32>;
@group(0) @binding(4) var<storage, read> labels: array<u32>;
@group(0) @binding(5) var<storage, read> offsets: array<u32>;
@group(0) @binding(6) var<storage, read> targets: array<u32>;
@group(0) @binding(7) var<storage, read> path: array<u32>;
// 1 per vertex a distribution column lit (see view.marked).
@group(0) @binding(8) var<storage, read> marks: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) flags: u32,
  @location(3) @interpolate(flat) rpx: f32,
  @location(4) @interpolate(flat) pop: f32,
}

fn nodeColor(v: u32) -> vec4f {
  if (view.marked != 0u && marks[v] == 0u) { return view.dim * 0.18; }
  if (view.component != 0u && labels[v] != view.component) { return view.dim; }
  // A negative cycle: the cycle alone keeps a colour (the path's, below).
  if (view.cycle != 0u) { return view.dim; }
  if (view.mode == 0u) { return view.base; }
  let rank = ranks[v];
  if (rank == 0xffffffffu || f32(rank) > view.reveal) { return view.dim; }
  // A distance query: the origin in the accent, the destination in green,
  // and, muted, everything else grey.
  if (view.dest != 0u) {
    if (v == view.dest) { return view.colorTarget; }
    if (levels[v] == 0u) { return view.colorA; }
    if (view.mute != 0u) { return view.dim; }
  }
  return levelColor(levels[v]);
}

// Whether v is adjacent to the selected vertex: a binary search of the
// selected vertex's neighbour row (rows are ascending).
fn adjacent(v: u32) -> bool {
  if (view.selected == 0u) { return false; }
  var lo = offsets[view.selected];
  var hi = offsets[view.selected + 1u];
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    let w = targets[mid];
    if (w == v) { return true; }
    if (w < v) { lo = mid + 1u; } else { hi = mid; }
  }
  return false;
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  // Instances cover every nodeStride-th vertex, then the neighbours of the
  // selected vertex, the hovered and the selected one, then the vertices
  // of the lit path (none of which need be in the sample; the extras draw
  // on top of their sampled twins).
  let sampled = (view.n + view.nodeStride - 1u) / view.nodeStride;
  var degree = 0u;
  if (view.selected != 0u) { degree = offsets[view.selected + 1u] - offsets[view.selected]; }
  var v = ii * view.nodeStride + 1u;
  var onPath = false;
  var along = 0.0; // position along the path, 0 at the origin, 1 at the destination
  var step = 0u;    // index along the path
  if (ii >= sampled && ii < sampled + degree) { v = targets[offsets[view.selected] + ii - sampled]; }
  if (ii == sampled + degree) { v = view.hovered; }
  if (ii == sampled + degree + 1u) { v = view.selected; }
  if (ii >= sampled + degree + 2u) {
    let j = ii - sampled - degree - 2u;
    if (j >= view.pathLength) { v = 0u; } else { v = path[j]; onPath = true; step = j; }
    along = f32(j) / max(f32(view.pathLength - 1u), 1.0);
    // The path shows as the wave reaches it, or, while it is walked, up to
    // the step the walk is on; until then the sampled twin stands.
    // A negative cycle has no wave: it stands whole.
    if (onPath && view.cycle != 0u) {
    } else if (onPath && view.walk >= 0.0) {
      if (f32(j) > view.walk + 0.001) { v = 0u; }
    } else if (onPath && f32(ranks[v]) > view.reveal) { v = 0u; }
  }
  var out: VOut;
  if (v == 0u || v > view.n) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    return out;
  }
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = corners[vi];
  var r = view.radius;
  var flags = 0u;
  if (v == view.selected) { flags |= 1u; r = max(r * 1.5, 5.0); }
  if (v == view.hovered) { flags |= 2u; r = max(r * 1.3, 4.0); }
  if (flags == 0u && adjacent(v)) { flags |= 4u; r = max(r * 1.25, 4.0); }
  if (onPath) { flags |= 8u; r = max(r * 1.6, 6.0); }
  // The vertex the walk stands on wears the selection ring.
  if (onPath && view.walk >= 0.0 && step == u32(floor(view.walk + 0.001))) {
    flags |= 1u;
    r = max(r * 1.25, 7.0);
  }
  // In a distance query everything off the path shrinks out of the way.
  if ((view.dest != 0u || view.cycle != 0u) && !onPath && flags == 0u) { r = max(r * 0.35, 1.0); }
  // Discovery: the vertex pops to almost twice its size and settles.
  var pop = 0.0;
  if (view.mode != 0u) { pop = freshness(ranks[v], 0.5); }
  r = r * (1.0 + 0.9 * pop);
  // The quad only needs room for the ring and the halo when they show.
  let half = r + select(1.0, 3.0, flags != 0u) + 6.0 * pop;
  let centre = (positions[v] - view.offset) * view.scale;
  out.pos = toClip(centre + c * half);
  out.uv = c * half;
  out.color = mix(nodeColor(v), view.colorA, 0.5 * pop);
  // The path wears the gradient from the origin's blue to the destination's green.
  if (onPath) { out.color = mix(view.colorA, view.colorTarget, along); }
  if (onPath && view.cycle != 0u) { out.color = view.colorCycle; }
  out.flags = flags;
  out.rpx = r;
  out.pop = pop;
  return out;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let body = 1.0 - smoothstep(in.rpx - 0.7, in.rpx + 0.7, d);
  var rgb = in.color.rgb * in.color.a * body;
  var a = in.color.a * body;
  if (in.flags != 0u) {
    // The hover / selection ring; the neighbours of the selected vertex
    // wear a lighter one.
    let ring = smoothstep(in.rpx + 0.6, in.rpx + 1.4, d) * (1.0 - smoothstep(in.rpx + 2.2, in.rpx + 3.0, d))
      * select(1.0, 0.5, in.flags == 4u);
    rgb = rgb * (1.0 - ring) + view.ring.rgb * ring;
    a = a * (1.0 - ring) + ring;
  }
  if (in.pop > 0.0) {
    // A halo that expands and fades as the vertex settles.
    let outer = in.rpx + 3.0 + 6.0 * in.pop;
    let halo = smoothstep(in.rpx + 0.5, in.rpx + 2.0, d) * (1.0 - smoothstep(outer - 2.0, outer, d));
    let strength = halo * in.pop * 0.55;
    rgb += view.colorA.rgb * strength;
    a += strength;
  }
  return vec4f(rgb, a);
}
`;

/**
 * The path of a distance query as thick segments (one instanced quad per
 * edge), coloured from the origin's blue to the destination's green, each
 * drawing itself in as the wave discovers its far end.
 */
export const PATH_SHADER = /* wgsl */ `
${VIEW}
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
@group(0) @binding(2) var<storage, read> path: array<u32>;
@group(0) @binding(3) var<storage, read> ranks: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  if (ii + 1u >= view.pathLength) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.color = vec4f(0.0);
    return out;
  }
  let a = path[ii];
  let b = path[ii + 1u];
  let pa = (positions[a] - view.offset) * view.scale;
  var pb = (positions[b] - view.offset) * view.scale;
  // Drawn from a towards b during the rank before b is discovered, or,
  // while the path is walked, as the walk goes from a to b.
  var drawn = clamp(view.reveal - (f32(ranks[b]) - 1.0), 0.0, 1.0);
  if (view.walk >= 0.0) { drawn = clamp(view.walk - f32(ii), 0.0, 1.0); }
  if (view.cycle != 0u) { drawn = 1.0; }
  pb = mix(pa, pb, drawn);
  let d = pb - pa;
  let len = max(length(d), 1e-3);
  let n = vec2f(-d.y, d.x) / len * clamp(view.radius * 0.45, 1.5, 4.0);
  var corners = array<vec2f, 6>(
    pa - n, pb - n, pa + n,
    pa + n, pb - n, pb + n);
  out.pos = toClip(corners[vi]);
  let t = (f32(ii) + 0.5) / max(f32(view.pathLength - 1u), 1.0);
  var rgb = mix(view.colorA.rgb, view.colorTarget.rgb, t);
  if (view.cycle != 0u) { rgb = view.colorCycle.rgb; }
  out.color = vec4f(rgb, 0.95 * step(0.001, drawn));
  return out;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4f {
  return vec4f(in.color.rgb * in.color.a, in.color.a);
}
`;

/**
 * The negative edges Dijkstra refuses a graph for, as thick segments in the
 * cycle's red (one instanced quad per edge, as wide as a path's), and on a
 * directed graph a filled head at each arc's end: nine vertices an
 * instance, the last three culled on an undirected graph.
 */
export const NEGATIVE_SHADER = /* wgsl */ `
${VIEW}
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
// The negative edges as [a, b] pairs (the arc a -> b on a directed graph).
@group(0) @binding(2) var<storage, read> pairs: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  let pa = (positions[pairs[2u * ii]] - view.offset) * view.scale;
  let pb = (positions[pairs[2u * ii + 1u]] - view.offset) * view.scale;
  let d = pb - pa;
  let len = length(d);
  if (len < 1e-3) { return out; }
  let dir = d / len;
  let perp = vec2f(-dir.y, dir.x);
  let half = clamp(view.radius * 0.45, 1.5, 4.0);
  // The head's tip stops short of b's disc and the line stops inside the
  // head, so the thick line never shows past the tip.
  let tip = pb - dir * min(view.radius + 1.0, 0.5 * len);
  let size = min(view.radius + 4.0 + 2.0 * half, 0.4 * len);
  var end = pb;
  if (view.arrows != 0u) { end = tip - dir * (0.5 * size); }
  if (vi < 6u) {
    let n = perp * half;
    var corners = array<vec2f, 6>(
      pa - n, end - n, pa + n,
      pa + n, end - n, end + n);
    out.pos = toClip(corners[vi]);
    return out;
  }
  if (view.arrows == 0u) { return out; }
  var head = array<vec2f, 3>(
    tip,
    tip - dir * size + perp * (0.5 * size),
    tip - dir * size - perp * (0.5 * size));
  out.pos = toClip(head[vi - 6u]);
  return out;
}

@fragment fn fs_main() -> @location(0) vec4f {
  let a = 0.95;
  return vec4f(view.colorCycle.rgb * a, a);
}
`;

/** Copies the cached edge layer onto the surface (premultiplied, 1:1). */
export const COMPOSITE_SHADER = /* wgsl */ `
@group(0) @binding(0) var layer: texture_2d<f32>;

@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(layer, vec2i(pos.xy), 0);
}
`;

export const EDGE_SHADER = /* wgsl */ `
${VIEW}
@group(0) @binding(1) var<storage, read> positions: array<vec2f>;
@group(0) @binding(2) var<storage, read> edges: array<u32>;
@group(0) @binding(3) var<storage, read> parents: array<u32>;
@group(0) @binding(4) var<storage, read> ranks: array<u32>;
@group(0) @binding(5) var<storage, read> levels: array<u32>;
// Which edges this draw covers: 0 = the plain (non-tree) edges at
// view.stride, 1 = the tree edges of the search at view.treeStride, 2 = the
// extra segments (drawn last, over both).
struct Kind { tree: u32 }
@group(0) @binding(6) var<uniform> kind: Kind;
@group(0) @binding(7) var<storage, read> labels: array<u32>;
// The edges at the selected vertex as [a, b] pairs (view.incident of them;
// on a directed graph its out-arcs first, view.incidentOut of them, then its
// in-arcs, drawn dashed).
@group(0) @binding(8) var<storage, read> extras: array<u32>;
// 1 per vertex, then per edge (from slot n + 1), a distribution column lit
// (see view.marked); one buffer, as the vertex stage binds eight at most.
@group(0) @binding(9) var<storage, read> marks: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
  // Device pixels from the start of the segment, for the dashes.
  @location(1) along: f32,
  // 1: drawn dashed (an in-arc of the selected vertex).
  @location(2) dashed: f32,
}

fn cull() -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  out.color = vec4f(0.0);
  out.along = 0.0;
  out.dashed = 0.0;
  return out;
}

// One edge of this draw, as both of its draws (the line and, on a directed
// graph, the head) see it: its ends in device pixels and its colour.
struct Arc {
  pa: vec2f,
  pb: vec2f,
  color: vec4f,
  dashed: f32,
  ok: bool,
}

fn arc(segment: u32) -> Arc {
  var r: Arc;
  r.ok = false;
  r.dashed = 0.0;
  let stride = select(view.stride, view.treeStride, kind.tree != 0u);
  let count = arrayLength(&edges) / 2u;
  // The edges at the selected vertex are the extras draw's segments (the
  // CPU fills the extras buffer), so no stride can drop one and they sit
  // on top; the samples skip them.
  let incident = kind.tree == 2u;
  var a = 0u;
  var b = 0u;
  var e = 0u;
  if (incident) {
    if (segment >= view.incident) { return r; }
    a = extras[2u * segment];
    b = extras[2u * segment + 1u];
    if (segment >= view.incidentOut) { r.dashed = 1.0; }
  } else {
    e = segment * stride;
    if (e >= count) { return r; }
    a = edges[2u * e];
    b = edges[2u * e + 1u];
    if (view.selected != 0u && (a == view.selected || b == view.selected)) { return r; }
  }
  var wa = positions[a];
  var wb = positions[b];
  var color = view.edge;
  var tree = false;
  var drawn = 1.0;
  if (view.mode != 0u) {
    let ra = ranks[a];
    let rb = ranks[b];
    let child = select(a, b, rb > ra);
    let parent = select(b, a, rb > ra);
    let rc = max(ra, rb);
    if (parents[child] == parent && rc != 0xffffffffu) {
      // A tree edge draws itself from the parent towards the child during
      // the rank before the child is discovered, then brightens briefly.
      tree = true;
      drawn = clamp(view.reveal - (f32(rc) - 1.0), 0.0, 1.0);
      let grown = mix(positions[parent], positions[child], drawn);
      if (child == a) { wa = grown; } else { wb = grown; }
      let fresh = freshness(rc, 0.7);
      color = mix(view.edgeTree * levelColor(levels[child]), view.colorA, 0.6 * fresh);
      color.a = color.a * step(0.001, drawn);
    } else {
      color = view.edgeDim;
    }
  }
  if (view.component != 0u && (labels[a] != view.component || labels[b] != view.component)) {
    color = view.edgeDim;
  }
  if (view.marked != 0u) {
    var lit = marks[a] != 0u && marks[b] != 0u;
    if (view.marked == 2u && !incident) { lit = marks[view.n + 1u + e] != 0u; }
    if (!lit) { color = color * 0.12; }
  }
  if (view.mute != 0u && view.dest != 0u && !incident) { color = view.edgeDim; }
  r.pa = (wa - view.offset) * view.scale;
  r.pb = (wb - view.offset) * view.scale;
  if (incident) {
    r.color = vec4f(view.colorA.rgb, 0.85 * step(0.001, drawn));
    r.ok = true;
    return r;
  }
  if (tree != (kind.tree != 0u)) {
    // The other draw's kind of edge.
    return r;
  }
  let full = color.a;
  color.a = color.a * select(view.edgeFade, view.treeFade, tree);
  // A sample of the edges, each stronger so the density reads the same,
  // but never stronger than an unfaded edge (at a zoom where single edges
  // are visible the sample is simply thinner).
  color.a = min(color.a * f32(stride), full);
  r.color = color;
  r.ok = true;
  return r;
}

// The line of each edge: two vertices an edge.
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  let r = arc(vi / 2u);
  if (!r.ok) { return cull(); }
  let end = (vi & 1u) == 1u;
  var out: VOut;
  out.pos = toClip(select(r.pa, r.pb, end));
  out.color = r.color;
  out.along = select(0.0, length(r.pb - r.pa), end);
  out.dashed = r.dashed;
  return out;
}

// The head of each arc of a directed graph: a small filled triangle, three
// vertices an arc, its tip just short of the head's disc. Sized in device
// pixels, so it reads the same at every zoom.
@vertex fn vs_head(@builtin(vertex_index) vi: u32) -> VOut {
  if (view.arrows == 0u) { return cull(); }
  let r = arc(vi / 3u);
  if (!r.ok) { return cull(); }
  let d = r.pb - r.pa;
  let len = length(d);
  if (len < 1e-3) { return cull(); }
  let dir = d / len;
  let perp = vec2f(-dir.y, dir.x);
  let tip = r.pb - dir * min(view.radius + 1.0, 0.5 * len);
  let size = min(view.radius + 4.0, 0.35 * len);
  let corner = vi % 3u;
  var px = tip;
  if (corner == 1u) { px = tip - dir * size + perp * (0.42 * size); }
  if (corner == 2u) { px = tip - dir * size - perp * (0.42 * size); }
  var out: VOut;
  out.pos = toClip(px);
  // A filled head reads lighter than a line of the same alpha: a little more.
  out.color = vec4f(r.color.rgb, min(1.0, r.color.a * 1.5));
  out.along = 0.0;
  out.dashed = 0.0;
  return out;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4f {
  // Dashes of 6 device pixels, as long as the gaps.
  if (in.dashed > 0.5 && fract(in.along / 12.0) > 0.5) { discard; }
  return vec4f(in.color.rgb * in.color.a, in.color.a);
}
`;

/**
 * One step of a d3-style force simulation: exact many-body repulsion (tiled
 * through workgroup memory), springs along the CSR rows, a weak pull towards
 * each vertex's component centre, then Verlet integration with velocity decay.
 * When `simulate` is 0 only the dragged vertex moves, which is how graphs too
 * large to simulate stay interactive.
 */
export const SIM_SHADER = /* wgsl */ `
struct Params {
  n: u32,
  dragIndex: u32,
  simulate: u32,
  spread: f32,        // the spacing: the component homes move out with it
  alpha: f32,
  charge: f32,
  linkLength: f32,
  gravity: f32,
  dragPos: vec2f,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> posIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> posOut: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(4) var<storage, read> offsets: array<u32>;
@group(0) @binding(5) var<storage, read> targets: array<u32>;
@group(0) @binding(6) var<storage, read> anchors: array<vec2f>;

const TILE: u32 = 256u;
var<workgroup> tile: array<vec2f, TILE>;

fn jitter(i: u32) -> vec2f {
  let h = (i * 2654435761u) ^ (i >> 7u);
  let a = f32(h & 0xffffu) / 65535.0 * 6.2831853;
  return vec2f(cos(a), sin(a));
}

@compute @workgroup_size(256)
fn step(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  let count = params.n + 1u;
  let valid = i >= 1u && i < count;
  var p = vec2f(0.0);
  if (valid) { p = posIn[i]; }
  var f = vec2f(0.0);

  if (params.simulate != 0u) {
    // Repulsion: every vertex against every other, one tile at a time so
    // the workgroup reads each position from global memory once.
    for (var base = 0u; base < count; base += TILE) {
      let j = base + lid.x;
      var q = vec2f(1e30, 1e30);
      if (j >= 1u && j < count) { q = posIn[j]; }
      tile[lid.x] = q;
      workgroupBarrier();
      if (valid) {
        for (var k = 0u; k < TILE; k++) {
          let other = base + k;
          if (other == i) { continue; }
          var d = p - tile[k];
          var d2 = dot(d, d);
          if (d2 > 1e18) { continue; }
          if (d2 < 1.0) { d = jitter(i + other); d2 = 1.0; }
          f += d * (params.charge * params.alpha / d2);
        }
      }
      workgroupBarrier();
    }

    if (valid) {
      // Springs: rest length linkLength; the endpoint with the smaller
      // degree moves more (d3's link bias).
      let start = offsets[i];
      let end = offsets[i + 1u];
      let degI = f32(end - start);
      for (var e = start; e < end; e++) {
        let j = targets[e];
        var d = posIn[j] - p;
        var l = length(d);
        if (l < 1e-3) { d = jitter(i + j); l = 1.0; }
        let degJ = f32(offsets[j + 1u] - offsets[j]);
        let strength = 1.0 / min(degI, degJ);
        let bias = degJ / (degI + degJ);
        f += d * ((l - params.linkLength) / l * params.alpha * strength * bias);
      }
      // Gravity towards the component's home so components stay apart.
      f += (anchors[i] * params.spread - p) * (params.gravity * params.alpha);
    }
  }

  if (valid) {
    var v = (vel[i] + f) * 0.6;
    var np = p + v;
    if (i == params.dragIndex) { np = params.dragPos; v = vec2f(0.0); }
    vel[i] = v;
    posOut[i] = np;
  }
}
`;

/**
 * One step of a layout change: every vertex slides from where it was to
 * where the new layout puts it, `t` eased on the CPU. The dragged vertex,
 * if any, stays under the pointer.
 */
export const MORPH_SHADER = /* wgsl */ `
struct Morph {
  n: u32,
  dragIndex: u32,
  t: f32,
  pad: f32,
  dragPos: vec2f,
}
@group(0) @binding(0) var<uniform> morph: Morph;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read> dst: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> posOut: array<vec2f>;

@compute @workgroup_size(256)
fn step(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i == 0u || i > morph.n) { return; }
  var p = mix(src[i], dst[i], morph.t);
  if (i == morph.dragIndex) { p = morph.dragPos; }
  posOut[i] = p;
}
`;
