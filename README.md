# Setor — Catatan & Sinkron Pembayaran DANA

Aplikasi Android yang **membaca notifikasi DANA "Pembayaran Masuk"**, **mencatat transaksinya di HP**, dan (kalau dihubungkan) **mengirimnya ke web usaha** seperti Kosinyuk supaya tagihan otomatis Lunas.

Contoh notifikasi yang dicatat:

> **Pembayaran Masuk**
> Rp1.000 diterima DANA Bisnis.

## Fitur

- Total uang masuk **hari ini** dan **bulan ini** (waktu WIB)
- Daftar transaksi dengan **cari nominal**, label, catatan, dan **filter tanggal**
- Tiap transaksi bisa diberi **label** (misalnya "K3 · Budi") dan **catatan**
- **Hapus** catatan transaksi tertentu
- **Ekspor CSV** lewat lembar Bagikan Android
- Notifikasi selain "Rp… diterima" (promo, uang keluar, aplikasi lain) **diabaikan dan tidak disimpan**
- Tetap mencatat walau aplikasi tertutup: service pembaca menyimpan notifikasi ke cache, lalu dimasukkan saat aplikasi dibuka lagi
- Tanpa dihubungkan ke web, semua data tersimpan **di HP saja**
- **Banyak usaha sekaligus** (tab Usaha → +): hubungkan lewat **scan QR** dari web usaha atau ketik alamat + kode. Uang masuk dikirim ke usaha pemilik jalur 3 digitnya ([Protokol Setor](docs/PROTOKOL-SETOR.md)); nominal di luar jalur tetap di HP saja
- **Notifikasi Setor** dengan bunyi khas walau aplikasi tertutup: "✅ K3 · Budi lunas"
- **Ringkasan** bulan ini per usaha, **kotak Notifikasi** (hasil kirim + tagihan belum lunas dengan tombol pengingat WA)
- **Panduan awal** 4 langkah (izin baca notifikasi, izin tampilkan notifikasi, baterai) dan **Kesehatan HP** di Pengaturan

## Pasang di HP

1. Unduh APK terbaru dari HP: **https://github.com/Harrakyy/Setor/releases/download/latest/Setor-latest-debug.apk**
   - Atau buka halaman rilis **https://github.com/Harrakyy/Setor/releases/tag/latest** lalu ketuk **Setor-latest-debug.apk**.
   - APK ini dibuat otomatis oleh GitHub Actions setiap ada push ke `main` (tab **Actions → Android APK**), jadi selalu versi terbaru.
   - Link 404? Repo masih privat: ubah di **Settings → General → Danger Zone → Change visibility → Public**, atau unduh sambil login GitHub.
2. Buka file APK-nya, izinkan **"Instal aplikasi tidak dikenal"**, lalu **Instal**.
   - Semua APK dari CI sekarang memakai tanda tangan yang sama, jadi versi baru langsung **memperbarui** yang lama.
   - Kalau muncul **"Aplikasi tidak terinstal"**, Setor di HP masih bertanda tangan lama: ekspor CSV dulu (Pengaturan → Data), hapus Setor, lalu pasang APK ini. Cukup sekali.
3. Buka Setor → **Pengaturan → Buka pengaturan izin** → aktifkan **Setor** di Akses Notifikasi.
4. Matikan penghemat baterai: **Setelan → Aplikasi → Setor → Baterai → Tidak dibatasi**. Tanpa ini, Android bisa menghentikan pembaca notifikasi diam-diam.

5. Opsional, hubungkan ke web usaha: di web (mis. Kosinyuk → Pengaturan → **Hubungkan HP**) muncul alamat web + kode 8 karakter. Di Setor: **Pengaturan → Hubungkan ke web**, isi keduanya, lalu **Hubungkan**.

Notifikasi yang masuk **sebelum** izin aktif tidak bisa dibaca.

## Batasan

- Pembaca notifikasi memakai plugin [capacitor-notifications-listener](https://github.com/Random90/capacitor-notifications-listener), yang menurut pembuatnya masih dalam pengembangan aktif. Kalau ada pembayaran yang tidak tercatat, cek di aplikasi DANA dan laporkan.
- Hanya membaca notifikasi. Kalau DANA tidak memunculkan notifikasi (notif DANA dimatikan), transaksi tidak tercatat.
- Kalau DANA mengubah kalimat notifikasinya, pola di `core.js` perlu disesuaikan.

## Pengembangan

| Path | Isi |
|---|---|
| `sync.js` | Kirim uang masuk ke web usaha mengikuti [Protokol Setor](docs/PROTOKOL-SETOR.md): label dari web, hanya nominal di jalur usaha |
| `core.js` | Logika murni: parse notifikasi, anti-dobel, total WIB, cari, CSV (`npm test`) |
| `web/` | UI (navbar atas, kartu, warna navy) |
| `build.mjs` | Bundle `web/` → `www/` dengan esbuild |
| `android/` | Proyek Android (Capacitor 8), service pembaca notifikasi didaftarkan di `AndroidManifest.xml` |
| `e2e/` | Uji di emulator: notifikasi sungguhan dikirim ke Android lalu dicek tercatat |

```bash
npm install
npm test        # unit test logika
npm run dev     # pratinjau browser http://localhost:5178 (ada tombol simulasi notif)
```

## Rilis

- Setiap push ke `main` → APK debug di rilis **latest** (link di atas) + E2E di emulator.
- APK rilis bertanda tangan: isi secret `ANDROID_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`, lalu push tag `v1.0.0`. Kunci tanda tangan **jangan pernah di-commit**.
