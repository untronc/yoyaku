// 見た目の確かめ（手元）：3つの色（朱・緑・青）それぞれで、予約画面の4段と管理画面の8画面（7画面＋設定）を、幅 375px と 1280px で開き、
//   ① 横にはみ出さない（ページの横幅が画面の幅を超えない・はみ出した部品が無い。横に送る表の中は除く）
//   ② 文字と地の差が WCAG AA の 4.5:1 以上（押せない日・押せないボタンは除く。WCAG でも対象外）
// を確かめる（基本設計書 追補 2026-10-13 S-01〜03）。予約画面は STUDIO の枠の形（/framed）でも 375px で1回見る
//   npm run looks      （または node e2e/looks.mjs）。写真は .wrangler/looks/ に置く（Git に入れない）
// 手元だけで動く（e2e/local.mjs）。accept・fields と同じポートを使うので、同時には流さない
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { API, EMBED, ROOT, sessionCookie, setCount, startLocal, stopAll } from "./local.mjs";

const STATE = ".wrangler/e2e-looks-state";
const SHOTS = `${ROOT}/.wrangler/looks`;
const ADMIN = { id: "見た目の確かめ", email: "operator@example.com", sub: "sub-looks", active: 1 };
const THEMES = ["shu", "green", "blue"];
const WIDTHS = [375, 1280];
const results = [];
const log = (...a) => console.log(...a);

/** 画面の中で、はみ出しと文字の差を調べる（ブラウザの中で動く） */
function inspect() {
  const parse = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t));
  const lum = (c) => { const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // 地の色：自分から上へ、塗りのある所を重ねていく（いちばん下は白）
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
    let bg = [255, 255, 255];
    for (const c of layers.reverse()) bg = mix(c, bg, c[3]);
    return bg;
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const W = document.documentElement.clientWidth;
  const out = { overflow: [], contrast: [], width: document.documentElement.scrollWidth, view: W };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
    if (el.closest(".table-responsive, .modal:not(.show), [hidden]")) continue;
    if (r.right > W + 1 || r.left < -1) out.overflow.push(`${name(el)}（左 ${Math.round(r.left)}・右 ${Math.round(r.right)}）`);
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!text) continue;
    if (el.closest(":disabled, [disabled], [aria-disabled='true']")) continue; // 押せない部品は WCAG でも対象外
    const cs = getComputedStyle(el), fg = parse(cs.color), bg = bgOf(el);
    if (!fg) continue;
    const o = opacityOf(el) * fg[3];
    const k = ratio(mix(fg, bg, o), bg);
    if (k < 4.5) out.contrast.push(`${name(el)}「${text.slice(0, 16)}」${k.toFixed(2)}（文字 ${cs.color}・地 rgb(${bg.map(Math.round).join(", ")})）`);
  }
  return out;
}

