// The landing page at /: what Titik Api does, for whom, and how far its data can be trusted, before the map. The map
// screen is at /peta; an old map link on / (/?tanggal=…) goes on there. Screenshots are real (e2e/landing.mjs).
import { Fragment, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import {
  ArrowRight, CalendarClock, ClipboardCheck, CloudOff, Code, ExternalLink, Gauge, Grid3x3, Landmark, LayoutDashboard, Map as MapIcon, MapPin, Play,
  Ruler, Satellite, Send, Users, Wind, type LucideIcon,
} from 'lucide-react';
import type { ArchiveDays, IngestStatus } from '../api';
import { Shell } from '../components/Shell';
import { LogoMark } from '../components/Logo';
import { useApi, useDataVersion } from '../components/ui';
import { useLoad } from '../components/bpbd/data';
import { clockOffset, readFreshness, SIPONGI_URL } from '../components/shell/freshness';
import { useFormat } from '../format';
import { dict, useLang, useT } from '../i18n';
import { satelliteName } from '../i18n/common';
import { archiveTotal, replayDay } from '../map/archive';
import { BMKG_FWI_URL } from '../map/risk';
import { legacyMapTarget, mapPath, MAP_PATH, tryPath, type DemoRole } from '../routes';

export const landingText = dict({
  id: {
    title: 'Peringatan titik panas tingkat desa',
    lead: 'Titik Api mengubah titik panas dari satelit NASA menjadi peringatan per desa untuk 4.837 desa dan kelurahan di Sumatera Selatan dan Kalimantan Tengah, lalu membantu BPBD mengirim regu relawan terdekat dan mencatat apa yang mereka temukan.',
    status1: 'Demo dengan data satelit asli', status2: 'diperbarui tiap 30 menit', status3: 'bukan sistem peringatan resmi',
    openMap: 'Buka peta', replay: 'Putar ulang hari tersibuk · {date}', tryBpbd: 'Coba sebagai BPBD', tryMpa: 'Coba sebagai relawan MPA',
    heroAlt: 'Layar peta Titik Api untuk arsip 23 Oktober 2026 dengan Kabupaten Pulang Pisau terpilih: di kiri daftar kejadian per desa yang diurutkan menurut skor prioritas, dengan 269 kejadian dan 4.913 titik panas; di kanan peta dengan ratusan titik kejadian merah dan oranye di sekitar Palangka Raya dan Pulang Pisau.',
    heroCaption: 'Kabupaten Pulang Pisau pada 23 Oktober 2026, dari arsip. Data satelit asli.',
    numbersTitle: 'Demo ini sekarang',
    numbersNote: 'Dihitung Titik Api dari data satelit NASA FIRMS untuk demo ini. Bukan angka resmi.',
    hotspots24: 'titik panas di desa, 24 jam terakhir', incidents24: 'kejadian di desa, 24 jam terakhir', latest: 'data satelit terbaru ({sat})', archiveTotal: 'titik panas di desa dalam arsip sejak {date}',
    gapTitle: 'Celah yang ditutup Titik Api',
    gap1: 'Data titik panas sudah terbuka untuk siapa saja, misalnya lewat NASA FIRMS dan SiPongi+.',
    gap2: 'Namun peringatan jarang sampai tepat waktu ke relawan di desa, dan temuan regu di lapangan jarang kembali ke posko.',
    gap3: 'Titik Api menyambungkan keduanya: dari satelit ke desa, lalu kembali ke posko.',
    howTitle: 'Cara kerja',
    step1Title: 'Satelit', step1: 'Tiap 30 menit server memeriksa NASA FIRMS untuk titik panas baru dari sensor VIIRS dan MODIS.',
    step2Title: 'Desa dan kejadian', step2: 'Setiap titik panas dicocokkan dengan desanya dan dikelompokkan menjadi kejadian, masing-masing dengan skor prioritas beserta alasannya.',
    step3Title: 'Penugasan dan peringatan', step3: 'BPBD/Daops menugaskan regu MPA terdekat. Relawan dan kepala desa menerima peringatan.',
    step4Title: 'Cek lapangan dan rekap', step4: 'Cek lapangan bisa diisi tanpa sinyal. Hasilnya masuk ke rekap harian dan ke CSV berformat groundcheck SiPongi+.',
    panelAlt: 'Panel kejadian KJD-Z7F2Q38 di Desa Tanjung Atap, Ogan Ilir, dari arsip 23 Oktober 2026: prioritas tinggi, 11 titik panas, FRP maksimum 31,5 MW, lahan gambut, permukiman terdekat 910 m, indikasi luas area panas 123 ha, angin dari timur dengan lima desa di arah asap, dan skor prioritas 94 dari 100 dengan alasannya; di peta, kotak piksel satelit di sekitar kejadian.',
    panelCaption: 'Satu kejadian di arsip 23 Oktober 2026: skor prioritas dengan alasannya, kotak piksel satelit, dan arah angin.',
    rolesTitle: 'Untuk siapa', rolesNote: 'Tautan Coba membuka akun demo yang dipakai bersama. Apa yang diisi di sana terlihat oleh pengunjung lain dan dihapus setiap hari pukul 03.00 WIB.',
    mpaTitle: 'Relawan MPA', mpa: 'Regu Masyarakat Peduli Api (MPA) bisa melihat tugas dari BPBD dan peringatan untuk desanya, membuka rute, lalu mengirim cek lapangan, juga tanpa sinyal.', mpaTry: 'Coba sebagai relawan MPA',
    mpaAlt: 'Halaman Tugas di ponsel untuk akun demo regu MPA: satu tugas dari BPBD 6,3 km di barat daya dengan catatan BPBD serta tombol Menuju lokasi dan Cek lapangan, lalu peringatan desa.',
    kadesTitle: 'Kepala desa', kades: 'Bisa memantau desanya: titik panas tujuh hari terakhir, peringatan, dan hasil cek lapangan.', kadesTry: 'Coba sebagai kepala desa',
    kadesAlt: 'Halaman Desa saya di ponsel untuk akun demo kepala desa: Desa Sungai Jeruju dengan titik panas per hari selama tujuh hari, 12 kejadian, 11 belum dicek, dan cek terakhir 3 Nov 14.30.',
    bpbdTitle: 'BPBD/Daops', bpbd: 'BPBD dan Daops Manggala Agni bisa melihat kejadian yang perlu tindakan, menugaskan regu MPA terdekat, dan membaca rekap harian.', bpbdTry: 'Coba sebagai BPBD',
    bpbdAlt: 'Dasbor BPBD/Daops untuk tujuh hari terakhir: 1.999 kejadian, waktu tanggap 1 jam 23 menit, 216 kejadian prioritas tinggi belum ditangani, kartu bahaya kebakaran besok, daftar kabupaten, peta, dan lajur Perlu tindakan, Sedang berjalan, dan Selesai.',
    publicTitle: 'Publik', public: 'Siapa saja bisa melihat peta, daftar kejadian, dan status cek lapangan tanpa akun.', publicTry: 'Coba tanpa akun',
    publicAlt: 'Layar peta di ponsel untuk arsip 23 Oktober 2026: kedua provinsi dengan lingkaran jumlah kejadian per kabupaten, catatan bahwa ini demo, lalu pencarian dan filter di atas daftar kejadian.',
    moreTitle: 'Lebih dari titik di peta',
    archiveTitle: 'Arsip', archive: 'Putar ulang hari mana pun sejak 8 Oktober 2026.',
    archiveAlt: 'Pilihan arsip: satu batang per hari dari 8 Oktober sampai 3 November 2026 menurut jumlah titik panas, dengan 23 Oktober 2026 terpilih, 25.614 titik panas.',
    pixelTitle: 'Kotak piksel satelit', pixel: 'Dari dekat, setiap titik panas tampil sebagai kotak seukuran piksel satelitnya.',
    pixelAlt: 'Peta yang diperbesar di sekitar satu kejadian: setiap titik panas tampil sebagai kotak piksel satelit, sebagian saling bertumpuk.',
    dangerTitle: 'Bahaya kebakaran', danger: 'Fire Weather Index dengan kelas BMKG, dihitung dari data cuaca Open-Meteo. Bukan produk resmi BMKG.',
    dangerAlt: 'Lapisan bahaya kebakaran untuk 23 Oktober 2026: sel kisi berwarna merah muda sampai ungu tua menurut kelas FWI di atas Sumatera Selatan dan Kalimantan Tengah, dengan lingkaran jumlah kejadian per kabupaten.',
    windTitle: 'Angin dan asap', wind: 'Arah angin dan desa yang searah dengan asap, untuk setiap kejadian.',
    windAlt: 'Bagian angin dan asap di panel kejadian: angin dari timur 9 km/jam saat terakhir terdeteksi, asap mengarah ke barat, dan lima desa di arah asap dengan jaraknya.',
    areaTitle: 'Indikasi luas area panas', area: 'Luas jejak piksel satelit pada satu lintasan. Bukan luas terbakar.',
    areaAlt: 'Fakta kejadian: 11 titik panas, FRP maksimum 31,5 MW, lahan gambut, permukiman terdekat 910 m, dan indikasi luas area panas 123 ha dengan catatan bahwa itu bukan luas terbakar.',
    offlineTitle: 'Cek lapangan tanpa sinyal', offline: 'Laporan disimpan di ponsel dan terkirim sendiri saat sinyal kembali.',
    offlineAlt: 'Cek lapangan di ponsel tanpa sinyal: pesan bahwa laporan disimpan di ponsel dan terkirim saat ada sinyal, kejadian prioritas tinggi di Desa Talang Rimba, dan tombol Simpan, kirim saat ada sinyal.',
    honestTitle: 'Batas data dan layanan',
    honest1: 'Titik panas tidak selalu berarti kebakaran. Setiap titik panas perlu dicek di lapangan.',
    honest2: 'Kebakaran bisa terlewat di bawah awan, asap tebal, atau kanopi, dan di antara dua lintasan satelit.',
    honest3: 'Titik Api adalah demo portofolio dan tidak dipantau 24 jam.',
    honest4: 'Dalam keadaan darurat, hubungi {emergency}.',
    honest5: 'Informasi resmi ada di {sipongi}, {bmkg}, dan BPBD setempat.',
    terms: 'Sumber data, akurasi, dan ketentuan',
    builtTitle: 'Dibuat dengan', stack: 'Teknologi',
    source: 'Kode sumber terbuka dengan lisensi MIT: {repo}.',
    madeBy: 'Dibuat dan dijalankan oleh Muhamad Rifki Ramdani.', contact: 'Kontak',
    firstVersion: 'Versi pertama dibuat untuk Hackathon JOINTS UGM 2026 (Okt 2026).',
    footNav: 'Tautan', footMap: 'Peta', footAbout: 'Tentang', footSource: 'Kode sumber', footContact: 'Kontak',
    footNote: 'Demo portofolio dengan data satelit asli, bukan sistem peringatan resmi. Darurat 112.',
    newTab: '(membuka tab baru)',
  },
  en: {
    title: 'Village-level hotspot alerts',
    lead: 'Titik Api turns NASA satellite hotspots into alerts for each of 4,837 villages in South Sumatra and Central Kalimantan, and helps BPBD, the regional disaster agency, send the nearest volunteer squad and record what it finds.',
    status1: 'Demo with real satellite data', status2: 'updated every 30 minutes', status3: 'not an official warning system',
    openMap: 'Open the map', replay: 'Replay the busiest day · {date}', tryBpbd: 'Try as BPBD', tryMpa: 'Try as an MPA volunteer',
    heroAlt: 'The Titik Api map screen for the 23 October 2026 archive with Pulang Pisau Regency chosen: on the left the incidents per village ranked by priority score, 269 incidents and 4,913 hotspots; on the right the map with hundreds of red and orange incident dots around Palangka Raya and Pulang Pisau.',
    heroCaption: 'Pulang Pisau Regency on 23 October 2026, from the archive. Real satellite data.',
    numbersTitle: 'The demo right now',
    numbersNote: 'Counted by Titik Api from NASA FIRMS satellite data for this demo. Not official figures.',
    hotspots24: 'hotspots in villages, last 24 hours', incidents24: 'incidents in villages, last 24 hours', latest: 'latest satellite data ({sat})', archiveTotal: 'hotspots in villages in the archive since {date}',
    gapTitle: 'The gap Titik Api closes',
    gap1: 'Hotspot data is already open to anyone, for example through NASA FIRMS and SiPongi+.',
    gap2: 'But alerts rarely reach volunteers in the village in time, and what the squad finds rarely gets back to the command post.',
    gap3: 'Titik Api closes that loop: from the satellite to the village, and back to the command post.',
    howTitle: 'How it works',
    step1Title: 'Satellites', step1: 'Every 30 minutes the server checks NASA FIRMS for new hotspots from the VIIRS and MODIS sensors.',
    step2Title: 'Village and incident', step2: 'Each hotspot is matched to its village and grouped into incidents, each with a priority score and its reasons.',
    step3Title: 'Assignment and alerts', step3: 'BPBD/Daops assigns the nearest MPA squad. Volunteers and village heads get alerts.',
    step4Title: 'Field check and recap', step4: 'The field check works without signal. Results go into a daily recap and a CSV in the SiPongi+ groundcheck format.',
    panelAlt: 'The panel of incident KJD-Z7F2Q38 in Tanjung Atap village, Ogan Ilir, from the 23 October 2026 archive: high priority, 11 hotspots, maximum FRP 31.5 MW, peatland, nearest settlement 910 m, indicated hot area 123 ha, wind from the east with five villages the smoke drifts toward, and the priority score of 94 out of 100 with its reasons; on the map, satellite pixel boxes around the incident.',
    panelCaption: 'One incident in the 23 October 2026 archive: the priority score with its reasons, satellite pixel boxes and the wind.',
    rolesTitle: 'Who it is for', rolesNote: 'The Try links open shared demo accounts. What you enter there is visible to other visitors and deleted every day at 03:00 WIB.',
    mpaTitle: 'MPA volunteers', mpa: 'Masyarakat Peduli Api (MPA) volunteer squads can see tasks from BPBD and alerts for their villages, open the route and send a field check, even without signal.', mpaTry: 'Try as an MPA volunteer',
    mpaAlt: 'The Tasks page on a phone for the demo MPA squad: one task from BPBD 6.3 km to the southwest with a note from BPBD and the buttons to head out and to check, then village alerts.',
    kadesTitle: 'Village heads', kades: 'Can follow their village: hotspots over the last seven days, alerts and field check results.', kadesTry: 'Try as a village head',
    kadesAlt: 'The My villages page on a phone for the demo village head: Sungai Jeruju village with hotspots per day over seven days, 12 incidents, 11 not checked and the last check on 3 Nov at 14:30.',
    bpbdTitle: 'BPBD/Daops', bpbd: 'BPBD and Daops Manggala Agni can see the incidents that need action, assign the nearest MPA squad and read the daily recap.', bpbdTry: 'Try as BPBD',
    bpbdAlt: 'The BPBD/Daops dashboard for the last seven days: 1,999 incidents, a response time of 1 h 23 min, 216 high-priority incidents not handled, tomorrow\'s fire danger card, the regency list, the map, and the Needs action, In progress and Done lanes.',
    publicTitle: 'Public', public: 'Anyone can see the map, the incident list and field check status without an account.', publicTry: 'Try without an account',
    publicAlt: 'The map screen on a phone for the 23 October 2026 archive: both provinces with a circle per regency showing its incident count, the demo note, then search and filters above the incident list.',
    moreTitle: 'Beyond the dots',
    archiveTitle: 'Archive replay', archive: 'Replay any day since 8 October 2026.',
    archiveAlt: 'The archive picker: one bar per day from 8 October to 3 November 2026 by hotspot count, with 23 October 2026 chosen, 25,614 hotspots.',
    pixelTitle: 'Satellite pixel boxes', pixel: 'At close zoom each hotspot shows as a box the size of its satellite pixel.',
    pixelAlt: 'The map zoomed in around one incident: each hotspot drawn as a satellite pixel box, some overlapping.',
    dangerTitle: 'Fire danger', danger: 'Fire Weather Index with BMKG classes, computed from Open-Meteo weather data. Not an official BMKG product.',
    dangerAlt: 'The fire danger layer for 23 October 2026: grid cells from pink to dark purple by FWI class over South Sumatra and Central Kalimantan, with a circle per regency showing its incident count.',
    windTitle: 'Wind and smoke', wind: 'Wind direction and the villages the smoke drifts toward, for each incident.',
    windAlt: 'The wind and smoke part of the incident panel: wind from the east at 9 km/h when last detected, smoke drifting west, and five villages that way with their distances.',
    areaTitle: 'Indicated hot area', area: 'The area of the satellite pixel footprints on one pass. Not burned area.',
    areaAlt: 'Incident facts: 11 hotspots, maximum FRP 31.5 MW, peatland, nearest settlement 910 m, and an indicated hot area of 123 ha with the note that it is not burned area.',
    offlineTitle: 'Field check without signal', offline: 'Reports are saved on the phone and sent once the signal returns.',
    offlineAlt: 'A field check on a phone without signal: a note that the report is saved on the phone and sent when there is signal, a high-priority incident in Talang Rimba village, and the button to save and send it when there is signal.',
    honestTitle: 'Limits of the data and the service',
    honest1: 'A hotspot is not always a fire. Every hotspot needs a field check.',
    honest2: 'Fires can be missed under cloud, thick smoke or canopy, and between two satellite passes.',
    honest3: 'Titik Api is a portfolio demo and is not monitored around the clock.',
    honest4: 'In an emergency, call {emergency}.',
    honest5: 'Official information is on {sipongi}, {bmkg} and from the local BPBD.',
    terms: 'Data sources, accuracy and terms',
    builtTitle: 'Built with', stack: 'Technology',
    source: 'Open source under the MIT licence: {repo}.',
    madeBy: 'Built and run by Muhamad Rifki Ramdani.', contact: 'Contact',
    firstVersion: 'The first version was made for Hackathon JOINTS UGM 2026 (Oct 2026).',
    footNav: 'Links', footMap: 'Map', footAbout: 'About', footSource: 'Source code', footContact: 'Contact',
    footNote: 'Portfolio demo with real satellite data, not an official warning system. Emergency 112.',
    newTab: '(opens in a new tab)',
  },
});
type Key = keyof typeof landingText.id;

export const REPO_URL = 'https://github.com/mrramdn/titik-api';
export const CONTACT_URL = { id: 'https://www.mrramdn.com/id/contact', en: 'https://www.mrramdn.com/en/contact' } as const;
export const STACK = ['Fastify', 'TypeScript', 'PostgreSQL + PostGIS', 'React', 'MapLibre', 'PWA', 'Docker'];

/** Real screenshots under public/landing/ (e2e/landing.mjs), with their pixel size for the width and height attributes. */
interface Shot { src: string; width: number; height: number; small?: string }
export const shots = {
  hero: { src: '/landing/peta.webp', width: 1600, height: 1000, small: '/landing/peta-800.webp' },
  panel: { src: '/landing/kejadian.webp', width: 1600, height: 1311, small: '/landing/kejadian-800.webp' },
  mpa: { src: '/landing/peran-mpa.webp', width: 480, height: 900 },
  kades: { src: '/landing/peran-kades.webp', width: 480, height: 900 },
  bpbd: { src: '/landing/peran-bpbd.webp', width: 1000, height: 625 },
  public: { src: '/landing/peran-publik.webp', width: 480, height: 900 },
  archive: { src: '/landing/fitur-arsip.webp', width: 720, height: 480 },
  pixel: { src: '/landing/fitur-piksel.webp', width: 720, height: 480 },
  danger: { src: '/landing/fitur-bahaya.webp', width: 720, height: 480 },
  wind: { src: '/landing/fitur-angin.webp', width: 720, height: 480 },
  area: { src: '/landing/fitur-luas.webp', width: 720, height: 480 },
  offline: { src: '/landing/fitur-offline.webp', width: 720, height: 480 },
} satisfies Record<string, Shot>;

interface Role { role: DemoRole | 'public'; icon: LucideIcon; title: Key; body: Key; link: Key; to: string; shot: Shot; alt: Key; phone: boolean }
const roles: Role[] = [
  { role: 'mpa', icon: Users, title: 'mpaTitle', body: 'mpa', link: 'mpaTry', to: tryPath('mpa'), shot: shots.mpa, alt: 'mpaAlt', phone: true },
  { role: 'kades', icon: Landmark, title: 'kadesTitle', body: 'kades', link: 'kadesTry', to: tryPath('kades'), shot: shots.kades, alt: 'kadesAlt', phone: true },
  { role: 'bpbd', icon: LayoutDashboard, title: 'bpbdTitle', body: 'bpbd', link: 'bpbdTry', to: tryPath('bpbd'), shot: shots.bpbd, alt: 'bpbdAlt', phone: false },
  { role: 'public', icon: MapIcon, title: 'publicTitle', body: 'public', link: 'publicTry', to: MAP_PATH, shot: shots.public, alt: 'publicAlt', phone: true },
];
const steps: { icon: LucideIcon; title: Key; body: Key }[] = [
  { icon: Satellite, title: 'step1Title', body: 'step1' },
  { icon: MapPin, title: 'step2Title', body: 'step2' },
  { icon: Send, title: 'step3Title', body: 'step3' },
  { icon: ClipboardCheck, title: 'step4Title', body: 'step4' },
];
const features: { icon: LucideIcon; title: Key; body: Key; shot: Shot; alt: Key }[] = [
  { icon: CalendarClock, title: 'archiveTitle', body: 'archive', shot: shots.archive, alt: 'archiveAlt' },
  { icon: Grid3x3, title: 'pixelTitle', body: 'pixel', shot: shots.pixel, alt: 'pixelAlt' },
  { icon: Gauge, title: 'dangerTitle', body: 'danger', shot: shots.danger, alt: 'dangerAlt' },
  { icon: Wind, title: 'windTitle', body: 'wind', shot: shots.wind, alt: 'windAlt' },
  { icon: Ruler, title: 'areaTitle', body: 'area', shot: shots.area, alt: 'areaAlt' },
  { icon: CloudOff, title: 'offlineTitle', body: 'offline', shot: shots.offline, alt: 'offlineAlt' },
];
const honest: Key[] = ['honest1', 'honest2', 'honest3', 'honest4', 'honest5'];

/** A sentence with {name} placeholders replaced by links. */
function linked(sentence: string, links: Record<string, ReactNode>) {
  return sentence.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={index}>{name && name in links ? links[name] : part}</Fragment>;
  });
}

