'use client';

import { Cpu, Orbit } from 'lucide-react';
import { siRust } from 'simple-icons';
import { useT } from '@/i18n/LocaleProvider';
import BrandIcon from './BrandIcon';
import Reveal from './Reveal';
import styles from './Pipeline.module.css';

/** The three steps' icons; their words live in the dictionary, in the same order. */
const ICONS = [
  <BrandIcon key="rust" icon={siRust} size={18} />,
  <Orbit key="orbit" size={18} aria-hidden="true" />,
  <Cpu key="cpu" size={18} aria-hidden="true" />,
];

export default function Pipeline() {
  const t = useT();
  const steps = t.pipeline.steps.map((s, i) => ({
    ...s,
    step: String(i + 1).padStart(2, '0'),
    icon: ICONS[i],
  }));
  return (
    <section className="section" id="in-the-browser">
      <div className="container">
        <Reveal>
          <p className="eyebrow">{t.pipeline.eyebrow}</p>
          <h2 className="section__title">{t.pipeline.title}</h2>
          <p className="section__lead">{t.pipeline.lead}</p>
        </Reveal>
        <ol className={styles.steps}>
          {steps.map((s, i) => (
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
