import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { NotificationsListener } from "capacitor-notifications-listener";
import { parseNotification, addTx, updateTx, deleteTx, totals, filterTx, toCsv, wibDate } from "../core.js";
import { pendingTx, syncAll, mergeSynced, normalizeServerUrl } from "../sync.js";

const isNative = Capacitor.isNativePlatform();
const KEY_TX = "setorpantau.tx";
const KEY_PKGS = "setorpantau.packages";
const KEY_CONN = "setorpantau.conn"; // { url, token, deviceName, pairedAt }
const DEFAULT_PKGS = ["id.dana"];

const $ = (id) => document.getElementById(id);
const rupiah = (n) => "Rp " + n.toLocaleString("id-ID");
const fmtWhen = (ms) =>
  new Date(ms).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB";

// Versi ringkas untuk kartu; detail tetap memakai tanggal lengkap
const fmtShort = (ms) =>
  new Date(ms).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

let txs = [];
let packages = DEFAULT_PKGS;
let editingId = null;
let listening = false;
let conn = null;
let syncing = false;

// ---------- penyimpanan ----------
async function load() {
  try {
    const [{ value: rawTx }, { value: rawPkgs }, { value: rawConn }] = await Promise.all([
      Preferences.get({ key: KEY_TX }),
      Preferences.get({ key: KEY_PKGS }),
      Preferences.get({ key: KEY_CONN }),
    ]);
    txs = rawTx ? JSON.parse(rawTx) : [];
    packages = rawPkgs ? JSON.parse(rawPkgs) : DEFAULT_PKGS;
    conn = rawConn ? JSON.parse(rawConn) : null;
  } catch {
    txs = [];
    packages = DEFAULT_PKGS;
    toast("Data tersimpan rusak, mulai dari kosong.");
  }
}

const saveTxs = () => Preferences.set({ key: KEY_TX, value: JSON.stringify(txs) });

// ---------- notifikasi ----------
async function onNotification(n) {
  const tx = parseNotification(n, packages);
  if (!tx) return;
  const before = txs.length;
  txs = addTx(txs, tx);
  if (txs.length === before) return; // sudah tercatat (notif dikirim ulang dari cache)
  await saveTxs();
  render();
  toast(`${rupiah(tx.amount)} masuk tercatat`);
  syncNow();
}

// ---------- sinkron ke web usaha (Protokol Setor: Kosinyuk, Atmosphere) ----------
// Di APK pakai HTTP native (tanpa CORS); di pratinjau browser pakai fetch biasa
async function postJson(url, body, token) {
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (isNative) {
    const r = await CapacitorHttp.post({ url, headers, data: body });
    let data = r.data;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = null; } }
    return { status: r.status, data };
  }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function syncNow() {
  if (!conn || syncing || !pendingTx(txs, conn).length) return;
  syncing = true;
  try {
    const { list, revoked } = await syncAll(txs, conn, (payload) =>
      postJson(`${conn.url}/api/payments/qris/notification`, payload, conn.token)
    );
    txs = mergeSynced(txs, list);
    await saveTxs();
    if (revoked) {
      conn = null;
      await Preferences.remove({ key: KEY_CONN });
      toast("Akses ke web dicabut admin. Hubungkan ulang dari Pengaturan.");
    }
    render();
    renderConn();
  } finally {
    syncing = false;
  }
}

async function pair() {
  let url;
  try {
    url = normalizeServerUrl($("connUrl").value);
  } catch {
    return toast("Alamat web tidak valid. Contoh: https://kosinyuk.id");
  }
  const code = $("connCode").value.trim().toUpperCase();
  if (code.length < 8) return toast("Isi kode pairing 8 karakter dari halaman admin.");
  $("connPair").disabled = true;
  try {
    const res = await postJson(`${url}/api/devices/pair`, { code, name: $("connName").value.trim() || "HP Setor" });
    if (!res.data?.success) return toast(res.data?.error?.message || "Gagal menghubungkan. Cek alamat web.");
    // band: jalur 3 digit usaha ini (Kosinyuk 500–999); web lama tanpa band menerima semua nominal
    const d = res.data.data;
    conn = { url, token: d.token, deviceName: d.device.name, business: d.business?.name ?? null, band: d.band ?? null, pairedAt: Date.now() };
    await Preferences.set({ key: KEY_CONN, value: JSON.stringify(conn) });
    $("connCode").value = "";
    toast("Terhubung ke web");
    renderConn();
    syncNow();
  } catch {
    toast("Web tidak bisa dihubungi. Cek internet dan alamat web.");
  } finally {
    $("connPair").disabled = false;
  }
}

