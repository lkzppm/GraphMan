'use client';

import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/i18n/LocaleProvider';
import {
  SAMPLE_EDGES,
  SAMPLE_POSITIONS,
  SAMPLE_TEXT,
  SAMPLE_WEIGHTED_TEXT,
  SAMPLE_WEIGHTS,
  DIRECTED_ARCS,
  DIRECTED_WEIGHTS,
  NEGATIVE_CYCLE,
  NEGATIVE_CYCLE_WEIGHTS,
  TWO_COMPONENT_EDGES,
  TWO_COMPONENT_POSITIONS,
  UNREACHED,
  bellmanFord,
  bfs,
  components,
  dfs,
  dijkstra,
  floydWarshall,
  pathTo,
  shortestPath,
  strongComponents,
} from '@/lib/sample';
import Code from './Code';
import Rail from './Rail';
import GraphFigure, { levelColour, levelInk } from './GraphFigure';
import Representations from './Representations';
import Reveal from './Reveal';
import styles from './Wiki.module.css';

/* The library page: a manual on the sample graph. The chapters' words come
   from the dictionary, their Rust examples from crates/graphman/tests/wiki.rs
   (proved by `cargo test`, copied in by scripts/sync-data.mjs), and every
   drawing shows what its example computes, worked out on the same sample
   (lib/sample.ts mirrors the library's search order). */

const REPO = 'https://github.com/lkzppm/GraphMan/blob/main/crates/graphman';

type ChapterId =
  | 'start'
  | 'format'
  | 'representations'
  | 'direction'
  | 'weights'
  | 'visitors'
  | 'names'
  | 'subgraphs'
  | 'cli'
  | 'traversals'
  | 'distance'
  | 'diameter'
  | 'dijkstra'
  | 'frontiers'
  | 'bellman_ford'
  | 'schedules'
  | 'floyd_warshall'
  | 'johnson'
  | 'strong_components';

/** The page's two parts: how the library is built, then its algorithms. */
type PartId = 'library' | 'algorithms';

/** Every chapter, the part it belongs to and the source file it documents. */
const CHAPTERS: { id: ChapterId; part: PartId; source: string }[] = [
  { id: 'start', part: 'library', source: 'src/lib.rs' },
  { id: 'format', part: 'library', source: 'src/io/edge_list.rs' },
  { id: 'representations', part: 'library', source: 'src/graph/mod.rs' },
  { id: 'direction', part: 'library', source: 'src/graph/mod.rs' },
  { id: 'weights', part: 'library', source: 'src/graph/mod.rs' },
  { id: 'visitors', part: 'library', source: 'src/algo/traversal.rs' },
  { id: 'names', part: 'library', source: 'src/io/names.rs' },
  { id: 'subgraphs', part: 'library', source: 'src/algo/subgraph.rs' },
  { id: 'cli', part: 'library', source: '../graphman-cli/src/main.rs' },
  { id: 'traversals', part: 'algorithms', source: 'src/algo/traversal.rs' },
  { id: 'distance', part: 'algorithms', source: 'src/algo/distance.rs' },
  { id: 'diameter', part: 'algorithms', source: 'src/algo/diameter.rs' },
  { id: 'dijkstra', part: 'algorithms', source: 'src/algo/shortest_path.rs' },
  { id: 'frontiers', part: 'algorithms', source: 'src/algo/frontier.rs' },
  { id: 'bellman_ford', part: 'algorithms', source: 'src/algo/bellman_ford.rs' },
  { id: 'schedules', part: 'algorithms', source: 'src/algo/schedule.rs' },
  { id: 'floyd_warshall', part: 'algorithms', source: 'src/algo/floyd_warshall.rs' },
  { id: 'johnson', part: 'algorithms', source: 'src/algo/johnson.rs' },
  { id: 'strong_components', part: 'algorithms', source: 'src/algo/scc.rs' },
];

/** The rail's stops: the chapters, in order. */
const STOPS: ChapterId[] = CHAPTERS.map((c) => c.id);

