import { Shell } from '../components/Shell';
import { dict, useT } from '../i18n';

const text = dict({
  id: {
    title: 'Tentang Titik Api',
    lead: 'Peringatan titik panas tingkat desa untuk pengendalian kebakaran hutan dan lahan di Sumatera Selatan dan Kalimantan Tengah.',
    whatTitle: 'Apa yang dilakukan Titik Api',
    what1: 'Titik Api mengubah titik panas dari satelit menjadi peringatan untuk desa tempat titik itu berada. Peringatan sampai ke relawan Masyarakat Peduli Api (MPA) dan kepala desa. Hasil cek lapangan mereka kembali ke BPBD dan Daops Manggala Agni melalui dasbor dan rekap harian.',
    what2: 'Ekspor cek lapangan memakai kolom isian groundcheck SiPongi+.',
    coverageTitle: 'Cakupan',
    coverage: 'Titik Api mencakup 4.837 desa dan kelurahan di 31 kabupaten/kota di Sumatera Selatan dan Kalimantan Tengah. Kabupaten Ogan Komering Ilir menjadi wilayah pilot.',
    howTitle: 'Cara kerja',
    howSatTitle: 'Satelit VIIRS.',
    howSat: 'Setiap 30 menit server memeriksa data titik panas publik dari NASA FIRMS. Sensor VIIRS 375 m di satelit NOAA-21, NOAA-20, dan S-NPP melintas sekitar pukul 01.00–02.30 dan 13.00–14.30 WIB. NASA menghentikan pengiriman data S-NPP pada 2 November 2026. NOAA-21 dan NOAA-20 tetap berjalan.',
    howModisTitle: 'Satelit MODIS.',
    howModis: 'Sensor MODIS di satelit Terra dan Aqua menambah empat lintasan per hari. Terra melintas sekitar 07.25–09.05 dan 19.25–21.25 WIB. Aqua melintas sekitar 14.40–16.20 dan 02.30–04.25 WIB. Piksel MODIS berukuran 1 km, sehingga lokasinya bisa bergeser 0,5–2,5 km dari api. Titik MODIS bergabung dengan kejadian VIIRS di dekatnya. Kejadian yang hanya terlihat oleh MODIS ditandai "lokasi ±1 km". NASA berencana menghentikan MODIS mulai akhir 2026 atau awal 2027.',
    howTriageTitle: 'Triase.',
    howTriage: 'Titik panas ditautkan ke poligon desa dan ditandai bila berada di lahan gambut atau dekat sumber panas tetap. Titik yang berjarak paling jauh 750 m pada hari yang sama digabung menjadi kejadian. Kompleks kebakaran yang luas dipecah menjadi kejadian berjari-jari paling besar 1,5 km agar bisa dicek satu per satu. Skor prioritas dihitung dengan aturan terbuka dari keyakinan satelit, daya radiasi api (FRP), jumlah titik panas, lahan gambut, dan jarak ke permukiman.',
    howAlertTitle: 'Peringatan.',
    howAlert: 'Kejadian prioritas sedang dan tinggi menjadi peringatan bagi pengguna yang memantau desa itu, dengan jarak dan arah dari permukiman terdekat. Peringatan masuk sebagai notifikasi dan bisa dibagikan ke grup WhatsApp.',
    howAssignTitle: 'Penugasan.',
    howAssign: 'BPBD/Daops menugaskan kejadian ke regu MPA terdekat. Statusnya berjalan dari ditugaskan, menuju lokasi, sampai selesai saat regu mengirim cek lapangan.',
    howCheckTitle: 'Cek lapangan.',
    howCheck: 'Relawan memilih satu dari lima status, lalu menambah foto, lokasi GPS, dan catatan. Tanpa sinyal, laporan disimpan di ponsel dan terkirim sendiri saat sinyal kembali, dengan waktu cek yang sebenarnya.',
    howDashTitle: 'Dasbor dan rekap.',
    howDash: 'BPBD/Daops melihat kejadian yang perlu tindakan, tugas yang berjalan, dan hasil cek. Rekap harian merangkum kejadian per kabupaten, bagian yang sudah dicek, dan waktu tanggap, yaitu median waktu dari deteksi sampai cek pertama. Laporan alarm palsu menandai lokasinya selama 30 hari.',
    limitsTitle: 'Batasan',
    limit1: 'Titik panas adalah anomali suhu permukaan yang terlihat dari satelit. Setiap titik panas perlu dicek di lapangan.',
    limit2: 'Api di bawah awan, asap tebal, atau kanopi, dan gambut yang membara di bawah permukaan bisa tidak terdeteksi. Tanpa titik panas, sebuah wilayah belum tentu aman.',
    limit3: 'VIIRS melintas sekitar dua kali sehari dan MODIS empat kali. NASA FIRMS merilis data paling lambat ±3 jam setelah lintasan. Waktu tanggap di dasbor sudah termasuk jeda itu.',
    limit4: 'Peta gambut memakai Global peatland extent (Miettinen dkk. 2016 untuk Indonesia). Peta ini berbeda dari peta Kesatuan Hidrologis Gambut (KHG) resmi.',
    limit5: 'Akun demo dipakai bersama. Cek lapangan dari akun demo ditandai "demo" dan dihapus saat reset setiap malam.',
    privacyTitle: 'Privasi',
    privacy1: 'Nama pelapor, catatan, dan foto hanya terlihat oleh pengguna yang masuk. Publik melihat status dan waktu cek.',
    privacy2: 'Data lokasi di dalam foto (EXIF) dibuang. Koordinat laporan hanya berasal dari GPS yang dipilih pelapor untuk dikirim.',
    privacy3: 'Titik Api tidak menampilkan pemilik lahan atau perusahaan. Status "bakar terkendali" mencatat apa yang terlihat di lapangan.',
    sourcesTitle: 'Sumber data dan lisensi',
    source1: 'Titik panas dari NASA FIRMS, VIIRS 375 m NRT (NOAA-21, NOAA-20, S-NPP) dan MODIS Collection 6.1 NRT (Terra, Aqua).',
    sourceFirms: 'We acknowledge the use of data and/or imagery from NASA\'s Fire Information for Resource Management System (FIRMS), part of NASA\'s Earth Science Data and Information System (ESDIS).',
    source2: 'Batas desa dari Indonesia COD-AB, BPS melalui OCHA/HDX, CC BY-IGO.',
    source3: 'Lahan gambut dan peringatan gangguan hutan dari Global Nature Watch (dahulu Global Forest Watch), CC BY 4.0.',
    source4: 'Permukiman dan kawasan industri dari © kontributor OpenStreetMap, ODbL.',
    source5: 'Peta dasar OpenFreeMap, © OpenMapTiles. Citra Sentinel-2 cloudless 2023 oleh EOX, CC BY-NC-SA 4.0.',
    contest: 'Hackathon JOINTS UGM 2026, tim Close AI (Universitas Bina Nusantara). Kode sumber di github.com/mrramdn/titik-api.',
  },
  en: {
    title: 'About Titik Api',
    lead: 'Village-level hotspot alerts for forest and land fire control in South Sumatra and Central Kalimantan.',
    whatTitle: 'What Titik Api does',
    what1: 'Titik Api turns satellite hotspots into alerts for the village where each hotspot lies. Alerts reach Masyarakat Peduli Api (MPA) volunteers and village heads. Their field checks return to BPBD and Daops Manggala Agni through a dashboard and a daily recap.',
    what2: 'The field check export uses the SiPongi+ groundcheck form fields.',
    coverageTitle: 'Coverage',
    coverage: 'Titik Api covers 4,837 villages in 31 regencies and cities in South Sumatra and Central Kalimantan. Ogan Komering Ilir Regency is the pilot area.',
    howTitle: 'How it works',
    howSatTitle: 'VIIRS satellites.',
    howSat: 'Every 30 minutes the server checks public hotspot data from NASA FIRMS. The VIIRS 375 m sensor on NOAA-21, NOAA-20 and S-NPP passes at about 01:00–02:30 and 13:00–14:30 WIB. NASA ends S-NPP data delivery on 2 November 2026. NOAA-21 and NOAA-20 continue.',
    howModisTitle: 'MODIS satellites.',
    howModis: 'The MODIS sensor on Terra and Aqua adds four passes a day. Terra passes at about 07:25–09:05 and 19:25–21:25 WIB. Aqua passes at about 14:40–16:20 and 02:30–04:25 WIB. MODIS pixels are 1 km wide, so a hotspot can sit 0.5–2.5 km from the fire. MODIS hotspots join the nearby VIIRS incident. Incidents seen only by MODIS are marked "location ±1 km". NASA plans to end MODIS from late 2026 or early 2027.',
    howTriageTitle: 'Triage.',
    howTriage: 'Hotspots are linked to village polygons and flagged when they lie on peatland or near a fixed heat source. Hotspots at most 750 m apart on the same day form one incident. Large fire complexes are split into incidents with a radius of at most 1.5 km, so each can be checked on its own. The priority score follows open rules based on satellite confidence, fire radiative power (FRP), hotspot count, peatland and distance to settlements.',
    howAlertTitle: 'Alerts.',
    howAlert: 'Medium and high priority incidents become alerts for users who watch that village, with the distance and direction from the nearest settlement. Alerts arrive as notifications and can be shared to WhatsApp groups.',
    howAssignTitle: 'Assignments.',
    howAssign: 'BPBD/Daops assigns an incident to the nearest MPA team. Its status moves from assigned to on the way, and to done when the team sends its field check.',
    howCheckTitle: 'Field checks.',
    howCheck: 'A volunteer picks one of five statuses and adds a photo, a GPS location and a note. Without signal, the report is stored on the phone and sent once the signal returns, with the actual check time.',
    howDashTitle: 'Dashboard and recap.',
    howDash: 'BPBD/Daops sees the incidents that need action, the tasks in progress and the check results. The daily recap sums up incidents per regency, the share checked and the response time, the median time from detection to the first check. A false alarm report marks its location for 30 days.',
    limitsTitle: 'Limitations',
    limit1: 'A hotspot is a surface temperature anomaly seen from a satellite. Every hotspot needs a field check.',
    limit2: 'Fires under clouds, thick smoke or canopy, and peat smouldering below the surface can go undetected. An area without hotspots is not necessarily safe.',
    limit3: 'VIIRS passes about twice a day and MODIS four times. NASA FIRMS releases data up to about 3 hours after a pass. The response time on the dashboard includes that delay.',
    limit4: 'The peat map uses Global peatland extent (Miettinen et al. 2016 for Indonesia). It differs from the official peat hydrological unit (KHG) map.',
    limit5: 'Demo accounts are shared. Field checks from demo accounts are marked "demo" and removed at the nightly reset.',
    privacyTitle: 'Privacy',
    privacy1: 'Reporter names, notes and photos are visible only to signed-in users. The public sees the status and the check time.',
    privacy2: 'Location data inside photos (EXIF) is removed. Report coordinates come only from the GPS fix the reporter chooses to send.',
    privacy3: 'Titik Api does not show land owners or companies. The "controlled burn" status records what was seen in the field.',
    sourcesTitle: 'Data sources and licences',
    source1: 'Hotspots from NASA FIRMS, VIIRS 375 m NRT (NOAA-21, NOAA-20, S-NPP) and MODIS Collection 6.1 NRT (Terra, Aqua).',
    sourceFirms: 'We acknowledge the use of data and/or imagery from NASA\'s Fire Information for Resource Management System (FIRMS), part of NASA\'s Earth Science Data and Information System (ESDIS).',
    source2: 'Village boundaries from Indonesia COD-AB, BPS via OCHA/HDX, CC BY-IGO.',
    source3: 'Peatland and forest disturbance alerts from Global Nature Watch (formerly Global Forest Watch), CC BY 4.0.',
    source4: 'Settlements and industrial areas from © OpenStreetMap contributors, ODbL.',
    source5: 'Base map OpenFreeMap, © OpenMapTiles. Imagery Sentinel-2 cloudless 2023 by EOX, CC BY-NC-SA 4.0.',
    contest: 'Hackathon JOINTS UGM 2026, team Close AI (Universitas Bina Nusantara). Source code at github.com/mrramdn/titik-api.',
  },
});
type Key = keyof typeof text.id;

