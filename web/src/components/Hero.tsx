import { motion } from 'motion/react';
import type { GraphMeta, GraphStudy } from '../lib/data.ts';
import { formatCompact, formatMs } from '../lib/format.ts';
import './Hero.css';

interface Props {
  graphs: GraphMeta[];
  studies: GraphStudy[];
}

const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0 },
};

export default function Hero({ graphs, studies }: Props) {
  const largest = studies.reduce<GraphStudy | null>(
    (best, s) => (best === null || s.edges > best.edges ? s : best),
    null,
  );
  const observatoryMax = graphs.reduce((max, g) => Math.max(max, g.vertices), 0);

  const facts: { value: string; label: string }[] = [
    {
      value: largest ? formatCompact(largest.edges) : '46.5M',
      label: largest
        ? `edges parsed in ${formatMs(largest.parse_ms)}`
        : 'edges in the largest course graph',
    },
    { value: '3', label: 'storage strategies behind one trait' },
    { value: '4', label: 'diameter algorithms, all cancellable' },
    {
      value: observatoryMax ? formatCompact(observatoryMax) : '375K',
      label: 'vertices drawn live in the observatory',
    },
  ];

  return (
    <section id="top" className="tile tile--light hero">
      <motion.div
        className="tile__inner hero__inner"
        initial="hidden"
        animate="show"
        transition={{ staggerChildren: 0.12, delayChildren: 0.1 }}
      >
        <motion.p className="eyebrow" variants={rise} transition={{ duration: 0.6 }}>
          COS 242 · Graph Theory · Part 1
        </motion.p>
        <motion.h1 className="hero__title" variants={rise} transition={{ duration: 0.7 }}>
          Graphs, manipulated.
        </motion.h1>
        <motion.p className="lead hero__lead" variants={rise} transition={{ duration: 0.7 }}>
          GraphMan is a Rust graph library that measures itself. One trait, three ways to store a
          graph, four ways to find its diameter, and an observatory that draws millions of vertices
          from the search tree alone.
        </motion.p>
        <motion.div className="hero__cta" variants={rise} transition={{ duration: 0.7 }}>
          <a className="pill" href="#observatory">
            Open the observatory
          </a>
          <a className="pill pill--ghost" href="#studies">
            Read the case studies
          </a>
        </motion.div>
        <motion.div
          className="hero__product"
          initial={{ opacity: 0, scale: 0.94, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.35 }}
        >
          <img
            src="/brand/graphman-1024.png"
            alt="GraphMan logo: a figure pushing a network inside a hexagon"
            width={420}
            height={420}
          />
        </motion.div>
        <motion.dl className="hero__facts" variants={rise} transition={{ duration: 0.7 }}>
          {facts.map((fact) => (
            <div key={fact.label} className="hero__fact">
              <dt className="mono">{fact.value}</dt>
              <dd>{fact.label}</dd>
            </div>
          ))}
        </motion.dl>
      </motion.div>
    </section>
  );
}
