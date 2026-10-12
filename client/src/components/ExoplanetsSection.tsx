import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type ExoplanetRow, type ExoplanetSummary } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { formatNumber, parsecsToLightYears } from "../lib/format";
import { Panel } from "./Panel";
import { SectionHead } from "./SectionHead";
import { Skeleton } from "./Skeleton";
import { StatStrip, StatStripSkeleton, type StatItem } from "./StatStrip";

type SortKey = "pl_name" | "hostname" | "disc_year" | "pl_rade" | "pl_bmasse" | "lightYears";
type SortDir = "asc" | "desc";

interface Row extends ExoplanetRow {
  lightYears: number | null;
}

const MAX_TABLE_ROWS = 200;

function toRow(r: ExoplanetRow): Row {
  return { ...r, lightYears: r.sy_dist !== null ? parsecsToLightYears(r.sy_dist) : null };
}

// ---------------------------------------------------------------------------
// Discoveries per year, stacked by detection method
// ---------------------------------------------------------------------------

/**
 * Three categorical colours are all the validated palette offers, so the
 * three most productive methods get them and everything else is pooled into
 * a de-emphasised gray "Other" (same rule as the other charts: gray recedes).
 */
const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const OTHER_COLOR = "var(--dot-muted)";

interface Series {
  key: string; // dataKey in the chart rows: s0, s1, s2, other
  label: string;
  color: string;
}

interface YearRow {
  year: number;
  total: number;
  [seriesKey: string]: number;
}

