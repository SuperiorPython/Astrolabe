import { Router } from "express";
import { cached, TTL } from "../lib/cache.js";

export const exoplanetsRouter = Router();

// The Exoplanet Archive's Table Access Protocol (TAP) service is separate
// from api.nasa.gov and does not require an API key.
// Docs: https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html
const TAP_BASE = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";

export interface ExoplanetRow {
  pl_name: string;
  hostname: string;
  disc_year: number | null;
  discoverymethod: string | null;
  pl_rade: number | null; // radius, Earth radii
  pl_bmasse: number | null; // mass, Earth masses
  sy_dist: number | null; // distance from Earth, parsecs
}

const COLUMNS = "pl_name, hostname, disc_year, discoverymethod, pl_rade, pl_bmasse, sy_dist";

/**
 * GET /api/exoplanets
 * Returns up to 1000 confirmed planets (one row per system's default
 * parameter set) with the fields the frontend needs for the table and
 * scatter plot. Rows missing both distance and radius are filtered out
 * server-side since they're useless for the "distance vs. radius" chart.
 *
 * NOTE: this is the 1000 *most recently discovered* planets, not the whole
 * catalog — so anything that has to describe the whole catalog (totals,
 * discoveries per year, record holders) comes from /summary below instead.
 */
exoplanetsRouter.get("/", async (_req, res) => {
  const query =
    `select top 1000 ${COLUMNS} ` +
    "from pscomppars " +
    "where sy_dist is not null and pl_rade is not null " +
    "order by disc_year desc";

  const url = new URL(TAP_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");

  try {
    const data = await cached("exoplanets", TTL.ONE_DAY, async () => {
      const upstream = await fetch(url.toString());
      if (!upstream.ok) {
        throw new Error(`Exoplanet Archive request failed: ${upstream.status}`);
      }
      return (await upstream.json()) as ExoplanetRow[];
    });
    res.json(data);
  } catch (err) {
    console.error("[exoplanets]", err);
    res.status(502).json({ error: "Failed to fetch exoplanet data." });
  }
});

export interface ExoplanetSummary {
  /** Every confirmed planet in the archive's composite table. */
  total: number;
  /** Discovery counts per year and method, whole catalog. */
  byYearMethod: { year: number; method: string; count: number }[];
  /** Record holders across the whole catalog (null if that query failed). */
  closest: ExoplanetRow | null;
  largest: ExoplanetRow | null;
  smallest: ExoplanetRow | null;
}

// Netlify functions time out around 10s; the queries below run in
// parallel, so one shared per-query budget keeps the whole route inside it.
const TAP_TIMEOUT_MS = 8000;

async function tap<T>(query: string): Promise<T[]> {
  const url = new URL(TAP_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const upstream = await fetch(url.toString(), { signal: AbortSignal.timeout(TAP_TIMEOUT_MS) });
  if (!upstream.ok) {
    throw new Error(`Exoplanet Archive request failed: ${upstream.status}`);
  }
  return (await upstream.json()) as T[];
}

/**
 * The row with the smallest or largest value of `column` across the whole
 * catalog. This deliberately does NOT use "ORDER BY ... top 1": the archive's
 * TAP service returned the same arbitrary row for every such query (ORDER BY
 * was effectively ignored when combined with TOP). Aggregates are reliable
 * there (the GROUP BY below works), so this finds the extreme value with
 * min()/max() first and then fetches the row that holds it.
 */
async function extremeRow(column: "sy_dist" | "pl_rade", kind: "min" | "max"): Promise<ExoplanetRow | null> {
  try {
    const agg = await tap<{ v: number | string | null }>(
      `select ${kind}(${column}) as v from pscomppars where ${column} is not null`
    );
    const value = Number(agg[0]?.v);
    if (!Number.isFinite(value)) return null;

    // Plain decimal literal (no exponent), and <= / >= rather than = so a
    // last-digit float round-trip difference can't make the match miss.
    const literal = /e/i.test(String(value)) ? value.toFixed(12) : String(value);
    const comparison = kind === "min" ? "<=" : ">=";
    const rows = await tap<ExoplanetRow>(
      `select top 1 ${COLUMNS} from pscomppars where ${column} ${comparison} ${literal}`
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[exoplanets/summary] highlight query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * GET /api/exoplanets/summary
 * Whole-catalog aggregates, computed by the archive itself (GROUP BY /
 * min / max) so the browser never has to download all ~6,000 rows. The
 * discoveries-per-year table is required; each record-holder query is
 * optional and simply comes back null if it fails.
 */
exoplanetsRouter.get("/summary", async (_req, res) => {
  try {
    const summary = await cached("exoplanets-summary", TTL.ONE_DAY, async (): Promise<ExoplanetSummary> => {
      const [counts, closest, largest, smallest] = await Promise.all([
        tap<{ disc_year: number; discoverymethod: string | null; n: number | string }>(
          "select disc_year, discoverymethod, count(*) as n from pscomppars " +
            "where disc_year is not null group by disc_year, discoverymethod"
        ),
        extremeRow("sy_dist", "min"),
        extremeRow("pl_rade", "max"),
        extremeRow("pl_rade", "min"),
      ]);

      const byYearMethod = counts
        .map((r) => ({
          year: Number(r.disc_year),
          method: r.discoverymethod ?? "Unknown",
          count: Number(r.n),
        }))
        .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.count));

      if (byYearMethod.length === 0) {
        throw new Error("Exoplanet Archive returned no discovery counts");
      }

      return {
        total: byYearMethod.reduce((sum, r) => sum + r.count, 0),
        byYearMethod,
        closest,
        largest,
        smallest,
      };
    });
    res.json(summary);
  } catch (err) {
    console.error("[exoplanets/summary]", err);
    res.status(502).json({ error: "Failed to fetch the exoplanet summary." });
  }
});