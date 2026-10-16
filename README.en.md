# Titik Api

Village-level hotspot alerts for forest and land fire response in South Sumatra and Central Kalimantan, Indonesia.

App: https://titik-api.mrramdn.com · [Bahasa Indonesia](README.md)

Titik Api forwards NASA FIRMS hotspots to Masyarakat Peduli Api (MPA) fire-care volunteers and village heads who watch the villages concerned. Their field checks are recorded and shown on a dashboard for BPBD (the regional disaster agency) and Daops Manggala Agni (the forestry fire brigade).

Coverage: South Sumatra and Central Kalimantan, 4,837 villages in 31 regencies. Pilot area: Ogan Komering Ilir (OKI) regency.

## How it works

1. **Satellite data.** The server checks NASA FIRMS every 30 minutes: VIIRS 375 m (NOAA-21, NOAA-20, S-NPP) and MODIS 1 km (Terra, Aqua). New hotspots arrive after each satellite pass. VIIRS passes at about 00:00–02:30 and 12:00–14:40 WIB, Terra at 07:30–09:10 and 19:30–21:30 WIB, Aqua at 14:40–16:20 and 02:30–04:30 WIB. FIRMS releases the data up to about 3 hours after the pass.
2. **Incidents and priority.** VIIRS hotspots no more than 750 m apart on the same day form one incident, capped by a 3 km grid cell so one squad can check it. MODIS hotspots join the nearest VIIRS incident. MODIS hotspots without a VIIRS match become their own incident with a ±1 km location. Every incident gets a priority score from 0 to 100.
3. **Village alerts.** MPA volunteers and village heads get alerts for the villages they watch, with the distance and direction from the nearest settlement. Alerts arrive as notifications and can be forwarded to WhatsApp with a map link.
4. **Assignments.** BPBD/Daops assign an incident to the nearest MPA squad. The squad marks "on the way", and its field check closes the task.
5. **Field checks.** A volunteer picks one of five statuses (active fire, smoke or embers, controlled burn, false alarm, unreachable) and can add a photo, GPS coordinates and a note. Without signal, the report waits on the phone and is sent automatically once signal returns.
6. **Dashboard and recap.** BPBD/Daops see incidents that need action, those in progress and those already checked, with the response time. A daily recap per regency can be shared or printed. Field checks export to CSV in the SiPongi+ groundcheck format.

Titik Api complements SiPongi+ and Songket, the official fire information systems. Field checks export in the SiPongi+ groundcheck format so they can be passed on.

> A hotspot marks a high surface temperature seen by a satellite and needs a field check. Fires under cloud, thick smoke or canopy can go undetected.

## Roles

| Role | Sees and does |
| --- | --- |
| Public | Incident map, filters, village pages, daily satellite imagery |
| MPA volunteer | Tasks from BPBD/Daops, village alerts sorted by priority or distance, route to the site, field checks without signal |
| Village head | Summary of the watched villages and alerts for them |
| BPBD/Daops | Dashboard per regency, squad assignments, daily recap, CSV export |

Pick a role with "View as" in the top bar. Demo accounts are shared and are not official agency accounts. Reports from demo accounts are tagged "demo" and removed every night at 03:00 WIB. The interface switches between Indonesian and English.

## Architecture

- **Backend** (`apps/api`): Fastify 5, TypeScript, `pg`, PostgreSQL 17 + PostGIS 3.5, sharp, web-push. The ingest scheduler runs in-process under an advisory lock, so only one ingest runs at a time. Map layers are vector tiles cut by PostGIS (`ST_AsMVT`).
- **Frontend** (`apps/web`): React 19, React Router, MapLibre GL and vite-plugin-pwa (Workbox `injectManifest`), in Indonesian and English. Unsent reports wait in IndexedDB. Pages, the latest data and map tiles stay available without signal.
- **Reference data** (`data/`): village boundaries for both provinces, peat masks per province, settlements, industrial sites, and a FIRMS snapshot of 16 Oct 2026 (VIIRS and MODIS) as a fallback. Sources and build commands are in [`data/SOURCES.md`](data/SOURCES.md).

The priority score adds: VIIRS confidence (high 30, nominal 18, low 6), maximum FRP (≥ 50 MW 20, 20–50 MW 14, 5–20 MW 8, < 5 MW 3), number of VIIRS hotspots (2: 6, 3–4: 10, 5–19: 15, ≥ 20: 20), peatland 20, settlement within 1 km 15 or within 3 km 8, MODIS confirmation 5, and subtracts 40 near a fixed heat source. MODIS-only incidents use lower weights. High ≥ 60, medium 35–59.

## Run locally

Requires Node 24+, pnpm 12 and Docker.

```sh
cp .env.example apps/api/.env
pnpm install
docker compose up -d --wait db          # PostGIS on 127.0.0.1:5442 (+ titikapi_test database)
pnpm db:migrate                         # schema + reference data
pnpm --filter @titikapi/web build       # PWA into apps/web/dist
pnpm dev:api                            # http://localhost:3000; loads 7 days of FIRMS and the demo accounts on first start
```

`pnpm dev:web` serves the UI with hot reload on http://localhost:5173 (it proxies `/api` to port 3000). Notifications need `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env` (`npx web-push generate-vapid-keys`); without them notifications are off and everything else works.

The API routes are listed in the [Indonesian README](README.md#rute-api-apiv1).

## Tests and CI

`pnpm test:api` runs integration tests against a real PostGIS; `pnpm test:web` runs Vitest. GitHub Actions runs both on every push; `deploy.yml` builds the image, pushes it to GHCR and rolls the VPS through a locked deploy command.

## Privacy

Reporter names, notes and photos are visible only to signed-in users. Photo location metadata (EXIF) is removed. Report coordinates come only from the GPS fix the reporter chooses to send. Titik Api never shows land owners or companies; industrial sites carry only their type.

## Use of AI

Code, tests, documentation, the Figma design and the competition materials were made with Claude (Anthropic, Claude Opus 5.5) through Claude Code. The video narration uses the synthetic voice of Microsoft Edge TTS. The priority score is a fixed formula without an AI model.

## Licence and credits

Code: MIT (see `LICENSE`). Third-party data keeps its own licence: NASA FIRMS (VIIRS and MODIS MCD14DL C6.1 NRT), NASA EOSDIS GIBS imagery, village boundaries from BPS via OCHA/HDX (CC BY-IGO), Global Nature Watch peatland extent and integrated deforestation alerts (CC BY 4.0), OpenStreetMap contributors (ODbL), OpenFreeMap and OpenMapTiles, and Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0).

## Competition

Hackathon JOINTS UGM 2026, theme Sustainability, subtheme 4. Team Close AI, Universitas Bina Nusantara. Work period: 12–16 October 2026.
