import { useEffect, useMemo, useRef, useState } from "react";
// react-globe.gl ships its own bundled types, but I can't install the
// package in my sandbox (npm registry is blocked there) to confirm the
// exact shape of its exports — see the `any` casts below, which are a
// deliberate, documented trade-off rather than sloppiness. Everything here
// matches the library's published usage examples as closely as I can from
// memory; the real test is running it. The riskiest single piece is
// `htmlElementVisibilityModifier` below (fading a label when its pin
// rotates to the far side of the globe) — I'm fairly confident in the prop
// name but haven't been able to verify it.
import Globe from "react-globe.gl";
import { FEEDS, type FeedKey, type FeedMeta } from "../lib/feeds";
import type { FeedStatus } from "../lib/useFeedHealth";

const PIN_COLOR_ACTIVE = "#ffffff"; // healthy feed — nav chrome, not chart data
const PIN_COLOR_DOWN = "#e66767"; // --status-critical

// How far outside the globe's surface the floating label sits, along the
// same lat/lng radial line as its dot — this is real 3D placement (not a
// 2D screen-space offset), so the library's own projection keeps the label
// correctly positioned as the globe rotates, without me hand-computing it.
const LABEL_ALTITUDE = 0.35;
const DOT_ALTITUDE = 0.01;

// Surface textures, all served from the three-globe package's own example
// images. The blue-marble map is the detailed daytime Earth (oceans,
// continents, ice caps, cloud-free). To change the look, swap
// GLOBE_TEXTURE for one of the others:
//   "earth-night.jpg"  city lights on black — moodier, but mostly dark
//   "earth-day.jpg"    a flatter, brighter day map
//   "earth-dark.jpg"   the near-black map this globe started with
const IMG = "//unpkg.com/three-globe/example/img";
const GLOBE_TEXTURE = `${IMG}/earth-blue-marble.jpg`;
const GLOBE_BUMP = `${IMG}/earth-topology.png`;
const GLOBE_BACKGROUND = `${IMG}/night-sky.png`;

// The soft glow around the planet's edge.
const ATMOSPHERE_COLOR = "#7ab8ff";
const ATMOSPHERE_ALTITUDE = 0.2;

type FeedPoint = FeedMeta & { size: number; color: string };

interface HomeGlobeProps {
  onSelect: (key: FeedKey) => void;
  status: Record<FeedKey, FeedStatus>;
  /** The section hovered in the side menu: the globe turns to face it. */
  focusKey?: FeedKey | null;
}

// Camera travel time when the globe turns to a hovered section.
const FOCUS_MS = 900;

