// Builds the committed reference files in /data from public sources. Run once by hand:
//   pnpm --filter @titikapi/api exec tsx scripts/build-reference.ts <oki-raw.geojson> <osm-places.json> <osm-industry.json> <tile-cache-dir>
// oki-raw.geojson: HDX COD-AB admin4 for adm2_pcode ID1602 (see data/SOURCES.md for the ogr2ogr command).
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { lonLatToPixel } from '../src/peat.js';

const [villagesPath, placesPath, industryPath, tileDir] = process.argv.slice(2);
if (!villagesPath || !placesPath || !industryPath || !tileDir) throw new Error('usage: build-reference.ts <villages> <places> <industry> <tile-dir>');
const out = resolve(import.meta.dirname, '../../../data');
await mkdir(out, { recursive: true });
await mkdir(tileDir, { recursive: true });

type Ring = number[][];
type Polygon = Ring[];
const villages = JSON.parse(await readFile(villagesPath, 'utf8')) as { features: { properties: Record<string, string>; geometry: { type: string; coordinates: any } }[] };
const polygonsOf = (geometry: { type: string; coordinates: any }): Polygon[] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}
const inPolygons = (x: number, y: number, polygons: Polygon[]) => polygons.some(([outer, ...holes]) => inRing(x, y, outer!) && !holes.some(hole => inRing(x, y, hole)));

// Bounding box of the regency plus a margin, in z12 tiles of the GFW peatland layer.
let west = 180, south = 90, east = -180, north = -90;
for (const feature of villages.features) for (const polygon of polygonsOf(feature.geometry)) for (const [x, y] of polygon[0]!) {
  west = Math.min(west, x!); east = Math.max(east, x!); south = Math.min(south, y!); north = Math.max(north, y!);
}
const margin = 0.03;
const zoom = 12;
const [px0, py0] = lonLatToPixel(west - margin, north + margin, zoom);
const [px1, py1] = lonLatToPixel(east + margin, south - margin, zoom);
const tx0 = Math.floor(px0 / 256), ty0 = Math.floor(py0 / 256), tx1 = Math.floor(px1 / 256), ty1 = Math.floor(py1 / 256);
const width = (tx1 - tx0 + 1) * 256, height = (ty1 - ty0 + 1) * 256;
console.log(`bbox ${west},${south},${east},${north}; tiles x ${tx0}-${tx1}, y ${ty0}-${ty1} (${(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} tiles, ${width}x${height} px)`);

