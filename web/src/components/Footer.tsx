import Link from 'next/link';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.cols}>
          <div>
            <h3 className={`label ${styles.heading}`}>Project</h3>
            <a href="https://github.com/lkzppm/GraphMan" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            <Link href="/observatory">Observatory</Link>
            <Link href="/library">Library</Link>
            <Link href="/studies">Case studies</Link>
          </div>
          <div>
            <h3 className={`label ${styles.heading}`}>Stack</h3>
            <span>Rust 2024 · wasm-bindgen</span>
            <span>Next.js · vgpu (WebGPU)</span>
            <span>MIT licensed</span>
          </div>
          <div>
            <h3 className={`label ${styles.heading}`}>Course</h3>
            <span>COS 242 · Teoria dos Grafos</span>
            <span>UFRJ · 2026/2</span>
          </div>
        </div>
        <p className={styles.legal}>
          Case-study timings were measured on the machine named in each study and exclude parsing
          and output, as the course requires.
        </p>
        <p className={`comment ${styles.comment}`}>{'// built sep 2026 · rio de janeiro'}</p>
      </div>
    </footer>
  );
}
