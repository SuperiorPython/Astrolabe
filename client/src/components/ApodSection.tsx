import { useEffect, useRef, useState } from "react";
import { api, type ApodResponse } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { SectionHead } from "./SectionHead";
import { Panel } from "./Panel";
import { Skeleton } from "./Skeleton";
import { StatStrip, StatStripSkeleton } from "./StatStrip";

function formatLongDate(iso: string): string {
  // Parse as UTC midnight so the calendar day never shifts with the viewer's
  // timezone (new Date("2026-10-07") is UTC; formatting must be UTC too).
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Full-screen viewer for the picture; Esc, the ✕, or a backdrop click closes it. */
function Lightbox({ apod, onClose }: { apod: ApodResponse; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={apod.title} onClick={onClose}>
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <img
        className="lightbox-img"
        src={apod.hdurl ?? apod.url}
        alt={apod.title}
        // Don't close when the picture itself is clicked.
        onClick={(e) => e.stopPropagation()}
      />
      <div className="lightbox-caption" onClick={(e) => e.stopPropagation()}>
        {apod.title}
        {apod.copyright ? ` · © ${apod.copyright}` : ""}
      </div>
    </div>
  );
}

function ApodSkeleton() {
  return (
    <>
      <StatStripSkeleton count={3} />
      <div className="apod-main">
        <Skeleton height="100%" className="apod-skeleton-media" />
        <div className="panel apod-caption">
          <Skeleton height="1.4rem" width="70%" />
          <Skeleton height="0.75rem" width="40%" />
          <div className="apod-text-skeleton">
            <Skeleton height="0.9rem" />
            <Skeleton height="0.9rem" width="94%" />
            <Skeleton height="0.9rem" width="88%" />
            <Skeleton height="0.9rem" width="92%" />
            <Skeleton height="0.9rem" width="60%" />
          </div>
        </div>
      </div>
    </>
  );
}

export function ApodSection() {
  const state = useFetch(() => api.getApod(), []);
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const apod = state.status === "success" ? state.data : null;

  return (
    <section className="section apod-section">
      <SectionHead
        title="Astronomy Picture of the Day"
        source="NASA · APOD"
        status={state.status}
        updatedAt={state.status === "success" ? state.updatedAt : undefined}
        liveLabel="DAILY"
      />

      {state.status === "loading" && <ApodSkeleton />}

      {state.status === "error" && (
        <p className="error">Couldn't load today's picture: {state.message}</p>
      )}

      {apod && (
        <>
          <StatStrip
            items={[
              { label: "Date", value: formatLongDate(apod.date) },
              { label: "Media", value: apod.media_type === "video" ? "Video" : "Image", tone: "accent" },
              { label: "Credit", value: apod.copyright ?? "NASA", hint: apod.copyright ? "© holder" : "public domain" },
            ]}
          />

          <div className="apod-main">
            {apod.media_type === "image" ? (
              imgFailed ? (
                <Panel className="apod-fallback">
                  <p>The picture couldn't be displayed here.</p>
                  <a href={apod.hdurl ?? apod.url} target="_blank" rel="noreferrer">
                    Open it on NASA's site ↗
                  </a>
                </Panel>
              ) : (
                <button
                  type="button"
                  className="apod-hero panel"
                  onClick={() => setOpen(true)}
                  aria-label={`Enlarge: ${apod.title}`}
                >
                  <img
                    className="apod-hero-img"
                    src={apod.url}
                    alt={apod.title}
                    onError={() => setImgFailed(true)}
                  />
                  <span className="apod-hero-hint">⤢ Click to enlarge</span>
                </button>
              )
            ) : (
              <div className="apod-video-wrap panel">
                <iframe className="apod-video" src={apod.url} title={apod.title} allowFullScreen />
              </div>
            )}

            <Panel className="apod-caption" title="About this image" meta={formatLongDate(apod.date)}>
              <h3 className="apod-caption-title">{apod.title}</h3>
              <div className="apod-caption-credit muted">
                {apod.copyright ? `© ${apod.copyright}` : "NASA · public domain"}
              </div>
              <div className="apod-caption-scroll">
                <p className="apod-explanation">{apod.explanation}</p>
              </div>
              {apod.hdurl && (
                <a className="apod-hd-link" href={apod.hdurl} target="_blank" rel="noreferrer">
                  Open full resolution ↗
                </a>
              )}
            </Panel>
          </div>

          {open && <Lightbox apod={apod} onClose={() => setOpen(false)} />}
        </>
      )}
    </section>
  );
}