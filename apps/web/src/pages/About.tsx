import { Shell } from '../components/Shell';

export function AboutPage() {
  return (
    <Shell>
      <main className="page narrow">
        <div className="page-head"><div><h1 className="title-24">Tentang Titik Api</h1><p>Jalur terakhir dari satelit ke desa, lalu kembali ke posko.</p></div></div>
        <article className="doc">
          <p>Titik Api menyambungkan data titik panas yang sudah ada ke orang yang paling dekat dengan lokasinya: relawan Masyarakat Peduli Api (MPA) dan kepala desa. Hasil cek lapangan mereka kembali ke BPBD dan Daops Manggala Agni. Titik Api tidak menggantikan SiPongi+ atau sistem resmi lain; ekspornya mengikuti isian groundcheck SiPongi+ agar bisa diteruskan.</p>
          <p>Cakupan prototipe: seluruh Sumatera Selatan dan Kalimantan Tengah, 4.837 desa dan kelurahan di 31 kabupaten/kota, dengan Kabupaten Ogan Komering Ilir sebagai pilot.</p>
          <h2>Cara kerja</h2>
          <ol>
            <li><b>Satelit.</b> Setiap 30 menit server mengambil CSV publik NASA FIRMS (VIIRS 375 m) dari NOAA-21, NOAA-20, dan S-NPP. Pengiriman data S-NPP berhenti 1–2 November 2026; Titik Api sudah memakai NOAA-20/21 sejak awal.</li>
            <li><b>Triase.</b> Deteksi ditautkan ke poligon desa, ditandai bila di lahan gambut atau dekat sumber panas tetap, lalu digabung menjadi kejadian: titik berjarak ≤ 750 m pada hari yang sama. Skor prioritas dihitung dengan aturan terbuka, bukan model AI.</li>
            <li><b>Kartu desa.</b> Kejadian prioritas sedang dan tinggi menjadi kartu bagi yang memantau desa itu: jarak dan arah dari pusat desa, gambut atau bukan. Kartu masuk sebagai notifikasi push dan bisa diteruskan ke grup WhatsApp dengan satu ketukan.</li>
            <li><b>Cek lapangan.</b> Relawan memilih satu dari lima status, menambah foto, GPS, dan catatan. Tanpa sinyal, laporan disimpan di ponsel dan terkirim sendiri dengan waktu cek yang asli.</li>
            <li><b>Dasbor.</b> BPBD/Daops melihat persentase kejadian yang sudah dicek, median waktu dari deteksi sampai cek, dan prioritas tinggi yang belum disentuh. Laporan alarm palsu menandai lokasinya selama 30 hari.</li>
          </ol>
          <h2>Batasan</h2>
          <ul>
            <li>Titik panas adalah indikasi anomali suhu permukaan dan wajib dicek di lapangan. Api di bawah awan, asap tebal, kanopi, atau gambut yang membara di bawah permukaan bisa tidak terdeteksi.</li>
            <li>Satelit VIIRS melintas sekitar dua kali sehari, dan FIRMS merilis data global paling lambat ±3 jam setelah pengamatan. Median waktu di dasbor sudah termasuk jeda itu.</li>
            <li>Peta gambut memakai Global peatland extent (Miettinen dkk. 2016 untuk Indonesia), bukan peta KHG resmi.</li>
            <li>Akun di prototipe adalah akun demo bersama. Verifikasi dari akun demo ditandai "demo" dan dihapus saat reset malam. Data titik panasnya asli.</li>
          </ul>
          <h2>Privasi dan etika</h2>
          <ul>
            <li>Nama pelapor, catatan, dan foto hanya terlihat oleh pengguna yang masuk; publik hanya melihat status dan waktunya.</li>
            <li>Data lokasi di dalam foto (EXIF) dibuang. Koordinat laporan hanya dari GPS yang dipilih pelapor untuk dikirim.</li>
            <li>Titik Api tidak menampilkan pemilik lahan atau perusahaan. "Bakar terkendali" dicatat sebagai fakta lapangan, bukan penilaian hukum.</li>
          </ul>
          <h2>Sumber data dan lisensi</h2>
          <ul>
            <li>Titik panas: NASA FIRMS, VIIRS 375 m NRT (NOAA-21, NOAA-20, S-NPP). "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS)."</li>
            <li>Batas desa: Indonesia COD-AB, BPS melalui OCHA/HDX, CC BY-IGO.</li>
            <li>Lahan gambut dan alert gangguan hutan: Global Nature Watch (d/h Global Forest Watch), CC BY 4.0.</li>
            <li>Permukiman dan kawasan industri: © kontributor OpenStreetMap, ODbL. Peta dasar: OpenFreeMap, © OpenMapTiles. Citra: Sentinel-2 cloudless 2023 oleh EOX (CC BY-NC-SA 4.0).</li>
          </ul>
          <p className="note">Prototipe Hackathon JOINTS UGM 2026, tim Close AI (Universitas Bina Nusantara). Kode sumber: github.com/mrramdn/titik-api.</p>
        </article>
      </main>
    </Shell>
  );
}
