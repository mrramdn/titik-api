import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Regency { name: string; villages: number; bbox: number[] }
export interface Province { name: string; villages: number; bbox: number[]; regencies: Regency[] }
interface RegionState { provinces: Province[]; province: string; setProvince(name: string): void; bbox: [number, number, number, number]; query: string }
const RegionContext = createContext<RegionState | null>(null);
const key = 'titikapi.province';
export const ALL_BOUNDS: [number, number, number, number] = [102.0, -5.0, 115.9, 0.85];

export function RegionProvider({ children }: { children: ReactNode }) {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [province, setProvinceState] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  useEffect(() => { api<{ data: Province[] }>('/regions').then(body => setProvinces(body.data)).catch(() => {}); }, []);
  const value = useMemo<RegionState>(() => {
    const p = provinces.find(item => item.name === province);
    return {
      provinces, province,
      setProvince(name) { setProvinceState(name); try { localStorage.setItem(key, name); } catch { /* private mode */ } },
      bbox: (p?.bbox as [number, number, number, number]) ?? ALL_BOUNDS,
      query: province ? `&province=${encodeURIComponent(province)}` : '',
    };
  }, [provinces, province]);
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion() {
  const value = useContext(RegionContext);
  if (!value) throw new Error('RegionProvider missing');
  return value;
}
export const shortProvince = (name: string) => (name === 'Sumatera Selatan' ? 'Sumsel' : name === 'Kalimantan Tengah' ? 'Kalteng' : name);
