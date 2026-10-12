interface SectionHeadProps {
  title: string;
  /** Where the data comes from, shown as a small mono kicker above the title. */
  source: string;
  status: "loading" | "success" | "error";
  /** Epoch ms of the last successful load. */
  updatedAt?: number;
  /** Word shown while healthy. "LIVE" for polled feeds, "DAILY" for APOD, etc. */
  liveLabel?: string;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Title block + status badge shared by all five tabs. */
export function SectionHead({ title, source, status, updatedAt, liveLabel = "LIVE" }: SectionHeadProps) {
  const label = status === "success" ? liveLabel : status === "error" ? "OFFLINE" : "SYNCING";
  return (
    <header className="section-head">
      <div>
        <div className="section-kicker muted">{source}</div>
        <h2>{title}</h2>
      </div>
      <div className={`live-badge live-badge-${status}`}>
        <span className="live-dot" aria-hidden="true" />
        <span>{label}</span>
        {status === "success" && updatedAt !== undefined && (
          <span className="muted"> · updated {formatClock(updatedAt)}</span>
        )}
      </div>
    </header>
  );
}