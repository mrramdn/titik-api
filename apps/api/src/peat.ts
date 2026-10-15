import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

/** Web-Mercator pixel coordinates of a point at a zoom level (256 px tiles), as used by the GFW tile layers. */
export function lonLatToPixel(lon: number, lat: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  const radians = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * scale, ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale];
}

export interface PeatMask { isPeat(lon: number, lat: number): boolean }

/**
 * The GFW peatland layer over each covered province as a 1-bit raster (data/gambut-<province>.png), so every
 * detection is checked without a network call. Outside the rasters nothing counts as peat.
 */
export async function loadPeatMask(dataDir = resolve(process.env.DATA_DIR ?? resolve(import.meta.dirname, '../../../data'))): Promise<PeatMask> {
  const masks = await Promise.all(readdirSync(dataDir).filter(name => /^gambut-.+\.json$/.test(name)).map(async name => {
    const meta = JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')) as { zoom: number; tileX0: number; tileY0: number };
    const { data, info } = await sharp(resolve(dataDir, name.replace(/\.json$/, '.png'))).greyscale().raw().toBuffer({ resolveWithObject: true });
    return (lon: number, lat: number) => {
      const [px, py] = lonLatToPixel(lon, lat, meta.zoom);
      const x = Math.floor(px) - meta.tileX0 * 256, y = Math.floor(py) - meta.tileY0 * 256;
      return x >= 0 && y >= 0 && x < info.width && y < info.height && data[y * info.width + x]! > 127;
    };
  }));
  return { isPeat: (lon, lat) => masks.some(check => check(lon, lat)) };
}
