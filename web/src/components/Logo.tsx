import styles from './Logo.module.css';

interface Props {
  size?: number;
  /** `full` is the two-tone logo (grey hexagon, blue graph; a white
      hexagon in the dark theme); `mark` the one-colour mask. */
  variant?: 'mark' | 'full';
  className?: string;
  shake?: boolean;
}

/** The GraphMan mark, with the hover shake the site uses everywhere. */
export default function Logo({ size = 28, variant = 'full', className = '', shake = true }: Props) {
  return (
    <span
      className={`${styles.logo} ${shake ? styles.shake : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {variant === 'mark' ? (
        <span
          className={styles.mask}
          style={{
            maskImage: 'url(/brand/graphman-mark.svg)',
            WebkitMaskImage: 'url(/brand/graphman-mark.svg)',
          }}
        />
      ) : (
        // Both drawings, the theme shows one (CSS only, so no flash before
        // hydration; the switch crossfades them). Static SVGs.
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.light}
            src="/brand/graphman.svg"
            alt=""
            width={size}
            height={size}
            draggable={false}
            data-theme-keep
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.dark}
            src="/brand/graphman-dark.svg"
            alt=""
            width={size}
            height={size}
            draggable={false}
            data-theme-keep
          />
        </>
      )}
    </span>
  );
}
