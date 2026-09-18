import styles from './Logo.module.css';

interface Props {
  size?: number;
  /** `full` is the two-tone logo (grey hexagon, blue graph); `mark` the one-colour mask. */
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
        // eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed
        <img src="/brand/graphman.svg" alt="" width={size} height={size} draggable={false} />
      )}
    </span>
  );
}
