// The pieces every slide of the deck shares: the entrance delay, the head,
// the benchmark bar. Both parts' slides draw with them.
import type { CSSProperties, ReactNode } from 'react';
import type { useT } from '@/i18n/LocaleProvider';
import styles from './Deck.module.css';

export type T = ReturnType<typeof useT>;

/** Seconds into the slide's arrival at which an element starts moving. */
export const at = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties;

/** The head every slide but the cover wears: the slide's number and one word. */
export function Head({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className={styles.head}>
      <p className={`mono ${styles.index} ${styles.rise}`} style={at(0)}>
        {eyebrow}
      </p>
      <h2 className={`${styles.title} ${styles.rise}`} style={at(0.08)}>
        {title}
      </h2>
    </header>
  );
}

/** One bar: a track, a fill that grows to its share of the shared scale,
    the measurement after it. A ghost bar (a refused representation, an
    estimated time) is dashed. */
export function Bar({
  width,
  colour,
  value,
  ghost,
  delay,
}: {
  width: number;
  colour: string;
  value: ReactNode;
  ghost?: boolean;
  delay: number;
}) {
  return (
    <span className={styles.barRow} data-ghost={ghost || undefined}>
      <span className={styles.track}>
        <span
          className={styles.fill}
          style={
            {
              ...at(delay),
              // Rounded: Math.log10 differs in its last digit between Node and
              // the browser, and a different string would break hydration.
              '--w': `${Math.max(1.5, width * 100).toFixed(2)}%`,
              '--colour': colour,
            } as CSSProperties
          }
        />
      </span>
      <span className={`mono ${styles.barValue} ${styles.figFade}`} style={at(delay + 0.5)}>
        {value}
      </span>
    </span>
  );
}
