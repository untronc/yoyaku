// 入力チェックの画面の試験（手元）：src/fields.js の表から作った値（test/field-cases.js。単体テストと同じ）を、予約画面と管理画面の入力欄に実際に打ち、
// 表どおりの文がその欄の下に出るか、断ったときに送られず保存されない（D1 に入らない）かを見る（入力チェック仕様 2026-10-13）
//   npm run fields      （または node e2e/fields.mjs）
// 手元だけで動く（e2e/local.mjs：手元の D1・wrangler dev・確認ページ。ブラウザは PC の Edge を headless で）。accept と同じポートを使うので、同時には流さない。
// 画面で入れられない値（選択肢に無い値・日付欄に入らない形・カレンダーで押せない日など）は単体テスト（test/fields.test.js）だけで見る。
// 通す値は、送ると保存されてしまうので、別の項目に1つまちがいを入れて（止め役）、その項目に文が出ないことを見る。止め役が置けない画面（宿のメモ・名前・日付の変更）は保存されることを見る。
// 結果は 画面×項目×値 ごとに 通過／不合格 を1行ずつ出し、1つでも落ちたら終了コード 1
import { chromium } from "playwright-core";
import { FORMS } from "../src/fields.js";
import { baseInput, fieldCases } from "../test/field-cases.js";
import { API, EMBED, sessionCookie, setCount, startLocal, stopAll } from "./local.mjs";
import site from "./site/site.config.js";

const STATE = ".wrangler/e2e-fields-state"; // ROOT からの相対
const ADMIN = { id: "e2e-ok", email: "operator@example.com", sub: "sub-ok", active: 1 };
const results = [];
const log = (...a) => console.log(...a);
const ctx = (source) => ({ now: new Date(), source });
const ymdOk = (v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v);
const keysOf = (form) => FORMS[form].map((f) => f.key);

function record(screen, c, ok, why = "") {
  results.push({ screen, item: c.label, name: c.name, expect: c.expect, ok, why });
}

// ----- 1つの値を試す -----
/**
 * @param o.page      画面
 * @param o.fill      (input) => 欄に値を入れる
 * @param o.submit    () => ボタンを押す
 * @param o.box       欄の下の文を探す範囲（セレクタ）
 * @param o.keys      このボタンで判定する項目
 * @param o.writes    送られた書き込みの記録（配列。試すたびに空にする）
 * @param o.after     通したあと（止め役なし）にすること
 * @param o.save      通したあと（止め役なし）に保存の答えを待つ API の住所
 */
async function tryCase(screen, c, o) {
  o.writes.length = 0;
  try {
    await o.fill(c.input);
    const pass = !c.expect && !o.blocker;
    const saved = pass && o.save ? o.page.waitForResponse((r) => new URL(r.url()).pathname === o.save, { timeout: 8000 }) : null;
    await o.submit();
    await o.page.waitForTimeout(o.wait ?? 150);
    const shown = {};
    for (const k of o.keys) shown[k] = (await o.page.locator(`${o.box} [data-err="${k}"]`).textContent().catch(() => "")) || "";
    const want = { ...Object.fromEntries(o.keys.map((k) => [k, ""])), ...(o.blocker ? { [o.blocker.key]: o.blocker.msg } : {}), [c.key]: c.expect || "" };
    const diff = o.keys.filter((k) => shown[k] !== want[k]).map((k) => `${k}：「${shown[k]}」（表は「${want[k]}」）`);
    if (diff.length) throw new Error("欄の下の文が違う " + diff.join("／"));
    const sent = o.writes.length;
    if ((c.expect || o.blocker) && sent) throw new Error(`断るはずなのに送られた（${o.writes.join(", ")}）`);
    if (pass && o.after) await o.after();
    if (saved) {
      const j = await (await saved).json();
      if (!j.ok) throw new Error(`保存されなかった：${j.error}`);
    }
    record(screen, c, true);
  } catch (err) {
    record(screen, c, false, String(err?.message ?? err).split("\n")[0]);
  }
}

