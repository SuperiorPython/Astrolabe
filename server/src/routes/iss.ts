import { Router } from "express";
import { cached, TTL } from "../lib/cache.js";

export const issRouter = Router();

export type IssVisibility = "daylight" | "visible" | "eclipsed";

export interface IssPosition {
  latitude: number;
  longitude: number;
  timestamp: number; // unix seconds
  /** Orbital altitude in km. Only present when the telemetry source answered. */
  altitudeKm?: number;
  /** Speed in km/h. Only present when the telemetry source answered. */
  velocityKph?: number;
  /**
   * wheretheiss.at's lighting state: "eclipsed" = in Earth's shadow,
   * "daylight" = sunlit with daylight on the ground below, "visible" = sunlit
   * while the ground below is dark (the case where it can be seen).
   */
  visibility?: IssVisibility;
}

// Netlify's default function limit is ~10s. Two sources tried in sequence
// at 3s each leaves plenty of headroom.
const SOURCE_TIMEOUT_MS = 3000;

const VISIBILITIES: readonly string[] = ["daylight", "visible", "eclipsed"];

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Primary source. wheretheiss.at returns the position plus telemetry
 * (altitude, velocity, lighting), and is served over HTTPS. Its documented
 * rate limit is roughly 1 request/second — far above what the 30s cache
 * below ever sends.
 */
async function fetchFromWhereTheIss(): Promise<IssPosition> {
  const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`wheretheiss.at failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;

  const latitude = finite(data.latitude);
  const longitude = finite(data.longitude);
  const timestamp = finite(data.timestamp);
  if (latitude === undefined || longitude === undefined || timestamp === undefined) {
    throw new Error("wheretheiss.at returned an unexpected shape");
  }

  const position: IssPosition = { latitude, longitude, timestamp };
  const altitudeKm = finite(data.altitude);
  const velocityKph = finite(data.velocity);
  if (altitudeKm !== undefined) position.altitudeKm = altitudeKm;
  if (velocityKph !== undefined) position.velocityKph = velocityKph;
  if (typeof data.visibility === "string" && VISIBILITIES.includes(data.visibility)) {
    position.visibility = data.visibility as IssVisibility;
  }
  return position;
}

/**
 * Fallback. open-notify.org has had spotty uptime historically and only
 * knows the position — so when this is the source that answered, the
 * telemetry fields are simply absent and the client shows "—".
 */
async function fetchFromOpenNotify(): Promise<IssPosition> {
  const res = await fetch("http://api.open-notify.org/iss-now.json", {
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`open-notify failed: ${res.status}`);
  const data = (await res.json()) as {
    iss_position: { latitude: string; longitude: string };
    timestamp: number;
  };
  return {
    latitude: Number(data.iss_position.latitude),
    longitude: Number(data.iss_position.longitude),
    timestamp: data.timestamp,
  };
}

/**
 * GET /api/iss
 * Short cache TTL since the whole point is that this is close to
 * real-time — the ISS moves at ~7.66 km/s, so anything longer than
 * ~30s starts looking stale on a map.
 */
issRouter.get("/", async (_req, res) => {
  try {
    const position = await cached("iss-position", TTL.THIRTY_SECONDS, async () => {
      try {
        return await fetchFromWhereTheIss();
      } catch (err) {
        console.warn("[iss] primary source failed, trying fallback:", err instanceof Error ? err.message : err);
        return await fetchFromOpenNotify();
      }
    });
    res.json(position);
  } catch (err) {
    console.error("[iss]", err);
    res.status(502).json({ error: "Failed to fetch ISS position." });
  }
});