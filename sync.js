// Sinkron ke web usaha (Protokol Setor, docs/PROTOKOL-SETOR.md): kirim "Pembayaran Masuk" supaya tagihan otomatis Lunas.
// Murni: pengiriman HTTP disuntikkan lewat `send`, jadi bisa dites tanpa jaringan.

const BACKFILL_MS = 60 * 60 * 1000; // transaksi sampai 1 jam sebelum pairing ikut dikirim

/** 3 digit terakhir nominal masuk jalur usaha? Tanpa jalur (web lama) = semua nominal dikirim. */
export const inBand = (amount, band) => !band || (amount % 1000 >= band.min && amount % 1000 <= band.max);

/**
 * Usaha tujuan satu uang masuk di antara beberapa web yang terhubung: yang jalurnya cocok,
 * kalau tidak ada, web lama tanpa jalur (Atmosphere) yang pertama, kalau tidak ada juga: null (tetap di HP).
 */
export const targetConn = (t, conns) =>
  conns.find((c) => c.band && inBand(t.amount, c.band)) ?? conns.find((c) => !c.band) ?? null;

/** Transaksi yang perlu dikirim ke `conn`, terlama dulu supaya urutan di server sesuai kejadian. */
export function pendingTx(list, conn, conns = [conn]) {
  if (!conn) return [];
  return list
    .filter((t) => t.time >= conn.pairedAt - BACKFILL_MS && targetConn(t, conns) === conn && t.sync?.state !== "sent" && t.sync?.state !== "failed")
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
export async function syncAll(list, conn, send, now = Date.now(), conns = [conn]) {
  let out = list;
  for (const t of pendingTx(list, conn, conns)) {
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
      out = withSync(out, t.id, { state: "sent", result, label: serverLabel, to: conn.url, at: now }, serverLabel);
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

const rp = (n) => `Rp${n.toLocaleString("id-ID")}`;

/**
 * Teks notifikasi Setor untuk satu uang masuk, mengikuti status kirimnya.
 * Versi native (app tertutup) ada di SetorNotifier.java dengan kalimat yang sama.
 */
export function notifCopy(t, connOrConns) {
  const conns = Array.isArray(connOrConns) ? connOrConns : connOrConns ? [connOrConns] : [];
  const masuk = `${rp(t.amount)} masuk`;
  const s = t.sync;
  if (!conns.length) return { title: masuk, text: "DANA · tercatat di HP" };
  const conn = conns.find((c) => c.url === s?.to) ?? targetConn(t, conns);
  const business = conn?.business ?? "web usaha";
  if (s?.state === "sent") {
    const already = s.result === "duplicate" || s.result === "ALREADY_PAID";
    if (/^matched$/i.test(s.result ?? "") || (already && s.label)) {
      return { title: `✅ ${s.label ? `${s.label} lunas` : "Lunas"}`, text: `${rp(t.amount)} · ${business}` };
    }
    if (already) return { title: masuk, text: `Sudah tercatat di ${business}` };
    return { title: masuk, text: `Belum cocok dengan tagihan · cek di ${business}` };
  }
  if (s?.state === "failed") return { title: masuk, text: "Gagal dikirim · buka Setor" };
  if (!conn) return { title: masuk, text: "DANA · di luar jalur usaha, disimpan di HP saja" };
  return { title: masuk, text: `DANA · mengirim ke ${business}…` };
}

/** Ringkasan bulan ini per usaha (untuk layar Ringkasan): jumlah & total per tujuan, sisanya "Di HP saja". */
export function perBusiness(list, conns, month) {
  const groups = new Map(conns.map((c) => [c.url, { key: c.url, name: c.business ?? new URL(c.url).host, sum: 0, count: 0 }]));
  const local = { key: "local", name: "Di HP saja", sum: 0, count: 0 };
  for (const t of list) {
    if (!month(t.time)) continue;
    const g = groups.get(t.sync?.state === "sent" ? t.sync.to : targetConn(t, conns)?.url) ?? local;
    g.sum += t.amount;
    g.count += 1;
  }
  return [...groups.values(), local].filter((g) => g.count > 0);
}

/** Isi QR pairing dari web usaha ("https://kosinyuk.id/setor/pair?c=K7Q2M9XA") → { url, code }, atau null kalau bukan QR Setor. */
export function parsePairQr(text) {
  try {
    const u = new URL(String(text).trim());
    const code = (u.searchParams.get("c") ?? u.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return code.length >= 8 ? { url: normalizeServerUrl(u.origin), code } : null;
  } catch {
    return null;
  }
}
