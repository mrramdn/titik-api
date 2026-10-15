# Data rujukan

Semua berkas di folder ini diambil dari sumber publik pada 15–16 Oktober 2026, lalu dimuat ke PostGIS saat container start (`apps/api/src/reference.ts`). Setiap berkas hanya dimuat ulang bila isinya berubah.

| Berkas | Isi | Sumber | Lisensi |
| --- | --- | --- | --- |
| `desa.geojson` | 4.838 poligon desa/kelurahan: Sumatera Selatan (`ID16`, 3.264) dan Kalimantan Tengah (`ID62`, 1.574), 32 kabupaten/kota, dengan porsi gambut per desa dan titik pusat desa. Disederhanakan dengan mapshaper (Douglas–Peucker 35%, bentuk dipertahankan) | [HDX COD-AB Indonesia](https://data.humdata.org/dataset/cod-ab-idn) (BPS, batas 2020, diperbarui di HDX 23 Jun 2026); pusat desa dari titik `place` OpenStreetMap yang namanya cocok (2.158 desa), sisanya `ST_PointOnSurface` | CC BY-IGO; ODbL untuk titik OSM |
| `gambut-sumsel.*`, `gambut-kalteng.*` | Masker 1-bit lahan gambut per provinsi (tile zoom 11, ±76 m per piksel) | [Global peatland extent v20230315](https://data-api.globalforestwatch.org/dataset/gfw_peatlands), Global Nature Watch (untuk Indonesia: Miettinen dkk. 2016) | CC BY 4.0 |
| `permukiman.geojson` | 10.547 titik `place` (kota, desa, dusun) di kedua provinsi | OpenStreetMap lewat Overpass API | ODbL |
| `industri.geojson` | 596 kawasan/fasilitas industri, pembangkit, dan suar gas, hanya dengan label jenis (tanpa nama) | OpenStreetMap lewat Overpass API | ODbL |
| `firms-snapshot/2026-10-16/` | CSV FIRMS 24 jam dan 7 hari (NOAA-21, NOAA-20, S-NPP), dipotong ke kotak kedua provinsi dan dikompres gzip; cadangan bila FIRMS tidak bisa dihubungi | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/active_fire/), VIIRS 375 m NRT | Data NASA; wajib acknowledgement (lihat README) |

## Cara membuat ulang

```sh
# 1. Batas desa (218 MB, GDAL lewat Docker)
curl -L -o idn.gdb.zip "https://data.humdata.org/dataset/84a1d98a-790b-4d66-9d14-bbfa48500802/resource/c740a308-0a63-46d6-ab15-b041e62eff58/download/idn_admin_boundaries.gdb.zip"
unzip idn.gdb.zip -d gdb
docker run --rm -v "$PWD:/d" ghcr.io/osgeo/gdal:alpine-small-latest ogr2ogr -f GeoJSON /d/oki-raw.geojson /d/gdb/idn_admin_boundaries.gdb idn_admin4 \
  -where "adm1_pcode IN ('ID16','ID62')" -select adm4_pcode,adm4_name,adm3_name,adm3_pcode,adm2_name,adm2_pcode,adm1_name,adm1_pcode -lco COORDINATE_PRECISION=6
npx mapshaper prov-raw.geojson -simplify dp 35% keep-shapes -o precision=0.00001 prov-simple.geojson

# 2. OSM: titik place dan kawasan industri di kotak Sumsel (-4.95, 102.04, -1.60, 106.22) dan Kalteng (-3.57, 110.70, 0.80, 115.88) lewat Overpass
# 3. Tile gambut GFW zoom 11 untuk kedua kotak ke folder ./peat-z11 (gfw_peatlands/v20230315/is/{z}/{x}/{y}.png)

# 4. Masker gambut, porsi gambut per desa, pusat desa, permukiman, industri
pnpm --filter @titikapi/api exec tsx scripts/build-reference.ts prov-simple.geojson ./peat-z11 --places places-sumsel.json,places-kalteng.json --industry industry-sumsel.json,industry-kalteng.json
```

Snapshot FIRMS diambil dengan `curl` dari URL CSV publik (`…/csv/J2_VIIRS_C2_SouthEast_Asia_24h.csv` dan seterusnya), lalu disaring ke kotak Sumsel `102,00 ≤ lon ≤ 106,25`, `−4,98 ≤ lat ≤ −1,57` dan Kalteng `110,68 ≤ lon ≤ 115,90`, `−3,60 ≤ lat ≤ 0,83`, lalu dikompres gzip.
