'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './Rail.module.css';

export interface RailStop {
  id: string;
  title: string;
  /** A link (the library's chapters) or, without one, a button. */
  href?: string;
}

/**
 * The page's stops as a vertical path of vertices fixed on the left: the
 * current one is filled and the edge is drawn down to it. Used by the
 * library (chapters, followed while scrolling) and the case studies (the
 * project's parts). It fades out when the footer scrolls up to it and comes
 * back as soon as the footer leaves.
 */
export default function Rail({
  label,
  stops,
  active,
  onSelect,
  numbered = true,
}: {
  label: string;
  stops: RailStop[];
  active: string;
  /** The `01`, `02` before each title; off when the titles already count. */
  numbered?: boolean;
  /** Called for a stop without `href`. */
  onSelect?: (id: string) => void;
}) {
  const [hidden, setHidden] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const rail = railRef.current?.getBoundingClientRect();
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      setHidden(!!rail && !!footer && footer.top < rail.bottom + 24);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const progress = Math.max(
    0,
    stops.findIndex((stop) => stop.id === active),
  );

  return (
    <nav ref={railRef} className={styles.rail} aria-label={label} data-hidden={hidden || undefined}>
      <ol style={{ '--progress': progress, '--stops': stops.length } as CSSProperties}>
        {stops.map((stop, i) => {
          const current = stop.id === active || undefined;
          const body = (
            <>
              <span className={styles.node} />
              {numbered && (
                <span className={`mono ${styles.index}`}>{String(i + 1).padStart(2, '0')}</span>
              )}
              <span className={styles.title}>{stop.title}</span>
            </>
          );
          return (
            <li key={stop.id} style={{ '--i': i } as CSSProperties}>
              {stop.href ? (
                <a href={stop.href} className={styles.stop} data-active={current}>
                  {body}
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.stop}
                  data-active={current}
                  aria-current={current && 'page'}
                  onClick={() => onSelect?.(stop.id)}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