function renderConn() {
  $("connForm").classList.toggle("hidden", !!conn);
  $("connInfo").classList.toggle("hidden", !conn);
  const name = conn ? conn.business ?? new URL(conn.url).host : "Belum terhubung ke web usaha";
  const info = conn
    ? `DANA · ${conn.band ? `jalur ${String(conn.band.min).padStart(3, "0")}–${conn.band.max}` : "semua nominal"}`
    : "Ketuk untuk menghubungkan, misalnya ke Kosinyuk";
  $("homeConn").innerHTML = `<span class="gi"></span><span class="gt"><b></b><span></span></span>`;
  $("homeConn").querySelector(".gi").textContent = conn ? name.slice(0, 2).toUpperCase() : "+";
  $("homeConn").querySelector("b").textContent = name;
  $("homeConn").querySelector(".gt span").textContent = info;
  if (!conn) return;
  const queued = pendingTx(txs, conn).length;
  $("connStatus").className = queued ? "notice warn" : "notice ok";
  $("connStatus").textContent =
    `Terhubung ke ${conn.business ?? new URL(conn.url).host} sebagai "${conn.deviceName}". ` +
    (queued ? `${queued} pembayaran menunggu terkirim.` : "Semua pembayaran sudah terkirim.");
}

const SYNC_CHIP = {
  MATCHED: ["Lunas", "ok"],
  ALREADY_PAID: ["Sudah lunas", "muted"],
  LATE_SLOT_TAKEN: ["Telat · refund", "warn"],
  NO_MATCH: ["Tak ada pesanan", "warn"],
  matched: ["Lunas", "ok"],
  unmatched: ["Tak ada tagihan", "warn"],
  duplicate: ["Sudah tercatat", "muted"],
};
function syncChip(t) {
  if (t.sync?.state === "sent") return SYNC_CHIP[t.sync.result] ?? ["Terkirim", "muted"];
  if (t.sync?.state === "failed") return ["Gagal kirim", "warn"];
  if (conn && pendingTx([t], conn).length) return ["Antri", "warn"];
  return null;
}

async function startListener() {
  if (!isNative) return;
  await NotificationsListener.removeAllListeners();
  await NotificationsListener.addListener("notificationReceivedEvent", onNotification);
  // Cache: notif yang datang saat aplikasi tertutup disimpan plugin, lalu dikirim ulang lewat restore
  await NotificationsListener.startListening({ cacheNotifications: true, packagesWhitelist: packages });
  await NotificationsListener.restoreCachedNotifications();
}

async function refreshPermission() {
  if (!isNative) return;
  try {
    listening = (await NotificationsListener.isListening()).value;
  } catch {
    listening = false;
  }
  renderPermission();
}

// ---------- tampilan ----------
// Baris: avatar (awal label), label + waktu, nominal + status kirim
function txRow(t) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tx";
  btn.dataset.id = t.id;
  btn.innerHTML = `<span class="av"></span><span class="mid"><span class="label"></span><span class="when"></span></span><span class="right"><span class="amt"></span></span>`;
  btn.querySelector(".av").textContent = t.label ? t.label.split(/[\s·]+/)[0].slice(0, 3) : "Rp";
  btn.querySelector(".label").textContent = t.label || "Uang masuk";
  btn.querySelector(".when").textContent = `${fmtShort(t.time)} · DANA${t.note ? " · " + t.note : ""}`;
  btn.querySelector(".amt").textContent = rupiah(t.amount);
  const sc = syncChip(t);
  if (sc) btn.querySelector(".right").append(Object.assign(document.createElement("span"), { className: `chip ${sc[1]}`, textContent: sc[0] }));
  btn.setAttribute("aria-label", `${rupiah(t.amount)}, ${fmtWhen(t.time)}${t.label ? ", " + t.label : ""}${t.note ? ", " + t.note : ""}`);
  btn.addEventListener("click", () => openDetail(t.id));
  return btn;
}

