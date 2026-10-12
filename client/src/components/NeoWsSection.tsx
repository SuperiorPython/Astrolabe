import { useMemo, useState } from "react";
import { api, type CloseApproach } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { formatNumber, formatShortDay, kmToLunarDistances, kphToKps } from "../lib/format";
import { Panel } from "./Panel";
import { SectionHead } from "./SectionHead";
import { Skeleton } from "./Skeleton";
import { StatStrip, StatStripSkeleton, type StatItem } from "./StatStrip";

type SortKey = "name" | "date" | "avgDiameterKm" | "velocityKph" | "missDistanceKm";
type SortDir = "asc" | "desc";

interface Row extends CloseApproach {
  avgDiameterKm: number;
  key: string;
}

function toRow(r: CloseApproach): Row {
  return { ...r, avgDiameterKm: (r.diameterKmMin + r.diameterKmMax) / 2, key: `${r.id}-${r.date}` };
}

// ---------------------------------------------------------------------------
// Radar geometry. All numbers are SVG user units in a 600×600 viewBox; the
// SVG scales to its container, so these never need to know the pixel size.
// ---------------------------------------------------------------------------

const SIZE = 600;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 235; // radius of the outermost ring
const EARTH_RADIUS = 14; // the drawn Earth (not to scale — it couldn't be seen)
const MIN_LD = 0.02; // log-scale floor; anything closer is pinned to the inner edge
const MIN_RING_LD = 10; // always draw at least out to 10 LD

interface Placed {
  row: Row;
  x: number;
  y: number;
  dotRadius: number;
}

/**
 * Distance → radius. Miss distances span three orders of magnitude (a few
 * hundredths of a lunar distance to dozens), so a linear scale would crush
 * everything interesting into the middle. Log scale from MIN_LD out to the
 * outer ring.
 */
function distanceToRadius(ld: number, outerLd: number): number {
  const lo = Math.log10(MIN_LD);
  const hi = Math.log10(outerLd);
  const t = Math.min(1, Math.max(0, (Math.log10(Math.max(ld, MIN_LD)) - lo) / (hi - lo)));
  return EARTH_RADIUS + t * (OUTER_RADIUS - EARTH_RADIUS);
}

/** Diameter → dot radius, also on a log scale (a few metres up to a few km). */
function diameterToDotRadius(km: number): number {
  const t = (Math.log10(Math.max(km, 0.001)) + 3) / 3.7; // 1 m → 0, ~5 km → 1
  return 3 + Math.min(1, Math.max(0, t)) * 8;
}

function polar(radius: number, degreesClockwiseFromTop: number): { x: number; y: number } {
  const rad = (degreesClockwiseFromTop * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) };
}

function ringLabel(ld: number): string {
  return ld === 1 ? "1 LD · Moon's orbit" : `${ld.toLocaleString()} LD`;
}

interface RadarProps {
  rows: Row[];
  activeKey: string | null;
  onActive: (key: string | null) => void;
}

