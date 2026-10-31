import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingTx, syncAll, normalizeServerUrl } from "./sync.js";

const HOUR = 3_600_000;
const PAIRED = Date.parse("2026-11-01T10:00:00+07:00");
const conn = { url: "https://atmosphere-jb5u.vercel.app", token: "t", pairedAt: PAIRED };
const tx = (id, minutesAfterPairing, extra = {}) => ({
  id, amount: 30999, time: PAIRED + minutesAfterPairing * 60_000, text: "Rp30.999 diterima DANA Bisnis.", note: "", label: "", ...extra,
});

test("pendingTx: hanya yang belum terkirim dan tidak lebih dari 1 jam sebelum pairing, urut terlama dulu", () => {
  const list = [tx("baru", 30), tx("lama", -2 * 60), tx("sudah", 10, { sync: { state: "sent" } }), tx("pas", -30)];
  assert.deepEqual(pendingTx(list, conn).map((t) => t.id), ["pas", "baru"]);
  assert.deepEqual(pendingTx(list, null), []);
});

test("syncAll: hasil MATCHED → status terkirim + label booking terisi otomatis, list asli tidak berubah", async () => {
  const list = [tx("a", 5)];
  const sent = [];
  const out = await syncAll(list, conn, async (payload) => {
    sent.push(payload);
    return { status: 200, data: { success: true, data: { result: "MATCHED", reservationCode: "R5Y2" } } };
  }, PAIRED + HOUR);
  assert.deepEqual(sent, [{ notifId: "a", amount: 30999, time: list[0].time, text: list[0].text }]);
  assert.equal(out.list[0].sync.state, "sent");
  assert.equal(out.list[0].sync.result, "MATCHED");
  assert.equal(out.list[0].label, "Booking R5Y2");
  assert.equal(list[0].sync, undefined);
  assert.equal(out.revoked, false);
});

test("syncAll: label yang sudah diisi pengguna tidak ditimpa", async () => {
  const out = await syncAll([tx("a", 5, { label: "Pak Budi" })], conn, async () => ({
    status: 200, data: { success: true, data: { result: "MATCHED", reservationCode: "R5Y2" } },
  }));
  assert.equal(out.list[0].label, "Pak Budi");
});

test("syncAll: label dari server (Kosinyuk) dipakai apa adanya", async () => {
  const out = await syncAll([tx("a", 5)], conn, async () => ({
    status: 200, data: { success: true, data: { result: "matched", label: "K3 · Budi" } },
  }));
  assert.equal(out.list[0].label, "K3 · Budi");
  assert.equal(out.list[0].sync.label, "K3 · Budi");
});

test("pendingTx: dengan jalur dari pairing, nominal di luar jalur tidak dikirim", () => {
  const kos = { ...conn, band: { min: 500, max: 999 } };
  const list = [tx("kos", 5, { amount: 799873 }), tx("cafe", 6, { amount: 120350 }), tx("pribadi", 7, { amount: 50000 })];
  assert.deepEqual(pendingTx(list, kos).map((t) => t.id), ["kos"]);
  assert.equal(pendingTx(list, conn).length, 3); // web tanpa jalur (Atmosphere lama): semua dikirim
});

test("syncAll: offline → berhenti, sisanya tetap antri untuk dicoba lagi", async () => {
  let calls = 0;
  const out = await syncAll([tx("a", 1), tx("b", 2)], conn, async () => {
    calls += 1;
    throw new Error("Network error");
  });
  assert.equal(calls, 1);
  assert.deepEqual(out.list.map((t) => t.sync?.state), ["queued", undefined]);
  assert.match(out.list[0].sync.error, /Network/);
});

test("syncAll: 401 → koneksi dicabut, tidak ada yang ditandai terkirim", async () => {
  const out = await syncAll([tx("a", 1)], conn, async () => ({ status: 401, data: { success: false, error: { message: "dicabut" } } }));
  assert.equal(out.revoked, true);
  assert.notEqual(out.list[0].sync?.state, "sent");
});

test("syncAll: ditolak server (400) → ditandai gagal supaya tidak dikirim berulang", async () => {
  const out = await syncAll([tx("a", 1)], conn, async () => ({ status: 400, data: { success: false, error: { message: "Waktu notifikasi tidak masuk akal" } } }));
  assert.equal(out.list[0].sync.state, "failed");
  assert.equal(pendingTx(out.list, conn).length, 0);
});

test("normalizeServerUrl: wajib https, buang garis miring & path", () => {
  assert.equal(normalizeServerUrl(" https://atmosphere-jb5u.vercel.app/ "), "https://atmosphere-jb5u.vercel.app");
  assert.equal(normalizeServerUrl("atmosphere-jb5u.vercel.app"), "https://atmosphere-jb5u.vercel.app");
  assert.equal(normalizeServerUrl("https://contoh.id/admin/pengaturan"), "https://contoh.id");
  assert.throws(() => normalizeServerUrl("http://contoh.id"));
  assert.throws(() => normalizeServerUrl("bukan url"));
});

test("mergeSynced: notif baru, edit label, dan hapus selama sinkron tetap terjaga", async () => {
  const { mergeSynced } = await import("./sync.js");
  const a = tx("a", 1), b = tx("b", 2);
  const synced = [{ ...a, sync: { state: "sent", result: "MATCHED", label: "Booking R5Y2" }, label: "Booking R5Y2" }, b];
  const current = [{ ...a, label: "Pak Budi" }, tx("baru", 3)]; // b dihapus, a diberi label, ada notif baru
  const out = mergeSynced(current, synced);
  assert.deepEqual(out.map((t) => t.id), ["a", "baru"]);
  assert.equal(out[0].sync.state, "sent");
  assert.equal(out[0].label, "Pak Budi");
  assert.equal(out[1].sync, undefined);
});
