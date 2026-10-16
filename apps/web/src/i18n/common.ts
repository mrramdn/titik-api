// Labels every screen shares, in both languages. Terms follow the glossary in the plan:
// titik panas / hotspot, kejadian / incident, cek lapangan / field check, relawan MPA / MPA volunteer.
import type { AssignmentStatus, ErrorCode, Level, Role, SatelliteCode, Sensor, Status } from '../api';
import type { Lang } from '../i18n';

type ByLang<T> = Record<Lang, T>;

export const levelLabel: ByLang<Record<Level, string>> = {
  id: { tinggi: 'Tinggi', sedang: 'Sedang', rendah: 'Rendah' },
  en: { tinggi: 'High', sedang: 'Medium', rendah: 'Low' },
};

export const statusLabel: ByLang<Record<Status, string>> = {
  id: { api_aktif: 'Api aktif', asap_bara: 'Asap atau bara', bakar_terkendali: 'Bakar terkendali', alarm_palsu: 'Alarm palsu', tidak_terjangkau: 'Tidak terjangkau' },
  en: { api_aktif: 'Active fire', asap_bara: 'Smoke or embers', bakar_terkendali: 'Controlled burn', alarm_palsu: 'False alarm', tidak_terjangkau: 'Unreachable' },
};

export const statusHint: ByLang<Record<Status, string>> = {
  id: {
    api_aktif: 'Ada nyala api.',
    asap_bara: 'Tidak ada nyala. Ada asap atau bara.',
    bakar_terkendali: 'Pembakaran yang dijaga orang.',
    alarm_palsu: 'Tidak ada kebakaran lahan di lokasi.',
    tidak_terjangkau: 'Lokasi tidak bisa didatangi.',
  },
  en: {
    api_aktif: 'Flames are visible.',
    asap_bara: 'No flames. Smoke or embers.',
    bakar_terkendali: 'A burn someone is tending.',
    alarm_palsu: 'No land fire at the location.',
    tidak_terjangkau: 'The location cannot be reached.',
  },
};

export const falseAlarmLabel: ByLang<Record<string, string>> = {
  id: { industri: 'Sumber panas industri', pembakaran_sampah: 'Pembakaran sampah', lainnya: 'Lainnya' },
  en: { industri: 'Industrial heat source', pembakaran_sampah: 'Waste burning', lainnya: 'Other' },
};

export const roleLabel: ByLang<Record<Role | 'public', string>> = {
  id: { public: 'Publik', mpa: 'Relawan MPA', kades: 'Kepala desa', bpbd: 'BPBD/Daops', admin: 'Admin' },
  en: { public: 'Public', mpa: 'MPA volunteer', kades: 'Village head', bpbd: 'BPBD/Daops', admin: 'Admin' },
};

export const assignmentLabel: ByLang<Record<AssignmentStatus, string>> = {
  id: { ditugaskan: 'Ditugaskan', menuju: 'Menuju lokasi', selesai: 'Selesai', dibatalkan: 'Dibatalkan' },
  en: { ditugaskan: 'Assigned', menuju: 'On the way', selesai: 'Done', dibatalkan: 'Cancelled' },
};

export const confidenceLabel: ByLang<Record<'low' | 'nominal' | 'high', string>> = {
  id: { low: 'rendah', nominal: 'sedang', high: 'tinggi' },
  en: { low: 'low', nominal: 'nominal', high: 'high' },
};

export const satelliteLabel: Record<SatelliteCode, string> = { N21: 'NOAA-21', N20: 'NOAA-20', N: 'S-NPP', T: 'Terra', A: 'Aqua' };
export const sensorOf = (code: string): Sensor => (code === 'T' || code === 'A' ? 'MODIS' : 'VIIRS');
export const sensorLabel: Record<Sensor, string> = { VIIRS: 'VIIRS 375 m', MODIS: 'MODIS 1 km' };
/** Never shows "undefined" for a code the app does not know yet. */
export const satelliteName = (code: string) => satelliteLabel[code as SatelliteCode] ?? code;

export const winds: ByLang<string[]> = {
  id: ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'],
  en: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
};

export const errorText: ByLang<Record<ErrorCode, string>> = {
  id: {
    OFFLINE: 'Tidak ada sinyal. Data terakhir tetap tampil.',
    UNAUTHENTICATED: 'Sesi berakhir. Masuk lagi untuk melanjutkan.',
    FORBIDDEN: 'Peran ini tidak punya akses ke halaman tersebut.',
    NOT_FOUND: 'Data tidak ditemukan.',
    INVALID_INPUT: 'Isian belum lengkap atau tidak valid.',
    INVALID_ORIGIN: 'Permintaan ditolak. Muat ulang halaman.',
    INVALID_CREDENTIALS: 'Email atau kata sandi salah.',
    INVALID_IMAGE: 'Foto tidak bisa dibaca. Pilih foto lain.',
    CONFLICT: 'Data ini sudah tercatat.',
    NO_ALERTS: 'Belum ada peringatan untuk dikirim.',
    NO_DEVICE: 'Notifikasi belum aktif di perangkat ini.',
    ASSIGNMENT_OPEN: 'Kejadian ini sudah punya tugas yang berjalan.',
    ASSIGNMENT_CLOSED: 'Tugas ini sudah selesai atau dibatalkan.',
    INTERNAL_ERROR: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.',
    ERROR: 'Terjadi kesalahan. Coba lagi.',
  },
  en: {
    OFFLINE: 'No signal. The last data stays on screen.',
    UNAUTHENTICATED: 'Your session ended. Sign in again to continue.',
    FORBIDDEN: 'This role cannot open that page.',
    NOT_FOUND: 'Not found.',
    INVALID_INPUT: 'Some fields are missing or invalid.',
    INVALID_ORIGIN: 'Request refused. Reload the page.',
    INVALID_CREDENTIALS: 'Wrong email or password.',
    INVALID_IMAGE: 'The photo could not be read. Choose another one.',
    CONFLICT: 'This is already recorded.',
    NO_ALERTS: 'There are no alerts to send yet.',
    NO_DEVICE: 'Notifications are not on for this device.',
    ASSIGNMENT_OPEN: 'This incident already has a task in progress.',
    ASSIGNMENT_CLOSED: 'This task is already done or cancelled.',
    INTERNAL_ERROR: 'Server error. Try again in a moment.',
    ERROR: 'Something went wrong. Try again.',
  },
};

/** Words the formatters need. */
export const words: ByLang<Record<'justNow' | 'minAgo' | 'hourAgo' | 'dayAgo' | 'min' | 'hour' | 'hours' | 'minutes' | 'satellites' | 'yesterday' | 'today', string>> = {
  id: { justNow: 'baru saja', minAgo: '{n} menit lalu', hourAgo: '{n} jam lalu', dayAgo: '{n} hari lalu', min: 'mnt', hour: 'jam', hours: 'jam', minutes: 'menit', satellites: '{n} satelit', yesterday: 'kemarin', today: 'hari ini' },
  en: { justNow: 'just now', minAgo: '{n} min ago', hourAgo: '{n} h ago', dayAgo: '{n} days ago', min: 'min', hour: 'h', hours: 'h', minutes: 'min', satellites: '{n} satellites', yesterday: 'yesterday', today: 'today' },
};
