#!/usr/bin/env node
/**
 * Hits a lightweight api.nasa.gov endpoint with NASA_API_KEY and fails
 * (non-zero exit) if the KEY is the problem: missing, invalid, or
 * rate-limited. Meant to run both locally (`npm run check:nasa-key`, reading
 * server/.env) and in CI (GitHub Actions, reading the NASA_API_KEY repo
 * secret) — see .github/workflows/nasa-key-health.yml.
 *
 * NeoWs is used as the check target rather than APOD: NASA's APOD API is
 * currently unreliable (500s and placeholder images), which says nothing
 * about the key. The key isn't endpoint-specific, so a passing NeoWs call
 * means the others work too.
 *
 * If NASA's own service is down (5xx, timeouts) the key can't be judged
 * either way, so after a few retries that is reported as a warning and the
 * run passes — an upstream outage shouldn't look like a dead key.
 */

// Only meaningful for local runs — in CI, NASA_API_KEY is already set as an
// env var by the workflow, and this simply finds no server/.env to load.
try {
  const dotenv = await import("dotenv");
  dotenv.config({ path: new URL("../server/.env", import.meta.url) });
} catch {
  // dotenv not resolvable (e.g. a clean CI checkout with no npm install of
  // the server workspace) — fine, CI provides the env var directly.
}

const ATTEMPTS = 3;
const TIMEOUT_MS = 15_000;
const LOW_QUOTA = 50;

const apiKey = process.env.NASA_API_KEY?.trim();

if (!apiKey || apiKey === "DEMO_KEY") {
  console.error(
    "NASA_API_KEY is not set (or is still DEMO_KEY) — set a real key in server/.env locally, " +
      "or as the NASA_API_KEY repository secret in CI."
  );
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const url =
  `https://api.nasa.gov/neo/rest/v1/feed?start_date=${today}&end_date=${today}` +
  `&api_key=${encodeURIComponent(apiKey)}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastProblem = "no response";

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const remaining = res.headers.get("x-ratelimit-remaining");
    const limit = res.headers.get("x-ratelimit-limit");

    if (res.ok) {
      console.log(
        `NASA API key OK. Rate limit remaining: ${remaining ?? "unknown"} of ${limit ?? "unknown"} per hour.`
      );
      if (remaining !== null && Number(remaining) < LOW_QUOTA) {
        console.warn(`::warning::Only ${remaining} NASA API requests remaining this hour.`);
      }
      await writeSummary(
        `### NASA API key health\n\n- Status: ✅ OK\n- Rate limit remaining: ${
          remaining ?? "unknown"
        } / ${limit ?? "unknown"} per hour\n`
      );
      process.exit(0);
    }

    const body = (await res.text().catch(() => "")).slice(0, 300);

    // 4xx (403 invalid/missing key, 429 rate-limited, ...): the key is the problem.
    if (res.status >= 400 && res.status < 500) {
      console.error(`NASA API check failed: ${res.status} ${res.statusText}\n${body}`.trim());
      await writeSummary(`### NASA API key health\n\n- Status: ❌ FAILED (${res.status})\n`);
      process.exit(1);
    }

    // 5xx: NASA's side. Retry below.
    lastProblem = `${res.status} ${res.statusText} ${body}`.trim();
  } catch (err) {
    lastProblem = err instanceof Error ? err.message : String(err);
  }

  if (attempt < ATTEMPTS) await sleep(attempt * 3000);
}

console.warn(
  `::warning::NASA's service did not respond properly after ${ATTEMPTS} tries (${lastProblem}). ` +
    "The key could not be verified, but this is not a key failure."
);
await writeSummary(
  `### NASA API key health\n\n- Status: ⚠️ INCONCLUSIVE — NASA's service is erroring (${lastProblem}); the key itself was not rejected\n`
);
process.exit(0);

/** Appends to the GitHub Actions job summary when running in CI; no-op locally. */
async function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const fs = await import("node:fs/promises");
  await fs.appendFile(summaryPath, markdown);
}
