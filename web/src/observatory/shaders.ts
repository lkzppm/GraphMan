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
  base: vec4f,        // node colour without a search
  dim: vec4f,         // node not (yet) reached
  colorA: vec4f,      // level 0
  colorB: vec4f,      // deepest level
  ring: vec4f,        // hover / selection ring
  edge: vec4f,
  edgeDim: vec4f,
  edgeTree: vec4f,
  colorTarget: vec4f, // the destination of a distance query
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

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) flags: u32,
  @location(3) @interpolate(flat) rpx: f32,
  @location(4) @interpolate(flat) pop: f32,
}

fn nodeColor(v: u32) -> vec4f {
  if (view.component != 0u && labels[v] != view.component) { return view.dim; }
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
  if (ii >= sampled && ii < sampled + degree) { v = targets[offsets[view.selected] + ii - sampled]; }
  if (ii == sampled + degree) { v = view.hovered; }
  if (ii == sampled + degree + 1u) { v = view.selected; }
  if (ii >= sampled + degree + 2u) {
    let j = ii - sampled - degree - 2u;
    if (j >= view.pathLength) { v = 0u; } else { v = path[j]; onPath = true; }
    along = f32(j) / max(f32(view.pathLength - 1u), 1.0);
    // The path shows as the wave reaches it; until then the sampled twin stands.
    if (onPath && f32(ranks[v]) > view.reveal) { v = 0u; }
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
  // In a distance query everything off the path shrinks out of the way.
  if (view.dest != 0u && !onPath && flags == 0u) { r = max(r * 0.35, 1.0); }
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
  // Drawn from a towards b during the rank before b is discovered.
  let drawn = clamp(view.reveal - (f32(ranks[b]) - 1.0), 0.0, 1.0);
  pb = mix(pa, pb, drawn);
  let d = pb - pa;
  let len = max(length(d), 1e-3);
  let n = vec2f(-d.y, d.x) / len * clamp(view.radius * 0.45, 1.5, 4.0);
  var corners = array<vec2f, 6>(
    pa - n, pb - n, pa + n,
    pa + n, pb - n, pb + n);
  out.pos = toClip(corners[vi]);
  let t = (f32(ii) + 0.5) / max(f32(view.pathLength - 1u), 1.0);
  out.color = vec4f(mix(view.colorA.rgb, view.colorTarget.rgb, t), 0.95 * step(0.001, drawn));
  return out;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4f {
  return vec4f(in.color.rgb * in.color.a, in.color.a);
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
// The edges at the selected vertex as [a, b] pairs (view.incident of them).
@group(0) @binding(8) var<storage, read> extras: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
}

fn cull() -> VOut {
  var out: VOut;
  out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  out.color = vec4f(0.0);
  return out;
}

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  let stride = select(view.stride, view.treeStride, kind.tree != 0u);
  let count = arrayLength(&edges) / 2u;
  let sampled = (count + stride - 1u) / stride;
  let segment = vi / 2u;
  var a = 0u;
  var b = 0u;
  // The edges at the selected vertex are the extras draw's segments (the
  // CPU fills the extras buffer), so no stride can drop one and they sit
  // on top; the samples skip them.
  let incident = kind.tree == 2u;
  if (incident) {
    if (segment >= view.incident) { return cull(); }
    a = extras[2u * segment];
    b = extras[2u * segment + 1u];
  } else {
    let e = segment * stride;
    if (e >= count) { return cull(); }
    a = edges[2u * e];
    b = edges[2u * e + 1u];
    if (view.selected != 0u && (a == view.selected || b == view.selected)) { return cull(); }
  }
  let v = select(a, b, (vi & 1u) == 1u);
  var out: VOut;
  var world = positions[v];
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
      if (v == child) { world = mix(positions[parent], positions[child], drawn); }
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
  if (view.mute != 0u && view.dest != 0u && !incident) { color = view.edgeDim; }
  if (incident) {
    out.pos = toClip((world - view.offset) * view.scale);
    out.color = vec4f(view.colorA.rgb, 0.85 * step(0.001, drawn));
    return out;
  }
  if (tree != (kind.tree != 0u)) {
    // The other draw's kind of edge.
    return cull();
  }
  let full = color.a;
  color.a = color.a * select(view.edgeFade, view.treeFade, tree);
  // A sample of the edges, each stronger so the density reads the same,
  // but never stronger than an unfaded edge (at a zoom where single edges
  // are visible the sample is simply thinner).
  color.a = min(color.a * f32(stride), full);
  out.pos = toClip((world - view.offset) * view.scale);
  out.color = color;
  return out;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4f {
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
  pad: u32,
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
      f += (anchors[i] - p) * (params.gravity * params.alpha);
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