const mask = new Uint8Array(width * height);
const colours = new Map<string, number>();
const jobs: [number, number][] = [];
for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
async function tile(tx: number, ty: number) {
  const file = join(tileDir, `${zoom}-${tx}-${ty}.png`);
  try { await access(file); } catch {
    const response = await fetch(`https://tiles.globalforestwatch.org/gfw_peatlands/v20230315/is/${zoom}/${tx}/${ty}.png`);
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`tile ${tx}/${ty}: HTTP ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3]! === 0) continue;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    colours.set(key, (colours.get(key) ?? 0) + 1);
    mask[((ty - ty0) * 256 + y) * width + (tx - tx0) * 256 + x] = 255;
  }
}
for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(([tx, ty]) => tile(tx, ty)));
console.log('peat pixel colours (top):', [...colours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } }).png({ compressionLevel: 9, palette: true, colours: 2 }).toFile(join(out, 'gambut-oki-mask.png'));
const meta = { zoom, tileX0: tx0, tileY0: ty0, width, height,
  source: 'Global Forest Watch / Global Nature Watch, "Global peatland extent" v20230315 (Indonesia: Miettinen et al. 2016), tiles gfw_peatlands/v20230315/is',
  license: 'CC BY 4.0', retrieved: new Date().toISOString().slice(0, 10) };
await writeFile(join(out, 'gambut-oki-mask.json'), JSON.stringify(meta, null, 2) + '\n');
const isPeat = (lon: number, lat: number) => {
  const [px, py] = lonLatToPixel(lon, lat, zoom);
  const x = Math.floor(px) - tx0 * 256, y = Math.floor(py) - ty0 * 256;
  return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 255;
};

// Settlements and village centres from OpenStreetMap place nodes.
const places = (JSON.parse(await readFile(placesPath, 'utf8')).elements as { id: number; lat: number; lon: number; tags: Record<string, string> }[])
  .filter(place => place.tags.name);
const normal = (name: string) => name.toLowerCase().replace(/\b(desa|kelurahan|dusun)\b/g, '').replace(/[^a-z0-9]/g, '');
const features = villages.features.map(feature => {
  const p = feature.properties;
  const polygons = polygonsOf(feature.geometry);
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const polygon of polygons) for (const [x, y] of polygon[0]!) { minX = Math.min(minX, x!); maxX = Math.max(maxX, x!); minY = Math.min(minY, y!); maxY = Math.max(maxY, y!); }
  let step = 0.0015, total = 0, peat = 0;
  for (let attempt = 0; attempt < 3 && total < 40; attempt++, step /= 3) {
    total = 0; peat = 0;
    for (let y = minY + step / 2; y < maxY; y += step) for (let x = minX + step / 2; x < maxX; x += step) {
      if (!inPolygons(x, y, polygons)) continue;
      total++; if (isPeat(x, y)) peat++;
    }
  }
  const inside = places.filter(place => ['village', 'town', 'city', 'suburb', 'neighbourhood', 'hamlet'].includes(place.tags.place!) && inPolygons(place.lon, place.lat, polygons));
  const target = normal(p.adm4_name!);
  const match = inside.find(place => normal(place.tags.name!) === target) ?? inside.find(place => normal(place.tags.name!).includes(target) || target.includes(normal(place.tags.name!)));
  return { type: 'Feature', properties: {
    id: p.adm4_pcode, name: p.adm4_name, district: p.adm3_name, regency: p.adm2_name, province: p.adm1_name,
    peat_share: total ? Math.round((peat / total) * 1000) / 1000 : 0,
    center: match ? [Math.round(match.lon * 1e6) / 1e6, Math.round(match.lat * 1e6) / 1e6] : null,
  }, geometry: feature.geometry };
});
await writeFile(join(out, 'desa-oki.geojson'), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
console.log(`villages: ${features.length}, OSM centre matched: ${features.filter(f => f.properties.center).length}, with peat: ${features.filter(f => f.properties.peat_share > 0).length}`);

await writeFile(join(out, 'permukiman-oki.geojson'), JSON.stringify({ type: 'FeatureCollection', features: places
  .filter(place => ['village', 'town', 'city', 'suburb', 'neighbourhood', 'hamlet', 'isolated_dwelling'].includes(place.tags.place!))
  .map(place => ({ type: 'Feature', properties: { id: place.id, name: place.tags.name, kind: place.tags.place },
    geometry: { type: 'Point', coordinates: [place.lon, place.lat] } })) }) + '\n');

// Industrial sites: labelled by kind only, never by company name.
const kindLabel = (tags: Record<string, string>) => tags.man_made === 'flare' ? 'Suar gas (OSM)' : tags.power === 'plant' ? 'Pembangkit listrik (OSM)'
  : tags.man_made === 'works' ? 'Fasilitas industri (OSM)' : 'Kawasan industri (OSM)';
const industry = (JSON.parse(await readFile(industryPath, 'utf8')).elements as { id: number; type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags: Record<string, string> }[])
  .map(element => ({ ...element, point: element.center ?? { lat: element.lat!, lon: element.lon! } }))
  .filter(element => Number.isFinite(element.point.lat));
await writeFile(join(out, 'industri-oki.geojson'), JSON.stringify({ type: 'FeatureCollection', features: industry.map(element => ({ type: 'Feature',
  properties: { id: `${element.type}/${element.id}`, label: kindLabel(element.tags), radius_m: 600 },
  geometry: { type: 'Point', coordinates: [element.point.lon, element.point.lat] } })) }) + '\n');
console.log(`settlements written; industrial sites: ${industry.length}`);
