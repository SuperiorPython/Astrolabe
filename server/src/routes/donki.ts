import { Router } from "express";
import { fetchDonki, isoDate } from "../lib/nasaClient.js";
import { cached, TTL } from "../lib/cache.js";

export const donkiRouter = Router();

interface SolarFlare {
  flrID: string;
  beginTime: string;
  peakTime: string | null;
  classType: string | null;
  sourceLocation: string | null;
}

interface CoronalMassEjection {
  activityID: string;
  startTime: string;
  note: string | null;
}

interface GeomagneticStorm {
  gstID: string;
  startTime: string;
  allKpIndex?: { kpIndex: number; observedTime: string }[];
}

export type SpaceWeatherEvent = {
  id: string;
  type: "Solar Flare" | "CME" | "Geomagnetic Storm";
  time: string;
  headline: string;
  /** Solar flares only: the X-ray class, e.g. "M2.3" or "X1.0". */
  flareClass?: string;
  /** Geomagnetic storms only: the highest Kp index observed during the storm. */
  kp?: number;
};

/**
 * GET /api/space-weather?days=30
 * Merges DONKI's flare (FLR), CME, and geomagnetic storm (GST) feeds into
 * one timeline, most recent first. `days` is clamped to [1, 90].
 */
donkiRouter.get("/", async (req, res) => {
  const requested = Number(req.query.days);
  const days = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 90) : 30;
  const startDate = isoDate(-days);
  const endDate = isoDate(0);

  try {
    const events = await cached(`space-weather:${days}`, TTL.SIX_HOURS, async () => {
      const [flares, cmes, storms] = await Promise.all([
          fetchDonki<SolarFlare[]>("FLR", { startDate, endDate }),
          fetchDonki<CoronalMassEjection[]>("CME", { startDate, endDate }),
          fetchDonki<GeomagneticStorm[]>("GST", { startDate, endDate }),
      ]);

      const merged: SpaceWeatherEvent[] = [
        ...flares.map((f): SpaceWeatherEvent => ({
          id: f.flrID,
          type: "Solar Flare",
          time: f.peakTime ?? f.beginTime,
          headline: `${f.classType ?? "Unclassified"} flare${
            f.sourceLocation ? ` at ${f.sourceLocation}` : ""
          }`,
          // Passed through as its own field so the client can rank flares
          // and show a severity badge without parsing the headline text.
          ...(f.classType ? { flareClass: f.classType } : {}),
        })),
        ...cmes.map((c): SpaceWeatherEvent => ({
          id: c.activityID,
          type: "CME",
          time: c.startTime,
          headline: c.note?.slice(0, 140) || "Coronal mass ejection observed",
        })),
        ...storms.map((s): SpaceWeatherEvent => {
          const kpValues = (s.allKpIndex ?? []).map((k) => Number(k.kpIndex)).filter(Number.isFinite);
          const maxKp = kpValues.length ? Math.max(...kpValues) : null;
          return {
            id: s.gstID,
            type: "Geomagnetic Storm",
            time: s.startTime,
            headline: maxKp !== null ? `Peak Kp index ${maxKp}` : "Geomagnetic storm observed",
            ...(maxKp !== null ? { kp: maxKp } : {}),
          };
        }),
      ];

      merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      return merged;
    });

    res.json(events);
  } catch (err) {
    console.error("[space-weather]", err);
    res.status(502).json({ error: "Failed to fetch space weather data." });
  }
});