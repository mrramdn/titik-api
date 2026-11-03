# Changelog

What changed in each version of Titik Api, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); dates are in WIB.

## [1.1.0] - Unreleased

### Added
- A landing page at `/` that explains the product before the map; the map moves to `/peta`, old `/?tanggal=` links
  follow it, and `?lihat=mpa|kades|bpbd` opens a shared demo account directly.
- An archive that replays any WIB day since 8 Oct 2026 with the real data (`?tanggal=`), with that day's NASA image.
- Satellite pixel boxes for hotspots from zoom 11.
- An indicated hot area per incident: the pixel footprints of its largest single pass (not burned area).
- Fire danger from the Canadian Fire Weather Index System, computed from Open-Meteo weather on a 0.5° grid and classed
  with BMKG's FWI classes, on the map, the dashboard and the recap; regencies are told by the share of their area.
- Wind and smoke direction per incident, with the villages within 5 km downwind.
- HD imagery from Esri World Imagery through a server-side proxy with monthly, daily and per-address caps.
- `GET /api/v1/health/data` and a stale-data warning in the app when the ingest stops.
- A data sources, accuracy and terms of use section on the About page; a demo line on every map screen.

### Changed
- Shared demo accounts act in a demo scope: their checks and tasks no longer change what visitors and real accounts
  see, demo checks store the distance to the hotspot instead of a GPS position, and the nightly reset also removes
  their photos and push subscriptions.
- The landing page loads without the map code: the first download fell from 1,557 kB to 471 kB.
- The SiPongi+ links point to its current address.
- `Referrer-Policy` is `strict-origin-when-cross-origin`.

### Removed
- S-NPP from the active satellites: NASA stopped delivering its data on 2 Nov 2026.

## [1.0.0] - 2026-10-16

The version submitted to Hackathon JOINTS UGM 2026 and presented at the Grand Final on 1 Nov 2026 without changes
(tag `joints-2026`): NASA FIRMS ingest every 30 minutes, village matching and incidents, priority scores, village
alerts with Web Push, assignments, field checks without signal, the BPBD/Daops dashboard, the daily recap, the
SiPongi+ groundcheck CSV, Indonesian and English.

[1.1.0]: https://github.com/mrramdn/titik-api/compare/joints-2026...main
[1.0.0]: https://github.com/mrramdn/titik-api/releases/tag/joints-2026
