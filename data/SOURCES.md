# Data rujukan

Semua berkas di folder ini diambil dari sumber publik pada 15–16 Oktober 2026, lalu dimuat ke PostGIS saat container start (`apps/api/src/reference.ts`). Setiap berkas hanya dimuat ulang bila isinya berubah.

| Berkas | Isi | Sumber | Lisensi |
| --- | --- | --- | --- |
| `desa.geojson` | 4.837 poligon desa/kelurahan: Sumatera Selatan (`ID16`, 3.263) dan Kalimantan Tengah (`ID62`, 1.574), 31 kabupaten/kota (poligon danau berkode `…888888` dibuang), dengan porsi gambut per desa dan titik pusat desa. Disederhanakan dengan mapshaper (Douglas–Peucker 35%, bentuk dipertahankan) | [HDX COD-AB Indonesia](https://data.humdata.org/dataset/cod-ab-idn) (BPS, batas 2020, diperbarui di HDX 23 Jun 2026); pusat desa dari titik `place` OpenStreetMap yang namanya cocok (2.158 desa), sisanya `ST_PointOnSurface` | CC BY-IGO; ODbL untuk titik OSM |
| `gambut-sumsel.*`, `gambut-kalteng.*` | Masker 1-bit lahan gambut per provinsi (tile zoom 11, ±76 m per piksel) | [Global peatland extent v20230315](https://data-api.globalforestwatch.org/dataset/gfw_peatlands), Global Nature Watch (untuk Indonesia: Miettinen dkk. 2016) | CC BY 4.0 |
| `permukiman.geojson` | 10.547 titik `place` (kota, desa, dusun) di kedua provinsi | OpenStreetMap lewat Overpass API | ODbL |
| `industri.geojson` | 596 kawasan/fasilitas industri, pembangkit, dan suar gas, hanya dengan label jenis (tanpa nama) | OpenStreetMap lewat Overpass API | ODbL |
| `firms-snapshot/2026-10-16/` | CSV FIRMS 24 jam dan 7 hari: VIIRS (NOAA-21, NOAA-20, S-NPP; diambil 15 Okt 2026 22.35 UTC) dan MODIS (Terra dan Aqua dalam satu berkas `MODIS_*`; diambil 16 Okt 2026 04.51 UTC), dipotong ke kotak kedua provinsi dan dikompres gzip; cadangan bila FIRMS tidak bisa dihubungi | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/active_fire/): VIIRS 375 m NRT dan MODIS 1 km NRT (MCD14DL C6.1) | Data NASA; wajib acknowledgement (lihat di bawah) |

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

Snapshot FIRMS diambil dengan `curl` dari URL CSV publik (`…/csv/J2_VIIRS_C2_SouthEast_Asia_24h.csv`, `…/modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia_7d.csv`, dan seterusnya), lalu disaring ke kotak Sumsel `102,00 ≤ lon ≤ 106,25`, `−4,98 ≤ lat ≤ −1,57` dan Kalteng `110,68 ≤ lon ≤ 115,90`, `−3,60 ≤ lat ≤ 0,83`, lalu dikompres gzip. Permintaan ke FIRMS tidak memakai kunci API dan tidak mengirim alamat email.

## MODIS Terra dan Aqua

- **Produk:** MODIS Collection 6.1 NRT Hotspot / Active Fire Detections (MCD14DL), piksel 1 km, satelit Terra (`T`) dan Aqua (`A`) dalam satu berkas regional Asia Tenggara. Bersama-sama keduanya melintas empat kali sehari di atas kedua provinsi (Terra sekitar 07.30–09.10 dan 19.30–21.30 WIB, Aqua sekitar 14.40–16.20 dan 02.30–04.30 WIB pada Oktober 2026), sehingga ada data baru di luar lintasan VIIRS. NASA berencana menghentikan Terra dan Aqua mulai akhir 2026 atau awal 2027.
- **Pemetaan kolom:** `brightness` → `bright_ti4`, `bright_t31` → `bright_ti5`. Keyakinan MODIS berupa angka 0–100: 0–29 rendah, 30–79 sedang (nominal), 80–100 tinggi. Angka aslinya disimpan di `confidence_pct`. Baris rusak dilewati tanpa menggagalkan pengambilan.
- **Pemakaian:** piksel MODIS bisa bergeser 0,5–2,5 km dari titik api. Titik MODIS bergabung ke kejadian VIIRS pada hari yang sama bila ada titik VIIRS dalam jejak pikselnya (setengah ukuran piksel, paling jauh 1,5 km) ditambah 375 m, dan tidak pernah menggabungkan dua kejadian VIIRS. Sisanya menjadi kejadian "hanya MODIS" dengan keterangan ketidakpastian lokasi dan bobot skor yang lebih rendah. Lokasi kejadian, desa, dan jarak ke permukiman selalu dihitung dari titik VIIRS bila ada.
- **Sitasi:** MODIS Collection 61 NRT Hotspot / Active Fire Detections MCD14DL distributed from NASA FIRMS. Available on-line https://earthdata.nasa.gov/firms. doi: 10.5067/FIRMS/MODIS/MCD14DL.NRT.0061.

## Acknowledgement FIRMS

"We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS)." Berlaku untuk data VIIRS dan MODIS.
