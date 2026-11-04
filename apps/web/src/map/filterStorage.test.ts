import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFilters } from '../api';
import { FILTERS_KEY, initialFilters, storedFilters, storeFilters } from './filterStorage';

/** A tab's sessionStorage. */
function fakeStorage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}

describe('the map screen filters kept for the tab', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => { storage = fakeStorage(); vi.stubGlobal('sessionStorage', storage); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('never keep the archive date, only the other filters', () => {
    storeFilters({ ...defaultFilters, hours: 72, peat: true, regency: 'Ogan Komering Ilir', tanggal: '2026-10-23' });
    const kept = JSON.parse(storage.items.get(FILTERS_KEY)!);
    expect(kept).not.toHaveProperty('tanggal');
    expect(kept).toMatchObject({ hours: 72, peat: true, regency: 'Ogan Komering Ilir' });
  });

  it('open live data without ?tanggal=, after an archive day was picked in the same tab', () => {
    // The visitor picked 23 October in the archive, then a notification or a task opens /kejadian/:id or /peta.
    storeFilters({ ...defaultFilters, sort: 'recent', tanggal: '2026-10-23' });
    for (const search of ['', '?x=1']) expect(initialFilters(search), search).toEqual({ ...defaultFilters, sort: 'recent', tanggal: '' });
  });

  it('ignore an archive date stored before the date stopped being kept', () => {
    storage.items.set(FILTERS_KEY, JSON.stringify({ ...defaultFilters, levels: ['tinggi'], tanggal: '2026-10-23' }));
    expect(storedFilters()).toEqual({ ...defaultFilters, levels: ['tinggi'], tanggal: '' });
    expect(initialFilters('')).toEqual({ ...defaultFilters, levels: ['tinggi'], tanggal: '' });
  });

  it('take the archive date from the address, which Back and Forward carry, and from nowhere else', () => {
    storeFilters({ ...defaultFilters, hours: 168, tanggal: '2026-10-22' });
    expect(initialFilters('?tanggal=2026-10-23')).toEqual({ ...defaultFilters, hours: 168, tanggal: '2026-10-23' });
    // Not a date: live data.
    expect(initialFilters('?tanggal=kemarin').tanggal).toBe('');
    // The dashboard's fire danger link opens live data whatever the address says.
    expect(initialFilters('?tanggal=2026-10-23', true).tanggal).toBe('');
  });

  it('start from the defaults without storage (private mode) or with a broken copy', () => {
    storage.items.set(FILTERS_KEY, '{not json');
    expect(initialFilters('')).toEqual(defaultFilters);
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
    expect(initialFilters('?tanggal=2026-10-23')).toEqual({ ...defaultFilters, tanggal: '2026-10-23' });
    expect(() => storeFilters(defaultFilters)).not.toThrow();
  });
});