function buildTimeline(summary: ExoplanetSummary): { rows: YearRow[]; series: Series[] } {
  const methodTotals = new Map<string, number>();
  for (const r of summary.byYearMethod) {
    methodTotals.set(r.method, (methodTotals.get(r.method) ?? 0) + r.count);
  }
  const top = [...methodTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);

  const series: Series[] = top.map((method, i) => ({
    key: `s${i}`,
    label: method,
    color: SERIES_COLORS[i],
  }));
  const hasOther = methodTotals.size > top.length;
  if (hasOther) series.push({ key: "other", label: "Other methods", color: OTHER_COLOR });

  const years = summary.byYearMethod.map((r) => r.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const byYear = new Map<number, YearRow>();
  for (let y = minYear; y <= maxYear; y++) {
    const row: YearRow = { year: y, total: 0 };
    for (const s of series) row[s.key] = 0;
    byYear.set(y, row);
  }
  for (const r of summary.byYearMethod) {
    const row = byYear.get(r.year);
    if (!row) continue;
    const idx = top.indexOf(r.method);
    const key = idx >= 0 ? `s${idx}` : "other";
    row[key] += r.count;
    row.total += r.count;
  }
  return { rows: [...byYear.values()], series };
}

function TimelineTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: { payload: YearRow }[];
  series: Series[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-title">
        {row.year} · {row.total.toLocaleString()} planets
      </div>
      {series
        .filter((s) => row[s.key] > 0)
        .map((s) => (
          <div key={s.key} className="tooltip-row">
            <span>
              <span className="type-dot" style={{ background: s.color }} />
              {s.label}
            </span>
            <strong>{row[s.key].toLocaleString()}</strong>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Size comparison strip
// ---------------------------------------------------------------------------

const JUPITER_RADIUS_E = 11.21; // Jupiter's mean radius in Earth radii
const NEPTUNE_RADIUS_E = 3.88;
const JUPITER_PX = 36; // drawn radius of Jupiter; everything else is scaled from this
const MAX_DRAWN_PX = JUPITER_PX * 3; // anything bigger is drawn at this size and labelled
const MIN_DRAWN_PX = 1.5;
const MIN_SLOT = 130;

interface SizeItem {
  key: string;
  name: string;
  radiusE: number;
  kind: "reference" | "planet";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function SizeStrip({ items }: { items: SizeItem[] }) {
  const layout = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.radiusE - b.radiusE);
    let x = 0;
    const placed = sorted.map((item) => {
      const trueRadius = (item.radiusE / JUPITER_RADIUS_E) * JUPITER_PX;
      const capped = trueRadius > MAX_DRAWN_PX;
      const radius = Math.min(MAX_DRAWN_PX, Math.max(MIN_DRAWN_PX, trueRadius));
      const slot = Math.max(MIN_SLOT, radius * 2 + 24);
      const cx = x + slot / 2;
      x += slot;
      return { item, radius, capped, cx };
    });
    return { placed, width: x };
  }, [items]);

  const baseline = MAX_DRAWN_PX * 2 + 12;
  const height = baseline + 62;

  return (
    <svg
      className="size-strip"
      viewBox={`0 0 ${layout.width} ${height}`}
      role="img"
      aria-label="Planet sizes compared with Earth, Neptune and Jupiter"
    >
      <line className="size-baseline" x1={0} y1={baseline} x2={layout.width} y2={baseline} />
      {layout.placed.map(({ item, radius, capped, cx }) => {
        const cy = baseline - radius;
        const ratioJupiter = item.radiusE / JUPITER_RADIUS_E;
        return (
          <g key={item.key}>
            <circle
              className={`size-body size-body-${item.kind}${capped ? " size-body-capped" : ""}`}
              cx={cx}
              cy={cy}
              r={radius}
            />
            <text className="size-name" x={cx} y={baseline + 18} textAnchor="middle">
              {truncate(item.name, 18)}
            </text>
            <text className="size-radius" x={cx} y={baseline + 34} textAnchor="middle">
              {formatNumber(item.radiusE, item.radiusE < 10 ? 2 : 1)} R⊕
            </text>
            {capped && (
              <text className="size-note" x={cx} y={baseline + 50} textAnchor="middle">
                {formatNumber(ratioJupiter, 1)}× Jupiter · drawn smaller
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Highlight cards
// ---------------------------------------------------------------------------

function HighlightCard({
  kicker,
  planet,
  value,
  hint,
}: {
  kicker: string;
  planet: ExoplanetRow;
  value: string;
  hint: string;
}) {
  return (
    <Panel className="exo-highlight">
      <div className="exo-highlight-kicker muted">{kicker}</div>
      <div className="exo-highlight-name">{planet.pl_name}</div>
      <div className="exo-highlight-host muted">orbits {planet.hostname}</div>
      <div className="exo-highlight-value">{value}</div>
      <div className="exo-highlight-hint muted">{hint}</div>
      <div className="exo-highlight-foot muted">
        Discovered {planet.disc_year ?? "—"}
        {planet.discoverymethod ? ` · ${planet.discoverymethod}` : ""}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Scatter (unchanged in substance)
// ---------------------------------------------------------------------------

/**
 * Distance vs. radius carries the "does this planet's size correlate with
 * how far away we found it" story better as a scatter than a table alone —
 * but the table stays, since a scatter can show the shape of the data while
 * hiding exactly which planet is which.
 */
function ExoplanetTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <div className="tooltip-title">{row.pl_name}</div>
      <div className="tooltip-row">
        <span>Host star</span>
        <strong>{row.hostname}</strong>
      </div>
      <div className="tooltip-row">
        <span>Distance</span>
        <strong>{formatNumber(row.lightYears, 0)} ly</strong>
      </div>
      <div className="tooltip-row">
        <span>Radius</span>
        <strong>{formatNumber(row.pl_rade)} R⊕</strong>
      </div>
      <div className="tooltip-row">
        <span>Mass</span>
        <strong>{row.pl_bmasse !== null ? `${formatNumber(row.pl_bmasse)} M⊕` : "—"}</strong>
      </div>
      <div className="tooltip-row">
        <span>Discovered</span>
        <strong>
          {row.disc_year ?? "—"}
          {row.discoverymethod ? ` · ${row.discoverymethod}` : ""}
        </strong>
      </div>
    </div>
  );
}

/**
 * A plain 5px dot is a pinpoint nobody can reliably hover in a dense
 * scatter, so each point renders with an invisible 12px-radius hit area
 * around the visible mark (see dataviz skill, interaction.md) rather than
 * relying on landing dead-center.
 */
function ScatterDot(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx === undefined || cy === undefined) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="var(--series-1)"
        stroke="var(--chart-surface)"
        strokeWidth={2}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function buildStats(summary: ExoplanetSummary): StatItem[] {
  const latestYear = Math.max(...summary.byYearMethod.map((r) => r.year));
  const latestCount = summary.byYearMethod
    .filter((r) => r.year === latestYear)
    .reduce((sum, r) => sum + r.count, 0);

  const methodTotals = new Map<string, number>();
  for (const r of summary.byYearMethod) {
    methodTotals.set(r.method, (methodTotals.get(r.method) ?? 0) + r.count);
  }
  const [topMethod, topCount] = [...methodTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  const items: StatItem[] = [
    { label: "Confirmed planets", value: summary.total.toLocaleString(), hint: "NASA Exoplanet Archive", tone: "accent" },
    { label: `Found in ${latestYear}`, value: latestCount.toLocaleString(), hint: "most recent year in the archive" },
    {
      label: "Top method",
      value: topMethod,
      hint: `${formatNumber((topCount / summary.total) * 100, 0)}% of all discoveries`,
    },
  ];
  if (summary.closest?.sy_dist != null) {
    items.push({
      label: "Closest known",
      value: `${formatNumber(parsecsToLightYears(summary.closest.sy_dist), 1)} ly`,
      hint: summary.closest.pl_name,
    });
  }
  return items;
}

export function ExoplanetsSection() {
  const state = useFetch(() => api.getExoplanets(), []);
  // The whole-catalog summary is a separate request so a failure there only
  // hides the new panels; the scatter and table still work from `state`.
  const summaryState = useFetch(() => api.getExoplanetSummary(), []);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("disc_year");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(
    () => (state.status === "success" ? state.data.map(toRow) : []),
    [state]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) => r.pl_name.toLowerCase().includes(term) || r.hostname.toLowerCase().includes(term)
    );
  }, [rows, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * (sortDir === "asc" ? 1 : -1);
      }
      return (Number(av) - Number(bv)) * (sortDir === "asc" ? 1 : -1);
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const visibleRows = sorted.slice(0, MAX_TABLE_ROWS);

  const summary = summaryState.status === "success" ? summaryState.data : null;
  const timeline = useMemo(() => (summary ? buildTimeline(summary) : null), [summary]);

  const sizeItems = useMemo<SizeItem[]>(() => {
    const items: SizeItem[] = [
      { key: "ref-earth", name: "Earth", radiusE: 1, kind: "reference" },
      { key: "ref-neptune", name: "Neptune", radiusE: NEPTUNE_RADIUS_E, kind: "reference" },
      { key: "ref-jupiter", name: "Jupiter", radiusE: JUPITER_RADIUS_E, kind: "reference" },
    ];
    const seen = new Set<string>();
    for (const planet of [summary?.smallest, summary?.closest, summary?.largest]) {
      if (!planet || planet.pl_rade === null || seen.has(planet.pl_name)) continue;
      seen.add(planet.pl_name);
      items.push({ key: `planet-${planet.pl_name}`, name: planet.pl_name, radiusE: planet.pl_rade, kind: "planet" });
    }
    return items;
  }, [summary]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  const { closest, largest, smallest } = summary ?? { closest: null, largest: null, smallest: null };
  const hasHighlights = Boolean(summary && (closest || largest || smallest));

  return (
    <section className="section">
      <SectionHead
        title="Exoplanets"
        source="NASA Exoplanet Archive"
        status={state.status}
        updatedAt={state.status === "success" ? state.updatedAt : undefined}
        liveLabel="CATALOG"
      />

      {state.status === "loading" && (
        <div className="exoplanets-layout">
          <StatStripSkeleton count={4} />
          <Skeleton height="300px" />
          <Skeleton height="360px" />
        </div>
      )}
      {state.status === "error" && (
        <p className="error">Couldn't load exoplanet data: {state.message}</p>
      )}

      {state.status === "success" && (
        <div className="exoplanets-layout">
          {summaryState.status === "loading" && <StatStripSkeleton count={4} />}
          {summary && <StatStrip items={buildStats(summary)} />}
          {summaryState.status === "error" && (
            <p className="muted table-note">
              Whole-catalog totals are unavailable right now ({summaryState.message}); the chart and table
              below still work.
            </p>
          )}

          {(timeline || hasHighlights) && (
            <div className={`exo-top${timeline && hasHighlights ? "" : " exo-top-single"}`}>
              {timeline && (
                <Panel title="Discoveries per year" meta="whole catalog · by detection method">
                  <div className="exo-legend">
                    {timeline.series.map((s) => (
                      <span key={s.key}>
                        <span className="type-dot" style={{ background: s.color }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={timeline.rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="year"
                        tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                        stroke="var(--chart-grid)"
                        minTickGap={16}
                      />
                      <YAxis
                        tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                        stroke="var(--chart-grid)"
                        width={44}
                      />
                      <Tooltip
                        content={<TimelineTooltip series={timeline.series} />}
                        cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.35 }}
                      />
                      {timeline.series.map((s) => (
                        <Bar key={s.key} dataKey={s.key} stackId="discoveries" fill={s.color} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>
              )}

              {hasHighlights && (
                <div className="exo-highlights">
                  {closest && closest.sy_dist !== null && (
                    <HighlightCard
                      kicker="Closest"
                      planet={closest}
                      value={`${formatNumber(parsecsToLightYears(closest.sy_dist), 2)} ly`}
                      hint={closest.pl_rade !== null ? `${formatNumber(closest.pl_rade, 2)} R⊕ across` : "radius not measured"}
                    />
                  )}
                  {largest && largest.pl_rade !== null && (
                    <HighlightCard
                      kicker="Largest"
                      planet={largest}
                      value={`${formatNumber(largest.pl_rade, 1)} R⊕`}
                      hint={`${formatNumber(largest.pl_rade / JUPITER_RADIUS_E, 1)}× Jupiter's radius`}
                    />
                  )}
                  {smallest && smallest.pl_rade !== null && (
                    <HighlightCard
                      kicker="Smallest"
                      planet={smallest}
                      value={`${formatNumber(smallest.pl_rade, 2)} R⊕`}
                      hint={`about ${Math.round(smallest.pl_rade * 100)}% of Earth's width`}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {summary && sizeItems.length > 3 && (
            <Panel title="Size comparison" meta="radius, to scale (up to 3× Jupiter)">
              <SizeStrip items={sizeItems} />
            </Panel>
          )}

          <div className="exo-bottom">
            <Panel
              title="Distance vs. radius"
              meta={`${filtered.length.toLocaleString()} of the 1,000 most recent discoveries`}
            >
              <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="lightYears"
                    type="number"
                    scale="log"
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                    stroke="var(--chart-grid)"
                    label={{
                      value: "Distance from Earth (light-years, log scale)",
                      position: "insideBottom",
                      offset: -12,
                      fill: "var(--chart-axis)",
                      fontSize: 12,
                    }}
                  />
                  <YAxis
                    dataKey="pl_rade"
                    type="number"
                    scale="log"
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                    stroke="var(--chart-grid)"
                    label={{
                      value: "Radius (Earth radii, log scale)",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--chart-axis)",
                      fontSize: 12,
                    }}
                  />
                  <Tooltip content={<ExoplanetTooltip />} cursor={{ stroke: "var(--chart-grid)" }} />
                  <Scatter data={filtered} shape={<ScatterDot />} isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Planet catalog" meta="1,000 most recent discoveries">
              <div className="table-controls">
                <input
                  type="search"
                  placeholder="Filter by planet or host star…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="data-table-wrap exo-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort("pl_name")}>Planet{sortIndicator("pl_name")}</th>
                      <th onClick={() => toggleSort("hostname")}>
                        Host star{sortIndicator("hostname")}
                      </th>
                      <th onClick={() => toggleSort("disc_year")}>
                        Discovered{sortIndicator("disc_year")}
                      </th>
                      <th>Method</th>
                      <th className="numeric" onClick={() => toggleSort("pl_rade")}>
                        Radius (R⊕){sortIndicator("pl_rade")}
                      </th>
                      <th className="numeric" onClick={() => toggleSort("pl_bmasse")}>
                        Mass (M⊕){sortIndicator("pl_bmasse")}
                      </th>
                      <th className="numeric" onClick={() => toggleSort("lightYears")}>
                        Distance (ly){sortIndicator("lightYears")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.pl_name}>
                        <td>{r.pl_name}</td>
                        <td>{r.hostname}</td>
                        <td>{r.disc_year ?? "—"}</td>
                        <td>{r.discoverymethod ?? "—"}</td>
                        <td className="numeric">{formatNumber(r.pl_rade)}</td>
                        <td className="numeric">{formatNumber(r.pl_bmasse)}</td>
                        <td className="numeric">{formatNumber(r.lightYears, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted table-note">
                Showing {visibleRows.length.toLocaleString()} of {sorted.length.toLocaleString()}{" "}
                matching planets
                {sorted.length > MAX_TABLE_ROWS ? " — narrow your search to see more" : ""}.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </section>
  );
}