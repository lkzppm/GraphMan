'use client';

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefObject,
} from 'react';

interface Props {
  children: ReactNode;
  /** Seconds to wait before rising, for staggered groups. */
  delay?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** Also hands the element to the caller (React 19: a plain prop). */
  ref?: RefObject<HTMLElement | null>;
}

/** Rises its children into place the first time they scroll into view:
    hidden until 15 % of the element is past the lower 12 % of the viewport. */
export default function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
  style,
  ref: outer,
}: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (outer) outer.current = el;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      el.classList.add('is-visible');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-visible');
            observer.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [outer]);

  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`}
      style={{ ...style, '--delay': `${delay}s` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
