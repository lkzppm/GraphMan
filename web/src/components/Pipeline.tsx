import { Cpu, Orbit } from 'lucide-react';
import { siRust } from 'simple-icons';
import BrandIcon from './BrandIcon';
import Reveal from './Reveal';
import styles from './Pipeline.module.css';

const STEPS = [
  {
    step: '01',
    icon: <BrandIcon icon={siRust} size={18} />,
    title: 'Rust, compiled to WebAssembly',
    body: 'The same crate that runs the case studies (crates/graphman) is bound with wasm-bindgen. Parsing, BFS, DFS, distances, components and the diameter run in your tab, single-threaded, from the file you drop.',
  },
  {
    step: '02',
    icon: <Orbit size={18} aria-hidden="true" />,
    title: 'The search tree is the layout',
    body: 'A BFS from the smallest vertex of every component gives each vertex a ring and an angle in O(n). That radial layout is the starting point, and the final one for graphs too large to simulate.',
  },
  {
    step: '03',
    icon: <Cpu size={18} aria-hidden="true" />,
    title: 'WebGPU through vgpu',
    body: 'Positions, edges and the search tree live in GPU storage buffers. A compute shader relaxes the layout with a force simulation; two draws render every vertex and edge, coloured by the level the traversal reached them at.',
  },
];

export default function Pipeline() {
  return (
    <section className="section" id="in-the-browser">
      <div className="container">
        <Reveal>
          <p className="eyebrow">In the browser</p>
          <h2 className="section__title">No server, no pre-baked data: the library itself.</h2>
          <p className="section__lead">
            The observatory starts empty. Load any graph in the course format and everything you see
            is computed on the spot.
          </p>
        </Reveal>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <Reveal key={s.step} as="li" className={styles.step} delay={0.1 + i * 0.1}>
              <span className={styles.stepHead}>
                <span className={`mono ${styles.index}`}>{s.step}</span>
                <span className={styles.stepIcon}>{s.icon}</span>
              </span>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepBody}>{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
