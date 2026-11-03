import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ArchiveDays, IngestStatus } from './api';
import { archiveTotal, replayDay } from './map/archive';
import { dataStalled, HeroActions, HeroStatus, landingText, liveNumbers, Numbers, shots, STACK } from './pages/Landing';

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

// 4 Nov 2026 04.01 WIB, the server's clock too.
const now = Date.parse('2026-11-03T21:01:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
/** GET /ingest/status whose last successful check was `minutes` ago; the newest pass 90 minutes before that. */
const ingest = (minutes: number): IngestStatus => ({
  serverTime: ago(0), runId: 9, intervalMinutes: 30, nextRunAt: ago(-20), lastRun: { finishedAt: ago(minutes), ok: true, error: null }, lastSuccessAt: ago(minutes), runs: [],
  satellites: [{ satellite: 'N21', label: 'NOAA-21 (VIIRS)', sensor: 'VIIRS', active: true, latestAcquisition: ago(minutes + 90), latestIngestedAt: ago(minutes), last24h: 614, medianLatencyMin: 95, nextWindow: null }],
});
const summary = { detections: 614, incidents: 291 };

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

  it('shows the 24-hour counts only while the data is current, and says since when it is not', () => {
    const fresh = liveNumbers(summary, ingest(10), archive, now);
    expect(fresh).toMatchObject({ stalledSince: null, detections: 614, incidents: 291, latest: { code: 'N21', at: ago(100) }, total: 23316 + 25614 + 311, first: '2026-10-08' });
    // No successful check for over 2 hours (the top bar's warning): fewer hotspots would mean missing data, not a quiet day.
    const stale = liveNumbers(summary, ingest(8 * 60 + 7), archive, now);
    expect(stale).toMatchObject({ stalledSince: ago(8 * 60 + 7), detections: null, incidents: null, latest: { code: 'N21' }, total: 23316 + 25614 + 311 });
    expect(liveNumbers({ detections: 0, incidents: 0 }, ingest(26 * 60), archive, now)).toMatchObject({ detections: null, incidents: null });
    // Before the status is known the counts wait for it.
    expect(liveNumbers(summary, null, archive, now)).toMatchObject({ stalledSince: null, detections: null, incidents: null, latest: null });
    expect(dataStalled(ingest(10), now)).toBe(false);
    expect(dataStalled(ingest(121), now)).toBe(true);
    expect(dataStalled(null, now)).toBe(false);
  });

  it('puts a line about stale data in place of the 24-hour counts, and drops "every 30 minutes" from the status line', () => {
    const numbers = (status: IngestStatus) => renderToStaticMarkup(createElement(Numbers, { archive, summary, status, now }));
    const counts = [landingText.id.hotspots24, landingText.id.incidents24];
    const current = numbers(ingest(10));
    for (const label of counts) expect(current).toContain(label);
    expect(current).toContain('<dd>614</dd>');
    expect(current).not.toContain('belum diperbarui');
    const stale = numbers(ingest(8 * 60 + 7));
    expect(stale).toContain('Data belum diperbarui sejak 3 Nov 19.54 WIB.');
    for (const label of counts) expect(stale).not.toContain(label);
    expect(stale).not.toContain('<dd>614</dd>');
    // The newest pass and the archive still hold.
    expect(stale).toContain('data satelit terbaru (NOAA-21)');
    expect(stale).toContain('dalam arsip sejak 8 Okt 2026');
    const status = (stalled: boolean) => renderToStaticMarkup(createElement(HeroStatus, { stalled }));
    expect(status(false)).toContain('diperbarui tiap 30 menit');
    expect(status(true)).not.toContain('30 menit');
    expect(status(true)).toContain('Demo dengan data satelit asli');
    expect(status(true)).toContain('bukan sistem peringatan resmi');
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