const CARGO = `[dependencies]
graphman = { git = "https://github.com/lkzppm/GraphMan" }`;

/** The commands shown in the CLI chapter; their descriptions live in the dictionary. */
const COMMANDS = [
  'graphman info graphs/grafo_1.txt',
  'graphman bfs graphs/grafo_1.txt --from 1 --repr csr',
  'graphman distance graphs/grafo_1.txt --pair 10 20 --pair 10 30',
  'graphman diameter graphs/grafo_1.txt --method bounds --budget 60',
  'graphman dijkstra samples/weighted_100.txt --from 10 --to 20 30 --frontier heap',
  'graphman bellman-ford graphs/grafo_W_1.txt -D --to 100 --from 10 20 30 --schedule queue',
  'graphman floyd-warshall graphs/grafo_W_1.txt -D --pairs 10 20 30 40 50 --sweep blocked',
  'graphman scc graphs/grafo_W_1.txt -D',
  'graphman study graphs/grafo_1.txt --out studies',
];

/** The format example's input, as written in the Rust block. */
const FORMAT_INPUT = ['2 1', '1 2', '3 3', '1 3', '2 3', '2 4', '3 5', '4 5'];

// What the examples compute, on the sample.
const N = SAMPLE_POSITIONS.length - 1;
const BFS = bfs(N, SAMPLE_EDGES, 1);
const DFS = dfs(N, SAMPLE_EDGES, 1);
const TWO_N = TWO_COMPONENT_POSITIONS.length - 1;
const LABELS = components(TWO_N, TWO_COMPONENT_EDGES);
const PATH_4_3 = shortestPath(TWO_N, TWO_COMPONENT_EDGES, 4, 3);
const DIAMETER_ENDS: [number, number] = [1, 5];
const DIAMETER_PATH = shortestPath(N, SAMPLE_EDGES, ...DIAMETER_ENDS);
const UNTIL_4 = BFS.order.slice(0, BFS.order.indexOf(4) + 1);
/** The tree as it stands when Until(4) breaks: only what was discovered. */
const AT_BREAK = {
  levels: BFS.levels.map((l, v) => (UNTIL_4.includes(v) ? l : UNREACHED)),
  parents: BFS.parents.map((p, v) => (UNTIL_4.includes(v) ? p : 0)),
};
/** What `graphman bfs` writes for the sample from 1 (SearchTree::write_to). */
const BFS_FILE = [
  '# root 1',
  '# vertex parent level',
  ...Array.from({ length: N }, (_, i) => `${i + 1} ${BFS.parents[i + 1]} ${BFS.levels[i + 1]}`),
];
const FLOW_FILES = ['grafo.txt', 'grafo.bfs-1.txt'];

// The weighted chapters: Dijkstra from 1 on the weighted sample, against
// the BFS, whose path to 5 has fewer edges and more weight.
const DIJKSTRA = dijkstra(N, SAMPLE_EDGES, SAMPLE_WEIGHTS, 1);
const DIJKSTRA_PATH_5 = pathTo(DIJKSTRA.parents, 1, 5);
const BFS_PATH_5 = shortestPath(N, SAMPLE_EDGES, 1, 5);
/** The farthest vertex: the last one settled (ShortestPathTree::last_settled). */
const FARTHEST = DIJKSTRA.order[DIJKSTRA.order.length - 1];

/** The names example's file and what VertexNames answers on it, as in the
    Rust block (and its asserts, which cargo test runs). */
const NAMES_FILE = ['1,Edsger W. Dijkstra', '2,Alan M. Turing', '3,Éva Tardos'];
const NAME_LOOKUPS: [string, string][] = [
  ['vertex("Edsger W. Dijkstra")', 'Some(1)'],
  ['name(3)', 'Some("Éva Tardos")'],
  ['search("eva tardos", 5)', '[3]'],
  ['vertex("Eva Tardos")', 'None'],
];
const FLOW_COMMAND = 'graphman bfs grafo.txt --from 1';

