// 入力チェックの試験（自動で作る）。src/fields.js の表から test/field-cases.js が値を作り、各フォームの API に送って、
// 表どおりに通す／断る／その項目の文を返すか、断ったときに保存されないかを見る（入力チェック仕様 2026-10-13）
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/worker.js";
import { baseInput, fieldCases } from "./field-cases.js";
import { NOW, login, okMail, reset, site } from "./helpers.js";

const worker = createWorker(site, { now: () => NOW });
const STUDIO = "https://embed.example.jp";
const call = (path, init = {}) => worker.fetch(new Request("https://yoyaku.example.jp" + path, init), env, {});
const post = (body) => call("/api", { method: "POST", headers: { Origin: STUDIO, "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (path) => call(path, { headers: { Origin: STUDIO } }).then((r) => r.json());
const admin = (cookie, path, body) =>
  call("/admin/api" + path, body ? { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Ybk": "1", Origin: "https://yoyaku.example.jp" }, body: JSON.stringify(body) } : { headers: { Cookie: cookie } }).then((r) => r.json());
const one = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
const count = async (t) => (await one(`SELECT COUNT(*) AS n FROM ${t}`)).n;
const ctx = (source) => ({ now: NOW, source });
const title = (c) => `${c.label}：${c.name} → ${c.expect ?? "通す"}`;

beforeEach(async () => {
  await reset();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => okMail());
});
afterEach(() => vi.restoreAllMocks());

/** その項目だけが、表どおりの文で断られたか（通す値ならエラーが無いか） */
function judged(j, c) {
  if (c.expect) {
    expect(j.ok).toBe(false);
    expect(j.errors).toEqual({ [c.key]: c.expect });
    expect(j.error).toBe(c.expect);
  } else {
    expect(j.errors?.[c.key]).toBeUndefined();
    expect(j.ok).toBe(true);
  }
}

/** 試験用の予約を1件入れる（予約画面から＝web、電話・LINE＝manual） */
async function seed(source) {
  const at = NOW.toISOString();
  await env.DB.prepare(`INSERT INTO bookings (id, source, status, checkin, checkout, nights, guests, per_person, total, discount, pay, price_version, name, tel, email, address, arrival, note, inn_memo, received_at, created_at, created_by, updated_at, updated_by)
    VALUES ('s1', ?, 'booked', '2026-11-20', '2026-11-22', 2, 3, 5000, 30000, 0, 30000, 'r1', '山田 花子', '090-1234-5678', 'hanako@example.com', '東京都千代田区', '15:00〜16:00', '', '元のメモ', ?, ?, 's', ?, 's')`).bind(source, at, at, at).run();
  return "s1";
}
const row = (id) => one("SELECT name, tel, email, address, arrival, note, inn_memo, checkin, nights, guests, updated_at FROM bookings WHERE id = ?", id);

describe("予約画面：予約（POST /api action=book）", () => {
  it.each(fieldCases("book", site, ctx("web")).map((c) => [title(c), c]))("%s", async (_, c) => {
    const j = await post({ action: "book", ...c.input });
    judged(j, c);
    expect(await count("bookings")).toBe(c.expect ? 0 : 1);
  });
  it("まちがいは全部まとめて返し、error は最初の1つ（いまの形）", async () => {
    const j = await post({ action: "book", ...baseInput("book", site, ctx("web")), name: "", tel: "x", email: "", agree: false });
    expect(j).toEqual({
      ok: false,
      error: "お名前を入れてください",
      errors: { name: "お名前を入れてください", tel: "電話番号の形が正しくありません（例：03-1234-5678、090-1234-5678）", email: "メールアドレスの形が正しくありません", agree: "キャンセル料への同意が必要です" },
    });
  });
});

describe("予約画面：空きと料金（GET /api action=quote）", () => {
  it.each(fieldCases("quote", site, ctx("web")).map((c) => [title(c), c]))("%s", async (_, c) => {
    const q = new URLSearchParams({ action: "quote", checkin: String(c.input.checkin), nights: String(c.input.nights), guests: String(c.input.guests) });
    judged(await get("/api?" + q), c);
  });
});

describe("月の指定（予約画面のカレンダー GET /api action=calendar・管理画面の月の表 GET /admin/api/month）", () => {
  it.each(fieldCases("month", site, ctx()).map((c) => [title(c), c]))("%s", async (_, c) => {
    judged(await get("/api?action=calendar&month=" + encodeURIComponent(c.value)), c);
    const cookie = await login();
    judged(await admin(cookie, "/month?m=" + encodeURIComponent(c.value)), c);
  });
});

describe("管理画面：電話・LINE の予約を足す（POST /admin/api/manual）", () => {
  it.each(fieldCases("manual", site, ctx("manual")).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    judged(await admin(cookie, "/manual", c.input), c);
    expect(await count("bookings")).toBe(c.expect ? 0 : 1);
  });
});

for (const source of ["web", "manual"]) {
  describe(`管理画面：日付・人数の変更（POST /admin/api/change）と料金の下見（POST /admin/api/quote・${source === "web" ? "予約画面からの予約" : "電話・LINE の予約"}）`, () => {
    it.each(fieldCases("stay", site, ctx(source)).map((c) => [title(c), c]))("%s", async (_, c) => {
      const cookie = await login();
      const id = await seed(source);
      judged(await admin(cookie, "/quote", { id, ...c.input }), c);
      const before = await row(id);
      judged(await admin(cookie, "/change", { id, ...c.input }), c);
      if (c.expect) expect(await row(id)).toEqual(before);
    });
  });
}

describe("管理画面：予約を足す前の料金の下見（POST /admin/api/quote・予約番号なし＝電話・LINE の予約）", () => {
  it.each(fieldCases("stay", site, ctx("manual")).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    judged(await admin(cookie, "/quote", c.input), c);
  });
});

for (const source of ["web", "manual"]) {
  describe(`管理画面：お客様の情報を直す（POST /admin/api/info・${source === "web" ? "予約画面からの予約" : "電話・LINE の予約"}）`, () => {
    it.each(fieldCases("info", site, ctx(source)).map((c) => [title(c), c]))("%s", async (_, c) => {
      const cookie = await login();
      const id = await seed(source);
      const before = await row(id);
      judged(await admin(cookie, "/info", { id, ...c.input }), c);
      if (c.expect) expect(await row(id)).toEqual(before);
    });
  });
}

describe("管理画面：宿のメモ（POST /admin/api/memo）", () => {
  it.each(fieldCases("memo", site, ctx()).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    const id = await seed("web");
    judged(await admin(cookie, "/memo", { id, ...c.input }), c);
    expect((await row(id)).inn_memo).toBe(c.expect ? "元のメモ" : String(c.value).replace(/\r\n?/g, "\n").trim());
  });
});

describe("管理画面：名前（POST /admin/api/me）", () => {
  it.each(fieldCases("me", site, ctx()).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    judged(await admin(cookie, "/me", c.input), c);
    const name = (await one("SELECT display_name FROM admin_users")).display_name;
    if (c.expect) expect(name).toBe("運用者");
    else expect(name).not.toBe("運用者");
  });
});

