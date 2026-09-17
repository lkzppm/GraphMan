// A WebGL2 renderer for search-tree layouts: every vertex is a point placed
// in polar coordinates (angle from the layout, radius from its level) and
// every tree edge is a line. BFS and DFS layouts share one vertex buffer, so
// switching between them is a morph computed in the vertex shader, and the
// traversal "wave" is a single uniform (the frontier level).

import type { TreeLayout } from './gmo';
import { UNREACHED } from './gmo';

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_bfs;   // angle, level (-1 = unreached)
in vec2 a_dfs;
uniform float u_morph;
uniform vec2 u_maxLevel;   // bfs, dfs
uniform vec2 u_curve;      // radius exponent per tree
uniform vec2 u_frontier;   // bfs, dfs
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform float u_pointSize;
out float v_age;
out float v_unreached;

vec2 polar(vec2 al, float maxLevel, float curve) {
  float unreached = step(al.y, -0.5);
  float t = clamp(al.y / max(maxLevel, 1.0), 0.0, 1.0);
  float r = mix(pow(t, curve) * 0.9, 1.04, unreached);
  return vec2(cos(al.x), sin(al.x)) * r;
}

void main() {
  vec2 pa = polar(a_bfs, u_maxLevel.x, u_curve.x);
  vec2 pb = polar(a_dfs, u_maxLevel.y, u_curve.y);
  vec2 p = mix(pa, pb, u_morph);
  gl_Position = vec4((p + u_offset) * u_scale, 0.0, 1.0);
  float level = mix(a_bfs.y, a_dfs.y, u_morph);
  float frontier = mix(u_frontier.x, u_frontier.y, u_morph);
  v_unreached = max(step(a_bfs.y, -0.5), step(a_dfs.y, -0.5));
  v_age = frontier - level;
  float head = exp(-max(v_age, 0.0) * 0.8);
  gl_PointSize = u_pointSize * (1.0 + 1.2 * head * step(0.0, v_age));
}
`;

const POINT_FRAGMENT = `#version 300 es
precision highp float;
in float v_age;
in float v_unreached;
uniform float u_alpha;
out vec4 fragColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float disc = smoothstep(0.5, 0.32, d);
  if (disc <= 0.001) discard;
  vec3 dim = vec3(0.24, 0.24, 0.26);
  vec3 sky = vec3(0.161, 0.592, 1.0);      // #2997ff
  vec3 deep = vec3(0.05, 0.28, 0.62);
  vec3 head = vec3(0.92, 0.97, 1.0);
  float lit = step(0.0, v_age);
  float fresh = exp(-max(v_age, 0.0) * 0.55);
  float old = 1.0 - exp(-max(v_age, 0.0) * 0.07);
  vec3 litColor = mix(mix(sky, head, fresh), deep, old * 0.7);
  vec3 color = mix(dim, litColor, lit);
  color = mix(color, vec3(0.18, 0.18, 0.2), v_unreached);
  float alpha = mix(0.55, 0.95, lit) * disc * u_alpha;
  alpha = mix(alpha, 0.35 * disc * u_alpha, v_unreached);
  fragColor = vec4(color * alpha, alpha);
}
`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_age;
in float v_unreached;
uniform float u_alpha;
out vec4 fragColor;

void main() {
  float lit = smoothstep(-0.5, 0.5, v_age);
  float fresh = exp(-max(v_age, 0.0) * 0.5);
  vec3 color = mix(vec3(0.161, 0.592, 1.0), vec3(0.8, 0.9, 1.0), fresh);
  float alpha = lit * (0.12 + 0.35 * fresh) * u_alpha * (1.0 - v_unreached);
  fragColor = vec4(color * alpha, alpha);
}
`;

export interface ViewState {
  /** 0 = BFS layout, 1 = DFS layout. */
  morph: number;
  /** Frontier level per tree; vertices at or below it are lit. */
  frontierBfs: number;
  frontierDfs: number;
  zoom: number;
  panX: number;
  panY: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader failed to compile: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('could not create program');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, 'a_bfs');
  gl.bindAttribLocation(program, 1, 'a_dfs');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

