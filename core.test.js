import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNotification, addTx, updateTx, deleteTx, totals, filterTx, toCsv, wibDate,
} from "./core.js";

const PKGS = ["id.dana"];
// Bentuk persis notifikasi dari screenshot DANA Bisnis (31 Okt 2026, 21.43 WIB)
const notif = (over = {}) => ({
  package: "id.dana",
  title: "Pembayaran Masuk",
  text: "Rp1.000 diterima DANA Bisnis.",
  textlines: [],
  time: Date.parse("2026-10-31T21:43:00+07:00"),
  ...over,
});

test("parse: notif DANA 'Pembayaran Masuk' → nominal 1000", () => {
  const tx = parseNotification(notif(), PKGS);
  assert.equal(tx.amount, 1000);
  assert.equal(tx.time, Date.parse("2026-10-31T21:43:00+07:00"));
  assert.equal(tx.note, "");
  assert.equal(tx.label, "");
  assert.ok(tx.id);
});

test("parse: nominal besar dengan titik ribuan dan desimal koma", () => {
  assert.equal(parseNotification(notif({ text: "Rp1.250.000 diterima DANA Bisnis." }), PKGS).amount, 1250000);
  assert.equal(parseNotification(notif({ text: "Rp 25.000,00 diterima DANA Bisnis." }), PKGS).amount, 25000);
});

test("parse: teks ada di textlines (notifikasi multi-baris)", () => {
  const tx = parseNotification(notif({ text: "", textlines: ["Rp30.999 diterima DANA Bisnis."] }), PKGS);
  assert.equal(tx.amount, 30999);
});

test("parse: abaikan paket lain, promo, dan uang keluar", () => {
  assert.equal(parseNotification(notif({ package: "com.whatsapp" }), PKGS), null);
  assert.equal(parseNotification(notif({ title: "Promo 11.11!", text: "Cashback Rp10.000 untukmu" }), PKGS), null);
  assert.equal(parseNotification(notif({ title: "Pembayaran Berhasil", text: "Rp15.000 berhasil dibayar ke Toko A" }), PKGS), null);
  assert.equal(parseNotification(notif({ text: "Rp0 diterima DANA Bisnis." }), PKGS), null);
  assert.equal(parseNotification(null, PKGS), null);
});

test("addTx: notif yang sama tidak tercatat dua kali, urut terbaru dulu", () => {
  const a = parseNotification(notif(), PKGS);
  const b = parseNotification(notif({ time: a.time + 60_000, text: "Rp2.000 diterima DANA Bisnis." }), PKGS);
  let list = addTx([], a);
  list = addTx(list, a);
  list = addTx(list, b);
  assert.equal(list.length, 2);
  assert.equal(list[0].amount, 2000);
});

test("updateTx/deleteTx tidak mengubah list asli (immutable)", () => {
  const a = parseNotification(notif(), PKGS);
  const list = addTx([], a);
  const edited = updateTx(list, a.id, { note: "Budi meja 3", label: "Booking R5Y2", amount: 999 });
  assert.equal(edited[0].note, "Budi meja 3");
  assert.equal(edited[0].label, "Booking R5Y2");
  assert.equal(edited[0].amount, 1000); // hanya note & label yang boleh diubah
  assert.equal(list[0].note, "");
  assert.equal(deleteTx(edited, a.id).length, 0);
  assert.equal(edited.length, 1);
});

test("totals: hari ini & bulan ini dihitung dalam WIB", () => {
  const mk = (iso, amount) => ({ id: iso, amount, time: Date.parse(iso) });
  const list = [
    mk("2026-10-31T23:30:00+07:00", 5000), // hari ini WIB (sudah 1 Nov di UTC? tidak, 16:30 UTC)
    mk("2026-10-31T00:10:00+07:00", 2000), // hari ini WIB, padahal masih 30 Okt di UTC
    mk("2026-10-30T22:00:00+07:00", 1000), // kemarin
    mk("2026-09-30T22:00:00+07:00", 9000), // bulan lalu
  ];
  const t = totals(list, Date.parse("2026-10-31T23:59:00+07:00"));
  assert.deepEqual(t.today, { sum: 7000, count: 2 });
  assert.deepEqual(t.month, { sum: 8000, count: 3 });
  assert.equal(wibDate(Date.parse("2026-10-30T17:10:00Z")), "2026-10-31");
});

test("filterTx: cari nominal, teks catatan/label, dan rentang tanggal", () => {
  const mk = (amount, iso, note = "", label = "") => ({ id: iso, amount, time: Date.parse(iso), note, label, text: "" });
  const list = [
    mk(30999, "2026-10-31T10:00:00+07:00", "", "Booking R5Y2"),
    mk(25000, "2026-10-30T10:00:00+07:00", "Budi"),
    mk(1000, "2026-10-29T10:00:00+07:00"),
  ];
  assert.deepEqual(filterTx(list, { q: "30.999" }).map((t) => t.amount), [30999]);
  assert.deepEqual(filterTx(list, { q: "rp 25000" }).map((t) => t.amount), [25000]);
  assert.deepEqual(filterTx(list, { q: "budi" }).map((t) => t.amount), [25000]);
  assert.deepEqual(filterTx(list, { q: "r5y2" }).map((t) => t.amount), [30999]);
  assert.deepEqual(filterTx(list, { from: "2026-10-30", to: "2026-10-30" }).map((t) => t.amount), [25000]);
  assert.equal(filterTx(list, {}).length, 3);
});

test("toCsv: header, waktu WIB, dan teks dengan koma/kutip di-escape", () => {
  const csv = toCsv([{ id: "x", amount: 1000, time: Date.parse("2026-10-31T21:43:00+07:00"), label: "A, B", note: 'kata "tes"', text: "Rp1.000 diterima DANA Bisnis." }]);
  const [head, row] = csv.trim().split("\n");
  assert.equal(head, "Waktu (WIB),Nominal,Label,Catatan,Teks Notifikasi");
  assert.equal(row, '2026-10-31 21:43,1000,"A, B","kata ""tes""",Rp1.000 diterima DANA Bisnis.');
});

test("cadangan: bolak-balik, buang data rusak, tolak file lain", async () => {
  const { toBackup, fromBackup, addTx } = await import("./core.js");
  const tx = { id: "id.dana|1|Rp1.000 diterima", amount: 1000, time: 1, title: "", text: "Rp1.000 diterima", pkg: "id.dana", note: "Budi", label: "K3" };
  const back = fromBackup(toBackup([tx, { id: "x", amount: -5, time: 2 }], ["id.dana", "bukan paket"]));
  assert.deepEqual(back.txs, [tx]);
  assert.deepEqual(back.packages, ["id.dana"]);
  assert.throws(() => fromBackup('{"hello":1}'), /Bukan file cadangan/);
  // dipulihkan ke HP yang sudah punya transaksi yang sama: tidak dobel
  assert.equal(back.txs.reduce(addTx, [tx]).length, 1);
});