describe("管理画面：受付の設定 日・期間（POST /admin/api/rules/day）", () => {
  it.each(fieldCases("rulesDay", site, ctx()).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    judged(await admin(cookie, "/rules/day", c.input), c);
    if (c.expect) expect(await count("day_rules")).toBe(0);
  });
});

describe("管理画面：受付の設定 曜日（POST /admin/api/rules/weekly）", () => {
  it.each(fieldCases("rulesWeekly", site, ctx()).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    judged(await admin(cookie, "/rules/weekly", c.input), c);
    if (c.expect) expect(await count("weekly_rules")).toBe(0);
    else if (c.stored !== undefined) expect((await one("SELECT stop FROM weekly_rules WHERE weekday = ?", c.input.weekday))?.stop ?? 0).toBe(c.stored);
  });
});

describe("画面に配る入力チェック（GET /validate.js）", () => {
  it("JS で、施設の判定に使う値だけを入れて配る（宛先・アカウントは入れない）", async () => {
    const res = await call("/validate.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    const js = await res.text();
    expect(js).toContain("window.YBK_FIELDS = (function");
    expect(js).toContain(JSON.stringify(site.arrivalOptions));
    for (const secret of [...site.admins, site.mail.notifyTo, site.mail.from]) expect(js).not.toContain(secret);
  });
});

describe("管理画面：設定 画面の色（POST /admin/api/settings）", () => {
  it.each(fieldCases("settings", site, ctx()).map((c) => [title(c), c]))("%s", async (_, c) => {
    const cookie = await login();
    const j = await admin(cookie, "/settings", c.input);
    // 既定の朱をもう一度選ぶのは「変わったところがありません」（入力のまちがいではない）
    if (!c.expect && c.value === "shu") { expect(j).toEqual({ ok: false, error: "変わったところがありません" }); return; }
    judged(j, c);
    const row = await one("SELECT value FROM site_settings WHERE setting_key = 'theme'");
    if (c.expect) { expect(row).toBeNull(); expect(await count("setting_changes")).toBe(0); }
    else expect(row.value).toBe(c.value);
  });
});
