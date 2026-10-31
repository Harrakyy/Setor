import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { NotificationsListener } from "capacitor-notifications-listener";
import { parseNotification, addTx, updateTx, deleteTx, totals, filterTx, toCsv, wibDate } from "../core.js";

const isNative = Capacitor.isNativePlatform();
const KEY_TX = "setorpantau.tx";
const KEY_PKGS = "setorpantau.packages";
const DEFAULT_PKGS = ["id.dana"];

const $ = (id) => document.getElementById(id);
const rupiah = (n) => "Rp " + n.toLocaleString("id-ID");
const fmtWhen = (ms) =>
  new Date(ms).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB";

let txs = [];
let packages = DEFAULT_PKGS;
let editingId = null;
let listening = false;

// ---------- penyimpanan ----------
async function load() {
  try {
    const [{ value: rawTx }, { value: rawPkgs }] = await Promise.all([
      Preferences.get({ key: KEY_TX }),
      Preferences.get({ key: KEY_PKGS }),
    ]);
    txs = rawTx ? JSON.parse(rawTx) : [];
    packages = rawPkgs ? JSON.parse(rawPkgs) : DEFAULT_PKGS;
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
const icoIn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m0 0-6-6m6 6 6-6"/></svg>';

function txRow(t) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tx";
  btn.dataset.id = t.id;
  btn.innerHTML = `<span class="dot">${icoIn}</span><span class="main"><span class="amt"></span><span class="meta"></span></span>`;
  btn.querySelector(".amt").textContent = rupiah(t.amount);
  const meta = btn.querySelector(".meta");
  if (t.label) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = t.label;
    meta.append(chip);
  }
  meta.append(fmtWhen(t.time) + (t.note ? " · " + t.note : ""));
  btn.setAttribute("aria-label", `${rupiah(t.amount)}, ${fmtWhen(t.time)}${t.label ? ", " + t.label : ""}`);
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
  status.textContent = listening ? "Aktif — notifikasi DANA sedang dipantau." : "Belum aktif — SetorPantau belum bisa membaca notifikasi.";
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
  const name = `SetorPantau-${wibDate(Date.now())}.csv`;
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
$("grant").addEventListener("click", requestPermission);

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
});

(async () => {
  let tab = "home";
  try { tab = localStorage.getItem("setorpantau.tab") || "home"; } catch {}
  setTab(tab);
  await load();
  $("packages").value = packages.join(", ");
  $("previewNote").classList.toggle("hidden", isNative);
  render();
  renderPermission();
  try {
    await startListener();
  } catch {
    toast("Pembaca notifikasi gagal dimulai.");
  }
  await refreshPermission();
})();