/** A cut of the sample, as the subgraphs chapter draws it: the vertices kept
    shaded by their level from 1 and the edges among them in blue, the rest
    dim. */
function cutOfSample(kept: number[]) {
  return {
    levels: BFS.levels.map((level, v) => (kept.includes(v) ? level : UNREACHED)),
    kept: SAMPLE_EDGES.filter(([u, v]) => kept.includes(u) && kept.includes(v)),
  };
}
/** What the subgraphs example keeps: the BFS stopped at two vertices, and
    the egonet of radius 1. */
const CUT_BY_SIZE = cutOfSample([1, 2]);
const CUT_EGONET = cutOfSample([1, 2, 3]);

// Part 3, on the directed sample (tests/wiki.rs runs the same graph).
const BELLMAN = bellmanFord(N, DIRECTED_ARCS, DIRECTED_WEIGHTS, 1);
const FLOYD = floydWarshall(N, DIRECTED_ARCS, DIRECTED_WEIGHTS);
/** Johnson's potentials: h(v) = min over u of d(u, v), at most 0 (d(v, v)). */
const POTENTIAL = Array.from({ length: N + 1 }, (_, v) =>
  v === 0 ? 0 : Math.min(...FLOYD.slice(1).map((row) => row[v])),
);
const REWEIGHTED = DIRECTED_ARCS.map(
  ([u, v], i) => DIRECTED_WEIGHTS[i] + POTENTIAL[u] - POTENTIAL[v],
);
const STRONG = strongComponents(N, DIRECTED_ARCS);
/** A distance or a table cell as the page writes it. */
const show = (d: number) => (d === Infinity ? '∞' : String(d));
const FLOYD_ROWS: string[][] = [
  ['', ...Array.from({ length: N }, (_, j) => String(j + 1))],
  ...FLOYD.slice(1).map((row, i) => [String(i + 1), ...row.slice(1).map(show)]),
];

