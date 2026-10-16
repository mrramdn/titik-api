// The daily recap as plain text for WhatsApp, in the reader's language. One fact per line.
import type { AssignmentStatus, Recap, Status } from '../../api';
import { dict, fill, type Lang } from '../../i18n';
import { formatter } from '../../format';
import { assignmentLabel, statusLabel } from '../../i18n/common';

const words = dict({
  id: {
    title: 'Rekap harian Titik Api, {place}',
    incidents: 'Kejadian: {n}, prioritas tinggi {high}', checked: 'Sudah dicek: {n} dari {total} ({share})',
    response: 'Waktu tanggap (median): {time}', falseAlarms: 'Alarm palsu: {n}', detections: 'Titik panas: {n}',
    regencies: 'Kabupaten dengan kejadian terbanyak:', regency: '{name}: {n} kejadian, {high} prioritas tinggi, {checked} dicek',
    checks: 'Hasil cek lapangan: {list}', assignments: 'Penugasan: {list}', link: 'Rincian: {url}',
  },
  en: {
    title: 'Titik Api daily recap, {place}',
    incidents: 'Incidents: {n}, high priority {high}', checked: 'Checked: {n} of {total} ({share})',
    response: 'Response time (median): {time}', falseAlarms: 'False alarms: {n}', detections: 'Hotspots: {n}',
    regencies: 'Regencies with the most incidents:', regency: '{name}: {n} incidents, {high} high priority, {checked} checked',
    checks: 'Field check results: {list}', assignments: 'Assignments: {list}', link: 'Details: {url}',
  },
});

export const statusOrder: Status[] = ['api_aktif', 'asap_bara', 'bakar_terkendali', 'alarm_palsu', 'tidak_terjangkau'];
export const assignmentOrder: AssignmentStatus[] = ['ditugaskan', 'menuju', 'selesai', 'dibatalkan'];

/** "Jumat, 16 Oktober 2026" / "Friday, 16 October 2026" for a YYYY-MM-DD date in WIB. */
export function longDate(date: string, lang: Lang) {
  const noon = new Date(`${date}T12:00:00+07:00`);
  if (Number.isNaN(noon.getTime())) return date;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(noon);
}

/** Share of checked incidents, from the server when it sends one. */
export const checkedShare = (totals: Recap['totals']) => totals.checkedShare ?? (totals.incidents ? totals.checked / totals.incidents : null);

export function recapText(recap: Recap, lang: Lang, place: string, url: string) {
  const f = formatter(lang), w = words[lang];
  const totals = recap.totals;
  const lines = [
    fill(w.title, { place }),
    longDate(recap.date, lang),
    '',
    fill(w.incidents, { n: f.num(totals.incidents), high: f.num(totals.high) }),
    fill(w.checked, { n: f.num(totals.checked), total: f.num(totals.incidents), share: f.percent(checkedShare(totals)) }),
    fill(w.response, { time: f.duration(totals.medianMinutes) }),
    fill(w.falseAlarms, { n: f.num(totals.falseAlarms) }),
    fill(w.detections, { n: f.num(totals.detections) }),
  ];
  const regencies = (recap.regencies ?? []).filter(row => row.incidents > 0).slice(0, 3);
  if (regencies.length) {
    lines.push('', w.regencies);
    for (const row of regencies) lines.push(fill(w.regency, { name: row.name, n: f.num(row.incidents), high: f.num(row.high), checked: f.num(row.checked) }));
  }
  const checks = statusOrder.filter(status => (recap.checks?.[status] ?? 0) > 0)
    .map(status => `${f.num(recap.checks[status] ?? 0)} ${statusLabel[lang][status].toLowerCase()}`);
  const tasks = assignmentOrder.filter(status => (recap.assignments?.[status] ?? 0) > 0)
    .map(status => `${f.num(recap.assignments[status])} ${assignmentLabel[lang][status].toLowerCase()}`);
  if (checks.length || tasks.length) lines.push('');
  if (checks.length) lines.push(fill(w.checks, { list: checks.join(', ') }));
  if (tasks.length) lines.push(fill(w.assignments, { list: tasks.join(', ') }));
  lines.push('', fill(w.link, { url }));
  return lines.join('\n');
}
