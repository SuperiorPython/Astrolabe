import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { api, type IssPosition, type IssVisibility } from "../lib/api";
import { Panel } from "./Panel";
import { SectionHead } from "./SectionHead";
import { Skeleton } from "./Skeleton";
import { StatStrip, StatStripSkeleton, type StatItem } from "./StatStrip";

const POLL_MS = 30 * 1000;
// 120 points at 30s apart is a one-hour trail — about two-thirds of an orbit.
const MAX_TRAIL_POINTS = 120;
const EARTH_RADIUS_KM = 6371;

// The leaflet SVG layers take plain colour strings; this is the fixed
// dataviz "series 1" blue (same value as --series-1 in index.css).
const SERIES_1 = "#3987e5";

type Point = [number, number];

type TrackState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      position: IssPosition;
      trail: Point[];
      updatedAt: number;
      /** Set when the latest refresh failed but an earlier reading is still on screen. */
      refreshError?: string;
    };

// A DivIcon sidesteps the well-known Leaflet + bundler problem where the
// default marker image paths don't resolve after bundling — no image
// imports to get wrong, just a styled element.
const issIcon = L.divIcon({
  className: "iss-marker",
  html: '<span class="iss-marker-dot"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function formatCoord(value: number, positiveSuffix: string, negativeSuffix: string): string {
  const suffix = value >= 0 ? positiveSuffix : negativeSuffix;
  return `${Math.abs(value).toFixed(2)}° ${suffix}`;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Distance from the point directly below the ISS to the horizon, in km.
 * From the right triangle (Earth centre → horizon point → satellite):
 * cos(θ) = R / (R + h), and the ground distance is R·θ. At ~420 km this
 * comes to roughly 2,240 km — the radius of the "can see the ISS" circle.
 * Computed here from altitude (rather than read from the upstream's own
 * footprint field) so the circle doesn't depend on that field's definition.
 */
function horizonRadiusKm(altitudeKm: number): number {
  return EARTH_RADIUS_KM * Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm));
}

/**
 * Splits the trail wherever it crosses the ±180° meridian. A flat map draws
 * a straight line between consecutive points, so without this the ISS
 * "wrapping" from 179°E to 179°W would streak a line across the entire map.
 */
function splitAtAntimeridian(points: Point[]): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && Math.abs(point[1] - previous[1]) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function lightingStat(visibility: IssVisibility | undefined): Pick<StatItem, "value" | "hint" | "tone"> {
  switch (visibility) {
    case "daylight":
      return { value: "Daylight", hint: "sunlit, day below" };
    case "visible":
      return { value: "Visible", hint: "sunlit, dark below", tone: "ok" };
    case "eclipsed":
      return { value: "Eclipse", hint: "in Earth's shadow" };
    default:
      return { value: "—", hint: "not in backup source" };
  }
}

