import { Boxes, Eye, Gauge, ListOrdered, Recycle, Ruler } from 'lucide-react';
import Reveal from './Reveal';
import styles from './Decisions.module.css';

const DECISIONS = [
  {
    icon: Boxes,
    title: 'Storage is a strategy',
    body: 'A five-method Graph trait with a GAT neighbour iterator. Every algorithm is written once and monomorphised per representation, so swapping the storage cannot change a result, only its cost.',
  },
  {
    icon: ListOrdered,
    title: 'Normalise once',
    body: 'The parser drops self-loops, orients edges as [min, max], sorts and dedups. Because the list is sorted, every builder gets ascending neighbour rows for free and all search trees come out identical.',
  },
  {
    icon: Eye,
    title: 'Traversals are observable',
    body: 'BFS and DFS report to a Visitor and can stop early. Distance is a BFS with a stop condition; DFS is iterative over neighbour iterators and yields the recursive tree with O(depth) memory.',
  },
  {
    icon: Recycle,
    title: 'Nothing is allocated twice',
    body: 'A SearchTree resets only what the previous search touched. Thousands of BFS runs in the diameter algorithms cost no allocations and no O(n) clears.',
  },
  {
    icon: Gauge,
    title: 'A memory budget, not a crash',
    body: 'Builders compute the bytes they need up front. A 375 000-vertex bitset matrix is 17.6 GB; instead of swap death you get a typed error and a table cell.',
  },
  {
    icon: Ruler,
    title: 'Diameter, four ways',
    body: 'Brute force, iFUB, Takes–Kosters bounds and a 4-sweep. The driver walks components largest-first, skips those too small to matter and every method is cancellable with a budget.',
  },
];

const TRAIT = `pub trait Graph {
    type Neighbors<'a>: Iterator<Item = Vertex> where Self: 'a;

    fn vertex_count(&self) -> usize;
    fn edge_count(&self) -> usize;
    fn degree(&self, v: Vertex) -> usize;
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_>;
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool { /* default */ }
}`;

export default function Decisions() {
  return (
    <section className="section" id="library">
      <div className="container">
        <Reveal>
          <p className="eyebrow">The library</p>
          <h2 className="section__title">Six decisions worth presenting.</h2>
          <p className="section__lead">
            Undirected graphs for now; parts 2 and 3 add weights, directions and flows on the same
            core, which is why the trait stays small and the algorithms generic.
          </p>
        </Reveal>
        <div className={styles.layout}>
          <Reveal as="pre" className={`mono ${styles.code}`} delay={0.1}>
            <code>{TRAIT}</code>
          </Reveal>
          <ul className={styles.grid}>
            {DECISIONS.map((d, i) => (
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
