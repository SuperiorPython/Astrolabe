import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type SpaceWeatherEvent } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { formatDateTime, formatShortDay, isoDay, lastNDays } from "../lib/format";
import { Panel } from "./Panel";
import { SectionHead } from "./SectionHead";
import { Skeleton } from "./Skeleton";
import { StatStrip, StatStripSkeleton, type StatItem, type StatTone } from "./StatStrip";

const DAYS = 30;
const MAX_FEED_ITEMS = 60;

// Stacking order, bottom to top. Fixed order = the CVD-safety mechanism
// (see dataviz skill, palette.md) — never reassign these on filter.
const EVENT_TYPES: SpaceWeatherEvent["type"][] = ["Solar Flare", "CME", "Geomagnetic Storm"];

const TYPE_COLOR: Record<SpaceWeatherEvent["type"], string> = {
  "Solar Flare": "var(--series-1)", // blue
  CME: "var(--series-2)", // orange
  "Geomagnetic Storm": "var(--series-3)", // aqua
};

interface DayBucket {
  date: string;
  "Solar Flare": number;
  CME: number;
  "Geomagnetic Storm": number;
}

// ---------------------------------------------------------------------------
// Severity
//
// Flares are ranked by their X-ray class (A < B < C < M < X, then the number
// after the letter). Geomagnetic storms use NOAA's G-scale, which is defined
// from the Kp index: Kp 5 = G1 (minor) up to Kp 9 = G5 (extreme). Kp values
// come in thirds (4.67 is written "5-"), so the level uses the rounded Kp.
// ---------------------------------------------------------------------------

type Severity = "minor" | "moderate" | "major";

const FLARE_LETTER_RANK: Record<string, number> = { A: 1, B: 2, C: 3, M: 4, X: 5 };

interface ParsedFlare {
  letter: string;
  value: number;
  /** Comparable score: higher is stronger. */
  score: number;
}

function parseFlare(flareClass: string | undefined): ParsedFlare | null {
  if (!flareClass) return null;
  const match = /^([ABCMX])\s*([0-9]+(?:\.[0-9]+)?)?/i.exec(flareClass.trim());
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const value = match[2] ? Number(match[2]) : 0;
  return { letter, value, score: FLARE_LETTER_RANK[letter] * 1000 + value };
}

function flareSeverity(letter: string): Severity {
  if (letter === "X") return "major";
  if (letter === "M") return "moderate";
  return "minor";
}

/** NOAA G-scale level (1–5) for a Kp value, or 0 if it's below storm level. */
function gLevel(kp: number): number {
  return Math.max(0, Math.min(5, Math.round(kp) - 4));
}

function stormSeverity(g: number): Severity {
  if (g >= 3) return "major";
  if (g === 2) return "moderate";
  return "minor";
}

const G_NAMES = ["", "minor", "moderate", "strong", "severe", "extreme"];

function severityTone(severity: Severity): StatTone {
  return severity === "major" ? "critical" : severity === "moderate" ? "warn" : "ok";
}

