import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export type Bbox = [number, number, number, number];
export interface Regency { name: string; villages: number; bbox: number[] }
export interface Province { name: string; villages: number; bbox: number[]; regencies: Regency[] }
/** A regency together with the province it belongs to. */
export interface RegencyRef extends Regency { province: string }
interface RegionState {
  provinces: Province[]; province: string; setProvince(name: string): void; bbox: Bbox; query: string;
  /** Regencies of the chosen province, or of both provinces when none is chosen. */
  regencies: RegencyRef[];
  findRegency(name: string): RegencyRef | null;
}
const RegionContext = createContext<RegionState | null>(null);
const key = 'titikapi.province';
export const ALL_BOUNDS: Bbox = [102.0, -5.0, 115.9, 0.85];

export function RegionProvider({ children }: { children: ReactNode }) {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [province, setProvinceState] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  useEffect(() => { api<{ data: Province[] }>('/regions').then(body => setProvinces(body.data)).catch(() => {}); }, []);
  const value = useMemo<RegionState>(() => {
    const p = provinces.find(item => item.name === province);
    const all = provinces.flatMap(item => item.regencies.map(regency => ({ ...regency, province: item.name })));
    const regencies = province ? all.filter(regency => regency.province === province) : all;
    return {
      provinces, province, regencies,
      setProvince(name) { setProvinceState(name); try { localStorage.setItem(key, name); } catch { /* private mode */ } },
      bbox: (p?.bbox as Bbox) ?? ALL_BOUNDS,
      query: province ? `&province=${encodeURIComponent(province)}` : '',
      findRegency: name => all.find(regency => regency.name === name && (!province || regency.province === province)) ?? all.find(regency => regency.name === name) ?? null,
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
