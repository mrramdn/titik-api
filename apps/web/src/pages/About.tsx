import { Shell } from '../components/Shell';

export function AboutPage() {
  return (
    <Shell>
      <div className="page narrow about">
        <p className="kicker">Tentang Titik Api</p>
        <h1>Jalur terakhir dari satelit ke desa.</h1>
        <p className="lead">Titik Api menyambung data titik panas yang sudah ada ke orang yang paling dekat dengan lokasinya: relawan Masyarakat Peduli Api (MPA) dan kepala desa. Hasil cek lapangan mereka kembali ke BPBD dan Daops Manggala Agni. Titik Api tidak menggantikan SiPongi+ atau sistem resmi lain. Ekspornya mengikuti isian groundcheck SiPongi+ supaya bisa diteruskan.</p>

        <h2>Cara kerja</h2>
        <ol className="steps">
          <li><b>Satelit.</b> Setiap 30 menit server mengambil CSV publik NASA FIRMS (VIIRS 375 m) dari NOAA-21, NOAA-20, dan S-NPP. Pengiriman data S-NPP berhenti 1–2 November 2026, dan Titik Api sudah memakai NOAA-20/21 sejak awal.</li>
          <li><b>Triase.</b> Deteksi ditautkan ke poligon 327 desa/kelurahan OKI, ditandai bila berada di lahan gambut atau dekat sumber panas tetap, lalu digabung menjadi kejadian: titik-titik yang berjarak ≤ 750 m pada hari yang sama. Skor prioritas dihitung dengan aturan terbuka (keyakinan, FRP, jumlah deteksi, gambut, jarak permukiman), bukan model AI.</li>
          <li><b>Kartu desa.</b> Kejadian prioritas sedang dan tinggi menjadi kartu untuk yang memantau desa itu, lengkap dengan jarak dan arah dari pusat desa. Kartu masuk sebagai notifikasi push dan bisa diteruskan ke grup WhatsApp dengan satu ketukan.</li>
          <li><b>Cek lapangan.</b> Relawan memilih satu dari lima status, menambah foto, GPS, dan catatan. Tanpa sinyal, laporan disimpan di ponsel dan terkirim otomatis nanti dengan waktu cek yang asli.</li>
          <li><b>Dasbor.</b> BPBD/Daops melihat persentase kejadian yang sudah dicek, median waktu dari deteksi sampai cek, dan kejadian prioritas tinggi yang belum disentuh. Laporan "alarm palsu" menandai lokasinya selama 30 hari agar deteksi berikutnya tidak didahulukan.</li>
        </ol>

        <h2>Batasan yang perlu diketahui</h2>
        <ul>
          <li>Titik panas adalah indikasi anomali suhu permukaan dan wajib dicek di lapangan. Api di bawah awan, asap tebal, kanopi, atau gambut yang membara di bawah permukaan bisa tidak terdeteksi.</li>
          <li>Satelit VIIRS melintas sekitar dua kali sehari, dan FIRMS merilis data global paling lambat ±3 jam setelah pengamatan. Karena itu median waktu di dasbor sudah termasuk jeda rilis data.</li>
          <li>Peta gambut memakai Global peatland extent (Miettinen dkk. 2016 untuk Indonesia), bukan peta KHG resmi.</li>
          <li>Akun di prototipe ini adalah akun demo bersama. Verifikasi dari akun demo ditandai "demo" dan dihapus saat reset malam. Data titik panasnya asli.</li>
        </ul>

        <h2>Privasi dan etika</h2>
        <ul>
          <li>Nama pelapor, catatan, dan foto hanya terlihat oleh pengguna yang masuk. Publik hanya melihat status dan waktunya.</li>
          <li>Data lokasi di dalam foto (EXIF) dibuang. Koordinat laporan hanya dari GPS yang dipilih pelapor untuk dikirim.</li>
          <li>Titik Api tidak menampilkan pemilik lahan atau perusahaan. Status "bakar terkendali" dicatat sebagai fakta lapangan, bukan penilaian hukum.</li>
        </ul>

        <h2>Sumber data dan lisensi</h2>
        <ul className="sources">
          <li>Titik panas: NASA FIRMS, VIIRS 375 m NRT (NOAA-21, NOAA-20, S-NPP). "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS)."</li>
          <li>Batas desa: Indonesia Subnational Administrative Boundaries (COD-AB), BPS melalui OCHA/HDX, CC BY-IGO.</li>
          <li>Lahan gambut: "Global peatland extent", Global Nature Watch (d/h Global Forest Watch), CC BY 4.0.</li>
          <li>Alert gangguan hutan: Integrated deforestation alerts (UMD/GLAD, WUR) melalui Global Nature Watch, CC BY 4.0.</li>
          <li>Permukiman dan kawasan industri: © kontributor OpenStreetMap, ODbL.</li>
          <li>Peta dasar: OpenFreeMap, © OpenMapTiles, © kontributor OpenStreetMap. Citra: Sentinel-2 cloudless 2023 oleh EOX (CC BY-NC-SA 4.0), berisi data Copernicus Sentinel yang dimodifikasi.</li>
        </ul>
        <p className="fine">Prototipe Hackathon JOINTS UGM 2026, tim Close AI (Universitas Bina Nusantara). Kode sumber: github.com/mrramdn/titik-api.</p>
      </div>
    </Shell>
  );
}