function Picture({ shot, alt, eager = false, sizes }: { shot: Shot; alt: string; eager?: boolean; sizes?: string }) {
  return (
    <img src={shot.src} srcSet={shot.small ? `${shot.small} 800w, ${shot.src} ${shot.width}w` : undefined} sizes={shot.small ? sizes : undefined}
      width={shot.width} height={shot.height} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  );
}

/** "/" is the landing page; an old map link (/?tanggal=…) goes to /peta with the same query, without a new history entry. */
export function LandingPage() {
  const location = useLocation();
  const target = legacyMapTarget(location.search, location.state);
  if (target) return <Navigate to={`${target}${location.hash}`} replace state={location.state} />;
  return <Landing />;
}

/** The hero's buttons. "Putar ulang hari tersibuk" opens the archive's busiest day (`replay`); without one ('') it stays away. */
export function HeroActions({ replay }: { replay: string }) {
  const t = useT(landingText), f = useFormat();
  return (
    <div className="lp-actions">
      <Link to={MAP_PATH} className="btn btn-primary"><MapIcon size={18} aria-hidden="true" />{t('openMap')}</Link>
      {replay && <Link to={mapPath(replay)} className="btn btn-secondary"><Play size={16} aria-hidden="true" />{t('replay', { date: f.calendar(replay) })}</Link>}
      <Link to={tryPath('bpbd')} className="btn btn-secondary"><LayoutDashboard size={16} aria-hidden="true" />{t('tryBpbd')}</Link>
      <Link to={tryPath('mpa')} className="btn btn-secondary"><Users size={16} aria-hidden="true" />{t('tryMpa')}</Link>
    </div>
  );
}

