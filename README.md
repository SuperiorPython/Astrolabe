# Astrolabe

**Live demo:** [astrolabe.netlify.app](https://astrolabe.netlify.app/)

Astrolabe is an interactive space dashboard built on NASA's public APIs. It
pulls the day's astronomy picture, the live position of the International
Space Station, nearby asteroids, the full exoplanet catalog, and recent solar
activity into a single console-style interface, starting from a full-screen
interactive 3D globe that doubles as the navigation menu.

It is a custom React + TypeScript frontend backed by a small Express API that
proxies and caches the NASA endpoints, so the dashboard stays responsive and
inside the API rate limits.

## Features

### Home globe
A full-screen, draggable 3D globe with floating labels for each section.
Pick a destination from the globe to open its tab. The rest of the app sits on
a fixed night-sky background with a shared blue "instrument panel" look:
bracketed panels, stat strips, and status badges (LIVE, DAILY, CATALOG) that
show how fresh each feed is.

### Astronomy Picture of the Day
Today's APOD with the picture on the left and its caption beside it: title,
date, credit, and the full explanation in a scrollable panel. Click the image
for a full-screen viewer, or jump to the full-resolution file. Video days
are handled too.

### ISS tracker
The station's live position on a map, updated continuously, with its recent
ground track and a footprint circle showing the area that can currently see
it. Telemetry shows altitude, velocity, and whether the station is in
daylight, visible from the ground, or in Earth's shadow. If the primary data
source is unavailable, the tracker falls back to a secondary one that
provides position only.

### Near-Earth objects
Upcoming asteroid close approaches drawn as a radar centered on Earth.
Distance is on a logarithmic scale measured in lunar distances, each approach
day gets its own wedge, and each dot is sized by the asteroid's estimated
diameter, with potentially hazardous objects flagged. A scrollable side list
and summary stats sit beside the radar, sortable by size, distance, or date.

### Exoplanets
The whole NASA Exoplanet Archive catalog at a glance: a discovery timeline
broken down by year and detection method, highlight cards for the closest,
largest, and smallest known planets, a strip comparing planet sizes, and a
filterable, sortable table with a scatter plot of distance versus radius.

### Space weather
Recent solar flares, coronal mass ejections, and geomagnetic storms from
NASA's DONKI database. Events are ranked by severity: flares by X/M/C class,
storms on the NOAA G-scale derived from the Kp index. Headline stats
summarize the period and a timeline shows what happened when.

## How it works

- **Frontend:** React 18, TypeScript, and Vite. A shared set of components
  (panels, stat strips, skeleton loaders, section headers) keeps the five
  tabs consistent, and every feed shows a loading skeleton, an error state,
  and a last-updated time.
- **Backend:** Express + TypeScript. Each NASA endpoint is wrapped, trimmed
  to the fields the UI needs, and cached in memory for a short time so page
  refreshes don't burn through the rate limit.
- **Data sources:** NASA APOD, NeoWs, DONKI, and the Exoplanet Archive,
  plus a public ISS position feed.
- **Hosting:** the client is served as a static site and the Express app runs
  as a single Netlify serverless function.
- **CI:** a scheduled GitHub Actions workflow checks the NASA API key weekly,
  so a dead or rate-limited key is caught before a demo rather than during one.
