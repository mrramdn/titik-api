import { describe, expect, it } from 'vitest';
import { cached, isApiRead, isImagery, isMapHost, isPhoto, isTile, PHOTO_MAX_AGE_SECONDS } from './swRoutes';

const at = (path: string) => new URL(path, 'https://titikapi.test');

describe('service worker caches', () => {
  it('keep no Esri imagery tile: no route takes /api/v1/imagery/, so it always comes from the network', () => {
    expect(isImagery(at('/api/v1/imagery/12/2082/3239'))).toBe(true);
    expect(isApiRead(at('/api/v1/imagery/12/2082/3239'))).toBe(false);
    expect(cached(at('/api/v1/imagery/12/2082/3239'))).toBe(false);
    expect(cached(new URL('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/12/2082/3239'))).toBe(false);
  });

  it('keep the other reads, tiles, photos and map hosts as before', () => {
    expect(isApiRead(at('/api/v1/config'))).toBe(true);
    expect(isApiRead(at('/api/v1/incidents?hours=24'))).toBe(true);
    expect(isApiRead(at('/api/v1/export/incidents.csv'))).toBe(false);
    expect(isTile(at('/api/v1/tiles/deteksi/9/400/260.mvt'))).toBe(true);
    expect(isPhoto(at('/uploads/foto.jpg'))).toBe(true);
    expect(isMapHost(new URL('https://tiles.openfreemap.org/styles/positron'))).toBe(true);
    expect(isMapHost(new URL('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/x.jpg'))).toBe(true);
    expect(cached(at('/peta'))).toBe(false);
  });

  it('keep a report photo no longer than the API lets a browser keep it, a day', () => {
    // GET /uploads/ answers Cache-Control: private, max-age=86400; the nightly demo reset deletes demo photos.
    expect(PHOTO_MAX_AGE_SECONDS).toBeGreaterThan(0);
    expect(PHOTO_MAX_AGE_SECONDS).toBeLessThanOrEqual(86_400);
  });
});