// ----- 予約画面 -----
async function embedScreens(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000); // 前の値で画面が思わぬ所へ進んでも、長く待たない
  const writes = [];
  page.on("request", (r) => {
    const body = r.postData() || "";
    if (r.method() === "POST" && /"action":"book"/.test(body)) writes.push("予約の送信");
    if (r.method() === "GET" && /action=quote/.test(r.url())) writes.push("空きと料金の問い合わせ");
  });
  const jst = new Date(Date.now() + 9 * 3600000);
  const day = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 15)).toISOString().slice(0, 10); // 来月 15 日
  const open = async () => {
    await page.goto(EMBED);
    await page.waitForFunction(() => window.YBK_FIELDS && window.YBK_SITE, null, { timeout: 15000 });
    await page.waitForSelector(".ybk-cal button[data-day]");
  };
  // カレンダーを先の月へ送って、その日を押す。押せない日（受付期間の外など）なら false
  const pick = async (ymd) => {
    for (let i = 0; i < 8 && !(await page.locator(`.ybk-cal button[data-day="${ymd}"]`).count()); i++) {
      await page.click('[data-nav="1"]');
      await page.waitForTimeout(300);
    }
    const b = page.locator(`.ybk-cal button[data-day="${ymd}"]`);
    if (!(await b.count()) || (await b.isDisabled())) return false;
    await b.click();
    return true;
  };
  const S = "予約画面";
  const qBase = baseInput("quote", site, ctx("web"));
  const opt = async (sel) => page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => o.value));

  // STEP 1：チェックイン（カレンダーで押す）・泊数・人数（選択肢）
  await open();
  // 泊数・人数は − ＋ で選ぶ（泊数 1〜上限、人数 1〜上限＋1 の「○名以上」）。この範囲の整数だけが画面で入れられる
  const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i));
  const options = { nights: range(1, site.maxNights), guests: range(1, site.maxGuests + 1) };
  for (const c of fieldCases("quote", site, ctx("web"))) {
    if (c.key === "checkin" && c.value !== "") {
      await open();
      if (!(await pick(c.value))) continue; // カレンダーで押せない日（今日・受付期間の外・形の違い）は画面で入れられない
    }
    if (c.key !== "checkin" && !options[c.key].includes(String(c.value))) continue;
    await tryCase(S, c, {
      page, writes, box: '#ybk [data-step="1"]', keys: keysOf("quote"),
      fill: async (input) => {
        await open();
        if (c.key !== "checkin") await pick(day);
        else if (c.value !== "") await pick(c.value);
        if (!(await setCount(page, "nights", c.key === "nights" ? input.nights : qBase.nights))) throw new Error("泊数を合わせられない");
        if (!(await setCount(page, "guests", c.key === "guests" ? input.guests : qBase.guests))) throw new Error("人数を合わせられない");
      },
      submit: () => page.click('[data-go="quote"]'),
      wait: 400,
      // 通す値は、空きと料金の問い合わせが送られること（空きがあるかは入力チェックではないので見ない。例：180日先から2泊は2泊目が受付期間の外で「空きがありません」）
      after: async () => { if (!writes.includes("空きと料金の問い合わせ")) throw new Error("空きと料金の問い合わせが送られていない"); },
    });
  }

  // STEP 2：お客さまの情報
  const toStep2 = async () => {
    await open();
    await pick(day);
    await page.click('[data-go="quote"]');
    await page.waitForSelector('.ybk-step[data-step="2"]:not([hidden])', { timeout: 10000 });
  };
  await toStep2();
  const step2 = ["name", "tel", "email", "address", "arrival", "note"];
  const arrivalOpts = await opt('[data-f="arrival"]');
  const step = (n) => page.locator(`.ybk-step[data-step="${n}"]`).isVisible();
  const fill2 = async (input) => {
    // 前の値が通ってしまい STEP 3 へ進んでいたら、STEP 2 に戻してから入れる
    if (!(await step(2))) { if (await step(3)) await page.click('[data-back="2"]'); else await toStep2(); }
    for (const k of step2) {
      if (k === "arrival") await page.selectOption('[data-f="arrival"]', String(input.arrival));
      else await page.fill(`[data-f="${k}"]`, String(input[k]));
    }
  };
  for (const c of fieldCases("book", site, ctx("web")).filter((x) => step2.includes(x.key))) {
    if (c.key === "arrival" && !arrivalOpts.includes(c.value)) continue; // 選択肢に無い値は画面で入れられない
    await tryCase(S, c, {
      page, writes, box: '#ybk [data-step="2"]', keys: step2, fill: fill2,
      submit: () => page.click('[data-go="confirm"]'),
      after: async () => {
        await page.waitForSelector('.ybk-step[data-step="3"]:not([hidden])', { timeout: 5000 });
        await page.click('[data-back="2"]');
      },
    });
  }

  // STEP 3：同意の印（通す値は、もう1つの印を外して止め役にする）
  await fill2(baseInput("book", site, ctx("web")));
  await page.click('[data-go="confirm"]');
  await page.waitForSelector('.ybk-step[data-step="3"]:not([hidden])', { timeout: 5000 });
  const box3 = { agree: '[data-f="agree"]', privacyAgree: '[data-f="privacy"]' };
  for (const c of fieldCases("book", site, ctx("web")).filter((x) => x.key in box3)) {
    if (typeof c.value !== "boolean") continue; // 印は あり／なし しか入れられない
    const other = c.key === "agree" ? "privacyAgree" : "agree";
    const blocker = c.expect ? null : { key: other, msg: FORMS.book.find((f) => f.key === other).msg };
    await tryCase(S, c, {
      page, writes, box: '#ybk [data-step="3"]', keys: ["agree", "privacyAgree"], blocker,
      fill: async () => {
        if (!(await step(3))) throw new Error("STEP 3 が出ていない（前の値で予約が送られた）");
        await page.setChecked(box3[c.key], c.value);
        await page.setChecked(box3[other], !blocker);
      },
      submit: () => page.click('[data-go="book"]'),
    });
  }
  await page.close();
}

