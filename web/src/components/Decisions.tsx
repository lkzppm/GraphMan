'use client';

import { Boxes, Eye, Gauge, ListOrdered, Recycle, Ruler } from 'lucide-react';
import { useT } from '@/i18n/LocaleProvider';
import Reveal from './Reveal';
import styles from './Decisions.module.css';

/** One icon per decision; the words live in the dictionary, in the same order. */
const ICONS = [Boxes, ListOrdered, Eye, Recycle, Gauge, Ruler];

const TRAIT = `pub trait Graph {
    type Neighbors<'a>: Iterator<Item = Vertex> where Self: 'a;

    fn vertex_count(&self) -> usize;
    fn edge_count(&self) -> usize;
    fn degree(&self, v: Vertex) -> usize;
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_>;
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool { /* default */ }
}`;

export default function Decisions() {
  const t = useT();
  const decisions = t.decisions.items.map((d, i) => ({ ...d, icon: ICONS[i] }));
  return (
    <section className="section" id="library">
      <div className="container">
        <Reveal>
          <p className="eyebrow">{t.decisions.eyebrow}</p>
          <h2 className="section__title">{t.decisions.title}</h2>
          <p className="section__lead">{t.decisions.lead}</p>
        </Reveal>
        <div className={styles.layout}>
          <Reveal as="pre" className={`mono ${styles.code}`} delay={0.1}>
            <code>{TRAIT}</code>
          </Reveal>
          <ul className={styles.grid}>
            {decisions.map((d, i) => (
              <Reveal key={d.title} as="li" className={styles.card} delay={0.15 + i * 0.07}>
                <span className={styles.cardIcon}>
                  <d.icon size={16} aria-hidden="true" />
                </span>
                <h3 className={styles.cardTitle}>{d.title}</h3>
                <p className={styles.cardBody}>{d.body}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
