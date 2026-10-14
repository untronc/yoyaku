import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "../src/auth.js";
import { dailyCleanup } from "../src/cron.js";
import { createWorker } from "../src/worker.js";
import { NOW, bookBody, login, okMail, reset, site, siteWith } from "./helpers.js";

// 「今」は NOW に決める（過去の日を断る決まりがあるので、試験の日付が先の日のままになるように）
const worker = createWorker(site, { now: () => NOW });
const STUDIO = "https://embed.example.jp";
const call = (path, init = {}, w = worker) => w.fetch(new Request("https://yoyaku.example.jp" + path, init), env, {});
const adminPost = (cookie, path, body, extra = {}) =>
  call("/admin/api" + path, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Ybk": "1", Origin: "https://yoyaku.example.jp", ...extra }, body: JSON.stringify(body) });
const adminGet = (cookie, path) => call("/admin/api" + path, { headers: { Cookie: cookie } });

beforeEach(async () => {
  await reset();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => okMail());
});
afterEach(() => vi.restoreAllMocks());

/** 予約画面から1件入れて予約番号を返す（日付は今日より後になるよう、本物の今日から数える） */
async function webBooking(over = {}) {
  const d = new Date(NOW.getTime() + 9 * 3600000 + 20 * 86400000).toISOString().slice(0, 10);
  const res = await call("/api", { method: "POST", headers: { Origin: STUDIO, "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(bookBody({ checkin: d, ...over })) });
  return (await res.json()).no;
}

describe("予約画面の API", () => {
  it("許可した住所には CORS を付けて返す", async () => {
    const res = await call("/api?action=ping", { headers: { Origin: STUDIO } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STUDIO);
    expect((await res.json()).ok).toBe(true);
    const cal = await (await call("/api?action=calendar&month=2026-12", { headers: { Origin: STUDIO } })).json();
    expect(cal.ok).toBe(true);
    expect(Object.keys(cal.days)).toHaveLength(31);
  });
  it("許可していない住所からの書き込みは受けない", async () => {
    const res = await call("/api", { method: "POST", headers: { Origin: "https://evil.example" }, body: JSON.stringify(bookBody()) });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("[R6-1] 誤りはリリース1と同じく {ok:false, error} で返す", async () => {
    const j = await (await call("/api?action=calendar&month=x", { headers: { Origin: STUDIO } })).json();
    expect(j).toEqual({ ok: false, error: "月の形が正しくありません", errors: { month: "月の形が正しくありません" } });
  });
  it("[R7-5] 操作ログを残す（個人情報なし）", async () => {
    const res = await call("/api", { method: "POST", headers: { Origin: STUDIO }, body: JSON.stringify({ action: "log", items: [{ at: "x", sid: "v1", ev: "open", ok: true, ms: 120, info: "", w: 375 }] }) });
    expect(await res.json()).toEqual({ ok: true, n: 1 });
    expect(await env.DB.prepare("SELECT action, result, ms, width, created_by FROM access_log").first()).toEqual({ action: "open", result: "成功", ms: 120, width: "375", created_by: "guest" });
  });
});

describe("管理画面の入口", () => {
  it("[R6-2・R6-9・R9-3] ログインしていなければ Google のログインへ。予約通知のリンクは戻り先に残る", async () => {
    const res = await call("/admin/b/261101-1234", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/login?next=%2Fadmin%2Fb%2F261101-1234");
    const lg = await call("/admin/login?next=/admin/b/261101-1234");
    const loc = new URL(lg.headers.get("Location"));
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://yoyaku.example.jp/admin/callback");
    expect(loc.searchParams.get("scope")).toBe("openid email profile");
  });
  it("[R6-2] API はログインしていなければ 401", async () => {
    expect((await adminGet("", "/me")).status).toBe(401);
  });
  it("[R6-2] 許可から外したアカウントは、ログインの Cookie があっても使えない", async () => {
    const c = await login("someone@example.com", "sub-x");
    expect((await adminGet(c, "/me")).status).toBe(401);
  });
  it("独自の見出しの無い書き込み・よその住所からの書き込みは断る", async () => {
    const c = await login();
    expect((await adminPost(c, "/me", { name: "x" }, { "X-Ybk": "" })).status).toBe(403);
    expect((await adminPost(c, "/me", { name: "x" }, { Origin: "https://evil.example" })).status).toBe(403);
  });
  it("管理画面の HTML は、よそのページの枠に入れさせない", async () => {
    const c = await login();
    const res = await call("/admin", { headers: { Cookie: c } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("管理画面の操作", () => {
  it("[R5-20・R6-3・R7-7] 名前を直すと、変更履歴の「だれが」に直した名前が出る", async () => {
    const c = await login();
    expect((await (await adminGet(c, "/me")).json()).me).toEqual({ name: "運用者", email: "operator@example.com" });
    await adminPost(c, "/me", { name: "運用者 二号" });
    const no = await webBooking();
    await adminPost(c, "/cancel", { id: no });
    const j = await (await adminGet(c, "/booking?id=" + no)).json();
    expect(j.history.map((h) => [h.kind, h.by])).toEqual([["create", "予約画面"], ["cancel", "運用者 二号"]]);
  });

  it("[R5-7・R5-9・R6-5・R6-10・R7-6・R7-7] キャンセル：記録は残し、空きはすぐ戻る。取り消しはできない", async () => {
    const c = await login();
    const no = await webBooking();
    const b = await env.DB.prepare("SELECT checkin FROM bookings WHERE id = ?").bind(no).first();
    const month = b.checkin.slice(0, 7);
    const roomsOf = async () => (await (await call(`/api?action=calendar&month=${month}`, { headers: { Origin: STUDIO } })).json()).days[b.checkin].rooms;
    expect(await roomsOf()).toBe(2);
    expect((await adminPost(c, "/cancel", { id: no })).status).toBe(200);
    expect(await roomsOf()).toBe(3);
    const r = await env.DB.prepare("SELECT status, cancelled_at, name, updated_by FROM bookings WHERE id = ?").bind(no).first();
    expect(r).toMatchObject({ status: "cancelled", name: "山田 花子", updated_by: "sub-op" });
    expect(r.cancelled_at).toBeTruthy();
    expect(await (await adminPost(c, "/cancel", { id: no })).json()).toEqual({ ok: false, error: "この予約はキャンセル済みです" });
  });

  it("[R5-11・R6-6・R6-10・R7-3] 日付・人数の変更：料金を計算し直し、満室の日でも受け、変更履歴を残す", async () => {
    const c = await login();
    const no = await webBooking();
    const b = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(no).first();
    // 移す先の日を受付停止にしておく
    await adminPost(c, "/rules/day", { from: "2027-01-12", to: "2027-01-12", action: "stop" });
    const q = await (await adminPost(c, "/quote", { id: no, checkin: "2027-01-11", nights: 3, guests: 2 })).json();
    expect(q).toMatchObject({ ok: true, checkout: "2027-01-14", price: { total: 30000, discount: 3000, pay: 27000 }, full: ["2027-01-12"] });
    expect((await adminPost(c, "/change", { id: no, checkin: "2027-01-11", nights: 3, guests: 2 })).status).toBe(200);
    const a = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(no).first();
    expect(a).toMatchObject({ checkin: "2027-01-11", checkout: "2027-01-14", nights: 3, guests: 2, total: 30000, discount: 3000, pay: 27000 });
    const j = await (await adminGet(c, "/booking?id=" + no)).json();
    expect(j.history[1]).toMatchObject({ kind: "change", before: { checkin: b.checkin, guests: 3 }, after: { checkin: "2027-01-11", guests: 2, pay: 27000 }, by: "運用者" });
  });

  it("[R5-10・R6-6] 料金は予約したときの料金表で計算し直す", async () => {
    const c = await login();
    const no = await webBooking();
    const w2 = createWorker(siteWith({ price: { current: "r2", tables: { ...site.price.tables, r2: { tiers: [{ min: 1, max: 999, price: 9999 }], longStay: [] } } } }), { now: () => NOW });
    await call("/admin/api/change", { method: "POST", headers: { Cookie: c, "X-Ybk": "1", "Content-Type": "application/json" }, body: JSON.stringify({ id: no, checkin: "2027-01-05", nights: 1, guests: 2 }) }, w2);
    expect((await env.DB.prepare("SELECT per_person FROM bookings WHERE id = ?").bind(no).first()).per_person).toBe(5000);
  });

  it("[R11-1] 宿のメモ：中身は変更履歴に入れない", async () => {
    const c = await login();
    const no = await webBooking();
    await adminPost(c, "/memo", { id: no, memo: "布団を1組多めに" });
    expect((await env.DB.prepare("SELECT inn_memo FROM bookings WHERE id = ?").bind(no).first()).inn_memo).toBe("布団を1組多めに");
    const h = await env.DB.prepare("SELECT before_json, after_json FROM booking_changes WHERE kind = 'memo'").first();
    expect(h).toEqual({ before_json: null, after_json: null });
  });

  it("[R5-12・R5-13・R5-14・R6-4・R6-7] 電話・LINE の予約：空きを減らし、メールは送らず、不正利用対策の数に入れない", async () => {
    const c = await login();
    const sent = globalThis.fetch.mock.calls.length;
    const r = await (await adminPost(c, "/manual", { checkin: "2027-02-01", nights: 2, guests: 4, name: "佐藤", tel: "", memo: "電話で受付" })).json();
    expect(r.ok).toBe(true);
    const b = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(r.id).first();
    expect(b).toMatchObject({ source: "manual", status: "booked", total: 36000, mail_guest: "none", inn_memo: "電話で受付", created_by: "sub-op" });
    expect(globalThis.fetch.mock.calls.length).toBe(sent);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM daily_counts").first()).n).toBe(0);
    const m = await (await adminGet(c, "/month?m=2027-02")).json();
    expect(m.days["2027-02-01"]).toEqual({ count: 1, guests: 4, limit: 3, stop: "" });
  });

  it("満室・受付停止の日への電話・LINE の予約も、知らせを出したうえで受ける", async () => {
    const c = await login();
    await adminPost(c, "/rules/day", { from: "2027-02-03", to: "2027-02-03", action: "stop" });
    const q = await (await adminPost(c, "/quote", { checkin: "2027-02-02", nights: 2, guests: 1 })).json();
    expect(q.full).toEqual(["2027-02-03"]);
    const r = await (await adminPost(c, "/manual", { checkin: "2027-02-02", nights: 2, guests: 1, name: "鈴木" })).json();
    expect(r).toMatchObject({ ok: true, full: ["2027-02-03"] });
  });

  it("[R7-3] お客様の情報を直す：前と後の値を変更履歴に残す。確かめは予約画面と同じ", async () => {
    const c = await login();
    const no = await webBooking();
    const base = { id: no, name: "山田 花子", tel: "090-1234-5678", email: "hanako@example.com", address: "東京都千代田区", arrival: "15:00〜16:00", note: "" };
    expect(await (await adminPost(c, "/info", { ...base, name: "山田 華子", tel: "０９０－１２３４－５６７９" })).json()).toEqual({ ok: true, id: no, changed: ["name", "tel"] });
    const b = await env.DB.prepare("SELECT name, tel, updated_by FROM bookings WHERE id = ?").bind(no).first();
    expect(b).toEqual({ name: "山田 華子", tel: "090-1234-5679", updated_by: "sub-op" });
    const j = await (await adminGet(c, "/booking?id=" + no)).json();
    expect(j.history[1]).toMatchObject({ kind: "info", before: { name: "山田 花子", tel: "090-1234-5678" }, after: { name: "山田 華子", tel: "090-1234-5679" }, by: "運用者" });
    expect((await (await adminPost(c, "/info", { ...base, name: "山田 華子", tel: "090-1234-5679", email: "x" })).json()).error).toBe("メールアドレスの形が正しくありません");
    expect((await (await adminPost(c, "/info", { ...base, name: "山田 華子", tel: "090-1234-5679", address: "" })).json()).error).toBe("ご住所を入れてください");
    expect((await (await adminPost(c, "/info", { ...base, name: "https://x.example", tel: "090-1234-5679" })).json()).error).toBe("お名前にURLは入れられません");
    expect((await (await adminPost(c, "/info", { ...base, name: "山田 華子", tel: "090-1234-5679" })).json()).error).toBe("変わったところがありません");
  });

  it("[R5-15・R5-16・R6-8・R7-3] 受付条件：期間・定休日・この日は受ける。変更履歴が見られる", async () => {
    const c = await login();
    expect(await (await adminPost(c, "/rules/day", { from: "2027-03-01", to: "2027-03-03", action: "limit", limit: 1 })).json()).toEqual({ ok: true, changed: 3 });
    await adminPost(c, "/rules/weekly", { weekday: 2, stop: true });
    await adminPost(c, "/rules/day", { from: "2027-03-02", to: "2027-03-02", action: "open" }); // 火曜だが受ける
    await adminPost(c, "/rules/day", { from: "2027-03-03", to: "2027-03-03", action: "clear" });
    const m = (await (await adminGet(c, "/month?m=2027-03")).json()).days;
    expect([m["2027-03-01"].limit, m["2027-03-02"].limit, m["2027-03-03"].limit, m["2027-03-09"]]).toEqual([1, 3, 3, { count: 0, guests: 0, limit: 0, stop: "weekly" }]);
    const r = await (await adminGet(c, "/rules?from=2027-03-01&to=2027-03-31")).json();
    expect(r.weekly).toEqual([{ weekday: 2, stop: 1 }]);
    expect(r.history).toHaveLength(6);
    expect(r.history.every((h) => h.by === "運用者")).toBe(true);
  });
});

describe("変更履歴の FK（migrations/V0003）", () => {
  it("[R6-10・R7-3] 予約の履歴は予約と利用者を FK で指す。無い予約・無い利用者は入らない", async () => {
    const c = await login();
    const no = await webBooking();
    await adminPost(c, "/cancel", { id: no });
    const u = await env.DB.prepare("SELECT id FROM admin_users WHERE google_sub = 'sub-op'").first();
    const rows = (await env.DB.prepare("SELECT kind, changed_via, changed_by_user_id FROM booking_changes WHERE booking_id = ? ORDER BY changed_at").bind(no).all()).results;
    expect(rows).toEqual([{ kind: "create", changed_via: "guest", changed_by_user_id: null }, { kind: "cancel", changed_via: "admin", changed_by_user_id: u.id }]);
    const at = new Date().toISOString();
    const bad = (bookingId, userId) =>
      env.DB.prepare("INSERT INTO booking_changes (id, booking_id, kind, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by) VALUES (?, ?, 'memo', ?, 'admin', ?, ?, 's', ?, 's')")
        .bind(crypto.randomUUID(), bookingId, at, userId, at, at).run();
    await expect(bad("999999-0000", u.id)).rejects.toThrow(/FOREIGN KEY/);
    await expect(bad(no, "no-such-user")).rejects.toThrow(/FOREIGN KEY/);
  });

  it("[R5-15・R7-2・R7-3] 「決まりを外す」は行を残して中身を空にし、受付条件の履歴は日・曜日を FK で指す", async () => {
    const c = await login();
    await adminPost(c, "/rules/day", { from: "2027-04-01", to: "2027-04-01", action: "stop" });
    await adminPost(c, "/rules/day", { from: "2027-04-01", to: "2027-04-01", action: "clear" });
    await adminPost(c, "/rules/weekly", { weekday: 3, stop: true });
    expect(await env.DB.prepare("SELECT stop, limit_count FROM day_rules WHERE day = '2027-04-01'").first()).toEqual({ stop: null, limit_count: null });
    const r = await (await adminGet(c, "/rules?from=2027-04-01&to=2027-04-30")).json();
    expect(r.days).toEqual([]); // 中身が空の行は「決まりを入れた日」に出さない
    expect(r.history.map((h) => [h.target, h.key, h.before, h.after, h.by])).toEqual([
      ["weekly_rule", "3", { stop: 0 }, { stop: 1 }, "運用者"],
      ["day_rule", "2027-04-01", { stop: 1, limit_count: null }, null, "運用者"],
      ["day_rule", "2027-04-01", null, { stop: 1, limit_count: null }, "運用者"],
    ]);
    // 空にした日は、もう一度「外す」を押しても履歴を増やさない
    expect(await (await adminPost(c, "/rules/day", { from: "2027-04-01", to: "2027-04-01", action: "clear" })).json()).toEqual({ ok: true, changed: 0 });
    const at = new Date().toISOString();
    await expect(
      env.DB.prepare("INSERT INTO rule_changes (id, day, changed_at, changed_via, created_at, created_by, updated_at, updated_by) VALUES (?, '2099-01-01', ?, 'admin', ?, 's', ?, 's')").bind(crypto.randomUUID(), at, at, at).run()
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("ログイン", () => {
  const idToken = (claims) => "h." + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims)))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + ".s";
  async function callback(claims, stateOk = true) {
    const lg = await call("/admin/login?next=/admin/b/1");
    const loc = new URL(lg.headers.get("Location"));
    const stCookie = lg.headers.get("Set-Cookie").split(";")[0];
    globalThis.fetch.mockImplementation(async () => new Response(JSON.stringify({ id_token: idToken({ iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, exp: Date.now() / 1000 + 600, nonce: loc.searchParams.get("nonce"), email_verified: true, ...claims }) })));
    const state = stateOk ? loc.searchParams.get("state") : "wrong";
    return call(`/admin/callback?state=${state}&code=abc`, { headers: { Cookie: stCookie } });
  }
  it("[R5-20・R6-2・R6-3・R7-4] 許可したアカウントは、最初のログインで Google の名前を取り込み、戻り先へ", async () => {
    const res = await callback({ sub: "g-1", email: "Owner@example.com", name: "宿の主人" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/b/1");
    expect(res.headers.get("Set-Cookie")).toContain("ybk_s=");
    expect(await env.DB.prepare("SELECT email, google_sub, display_name, created_by FROM admin_users").first()).toEqual({ email: "owner@example.com", google_sub: "g-1", display_name: "宿の主人", created_by: "g-1" });
  });
  it("[R5-20] 名前が取れなければメールアドレスを出す", async () => {
    await callback({ sub: "g-2", email: "operator@example.com" });
    expect((await env.DB.prepare("SELECT display_name FROM admin_users").first()).display_name).toBe("operator@example.com");
  });
  it("[R6-2] 許可していないアカウント・state の合わないものは通さない", async () => {
    expect((await callback({ sub: "g-3", email: "other@gmail.com", name: "x" })).status).toBe(403);
    expect((await callback({ sub: "g-1", email: "operator@example.com" }, false)).status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_users").first()).n).toBe(0);
  });
  it("[R6-2] 署名の合わない Cookie は通さない", async () => {
    await login();
    const forged = "ybk_s=" + encodeURIComponent(await sign("other-secret", { sub: "sub-op", exp: Date.now() + 3600000 }));
    expect((await adminGet(forged, "/me")).status).toBe(401);
  });
});

describe("1日1回の後片付け", () => {
  it("[R7-6・R7-8・R7-10] 前日までの数・3年たった個人情報（変更履歴の値も）・90日を過ぎた操作ログを消す", async () => {
    const at = NOW.toISOString();
    const ins = (id, checkout) =>
      env.DB.prepare(`INSERT INTO bookings (id, source, status, checkin, checkout, nights, guests, per_person, total, discount, pay, price_version, name, tel, email, inn_memo, received_at, created_at, created_by, updated_at, updated_by)
        VALUES (?, 'web', 'booked', '2023-10-01', ?, 1, 2, 5000, 10000, 0, 10000, 'r1', '山田', '090', 'a@b.c', 'メモ', ?, ?, 'guest', ?, 'guest')`).bind(id, checkout, at, at, at).run();
    await ins("old", "2023-11-01");
    await ins("new", "2023-11-02");
    await env.DB.prepare("INSERT INTO daily_counts VALUES ('2026-10-31', '*', 3, ?, 'guest', ?, 'guest'), ('2026-11-01', '*', 1, ?, 'guest', ?, 'guest')").bind(at, at, at, at).run();
    await env.DB.prepare("INSERT INTO access_log (id, received_at, created_at, created_by, updated_at, updated_by) VALUES ('l1', '2026-08-02T03:00:00Z', ?, 'guest', ?, 'guest'), ('l2', '2026-08-03T03:00:00Z', ?, 'guest', ?, 'guest')").bind(at, at, at, at).run();
    const hist = (id, key) => env.DB.prepare(`INSERT INTO booking_changes (id, booking_id, kind, before_json, after_json, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by) VALUES (?, ?, 'info', '{"name":"山"}', '{"name":"山田"}', ?, 'admin', NULL, ?, 's', ?, 's')`).bind(id, key, at, at, at).run();
    await hist("h1", "old");
    await hist("h2", "new");
    expect(await dailyCleanup(site, env, NOW)).toEqual({ counts: 1, history: 1, pii: 1, logs: 1 });
    expect(await env.DB.prepare("SELECT before_json, after_json FROM booking_changes WHERE id = 'h1'").first()).toEqual({ before_json: null, after_json: null });
    expect((await env.DB.prepare("SELECT after_json FROM booking_changes WHERE id = 'h2'").first()).after_json).toContain("山田");
    const old = await env.DB.prepare("SELECT name, tel, email, inn_memo, total, status, pii_deleted_at, updated_by FROM bookings WHERE id = 'old'").first();
    expect(old).toMatchObject({ name: null, tel: null, email: null, inn_memo: null, total: 10000, status: "booked", updated_by: "system" });
    expect(old.pii_deleted_at).toBeTruthy();
    expect((await env.DB.prepare("SELECT name FROM bookings WHERE id = 'new'").first()).name).toBe("山田");
    expect((await env.DB.prepare("SELECT id FROM access_log").all()).results).toEqual([{ id: "l2" }]); // 2026-11-01 の90日前は 2026-08-03 03:00
  });
});

describe("HTTPS だけ", () => {
  it("HTTP の読み取りは HTTPS へ移し、書き込みは断る。HTTPS の応答には HSTS を付ける", async () => {
    const get = await worker.fetch(new Request("http://yoyaku.example.jp/api?action=ping"), env, {});
    expect(get.status).toBe(301);
    expect(get.headers.get("Location")).toBe("https://yoyaku.example.jp/api?action=ping");
    const post = await worker.fetch(new Request("http://yoyaku.example.jp/api", { method: "POST", headers: { Origin: STUDIO }, body: "{}" }), env, {});
    expect(post.status).toBe(403);
    const ok = await call("/api?action=ping", { headers: { Origin: STUDIO } });
    expect(ok.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });
});

describe("月ごとの数字（2026-10-13 宿の依頼）", () => {
  const at = new Date().toISOString();
  const put = (id, source, status, checkin, checkout, nights, guests, pay, name = "山田 花子") =>
    env.DB.prepare("INSERT INTO bookings (id, source, status, checkin, checkout, nights, guests, per_person, total, discount, pay, price_version, name, mail_guest, mail_inn, received_at, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,0,?,0,?,'r1',?,'none','none',?,?,'t',?,'t')")
      .bind(id, source, status, checkin, checkout, nights, guests, pay, pay, name, at, at, at)
      .run();

  it("泊まる月（チェックインの月）ごとに、ネット予約・電話・LINE・合計の件数・人数・泊数・金額を出す。キャンセルは件数だけ・試しの予約は入れない", async () => {
    await put("261001-0001", "web", "booked", "2026-10-30", "2026-11-02", 3, 2, 27000); // 月をまたぐ → 10月に全部
    await put("261001-0002", "manual", "booked", "2026-10-20", "2026-10-21", 1, 1, 5500);
    await put("261001-0003", "web", "cancelled", "2026-10-25", "2026-10-26", 1, 2, 10000);
    await put("261001-0004", "web", "booked", "2026-10-21", "2026-10-22", 1, 1, 5500, "テスト アントロン");
    await put("261001-0005", "manual", "booked", "2026-10-22", "2026-10-23", 1, 1, 5500, "試験 花子");
    await put("261001-0006", "web", "booked", "2026-11-05", "2026-11-07", 2, 1, 11000, null); // 個人情報を消した予約も数える
    const c = await login();
    const j = await (await adminGet(c, "/stats")).json();
    expect(j.ok).toBe(true);
    const by = Object.fromEntries(j.months.map((m) => [m.month, m]));
    expect(by["2026-10"]).toEqual({
      month: "2026-10",
      web: { count: 1, guests: 2, nights: 3, pay: 27000 },
      manual: { count: 1, guests: 1, nights: 1, pay: 5500 },
      total: { count: 2, guests: 3, nights: 4, pay: 32500 },
      cancelled: 1,
    });
    expect(by["2026-11"].total).toEqual({ count: 1, guests: 1, nights: 2, pay: 11000 });
    expect(by["2026-11"].cancelled).toBe(0);
  });

  it("受付を始めた月から受付期間の最後の月まで、0件の月も0で並べる", async () => {
    const c = await login();
    const j = await (await adminGet(c, "/stats")).json();
    const last = new Date(NOW.getTime() + 9 * 3600000 + site.bookingDaysAhead * 86400000).toISOString().slice(0, 7);
    expect(j.months[0].month).toBe(site.bookingStart.slice(0, 7));
    expect(j.months.at(-1).month).toBe(last);
    for (let i = 1; i < j.months.length; i++) {
      const [y, m] = j.months[i - 1].month.split("-").map(Number);
      expect(j.months[i].month).toBe(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`);
    }
    const zero = { count: 0, guests: 0, nights: 0, pay: 0 };
    expect(j.months[1]).toEqual({ month: j.months[1].month, web: zero, manual: zero, total: zero, cancelled: 0 });
  });

  it("ログインしていなければ見られない", async () => {
    expect((await call("/admin/api/stats")).status).toBe(401);
  });
});

describe("見た目の設定（基本設計書 追補 2026-10-13 S-03）と予約画面の配り方（S-04）", () => {
  const themeOfAdmin = async (c) => /<html lang="ja" data-theme="(\w+)"/.exec(await (await call("/admin", { headers: { Cookie: c } })).text())?.[1];
  const themeOfEmbed = async () => /"theme":"(\w+)"/.exec(await (await call("/embed.js")).text())?.[1];

  it("行が無いときは朱。管理画面も予約画面も朱で出る", async () => {
    const c = await login();
    expect((await (await adminGet(c, "/settings")).json())).toEqual({ ok: true, theme: "shu", history: [] });
    expect(await themeOfAdmin(c)).toBe("shu");
    expect(await themeOfEmbed()).toBe("shu");
  });

  it("色を変えると、管理画面と予約画面の両方の色が変わり、変更履歴に だれが・いつ・前→後 が残る（FK で利用者と設定を指す）", async () => {
    const c = await login();
    const j = await (await adminPost(c, "/settings", { theme: "green" })).json();
    expect(j.ok).toBe(true);
    expect(j.theme).toBe("green");
    expect(j.history).toEqual([{ key: "theme", before: "shu", after: "green", at: NOW.toISOString(), by: "運用者" }]);
    expect(await themeOfAdmin(c)).toBe("green");
    expect(await themeOfEmbed()).toBe("green");
    await adminPost(c, "/settings", { theme: "blue" });
    expect(await themeOfEmbed()).toBe("blue");
    const h = (await (await adminGet(c, "/settings")).json()).history;
    expect(h.map((x) => `${x.before}→${x.after}`).sort()).toEqual(["green→blue", "shu→green"]);
    const fk = await env.DB.prepare("SELECT c.setting_key, u.email FROM setting_changes c JOIN admin_users u ON u.id = c.changed_by_user_id JOIN site_settings s ON s.setting_key = c.setting_key").all();
    expect(fk.results).toHaveLength(2);
    expect(fk.results[0].email).toBe("operator@example.com");
  });

  it("知らない値は断り、何も残さない。同じ色は「変わったところがありません」。ログインしていなければ 401", async () => {
    const c = await login();
    for (const bad of ["red", "", "SHU", null]) {
      const res = await adminPost(c, "/settings", { theme: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toEqual({ theme: "色を選んでください" });
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM setting_changes").first()).n).toBe(0);
    expect(await themeOfEmbed()).toBe("shu");
    expect((await (await adminPost(c, "/settings", { theme: "shu" })).json()).error).toBe("変わったところがありません");
    expect((await call("/admin/api/settings")).status).toBe(401);
    expect((await call("/admin/api/settings", { method: "POST", headers: { "X-Ybk": "1", "Content-Type": "application/json" }, body: JSON.stringify({ theme: "green" }) })).status).toBe(401);
  });

  it("D1 の値が壊れていても（知らない色）朱で出す", async () => {
    const at = NOW.toISOString();
    await env.DB.prepare("INSERT INTO site_settings (setting_key, value, created_at, created_by, updated_at, updated_by) VALUES ('theme', 'purple', ?, 't', ?, 't')").bind(at, at).run();
    expect(await themeOfEmbed()).toBe("shu");
  });

  it("/embed.js：入力チェック・施設の文面・この Worker の住所を入れて配る。宛先・アカウントは入れない。毎回確かめてもらう（no-cache）", async () => {
    const res = await call("/embed.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    const js = await res.text();
    expect(js).toContain("window.YBK_FIELDS = (function");
    expect(js).toContain('"api":"https://yoyaku.example.jp/api"');
    expect(js).toContain("/vendor/bootstrap-5.3.3/bootstrap.min.css");
    expect(js).toContain(JSON.stringify(site.cancelPolicy));
    for (const secret of [...site.admins, site.mail.notifyTo, site.mail.from]) expect(js).not.toContain(secret);
    // 前の埋め込み（web/embed.html）が使う API・validate.js はそのまま
    expect((await (await call("/api?action=ping", { headers: { Origin: STUDIO } })).json()).ok).toBe(true);
    expect((await call("/validate.js")).status).toBe(200);
  });

  it("管理画面は Bootstrap と Bootstrap Icons を同じ Worker の /vendor/ から読む（CDN に頼らない）", async () => {
    const c = await login();
    const html = await (await call("/admin", { headers: { Cookie: c } })).text();
    expect(html).toContain('href="/vendor/bootstrap-5.3.3/bootstrap.min.css"');
    expect(html).toContain('href="/vendor/bootstrap-icons-1.11.3/bootstrap-icons.min.css"');
    expect(html).toContain('src="/vendor/bootstrap-5.3.3/bootstrap.bundle.min.js"');
    expect(html).not.toMatch(/cdn\.|jsdelivr|unpkg/);
  });
});

describe("金額の手入力（要件差分 第2版 2026-10-14・基本設計書 金額の手入力）", () => {
  const row = (id) => env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
  const manual = (c, over = {}) => adminPost(c, "/manual", { checkin: "2027-02-01", nights: 1, guests: 2, name: "常連", ...over });

  it("[HA-1・H-2・H-4] 電話・LINE の予約を手入力の合計 8,000円で登録すると、お支払いが 8,000円（割引なし）。料金表の 1名1泊 は残す", async () => {
    const c = await login();
    const r = await (await manual(c, { priceMode: "custom", customPay: 8000 })).json();
    expect(r.ok).toBe(true);
    expect(await row(r.id)).toMatchObject({ price_mode: "custom", per_person: 5000, total: 8000, discount: 0, pay: 8000 });
  });

  it("[HA-2・HA-3・H-3・H-5] 合計 0円・1名・1泊も登録でき、空きを1つ使い、月ごとの数字の電話・LINE に人数1・金額0で入る。8,000円の予約はその月に 8,000円で入る", async () => {
    const c = await login();
    const z = await (await manual(c, { guests: 1, priceMode: "custom", customPay: 0 })).json();
    expect(z.ok).toBe(true);
    expect(await row(z.id)).toMatchObject({ price_mode: "custom", pay: 0 });
    expect((await (await adminGet(c, "/month?m=2027-02")).json()).days["2027-02-01"]).toMatchObject({ count: 1, guests: 1 });
    await manual(c, { checkin: "2027-02-05", priceMode: "custom", customPay: 8000 });
    const s = (await (await adminGet(c, "/stats")).json()).months.find((m) => m.month === "2027-02");
    expect(s.manual).toEqual({ count: 2, guests: 3, nights: 2, pay: 8000 });
  });

  it("[HA-4・H-1] 予約画面からの予約は手入力にできない（400・何も変わらない）", async () => {
    const c = await login();
    const no = await webBooking();
    const before = await row(no);
    const res = await adminPost(c, "/change", { id: no, checkin: before.checkin, nights: before.nights, guests: before.guests, priceMode: "custom", customPay: 3000 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("予約画面からの予約は、金額を手入力にできません");
    expect(await row(no)).toMatchObject({ price_mode: "list", pay: before.pay, updated_at: before.updated_at });
  });

  it("[HA-5・H-6] 手入力 12,000円の予約を 1泊→3泊・2名→3名に変えても、割引なしで 12,000円のまま。合計を打ち直すとその金額", async () => {
    const c = await login();
    const r = await (await manual(c, { priceMode: "custom", customPay: 12000 })).json();
    expect((await adminPost(c, "/change", { id: r.id, checkin: "2027-02-01", nights: 3, guests: 3, priceMode: "custom", customPay: 12000 })).status).toBe(200);
    expect(await row(r.id)).toMatchObject({ nights: 3, guests: 3, price_mode: "custom", total: 12000, discount: 0, pay: 12000 });
    expect((await adminPost(c, "/change", { id: r.id, checkin: "2027-02-01", nights: 3, guests: 3, priceMode: "custom", customPay: 20000 })).status).toBe(200);
    expect(await row(r.id)).toMatchObject({ pay: 20000, total: 20000, discount: 0 });
  });

  it("[HA-6・H-5] 金額だけを変えると変更履歴は「金額の変更」で、だれが・いつ・前後の合計と入れ方が残る。日付と一緒なら「日付・人数の変更」に入れ方も入る", async () => {
    const c = await login();
    const r = await (await manual(c)).json();
    expect((await adminPost(c, "/change", { id: r.id, checkin: "2027-02-01", nights: 1, guests: 2, priceMode: "custom", customPay: 8000 })).status).toBe(200);
    await adminPost(c, "/change", { id: r.id, checkin: "2027-02-02", nights: 1, guests: 2, priceMode: "custom", customPay: 8000 });
    const h = (await (await adminGet(c, "/booking?id=" + r.id)).json()).history;
    expect(h[0].after).toMatchObject({ price_mode: "list", pay: 10000 });
    expect(h[1]).toMatchObject({ kind: "price", by: "運用者", at: NOW.toISOString(), before: { price_mode: "list", pay: 10000 }, after: { price_mode: "custom", pay: 8000 } });
    expect(h[2]).toMatchObject({ kind: "change", before: { checkin: "2027-02-01", price_mode: "custom" }, after: { checkin: "2027-02-02", price_mode: "custom", pay: 8000 } });
  });

  it("[HA-7・H-7] 手入力を解除すると、予約したときの料金表で計算し直す（3泊なら連泊割引あり）", async () => {
    const c = await login();
    const r = await (await manual(c, { nights: 3, priceMode: "custom", customPay: 4000 })).json();
    const w2 = createWorker(siteWith({ price: { current: "r2", tables: { ...site.price.tables, r2: { tiers: [{ min: 1, max: 999, price: 9999 }], longStay: [] } } } }), { now: () => NOW });
    const res = await call("/admin/api/change", { method: "POST", headers: { Cookie: c, "X-Ybk": "1", "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, checkin: "2027-02-01", nights: 3, guests: 2, priceMode: "list" }) }, w2);
    expect(res.status).toBe(200);
    expect(await row(r.id)).toMatchObject({ price_mode: "list", per_person: 5000, total: 30000, discount: 3000, pay: 27000 });
  });

  it("[HA-8] 金額の入れ方を送らなければ定価（いままでと同じ金額）", async () => {
    const c = await login();
    const r = await (await manual(c, { nights: 3 })).json();
    expect(await row(r.id)).toMatchObject({ price_mode: "list", total: 30000, discount: 3000, pay: 27000 });
    const no = await webBooking();
    expect((await row(no)).price_mode).toBe("list");
  });

  it("合計金額の入力チェック：手入力で空・負・小数・10,000,000・文字は断り、0 と 9,999,999 は通る。入れ方が list・custom 以外も断る", async () => {
    const c = await login();
    for (const bad of ["", null, -1, 1.5, 10000000, "abc"]) {
      const res = await manual(c, { priceMode: "custom", customPay: bad });
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()).errors)).toEqual(["customPay"]);
    }
    for (const ok of [0, 9999999, "8000"]) expect((await manual(c, { priceMode: "custom", customPay: ok })).status).toBe(200);
    const res = await manual(c, { priceMode: "free" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual({ priceMode: "金額の入れ方が正しくありません" });
    // 定価のときの合計金額は見ない（保存もしない）
    const r = await (await manual(c, { priceMode: "list", customPay: "abc" })).json();
    expect(await row(r.id)).toMatchObject({ price_mode: "list", pay: 10000 });
  });

  it("[H-6] 手入力の予約に、金額の入れ方を送らない変更（前の版の画面）が来ても、定価に戻さず合計のまま（qa 2026-10-15）", async () => {
    const c = await login();
    const r = await (await manual(c, { priceMode: "custom", customPay: 12000 })).json();
    expect((await adminPost(c, "/change", { id: r.id, checkin: "2027-02-01", nights: 3, guests: 3 })).status).toBe(200);
    expect(await row(r.id)).toMatchObject({ nights: 3, guests: 3, price_mode: "custom", total: 12000, discount: 0, pay: 12000 });
    // 空白だけの入れ方も「送らない」と同じ（コードレビュー 2026-10-15）
    expect((await adminPost(c, "/change", { id: r.id, checkin: "2027-02-01", nights: 2, guests: 3, priceMode: "  " })).status).toBe(200);
    expect(await row(r.id)).toMatchObject({ nights: 2, price_mode: "custom", pay: 12000 });
  });

  it("変わったところが無ければ断る（手入力の合計も同じとき）", async () => {
    const c = await login();
    const r = await (await manual(c, { priceMode: "custom", customPay: 8000 })).json();
    const res = await adminPost(c, "/change", { id: r.id, checkin: "2027-02-01", nights: 1, guests: 2, priceMode: "custom", customPay: 8000 });
    expect(res.status).toBe(400);
  });
});
