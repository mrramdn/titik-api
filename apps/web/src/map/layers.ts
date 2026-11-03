// Sources and layers MapView adds over the base style, kept apart so their URLs and zoom ranges can be tested.
import { tanggalParam } from '../api';

/** Below this zoom the map shows one bubble per regency; incidents and hotspots appear from it. */
export const OVERVIEW_ZOOM = 8;

/** Vector tiles for the incident or hotspot layer. `version` changes with every ingest run; `tanggal` asks for an archive day. */
export const tileUrls = (layer: 'kejadian' | 'deteksi', hours: number, version: number, tanggal: string, origin: string) =>
  [`${origin}/api/v1/tiles/${layer}/{z}/{x}/{y}.mvt?hours=${hours}&v=${version}${tanggalParam(tanggal)}`];