// ----- 管理画面 -----
async function adminScreens(browser, ids) {
  const context = await browser.newContext({ viewport: { width: 900, height: 1400 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  await context.addCookies([{ name: "ybk_s", value: await sessionCookie(ADMIN.sub), url: `${API}/admin`, httpOnly: true }]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const writes = [];
  const WRITE = /\/admin\/api\/(manual|info|memo|change|me|rules\/day|rules\/weekly|cancel)$/;
  page.on("request", (r) => { if (r.method() === "POST" && WRITE.test(new URL(r.url()).pathname)) writes.push(new URL(r.url()).pathname); });
  const go = async (path, ready) => {
    await page.goto(API + path);
    await page.waitForFunction(() => window.YBK_FIELDS && window.YBK_SITE, null, { timeout: 15000 });
    await page.waitForSelector(ready, { timeout: 15000 });
  };
  const setDate = (sel, v) => page.fill(sel, String(v));
  const options = async (sel) => page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => o.value));
  // 画面で入れられる値か（日付欄・選択肢・数の欄）
  const enterable = (c, kind, opts) => {
    if (kind === "date") return typeof c.value === "string" && ymdOk(c.value);
    if (kind === "select") return opts.includes(String(c.value));
    if (kind === "number") return c.value === "" || /^-?\d+(\.\d+)?$/.test(String(c.value));
    return true;
  };

  // 電話・LINE の予約を足す（/admin/new）。止め役：お名前を空に（お名前を試すときは電話を「x」に）
  {
    const S = "管理画面：電話・LINE の予約を足す";
    await go("/admin/new", "#addCard");
    // 金額の手入力（要件差分 第2版 2026-10-14）：入れ方はスイッチ（定価／手入力しか選べない。ほかの値は単体テストだけ）、合計金額は文字の欄
    const sel = { checkin: ["#ci", "date"], nights: ["#ni", "select"], guests: ["#gu", "select"], name: ["#nm", "text"], tel: ["#tel", "text"], memo: ["#memo", "text"], priceMode: ["#pmode", "switch"], customPay: ["#cpay", "text"] };
    const opts = { nights: await options("#ni"), guests: await options("#gu") };
    for (const c of fieldCases("manual", site, ctx())) {
      const [css, kind] = sel[c.key];
      if (kind === "switch" && !["", "list", "custom"].includes(String(c.value))) continue;
      if (!enterable(c, kind, opts[c.key])) continue;
      const blocker = c.expect ? null : c.key === "name" ? { key: "tel", msg: FORMS.manual.find((f) => f.key === "tel").msg } : { key: "name", msg: "お名前を入れてください" };
      await tryCase(S, c, {
        page, writes, box: "#addCard", keys: keysOf("manual"), blocker,
        fill: async (input) => {
          await go("/admin/new", "#addCard");
          const v = { ...input, ...(blocker ? { [blocker.key]: blocker.key === "tel" ? "x" : "" } : {}) };
          await setDate("#ci", v.checkin);
          await page.selectOption("#ni", String(v.nights));
          await page.selectOption("#gu", String(v.guests));
          await page.fill("#nm", String(v.name));
          await page.fill("#tel", String(v.tel));
          await page.fill("#memo", String(v.memo));
          if (v.priceMode === "custom") {
            await page.check("#pmode");
            await page.fill("#cpay", String(v.customPay ?? ""));
          }
        },
        submit: () => page.click("#add"),
      });
    }
  }

  // お客様の情報を直す（/admin/b/…）。予約画面からの予約と電話・LINE の予約。止め役は上と同じ
  for (const [source, id] of [["web", ids.web], ["manual", ids.manual]]) {
    const S = `管理画面：お客様の情報を直す（${source === "web" ? "予約画面からの予約" : "電話・LINE の予約"}）`;
    await go(`/admin/b/${id}`, "#infoCard");
    const sel = { name: "#fNm", tel: "#fTel", email: "#fEm", address: "#fAd", arrival: "#fAr", note: "#fNo" };
    const arrivalOpts = await options("#fAr");
    for (const c of fieldCases("info", site, ctx(source))) {
      if (c.key === "arrival" && !enterable(c, "select", arrivalOpts)) continue;
      const blocker = c.expect ? null : c.key === "name" ? { key: "tel", msg: FORMS.info.find((f) => f.key === "tel").msg } : { key: "name", msg: "お名前を入れてください" };
      await tryCase(S, c, {
        page, writes, box: "#infoCard", keys: keysOf("info"), blocker,
        fill: async (input) => {
          await go(`/admin/b/${id}`, "#infoCard");
          const v = { ...input, ...(blocker ? { [blocker.key]: blocker.key === "tel" ? "x" : "" } : {}) };
          for (const [k, css] of Object.entries(sel)) {
            if (k === "arrival") await page.selectOption(css, String(v.arrival));
            else await page.fill(css, String(v[k]));
          }
        },
        submit: () => page.click("#saveInfo"),
      });
    }
  }

  // 日付・人数の変更（/admin/b/…）。電話・LINE の予約で試す。止め役：チェックインを空に（チェックインを試すときは止め役なし＝通す値は保存される）
  {
    const S = "管理画面：日付・人数の変更";
    const id = ids.manual;
    await go(`/admin/b/${id}`, "#chCard");
    const sel = { checkin: ["#ci", "date"], nights: ["#ni", "select"], guests: ["#gu", "select"] };
    const opts = { nights: await options("#chCard #ni"), guests: await options("#chCard #gu") };
    for (const c of fieldCases("stay", site, ctx())) {
      const [, kind] = sel[c.key];
      if (!enterable(c, kind, opts[c.key])) continue;
      const blocker = c.expect || c.key === "checkin" ? null : { key: "checkin", msg: "チェックインの日を選んでください" };
      await tryCase(S, c, {
        page, writes, box: "#chCard", keys: keysOf("stay"), blocker, wait: 300,
        fill: async (input) => {
          await go(`/admin/b/${id}`, "#chCard");
          const v = { ...input, ...(blocker ? { checkin: "" } : {}) };
          await page.selectOption("#chCard #ni", String(v.nights));
          await page.selectOption("#chCard #gu", String(v.guests));
          await setDate("#chCard #ci", v.checkin);
        },
        submit: () => page.click("#doChange"),
        save: "/admin/api/change",
      });
    }
  }

  // 宿のメモ（/admin/b/…）。項目が1つなので、通す値は保存されることを見る
  {
    const S = "管理画面：宿のメモ";
    for (const c of fieldCases("memo", site, ctx())) {
      await tryCase(S, c, {
        page, writes, box: "#memoCard", keys: keysOf("memo"), wait: 300,
        fill: async (input) => { await go(`/admin/b/${ids.web}`, "#memoCard"); await page.fill("#memo", String(input.memo)); },
        submit: () => page.click("#saveMemo"),
        save: "/admin/api/memo",
      });
    }
  }

  // 名前（/admin/me）。項目が1つなので、通す値は保存されることを見る
  {
    const S = "管理画面：名前";
    for (const c of fieldCases("me", site, ctx())) {
      await tryCase(S, c, {
        page, writes, box: "#meCard", keys: keysOf("me"), wait: 300,
        fill: async (input) => { await go("/admin/me", "#meCard"); await page.fill("#meCard #nm", String(input.name)); },
        submit: () => page.click("#sv"),
        save: "/admin/api/me",
      });
    }
  }

  // 受付の設定 日・期間（/admin/rules）。止め役：「から」を昨日に（「から」を試すときは件数を空に）
  {
    const S = "管理画面：受付の設定（日・期間）";
    await go("/admin/rules", "#rlCard");
    const actions = await options("#ra");
    const kinds = { from: "date", to: "date", action: "select", limit: "number" };
    const t = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(t + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    for (const c of fieldCases("rulesDay", site, ctx())) {
      if (!enterable(c, kinds[c.key], actions)) continue;
      // 件数の欄は「上限を決める」「この日は受ける」のときだけ出る。ほかの操作で件数を試す値は画面で入れられない
      if (c.key === "limit" && !["limit", "open"].includes(c.input.action)) continue;
      const blocker = c.expect ? null : c.key === "from" ? { key: "limit", msg: "件数を入れてください" } : { key: "from", msg: "期間が正しくありません" };
      if (blocker?.key === "limit" && c.input.action !== "limit") continue;
      await tryCase(S, c, {
        page, writes, box: "#rlCard", keys: keysOf("rulesDay"), blocker,
        fill: async (input) => {
          await go("/admin/rules", "#rlCard");
          const v = { ...input, ...(blocker ? { [blocker.key]: blocker.key === "from" ? yesterday : "" } : {}) };
          await setDate("#rf", v.from);
          await setDate("#rt", v.to);
          await page.selectOption("#ra", String(v.action));
          if (await page.locator("#rl").isVisible()) await page.fill("#rl", String(v.limit ?? ""));
        },
        submit: () => page.click("#rs"),
      });
    }
  }
  await context.close();
}

// =====================================================================
async function main() {
  const { sql } = await startLocal({ state: STATE, users: [ADMIN] });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    // 予約画面：断る値は送られない。最後に D1 に予約が入っていないことを見る
    await embedScreens(browser);
    const n = sql("SELECT COUNT(*) AS n FROM bookings")[0].n;
    results.push({ screen: "予約画面", item: "D1", name: "予約画面の試験のあと、予約が1件も入っていない", ok: n === 0, why: n ? `bookings に ${n} 件` : "" });

    // 管理画面の試験に使う予約（予約画面から1件・電話・LINE で1件）
    const cookie = `ybk_s=${await sessionCookie(ADMIN.sub)}`;
    const t = new Date(Date.now() + 9 * 3600000);
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 20)).toISOString().slice(0, 10);
    const web = await (await fetch(`${API}/api`, { method: "POST", headers: { Origin: EMBED.replace(/\/$/, ""), "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "book", checkin: d, nights: 1, guests: 2, name: "山田 花子", tel: "090-1234-5678", email: "hanako@example.com", address: "東京都千代田区", arrival: site.arrivalOptions[0], note: "", agree: true, privacyAgree: true }) })).json();
    const manual = await (await fetch(`${API}/admin/api/manual`, { method: "POST", headers: { Cookie: cookie, "X-Ybk": "1", "Content-Type": "application/json", Origin: API }, body: JSON.stringify({ checkin: d, nights: 1, guests: 2, name: "佐藤 一郎", tel: "", memo: "" }) })).json();
    if (!web.ok || !manual.ok) throw new Error(`試験の予約が入らない：${web.error || ""} ${manual.error || ""}`);
    const before = sql("SELECT id, name, tel, email, address, arrival, note FROM bookings ORDER BY id");

    await adminScreens(browser, { web: web.no, manual: manual.id });

    // 断った値は保存されていない：電話・LINE の予約は増えていない・お客様の情報は元のまま・受付の決まりは入っていない
    const after = sql("SELECT id, name, tel, email, address, arrival, note FROM bookings ORDER BY id");
    results.push({ screen: "管理画面", item: "D1", name: "電話・LINE の予約を足す・お客様の情報を直すの試験のあと、予約の件数と中身が変わっていない", ok: JSON.stringify(after) === JSON.stringify(before), why: `前 ${before.length} 件・後 ${after.length} 件` });
    const rules = sql("SELECT COUNT(*) AS n FROM day_rules")[0].n;
    results.push({ screen: "管理画面", item: "D1", name: "受付の設定の試験のあと、日・期間の決まりが1つも入っていない", ok: rules === 0, why: rules ? `day_rules に ${rules} 件` : "" });
  } finally {
    await browser.close().catch(() => {});
  }
}

process.on("SIGINT", () => { stopAll(); process.exit(130); });
process.on("exit", stopAll);
let fatal = null;
try { await main(); } catch (err) { fatal = String(err?.stack ?? err?.message ?? err); } finally { stopAll(); }

log(`\n入力チェックの画面の試験（手元）`);
let last = "";
for (const r of results) {
  if (r.screen !== last) { log(`\n[${r.screen}]`); last = r.screen; }
  log(`${r.ok ? "通過  " : "不合格"}  ${r.item}：${r.name}${r.expect === undefined ? "" : ` → ${r.expect ?? "通す"}`}${r.ok ? "" : "\n          → " + r.why}`);
}
if (fatal) log(`\n準備か後片付けで止まった：${fatal}`);
const failed = results.filter((r) => !r.ok).length;
log(`\n通過 ${results.length - failed} ／ 不合格 ${failed}${fatal ? "（途中で止まった）" : ""}`);
process.exit(failed || fatal ? 1 : 0);
