// Builds the committed reference files in /data from public sources. Run once by hand:
//   pnpm --filter @titikapi/api exec tsx scripts/build-reference.ts <villages.geojson> <tile-dir> --places a.json,b.json --industry c.json,d.json
// villages.geojson: HDX COD-AB admin4 for the covered provinces, simplified (see data/SOURCES.md for the commands).
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { lonLatToPixel } from '../src/peat.js';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1]!.split(',') : []; };
const [villagesPath, tileDir] = args;
if (!villagesPath || !tileDir) throw new Error('usage: build-reference.ts <villages> <tile-dir> --places a,b --industry c,d');
const out = resolve(import.meta.dirname, '../../../data');
await mkdir(out, { recursive: true });

// The covered provinces, by BPS code. Everything else in the pipeline follows from the village polygons.
const regions = [{ id: 'sumsel', name: 'Sumatera Selatan', pcode: 'ID16' }, { id: 'kalteng', name: 'Kalimantan Tengah', pcode: 'ID62' }];
const zoom = 11;

type Ring = number[][];
type Polygon = Ring[];
type Feature = { properties: Record<string, string>; geometry: { type: string; coordinates: any } };
const villages = JSON.parse(await readFile(villagesPath, 'utf8')) as { features: Feature[] };
// COD-AB keeps lakes as pseudo-villages with a code ending in 888888 (Danau Ranau): they are not villages.
villages.features = villages.features.filter(f => !f.properties.adm4_pcode!.endsWith('888888'));
const polygonsOf = (geometry: Feature['geometry']): Polygon[] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}
const inPolygons = (x: number, y: number, polygons: Polygon[]) => polygons.some(([outer, ...holes]) => inRing(x, y, outer!) && !holes.some(hole => inRing(x, y, hole)));
const bboxOf = (features: Feature[]) => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of features) for (const p of polygonsOf(f.geometry)) for (const [x, y] of p[0]!) { w = Math.min(w, x!); e = Math.max(e, x!); s = Math.min(s, y!); n = Math.max(n, y!); }
  return [w, s, e, n] as const;
};

// One 1-bit peat raster per province from the GFW peatland tiles (zoom 11, about 76 m per pixel).
const masks: { isPeat(lon: number, lat: number): boolean }[] = [];
for (const old of ['gambut-oki-mask.png', 'gambut-oki-mask.json', 'desa-oki.geojson', 'permukiman-oki.geojson', 'industri-oki.geojson']) await rm(join(out, old), { force: true });
for (const region of regions) {
  const own = villages.features.filter(f => f.properties.adm1_pcode === region.pcode);
  const [w, s, e, n] = bboxOf(own);
  const m = 0.03;
  const [px0, py0] = lonLatToPixel(w - m, n + m, zoom), [px1, py1] = lonLatToPixel(e + m, s - m, zoom);
  const tx0 = Math.floor(px0 / 256), ty0 = Math.floor(py0 / 256), tx1 = Math.floor(px1 / 256), ty1 = Math.floor(py1 / 256);
  const width = (tx1 - tx0 + 1) * 256, height = (ty1 - ty0 + 1) * 256;
  const mask = new Uint8Array(width * height);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const file = join(tileDir, `${zoom}-${tx}-${ty}.png`);
    try { await access(file); } catch { continue; }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]! > 0) mask[((ty - ty0) * 256 + y) * width + (tx - tx0) * 256 + x] = 255;
  }
  await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } }).png({ compressionLevel: 9, palette: true, colours: 2 }).toFile(join(out, `gambut-${region.id}.png`));
  const meta = { region: region.name, zoom, tileX0: tx0, tileY0: ty0, width, height, bbox: [w, s, e, n],
    source: 'Global Forest Watch / Global Nature Watch, "Global peatland extent" v20230315 (Indonesia: Miettinen et al. 2016), tiles gfw_peatlands/v20230315/is',
    license: 'CC BY 4.0', retrieved: new Date().toISOString().slice(0, 10) };
  await writeFile(join(out, `gambut-${region.id}.json`), JSON.stringify(meta, null, 2) + '\n');
  masks.push({ isPeat(lon, lat) {
    const [px, py] = lonLatToPixel(lon, lat, zoom);
    const x = Math.floor(px) - tx0 * 256, y = Math.floor(py) - ty0 * 256;
    return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 255;
  } });
  console.log(`${region.name}: ${own.length} villages, peat mask ${width}x${height}`);
}
const isPeat = (lon: number, lat: number) => masks.some(mask => mask.isPeat(lon, lat));

