# SetorPantau — Catatan Pembayaran DANA

Aplikasi Android yang **membaca notifikasi DANA "Pembayaran Masuk"**, lalu otomatis **mencatat transaksinya di HP**.

Contoh notifikasi yang dicatat:

> **Pembayaran Masuk**
> Rp1.000 diterima DANA Bisnis.

## Fitur

- Total uang masuk **hari ini** dan **bulan ini** (waktu WIB)
- Daftar transaksi dengan **cari nominal**, label, catatan, dan **filter tanggal**
- Tiap transaksi bisa diberi **label** (misalnya "Booking R5Y2") dan **catatan**
- **Hapus** catatan transaksi tertentu
- **Ekspor CSV** lewat lembar Bagikan Android
- Notifikasi selain "Rp… diterima" (promo, uang keluar, aplikasi lain) **diabaikan dan tidak disimpan**
- Tetap mencatat walau aplikasi tertutup: service pembaca menyimpan notifikasi ke cache, lalu dimasukkan saat aplikasi dibuka lagi
- Semua data tersimpan **di HP saja**, tanpa server

## Pasang di HP

1. Unduh dari HP: **https://github.com/Harrakyy/SetorPantau/releases/download/latest/SetorPantau-latest-debug.apk**
2. Buka file APK-nya, izinkan **"Instal aplikasi tidak dikenal"**, lalu **Instal**.
3. Buka SetorPantau → **Pengaturan → Buka pengaturan izin** → aktifkan **SetorPantau** di Akses Notifikasi.
4. Matikan penghemat baterai: **Setelan → Aplikasi → SetorPantau → Baterai → Tidak dibatasi**. Tanpa ini, Android bisa menghentikan pembaca notifikasi diam-diam.

Notifikasi yang masuk **sebelum** izin aktif tidak bisa dibaca.

## Batasan

- Pembaca notifikasi memakai plugin [capacitor-notifications-listener](https://github.com/Random90/capacitor-notifications-listener), yang menurut pembuatnya masih dalam pengembangan aktif. Kalau ada pembayaran yang tidak tercatat, cek di aplikasi DANA dan laporkan.
- Hanya membaca notifikasi. Kalau DANA tidak memunculkan notifikasi (notif DANA dimatikan), transaksi tidak tercatat.
- Kalau DANA mengubah kalimat notifikasinya, pola di `core.js` perlu disesuaikan.

## Pengembangan

| Path | Isi |
|---|---|
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
