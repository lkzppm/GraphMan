import { motion } from 'motion/react';
import { MetalFx } from 'metal-fx';
import type { GraphMeta, GraphStudy } from '../lib/data.ts';
import { formatCompact, formatMs } from '../lib/format.ts';
import './Hero.css';

interface Props {
  graphs: GraphMeta[];
  studies: GraphStudy[];
}

const rise = {
  hidden: { opacity: 0, y: 22 },
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
        : 'edges in the largest graph',
    },
    { value: '3', label: 'storage strategies, one trait' },
    { value: '4', label: 'diameter algorithms' },
    {
      value: observatoryMax ? formatCompact(observatoryMax) : '4.8M',
      label: 'vertices drawn live',
    },
  ];

  return (
    <section id="top" className="hero">
      <div className="hero__inner">
        <motion.div
          className="hero__copy"
          initial="hidden"
          animate="show"
          transition={{ staggerChildren: 0.1, delayChildren: 0.15 }}
        >
          <motion.p className="eyebrow" variants={rise} transition={{ duration: 0.6 }}>
            COS 242 · Graph Theory · Part 1
          </motion.p>
          <motion.h1 className="hero__title" variants={rise} transition={{ duration: 0.7 }}>
            Graphs,
            <br />
            manipulated.
          </motion.h1>
          <motion.p className="hero__lead" variants={rise} transition={{ duration: 0.7 }}>
            A Rust graph library that measures itself. One trait, three ways to store a graph, four
            ways to find its diameter, and an observatory that draws millions of vertices from the
            search tree alone.
          </motion.p>
          <motion.div className="hero__cta" variants={rise} transition={{ duration: 0.7 }}>
            <MetalFx
              variant="button"
              preset="silver"
              theme="light"
              strength={0.8}
              normalizeHostStyles={false}
            >
              <a className="pill" href="#observatory">
                Open the observatory
              </a>
            </MetalFx>
            <a className="pill pill--ghost" href="#studies">
              Read the case studies
            </a>
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

        <motion.div
          className="hero__stage"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
        >
          <video
            className="hero__video"
            src="/brand/graphman-loop.mp4"
            poster="/brand/graphman-1024.png"
            autoPlay
            muted
            loop
            playsInline
            aria-label="GraphMan logo animation"
          />
        </motion.div>
      </div>
    </section>
  );
}
