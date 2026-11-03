import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ArchiveDays } from './api';
import { archiveTotal, replayDay } from './map/archive';
import { HeroActions, landingText, shots, STACK } from './pages/Landing';

/** Width and height from a WebP file's header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(file: Buffer) {
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = file.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') { const bits = file.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  if (chunk === 'VP8X') return { width: file.readUIntLE(24, 3) + 1, height: file.readUIntLE(27, 3) + 1 };
  return null;
}

/** The hero's buttons as HTML, for the busiest day `replay` ('' without one). */
const heroActions = (replay: string) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HeroActions, { replay })));

describe('the landing page', () => {
  const archive: ArchiveDays = { first: '2026-10-08', last: '2026-11-02', days: [
    { date: '2026-10-22', detections: 23316, incidents: 3237 },
    { date: '2026-10-23', detections: 25614, incidents: 3001 },
    { date: '2026-10-28', detections: 311, incidents: 47 },
  ] };

  it('replays the day with the most hotspots, not the one with the most incidents', () => {
    expect(replayDay(archive)).toBe('2026-10-23');
    expect(replayDay(null)).toBe('');
    expect(replayDay(undefined)).toBe('');
    expect(replayDay({ first: '2026-10-08', last: '2026-10-07', days: [] })).toBe('');
    expect(replayDay({ ...archive, days: [{ date: '2026-10-09', detections: 0, incidents: 0 }] })).toBe('');
    expect(replayDay({ first: '', last: '' } as unknown as ArchiveDays)).toBe('');
  });

  it('shows "Putar ulang hari tersibuk" with that day and its map link, and hides it without a busiest day', () => {
    const html = heroActions(replayDay(archive));
    expect(html).toContain('Putar ulang hari tersibuk · 23 Okt 2026');
    expect(html).toContain('href="/peta?tanggal=2026-10-23"');
    const without = heroActions(replayDay(null));
    expect(without).not.toContain('Putar ulang');
    expect(without).not.toContain('tanggal=');
    // The other buttons stay: the map and the two demo roles.
    for (const html of [heroActions('2026-10-23'), without]) {
      expect(html).toContain('href="/peta"');
      expect(html).toContain('href="/dasbor?lihat=bpbd"');
      expect(html).toContain('href="/tugas?lihat=mpa"');
    }
  });

  it('adds up the archive for its total', () => {
    expect(archiveTotal(archive)).toBe(23316 + 25614 + 311);
    expect(archiveTotal({ ...archive, days: [] })).toBe(0);
    expect(archiveTotal(null)).toBeNull();
  });

  it('says everything in Indonesian and English, with the same placeholders', () => {
    const id = Object.keys(landingText.id).sort(), en = Object.keys(landingText.en).sort();
    expect(en).toEqual(id);
    const holes = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of id as (keyof typeof landingText.id)[]) {
      expect(landingText.id[key].trim(), key).not.toBe('');
      expect(landingText.en[key].trim(), key).not.toBe('');
      expect(holes(landingText.en[key]), key).toEqual(holes(landingText.id[key]));
    }
  });

  it('speaks plainly: no exclamation marks, hotspots never called fire, no award text yet', () => {
    const all = [...Object.values(landingText.id), ...Object.values(landingText.en)];
    for (const value of all) expect(value).not.toMatch(/!/);
    // "Titik Api" and "Masyarakat Peduli Api" are names; a detection is a titik panas.
    for (const value of Object.values(landingText.id)) expect(value.replace(/Titik Api|Peduli Api/g, ''), value).not.toMatch(/\bapi\b/i);
    for (const value of Object.values(landingText.en)) expect(value, value).not.toMatch(/\bfires? (?:detected|detection|points?)\b|\bactive fires?\b/i);
    for (const value of all) expect(value).not.toMatch(/juara|pemenang|winner|award|penghargaan|petpals/i);
    expect(landingText.id.title).toBe('Peringatan titik panas tingkat desa');
    expect(landingText.en.title).toBe('Village-level hotspot alerts');
    expect(landingText.id.status3).toBe('bukan sistem peringatan resmi');
    expect(landingText.en.status3).toBe('not an official warning system');
  });

  it('shows real screenshots at the size its markup says, each a light WebP file', () => {
    for (const [name, shot] of Object.entries(shots)) {
      const variants: [string, number, number][] = [[shot.src, shot.width, shot.height]];
      if ('small' in shot) variants.push([shot.small, 800, Math.round((shot.height * 800) / shot.width)]);
      for (const [src, width, height] of variants) {
        expect(src, name).toMatch(/^\/landing\/[a-z0-9-]+\.webp$/);
        const file = readFileSync(fileURLToPath(new URL(`../public${src}`, import.meta.url)));
        expect(webpSize(file), src).toEqual({ width, height });
        expect(file.length, src).toBeLessThan(150 * 1024);
      }
    }
    expect(STACK).toEqual(['Fastify', 'TypeScript', 'PostgreSQL + PostGIS', 'React', 'MapLibre', 'PWA', 'Docker']);
  });
});
