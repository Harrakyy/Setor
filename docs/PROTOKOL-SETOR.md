# Protokol Setor

Aturan yang harus dipenuhi web usaha (Kosinyuk, Atmosphere, tab.booth, …) supaya bisa disambungkan ke app Setor. Setor hanya membaca notifikasi "Rp… diterima" dari DANA dan mengirimkannya; web yang mencocokkan nominal ke tagihan.

Semua respons memakai bentuk `{ "success": true, "data": … }` atau `{ "success": false, "error": { "message": "…" } }`. Wajib HTTPS.

## 1. Pairing

`POST {web}/api/devices/pair`

```json
{ "code": "K7Q2M9XA", "name": "Samsung A15" }
```

Kode dibuat di halaman pengaturan web, 8 karakter, sekali pakai, berlaku 10 menit. Respons:

```json
{
  "token": "…",                                  // simpan di HP, kirim sebagai Bearer
  "device": { "id": "…", "name": "Samsung A15" },
  "business": { "name": "Kos Melati", "type": "kos" },
  "band": { "min": 500, "max": 999 }             // opsional, lihat §3
}
```

Web menyimpan **hash** token, bukan tokennya.

## 2. Uang masuk

`POST {web}/api/payments/qris/notification` dengan header `Authorization: Bearer <token>`

```json
{ "notifId": "id.dana|1793470000000|Rp799.873 diterima DANA Bisnis.", "amount": 799873, "time": 1793470000000, "text": "Rp799.873 diterima DANA Bisnis." }
```

- `notifId` unik per notifikasi. Web wajib anti-dobel: kiriman ulang dengan `notifId` sama tidak boleh melunasi dua kali.
- Respons `data`: `{ "result": "matched" | "unmatched" | "duplicate", "label": "K3 · Budi" | null }`. Setor memakai `label` sebagai label transaksi.
  Atmosphere versi lama mengirim `reservationCode` dan hasil huruf besar (`MATCHED`, `NO_MATCH`, …); Setor tetap memahaminya.
- `401` → token dicabut, Setor memutus koneksi. `4xx` lain (selain 429) → ditandai gagal, tidak dikirim ulang. `5xx`/offline → antri, dicoba lagi.

## 3. Jalur nominal (band)

Satu DANA bisa dipakai beberapa usaha. Supaya nominal dua usaha tidak pernah sama, tiap usaha memakai jalur **3 digit terakhir nominal bayar**:

| Usaha | 3 digit terakhir |
|---|---|
| tab.booth | 001–099 |
| Atmosphere | 100–499 |
| Kosinyuk | 500–999 |

Web memilih kode unik supaya nominal akhir jatuh di jalurnya, dan mengirim `band` saat pairing. Setor hanya mengirim nominal yang masuk jalur usaha itu; nominal lain (misalnya transfer pribadi Rp50.000) tetap di HP saja. Web yang tidak mengirim `band` menerima semua nominal.

## Belum ada

- Heartbeat (deteksi HP mati), HMAC + timestamp di atas Bearer, notifikasi aksi dari web ke Setor, sumber selain DANA.
