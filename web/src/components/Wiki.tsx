'use client';

import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/i18n/LocaleProvider';
import {
  SAMPLE_EDGES,
  SAMPLE_POSITIONS,
  SAMPLE_TEXT,
  TWO_COMPONENT_EDGES,
  TWO_COMPONENT_POSITIONS,
  bfs,
  components,
  dfs,
  shortestPath,
} from '@/lib/sample';
import Code from './Code';
import GraphFigure from './GraphFigure';
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
  | 'traversals'
  | 'visitors'
  | 'distance'
  | 'diameter'
  | 'cli';

/** Every chapter and the source file it documents. */
const CHAPTERS: { id: ChapterId; source: string }[] = [
  { id: 'start', source: 'src/lib.rs' },
  { id: 'format', source: 'src/io/edge_list.rs' },
  { id: 'representations', source: 'src/graph/mod.rs' },
  { id: 'traversals', source: 'src/algo/traversal.rs' },
  { id: 'visitors', source: 'src/algo/traversal.rs' },
  { id: 'distance', source: 'src/algo/distance.rs' },
  { id: 'diameter', source: 'src/algo/diameter.rs' },
  { id: 'cli', source: '../graphman-cli/src/main.rs' },
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
      {/* The stops as a vertical path of vertices, fixed on the left; the
          current one is filled and the edge is drawn down to it. */}
      <nav className={styles.rail} aria-label={l.contents}>
        <ol style={{ '--progress': STOPS.indexOf(active) } as CSSProperties}>
          {STOPS.map((id, i) => (
            <li key={id}>
              <a href={`#${id}`} data-active={active === id || undefined}>
                <span className={styles.railNode} />
                <span className={`mono ${styles.railIndex}`}>{String(i + 1).padStart(2, '0')}</span>
                <span className={styles.railTitle}>{l.chapters[id].title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className={`container ${styles.layout}`}>
        <div className={styles.content}>
          <Chapter meta={chapter('start')} index={1}>
            <Code code={CARGO} lang="toml" copyLabel={l.copy} copiedLabel={l.copied} />
            {code('start')}
            <TextToGraph />
          </Chapter>

          <Chapter meta={chapter('format')} index={2}>
            {code('format')}
            <Normalisation lines={FORMAT_INPUT} />
          </Chapter>

          <Chapter meta={chapter('representations')} index={3}>
            <Representations />
            <Table rows={l.chapters.representations.table} />
            {code('representations')}
            <p className={styles.para}>{l.chapters.representations.dispatch}</p>
            {code('dispatch')}
          </Chapter>

          <Chapter meta={chapter('traversals')} index={4}>
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

          <Chapter meta={chapter('visitors')} index={5}>
            {code('visitors')}
            <Sequence order={UNTIL_4} tree={BFS} />
          </Chapter>

          <Chapter meta={chapter('distance')} index={6}>
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

          <Chapter meta={chapter('diameter')} index={7}>
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

          <Chapter meta={chapter('cli')} index={8}>
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
        </div>
      </div>
    </section>
  );
}

// ---- pieces -----------------------------------------------------------------

function Chapter({
  meta,
  index,
  children,
}: {
  meta: { id: ChapterId; source: string };
  index: number;
  children: ReactNode;
}) {
  const l = useT().library;
  const c = l.chapters[meta.id];
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

/** The discover calls a stopping visitor receives, the last one breaking. */
function Sequence({
  order,
  tree,
}: {
  order: number[];
  tree: { parents: number[]; levels: number[] };
}) {
  const c = useT().library.chapters.visitors;
  return (
    <div className={styles.figure}>
      <p className={styles.legend}>{c.sequence}</p>
      <ol className={styles.calls}>
        {order.map((v, i) => (
          <li key={v} className="mono" data-last={i === order.length - 1 || undefined}>
            <span className={styles.callBall}>{v}</span>
            <span className={styles.callText}>
              discover({v}, {tree.parents[v]}, {tree.levels[v]})
            </span>
            <span className={styles.callResult}>{i === order.length - 1 ? c.stop : c.go}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** In, command, out: three vertices on one edge. */
function Flow({ steps }: { steps: string[] }) {
  const files = ['grafo_1.txt', 'graphman', 'grafo_1.bfs-1.txt'];
  return (
    <ol className={styles.flow}>
      {steps.map((step, i) => (
        <li key={step}>
          <span className={`mono ${styles.flowNode}`} data-command={i === 1 || undefined}>
            {files[i]}
          </span>
          <span className={styles.flowNote}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
