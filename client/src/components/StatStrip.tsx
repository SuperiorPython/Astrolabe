import { Skeleton } from "./Skeleton";

export type StatTone = "default" | "accent" | "warn" | "critical" | "ok";

export interface StatItem {
  label: string;
  value: string;
  /** Small line under the value (units, context). */
  hint?: string;
  tone?: StatTone;
}

interface StatStripProps {
  items: StatItem[];
}

/** The headline row at the top of every tab: 3–4 big numbers at a glance. */
export function StatStrip({ items }: StatStripProps) {
  return (
    <div className="stat-strip">
      {items.map((item) => (
        <div key={item.label} className={`stat-cell stat-cell-${item.tone ?? "default"}`}>
          <div className="stat-label">{item.label}</div>
          <div className="stat-big">{item.value}</div>
          {item.hint && <div className="stat-hint muted">{item.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Same strip with shimmering placeholders, for the loading state. */
export function StatStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="stat-strip" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stat-cell">
          <Skeleton height="0.8rem" width="55%" />
          <Skeleton height="1.8rem" width="75%" className="skeleton-gap" />
        </div>
      ))}
    </div>
  );
}