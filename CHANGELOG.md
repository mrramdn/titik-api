# Changelog

What changed in each version of Titik Api, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); dates are in WIB.

## [1.1.0] - Unreleased

### Added
- A landing page at `/` that explains the product before the map; the map moves to `/peta`, old `/?tanggal=` links
  and an app installed before the move follow it, and `?lihat=mpa|kades|bpbd` opens a shared demo account directly.
- An archive that replays any WIB day since 8 Oct 2026 with the real data (`?tanggal=`), with that day's NASA image.
  The date comes only from the address, so a notification or a shared link always opens live data.
- Satellite pixel boxes for hotspots from zoom 11.
- An indicated hot area per incident: the pixel footprints of its largest single pass (not burned area).
- Fire danger from the Canadian Fire Weather Index System, computed from Open-Meteo weather on a 0.5° grid and classed
  with BMKG's FWI classes, on the map, the dashboard and the recap; regencies are told by the share of their area.
  Days are named by their date, a forecast older than 6 hours says its age, and both move on by themselves on a
  screen left open.
- Wind and smoke direction per incident, with the villages within 5 km downwind, within a budget of Open-Meteo calls
  of which older incidents may use half.
- HD imagery from Esri World Imagery through a server-side proxy with monthly, daily and per-address caps; the last
  quarter of each day is kept for visitors who have fetched little.
- `GET /api/v1/health/data` and a stale-data warning in the app when the ingest stops.
- A data sources, accuracy and terms of use section on the About page; a demo line on every map screen.

### Changed
- Shared demo accounts act in a demo scope: their checks and tasks no longer change what visitors and real accounts
  see, demo checks store a rounded distance to the hotspot (one significant figure, at least 100 m) instead of a GPS
  position, and the nightly reset also removes their photos and push subscriptions. Demo tiles are cached for at most
  2 minutes, so the reset shows within 2 minutes.
- Map tiles, the incident list and the counts take 24, 72 or 168 hours of hotspots. Uncached tiles pass a gate of four
  database queries at a time with places per address and per IPv6 /56; requests for the same tile share one query,
  and tiles the map cancels leave the line. Lists, counts, village pages, the dashboard, the recap and the CSV pass a
  gate of their own, three queries at a time. Past either a request gets 503 or 429 with `Retry-After`, and the app
  asks again by itself.
- Every rate limit counts an IPv6 client by its /64.
- The API's request log no longer records visitor addresses; the About page says what the web server logs, why and
  for how long, that Cloudflare also processes addresses, and that the site sets no tracking cookie.
- Small grey text meets WCAG AA contrast (4.5:1) on every surface.
- The EOX and Copernicus credits use the wording their licences ask for. The Copernicus notice also stands next to
  Open-Meteo's credit in the fire danger legend, card and recap, the map keeps its credits open while EOX imagery shows
  on a wide screen, and the landing page credits the base map and Open-Meteo under its screenshots.
- The weather spin-up fetches, computes and saves one block of cells at a time, and a deploy stops a weather run or a
  FIRMS ingest within seconds instead of waiting to be killed.
- A session check that gets no answer (no signal, a server error, a rate limit) keeps the account and asks again; a
  sign-in or sign-out in another tab carries over to every open tab.
- The landing page loads without the map code: the first download fell from 1,557 kB to 471 kB.
- The SiPongi+ links point to its current address.
- `Referrer-Policy` is `strict-origin-when-cross-origin`.

### Fixed
- A report saved without signal goes out only under the account that filed it. Before, it went out under whichever
  account signed in next on that phone. After the server says the session has ended, reports wait for that account to
  sign in again, and the field check says so with a link to sign in.
- "Siap tanpa sinyal" waits for the service worker's first install however long it takes, instead of giving up after
  10 seconds.
- MapLibre's worker script is precached, so the map draws without signal after the browser's HTTP cache has let it go.

### Removed
- S-NPP from the active satellites: NASA stopped delivering its data on 2 Nov 2026.

## [1.0.0] - 2026-10-16

The version submitted to Hackathon JOINTS UGM 2026 and presented at the Grand Final on 1 Nov 2026 without changes
(tag `joints-2026`): NASA FIRMS ingest every 30 minutes, village matching and incidents, priority scores, village
alerts with Web Push, assignments, field checks without signal, the BPBD/Daops dashboard, the daily recap, the
SiPongi+ groundcheck CSV, Indonesian and English.

[1.1.0]: https://github.com/mrramdn/titik-api/compare/joints-2026...main
[1.0.0]: https://github.com/mrramdn/titik-api/releases/tag/joints-2026
