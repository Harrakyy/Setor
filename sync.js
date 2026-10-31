// Sinkron ke web usaha (Protokol Setor, docs/PROTOKOL-SETOR.md): kirim "Pembayaran Masuk" supaya tagihan otomatis Lunas.
// Murni: pengiriman HTTP disuntikkan lewat `send`, jadi bisa dites tanpa jaringan.

const BACKFILL_MS = 60 * 60 * 1000; // transaksi sampai 1 jam sebelum pairing ikut dikirim

/** 3 digit terakhir nominal masuk jalur usaha? Tanpa jalur (web lama) = semua nominal dikirim. */
export const inBand = (amount, band) => !band || (amount % 1000 >= band.min && amount % 1000 <= band.max);

/** Transaksi yang perlu dikirim, terlama dulu supaya urutan di server sesuai kejadian. Di luar jalur tetap di HP saja. */
export function pendingTx(list, conn) {
  if (!conn) return [];
  return list
    .filter((t) => t.time >= conn.pairedAt - BACKFILL_MS && inBand(t.amount, conn.band) && t.sync?.state !== "sent" && t.sync?.state !== "failed")
    .sort((a, b) => a.time - b.time);
}

const payloadOf = (t) => ({ notifId: t.id, amount: t.amount, time: t.time, text: t.text });

function withSync(list, id, sync, serverLabel) {
  return list.map((t) => (t.id === id ? { ...t, label: t.label || serverLabel || "", sync } : t));
}

/**
 * Kirim semua transaksi yang antri, satu per satu.
 * @param {(payload: object) => Promise<{status: number, data: any}>} send
 * @returns {Promise<{list: object[], revoked: boolean}>}
 */
export async function syncAll(list, conn, send, now = Date.now()) {
  let out = list;
  for (const t of pendingTx(list, conn)) {
    let res;
    try {
      res = await send(payloadOf(t));
    } catch (err) {
      // Offline / server tidak terjangkau: biarkan antri, coba lagi di kesempatan berikutnya
      out = withSync(out, t.id, { state: "queued", error: String(err?.message || err).slice(0, 120), at: now });
      return { list: out, revoked: false };
    }
    if (res.status === 401) return { list: out, revoked: true };
    if (res.status >= 200 && res.status < 300 && res.data?.success) {
      // `label` dari web mana pun (Kosinyuk: "K3 · Budi"); `reservationCode` dari Atmosphere versi lama
      const { result, label, reservationCode } = res.data.data;
      const serverLabel = label ?? (reservationCode ? `Booking ${reservationCode}` : null);
      out = withSync(out, t.id, { state: "sent", result, label: serverLabel, at: now }, serverLabel);
    } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      // Ditolak permanen (data tidak valid): jangan dikirim berulang
      out = withSync(out, t.id, { state: "failed", error: res.data?.error?.message ?? `HTTP ${res.status}`, at: now });
    } else {
      out = withSync(out, t.id, { state: "queued", error: res.data?.error?.message ?? `HTTP ${res.status}`, at: now });
      return { list: out, revoked: false };
    }
  }
  return { list: out, revoked: false };
}

/** "atmosphere-jb5u.vercel.app/admin" → "https://atmosphere-jb5u.vercel.app". Hanya https yang diterima. */
export function normalizeServerUrl(input) {
  const raw = String(input ?? "").trim();
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:" || !url.hostname.includes(".")) throw new Error("Alamat web harus https://");
  return url.origin;
}

/**
 * Gabungkan hasil sinkron ke list terbaru. Selama pengiriman berjalan, list bisa berubah
 * (notif baru masuk, label diedit, transaksi dihapus); perubahan itu tidak boleh tertimpa.
 */
export function mergeSynced(current, synced) {
  const byId = new Map(synced.map((t) => [t.id, t]));
  return current.map((t) => {
    const s = byId.get(t.id);
    if (!s || s.sync === t.sync) return t;
    return { ...t, sync: s.sync, label: t.label || s.label };
  });
}
