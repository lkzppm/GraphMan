import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__cols">
          <div>
            <h3 className="footer__heading">Project</h3>
            <a href="https://github.com/lkzppm/GraphMan" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            <a href="#studies">Case studies</a>
            <a href="#anatomy">Architecture</a>
          </div>
          <div>
            <h3 className="footer__heading">Library</h3>
            <span>Rust 2024 · rayon · memmap2</span>
            <span>MIT licensed</span>
          </div>
          <div>
            <h3 className="footer__heading">Course</h3>
            <span>COS 242 · Teoria dos Grafos</span>
            <span>UFRJ · 2026/2</span>
          </div>
        </div>
        <p className="footer__legal">
          GraphMan. Built for the COS 242 course project, part 1. Timings measured on the machine
          named in each study; your mileage will vary.
        </p>
      </div>
    </footer>
  );
}
