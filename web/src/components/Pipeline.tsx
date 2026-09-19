'use client';

import { Cpu, Globe } from 'lucide-react';
import { siRust } from 'simple-icons';
import { useRef } from 'react';
import { useT } from '@/i18n/LocaleProvider';
import BrandIcon from './BrandIcon';
import Field from './Field';
import Reveal from './Reveal';
import styles from './Pipeline.module.css';

/** The two steps' icons; their words live in the dictionary, in the same order. */
const ICONS = [
  <BrandIcon key="rust" icon={siRust} size={22} />,
  <Cpu key="cpu" size={22} aria-hidden="true" />,
];

/* A card's frame drawn as a graph: a vertex on each corner, an edge along
   each side. Percent coordinates follow the card's size; the circles keep
   their radius. */
function Frame() {
  return (
    <svg className={styles.frame} aria-hidden="true">
      <line x1="0" y1="0" x2="100%" y2="0" />
      <line x1="100%" y1="0" x2="100%" y2="100%" />
      <line x1="100%" y1="100%" x2="0" y2="100%" />
      <line x1="0" y1="100%" x2="0" y2="0" />
      <circle cx="0" cy="0" r="6" />
      <circle cx="100%" cy="0" r="6" />
      <circle cx="100%" cy="100%" r="6" />
      <circle cx="0" cy="100%" r="6" />
    </svg>
  );
}

export default function Pipeline() {
  const t = useT();
  const globeRef = useRef<SVGSVGElement>(null);
  const steps = t.pipeline.steps.map((s, i) => ({ ...s, icon: ICONS[i] }));
  return (
    <section className={`section ${styles.section}`} id="in-the-browser">
      {/* The words sit centred over a faint globe, the browser being the
          point, on a field of dots that waves outwards from the globe. */}
      <Field origin={globeRef} />
      <div className="container">
        <Reveal className={styles.head}>
          <Globe ref={globeRef} className={styles.globe} strokeWidth={0.8} aria-hidden="true" />
          <h2 className={`section__title ${styles.title}`}>{t.pipeline.title}</h2>
          <p className={`section__lead ${styles.lead}`}>{t.pipeline.lead}</p>
        </Reveal>
        <ol className={styles.steps}>
          {steps.map((s, i) => (
            <Reveal key={s.title} as="li" className={styles.step} delay={0.15 + i * 0.12}>
              <Frame />
              <span className={styles.stepHead}>
                <span className={styles.stepIcon}>{s.icon}</span>
                <h3 className={styles.stepTitle}>{s.title}</h3>
              </span>
              <p className={styles.stepBody}>{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
