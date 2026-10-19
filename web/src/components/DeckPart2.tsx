'use client';

// Part 2's slides: weights as a column beside the graph, one Dijkstra over
// three frontiers, vector against heap on the course's weighted graphs, and
// the shortest paths the case study asks for. The words are the
// dictionary's; the numbers come from studies/weighted/results.json (synced
// as src/data/weighted.json), and until the study has run the two results
// slides say so instead of showing anything made up.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Fragment, type CSSProperties } from 'react';
import { siRust } from 'simple-icons';
import { formatBytes, formatCompact, formatMs, formatWeight } from '@/lib/format';
import { logScale } from '@/lib/scale';
import type { FrontierKind, FrontierStudy, PathAnswer, WeightedStudy } from '@/lib/studies';
import BrandIcon from './BrandIcon';
import { at, Bar, Head, type T } from './deck-kit';
import styles from './Deck.module.css';

/* ---- 01 weights: a column beside the graph ---------------------------------
   The handout's Figure 1 read left to right: the file with its third
   column, the normalising step, then the CSR arrays it becomes with the
   weights as one more array parallel to the targets. Under it, three notes:
   the graph trait never reads the column, the weighted trait does, and the
   negative edge of the figure is refused rather than answered. */

/** Figure 1 of the Part 2 handout: `u v weight`, five vertices. */
const FIGURE_1: readonly [number, number, string][] = [
  [1, 2, '0.1'],
  [2, 5, '0.2'],
  [5, 3, '5'],
  [3, 4, '-9.5'],
  [4, 5, '2.3'],
  [1, 5, '1'],
];
const FIGURE_1_N = 5;

/** The CSR the library builds from Figure 1: per vertex its neighbours
    ascending, each with the weight of the edge to it. */
function figureCsr() {
  const rows = Array.from({ length: FIGURE_1_N + 1 }, () => [] as [number, string][]);
  for (const [u, v, w] of FIGURE_1) {
    rows[u].push([v, w]);
    rows[v].push([u, w]);
  }
  const offsets = [0];
  const cells: { target: number; weight: string; vertex: number }[] = [];
  for (let v = 1; v <= FIGURE_1_N; v++) {
    rows[v].sort((a, b) => a[0] - b[0]);
    for (const [target, weight] of rows[v]) cells.push({ target, weight, vertex: v });
    offsets.push(cells.length);
  }
  return { offsets, cells };
}

const CSR = figureCsr();