/** Pans the map to follow the ISS as new positions come in, without fighting the user's own zoom. */
function FollowMarker({ position }: { position: Point }) {
  const map = useMap();
  useEffect(() => {
    map.panTo(position, { animate: true, duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1]]);
  return null;
}

export function IssSection() {
  const [state, setState] = useState<TrackState>({ status: "loading" });
  const trailRef = useRef<Point[]>([]);
  const lastTimestampRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const position = await api.getIssPosition();
        if (cancelled) return;

        if (position.timestamp !== lastTimestampRef.current) {
          const previousTimestamp = lastTimestampRef.current;
          lastTimestampRef.current = position.timestamp;
          const newPoint: Point = [position.latitude, position.longitude];

          // A backgrounded tab (or a sleeping laptop) can stall this interval
          // for far longer than POLL_MS — browsers throttle or fully pause
          // timers in hidden tabs. The ISS completes an orbit every ~92 min,
          // so a stale-enough gap means the next reading could be almost
          // anywhere on Earth. Connecting it to the old trail with a straight
          // line draws a chord across the whole map instead of a flight path.
          // Starting a fresh trail on a big gap keeps the line meaningful.
          const gapSeconds = previousTimestamp === null ? 0 : position.timestamp - previousTimestamp;
          const gapTooLarge = gapSeconds > (POLL_MS / 1000) * 3;

          trailRef.current = gapTooLarge
            ? [newPoint]
            : [...trailRef.current, newPoint].slice(-MAX_TRAIL_POINTS);
        }

        setState({ status: "success", position, trail: trailRef.current, updatedAt: Date.now() });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Something went wrong.";
        // If a reading is already on screen, keep showing it (with a warning)
        // rather than blanking the whole map over one failed refresh.
        setState((prev) =>
          prev.status === "success" ? { ...prev, refreshError: message } : { status: "error", message }
        );
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const success = state.status === "success" ? state : null;
  const position = success?.position;

  const stats: StatItem[] = position
    ? [
        {
          label: "Altitude",
          value:
            position.altitudeKm !== undefined ? `${Math.round(position.altitudeKm).toLocaleString()} km` : "—",
          hint: position.altitudeKm !== undefined ? "above Earth" : "not in backup source",
          tone: "accent",
        },
        {
          label: "Velocity",
          value:
            position.velocityKph !== undefined
              ? `${Math.round(position.velocityKph).toLocaleString()} km/h`
              : "—",
          hint:
            position.velocityKph !== undefined
              ? `${(position.velocityKph / 3600).toFixed(2)} km/s`
              : "not in backup source",
          tone: "accent",
        },
        { label: "Lighting", ...lightingStat(position.visibility) },
        { label: "Latitude", value: formatCoord(position.latitude, "N", "S") },
        { label: "Longitude", value: formatCoord(position.longitude, "E", "W") },
      ]
    : [];

  const segments = success ? splitAtAntimeridian(success.trail) : [];
  const center: Point | null = position ? [position.latitude, position.longitude] : null;
  const horizonKm = position?.altitudeKm !== undefined ? horizonRadiusKm(position.altitudeKm) : null;

  return (
    <section className="section">
      <SectionHead
        title="ISS tracker"
        source="wheretheiss.at"
        status={state.status}
        updatedAt={success?.updatedAt}
      />

      {state.status === "loading" && (
        <div className="iss-layout">
          <StatStripSkeleton count={5} />
          <Skeleton height="420px" />
        </div>
      )}

      {state.status === "error" && (
        <p className="error">Couldn't load the ISS position: {state.message}</p>
      )}

      {success && center && (
        <div className="iss-layout">
          {success.refreshError && (
            <p className="error iss-refresh-warning">
              Couldn't refresh ({success.refreshError}) — showing the reading from{" "}
              {formatClock(success.updatedAt)}.
            </p>
          )}

          <StatStrip items={stats} />

          <Panel className="iss-map-panel">
            <div className="iss-map-wrap">
              <MapContainer
                center={center}
                zoom={3}
                scrollWheelZoom={false}
                style={{ height: "100%", width: "100%" }}
                attributionControl={true}
              >
                <TileLayer
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                {horizonKm !== null && (
                  <Circle
                    center={center}
                    radius={horizonKm * 1000}
                    pathOptions={{
                      color: SERIES_1,
                      weight: 1,
                      dashArray: "4 6",
                      opacity: 0.8,
                      fillColor: SERIES_1,
                      fillOpacity: 0.07,
                    }}
                  />
                )}
                {segments.some((s) => s.length > 1) && (
                  <Polyline
                    positions={segments}
                    pathOptions={{ color: SERIES_1, weight: 2, opacity: 0.6 }}
                  />
                )}
                <Marker position={center} icon={issIcon} />
                <FollowMarker position={center} />
              </MapContainer>
            </div>
          </Panel>

          <p className="muted table-note">
            Refreshes every 30 seconds. The trail is the last hour of positions received this session.
            {horizonKm !== null &&
              ` The dashed circle is everywhere on Earth with a clear line of sight to the ISS (about ${Math.round(
                horizonKm
              ).toLocaleString()} km radius at this altitude).`}
          </p>
        </div>
      )}
    </section>
  );
}