export default function Wiki({ examples }: { examples: Record<string, string> }) {
  const t = useT();
  const l = t.library;
  const [active, setActive] = useState<ChapterId>(STOPS[0]);

  // The rail follows the reader: the current stop is the last one whose top
  // has passed the upper third of the viewport.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.34;
      let current = STOPS[0];
      for (const id of STOPS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const code = (id: string) => (
    <Code code={examples[id] ?? ''} copyLabel={l.copy} copiedLabel={l.copied} />
  );
  const chapter = (id: ChapterId) => CHAPTERS.find((c) => c.id === id)!;

  return (
    <section className={`section ${styles.section}`}>
      <Rail
        label={l.contents}
        stops={STOPS.map((id) => ({ id, title: l.chapters[id].title, href: `#${id}` }))}
        active={active}
      />

      <div className={`container ${styles.layout}`}>
        <div className={styles.content}>
          <Part id="library" />

          <Chapter meta={chapter('start')}>
            <Code code={CARGO} lang="toml" copyLabel={l.copy} copiedLabel={l.copied} />
            {code('start')}
            <TextToGraph />
          </Chapter>

          <Chapter meta={chapter('format')}>
            {code('format')}
            <Normalisation lines={FORMAT_INPUT} />
          </Chapter>

          <Chapter meta={chapter('representations')}>
            <Representations />
            <Table rows={l.chapters.representations.table} />
            {code('representations')}
            <p className={styles.para}>{l.chapters.representations.dispatch}</p>
            {code('dispatch')}
          </Chapter>

          <Chapter meta={chapter('direction')}>
            {code('direction')}
            <Figure legend={l.chapters.direction.legend}>
              <GraphFigure
                edges={DIRECTED_ARCS}
                positions={SAMPLE_POSITIONS}
                weights={DIRECTED_WEIGHTS}
                directed
              />
            </Figure>
          </Chapter>

          <Chapter meta={chapter('weights')}>
            {code('weights')}
            <WeightedTextToGraph />
          </Chapter>

          <Chapter meta={chapter('visitors')}>
            {code('visitors')}
            <Sequence order={UNTIL_4} />
          </Chapter>

          <Chapter meta={chapter('names')}>
            {code('names')}
            <Names />
          </Chapter>

          <Chapter meta={chapter('subgraphs')}>
            {code('subgraphs')}
            <div className={styles.split}>
              <Figure legend={l.chapters.subgraphs.size}>
                <GraphFigure
                  edges={SAMPLE_EDGES}
                  positions={SAMPLE_POSITIONS}
                  levels={CUT_BY_SIZE.levels}
                  kept={CUT_BY_SIZE.kept}
                  marks={[1]}
                />
              </Figure>
              <Figure legend={l.chapters.subgraphs.egonet}>
                <GraphFigure
                  edges={SAMPLE_EDGES}
                  positions={SAMPLE_POSITIONS}
                  levels={CUT_EGONET.levels}
                  kept={CUT_EGONET.kept}
                  marks={[1]}
                />
              </Figure>
            </div>
          </Chapter>

          <Chapter meta={chapter('cli')}>
            <Flow steps={l.chapters.cli.flow} />
            <ol className={styles.commands}>
              {COMMANDS.map((command, i) => (
                <li key={command}>
                  <Code code={command} lang="shell" copyLabel={l.copy} copiedLabel={l.copied} />
                  <span className={styles.commandNote}>{l.chapters.cli.commands[i]}</span>
                </li>
              ))}
            </ol>
          </Chapter>

          <Part id="algorithms" />

          <Chapter meta={chapter('traversals')}>
            {code('traversals')}
            <div className={styles.split}>
              <Figure legend={l.chapters.traversals.bfs}>
                <GraphFigure
                  edges={SAMPLE_EDGES}
                  positions={SAMPLE_POSITIONS}
                  levels={BFS.levels}
                  parents={BFS.parents}
                />
              </Figure>
              <Figure legend={l.chapters.traversals.dfs}>
                <GraphFigure
                  edges={SAMPLE_EDGES}
                  positions={SAMPLE_POSITIONS}
                  levels={DFS.levels}
                  parents={DFS.parents}
                />
              </Figure>
            </div>
          </Chapter>

          <Chapter meta={chapter('distance')}>
            {code('distance')}
            <Figure legend={l.chapters.distance.legend}>
              <GraphFigure
                edges={TWO_COMPONENT_EDGES}
                positions={TWO_COMPONENT_POSITIONS}
                components={LABELS}
                path={PATH_4_3}
                marks={[4, 3]}
              />
            </Figure>
          </Chapter>

          <Chapter meta={chapter('diameter')}>
            {code('diameter')}
            <Figure legend={l.chapters.diameter.legend}>
              <GraphFigure
                edges={SAMPLE_EDGES}
                positions={SAMPLE_POSITIONS}
                path={DIAMETER_PATH}
                marks={DIAMETER_ENDS}
              />
            </Figure>
          </Chapter>

          <Chapter meta={chapter('dijkstra')}>
            {code('dijkstra')}
            <div className={styles.split}>
              <Figure legend={l.chapters.dijkstra.bfs}>
                <GraphFigure
                  edges={SAMPLE_EDGES}
                  positions={SAMPLE_POSITIONS}
                  weights={SAMPLE_WEIGHTS}
                  path={BFS_PATH_5}
                  marks={[1, 5]}
                />
              </Figure>
              <Figure legend={l.chapters.dijkstra.dijkstra}>
                <GraphFigure
                  edges={SAMPLE_EDGES}
                  positions={SAMPLE_POSITIONS}
                  weights={SAMPLE_WEIGHTS}
                  path={DIJKSTRA_PATH_5}
                  marks={[1, 5]}
                />
              </Figure>
            </div>
          </Chapter>

          <Chapter meta={chapter('frontiers')}>
            <Table rows={l.chapters.frontiers.table} />
            {code('frontiers')}
            <Settles />
          </Chapter>

          <Chapter meta={chapter('bellman_ford')}>
            {code('bellman_ford')}
            <div className={styles.split}>
              <Figure legend={l.chapters.bellman_ford.tree}>
                <GraphFigure
                  edges={DIRECTED_ARCS}
                  positions={SAMPLE_POSITIONS}
                  weights={DIRECTED_WEIGHTS}
                  levels={BELLMAN.distances.map((d, v) => (v === 0 ? 0 : d))}
                  parents={BELLMAN.parents}
                  notes={BELLMAN.distances.map((d, v) => (v === 0 ? '' : show(d)))}
                  directed
                />
              </Figure>
              <Figure legend={l.chapters.bellman_ford.cycle}>
                <GraphFigure
                  edges={DIRECTED_ARCS}
                  positions={SAMPLE_POSITIONS}
                  weights={NEGATIVE_CYCLE_WEIGHTS}
                  cycle={NEGATIVE_CYCLE}
                  directed
                />
              </Figure>
            </div>
          </Chapter>

          <Chapter meta={chapter('schedules')}>
            <Table rows={l.chapters.schedules.table} />
            {code('schedules')}
          </Chapter>

          <Chapter meta={chapter('floyd_warshall')}>
            {code('floyd_warshall')}
            <Figure legend={l.chapters.floyd_warshall.matrix}>
              <Table rows={FLOYD_ROWS} />
            </Figure>
            <Table rows={l.chapters.floyd_warshall.table} />
          </Chapter>

          <Chapter meta={chapter('johnson')}>
            {code('johnson')}
            <Figure legend={l.chapters.johnson.reweighted}>
              <GraphFigure
                edges={DIRECTED_ARCS}
                positions={SAMPLE_POSITIONS}
                weights={REWEIGHTED}
                notes={POTENTIAL.map((h, v) => (v === 0 ? '' : `h ${show(h)}`))}
                directed
              />
            </Figure>
          </Chapter>

          <Chapter meta={chapter('strong_components')}>
            {code('strong_components')}
            <Figure legend={l.chapters.strong_components.legend}>
              <GraphFigure
                edges={DIRECTED_ARCS}
                positions={SAMPLE_POSITIONS}
                components={STRONG}
                directed
              />
            </Figure>
          </Chapter>
        </div>
      </div>
    </section>
  );
}

// ---- pieces -----------------------------------------------------------------

/** A part's opening: its name and what it holds, over its chapters. */
function Part({ id }: { id: PartId }) {
  const p = useT().library.parts[id];
  return (
    <Reveal as="header" className={styles.part} delay={0.05}>
      <span className={`label ${styles.partLabel}`}>
        {String(PARTS.indexOf(id) + 1).padStart(2, '0')}
      </span>
      <h2 className={styles.partTitle}>{p.title}</h2>
      <p className={styles.partBody}>{p.body}</p>
    </Reveal>
  );
}

const PARTS: PartId[] = ['library', 'algorithms'];

function Chapter({
  meta,
  children,
}: {
  meta: { id: ChapterId; source: string };
  children: ReactNode;
}) {
  const l = useT().library;
  const c = l.chapters[meta.id];
  const index = STOPS.indexOf(meta.id) + 1;
  return (
    <Reveal as="article" id={meta.id} className={styles.chapter} delay={0.05}>
      <header className={styles.chapterHead}>
        <span className={`mono ${styles.chapterIndex}`}>{String(index).padStart(2, '0')}</span>
        <h2 className={styles.chapterTitle}>{c.title}</h2>
        <a
          className={`mono ${styles.source}`}
          href={`${REPO}/${meta.source}`}
          target="_blank"
          rel="noreferrer"
        >
          {meta.source.replace('../graphman-cli/', 'cli/')}
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </header>
      <p className={styles.para}>{c.body}</p>
      {children}
    </Reveal>
  );
}

/** The sample as the course's text file, and the graph it describes, laid
    out like the home's figure: a tracked label over each piece, no box. */
function TextToGraph() {
  const t = useT();
  return (
    <div className={styles.textToGraph}>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{t.library.chapters.start.file}</span>
        <ol className={`mono ${styles.file}`}>
          {SAMPLE_TEXT.trim()
            .split('\n')
            .map((line, i) => (
              <li key={i} data-count={i === 0 || undefined}>
                {line}
              </li>
            ))}
        </ol>
      </div>
      <span className={styles.normaliseArrow} aria-hidden="true">
        →
      </span>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{t.hero.figure.graph}</span>
        <GraphFigure edges={SAMPLE_EDGES} positions={SAMPLE_POSITIONS} />
      </div>
    </div>
  );
}

/** The weighted sample as its file and as the graph, each edge with its
    weight: the start chapter's figure with a third column. */
function WeightedTextToGraph() {
  const c = useT().library.chapters.weights;
  return (
    <div className={styles.textToGraph}>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.file}</span>
        <ol className={`mono ${styles.file}`}>
          {SAMPLE_WEIGHTED_TEXT.trim()
            .split('\n')
            .map((line, i) => (
              <li key={i} data-count={i === 0 || undefined}>
                {line}
              </li>
            ))}
        </ol>
      </div>
      <span className={styles.normaliseArrow} aria-hidden="true">
        →
      </span>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.graph}</span>
        <GraphFigure edges={SAMPLE_EDGES} positions={SAMPLE_POSITIONS} weights={SAMPLE_WEIGHTS} />
      </div>
    </div>
  );
}