export function Weights({ t }: { t: T }) {
  const s = t.presentation.slides.part2.weights;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.weightsMap}>
        {/* the handout's file, the weight column in blue */}
        <div className={`${styles.side} ${styles.pop}`} style={at(0.2)}>
          <p className="label">{s.input.label}</p>
          <div className={`mono ${styles.textFile}`}>
            <span className={styles.textFileName}>{s.input.name}</span>
            <span>{FIGURE_1_N}</span>
            {FIGURE_1.map(([u, v, w]) => (
              <span key={`${u}-${v}`} data-negative={w.startsWith('-') || undefined}>
                {u} {v} <b>{w}</b>
              </span>
            ))}
          </div>
          <p className="comment">{s.input.hint}</p>
        </div>

        <div className={styles.step}>
          <svg className={styles.edge} viewBox="0 0 48 12" aria-hidden="true" style={at(0.45)}>
            <circle className={styles.edgeTail} cx="4" cy="6" r="3" />
            <line className={styles.edgeLine} x1="4" y1="6" x2="38" y2="6" pathLength={1} />
            <path className={styles.edgeHead} d="M 37 1.5 L 46 6 L 37 10.5 z" />
          </svg>
          <span className={`mono ${styles.stepName} ${styles.pop}`} style={at(0.7)}>
            {s.normalise.name}
          </span>
          <span className={`comment ${styles.stepHint} ${styles.pop}`} style={at(0.8)}>
            {s.normalise.hint}
          </span>
        </div>

        {/* the arrays: offsets, targets, and the weights beside the targets */}
        <div className={`${styles.arrays} ${styles.pop}`} style={at(0.9)}>
          <p className={`label ${styles.arraysLabel}`}>
            <BrandIcon icon={siRust} size={16} className={styles.coreIcon} />
            {s.arrays.label}
          </p>
          <div className={styles.arrayRow}>
            <span className={`mono ${styles.arrayName}`}>{s.arrays.offsets}</span>
            <span className={styles.cells}>
              {CSR.offsets.map((offset, i) => (
                <span
                  key={i}
                  className={`mono ${styles.cell} ${styles.pop}`}
                  style={at(1.05 + i * 0.04)}
                >
                  {offset}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.arrayRow}>
            <span className={`mono ${styles.arrayName}`}>{s.arrays.targets}</span>
            <span className={styles.cells}>
              {CSR.cells.map((cell, i) => (
                <span
                  key={i}
                  className={`mono ${styles.cell} ${styles.pop}`}
                  data-row-start={CSR.offsets.includes(i) || undefined}
                  style={at(1.3 + i * 0.04)}
                >
                  {cell.target}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.arrayRow} data-weights="true">
            <span className={`mono ${styles.arrayName}`}>{s.arrays.weights}</span>
            <span className={styles.cells}>
              {CSR.cells.map((cell, i) => (
                <span
                  key={i}
                  className={`mono ${styles.cell} ${styles.weightCell} ${styles.pop}`}
                  data-row-start={CSR.offsets.includes(i) || undefined}
                  data-negative={cell.weight.startsWith('-') || undefined}
                  style={at(1.9 + i * 0.05)}
                >
                  {cell.weight}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>

      <ol className={styles.steps} data-count="3">
        {s.notes.map((note, i) => (
          <li
            key={note.title}
            className={`${styles.stepItem} ${styles.rise}`}
            style={at(2.6 + i * 0.12)}
          >
            <span className={`mono ${styles.stepIndex}`}>{String(i + 1).padStart(2, '0')}</span>
            <h3 className={styles.stepTitle}>{note.title}</h3>
            <span className={`comment ${styles.caption}`}>{note.caption}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---- 02 one Dijkstra, three frontiers --------------------------------------
   The trait and the driver as the library writes them, then the three ways
   of keeping the estimates, each a figure that runs when the slide arrives:
   the vector scanned end to end for its smallest estimate, the indexed heap
   where a lowered key sifts up, the lazy heap where a stale copy is skipped. */

const CODE = `pub trait Frontier {
    fn reset(&mut self, vertex_count: usize);
    fn decrease(&mut self, v: Vertex, distance: Weight);
    fn pop_min(&mut self) -> Option<(Vertex, Weight)>;
    …
}

pub fn dijkstra_into<G: Weighted, F: Frontier, V: Visitor>(
    graph: &G, root: Vertex, frontier: &mut F,
    tree: &mut ShortestPathTree, visitor: &mut V,
) -> Result<(), NegativeWeight>`;

/** The code with Rust's keywords and the trait's names picked out. */
function highlight(code: string) {
  return code
    .split(/(\b(?:pub|trait|fn|mut|self|Self)\b|\b(?:Frontier|Weighted|dijkstra_into)\b)/)
    .map((part, i) =>
      /^(pub|trait|fn|mut|self|Self)$/.test(part) ? (
        <span key={i} className={styles.kw}>
          {part}
        </span>
      ) : /^(Frontier|Weighted|dijkstra_into)$/.test(part) ? (
        <span key={i} className={styles.name}>
          {part}
        </span>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

/** The vector: nine estimates, a cursor scanning all of them, the smallest lit. */
function FigVector() {
  const estimates = ['∞', '4', '∞', '2.5', '7', '∞', '1.5', '∞', '3'];
  const smallest = 6;
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {estimates.map((value, i) => (
        <g key={i}>
          <rect
            x={3 + i * 18}
            y="34"
            width="16"
            height="22"
            rx="2"
            className={i === smallest ? styles.figMin : styles.figCell}
            style={i === smallest ? at(2.2) : undefined}
          />
          <text className={styles.figValue} x={11 + i * 18} y="49">
            {value}
          </text>
        </g>
      ))}
      <rect className={styles.figScan} style={at(0.2)} x="2" y="31" width="18" height="28" rx="3" />
      <text
        className={`${styles.figLabelCentre} ${styles.figFade}`}
        style={at(2.3)}
        x={11 + smallest * 18}
        y="72"
      >
        pop_min
      </text>
    </svg>
  );
}

/** The indexed heap: a key lowered at a leaf trades places with its parent
    and then the root, found through its position, not by a search. */
function FigHeap() {
  const nodes = [
    { x: 84, y: 16, value: '2' },
    { x: 46, y: 48, value: '3' },
    { x: 122, y: 48, value: '5' },
    { x: 26, y: 82, value: '4' },
    { x: 66, y: 82, value: '1' },
    { x: 104, y: 82, value: '6' },
    { x: 142, y: 82, value: '8' },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  // The lowered key (node 4) climbs to node 1, then to the root; the two it
  // passes step down into the places it left.
  const moves: Record<number, [number, number][]> = {
    4: [
      [nodes[1].x - nodes[4].x, nodes[1].y - nodes[4].y],
      [nodes[0].x - nodes[4].x, nodes[0].y - nodes[4].y],
    ],
    1: [
      [nodes[4].x - nodes[1].x, nodes[4].y - nodes[1].y],
      [nodes[4].x - nodes[1].x, nodes[4].y - nodes[1].y],
    ],
    0: [
      [0, 0],
      [nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y],
    ],
  };
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line
          key={`${a}-${b}`}
          className={styles.figEdge}
          style={at(0.1 + i * 0.06)}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          pathLength={1}
        />
      ))}
      {nodes.map((node, i) => {
        const move = moves[i];
        return (
          <g
            key={i}
            className={move ? styles.figSift : undefined}
            style={
              move
                ? ({
                    ...at(1.1),
                    '--x1': `${move[0][0]}px`,
                    '--y1': `${move[0][1]}px`,
                    '--x2': `${move[1][0]}px`,
                    '--y2': `${move[1][1]}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            <circle
              className={i === 4 ? styles.figKey : styles.figHeapNode}
              style={at(0.2 + i * 0.05)}
              cx={node.x}
              cy={node.y}
              r="9"
            />
            <text
              className={i === 4 ? styles.figKeyText : styles.figNodeText}
              x={node.x}
              y={node.y + 3.5}
            >
              {node.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The lazy heap as its array: vertex 3 was pushed twice, at 4 and later at
    2; when the old copy reaches the top it is stale, struck out and skipped. */
function FigLazy() {
  const entries = [
    { estimate: '1.5', vertex: 7 },
    { estimate: '2', vertex: 3 },
    { estimate: '3', vertex: 9 },
    { estimate: '4', vertex: 3, stale: true },
  ];
  return (
    <svg viewBox="0 0 168 96" className={styles.fig} aria-hidden="true">
      {entries.map((entry, i) => (
        <g key={i} className={styles.figFade} style={at(0.2 + i * 0.15)}>
          <rect
            x={4 + i * 40}
            y="28"
            width="36"
            height="34"
            rx="3"
            className={entry.stale ? styles.figCell : styles.figEntry}
          />
          <text className={styles.figValue} x={22 + i * 40} y="43">
            {entry.estimate}
          </text>
          <text className={styles.figLabelCentre} x={22 + i * 40} y="56">
            v{entry.vertex}
          </text>
        </g>
      ))}
      <g className={styles.figCross} style={at(1.4)}>
        <path d="M 128 30 L 160 60" pathLength={1} />
        <path d="M 160 30 L 128 60" pathLength={1} />
      </g>
    </svg>
  );
}

const FRONTIER_FIGURES = [FigVector, FigHeap, FigLazy];

export function Frontiers({ t }: { t: T }) {
  const s = t.presentation.slides.part2.frontiers;
  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.frontiers}>
        <div className={`${styles.codeCard} ${styles.rise}`} style={at(0.2)}>
          <pre className="mono">{highlight(CODE)}</pre>
          <p className="comment">{s.driver}</p>
        </div>
        <ol className={styles.steps} data-count="3">
          {s.items.map((item, i) => {
            const Figure = FRONTIER_FIGURES[i];
            return (
              <li
                key={item.name}
                className={`${styles.stepItem} ${styles.rise}`}
                style={at(0.4 + i * 0.12)}
              >
                <span className={styles.figWrap} style={at(0.8 + i * 0.5)}>
                  <Figure />
                </span>
                <span className={`mono ${styles.stepIndex}`}>{item.name}</span>
                <h3 className={styles.stepTitle}>{item.title}</h3>
                <span className={`mono ${styles.cost}`}>{item.cost}</span>
                <span className={`comment ${styles.caption}`}>{item.caption}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className={`comment ${styles.ties} ${styles.rise}`} style={at(2.4)}>
        {s.ties}
      </p>
    </div>
  );
}

/* ---- 03 vector against heap: one sheet ------------------------------------
   One row per weighted graph, a bar per frontier on one log scale shared by
   every row, and how many times slower the vector is than the heap. A
   frontier whose budget ran out before any run finished shows its estimate
   as a dashed bar. */

const FRONTIERS: FrontierKind[] = ['vector', 'heap', 'lazy_heap'];
const FRONTIER_COLOURS: Record<FrontierKind, string> = {
  vector: 'var(--accent-2)',
  heap: 'var(--accent)',
  lazy_heap: 'var(--level-0)',
};

/** A frontier's mean time, or its estimate when the budget cut every run. */
function frontierTime(study: WeightedStudy, kind: FrontierKind) {
  const run: FrontierStudy | undefined = study.frontiers.find((f) => f.frontier === kind);
  if (!run) return null;
  if (run.timing) return { ms: run.timing.mean_ms, estimated: false, run };
  if (run.partial) return { ms: run.partial.estimated_ms, estimated: true, run };
  return null;
}

/** `grafo_W_1` (or `grafo_1`) → `1`; any other name comes back whole. */
function weightedNumber(name: string): string {
  const match = /^grafo_(?:w_?)?(\d+)$/i.exec(name);
  return match ? match[1] : name;
}

function graphLabel(t: T, study: WeightedStudy) {
  return study.names_file
    ? t.presentation.slides.part2.paths.network.label
    : t.studies.graph(weightedNumber(study.name));
}

export function Timing({ t, studies }: { t: T; studies: WeightedStudy[] }) {
  const s = t.presentation.slides.part2.timing;
  const c = s.columns;
  const times = studies.flatMap((study) =>
    FRONTIERS.map((kind) => frontierTime(study, kind)?.ms ?? 0),
  );
  const scale = logScale(0.1, Math.max(1, ...times));
  const machine = studies.find((study) => study.machine)?.machine;

  return (
    <div className={styles.body}>
      <div className={styles.benchHead}>
        <Head eyebrow={s.eyebrow} title={s.title} />
        <ul className={`${styles.legend} ${styles.rise}`} style={at(0.2)}>
          {s.legend.map((l) => (
            <li key={l.key} className={styles.legendItem}>
              <span className={styles.swatch} data-key={l.key} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.sheet}>
        <div
          className={`label ${styles.sheetHead} ${styles.timingRow} ${styles.rise}`}
          style={at(0.2)}
        >
          <span>{c.graph}</span>
          <span>{c.size}</span>
          <span>{c.time}</span>
          <span className={styles.centre}>{c.ratio}</span>
        </div>
        {studies.length === 0 ? (
          <p className={`comment ${styles.pending} ${styles.rise}`} style={at(0.4)}>
            {s.pending}
          </p>
        ) : (
          studies.map((study, i) => {
            const d = 0.3 + i * 0.1;
            const vector = frontierTime(study, 'vector');
            const heap = frontierTime(study, 'heap');
            return (
              <div
                key={study.name}
                className={`${styles.row} ${styles.timingRow} ${styles.rise}`}
                style={at(d)}
              >
                <span className={styles.rowName}>{graphLabel(t, study)}</span>
                <span className={styles.size}>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.vertices)} <i>{t.studies.facts.vertices}</i>
                  </span>
                  <span className={`mono ${styles.sizeValue}`}>
                    {formatCompact(study.edges)} <i>{t.studies.facts.edges}</i>
                  </span>
                </span>
                <span className={styles.group} data-wide="true">
                  {FRONTIERS.map((kind, k) => {
                    const time = frontierTime(study, kind);
                    const colour = FRONTIER_COLOURS[kind];
                    const delay = d + 0.2 + k * 0.08;
                    if (!time)
                      return <Bar key={kind} width={0} colour={colour} value="·" delay={delay} />;
                    const runs = time.run.timing?.runs ?? 0;
                    const short = !time.estimated && runs < time.run.requested_runs;
                    return (
                      <Bar
                        key={kind}
                        width={scale(time.ms)}
                        colour={colour}
                        ghost={time.estimated}
                        value={
                          time.estimated
                            ? s.estimated(formatMs(time.ms))
                            : short
                              ? `${formatMs(time.ms)} · ${runs}/${time.run.requested_runs}`
                              : formatMs(time.ms)
                        }
                        delay={delay}
                      />
                    );
                  })}
                </span>
                <span
                  className={`mono ${styles.answer} ${styles.centre} ${styles.figFade}`}
                  style={at(d + 0.8)}
                >
                  {vector && heap && heap.ms > 0
                    ? `×${formatCompact(Math.round(vector.ms / heap.ms))}`
                    : '·'}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className={`${styles.benchFoot} ${styles.rise}`} style={at(1.3)}>
        <p className={styles.note}>
          {machine && s.machine(machine.cpu, formatBytes(machine.total_memory_bytes))}
        </p>
        <Link href="/studies" className={`label ${styles.more}`}>
          {s.cta}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ---- 04 shortest paths -----------------------------------------------------
   The case study's two path questions side by side: from vertex 10 to 20,
   30, 40, 50 and 60 on every weighted graph, as a grid of distances with
   the edge count under each; and from Edsger W. Dijkstra to the five
   researchers on the collaboration network, each path spelled by name. */

/** A path's names, the middle elided past six. */
function pathNames(answer: PathAnswer): string[] {
  const all = answer.names ?? answer.path.map(String);
  if (all.length <= 6) return all;
  return [...all.slice(0, 3), '…', ...all.slice(-2)];
}

export function Paths({ t, studies }: { t: T; studies: WeightedStudy[] }) {
  const s = t.presentation.slides.part2.paths;
  const graphs = studies.filter((study) => !study.names_file);
  const network = studies.find((study) => study.names_file);
  const targets = [...new Set(graphs.flatMap((study) => study.paths.map((p) => p.to)))].sort(
    (a, b) => a - b,
  );

  return (
    <div className={styles.body}>
      <Head eyebrow={s.eyebrow} title={s.title} />
      <div className={styles.pathsGrid}>
        <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.2)}>
          <p className="label">{s.graphs.label}</p>
          <p className="comment">{s.graphs.caption}</p>
          {graphs.length === 0 ? (
            <p className={`comment ${styles.pending}`}>{s.pending}</p>
          ) : (
            <div
              className={styles.distanceGrid}
              style={{ '--targets': targets.length } as CSSProperties}
            >
              <span />
              {targets.map((to) => (
                <span key={to} className={`mono ${styles.distanceHead}`}>
                  {to}
                </span>
              ))}
              {graphs.map((study, i) => (
                <Fragment key={study.name}>
                  <span className={styles.rowName}>{graphLabel(t, study)}</span>
                  {targets.map((to, k) => {
                    const answer = study.paths.find((p) => p.to === to);
                    const reached = answer && answer.distance !== null;
                    return (
                      <span
                        key={to}
                        className={`${styles.distanceCell} ${styles.figFade}`}
                        style={at(0.5 + i * 0.1 + k * 0.04)}
                      >
                        <span className={`mono ${styles.distanceValue}`}>
                          {reached ? formatWeight(answer.distance as number) : '∞'}
                        </span>
                        <span className={styles.distanceHops}>
                          {reached ? s.hops(answer.path.length - 1) : s.unreached}
                        </span>
                      </span>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          )}
        </section>

        <section className={`${styles.pathsPanel} ${styles.rise}`} style={at(0.35)}>
          <p className="label">{s.network.label}</p>
          <p className="comment">{s.network.caption}</p>
          {!network ? (
            <p className={`comment ${styles.pending}`}>{s.pending}</p>
          ) : (
            <ol className={styles.namedPaths}>
              {network.paths.map((answer, i) => (
                <li
                  key={answer.to}
                  className={`${styles.namedPath} ${styles.figFade}`}
                  style={at(0.6 + i * 0.12)}
                >
                  <span className={styles.namedTo}>{answer.to_name ?? answer.to}</span>
                  <span className={`mono ${styles.distanceValue}`}>
                    {answer.distance === null ? '∞' : formatWeight(answer.distance)}
                  </span>
                  <span className={styles.namedRoute}>
                    {answer.distance === null ? s.unreached : pathNames(answer).join(' → ')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
