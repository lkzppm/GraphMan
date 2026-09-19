import type { SimpleIcon } from 'simple-icons';

/** A brand glyph from simple-icons (or anything with a title and a 24-box
    path), drawn in the current text colour. */
export default function BrandIcon({
  icon,
  size = 18,
  className,
}: {
  icon: Pick<SimpleIcon, 'title' | 'path'>;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label={icon.title}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
    >
      <path d={icon.path} />
    </svg>
  );
}
