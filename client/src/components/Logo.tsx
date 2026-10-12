interface LogoProps {
  /** Rendered width and height in px. */
  size?: number;
}

/**
 * The Astrolabe mark: a planet with a tilted orbit and a satellite on it.
 * Same drawing as public/favicon.svg, minus the dark tile, so it sits
 * directly on the page. The planet uses the theme accent; the orbit uses
 * the current text colour.
 */
export function Logo({ size = 32 }: LogoProps) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g transform="rotate(-25 32 32)" fill="none" strokeLinecap="round">
        <path d="M7 32 A25 10 0 0 1 57 32" stroke="currentColor" strokeOpacity="0.45" strokeWidth="3" />
        <circle cx="32" cy="32" r="11.5" fill="var(--accent)" stroke="none" />
        <path d="M57 32 A25 10 0 0 1 7 32" stroke="currentColor" strokeWidth="3" />
        <circle cx="46" cy="39.7" r="4.5" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}