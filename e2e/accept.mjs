// 受け入れ試験（手元）：予約する・取り消す・ログイン を、画面を動かして確かめる
//   npm run accept      （または node e2e/accept.mjs）
// 手元だけで動く：手元の D1（.wrangler/e2e-state・毎回消してマイグレーションから作り直す）・手元の wrangler dev・手元の確認ページ（dev/serve-embed.mjs）。
// テスト環境（リモート）・本番にはつながない。メールは送らない（MAIL_MODE=log）。ブラウザは PC の Edge（ダウンロードしない）。
// 試験の中身は ClaudeCode_受け入れ試験シナリオ_リリース2 の K2（ログイン）・K5（キャンセル）・K11（同意の記録）・B1（予約が管理画面に出る）の手元版。業務の流れだけを見る。
// 2026-10-13 基本設計書 追補（Bootstrap と見た目の設定）：設定（S-03 色を変える → 管理画面と予約画面の色・変更履歴・知らない値を断る）と、
// 配り方（S-04 単独で開いた形・STUDIO の枠の形〈親ページに parent-height.html〉・前の埋め込みのままでも動く）を足した。
// 入力の形（必須・長さ・形・禁止・同意の印なし など）は、入力チェックの試験（npm run fields ＝ e2e/fields.mjs）で見るので、ここからは外した（2026-10-13）。
// 手元の道具（D1・wrangler dev・確認ページ）は e2e/local.mjs。
// 結果は K番号・要件番号ごとに 通過／不合格 を1行ずつ出し、1つでも落ちたら終了コード 1
import { chromium, request as pwRequest } from "playwright-core";
import { API, EMBED, SECRET, sessionCookie, setCount, startLocal, stopAll } from "./local.mjs";

const STATE = ".wrangler/e2e-state"; // ROOT からの相対
const ADMIN_EMAIL = "operator@example.com"; // 施設の設定（site.admins）に入っている宛先

const results = [];
const log = (...a) => console.log(...a);

// ----- 結果の記録 -----
async function check(id, req, title, fn) {
  try {
    await fn();
    results.push({ ok: true, id, req, title });
  } catch (err) {
    results.push({ ok: false, id, req, title, why: String(err?.message ?? err).split("\n")[0] });
  }
}
function must(cond, why) { if (!cond) throw new Error(why); }
const has = (text, part, label) => must(String(text).includes(part), `${label}に「${part}」が出ていない（実際：${String(text).replace(/\s+/g, " ").slice(0, 120)}）`);

// ----- 日付（日本時間の来月 15 日から 3 泊） -----
function targetDates() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const first = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1));
  const f = (d) => d.toISOString().slice(0, 10);
  const day = (n) => f(new Date(first.getTime() + (n - 1) * 86400000));
  return { checkin: day(15), mid: day(16), last: day(17), month: f(first).slice(0, 7), monthsAhead: 1, nights: 3, guests: 2 };
}
const T = targetDates();
// 名前に「テスト」「試験」を入れない（月ごとの数字に数えられる予約として流すため）
const GUEST = { name: "山田 太郎", tel: "090-1234-5678", email: "e2e-guest@example.com", address: "東京都千代田区1-2-3" };


// 月ごとの数字：月ごとの札（data-month）の行（data-row：web・manual・total・cancelled）を読む
const statsOf = async (page) => {
  await page.goto(`${API}/admin/stats`);
  await page.waitForSelector("[data-month] [data-row]", { timeout: 10000 });
  const months = await page.locator("[data-month]").evaluateAll((cards) =>
    cards.map((c) => ({ month: c.getAttribute("data-month"), rows: Object.fromEntries([...c.querySelectorAll("[data-row]")].map((r) => [r.getAttribute("data-row"), r.innerText.replace(/\s+/g, " ").trim()])) })));
  return { mine: months.find((x) => x.month === T.month)?.rows, all: months };
};

// ----- 予約画面の操作 -----
async function openEmbed(page) {
  await page.goto(EMBED);
  await page.waitForSelector(".ybk-cal button[data-day]");
  for (let i = 0; i < 4 && !(await page.locator(".ybk-month").innerText()).startsWith(`${T.month.slice(0, 4)}年${Number(T.month.slice(5))}月`); i++) {
    await page.click('[data-nav="1"]');
    await page.waitForSelector(".ybk-cal button[data-day]");
  }
  await page.waitForSelector(`.ybk-cal button[data-day="${T.checkin}"]`);
}
// 日の印（○ 空きあり・△ 残りわずか・× 満室・− 受付期間外）。アプリ風の画面では点や「残り N」で出すので、印は data-mark で読む
const mark = (page, day) => page.locator(`.ybk-cal button[data-day="${day}"]`).getAttribute("data-mark");
const calRooms = async (day) => (await (await fetch(`${API}/api?action=calendar&month=${T.month}`)).json()).days[day].rooms;

