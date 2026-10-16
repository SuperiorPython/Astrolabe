import { useEffect, useState } from "react";
import { FEEDS, type FeedKey } from "../lib/feeds";
import type { FeedStatus } from "../lib/useFeedHealth";

const DESCRIPTIONS: Record<FeedKey, string> = {
  apod: "Today's astronomy picture",
  exoplanets: "The full confirmed-planet catalog",
  "space-weather": "Solar flares, CMEs and storms",
  iss: "Live station position and telemetry",
  neows: "Asteroid close approaches",
};

/** True on devices whose primary input can't hover (phones, most tablets). */
function useCanNotHover(): boolean {
  const query = "(hover: none)";
  const [noHover, setNoHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setNoHover(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return noHover;
}

interface HomeMenuProps {
  status: Record<FeedKey, FeedStatus>;
  focusKey: FeedKey | null;
  /** Called with a section's key on hover/focus, and with null when the pointer leaves. */
  onHover: (key: FeedKey | null) => void;
  onSelect: (key: FeedKey) => void;
}

/**
 * The landing screen's section list. With a mouse, hovering (or
 * keyboard-focusing) a row turns the globe to that section's pin and
 * clicking opens it. Touch screens can't hover, so there the first tap on a
 * row turns the globe to it and a second tap on the same row opens it.
 * (Mouse and focus events are ignored on touch: browsers fire emulated ones
 * around a tap, which would race with the click handler.)
 */
export function HomeMenu({ status, focusKey, onHover, onSelect }: HomeMenuProps) {
  const touch = useCanNotHover();

  return (
    <nav
      className="home-menu panel"
      aria-label="Sections"
      onMouseLeave={() => {
        if (!touch) onHover(null);
      }}
    >
      <div className="panel-head">
        <h2 className="panel-title">Explore</h2>
        <span className="panel-meta muted">{FEEDS.length} sections</span>
      </div>
      <ul className="home-menu-list">
        {FEEDS.map((feed, i) => {
          const state = status[feed.key];
          return (
            <li key={feed.key}>
              <button
                type="button"
                className={`home-menu-item${focusKey === feed.key ? " home-menu-item-focus" : ""}${
                  state === "down" ? " home-menu-item-down" : ""
                }`}
                onMouseEnter={() => {
                  if (!touch) onHover(feed.key);
                }}
                onFocus={() => {
                  if (!touch) onHover(feed.key);
                }}
                onBlur={() => {
                  if (!touch) onHover(null);
                }}
                onClick={() => {
                  if (touch && focusKey !== feed.key) onHover(feed.key);
                  else onSelect(feed.key);
                }}
              >
                <span className="home-menu-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="home-menu-text">
                  <span className="home-menu-label">{feed.navLabel}</span>
                  <span className="home-menu-desc">
                    {state === "down" ? "Currently unavailable" : DESCRIPTIONS[feed.key]}
                  </span>
                </span>
                <span className="home-menu-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
