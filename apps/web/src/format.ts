import type { Level, Status } from './api';

const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
export const wib = (iso: string | Date) => time.format(new Date(iso)).replace(':', '.');
export const wibDay = (iso: string | Date) => `${day.format(new Date(iso))} ${wib(iso)}`;

export function ago(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

export function duration(minutes: number | null) {
  if (minutes === null || minutes === undefined) return '–';
  if (minutes < 60) return `${minutes} mnt`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} j ${m} mnt` : `${h} jam`;
}

export const satelliteLabel: Record<string, string> = { N21: 'NOAA-21', N20: 'NOAA-20', N: 'S-NPP' };
export const confidenceLabel: Record<string, string> = { high: 'tinggi', nominal: 'sedang', low: 'rendah' };
export const levelLabel: Record<Level, string> = { tinggi: 'Tinggi', sedang: 'Sedang', rendah: 'Rendah' };
export const statusLabel: Record<Status, string> = {
  api_aktif: 'Api aktif', asap_bara: 'Asap / bara', bakar_terkendali: 'Bakar terkendali', alarm_palsu: 'Alarm palsu', tidak_terjangkau: 'Tidak terjangkau',
};
export const statusHint: Record<Status, string> = {
  api_aktif: 'Ada nyala api di lapangan',
  asap_bara: 'Tidak ada nyala, tetapi ada asap atau bara',
  bakar_terkendali: 'Pembakaran yang dijaga (dicatat sebagai fakta lapangan)',
  alarm_palsu: 'Tidak ada kebakaran lahan di titik ini',
  tidak_terjangkau: 'Lokasi tidak bisa didatangi',
};
export const falseAlarmLabel: Record<string, string> = { industri: 'Sumber panas industri', pembakaran_sampah: 'Pembakaran sampah', lainnya: 'Lainnya' };
export const roleLabel: Record<string, string> = { mpa: 'Relawan MPA', kades: 'Kepala desa', bpbd: 'BPBD / Daops', admin: 'Admin' };

export const percent = (value: number | null) => (value === null ? '–' : `${Math.round(value * 100)}%`);
export const km = (meters: number) => (meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(Math.round(meters / 100) / 10).toLocaleString('id-ID')} km`);
