import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "../src/auth.js";
import { dailyCleanup } from "../src/cron.js";
import { createWorker } from "../src/worker.js";
import { NOW, bookBody, login, okMail, reset, site, siteWith } from "./helpers.js";

const worker = createWorker(site);
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
  const d = new Date(Date.now() + 9 * 3600000 + 20 * 86400000).toISOString().slice(0, 10);
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
    expect(j).toEqual({ ok: false, error: "月の形が正しくありません" });
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
    const w2 = createWorker(siteWith({ price: { current: "r2", tables: { ...site.price.tables, r2: { tiers: [{ min: 1, max: 999, price: 9999 }], longStay: [] } } } }));
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
    expect((await (await adminPost(c, "/info", { ...base, name: "山田 華子", tel: "090-1234-5679", address: "" })).json()).error).toBe("予約画面からの予約では、電話・メール・ご住所は消せません");
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