const steps: [Key, Key][] = [['howSatTitle', 'howSat'], ['howModisTitle', 'howModis'], ['howTriageTitle', 'howTriage'], ['howAlertTitle', 'howAlert'],
  ['howAssignTitle', 'howAssign'], ['howCheckTitle', 'howCheck'], ['howDashTitle', 'howDash']];
const limits: Key[] = ['limit1', 'limit2', 'limit3', 'limit4', 'limit5'];
const privacy: Key[] = ['privacy1', 'privacy2', 'privacy3'];

export function AboutPage() {
  const t = useT(text);
  return (
    <Shell>
      <main className="page narrow">
        <div className="page-head"><div><h1 className="title-24">{t('title')}</h1><p>{t('lead')}</p></div></div>
        <article className="doc">
          <h2>{t('whatTitle')}</h2>
          <p>{t('what1')}</p>
          <p>{t('what2')}</p>
          <h2>{t('coverageTitle')}</h2>
          <p>{t('coverage')}</p>
          <h2>{t('howTitle')}</h2>
          <ol>{steps.map(([title, body]) => <li key={title}><b>{t(title)}</b> {t(body)}</li>)}</ol>
          <h2 id="batasan">{t('limitsTitle')}</h2>
          <ul>{limits.map(key => <li key={key}>{t(key)}</li>)}</ul>
          <h2>{t('privacyTitle')}</h2>
          <ul>{privacy.map(key => <li key={key}>{t(key)}</li>)}</ul>
          <h2>{t('sourcesTitle')}</h2>
          <ul>
            <li>{t('source1')} <q lang="en">{t('sourceFirms')}</q></li>
            <li>{t('source2')}</li>
            <li>{t('source3')}</li>
            <li>{t('source4')}</li>
            <li>{t('source5')}</li>
          </ul>
          <p className="note about-contest">{t('contest')}</p>
        </article>
      </main>
    </Shell>
  );
}
