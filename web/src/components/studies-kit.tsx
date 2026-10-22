'use client';

// The pieces both parts of the case studies are drawn with: a chapter per
// question, horizontal bars, and the swap that crossfades a number when the
// view changes.

import type { CSSProperties, ReactNode } from 'react';
import Reveal from './Reveal';
import styles from './Studies.module.css';

export interface Bar {
  key: string;
  label: string;
  colour: string;
  /** 0..1 of the track; null draws nothing but the value. */
  width: number | null;
  value: ReactNode;
  /** Dashed outline instead of a fill: something that was not measured. */
  ghost?: boolean;
}

/** Numbers that change when the view does: the span is keyed by the view,
    so React swaps its contents and the new ones fade up into place. */
export function Swap({
  view,
  className,
  children,
}: {
  view: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span key={view} className={`${styles.swap} ${className ?? ''}`}>
      {children}
    </span>
  );
}

/** A question of the assignment: mono index, title, hairline, the drawing. */
export function Chapter({
  index,
  title,
  delay,
  tools,
  className,
  children,
}: {
  index: number;
  title: string;
  delay: number;
  /** Controls at the right end of the heading. */
  tools?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Reveal as="article" className={`${styles.chapter} ${className ?? ''}`} delay={delay}>
      <header className={styles.chapterHead}>
        <span className={`mono ${styles.chapterIndex}`}>{String(index).padStart(2, '0')}</span>
        <h2 className={styles.chapterTitle}>{title}</h2>
        {tools}
      </header>
      {children}
    </Reveal>
  );
}

/** Horizontal bars, label on the left, value after the bar. The fill is
    always in the tree (width 0 when there is nothing to draw) so a change
    of view slides it instead of replacing it. */
export function Bars({ bars, view }: { bars: Bar[]; view: string }) {
  return (
    <div className={styles.bars}>
      {bars.map((bar) => (
        <div
          key={bar.key}
          className={styles.bar}
          data-ghost={bar.ghost || undefined}
          data-bare={bar.label === '' || undefined}
          data-empty={bar.width === null || undefined}
        >
          {bar.label !== '' && <span className={`mono ${styles.barLabel}`}>{bar.label}</span>}
          <span className={styles.track}>
            <span
              className={styles.fill}
              style={
                {
                  '--w': bar.width === null ? '0%' : `${Math.max(0.6, bar.width * 100)}%`,
                  '--colour': bar.colour,
                } as CSSProperties
              }
            />
            <span className={`mono ${styles.value}`}>
              <Swap view={view}>{bar.value}</Swap>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