function Radar({ rows, activeKey, onActive }: RadarProps) {
  const { placed, days, rings, outerLd } = useMemo(() => {
    const maxLd = Math.max(...rows.map((r) => kmToLunarDistances(r.missDistanceKm)), MIN_RING_LD);
    // Round the outer ring up to the next power of ten so rings fall on 1, 10, 100…
    const outerLd = 10 ** Math.ceil(Math.log10(maxLd));
    const rings: number[] = [];
    for (let ld = 1; ld <= outerLd; ld *= 10) rings.push(ld);

    // One angular sector per approach day, in date order, clockwise from the top.
    const days = [...new Set(rows.map((r) => r.date))].sort();
    const sector = 360 / Math.max(days.length, 1);

    const placed: Placed[] = [];
    days.forEach((day, dayIndex) => {
      const group = rows
        .filter((r) => r.date === day)
        .sort((a, b) => a.missDistanceKm - b.missDistanceKm);
      group.forEach((row, j) => {
        // Spread the day's objects evenly inside its sector so they don't stack.
        const angle = (dayIndex + (j + 1) / (group.length + 1)) * sector;
        const { x, y } = polar(distanceToRadius(kmToLunarDistances(row.missDistanceKm), outerLd), angle);
        placed.push({ row, x, y, dotRadius: diameterToDotRadius(row.avgDiameterKm) });
      });
    });

    return { placed, days, rings, outerLd };
  }, [rows]);

  const sector = 360 / Math.max(days.length, 1);
  const active = placed.find((p) => p.row.key === activeKey) ?? null;

  return (
    <div className="neo-radar-wrap">
      <svg
        className="neo-radar"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Radar of near-Earth object close approaches: distance from Earth, one sector per day"
      >
        <defs>
          <radialGradient id="neo-earth-fill" cx="35%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#5aa0ee" />
            <stop offset="100%" stopColor="#1b4a86" />
          </radialGradient>
        </defs>

        {/* Day dividers */}
        {days.map((day, i) => {
          const edge = polar(OUTER_RADIUS, i * sector);
          return <line key={day} className="neo-spoke" x1={CENTER} y1={CENTER} x2={edge.x} y2={edge.y} />;
        })}

        {/* Distance rings */}
        {rings.map((ld) => {
          const r = distanceToRadius(ld, outerLd);
          return (
            <g key={ld}>
              <circle className={ld === 1 ? "neo-ring neo-ring-moon" : "neo-ring"} cx={CENTER} cy={CENTER} r={r} />
              <text className={ld === 1 ? "neo-ring-label neo-ring-label-moon" : "neo-ring-label"} x={CENTER + 6} y={CENTER - r - 5}>
                {ringLabel(ld)}
              </text>
            </g>
          );
        })}

        {/* Day labels, centred on each sector just outside the outer ring */}
        {days.map((day, i) => {
          const { x, y } = polar(OUTER_RADIUS + 16, (i + 0.5) * sector);
          const anchor = x > CENTER + 10 ? "start" : x < CENTER - 10 ? "end" : "middle";
          return (
            <text key={day} className="neo-day-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">
              {formatShortDay(day)}
            </text>
          );
        })}

        {/* Earth */}
        <circle className="neo-earth" cx={CENTER} cy={CENTER} r={EARTH_RADIUS} fill="url(#neo-earth-fill)" />

        {/* Objects */}
        {placed.map(({ row, x, y, dotRadius }) => {
          const isActive = row.key === activeKey;
          return (
            <g
              key={row.key}
              className={`neo-object${isActive ? " neo-object-active" : ""}`}
              tabIndex={0}
              onMouseEnter={() => onActive(row.key)}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(row.key)}
              onBlur={() => onActive(null)}
            >
              <title>{row.name}</title>
              <circle cx={x} cy={y} r={Math.max(dotRadius + 6, 11)} fill="transparent" />
              {row.isHazardous && <circle className="neo-halo" cx={x} cy={y} r={dotRadius + 4} />}
              <circle
                className={row.isHazardous ? "neo-dot neo-dot-hazardous" : "neo-dot"}
                cx={x}
                cy={y}
                r={dotRadius}
              />
            </g>
          );
        })}
      </svg>

      {active && (
        <div
          className="chart-tooltip neo-tooltip"
          style={{
            left: `${Math.min(82, Math.max(18, (active.x / SIZE) * 100))}%`,
            top: `${(active.y / SIZE) * 100}%`,
            transform: active.y / SIZE < 0.3 ? "translate(-50%, 16px)" : "translate(-50%, calc(-100% - 16px))",
          }}
        >
          <div className="tooltip-title">
            {active.row.isHazardous && <span className="type-dot" style={{ background: "var(--status-critical)" }} />}
            {active.row.name}
          </div>
          <div className="tooltip-row">
            <span>Close approach</span>
            <strong>{active.row.date}</strong>
          </div>
          <div className="tooltip-row">
            <span>Diameter</span>
            <strong>
              {formatNumber(active.row.diameterKmMin, 2)}–{formatNumber(active.row.diameterKmMax, 2)} km
            </strong>
          </div>
          <div className="tooltip-row">
            <span>Velocity</span>
            <strong>{formatNumber(kphToKps(active.row.velocityKph), 1)} km/s</strong>
          </div>
          <div className="tooltip-row">
            <span>Miss distance</span>
            <strong>{formatNumber(kmToLunarDistances(active.row.missDistanceKm), 2)} LD</strong>
          </div>
          <div className="tooltip-row">
            <span />
            <strong>{formatNumber(active.row.missDistanceKm, 0)} km</strong>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact, scrollable list in the side column: closest passes first. */
function ApproachList({ rows, activeKey, onActive }: RadarProps) {
  const byDistance = useMemo(() => [...rows].sort((a, b) => a.missDistanceKm - b.missDistanceKm), [rows]);
  return (
    <ul className="neo-list">
      {byDistance.map((r) => (
        <li
          key={r.key}
          className={r.key === activeKey ? "neo-list-item row-active" : "neo-list-item"}
          onMouseEnter={() => onActive(r.key)}
          onMouseLeave={() => onActive(null)}
        >
          <span
            className="type-dot"
            style={{ background: r.isHazardous ? "var(--status-critical)" : "var(--dot-muted)" }}
          />
          <span className="neo-list-name">{r.name}</span>
          <span className="neo-list-meta muted">
            {formatShortDay(r.date)} · {formatNumber(kmToLunarDistances(r.missDistanceKm), 2)} LD
          </span>
        </li>
      ))}
    </ul>
  );
}

function buildStats(rows: Row[]): StatItem[] {
  const hazardous = rows.filter((r) => r.isHazardous);
  const insideMoon = rows.filter((r) => kmToLunarDistances(r.missDistanceKm) < 1).length;
  const closest = rows.reduce((a, b) => (b.missDistanceKm < a.missDistanceKm ? b : a));
  const largest = rows.reduce((a, b) => (b.avgDiameterKm > a.avgDiameterKm ? b : a));

  return [
    {
      label: "Close approaches",
      value: rows.length.toLocaleString(),
      hint: `${insideMoon} inside the Moon's orbit`,
      tone: "accent",
    },
    {
      label: "Potentially hazardous",
      value: hazardous.length.toLocaleString(),
      hint: "NASA's classification",
      tone: hazardous.length > 0 ? "critical" : "default",
    },
    {
      label: "Closest pass",
      value: `${formatNumber(kmToLunarDistances(closest.missDistanceKm), 2)} LD`,
      hint: `${closest.name} · ${formatNumber(closest.missDistanceKm, 0)} km`,
    },
    {
      label: "Largest object",
      value: `${formatNumber(largest.avgDiameterKm, largest.avgDiameterKm < 0.1 ? 3 : 2)} km`,
      hint: largest.name,
    },
  ];
}

export function NeoWsSection() {
  const state = useFetch(() => api.getNearEarthObjects(), []);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const rows = useMemo(() => (state.status === "success" ? state.data.map(toRow) : []), [state]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return cmp * (sortDir === "asc" ? 1 : -1);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <section className="section">
      <SectionHead
        title="Near-Earth objects (next 7 days)"
        source="NASA · NeoWs"
        status={state.status}
        updatedAt={state.status === "success" ? state.updatedAt : undefined}
      />

      {state.status === "loading" && (
        <div className="exoplanets-layout">
          <StatStripSkeleton count={4} />
          <Skeleton height="520px" />
        </div>
      )}
      {state.status === "error" && (
        <p className="error">Couldn't load near-Earth object data: {state.message}</p>
      )}

      {state.status === "success" && rows.length === 0 && (
        <p className="muted">NASA lists no close approaches for the next 7 days.</p>
      )}

      {state.status === "success" && rows.length > 0 && (
        <div className="exoplanets-layout">
          <div className="neo-main">
            <Panel title="Approach radar" meta="distance from Earth · log scale">
              <Radar rows={rows} activeKey={activeKey} onActive={setActiveKey} />
              <div className="neo-legend muted">
                <span>
                  <span className="type-dot" style={{ background: "var(--status-critical)" }} />
                  Potentially hazardous
                </span>
                <span>
                  <span className="type-dot" style={{ background: "var(--dot-muted)" }} />
                  Other
                </span>
                <span>Dot size = estimated diameter</span>
                <span>Distance from centre = miss distance (LD = lunar distances)</span>
              </div>
              <p className="muted table-note">
                Each wedge is one approach day, running clockwise from the top. Direction in the sky isn't
                part of NASA's data, so the angle within a day is just spacing to keep dots apart; Earth is
                drawn far larger than to scale.
              </p>
            </Panel>

            <aside className="neo-side">
              <div className="neo-side-inner">
                <div className="neo-side-stats">
                  <StatStrip items={buildStats(rows)} />
                </div>
                <Panel className="neo-list-panel" title="By distance" meta="closest first">
                  <div className="neo-list-scroll">
                    <ApproachList rows={rows} activeKey={activeKey} onActive={setActiveKey} />
                  </div>
                </Panel>
              </div>
            </aside>
          </div>

          <Panel title="All approaches" meta={`${rows.length.toLocaleString()} objects`}>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("name")}>Object{sortIndicator("name")}</th>
                    <th onClick={() => toggleSort("date")}>Approach date{sortIndicator("date")}</th>
                    <th>Hazardous</th>
                    <th className="numeric" onClick={() => toggleSort("avgDiameterKm")}>
                      Diameter (km){sortIndicator("avgDiameterKm")}
                    </th>
                    <th className="numeric" onClick={() => toggleSort("velocityKph")}>
                      Velocity (km/s){sortIndicator("velocityKph")}
                    </th>
                    <th className="numeric" onClick={() => toggleSort("missDistanceKm")}>
                      Miss distance (LD){sortIndicator("missDistanceKm")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr
                      key={r.key}
                      className={r.key === activeKey ? "row-active" : undefined}
                      onMouseEnter={() => setActiveKey(r.key)}
                      onMouseLeave={() => setActiveKey(null)}
                    >
                      <td>{r.name}</td>
                      <td>{r.date}</td>
                      <td>
                        {r.isHazardous ? (
                          <>
                            <span className="type-dot" style={{ background: "var(--status-critical)" }} />
                            Yes
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="numeric">
                        {formatNumber(r.diameterKmMin, 2)}–{formatNumber(r.diameterKmMax, 2)}
                      </td>
                      <td className="numeric">{formatNumber(kphToKps(r.velocityKph), 1)}</td>
                      <td className="numeric">{formatNumber(kmToLunarDistances(r.missDistanceKm), 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}