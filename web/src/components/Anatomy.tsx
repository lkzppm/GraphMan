import { motion } from 'motion/react';
import './Anatomy.css';

const DECISIONS = [
  {
    title: 'Storage is a strategy',
    body: 'A five-method Graph trait. Every algorithm is written once and specialised per representation by the compiler, so swapping the storage cannot change a result, only its cost.',
  },
  {
    title: 'Normalise once',
    body: 'The parser drops self-loops, orients edges, sorts and dedups. Because the edge list is sorted, every builder gets ascending neighbour rows for free and all search trees come out identical.',
  },
  {
    title: 'Traversals are observable',
    body: 'BFS and DFS report to a Visitor and can be stopped early. Distance is a BFS with a stop condition; the observatory frames are just another listener.',
  },
  {
    title: 'Nothing is allocated twice',
    body: 'A SearchTree resets only what the previous search touched. Thousands of BFS runs in the diameter algorithms cost no allocations and no O(n) clears.',
  },
  {
    title: 'A memory budget, not a crash',
    body: 'Builders compute the bytes they need up front. A 375 000-vertex bitset matrix is 17.6 GB; instead of swap death you get a typed error and a table cell.',
  },
  {
    title: 'Edge lists live in a mapping',
    body: 'Large edge lists are stored in an anonymous memory mapping that the kernel reclaims the instant the representation is built, so memory measurements show only what is live.',
  },
];

const Box = ({
  x,
  y,
  w,
  h,
  title,
  sub,
  accent = false,
  delay = 0,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  accent?: boolean;
  delay?: number;
}) => (
  <motion.g
    initial={{ opacity: 0, y: 10 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
  >
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={14}
      fill={accent ? 'var(--color-primary)' : 'var(--color-canvas)'}
      stroke={accent ? 'var(--color-primary)' : 'var(--color-hairline)'}
    />
    <text
      x={x + w / 2}
      y={y + (sub ? h / 2 - 6 : h / 2 + 5)}
      textAnchor="middle"
      className={accent ? 'anatomy__label anatomy__label--accent' : 'anatomy__label'}
    >
      {title}
    </text>
    {sub && (
      <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" className="anatomy__sub">
        {sub}
      </text>
    )}
  </motion.g>
);

const Wire = ({ d, delay = 0 }: { d: string; delay?: number }) => (
  <motion.path
    d={d}
    fill="none"
    stroke="var(--color-ink-48)"
    strokeWidth={1.5}
    strokeLinecap="round"
    initial={{ pathLength: 0, opacity: 0 }}
    whileInView={{ pathLength: 1, opacity: 1 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.9, delay, ease: 'easeOut' }}
  />
);

export default function Anatomy() {
  return (
    <section id="anatomy" className="tile tile--parchment">
      <div className="tile__inner">
        <div className="tile__head">
          <p className="eyebrow">Anatomy</p>
          <h2 className="display-lg">One trait. Three strategies. Every algorithm once.</h2>
          <p className="lead">
            The library is organised so that the representation is a choice the caller makes, and
            nothing else ever notices.
          </p>
        </div>

        <div className="anatomy__diagram card">
          <svg viewBox="0 0 960 420" role="img" aria-labelledby="anatomy-title">
            <title id="anatomy-title">
              Three storage strategies implement the Graph trait; algorithms consume the trait and
              report to visitors.
            </title>
            <Box
              x={20}
              y={40}
              w={200}
              h={64}
              title="AdjacencyList"
              sub="Vec<Vec<Vertex>>"
              delay={0}
            />
            <Box x={20} y={178} w={200} h={64} title="Csr" sub="offsets + targets" delay={0.1} />
            <Box
              x={20}
              y={316}
              w={200}
              h={64}
              title="AdjacencyMatrix"
              sub="n × n bitset, BitRow"
              delay={0.2}
            />

            <Wire d="M220 72 C300 72, 300 210, 380 210" delay={0.3} />
            <Wire d="M220 210 L380 210" delay={0.35} />
            <Wire d="M220 348 C300 348, 300 210, 380 210" delay={0.4} />

            <Box
              x={380}
              y={160}
              w={200}
              h={100}
              title="trait Graph"
              sub="neighbors · degree · has_edge"
              accent
              delay={0.45}
            />

            <Wire d="M580 210 C640 210, 640 72, 740 72" delay={0.6} />
            <Wire d="M580 210 C640 210, 640 164, 740 164" delay={0.65} />
            <Wire d="M580 210 C640 210, 640 256, 740 256" delay={0.7} />
            <Wire d="M580 210 C640 210, 640 348, 740 348" delay={0.75} />

            <Box
              x={740}
              y={40}
              w={200}
              h={64}
              title="bfs · dfs"
              sub="→ SearchTree, Visitor"
              delay={0.8}
            />
            <Box
              x={740}
              y={132}
              w={200}
              h={64}
              title="distance"
              sub="BFS with StopAt"
              delay={0.85}
            />
            <Box
              x={740}
              y={224}
              w={200}
              h={64}
              title="Components"
              sub="largest first"
              delay={0.9}
            />
            <Box
              x={740}
              y={316}
              w={200}
              h={64}
              title="diameter"
              sub="exact · iFUB · bounds · sweep"
              delay={0.95}
            />
          </svg>
        </div>

        <div className="grid grid--3 anatomy__cards">
          {DECISIONS.map((d, i) => (
            <motion.article
              key={d.title}
              className="card"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="card__title">{d.title}</h3>
              <p className="card__body">{d.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
