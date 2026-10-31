// Logika murni SetorPantau: tanpa dependensi, tanpa akses perangkat, supaya bisa dites dengan node --test.
// Semua fungsi mengembalikan nilai baru; list transaksi tidak pernah diubah langsung.

// Contoh notifikasi DANA: judul "Pembayaran Masuk", teks "Rp1.000 diterima DANA Bisnis."
const AMOUNT_RE = /Rp\s?([\d.]+)(?:,\d{1,2})?\s+diterima/i;

const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });

/** Tanggal WIB "YYYY-MM-DD" dari timestamp ms. */
export const wibDate = (ms) => fmtDate.format(new Date(ms));
const wibTime = (ms) => fmtTime.format(new Date(ms));

/**
 * Ubah notifikasi Android menjadi transaksi, atau null kalau bukan uang masuk dari paket yang diizinkan.
 * @param {{package: string, title?: string, text?: string, textlines?: string[], time: number} | null} n
 * @param {string[]} packages paket sumber yang dipercaya, misalnya ["id.dana"]
 */
export function parseNotification(n, packages) {
  if (!n || !packages.includes(n.package)) return null;
  const text = [n.text, ...(n.textlines ?? [])].filter(Boolean).join(" ").trim();
  const match = text.match(AMOUNT_RE);
  if (!match) return null;
  const amount = Number(match[1].replace(/\./g, ""));
  if (!Number.isInteger(amount) || amount <= 0) return null;
  const time = Number(n.time) || Date.now();
  return {
    // Notifikasi yang sama bisa dikirim ulang (cache plugin, update notif); kunci ini mencegah catatan ganda
    id: `${n.package}|${time}|${text}`,
    amount,
    time,
    title: n.title ?? "",
    text,
    pkg: n.package,
    note: "",
    label: "",
  };
}

export function addTx(list, tx) {
  if (!tx || list.some((t) => t.id === tx.id)) return list;
  return [...list, tx].sort((a, b) => b.time - a.time);
}

/** Hanya catatan & label yang boleh diubah; data dari notifikasi tetap apa adanya. */
export function updateTx(list, id, patch) {
  const allowed = {};
  if (typeof patch.note === "string") allowed.note = patch.note.trim().slice(0, 300);
  if (typeof patch.label === "string") allowed.label = patch.label.trim().slice(0, 60);
  return list.map((t) => (t.id === id ? { ...t, ...allowed } : t));
}

export const deleteTx = (list, id) => list.filter((t) => t.id !== id);

export function totals(list, now = Date.now()) {
  const today = wibDate(now);
  const month = today.slice(0, 7);
  const acc = { today: { sum: 0, count: 0 }, month: { sum: 0, count: 0 } };
  for (const t of list) {
    const d = wibDate(t.time);
    if (d.slice(0, 7) !== month) continue;
    acc.month.sum += t.amount;
    acc.month.count += 1;
    if (d === today) {
      acc.today.sum += t.amount;
      acc.today.count += 1;
    }
  }
  return acc;
}

/**
 * Cari: angka (boleh pakai "Rp" dan titik) dicocokkan ke nominal; selain itu ke catatan, label, dan teks.
 * @param {{q?: string, from?: string, to?: string}} f from/to berformat "YYYY-MM-DD" (WIB)
 */
export function filterTx(list, { q = "", from = "", to = "" } = {}) {
  const query = q.trim().toLowerCase();
  const digits = query.replace(/^rp\s*/, "").replace(/\./g, "");
  const byAmount = /^\d+$/.test(digits);
  return list.filter((t) => {
    const d = wibDate(t.time);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (!query) return true;
    if (byAmount) return String(t.amount).includes(digits);
    return [t.note, t.label, t.text].some((s) => (s ?? "").toLowerCase().includes(query));
  });
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(list) {
  const rows = list.map((t) =>
    [`${wibDate(t.time)} ${wibTime(t.time)}`, t.amount, t.label, t.note, t.text].map(csvCell).join(",")
  );
  return ["Waktu (WIB),Nominal,Label,Catatan,Teks Notifikasi", ...rows].join("\n") + "\n";
}
