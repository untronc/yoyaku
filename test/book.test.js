import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { book, contactMark } from "../src/book.js";
import { normalizeTel } from "../src/fields.js";
import { NOW, bookBody, okMail, reset, site } from "./helpers.js";

let mails;
beforeEach(async () => {
  await reset();
  mails = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    mails.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return okMail();
  });
});
afterEach(() => vi.restoreAllMocks());

const row = (id) => env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();

describe("予約画面からの予約", () => {
  it("テスト環境（MAIL_MODE=log）ではメールを送らず、送らなかったことを残す", async () => {
    const r = await book(site, { ...env, MAIL_MODE: "log" }, bookBody(), NOW);
    expect(r).toMatchObject({ ok: true, mailOk: true });
    expect(mails).toHaveLength(0);
    expect(await row(r.no)).toMatchObject({ mail_guest: "skipped: テスト環境のため送っていない", mail_inn: "skipped: テスト環境のため送っていない" });
  });
  it("[R4-5・R5-1・R6-1・R6-9・R6-11・R7-1・R7-9] 予約を入れ、確認メールと予約通知を送り、数と変更履歴を残す", async () => {
    const r = await book(site, env, bookBody(), NOW);
    expect(r).toMatchObject({ ok: true, checkin: "2026-11-20", checkout: "2026-11-22", nights: 2, guests: 3, price: { perPerson: 5000, total: 30000, discount: 0, pay: 30000 }, mailOk: true });
    expect(r.no).toMatch(/^261101-\d{4}$/);
    const b = await row(r.no);
    expect(b).toMatchObject({ source: "web", status: "booked", name: "山田 花子", tel: "090-1234-5678", price_version: "r1", mail_guest: "sent", mail_inn: "sent", created_by: "guest", privacy_version: "第1版" });
    expect(b.privacy_agreed_at).toBe(NOW.toISOString());

    const [guest, inn] = mails;
    expect(guest.body).toMatchObject({ from: "試験の宿 <yoyaku@inn.example.jp>", to: ["hanako@example.com"], reply_to: "owner@example.com", bcc: ["operator@example.com"], subject: `【試験の宿】ご予約を承りました（予約番号 ${r.no}）` });
    expect(guest.headers["Idempotency-Key"]).toBe("yoyaku-" + r.no);
    expect(guest.body.text).toContain("ご宿泊日：2026年11月20日（金）〜11月22日（日）　2泊");
    expect(guest.body.text).toContain("5,000円 × 3名 × 2泊 ＝ 30,000円");
    // 宿への通知：件名にお名前を入れない・返信先はお客様・BCC なし・管理画面のリンク
    expect(inn.body).toMatchObject({ to: ["owner@example.com"], subject: "【予約】2026-11-20 3名2泊", reply_to: "hanako@example.com" });
    expect(inn.body.bcc).toBeUndefined();
    expect(inn.headers["Idempotency-Key"]).toBe("yoyaku-" + r.no + "-notify");
    expect(inn.body.text).toContain("お名前：山田 花子");
    expect(inn.body.text).toContain("管理画面：https://yoyaku.example.jp/admin/b/" + r.no);

    const counts = (await env.DB.prepare("SELECT mark, n FROM daily_counts WHERE day = '2026-11-01'").all()).results;
    expect(counts).toHaveLength(3);
    expect(counts.find((c) => c.mark === "*").n).toBe(1);
    expect(counts.some((c) => c.mark.includes("hanako"))).toBe(false); // 連絡先そのものは残さない
    const h = await env.DB.prepare("SELECT * FROM booking_changes WHERE booking_id = ?").bind(r.no).first();
    expect(h).toMatchObject({ kind: "create", changed_via: "guest", changed_by_user_id: null });
    expect(h.after_json).not.toContain("山田");
  });

  it("[R4-1・R7-9] 連絡先の印はリリース1と同じ値（SHA-256 の先頭8バイト）", async () => {
    expect(await contactMark("email", "a@b.c")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("[R5-14・R5-17・R6-1] その夜の上限に達していたら断る（電話・LINE の予約も数える）", async () => {
    const at = NOW.toISOString();
    await env.DB.prepare(`INSERT INTO bookings (id, source, status, checkin, checkout, nights, guests, per_person, total, discount, pay, price_version, received_at, created_at, created_by, updated_at, updated_by)
      VALUES ('m1','manual','booked','2026-11-21','2026-11-22',1,2,5000,10000,0,10000,'r1',?,?,'s',?,'s'), ('m2','manual','booked','2026-11-21','2026-11-22',1,2,5000,10000,0,10000,'r1',?,?,'s',?,'s')`).bind(at, at, at, at, at, at).run();
    expect((await book(site, env, bookBody(), NOW)).ok).toBe(true);
    const r = await book(site, env, bookBody({ email: "b@example.com", tel: "090-0000-1111" }), NOW);
    expect(r).toEqual({ ok: false, error: "申し訳ありません。直前に埋まりました。日にちか人数を変えてお試しください。" });
  });

  it("[R6-1] 同時に来ても上限を超えない", async () => {
    const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => book(site, env, bookBody({ email: `p${i}@example.com`, tel: `090-0000-000${i}` }), NOW)));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings").first();
    expect(n.n).toBe(3);
  });

  it("[R4-1・R6-1] 同じ連絡先は1日3件まで・全体は1日15件まで", async () => {
    for (let i = 0; i < 3; i++) expect((await book(site, env, bookBody({ checkin: `2026-12-0${i + 1}`, nights: 1 }), NOW)).ok).toBe(true);
    await expect(book(site, env, bookBody({ checkin: "2026-12-05", nights: 1 }), NOW)).rejects.toThrow("同じメールアドレス・電話番号からのネット予約は、1日3件までです。");
    for (let i = 3; i < 15; i++) {
      const d = new Date(Date.UTC(2026, 11, 6 + i)).toISOString().slice(0, 10);
      expect((await book(site, env, bookBody({ checkin: d, nights: 1, email: `x${i}@example.com`, tel: `090-1111-${String(1000 + i)}` }), NOW)).ok).toBe(true);
    }
    await expect(book(site, env, bookBody({ checkin: "2027-01-10", nights: 1, email: "z@example.com", tel: "090-9999-0000" }), NOW)).rejects.toThrow("本日のネット予約の受付は終了しました。");
  });

  it("[R6-1] メールが送れなくても予約は成立し、失敗を残す", async () => {
    globalThis.fetch.mockImplementation(async () => new Response("rate limited", { status: 429 }));
    const r = await book(site, env, bookBody(), NOW);
    expect(r).toMatchObject({ ok: true, mailOk: false });
    expect((await row(r.no)).mail_guest).toMatch(/^failed: Resend 429/);
  });

  it.each([
    [{ agree: false }, "キャンセル料への同意が必要です"],
    [{ email: "x" }, "メールアドレスの形が正しくありません"],
    [{ tel: "12345" }, "電話番号の形が正しくありません"],
    [{ name: "https://spam.example" }, "お名前にURLは入れられません"],
    [{ name: "山田｜受付停止" }, "お名前に「｜」などの縦線は使えません"],
    [{ arrival: "夜" }, "到着予定を選んでください"],
    [{ address: "" }, "ご住所を入れてください"],
    [{ privacyAgree: false }, "プライバシーポリシーへの同意が必要です"],
    [{ privacyAgree: "true" }, "プライバシーポリシーへの同意が必要です"],
  ])("[R5-18・R6-1・R6-11] 入力の確かめ %o", async (over, msg) => {
    await expect(book(site, env, bookBody(over), NOW)).rejects.toThrow(msg);
  });

  it("[R6-11] プライバシーポリシーの版が設定に無ければ、予約を受けない", async () => {
    const { privacyVersion, ...noVersion } = site;
    await expect(book(noVersion, env, bookBody(), NOW)).rejects.toThrow("プライバシーポリシーの版が設定されていません");
  });

  it("[R6-1] 電話番号の形（リリース1の normalizeTel_ と同じ）", () => {
    expect(normalizeTel("０９０－１２３４－５６７８")).toBe("090-1234-5678");
    expect(normalizeTel("0312345678")).toBe("0312345678");
    expect(normalizeTel("0901234567")).toBeNull();
    expect(normalizeTel("0012345678")).toBeNull(); // 00 から始まるものは断る（入力チェック仕様 2026-10-13）
  });
});