async function look(page, label, file) {
  await page.waitForTimeout(250);
  const r = await page.evaluate(inspect);
  await page.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: true });
  const over = r.width > r.view + 1 ? [`ページの横幅 ${r.width}px（画面 ${r.view}px）`, ...r.overflow] : r.overflow;
  results.push({ label, kind: "はみ出し", ok: !over.length, why: over.slice(0, 4).join("／") });
  results.push({ label, kind: "文字と地の差", ok: !r.contrast.length, why: r.contrast.slice(0, 4).join("／") });
}
async function lookFrame(page, frame, label, file) {
  await page.waitForTimeout(400);
  const r = await frame.evaluate(inspect);
  const p = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  await page.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: true });
  const over = [...(p.width > p.view + 1 ? [`親ページの横幅 ${p.width}px`] : []), ...(r.width > r.view + 1 ? [`枠の中の横幅 ${r.width}px（枠 ${r.view}px）`] : []), ...r.overflow];
  results.push({ label, kind: "はみ出し", ok: !over.length, why: over.slice(0, 4).join("／") });
  results.push({ label, kind: "文字と地の差", ok: !r.contrast.length, why: r.contrast.slice(0, 4).join("／") });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  await startLocal({ state: STATE, users: [ADMIN] });
  const cookie = await sessionCookie(ADMIN.sub);
  const H = { Cookie: `ybk_s=${cookie}`, "X-Ybk": "1", "Content-Type": "application/json", Origin: API };
  const adminApi = async (path, body) => (await fetch(`${API}/admin/api${path}`, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
  // 見本の予約：予約画面から1件（メモつき）・電話で1件・キャンセル1件（来月 10 日）
  const jst = new Date(Date.now() + 9 * 3600000);
  const day = (n) => new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, n)).toISOString().slice(0, 10);
  const d = day(10);
  const web = await (await fetch(`${API}/api`, { method: "POST", headers: { Origin: EMBED.replace(/\/$/, ""), "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "book", checkin: d, nights: 3, guests: 4, name: "山田 花子", tel: "090-1234-5678", email: "hanako@example.com", address: "東京都千代田区千代田1-1-1 ○○マンション 1203号室", arrival: "18:00〜19:00", note: "子どもが1名います。釣りの道具があるので、玄関近くに置かせてください。", agree: true, privacyAgree: true }) })).json();
  const manual = await adminApi("/manual", { checkin: d, nights: 1, guests: 2, name: "佐藤 一郎", tel: "090-0000-0009", memo: "電話で予約。到着は夕方ごろ。" });
  const gone = await adminApi("/manual", { checkin: d, nights: 2, guests: 3, name: "田中 美咲", tel: "", memo: "" });
  if (!web.ok || !manual.ok || !gone.ok) throw new Error("見本の予約が入らない");
  await adminApi("/memo", { id: web.no, memo: "到着は19時ごろになる見込み。" });
  await adminApi("/change", { id: web.no, checkin: d, nights: 2, guests: 4 });
  await adminApi("/cancel", { id: gone.id });
  await adminApi("/rules/day", { from: day(12), to: day(12), action: "stop", limit: "" });
  await adminApi("/rules/weekly", { weekday: 3, stop: true });

  // 予約画面で予約する日：来月 13 日以降で、3泊のどの夜も定休日（水）に当たらない日
  const stays = [];
  for (let k = 13; k <= 28 && stays.length < 6; k++) if ([0, 1, 2].every((i) => new Date(day(k + i) + "T00:00:00Z").getUTCDay() !== 3)) stays.push(day(k));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let n = 0;
  try {
    for (const theme of THEMES) {
      const cur = await (await fetch(`${API}/admin/api/settings`, { headers: H })).json();
      if (cur.theme !== theme) { const j = await adminApi("/settings", { theme }); if (!j.ok) throw new Error("色を変えられない：" + j.error); }
      for (const w of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
        await ctx.addCookies([{ name: "ybk_s", value: cookie, url: `${API}/admin` }]);
        const page = await ctx.newPage();
        const tag = (s) => `${theme}・${w}px・${s}`, file = (s) => `${theme}_${w}_${s}`;
        // ---- 予約画面 4段 ----
        await page.goto(EMBED);
        await page.waitForSelector("#ybk .app-day[data-day]");
        await page.click('#ybk [data-nav="1"]');
        await page.waitForSelector(`#ybk .app-day[data-day="${d}"]`);
        await page.click(`#ybk .app-day[data-day="${stays[n]}"]`);
        await setCount(page, "nights", 3); await setCount(page, "guests", 2);
        await look(page, tag("予約画面 1 日にちを選ぶ"), file("p1"));
        await page.click('#ybk [data-go="quote"]');
        await page.waitForSelector('#ybk [data-step="2"]:not([hidden])');
        await page.click('#ybk [data-go="confirm"]'); // 空のまま押して、欄の下のまちがいも見る
        await look(page, tag("予約画面 2 お客さまの情報（まちがいの文つき）"), file("p2"));
        await page.fill('[data-f="name"]', "山田 太郎"); await page.fill('[data-f="tel"]', `090-1111-${String(2000 + n)}`);
        await page.fill('[data-f="email"]', `looks${n}@example.com`); await page.fill('[data-f="address"]', "東京都千代田区1-2-3");
        await page.click('#ybk [data-go="confirm"]');
        await page.waitForSelector('#ybk [data-step="3"]:not([hidden])');
        await page.click('#ybk [data-go="book"]'); // 同意の印なしで押して、まちがいの文も見る
        await look(page, tag("予約画面 3 内容の確認（まちがいの文つき）"), file("p3"));
        await page.check('[data-f="agree"]'); await page.check('[data-f="privacy"]');
        await page.click('#ybk [data-go="book"]');
        await page.waitForSelector('#ybk [data-step="4"]:not([hidden])', { timeout: 15000 });
        await look(page, tag("予約画面 4 完了"), file("p4"));
        n++;
        // ---- 管理画面 8画面 ----
        const admin = async (path, ready, s, f) => { await page.goto(API + path); await page.waitForSelector(ready, { timeout: 15000 }); await look(page, tag(s), file(f)); };
        await admin("/admin?m=" + d.slice(0, 7), ".heat-grid a[data-go]", "管理画面 月の表", "a1");
        await admin("/admin/d/" + d, ".list-group a", "管理画面 日の予約", "a2");
        await admin("/admin/b/" + web.no, "#history", "管理画面 予約の詳細", "a3");
        await page.click("#doCancel"); await page.waitForSelector("#cancelModal.show");
        await look(page, tag("管理画面 キャンセルの確かめの窓"), file("a3m"));
        await admin("/admin/new?d=" + d, "#addCard", "管理画面 電話・LINE の予約を足す", "a4");
        await admin("/admin/rules", "#rlCard", "管理画面 受付の設定", "a5");
        await admin("/admin/stats", "[data-month]", "管理画面 月ごとの数字", "a6");
        await admin("/admin/settings", "#thCard", "管理画面 設定", "a7");
        await admin("/admin/me", "#meCard", "管理画面 名前", "a8");
        if (w === 375) {
          await page.click(".navbar-toggler"); await page.waitForSelector("#admNav.show");
          await look(page, tag("管理画面 メニューを開いたところ"), file("a9"));
          // ---- STUDIO の枠の形 ----
          await page.goto(EMBED + "framed");
          const frame = await (await page.waitForSelector("sandbox-iframe iframe")).contentFrame();
          await frame.waitForSelector(".app-day[data-day]");
          await lookFrame(page, frame, tag("予約画面 1 STUDIO の枠の形"), file("f1"));
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

process.on("SIGINT", () => { stopAll(); process.exit(130); });
process.on("exit", stopAll);
let fatal = null;
try { await main(); } catch (err) { fatal = String(err?.stack ?? err?.message ?? err); } finally { stopAll(); }

log("\n見た目の確かめ（手元）");
for (const r of results) log(`${r.ok ? "通過  " : "不合格"}  ${r.label}：${r.kind}${r.ok ? "" : "\n          → " + r.why}`);
if (fatal) log(`\n準備か後片付けで止まった：${fatal}`);
const failed = results.filter((r) => !r.ok).length;
log(`\n通過 ${results.length - failed} ／ 不合格 ${failed}${fatal ? "（途中で止まった）" : ""}　写真：${SHOTS}`);
process.exit(failed || fatal ? 1 : 0);