interface Summary { incidents: number; detections: number }

function Landing() {
  const t = useT(landingText);
  const { lang } = useLang();
  const { version, status } = useDataVersion();
  const archive = useLoad<ArchiveDays>('/archive/days', version);
  const summary = useApi<Summary>('/summary?hours=24', version);
  const days = archive.data && Array.isArray(archive.data.days) && archive.data.days.length ? archive.data : null;
  const out = (href: string, label: ReactNode, className?: string) => (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">{label}<ExternalLink size={12} className="icon" aria-hidden="true" /><span className="visually-hidden"> {t('newTab')}</span></a>
  );
  const wideSizes = '(min-width: 1120px) 1056px, calc(100vw - 32px)';
  return (
    <Shell region={false} skipTo="isi">
      <main id="isi" tabIndex={-1} className="lp">
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-wrap">
            <div className="lp-hero-text">
              <h1 id="lp-title" className="lp-title">{t('title')}</h1>
              <p className="lp-lead">{t('lead')}</p>
              <p className="lp-status"><span>{t('status1')}</span><span>{t('status2')}</span><span>{t('status3')}</span></p>
              <HeroActions replay={replayDay(days)} />
            </div>
            <figure className="lp-figure lp-figure-hero">
              <Picture shot={shots.hero} alt={t('heroAlt')} eager sizes={wideSizes} />
              <figcaption>{t('heroCaption')}</figcaption>
            </figure>
          </div>
        </section>

        <Numbers archive={days} summary={summary.data} status={status} />

        <section className="lp-section" aria-labelledby="lp-gap">
          <div className="lp-wrap lp-split">
            <h2 id="lp-gap">{t('gapTitle')}</h2>
            <div className="lp-prose">
              <p>{t('gap1')}</p>
              <p>{t('gap2')}</p>
              <p className="lp-strong">{t('gap3')}</p>
            </div>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-how">
          <div className="lp-wrap">
            <h2 id="lp-how" className="lp-h2">{t('howTitle')}</h2>
            <ol className="lp-steps">
              {steps.map(({ icon: Icon, title, body }, index) => (
                <li key={title} className="lp-step">
                  <span className="lp-step-head"><span className="lp-step-icon"><Icon size={18} aria-hidden="true" /></span><span className="lp-step-num" aria-hidden="true">{index + 1}</span></span>
                  <h3>{t(title)}</h3>
                  <p>{t(body)}</p>
                </li>
              ))}
            </ol>
            <figure className="lp-figure">
              <Picture shot={shots.panel} alt={t('panelAlt')} sizes={wideSizes} />
              <figcaption>{t('panelCaption')}</figcaption>
            </figure>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-roles">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="lp-roles" className="lp-h2">{t('rolesTitle')}</h2>
              <p>{t('rolesNote')}</p>
            </div>
            <ul className="lp-roles">
              {roles.map(({ role, icon: Icon, title, body, link, to, shot, alt, phone }) => (
                <li key={role} className="lp-role">
                  <div className={`lp-role-shot ${phone ? 'phone' : 'wide'}`}><Picture shot={shot} alt={t(alt)} /></div>
                  <div className="lp-role-body">
                    <h3><Icon size={18} className="icon" aria-hidden="true" />{t(title)}</h3>
                    <p>{t(body)}</p>
                    <Link to={to} className="lp-try">{t(link)}<ArrowRight size={16} aria-hidden="true" /></Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-more">
          <div className="lp-wrap">
            <h2 id="lp-more" className="lp-h2">{t('moreTitle')}</h2>
            <ul className="lp-features">
              {features.map(({ icon: Icon, title, body, shot, alt }) => (
                <li key={title} className="lp-feature">
                  <Picture shot={shot} alt={t(alt)} />
                  <h3><Icon size={16} className="icon" aria-hidden="true" />{t(title)}</h3>
                  <p>{t(body)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-honest">
          <div className="lp-wrap">
            <div className="lp-honest">
              <h2 id="lp-honest" className="lp-h2">{t('honestTitle')}</h2>
              <ul>
                {honest.map(key => (
                  <li key={key}>{linked(t(key), {
                    emergency: <a className="lp-link" href="tel:112">112</a>,
                    sipongi: out(SIPONGI_URL, 'SiPongi+', 'lp-link'),
                    bmkg: out(BMKG_FWI_URL, 'BMKG', 'lp-link'),
                  })}</li>
                ))}
              </ul>
              <Link to="/tentang" className="lp-try">{t('terms')}<ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-built">
          <div className="lp-wrap">
            <h2 id="lp-built" className="lp-h2">{t('builtTitle')}</h2>
            <ul className="lp-chips" aria-label={t('stack')}>{STACK.map(name => <li key={name}>{name}</li>)}</ul>
            <div className="lp-prose lp-built">
              <p><Code size={16} className="icon lp-inline-icon" aria-hidden="true" />{linked(t('source'), { repo: out(REPO_URL, 'github.com/mrramdn/titik-api', 'lp-link') })}</p>
              <p>{t('madeBy')} {out(CONTACT_URL[lang], t('contact'), 'lp-link')}</p>
              <p>{t('firstVersion')}</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-inner">
          <span className="lp-foot-brand"><LogoMark size={22} />Titik Api</span>
          <nav aria-label={t('footNav')}>
            <ul>
              <li><Link to={MAP_PATH}>{t('footMap')}</Link></li>
              <li><Link to="/tentang">{t('footAbout')}</Link></li>
              <li>{out(REPO_URL, t('footSource'))}</li>
              <li>{out(CONTACT_URL[lang], t('footContact'))}</li>
            </ul>
          </nav>
          <p>{t('footNote')}</p>
        </div>
      </footer>
    </Shell>
  );
}

/**
 * What the demo holds right now, each number once its source answers; a number whose source fails stays away, and so
 * does the whole block when none answers. Labelled as the demo's own count, not an official figure.
 */
function Numbers({ archive, summary, status }: { archive: ArchiveDays | null; summary: Summary | null; status: IngestStatus | null }) {
  const t = useT(landingText), f = useFormat();
  const latest = readFreshness(status, Date.now() + clockOffset(status?.serverTime))?.latest ?? null;
  const total = archiveTotal(archive);
  const stats = [
    summary && typeof summary.detections === 'number' ? { key: 'hotspots', value: f.num(summary.detections), label: t('hotspots24') } : null,
    summary && typeof summary.incidents === 'number' ? { key: 'incidents', value: f.num(summary.incidents), label: t('incidents24') } : null,
    // "15.49 WIB" stays on one line when the value wraps on a phone.
    latest ? { key: 'latest', value: `${f.dayTime(latest.at)} WIB`, label: t('latest', { sat: satelliteName(latest.code) }) } : null,
    archive && total !== null ? { key: 'archive', value: f.num(total), label: t('archiveTotal', { date: f.calendar(archive.first) }) } : null,
  ].filter(stat => stat !== null);
  if (!stats.length) return null;
  return (
    <section className="lp-section lp-numbers" aria-labelledby="lp-numbers">
      <div className="lp-wrap">
        <div className="lp-head">
          <h2 id="lp-numbers" className="lp-h2">{t('numbersTitle')}</h2>
          <p>{t('numbersNote')}</p>
        </div>
        <dl className="lp-stats">
          {stats.map(stat => (
            <div key={stat.key} className={`lp-stat lp-stat-${stat.key}`}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
