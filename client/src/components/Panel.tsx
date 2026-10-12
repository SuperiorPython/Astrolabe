import type { ReactNode } from "react";

interface PanelProps {
  title?: string;
  /** Small right-aligned text in the panel header, e.g. a unit or a count. */
  meta?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The shared "instrument panel" container: dark surface, hairline border and
 * amber corner brackets (drawn in CSS). Every section's cards use this so
 * the five tabs read as one console.
 */
export function Panel({ title, meta, className = "", children }: PanelProps) {
  return (
    <div className={`panel ${className}`.trim()}>
      {(title || meta) && (
        <div className="panel-head">
          {title && <h3 className="panel-title">{title}</h3>}
          {meta && <span className="panel-meta muted">{meta}</span>}
        </div>
      )}
      {children}
    </div>
  );
}