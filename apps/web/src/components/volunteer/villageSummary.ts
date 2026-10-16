// Seven-day numbers for one village and the WhatsApp text a village head or volunteer shares with them.
import type { Incident, Status } from '../../api';
import { formatter } from '../../format';
import { dict, fill, type Lang } from '../../i18n';
import { isChecked } from './sort';

const words = dict({
  id: {
    head: 'Ringkasan Desa {name}, Kec. {district}, {regency}',
    week: '7 hari terakhir: {n} kejadian titik panas, {high} prioritas tinggi, {checked} sudah dicek.',
    day: '24 jam terakhir: {n} kejadian.',
    lastCheck: 'Cek lapangan terakhir: {time} WIB, {status}.',
    noCheck: 'Belum ada cek lapangan dalam 7 hari.',
    caveat: 'Titik panas perlu dicek di lapangan.',
  },
  en: {
    head: 'Summary for {name}, {district} district, {regency}',
    week: 'Last 7 days: {n} hotspot incidents, {high} high priority, {checked} field checked.',
    day: 'Last 24 hours: {n} incidents.',
    lastCheck: 'Last field check: {time} WIB, {status}.',
    noCheck: 'No field check in the last 7 days.',
    caveat: 'Hotspots need a field check.',
  },
});

export interface VillageStats { total: number; day: number; high: number; checked: number; open: number; lastCheck: { at: string; status: Status } | null }

/** Counts over the incidents of the last 7 days (what GET /villages/:id returns). */
export function villageStats(incidents: Incident[], now = Date.now()): VillageStats {
  let lastCheck: VillageStats['lastCheck'] = null;
  for (const incident of incidents) {
    const check = incident.latestCheck ?? (incident.firstVerifiedAt && incident.latestStatus ? { observedAt: incident.firstVerifiedAt, status: incident.latestStatus } : null);
    if (check && (!lastCheck || check.observedAt > lastCheck.at)) lastCheck = { at: check.observedAt, status: check.status };
  }
  const checked = incidents.filter(isChecked).length;
  return {
    total: incidents.length,
    day: incidents.filter(incident => now - new Date(incident.lastDetectedAt).getTime() < 24 * 3600_000).length,
    high: incidents.filter(incident => incident.level === 'tinggi').length,
    checked, open: incidents.length - checked, lastCheck,
  };
}

export function villageSummaryText(village: { id: string; name: string; district: string; regency: string }, incidents: Incident[], lang: Lang) {
  const w = words[lang], f = formatter(lang), stats = villageStats(incidents);
  return [
    fill(w.head, { name: village.name, district: village.district, regency: village.regency }),
    fill(w.week, { n: f.num(stats.total), high: f.num(stats.high), checked: f.num(stats.checked) }),
    fill(w.day, { n: f.num(stats.day) }),
    stats.lastCheck ? fill(w.lastCheck, { time: f.dayTime(stats.lastCheck.at), status: f.status(stats.lastCheck.status).toLowerCase() }) : w.noCheck,
    w.caveat,
    `${typeof location === 'undefined' ? '' : location.origin}/desa/${village.id}`,
  ].join('\n');
}