async function fillGuest(page) {
  await setCount(page, "nights", T.nights);
  await setCount(page, "guests", T.guests);
}

// =====================================================================
async function main() {
  const { wr } = await startLocal({
    state: STATE,
    users: [
      { id: "e2e-ok", email: ADMIN_EMAIL, sub: "sub-ok", active: 1 }, // 許可した人
      { id: "e2e-off", email: "owner@example.com", sub: "sub-off", active: 0 }, // 許可の設定にあるが、使えない状態の人
      { id: "e2e-out", email: "outsider@example.com", sub: "sub-out", active: 1 }, // 使える状態だが、メールアドレスが許可の設定にない人
    ],
  });

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const bookPosts = [];
  let bookingNo = null;

  try {
    // ---------- a. 予約する ----------
    const guest = await ctx.newPage();
    await openEmbed(guest);
    await guest.on("request", (r) => { if (r.method() === "POST" && /"action":"book"/.test(r.postData() || "")) bookPosts.push(r.postData()); });
    const before = {};
    await check("B1", "R5-1", "予約画面の月の表で、選んだ日が「○ 空きあり」", async () => {
      before.mark = await mark(guest, T.checkin);
      must(before.mark === "○", `印が ${before.mark}`);
      must((await calRooms(T.checkin)) === 3, "空きが 3 でない");
    });

    await guest.click(`.ybk-cal button[data-day="${T.checkin}"]`);
    await fillGuest(guest);
    await guest.click('[data-go="quote"]');
    await guest.waitForSelector('.ybk-step[data-step="2"]:not([hidden])');
    await check("B1", "R5-1", "日付・泊数・人数を選ぶと、下のボタンの上に合計が出る（2名×3泊・連泊割引つき 27,000円）", async () => {
      has(await guest.locator('.ybk-step[data-step="2"] [data-sum]').innerText(), "3泊・2名", "日程");
      has(await guest.locator('.ybk-step[data-step="2"] [data-total]').innerText(), "27,000円", "合計");
    });
    await guest.fill('[data-f="name"]', GUEST.name);
    await guest.fill('[data-f="tel"]', GUEST.tel);
    await guest.fill('[data-f="email"]', GUEST.email);
    await guest.fill('[data-f="address"]', GUEST.address);
    await guest.click('[data-go="confirm"]');
    await guest.waitForSelector('.ybk-step[data-step="3"]:not([hidden])');
    await check("B1", "R5-1", "確認の画面に料金の内訳が出る（30,000円・連泊割引 −3,000円・お支払い 27,000円）", async () => {
      const p = await guest.locator('.ybk-step[data-step="3"] [data-price]').innerText();
      has(p, "30,000円", "料金"); has(p, "−3,000円", "連泊割引"); has(p, "27,000円", "お支払い");
    });

    // 同意の印を2つ付けて確定（印なしで断るのは e2e/fields.mjs）
    await guest.check('[data-f="agree"]');
    await guest.check('[data-f="privacy"]');
    await guest.click('[data-go="book"]');
    await guest.waitForSelector('.ybk-step[data-step="4"]:not([hidden])', { timeout: 20000 }).catch(() => {});
    await check("K11", "R5-18・R6-11", "同意の印を付けて確定すると、完了画面に予約番号が出る", async () => {
      const done = await guest.locator("[data-done]").innerText();
      const m = /予約番号\s*(\d{6}-\d{4})/.exec(done);
      must(m, `予約番号が出ていない（画面：${(await guest.locator('[data-msg="3"]').innerText()) || done}）`);
      bookingNo = m[1];
      must(bookPosts.length === 1, `予約の送信が ${bookPosts.length} 回`);
    });
    await check("B1", "R5-1", "メールは送られない（予約の控えに「送っていない」と記録）", async () => {
      must(bookingNo, "予約番号が無い");
      const j = await (await ctx.request.get(`${API}/admin/api/booking?id=${bookingNo}`, { headers: { Cookie: `ybk_s=${await sessionCookie("sub-ok")}` } })).json();
      must(j.ok, "管理画面の API が答えない");
      must(/^skipped/.test(j.booking.mail_guest) && /^skipped/.test(j.booking.mail_inn), `mail_guest=${j.booking.mail_guest}・mail_inn=${j.booking.mail_inn}`);
      // wrangler の出力は少し遅れて届くので、最大 8 秒待つ
      for (let i = 0; i < 40 && !wr.out.some((l) => l.includes("mail skipped")); i++) await new Promise((r) => setTimeout(r, 200));
      must(wr.out.some((l) => l.includes("mail skipped")), "wrangler の記録に「mail skipped」が無い：" + wr.out.slice(-8).join(" / "));
    });
    await check("B1", "R5-1", "予約画面の月の表で、泊まる3日が「△」に変わる", async () => {
      await openEmbed(guest);
      for (const d of [T.checkin, T.mid, T.last]) must((await mark(guest, d)) === "△", `${d} の印が ${await mark(guest, d)}`);
      must((await calRooms(T.checkin)) === 2, "空きが 2 でない");
    });

    // ---------- 管理画面に出る ----------
    const admin = await ctx.newPage();
    await ctx.addCookies([{ name: "ybk_s", value: await sessionCookie("sub-ok"), url: `${API}/admin`, httpOnly: true }]);
    await admin.goto(`${API}/admin?m=${T.month}`);
    await check("K2", "R6-2", "許可した人の Cookie で管理画面が開く（月の表が出る）", async () => {
      await admin.waitForSelector(".heat-grid a[data-go]", { timeout: 15000 });
      has(await admin.locator("nav.adm-nav").innerText(), "予約管理", "見出し");
      has(await admin.locator("#me").innerText(), "e2e-ok", "右上の名前");
    });
    await check("B1", "R5-1・R6-4", "管理画面の月の表の、その日に「1/3件・2名」と出る", async () => {
      has(await admin.locator(`.heat-grid a[href="/admin/d/${T.checkin}"]`).innerText(), "1/3件", "月の表");
      has(await admin.locator(`.heat-grid a[href="/admin/d/${T.checkin}"]`).innerText(), "2名", "月の表");
      has(await admin.locator(`.heat-grid a[href="/admin/d/${T.last}"]`).innerText(), "1/3件", "月の表（最後の泊）");
    });
    await admin.click(`.heat-grid a[href="/admin/d/${T.checkin}"]`);
    await check("B1", "R5-1", "日の予約に、その予約が出る", async () => {
      must(bookingNo, "予約番号が無い");
      await admin.waitForSelector(`a[href="/admin/b/${bookingNo}"]`, { timeout: 10000 });
      has(await admin.locator("main").innerText(), GUEST.name, "日の予約");
    });
    await admin.click(`a[href="/admin/b/${bookingNo}"]`).catch(() => {});
    await admin.waitForSelector("#history", { timeout: 10000 }).catch(() => {});
    await check("K11", "R5-18・R6-11", "予約の詳細に、同意した日時とポリシーの版「第1版」が残っている", async () => {
      const text = await admin.locator("main").innerText();
      has(text, bookingNo, "詳細");
      has(text, "プライバシーポリシーに同意（", "詳細");
      must(/同意（\d{4}-\d{2}-\d{2} \d{2}:\d{2}・版 第1版）/.test(text), `同意の日時と版の形が違う（${text.replace(/\s+/g, " ").match(/プライバシーポリシーに同意[^）]*）?/)?.[0]}）`);
      has(text, GUEST.name, "詳細"); has(text, "27,000円", "詳細");
      has(text, "テスト環境のため送っていない", "メール欄");
    });

    await check("月ごとの数字", "10/13 宿の依頼", "チェックインの月の「ネット予約」に 1件・2名・3泊・27,000円、キャンセル 0件。0件の月は 0件と出る", async () => {
      const { mine, all } = await statsOf(admin);
      must(mine, `${T.month} の札が無い`);
      for (const v of ["1件", "2名", "3泊", "27,000円"]) has(mine.web, v, "ネット予約の行");
      has(mine.total, "1件", "合計の行"); has(mine.cancelled, "キャンセル 0件", "キャンセルの札");
      must(all.some((x) => x.month !== T.month && x.rows.total === "合計 0件 0名 0泊 0円"), "0件の月が 0 と出ていない");
    });
    await admin.goto(`${API}/admin/b/${bookingNo}`);
    await admin.waitForSelector("#doCancel", { timeout: 10000 }).catch(() => {});

    // ---------- b. 取り消す ----------
    // キャンセルのボタン → 確かめの窓（Bootstrap の modal）の「キャンセルにする」
    await admin.click("#doCancel").catch(() => {});
    await admin.waitForSelector("#cancelModal.show #doCancelOk", { timeout: 5000 }).catch(() => {});
    await admin.click("#doCancelOk").catch(() => {});
    await admin.waitForSelector("h1 .badge.text-bg-secondary", { timeout: 10000 }).catch(() => {});
    await check("K5", "R5-7・R6-5", "管理画面でキャンセルすると（確かめの窓で「キャンセルにする」）、予約が「キャンセル」と表示される", async () => {
      has(await admin.locator("h1").innerText(), "キャンセル", "詳細の見出し");
      must((await admin.locator("#doCancel").count()) === 0, "キャンセルのボタンが残っている");
    });
    await check("K5", "R5-7・R6-5", "予約画面の月の表で、その日の空きが戻る（△ → ○・空き 3）", async () => {
      must((await calRooms(T.checkin)) === 3, "API の空きが 3 に戻っていない");
      await openEmbed(guest);
      for (const d of [T.checkin, T.mid, T.last]) must((await mark(guest, d)) === "○", `${d} の印が ${await mark(guest, d)}`);
    });
    await check("K5", "R5-7・R6-5", "キャンセルした予約の詳細が見られる（内容と取り消した日時が残る）", async () => {
      await admin.goto(`${API}/admin/b/${bookingNo}`);
      await admin.waitForSelector("#history", { timeout: 10000 });
      const text = await admin.locator("main").innerText();
      has(text, bookingNo, "詳細"); has(text, GUEST.name, "詳細"); has(text, "27,000円", "詳細");
      must(/キャンセル\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text), "キャンセルの日時が無い");
    });
    await check("K10", "R6-10・R7-3", "変更履歴に「作成」と「キャンセル」が残っている", async () => {
      const text = await admin.locator("main").innerText();
      const hist = text.slice(text.indexOf("変更履歴"));
      has(hist, "作成", "変更履歴"); has(hist, "キャンセル", "変更履歴"); has(hist, "e2e-ok", "変更履歴の「だれが」");
    });
    await check("K5", "R5-7・R6-5", "日の予約の「キャンセルした予約」に出て、月の表の件数は 0 に戻る", async () => {
      await admin.goto(`${API}/admin/d/${T.checkin}`);
      await admin.waitForSelector("h2", { timeout: 10000 });
      has(await admin.locator("main").innerText(), "キャンセルした予約", "日の予約");
      await admin.goto(`${API}/admin?m=${T.month}`);
      await admin.waitForSelector(".heat-grid a[data-go]");
      has(await admin.locator(`.heat-grid a[href="/admin/d/${T.checkin}"]`).innerText(), "0/3件", "月の表");
    });
    await check("月ごとの数字", "10/13 宿の依頼", "キャンセルすると、件数・金額から外れ、キャンセルに 1件と出る", async () => {
      const { mine } = await statsOf(admin);
      has(mine.web, "0件", "ネット予約の行"); has(mine.total, "0円", "合計の行"); has(mine.cancelled, "キャンセル 1件", "キャンセルの札");
    });

    // ---------- 見た目の設定（基本設計書 追補 2026-10-13 S-03） ----------
    const SHU = "rgb(186, 74, 37)", GREEN = "rgb(24, 61, 67)";
    const btnColor = (page, sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    await check("設定", "S-03", "色を変える前は、管理画面も予約画面も朱", async () => {
      await admin.goto(`${API}/admin/settings`);
      await admin.waitForSelector("#saveTheme", { timeout: 10000 });
      must((await admin.locator("html").getAttribute("data-theme")) === "shu", "管理画面が朱でない");
      must((await btnColor(admin, "#saveTheme")) === SHU, `管理画面のボタンの色が ${await btnColor(admin, "#saveTheme")}`);
      await openEmbed(guest);
      must((await btnColor(guest, '[data-go="quote"]')) === SHU, `予約画面のボタンの色が ${await btnColor(guest, '[data-go="quote"]')}`);
    });
    await check("設定", "S-03", "管理画面の「設定」で緑にして保存すると、管理画面がすぐ緑になり、変更履歴に だれが・朱 → 緑 が残る", async () => {
      await admin.check('input[name="theme"][value="green"]');
      await admin.click("#saveTheme");
      await admin.waitForSelector("#thMsg .alert", { timeout: 10000 });
      await admin.mouse.move(0, 300); // ボタンの上から外し、色の移り変わり（0.15 秒）を待つ（押したままの色を読まない）
      await admin.waitForTimeout(400);
      must((await admin.locator("html").getAttribute("data-theme")) === "green", "管理画面の属性が緑でない");
      must((await btnColor(admin, "#saveTheme")) === GREEN, `管理画面のボタンの色が ${await btnColor(admin, "#saveTheme")}`);
      const hist = await admin.locator("#thHist").innerText();
      has(hist, "朱 → 緑", "変更履歴"); has(hist, "e2e-ok", "変更履歴の「だれが」");
      await admin.goto(`${API}/admin`);
      await admin.waitForSelector(".heat-grid a[data-go]");
      must((await admin.locator("html").getAttribute("data-theme")) === "green", "開き直した管理画面が緑でない");
    });
    await check("設定", "S-03", "お客さまが次に予約画面を開くと緑で出る", async () => {
      await openEmbed(guest);
      must((await btnColor(guest, '[data-go="quote"]')) === GREEN, `予約画面のボタンの色が ${await btnColor(guest, '[data-go="quote"]')}`);
    });
    await check("設定", "S-03", "知らない色は断り、色は変わらない", async () => {
      const r = await ctx.request.post(`${API}/admin/api/settings`, { headers: { "X-Ybk": "1", "Content-Type": "application/json", Origin: API, Cookie: `ybk_s=${await sessionCookie("sub-ok")}` }, data: { theme: "purple" } });
      const j = await r.json();
      must(r.status() === 400 && j.errors?.theme === "色を選んでください", `答えが ${r.status()} ${JSON.stringify(j)}`);
      await openEmbed(guest);
      must((await btnColor(guest, '[data-go="quote"]')) === GREEN, "色が変わった");
    });

    // ---------- 予約画面の配り方（S-04）：STUDIO の枠（iframe）の中 ----------
    await check("配り方", "S-04", "単独で開くと、上の帯と下のボタンは画面に固定される", async () => {
      await openEmbed(guest);
      const pos = await guest.evaluate(() => [getComputedStyle(document.querySelector('[data-step="1"] .app-top')).position, getComputedStyle(document.querySelector('[data-step="1"] .app-cta')).position]);
      must(pos[0] === "sticky" && pos[1] === "fixed", `上の帯 ${pos[0]}・下のボタン ${pos[1]}`);
    });
    await check("配り方", "S-04", "STUDIO の枠の形（親ページに parent-height.html）では、帯もボタンも固定せず中身のすぐ下に置き、枠の高さが中身に合い、STEP を進めると親が先頭へ動かす", async () => {
      const outer = await ctx.newPage();
      await outer.setViewportSize({ width: 375, height: 800 });
      await outer.goto(EMBED + "framed");
      const fr = outer.frameLocator("sandbox-iframe iframe");
      await fr.locator(".ybk-cal button[data-day]").first().waitFor({ timeout: 15000 });
      const frame = outer.frames().find((f) => f !== outer.mainFrame());
      const pos = await frame.evaluate(() => [document.documentElement.classList.contains("ybk-framed"), getComputedStyle(document.querySelector('[data-step="1"] .app-top')).position, getComputedStyle(document.querySelector('[data-step="1"] .app-cta')).position]);
      must(pos[0] && pos[1] === "static" && pos[2] === "static", `枠の印 ${pos[0]}・上の帯 ${pos[1]}・下のボタン ${pos[2]}`);
      await outer.waitForTimeout(500);
      const sizes = async () => ({ box: await outer.evaluate(() => document.querySelector("sandbox-iframe").getBoundingClientRect().height), inner: await frame.evaluate(() => Math.ceil(document.getElementById("ybk").getBoundingClientRect().bottom)) });
      let s = await sizes();
      must(Math.abs(s.box - s.inner) <= 4, `枠の高さ ${s.box}・中身 ${s.inner}（ybk-h が届いていない）`);
      const cta = await frame.evaluate(() => { const r = document.querySelector('[data-step="1"] .app-cta').getBoundingClientRect(), y = document.getElementById("ybk").getBoundingClientRect(); return y.bottom - r.bottom; });
      must(cta >= 0 && cta < 40, `下のボタンが中身のいちばん下にない（下との間 ${cta}px）`);
      await frame.locator(`.ybk-cal button[data-day]:not([disabled])`).first().click();
      await frame.locator('[data-go="quote"]').click();
      await frame.locator('[data-step="2"]:not([hidden])').waitFor({ timeout: 10000 });
      await outer.waitForTimeout(1200);
      must((await outer.evaluate(() => window.scrollY)) > 0, "STEP を進めても親が先頭へ動かない（ybk-top）");
      s = await sizes();
      must(Math.abs(s.box - s.inner) <= 4, `STEP 2 で枠の高さ ${s.box}・中身 ${s.inner}`);
      await outer.close();
    });
    await check("配り方", "S-04", "前の埋め込み（web/embed.html を丸ごと貼る形）も、いまの Worker で空きと料金まで動く（本番の差し替えまでの間）", async () => {
      const old = await ctx.newPage();
      await old.goto(EMBED + "old");
      await old.waitForSelector(".ybk-cal button[data-day]:not([disabled])", { timeout: 15000 });
      await old.locator(".ybk-cal button[data-day]:not([disabled])").first().click();
      await old.click('[data-go="quote"]');
      await old.waitForSelector('.ybk-step[data-step="2"]:not([hidden])', { timeout: 10000 });
      has(await old.locator('.ybk-step[data-step="2"] [data-sum]').innerText(), "お支払い", "前の埋め込みの料金");
      await old.close();
    });

    // ---------- c. ログイン ----------
    const api = await pwRequest.newContext({ baseURL: API, maxRedirects: 0 });
    const get = async (path, cookie) => api.get(path, cookie ? { headers: { Cookie: `ybk_s=${cookie}` } } : {});
    const denied = async (label, cookie) => {
      const page = await get("/admin", cookie);
      must(page.status() === 302 && /^\/admin\/login\?next=/.test(page.headers().location || ""), `${label}：/admin が ${page.status()}（ログイン画面へ移っていない）`);
      const detail = await get(`/admin/b/${bookingNo || "x"}`, cookie);
      must(detail.status() === 302, `${label}：/admin/b/… が ${detail.status()}`);
      const j = await get(`/admin/api/booking?id=${bookingNo || "x"}`, cookie);
      const body = await j.text();
      must(j.status() === 401, `${label}：管理画面の API が ${j.status()}`);
      must(!body.includes(GUEST.name) && !body.includes(GUEST.tel), `${label}：応答に予約の中身が出ている`);
    };
    await check("K2", "R6-2", "許可した人の Cookie では、管理画面の画面と API が開く", async () => {
      const c = await sessionCookie("sub-ok");
      must((await get("/admin", c)).status() === 200, "/admin が開かない");
      const j = await get(`/admin/api/booking?id=${bookingNo}`, c);
      must(j.status() === 200 && (await j.json()).booking?.id === bookingNo, "API で予約が読めない");
    });
    await check("K2", "R6-2", "Cookie なしでは開けない（画面はログインへ、API は 401）", () => denied("Cookie なし", null));
    await check("K2", "R6-2", "利用者の一覧にない人（sub）の Cookie では開けない", async () => denied("一覧にない人", await sessionCookie("sub-none")));
    await check("K2", "R6-2", "使えない状態（active=0）の人の Cookie では開けない", async () => denied("使えない状態の人", await sessionCookie("sub-off")));
    await check("K2", "R6-2", "メールアドレスが許可の設定にない人の Cookie では開けない", async () => denied("許可の設定にない人", await sessionCookie("sub-out")));
    await check("K2", "R6-2", "署名が違う Cookie・期限切れの Cookie では開けない", async () => {
      await denied("別の鍵の署名", await sessionCookie("sub-ok", "別の鍵"));
      await denied("期限切れ", await sessionCookie("sub-ok", SECRET, Date.now() - 1000));
    });
    await api.dispose();
  } finally {
    await browser.close().catch(() => {});
  }
}

// =====================================================================
process.on("SIGINT", () => { stopAll(); process.exit(130); });
process.on("exit", stopAll);
let fatal = null;
try { await main(); } catch (err) { fatal = String(err?.message ?? err); } finally { stopAll(); }

log(`\n受け入れ試験（手元） 予約日 ${T.checkin} から ${T.nights}泊`);
for (const r of results) log(`${r.ok ? "通過  " : "不合格"}  ${r.id.padEnd(3)}  ${r.req.padEnd(14)}  ${r.title}${r.ok ? "" : "\n          → " + r.why}`);
if (fatal) log(`\n準備か後片付けで止まった：${fatal}`);
const failed = results.filter((r) => !r.ok).length;
log(`\n通過 ${results.length - failed} ／ 不合格 ${failed}${fatal ? "（途中で止まった）" : ""}`);
process.exit(failed || fatal ? 1 : 0);