export function HomeGlobe({ onSelect, status, focusKey = null }: HomeGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // See the top-of-file note: `any` because I can't resolve the library's
  // real ref-method type (GlobeMethods or similar) without installing it.
  const globeRef = useRef<any>(null);
  // The globe fills whatever box its container gets (the full viewport on
  // the landing screen), so it tracks both dimensions.
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The <Globe> only mounts once the container has a real size.
  const ready = size.width > 0 && size.height > 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Gentle idle rotation so the landing screen doesn't sit dead-still;
    // OrbitControls (exposed via .controls()) takes over normal drag/zoom.
    const controls = globeRef.current?.controls?.();
    if (!controls) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
  }, [ready]);

  // Read by the label factory below so a label created while a section is
  // already focused starts out highlighted.
  const focusRef = useRef<FeedKey | null>(focusKey);
  focusRef.current = focusKey;

  // Hovering a section in the side menu: pause the idle spin and swing the
  // camera round to that pin (keeping the user's current zoom). When the
  // pointer leaves the menu, the idle spin resumes from wherever it landed.
  useEffect(() => {
    const globe = globeRef.current;
    const controls = globe?.controls?.();
    if (!globe || !controls) return;

    if (focusKey) {
      const feed = FEEDS.find((f) => f.key === focusKey);
      if (feed) {
        controls.autoRotate = false;
        const { altitude } = globe.pointOfView();
        globe.pointOfView({ lat: feed.lat, lng: feed.lng, altitude }, FOCUS_MS);
      }
    } else {
      controls.autoRotate = true;
    }
  }, [focusKey, ready]);

  // Highlight the matching floating label on the globe.
  useEffect(() => {
    containerRef.current
      ?.querySelectorAll<HTMLElement>(".globe-pin-label")
      .forEach((el) => el.classList.toggle("globe-pin-label-focus", el.dataset.feed === focusKey));
  }, [focusKey, ready]);

  const feedPoints = useMemo<FeedPoint[]>(
    () =>
      FEEDS.map((feed) => ({
        ...feed,
        size: 0.55,
        color: status[feed.key] === "down" ? PIN_COLOR_DOWN : PIN_COLOR_ACTIVE,
      })),
    [status]
  );

  // One connector "flight path" per feed, running straight up from its
  // surface dot to its floating label at the same lat/lng.
  const connectorPaths = useMemo(
    () =>
      feedPoints.map((feed) => ({
        key: feed.key,
        color: feed.color,
        coords: [
          [feed.lat, feed.lng, DOT_ALTITUDE],
          [feed.lat, feed.lng, LABEL_ALTITUDE],
        ],
      })),
    [feedPoints]
  );

  return (
    <div className="home-globe-wrap" ref={containerRef}>
      {ready && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          backgroundImageUrl={GLOBE_BACKGROUND}
          globeImageUrl={GLOBE_TEXTURE}
          bumpImageUrl={GLOBE_BUMP}
          showAtmosphere
          atmosphereColor={ATMOSPHERE_COLOR}
          atmosphereAltitude={ATMOSPHERE_ALTITUDE}
          pointsData={feedPoints}
          pointLat="lat"
          pointLng="lng"
          pointColor="color"
          pointRadius="size"
          pointAltitude={DOT_ALTITUDE}
          pointResolution={32}
          pointLabel={(d: unknown) => {
            const feed = d as FeedPoint;
            const down = status[feed.key] === "down";
            return `<div class="globe-pin-tooltip${down ? " globe-pin-tooltip-down" : ""}">${
              feed.globeLabel
            }${down ? " — unavailable" : ""}</div>`;
          }}
          onPointClick={(point: unknown) => onSelect((point as FeedPoint).key)}
          onPointHover={(point: unknown) => {
            if (containerRef.current) {
              containerRef.current.style.cursor = point ? "pointer" : "grab";
            }
          }}
          // Connector lines from each feed's dot up to its floating label.
          pathsData={connectorPaths}
          pathPoints="coords"
          pathPointLat={(p: unknown) => (p as number[])[0]}
          pathPointLng={(p: unknown) => (p as number[])[1]}
          pathPointAlt={(p: unknown) => (p as number[])[2]}
          pathColor={(d: unknown) => (d as { color: string }).color}
          pathStroke={0.4}
          pathTransitionDuration={0}
          // The floating labels — real 3D-anchored HTML that follows its
          // pin as the globe rotates, always at LABEL_ALTITUDE outside the
          // surface so it never sits over the planet itself.
          htmlElementsData={feedPoints}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={LABEL_ALTITUDE}
          htmlElement={(d: unknown) => {
            const feed = d as FeedPoint;
            const down = status[feed.key] === "down";
            const el = document.createElement("div");
            el.className = `globe-pin-label${down ? " globe-pin-label-down" : ""}${
              focusRef.current === feed.key ? " globe-pin-label-focus" : ""
            }`;
            el.dataset.feed = feed.key;
            el.textContent = feed.navLabel;
            el.style.pointerEvents = "auto";
            el.addEventListener("click", (evt) => {
              evt.stopPropagation();
              onSelect(feed.key);
            });
            return el;
          }}
          htmlElementVisibilityModifier={(el: HTMLElement, isVisible: boolean) => {
            el.style.opacity = isVisible ? "1" : "0";
            el.style.pointerEvents = isVisible ? "auto" : "none";
          }}
        />
      )}
    </div>
  );
}