interface Uniforms {
  morph: WebGLUniformLocation | null;
  maxLevel: WebGLUniformLocation | null;
  curve: WebGLUniformLocation | null;
  frontier: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  offset: WebGLUniformLocation | null;
  pointSize: WebGLUniformLocation | null;
  alpha: WebGLUniformLocation | null;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Uniforms {
  return {
    morph: gl.getUniformLocation(program, 'u_morph'),
    maxLevel: gl.getUniformLocation(program, 'u_maxLevel'),
    curve: gl.getUniformLocation(program, 'u_curve'),
    frontier: gl.getUniformLocation(program, 'u_frontier'),
    scale: gl.getUniformLocation(program, 'u_scale'),
    offset: gl.getUniformLocation(program, 'u_offset'),
    pointSize: gl.getUniformLocation(program, 'u_pointSize'),
    alpha: gl.getUniformLocation(program, 'u_alpha'),
  };
}

/** Radius exponent that keeps deep trees readable: linear for shallow BFS, compressed for deep DFS. */
export function curveFor(maxLevel: number): number {
  if (maxLevel <= 12) return 1.0;
  if (maxLevel <= 64) return 0.8;
  return 0.45;
}

export class ObservatoryRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly points: WebGLProgram;
  private readonly lines: WebGLProgram;
  private readonly pointUniforms: Uniforms;
  private readonly lineUniforms: Uniforms;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly bfsIndex: WebGLBuffer;
  private readonly dfsIndex: WebGLBuffer;
  private vertexCount = 0;
  private bfsEdges = 0;
  private dfsEdges = 0;
  private maxLevel: [number, number] = [1, 1];
  private curve: [number, number] = [1, 1];
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.points = link(gl, VERTEX_SHADER, POINT_FRAGMENT);
    this.lines = link(gl, VERTEX_SHADER, LINE_FRAGMENT);
    this.pointUniforms = uniforms(gl, this.points);
    this.lineUniforms = uniforms(gl, this.lines);
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const bfsIndex = gl.createBuffer();
    const dfsIndex = gl.createBuffer();
    if (!vao || !vertexBuffer || !bfsIndex || !dfsIndex)
      throw new Error('could not allocate GPU buffers');
    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    this.bfsIndex = bfsIndex;
    this.dfsIndex = dfsIndex;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  /** Uploads both layouts of one graph. */
  setTrees(bfs: TreeLayout, dfs: TreeLayout): void {
    const { gl } = this;
    const n = bfs.vertexCount;
    if (dfs.vertexCount !== n) throw new Error('BFS and DFS layouts describe different graphs');
    this.vertexCount = n;
    this.maxLevel = [Math.max(bfs.maxLevel, 1), Math.max(dfs.maxLevel, 1)];
    this.curve = [curveFor(bfs.maxLevel), curveFor(dfs.maxLevel)];

    const interleaved = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const lb = bfs.level[i]!;
      const ld = dfs.level[i]!;
      interleaved[i * 4] = bfs.angle[i]!;
      interleaved[i * 4 + 1] = lb === UNREACHED ? -1 : lb;
      interleaved[i * 4 + 2] = dfs.angle[i]!;
      interleaved[i * 4 + 3] = ld === UNREACHED ? -1 : ld;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);

    this.bfsEdges = this.uploadEdges(this.bfsIndex, bfs);
    this.dfsEdges = this.uploadEdges(this.dfsIndex, dfs);
  }

  private uploadEdges(buffer: WebGLBuffer, tree: TreeLayout): number {
    const { gl } = this;
    const n = tree.vertexCount;
    const indices = new Uint32Array((tree.reached - 1) * 2);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = tree.parent[i]!;
      if (p !== 0) {
        indices[k++] = i;
        indices[k++] = p - 1;
      }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.subarray(0, k), gl.STATIC_DRAW);
    return k;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
  }

  render(state: ViewState): void {
    const { gl } = this;
    if (this.vertexCount === 0) return;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = this.width / this.height;
    const fit = 0.92 * state.zoom;
    const scale: [number, number] = aspect >= 1 ? [fit / aspect, fit] : [fit, fit * aspect];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const density = Math.sqrt(150_000 / Math.max(this.vertexCount, 1));
    // DFS spirals pack vertices densely along the path, so shrink points there.
    const pointSize =
      Math.min(7, Math.max(1.4, 2.6 * density)) *
      dpr *
      Math.pow(state.zoom, 0.35) *
      (1 - 0.4 * state.morph);

    const apply = (u: Uniforms, alpha: number) => {
      gl.uniform1f(u.morph, state.morph);
      gl.uniform2f(u.maxLevel, this.maxLevel[0], this.maxLevel[1]);
      gl.uniform2f(u.curve, this.curve[0], this.curve[1]);
      gl.uniform2f(u.frontier, state.frontierBfs, state.frontierDfs);
      gl.uniform2f(u.scale, scale[0], scale[1]);
      gl.uniform2f(u.offset, state.panX, state.panY);
      gl.uniform1f(u.pointSize, pointSize);
      gl.uniform1f(u.alpha, alpha);
    };

    gl.bindVertexArray(this.vao);

    // Tree edges: crossfade between the two trees while morphing.
    gl.useProgram(this.lines);
    const lineAlpha = Math.min(1, 1.6 * density);
    if (state.morph < 0.999 && this.bfsEdges > 0) {
      apply(this.lineUniforms, lineAlpha * (1 - state.morph));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bfsIndex);
      gl.drawElements(gl.LINES, this.bfsEdges, gl.UNSIGNED_INT, 0);
    }
    if (state.morph > 0.001 && this.dfsEdges > 0) {
      apply(this.lineUniforms, lineAlpha * state.morph);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dfsIndex);
      gl.drawElements(gl.LINES, this.dfsEdges, gl.UNSIGNED_INT, 0);
    }

    gl.useProgram(this.points);
    apply(this.pointUniforms, 1);
    gl.drawArrays(gl.POINTS, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.bfsIndex);
    gl.deleteBuffer(this.dfsIndex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.points);
    gl.deleteProgram(this.lines);
  }
}