function fillList(el, list, emptyText) {
  el.replaceChildren(...(list.length ? list.map(txRow) : [Object.assign(document.createElement("div"), { className: "empty", textContent: emptyText })]));
}

const currentFilter = () => ({ q: $("q").value, from: $("from").value, to: $("to").value });

function render() {
  const t = totals(txs);
  $("todaySum").textContent = rupiah(t.today.sum);
  $("todayCount").textContent = `${t.today.count} transaksi`;
  $("monthSum").textContent = rupiah(t.month.sum);
  $("monthLabel").textContent = `Uang masuk ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", month: "long" })}`;
  $("monthCount").textContent = `${t.month.count} transaksi`;
  fillList($("recentList"), txs.slice(0, 5), "Belum ada pembayaran masuk tercatat.");

  const filtered = filterTx(txs, currentFilter());
  fillList($("txList"), filtered, txs.length ? "Tidak ada transaksi yang cocok." : "Belum ada pembayaran masuk tercatat.");
  $("filterCount").textContent = `${filtered.length} transaksi`;
  $("filterSum").textContent = rupiah(filtered.reduce((s, x) => s + x.amount, 0));
}

function renderPermission() {
  const status = $("permStatus");
  const warn = $("permWarn");
  if (!isNative) {
    status.className = "notice warn";
    status.textContent = "Mode pratinjau browser: izin notifikasi hanya ada di aplikasi Android.";
    $("grant").disabled = true;
    return;
  }
  status.className = listening ? "notice ok" : "notice warn";
  status.textContent = listening ? "Aktif — notifikasi DANA sedang dipantau." : "Belum aktif — Setor belum bisa membaca notifikasi.";
  warn.classList.toggle("hidden", listening);
  if (!listening) {
    warn.innerHTML = "<b>Akses Notifikasi belum aktif</b>Pembayaran DANA belum bisa dicatat sampai izin diaktifkan.";
    const go = Object.assign(document.createElement("button"), { className: "btn primary", type: "button", textContent: "Aktifkan sekarang" });
    go.addEventListener("click", requestPermission);
    warn.append(go);
  }
}

function setTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  for (const v of ["home", "tx", "settings"]) $(`view-${v}`).classList.toggle("hidden", v !== name);
  try { localStorage.setItem("setorpantau.tab", name); } catch {}
}

// ---------- detail ----------
function openDetail(id) {
  const t = txs.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  $("detailAmount").textContent = rupiah(t.amount);
  $("detailTime").textContent = fmtWhen(t.time);
  $("detailRaw").textContent = `${t.title ? t.title + " — " : ""}${t.text}`;
  const sc = syncChip(t);
  $("detailSync").classList.toggle("hidden", !sc);
  if (sc) $("detailSync").textContent = `Web: ${sc[0]}${t.sync?.label ? " · " + t.sync.label : ""}${t.sync?.error ? " · " + t.sync.error : ""}`;
  $("detailLabel").value = t.label;
  $("detailNote").value = t.note;
  $("detail").showModal();
}

$("detailSave").addEventListener("click", async () => {
  txs = updateTx(txs, editingId, { label: $("detailLabel").value, note: $("detailNote").value });
  await saveTxs();
  $("detail").close();
  render();
  toast("Catatan disimpan");
});

$("detailDelete").addEventListener("click", async () => {
  if (!confirm("Hapus catatan transaksi ini? Uang di DANA tidak terpengaruh.")) return;
  txs = deleteTx(txs, editingId);
  await saveTxs();
  $("detail").close();
  render();
  toast("Transaksi dihapus dari catatan");
});

