/**
 * Typed fetch helpers for the Skywatch backend. In dev, Vite proxies `/api`
 * to the Express server (see vite.config.ts); in production these should
 * be served from the same origin or you'll need to set an absolute base
 * URL here.
 */

export interface ApodResponse {
  date: string;
  title: string;
  explanation: string;
  url: string;
  hdurl?: string;
  media_type: "image" | "video";
  copyright?: string;
}

export interface ExoplanetRow {
  pl_name: string;
  hostname: string;
  disc_year: number | null;
  discoverymethod: string | null;
  pl_rade: number | null;
  pl_bmasse: number | null;
  sy_dist: number | null;
}
export interface ExoplanetSummary {
  total: number;
  byYearMethod: { year: number; method: string; count: number }[];
  closest: ExoplanetRow | null;
  largest: ExoplanetRow | null;
  smallest: ExoplanetRow | null;
}
export interface SpaceWeatherEvent {
  id: string;
  type: "Solar Flare" | "CME" | "Geomagnetic Storm";
  time: string;
  headline: string;
  /** Solar flares only, e.g. "M2.3" */
  flareClass?: string;
  /** Geomagnetic storms only: highest Kp index observed */
  kp?: number;
}
export type IssVisibility = "daylight" | "visible" | "eclipsed";

export interface IssPosition {
  latitude: number;
  longitude: number;
  timestamp: number;
  altitudeKm?: number;
  velocityKph?: number;
  visibility?: IssVisibility;
}

export interface CloseApproach {
  id: string;
  name: string;
  isHazardous: boolean;
  date: string;
  diameterKmMin: number;
  diameterKmMax: number;
  velocityKph: number;
  missDistanceKm: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request to ${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  getApod: (date?: string) => getJson<ApodResponse>(`/api/apod${date ? `?date=${date}` : ""}`),
  getExoplanets: () => getJson<ExoplanetRow[]>("/api/exoplanets"),
  getSpaceWeather: (days = 30) => getJson<SpaceWeatherEvent[]>(`/api/space-weather?days=${days}`),
  getIssPosition: () => getJson<IssPosition>("/api/iss"),
  getNearEarthObjects: () => getJson<CloseApproach[]>("/api/near-earth-objects"),
  getExoplanetSummary: () => getJson<ExoplanetSummary>("/api/exoplanets/summary"),  
};