/** Severity pill shown on feed items that have a measurable size. */
function severityBadge(event: SpaceWeatherEvent): { label: string; severity: Severity } | null {
  if (event.type === "Solar Flare") {
    const flare = parseFlare(event.flareClass);
    if (!flare) return null;
    return { label: event.flareClass as string, severity: flareSeverity(flare.letter) };
  }
  if (event.type === "Geomagnetic Storm" && event.kp !== undefined) {
    const g = gLevel(event.kp);
    return { label: g > 0 ? `G${g} · Kp ${event.kp}` : `Kp ${event.kp}`, severity: stormSeverity(g) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chart pieces
// ---------------------------------------------------------------------------

/**
 * Renders one stacked-bar segment, inset 1px top and bottom so touching
 * segments leave a 2px surface-color gap at their shared edge instead of a
 * border (see dataviz skill, marks-and-anatomy.md — a stroke would add
 * data-weight ink that isn't data). Only the top-of-stack series rounds its
 * top corners; this rounds unconditionally for that series rather than only
 * on days where it's the actual tallest visible segment, which is a
 * deliberate simplification.
 */
function StackSegment(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  roundTop?: boolean;
}) {
  const { x, y, width, height, fill, roundTop } = props;
  if (x === undefined || y === undefined || width === undefined || !height || height <= 0) {
    return null;
  }

  const inset = 1;
  const ry = y + inset;
  const rh = Math.max(height - inset * 2, 0);

  if (!roundTop) {
    return <rect x={x} y={ry} width={width} height={rh} fill={fill} />;
  }

  const r = Math.min(3, width / 2, rh);
  const d = `M${x},${ry + rh} L${x},${ry + r} Q${x},${ry} ${x + r},${ry} L${
    x + width - r
  },${ry} Q${x + width},${ry} ${x + width},${ry + r} L${x + width},${ry + rh} Z`;
  return <path d={d} fill={fill} />;
}

function WeatherTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey: SpaceWeatherEvent["type"]; value: number }[];
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="chart-tooltip">
      <div className="tooltip-title">{label ? formatShortDay(label) : ""}</div>
      {EVENT_TYPES.map((type) => {
        const entry = payload.find((p) => p.dataKey === type);
        if (!entry || entry.value === 0) return null;
        return (
          <div className="tooltip-row" key={type}>
            <span>
              <span className="type-dot" style={{ background: TYPE_COLOR[type] }} />
              {type}
            </span>
            <strong>{entry.value}</strong>
          </div>
        );
      })}
      {total === 0 && <div className="tooltip-row muted">No events</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline stats
// ---------------------------------------------------------------------------

function buildStats(events: SpaceWeatherEvent[], dailyCounts: DayBucket[]): StatItem[] {
  // Strongest flare in the window.
  let strongest: { event: SpaceWeatherEvent; flare: ParsedFlare } | null = null;
  for (const event of events) {
    if (event.type !== "Solar Flare") continue;
    const flare = parseFlare(event.flareClass);
    if (flare && (!strongest || flare.score > strongest.flare.score)) strongest = { event, flare };
  }

  // Highest Kp in the window.
  let peakStorm: SpaceWeatherEvent | null = null;
  for (const event of events) {
    if (event.type === "Geomagnetic Storm" && event.kp !== undefined) {
      if (!peakStorm || event.kp > (peakStorm.kp as number)) peakStorm = event;
    }
  }

  const counts = { flares: 0, cmes: 0, storms: 0 };
  for (const event of events) {
    if (event.type === "Solar Flare") counts.flares += 1;
    else if (event.type === "CME") counts.cmes += 1;
    else counts.storms += 1;
  }

  const busiest = dailyCounts.reduce(
    (best, day) => {
      const n = day["Solar Flare"] + day.CME + day["Geomagnetic Storm"];
      return n > best.n ? { date: day.date, n } : best;
    },
    { date: "", n: 0 }
  );

  const stats: StatItem[] = [];

  if (strongest) {
    stats.push({
      label: "Strongest flare",
      value: strongest.event.flareClass as string,
      hint: formatDateTime(strongest.event.time),
      tone: severityTone(flareSeverity(strongest.flare.letter)),
    });
  } else {
    stats.push({ label: "Strongest flare", value: "—", hint: "none classified in this window" });
  }

  if (peakStorm) {
    const g = gLevel(peakStorm.kp as number);
    stats.push({
      label: "Peak Kp index",
      value: String(peakStorm.kp),
      hint: g > 0 ? `G${g} · ${G_NAMES[g]} storm` : "below storm level",
      tone: g > 0 ? severityTone(stormSeverity(g)) : "ok",
    });
  } else {
    stats.push({ label: "Peak Kp index", value: "—", hint: "no geomagnetic storms" });
  }

  stats.push({
    label: `Events · ${DAYS} days`,
    value: events.length.toLocaleString(),
    hint: `${counts.flares} flares · ${counts.cmes} CMEs · ${counts.storms} storms`,
    tone: "accent",
  });

  stats.push(
    busiest.n > 0
      ? { label: "Busiest day", value: formatShortDay(busiest.date), hint: `${busiest.n} events` }
      : { label: "Busiest day", value: "—", hint: "no events" }
  );

  return stats;
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function SpaceWeatherSection() {
  const state = useFetch(() => api.getSpaceWeather(DAYS), []);

  const events = useMemo<SpaceWeatherEvent[]>(() => (state.status === "success" ? state.data : []), [state]);

  const dailyCounts = useMemo<DayBucket[]>(() => {
    const days = lastNDays(DAYS);
    const buckets = new Map<string, DayBucket>(
      days.map((date) => [date, { date, "Solar Flare": 0, CME: 0, "Geomagnetic Storm": 0 }])
    );

    for (const event of events) {
      const day = isoDay(new Date(event.time));
      const bucket = buckets.get(day);
      if (bucket) bucket[event.type] += 1;
    }

    return days.map((d) => buckets.get(d)!);
  }, [events]);

  const feed = useMemo<SpaceWeatherEvent[]>(
    () =>
      [...events]
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, MAX_FEED_ITEMS),
    [events]
  );

  const totalEvents = events.length;

  return (
    <section className="section">
      <SectionHead
        title={`Space weather (last ${DAYS} days)`}
        source="NASA · DONKI"
        status={state.status}
        updatedAt={state.status === "success" ? state.updatedAt : undefined}
      />

      {state.status === "loading" && (
        <div className="exoplanets-layout">
          <StatStripSkeleton count={4} />
          <Skeleton height="420px" />
        </div>
      )}
      {state.status === "error" && (
        <p className="error">Couldn't load space weather data: {state.message}</p>
      )}

      {state.status === "success" && (
        <div className="exoplanets-layout">
          <StatStrip items={buildStats(events, dailyCounts)} />

          <div className="wx-main">
            <Panel title="Events by day" meta={`${totalEvents.toLocaleString()} events`}>
              <div className="exo-legend">
                {EVENT_TYPES.map((type) => (
                  <span key={type}>
                    <span className="type-dot" style={{ background: TYPE_COLOR[type] }} />
                    {type}
                  </span>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={dailyCounts} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatShortDay}
                    interval={Math.ceil(DAYS / 10)}
                    tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                    stroke="var(--chart-grid)"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                    stroke="var(--chart-grid)"
                    width={28}
                  />
                  <Tooltip content={<WeatherTooltip />} cursor={{ fill: "var(--border)" }} />
                  <Bar
                    dataKey="Solar Flare"
                    stackId="events"
                    barSize={16}
                    isAnimationActive={false}
                    shape={(p: object) => (
                      <StackSegment {...p} fill={TYPE_COLOR["Solar Flare"]} roundTop={false} />
                    )}
                  />
                  <Bar
                    dataKey="CME"
                    stackId="events"
                    barSize={16}
                    isAnimationActive={false}
                    shape={(p: object) => <StackSegment {...p} fill={TYPE_COLOR.CME} roundTop={false} />}
                  />
                  <Bar
                    dataKey="Geomagnetic Storm"
                    stackId="events"
                    barSize={16}
                    isAnimationActive={false}
                    shape={(p: object) => (
                      <StackSegment {...p} fill={TYPE_COLOR["Geomagnetic Storm"]} roundTop={true} />
                    )}
                  />
                </BarChart>
              </ResponsiveContainer>
              <p className="muted table-note">
                Flares are ranked by X-ray class (A, B, C, M, X — each letter ten times stronger than the
                last). Storm levels follow NOAA's G-scale from the Kp index: Kp 5 is G1 (minor) up to Kp 9
                at G5 (extreme).
              </p>
            </Panel>

            <aside className="wx-side">
              <Panel
                className="wx-feed-panel"
                title="Recent activity"
                meta={totalEvents > MAX_FEED_ITEMS ? `latest ${MAX_FEED_ITEMS} of ${totalEvents}` : undefined}
              >
                <div className="wx-feed-scroll">
                  <ul className="event-feed wx-feed">
                    {feed.map((event: SpaceWeatherEvent) => {
                      const badge = severityBadge(event);
                      return (
                        <li key={event.id} className="event-item">
                          <span className="type-dot" style={{ background: TYPE_COLOR[event.type] }} />
                          <div className="event-item-body">
                            <div className="event-item-headline">{event.headline}</div>
                            <div className="muted event-item-meta">
                              {event.type} · {formatDateTime(event.time)}
                            </div>
                          </div>
                          {badge && (
                            <span className={`sev-badge sev-${badge.severity}`}>{badge.label}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {feed.length === 0 && (
                    <p className="muted">No space weather events in this window.</p>
                  )}
                </div>
              </Panel>
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}