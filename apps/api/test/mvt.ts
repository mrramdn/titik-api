// A small reader for Mapbox Vector Tiles (protobuf), enough for the tests: layer names, feature properties and the
// bounding box of each feature's geometry in tile units. Spec: https://github.com/mapbox/vector-tile-spec (2.1).
export interface MvtFeature { properties: Record<string, string | number | boolean>; bbox: [number, number, number, number] | null }
export interface MvtLayer { name: string; extent: number; features: MvtFeature[] }

class Reader {
  position = 0;
  constructor(readonly bytes: Uint8Array, readonly end = bytes.length) {}
  get done() { return this.position >= this.end; }
  varint() {
    let result = 0, shift = 0, byte: number;
    do { byte = this.bytes[this.position++]!; result += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80);
    return result;
  }
  key() { const key = this.varint(); return { field: Math.floor(key / 8), wire: key % 8 }; }
  sub() { const length = this.varint(); const reader = new Reader(this.bytes, this.position + length); reader.position = this.position; this.position += length; return reader; }
  text() { const reader = this.sub(); return Buffer.from(reader.bytes.subarray(reader.position, reader.end)).toString('utf8'); }
  packed() { const reader = this.sub(); const values: number[] = []; while (!reader.done) values.push(reader.varint()); return values; }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.position += 8;
    else if (wire === 2) this.position += this.varint();
    else if (wire === 5) this.position += 4;
    else throw new Error(`wire type ${wire}`);
  }
}

const zigzag = (n: number) => (n % 2 ? -(n + 1) / 2 : n / 2);

function value(reader: Reader): string | number | boolean {
  let result: string | number | boolean = '';
  while (!reader.done) {
    const { field, wire } = reader.key();
    if (field === 1) result = reader.text();
    else if (field === 2) { result = Buffer.from(reader.bytes.subarray(reader.position, reader.position + 4)).readFloatLE(0); reader.position += 4; }
    else if (field === 3) { result = Buffer.from(reader.bytes.subarray(reader.position, reader.position + 8)).readDoubleLE(0); reader.position += 8; }
    else if (field === 4 || field === 5) result = reader.varint();
    else if (field === 6) result = zigzag(reader.varint());
    else if (field === 7) result = Boolean(reader.varint());
    else reader.skip(wire);
  }
  return result;
}

/** The bounding box of a geometry command stream (MoveTo 1, LineTo 2, ClosePath 7; zigzag deltas). */
function bbox(commands: number[]): MvtFeature['bbox'] {
  let x = 0, y = 0, i = 0;
  const xs: number[] = [], ys: number[] = [];
  while (i < commands.length) {
    const command = commands[i]! & 7, count = commands[i]! >> 3;
    i++;
    if (command === 7) continue;
    for (let k = 0; k < count; k++) { x += zigzag(commands[i++]!); y += zigzag(commands[i++]!); xs.push(x); ys.push(y); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}

export function readTile(buffer: Uint8Array): MvtLayer[] {
  const tile = new Reader(buffer);
  const layers: MvtLayer[] = [];
  while (!tile.done) {
    const { field, wire } = tile.key();
    if (field !== 3) { tile.skip(wire); continue; }
    const layer = tile.sub();
    let name = '', extent = 4096;
    const keys: string[] = [], values: (string | number | boolean)[] = [], raw: { tags: number[]; geometry: number[] }[] = [];
    while (!layer.done) {
      const entry = layer.key();
      if (entry.field === 1) name = layer.text();
      else if (entry.field === 3) keys.push(layer.text());
      else if (entry.field === 4) values.push(value(layer.sub()));
      else if (entry.field === 5) extent = layer.varint();
      else if (entry.field === 2) {
        const feature = layer.sub();
        const item = { tags: [] as number[], geometry: [] as number[] };
        while (!feature.done) {
          const part = feature.key();
          if (part.field === 2) item.tags = feature.packed();
          else if (part.field === 4) item.geometry = feature.packed();
          else feature.skip(part.wire);
        }
        raw.push(item);
      } else layer.skip(entry.wire);
    }
    layers.push({ name, extent, features: raw.map(item => ({
      properties: Object.fromEntries(Array.from({ length: item.tags.length / 2 }, (_, k) => [keys[item.tags[2 * k]!]!, values[item.tags[2 * k + 1]!]!])),
      bbox: bbox(item.geometry) })) });
  }
  return layers;
}
