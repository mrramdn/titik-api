# Data rujukan

Semua berkas di folder ini diambil dari sumber publik pada 15–16 Oktober 2026, lalu dimuat ke PostGIS saat container start (`apps/api/src/reference.ts`). Setiap berkas hanya dimuat ulang bila isinya berubah.

| Berkas | Isi | Sumber | Lisensi |
| --- | --- | --- | --- |
| `desa-oki.geojson` | 327 poligon desa/kelurahan Kab. Ogan Komering Ilir (adm2 `ID1602`), dengan porsi gambut per desa dan titik pusat desa | [HDX COD-AB Indonesia](https://data.humdata.org/dataset/cod-ab-idn) (BPS, batas 2020, diperbarui di HDX 23 Jun 2026); pusat desa dari titik `place` OpenStreetMap yang namanya cocok (133 desa), sisanya `ST_PointOnSurface` | CC BY-IGO; ODbL untuk titik OSM |
| `gambut-oki-mask.png`, `gambut-oki-mask.json` | Masker 1-bit lahan gambut di atas OKI (tile zoom 12, ±38 m per piksel) | [Global peatland extent v20230315](https://data-api.globalforestwatch.org/dataset/gfw_peatlands), Global Nature Watch (untuk Indonesia: Miettinen dkk. 2016) | CC BY 4.0 |
| `permukiman-oki.geojson` | 1.255 titik `place` (desa, dusun, kota) di sekitar OKI | OpenStreetMap lewat Overpass API | ODbL |
| `industri-oki.geojson` | 90 kawasan/fasilitas industri, pembangkit, dan suar gas, hanya dengan label jenis (tanpa nama) | OpenStreetMap lewat Overpass API | ODbL |
| `firms-snapshot/2026-10-16/` | CSV FIRMS 24 jam dan 7 hari (NOAA-21, NOAA-20, S-NPP), dipotong ke kotak OKI; cadangan bila FIRMS tidak bisa dihubungi | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/active_fire/), VIIRS 375 m NRT | Data NASA; wajib acknowledgement (lihat README) |

## Cara membuat ulang

```sh
# 1. Batas desa (218 MB, GDAL lewat Docker)
curl -L -o idn.gdb.zip "https://data.humdata.org/dataset/84a1d98a-790b-4d66-9d14-bbfa48500802/resource/c740a308-0a63-46d6-ab15-b041e62eff58/download/idn_admin_boundaries.gdb.zip"
unzip idn.gdb.zip -d gdb
docker run --rm -v "$PWD:/d" ghcr.io/osgeo/gdal:alpine-small-latest ogr2ogr -f GeoJSON /d/oki-raw.geojson /d/gdb/idn_admin_boundaries.gdb idn_admin4 \
  -where "adm2_pcode = 'ID1602'" -select adm4_pcode,adm4_name,adm3_name,adm3_pcode,adm2_name,adm1_name -lco COORDINATE_PRECISION=6

# 2. OSM: titik place dan kawasan industri di kotak (-4.35, 104.55, -2.30, 106.30) lewat Overpass, disimpan sebagai osm-places.json dan osm-industry.json

# 3. Masker gambut, porsi gambut per desa, pusat desa, permukiman, industri
pnpm --filter @titikapi/api exec tsx scripts/build-reference.ts oki-raw.geojson osm-places.json osm-industry.json ./peat-tiles
```

Snapshot FIRMS diambil dengan `curl` dari URL CSV publik (`…/csv/J2_VIIRS_C2_SouthEast_Asia_24h.csv` dan seterusnya), lalu disaring ke kotak OKI `104.58 ≤ lon ≤ 106.25`, `−4.33 ≤ lat ≤ −2.33`.