// ---------- ekspor ----------
async function exportCsv(list) {
  if (!list.length) return toast("Belum ada transaksi untuk diekspor.");
  const name = `Setor-${wibDate(Date.now())}.csv`;
  const csv = toCsv(list);
  try {
    if (isNative) {
      const { uri } = await Filesystem.writeFile({ path: name, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: name, files: [uri] });
    } else {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: name });
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (err) {
    if (!/cancel/i.test(String(err?.message))) toast("Gagal mengekspor CSV.");
  }
}

// ---------- izin & sumber ----------
async function requestPermission() {
  try {
    await NotificationsListener.requestPermission();
  } catch {
    toast("Tidak bisa membuka pengaturan izin.");
  }
}

$("savePackages").addEventListener("click", async () => {
  const next = [...new Set($("packages").value.split(",").map((s) => s.trim()).filter(Boolean))];
  if (!next.length) return toast("Isi minimal satu paket aplikasi.");
  if (next.some((p) => !/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(p))) return toast("Format paket tidak valid, contoh: id.dana");
  packages = next;
  await Preferences.set({ key: KEY_PKGS, value: JSON.stringify(packages) });
  if (isNative) await NotificationsListener.replacePackagesWhitelist({ packagesWhitelist: packages });
  $("packages").value = packages.join(", ");
  toast("Sumber notifikasi disimpan");
});

// ---------- umum ----------
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => setTab(tab.dataset.tab));
for (const id of ["q", "from", "to"]) $(id).addEventListener("input", render);
$("resetFilter").addEventListener("click", () => {
  $("q").value = $("from").value = $("to").value = "";
  render();
});
$("exportCsv").addEventListener("click", () => exportCsv(filterTx(txs, currentFilter())));
$("exportCsv2").addEventListener("click", () => exportCsv(txs));
$("exportCsv3").addEventListener("click", () => exportCsv(txs));
for (const id of ["goConnect", "homeConn"]) $(id).addEventListener("click", () => setTab("settings"));
$("grant").addEventListener("click", requestPermission);
$("connPair").addEventListener("click", pair);
$("connRetry").addEventListener("click", async () => {
  // Gagal kirim permanen dibuka lagi supaya bisa dicoba ulang manual
  txs = txs.map((t) => (t.sync?.state === "failed" ? { ...t, sync: undefined } : t));
  await syncNow();
  if (!conn || !pendingTx(txs, conn).length) toast("Tidak ada yang perlu dikirim.");
});
$("connDisconnect").addEventListener("click", async () => {
  if (!confirm("Putuskan HP ini dari web? Pembayaran tidak lagi dikirim otomatis.")) return;
  conn = null;
  await Preferences.remove({ key: KEY_CONN });
  renderConn();
  render();
});

// Pratinjau browser: tiru notifikasi DANA supaya seluruh alur bisa dicoba tanpa HP
$("simulate").addEventListener("click", () =>
  onNotification({
    package: packages[0],
    title: "Pembayaran Masuk",
    text: `Rp${(Math.floor(Math.random() * 90) * 1000 + 1000).toLocaleString("id-ID")} diterima DANA Bisnis.`,
    time: Date.now(),
  })
);

// Kembali dari layar izin / aplikasi dibuka lagi: cek izin dan ambil notif yang tertahan di cache
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !isNative) return;
  await refreshPermission();
  if (listening) await NotificationsListener.restoreCachedNotifications().catch(() => {});
  syncNow();
});

// Coba kirim ulang antrian berkala selama aplikasi terbuka (misalnya setelah internet kembali)
setInterval(() => document.visibilityState === "visible" && syncNow(), 60_000);

(async () => {
  let tab = "home";
  try { tab = localStorage.getItem("setorpantau.tab") || "home"; } catch {}
  setTab(tab);
  await load();
  $("packages").value = packages.join(", ");
  $("previewNote").classList.toggle("hidden", isNative);
  render();
  renderPermission();
  renderConn();
  try {
    await startListener();
  } catch {
    toast("Pembaca notifikasi gagal dimulai.");
  }
  await refreshPermission();
  syncNow();
})();
