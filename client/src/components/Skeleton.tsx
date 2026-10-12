import type { CSSProperties } from "react";

interface SkeletonProps {
  /** Any CSS length; defaults to a one-line text bar. */
  height?: string;
  width?: string;
  className?: string;
}

/**
 * A shimmering placeholder block shown while a section's data loads —
 * it holds the layout open so the page doesn't jump when real content
 * arrives, and reads as "working" rather than "broken".
 */
export function Skeleton({ height = "1em", width = "100%", className = "" }: SkeletonProps) {
  const style: CSSProperties = { height, width };
  return <div className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}