/** Dijkstra's settle calls beside its tree: the same order from every
    frontier, the balls shaded by distance, the farthest vertex ringed. */
function Settles() {
  const c = useT().library.chapters.frontiers;
  const max = DIJKSTRA.distances[FARTHEST];
  return (
    <div className={styles.sequence}>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.state}</span>
        <GraphFigure
          edges={SAMPLE_EDGES}
          positions={SAMPLE_POSITIONS}
          weights={SAMPLE_WEIGHTS}
          levels={DIJKSTRA.distances}
          parents={DIJKSTRA.parents}
          marks={[FARTHEST]}
          notes={DIJKSTRA.distances.map((d, v) => (v === 0 ? '' : String(d)))}
        />
      </div>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.sequence}</span>
        <ol className={styles.calls}>
          {DIJKSTRA.order.map((v, i) => (
            <li key={v} data-last={i === DIJKSTRA.order.length - 1 || undefined}>
              <span
                className={`mono ${styles.callBall}`}
                style={{
                  background: levelColour(DIJKSTRA.distances[v], max),
                  color: levelInk(DIJKSTRA.distances[v], max),
                }}
              >
                {v}
              </span>
              <span className={`mono ${styles.callText}`}>
                settle({v}, {DIJKSTRA.parents[v]}, {DIJKSTRA.distances[v]})
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** The names file, and what VertexNames answers on it. */
function Names() {
  const c = useT().library.chapters.names;
  return (
    <div className={styles.textToGraph}>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.file}</span>
        <ol className={`mono ${styles.file}`}>
          {NAMES_FILE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>
      <span className={styles.normaliseArrow} aria-hidden="true">
        →
      </span>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.answers}</span>
        <dl className={`mono ${styles.lookups}`}>
          {NAME_LOOKUPS.map(([call, answer]) => (
            <div key={call}>
              <dt>{call}</dt>
              <dd>{answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** A drawing with its one-line legend under it, nothing boxed. */
function Figure({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <figure className={styles.figure}>
      {children}
      <figcaption className={styles.legend}>{legend}</figcaption>
    </figure>
  );
}

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell}>{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, i) => (
              <td key={i} className={i === 0 || i >= 2 ? 'mono' : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The parser's normalisation drawn out: every line as written, struck
    when it is a self-loop or a repeat, then the edges that are kept. */
function Normalisation({ lines }: { lines: string[] }) {
  const c = useT().library.chapters.format;
  const seen = new Set<string>();
  const kept: [number, number][] = [];
  const rows = lines.map((line) => {
    const [u, v] = line.split(/\s+/).map(Number);
    if (u === v) return { line, drop: c.loop };
    const norm: [number, number] = [Math.min(u, v), Math.max(u, v)];
    if (seen.has(norm.join(' '))) return { line, drop: c.duplicate };
    seen.add(norm.join(' '));
    kept.push(norm);
    return { line, drop: null };
  });
  kept.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return (
    <div className={styles.normalise}>
      <div>
        <span className="label">{c.raw}</span>
        <div className={styles.chips}>
          {rows.map((row, i) => (
            <span key={i} className={`mono ${styles.chip}`} data-drop={row.drop || undefined}>
              {row.line}
              {row.drop && <small>{row.drop}</small>}
            </span>
          ))}
        </div>
      </div>
      <span className={styles.normaliseArrow} aria-hidden="true">
        →
      </span>
      <div>
        <span className="label">{c.kept}</span>
        <div className={styles.chips}>
          {kept.map(([u, v]) => (
            <span key={`${u}-${v}`} className={`mono ${styles.chip}`} data-kept>
              [{u}, {v}]
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The visitor's calls as a timeline beside the search as it stands when
    the visitor breaks: balls on one vertical edge, in the level colours
    of the drawing, the last one ringed like the vertex it stops at. */
function Sequence({ order }: { order: number[] }) {
  const c = useT().library.chapters.visitors;
  const max = Math.max(...order.map((v) => BFS.levels[v]));
  return (
    <div className={styles.sequence}>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.state}</span>
        <GraphFigure
          edges={SAMPLE_EDGES}
          positions={SAMPLE_POSITIONS}
          levels={AT_BREAK.levels}
          parents={AT_BREAK.parents}
          marks={[order[order.length - 1]]}
        />
      </div>
      <div className={styles.piece}>
        <span className={`label ${styles.pieceLabel}`}>{c.sequence}</span>
        <ol className={styles.calls}>
          {order.map((v, i) => (
            <li key={v} data-last={i === order.length - 1 || undefined}>
              <span
                className={`mono ${styles.callBall}`}
                style={{
                  background: levelColour(BFS.levels[v], max),
                  color: levelInk(BFS.levels[v], max),
                }}
              >
                {v}
              </span>
              <span className={`mono ${styles.callText}`}>
                discover({v}, {BFS.parents[v]}, {BFS.levels[v]})
              </span>
              <span className={`mono ${styles.callResult}`}>
                {i === order.length - 1 ? c.stop : c.go}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** File in, command, file out: the sample as the course's text file, the
    command that reads it and the file it writes, each under its name. */
function Flow({ steps }: { steps: string[] }) {
  const l = useT().library;
  const lines = (text: string[]) => (
    <ol className={`mono ${styles.file}`}>
      {text.map((line, i) => (
        <li key={i} data-count={i === 0 && !line.startsWith('#') ? true : undefined}>
          {line}
        </li>
      ))}
    </ol>
  );
  return (
    <div className={styles.flow}>
      <div className={styles.piece}>
        <span className={`mono ${styles.flowName}`}>{FLOW_FILES[0]}</span>
        {lines(SAMPLE_TEXT.trim().split('\n'))}
        <span className={styles.flowNote}>{steps[0]}</span>
      </div>
      <span className={styles.normaliseArrow} aria-hidden="true">
        →
      </span>
      <div className={styles.piece} data-command>
        <Code code={FLOW_COMMAND} lang="shell" copyLabel={l.copy} copiedLabel={l.copied} />
        <span className={styles.flowNote}>{steps[1]}</span>
      </div>
      <span className={styles.normaliseArrow} aria-hidden="true">
        →
      </span>
      <div className={styles.piece}>
        <span className={`mono ${styles.flowName}`}>{FLOW_FILES[1]}</span>
        {lines(BFS_FILE)}
        <span className={styles.flowNote}>{steps[2]}</span>
      </div>
    </div>
  );
}