// Settlements and village centres from OpenStreetMap place nodes.
const load = async (files: string[]) => (await Promise.all(files.map(async f => JSON.parse(await readFile(f, 'utf8')).elements as any[]))).flat();
const places = [...new Map((await load(flag('places'))).filter(p => p.tags?.name).map(p => [p.id, p])).values()] as { id: number; lat: number; lon: number; tags: Record<string, string> }[];
const normal = (name: string) => name.toLowerCase().replace(/\b(desa|kelurahan|dusun)\b/g, '').replace(/[^a-z0-9]/g, '');
const features = villages.features.map(feature => {
  const p = feature.properties;
  const polygons = polygonsOf(feature.geometry);
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const polygon of polygons) for (const [x, y] of polygon[0]!) { minX = Math.min(minX, x!); maxX = Math.max(maxX, x!); minY = Math.min(minY, y!); maxY = Math.max(maxY, y!); }
  // About 400 samples per village whatever its size: the villages of Central Kalimantan can be a thousand times larger than those of a town.
  let step = Math.max(0.0004, Math.sqrt(((maxX - minX) * (maxY - minY)) / 400)), total = 0, peat = 0;
  for (let attempt = 0; attempt < 3 && total < 40; attempt++, step /= 3) {
    total = 0; peat = 0;
    for (let y = minY + step / 2; y < maxY; y += step) for (let x = minX + step / 2; x < maxX; x += step) {
      if (!inPolygons(x, y, polygons)) continue;
      total++; if (isPeat(x, y)) peat++;
    }
  }
  const inside = places.filter(place => place.lon >= minX && place.lon <= maxX && place.lat >= minY && place.lat <= maxY
    && ['village', 'town', 'city', 'suburb', 'neighbourhood', 'hamlet'].includes(place.tags.place!) && inPolygons(place.lon, place.lat, polygons));
  const target = normal(p.adm4_name!);
  const match = inside.find(place => normal(place.tags.name!) === target) ?? inside.find(place => normal(place.tags.name!).includes(target) || target.includes(normal(place.tags.name!)));
  return { type: 'Feature', properties: {
    id: p.adm4_pcode, name: p.adm4_name, district: p.adm3_name, regency: p.adm2_name, province: p.adm1_name,
    peat_share: total ? Math.round((peat / total) * 1000) / 1000 : 0,
    center: match ? [Math.round(match.lon * 1e6) / 1e6, Math.round(match.lat * 1e6) / 1e6] : null,
  }, geometry: feature.geometry };
});
await writeFile(join(out, 'desa.geojson'), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
console.log(`villages: ${features.length}, OSM centre matched: ${features.filter(f => f.properties.center).length}, with peat: ${features.filter(f => f.properties.peat_share > 0).length}`);

await writeFile(join(out, 'permukiman.geojson'), JSON.stringify({ type: 'FeatureCollection', features: places
  .filter(place => ['village', 'town', 'city', 'suburb', 'neighbourhood', 'hamlet', 'isolated_dwelling'].includes(place.tags.place!))
  .map(place => ({ type: 'Feature', properties: { id: place.id, name: place.tags.name, kind: place.tags.place },
    geometry: { type: 'Point', coordinates: [place.lon, place.lat] } })) }) + '\n');

// Industrial sites: labelled by kind only, never by company name.
const kindLabel = (tags: Record<string, string>) => tags.man_made === 'flare' ? 'Suar gas (OSM)' : tags.power === 'plant' ? 'Pembangkit listrik (OSM)'
  : tags.man_made === 'works' ? 'Fasilitas industri (OSM)' : 'Kawasan industri (OSM)';
const industry = [...new Map((await load(flag('industry'))).map(e => [`${e.type}/${e.id}`, e])).values()]
  .map(e => ({ ...e, point: e.center ?? { lat: e.lat, lon: e.lon } })).filter(e => Number.isFinite(e.point?.lat));
await writeFile(join(out, 'industri.geojson'), JSON.stringify({ type: 'FeatureCollection', features: industry.map(e => ({ type: 'Feature',
  properties: { id: `${e.type}/${e.id}`, label: kindLabel(e.tags ?? {}), radius_m: 600 },
  geometry: { type: 'Point', coordinates: [e.point.lon, e.point.lat] } })) }) + '\n');
console.log(`settlements: ${places.length}; industrial sites: ${industry.length}`);
