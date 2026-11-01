// Skenario E2E Setor di emulator: notif sungguhan dikirim ke Android, lalu dicek tercatat di aplikasi.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const APP = "com.harrakyy.setorpantau";
const adb = (cmd) => execSync(`adb ${cmd}`, { encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, msg, detail = "") => {
  results.push({ ok, msg });
  console.log(`::${ok ? "notice" : "error"} title=E2E ${ok ? "lulus" : "gagal"}::${msg}${ok ? "" : " " + detail}`);
};
// Notif dikirim oleh com.android.shell; whitelist aplikasi diubah lewat UI agar paket itu dianggap sumber DANA
const postNotif = (tag, title, text) =>
  adb(`shell "cmd notification post -t '${title}' ${tag} '${text}'"`);

let ws, id = 0;
async function connect() {
  let socket = "";
  for (let i = 0; i < 30 && !socket; i++) {
    socket = adb("shell cat /proc/net/unix").split("\n").map((l) => l.trim().split(" ").pop())
      .find((n) => n?.startsWith("@webview_devtools_remote_"))?.slice(1) ?? "";
    if (!socket) await sleep(1000);
  }
  if (!socket) throw new Error("Socket DevTools WebView tidak ditemukan");
  adb("forward --remove-all");
  adb(`forward tcp:9222 localabstract:${socket}`);
  const page = (await (await fetch("http://127.0.0.1:9222/json")).json()).find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
}
const evaluate = (expression) => new Promise((resolve) => {
  const msgId = ++id;
  const onMsg = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== msgId) return;
    ws.removeEventListener("message", onMsg);
    resolve(msg.result?.result?.value ?? msg.result?.exceptionDetails?.exception?.description);
  };
  ws.addEventListener("message", onMsg);
  ws.send(JSON.stringify({ id: msgId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
});
const state = () => evaluate(`(() => ({
  rows: [...document.querySelectorAll("#recentList .tx .amt")].map((e) => e.textContent),
  today: document.getElementById("todaySum").getAttribute("aria-label") ?? document.getElementById("todaySum").textContent,
  count: document.getElementById("todayCount").textContent,
  perm: document.getElementById("permStatus").textContent,
}))()`);
const relaunch = async () => {
  adb(`shell am start -W -n ${APP}/.MainActivity`);
  await sleep(6000);
  ws?.close();
  await connect();
  await sleep(1500);
};

try {
  await connect();

  // 1. Izin aktif + atur sumber notifikasi lewat layar Pengaturan
  const setup = await evaluate(`(async () => {
    const $ = (id) => document.getElementById(id), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 20 && !$("packages"); i++) await wait(500);
    document.querySelector('[data-tab="settings"]').click();
    $("packages").value = "id.dana, com.android.shell";
    $("savePackages").click();
    await wait(800);
    document.querySelector('[data-tab="home"]').click();
    return { pkgs: $("packages").value, perm: $("permStatus").textContent, native: window.Capacitor?.isNativePlatform?.() };
  })()`);
  check(setup?.native === true, "Berjalan sebagai aplikasi native", JSON.stringify(setup));
  check(/Aktif/.test(setup?.perm ?? ""), "Akses Notifikasi terdeteksi aktif", setup?.perm);
  check(setup?.pkgs === "id.dana, com.android.shell", "Sumber notifikasi tersimpan lewat Pengaturan", setup?.pkgs);

  // 2. Aplikasi terbuka: notif persis seperti screenshot DANA
  postNotif("bayar1", "Pembayaran Masuk", "Rp1.000 diterima DANA Bisnis.");
  await sleep(4000);
  let s = await state();
  check(s.rows.includes("Rp 1.000") && s.today === "Rp 1.000", "Aplikasi terbuka: notif Rp1.000 tercatat & total hari ini Rp 1.000", JSON.stringify(s));

  // 3. Notif promo/lainnya harus diabaikan
  postNotif("promo1", "Promo 11.11!", "Cashback Rp10.000 untukmu");
  await sleep(3000);
  s = await state();
  check(s.rows.length === 1, "Notif promo diabaikan (tidak tercatat)", JSON.stringify(s));

  // 4. Aplikasi di latar belakang
  adb("shell input keyevent KEYCODE_HOME");
  await sleep(2000);
  postNotif("bayar2", "Pembayaran Masuk", "Rp2.500 diterima DANA Bisnis.");
  await sleep(4000);
  await relaunch();
  s = await state();
  check(s.rows.includes("Rp 2.500") && s.today === "Rp 3.500", "Latar belakang: notif Rp2.500 tetap tercatat (total Rp 3.500)", JSON.stringify(s));

  // 5. Proses aplikasi dimatikan sistem: notif harus ditangkap service/cache lalu muncul saat dibuka lagi
  adb("shell input keyevent KEYCODE_HOME");
  await sleep(1500);
  adb(`shell am kill ${APP}`);
  await sleep(3000);
  postNotif("bayar3", "Pembayaran Masuk", "Rp30.999 diterima DANA Bisnis.");
  await sleep(6000);
  await relaunch();
  s = await state();
  check(s.rows.includes("Rp 30.999") && s.today === "Rp 34.499", "Proses dimatikan: notif Rp30.999 tertangkap & muncul saat dibuka lagi (total Rp 34.499)", JSON.stringify(s));

  // 6. Label/catatan tersimpan, lalu ekspor CSV lewat lembar Bagikan
  const edit = await evaluate(`(async () => {
    const $ = (id) => document.getElementById(id), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("#recentList .tx").click(); await wait(400);
    $("detailLabel").value = "Booking R5Y2"; $("detailNote").value = "Budi 8 orang";
    $("detailSave").click(); await wait(600);
    const chip = document.querySelector("#recentList .tx:first-child .label")?.textContent;
    document.querySelector('[data-tab="tx"]').click(); await wait(300);
    $("exportCsv").click(); await wait(2500);
    return { chip };
  })()`);
  check(edit?.chip === "Booking R5Y2", "Label transaksi tersimpan", JSON.stringify(edit));
  const cache = adb(`shell run-as ${APP} ls cache`);
  check(/Setor-.*\.csv/.test(cache), "File CSV ekspor dibuat", cache);
  const focus = adb("shell dumpsys window").split("\n").filter((l) => /mCurrentFocus|mFocusedApp/.test(l)).join(" | ");
  check(/chooser|intentresolver|ResolverActivity|ChooserActivity/i.test(focus), "Lembar Bagikan Android terbuka untuk CSV", focus);
} catch (err) {
  check(false, "Skenario berhenti karena error", String(err?.stack || err));
}

writeFileSync("e2e-screen.png", execSync("adb exec-out screencap -p"));
ws?.close();
const failed = results.filter((r) => !r.ok);
console.log(`E2E: ${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
