import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { monthCalendar, price, quote } from "../src/rules.js";
import { NOW, reset, site } from "./helpers.js";

const put = (sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const at = NOW.toISOString();

beforeEach(reset);

describe("料金（リリース1と同じ）", () => {
  it.each([
    [1, 1, { perPerson: 5500, total: 5500, discount: 0, pay: 5500 }],
    [3, 2, { perPerson: 5000, total: 30000, discount: 0, pay: 30000 }],
    [2, 3, { perPerson: 5000, total: 30000, discount: 3000, pay: 27000 }],
    [4, 7, { perPerson: 4500, total: 126000, discount: 18900, pay: 107100 }],
  ])("[R4-1・R6-1] %i名 %i泊", (g, n, want) => expect(price(site, g, n)).toEqual(want));
});

describe("月の表（予約画面）", () => {
  it("[R4-1・R6-1] リリース1と同じ形で返し、今日以前・180日より先は受付期間の外", async () => {
    const r = await monthCalendar(site, env.DB, "2026-11", NOW);
    expect(r.ok).toBe(true);
    expect(r.days["2026-11-01"]).toEqual({ rooms: 0, closed: true });
    expect(r.days["2026-11-02"]).toEqual({ rooms: 3, closed: false });
    const far = await monthCalendar(site, env.DB, "2027-05", NOW);
    expect(far.days["2027-04-30"]).toBeUndefined();
    expect(far.days["2027-05-01"].closed).toBe(true); // 180日先は 2027-04-30
  });

  it("[R5-7・R5-14・R5-15・R5-16・R5-17・R6-8] 予約（電話・LINE も）を数え、受付停止・定休日・件数の上限・この日は受ける を反映する", async () => {
    await put(`INSERT INTO bookings (id, source, status, checkin, checkout, nights, guests, per_person, total, discount, pay, price_version, received_at, created_at, created_by, updated_at, updated_by)
      VALUES ('a', 'manual', 'booked', '2026-11-05', '2026-11-07', 2, 2, 5000, 20000, 0, 20000, 'r1', ?, ?, 's', ?, 's'),
             ('b', 'web', 'cancelled', '2026-11-05', '2026-11-06', 1, 2, 5000, 10000, 0, 10000, 'r1', ?, ?, 's', ?, 's')`, at, at, at, at, at, at);
    await put("INSERT INTO weekly_rules (weekday, stop, created_at, created_by, updated_at, updated_by) VALUES (2, 1, ?, 's', ?, 's')", at, at);
    await put(`INSERT INTO day_rules (day, stop, limit_count, created_at, created_by, updated_at, updated_by) VALUES
      ('2026-11-08', 1, NULL, ?, 's', ?, 's'), ('2026-11-09', NULL, 1, ?, 's', ?, 's'), ('2026-11-17', 0, NULL, ?, 's', ?, 's')`, at, at, at, at, at, at);
    const d = (await monthCalendar(site, env.DB, "2026-11", NOW)).days;
    expect(d["2026-11-05"].rooms).toBe(2); // キャンセルは数えない
    expect(d["2026-11-06"].rooms).toBe(2);
    expect(d["2026-11-07"].rooms).toBe(3);
    expect(d["2026-11-08"].rooms).toBe(0); // 受付停止
    expect(d["2026-11-09"].rooms).toBe(1); // 上限1件
    expect(d["2026-11-10"].rooms).toBe(0); // 火曜（定休日）
    expect(d["2026-11-17"].rooms).toBe(3); // 火曜だが「この日は受ける」
  });
});

describe("空きの確かめと料金", () => {
  it("[R4-1・R6-1] 空いていれば料金と連泊割引を返す", async () => {
    const r = await quote(site, env.DB, "2026-11-20", 3, 2, NOW);
    expect(r).toMatchObject({ ok: true, available: true, checkin: "2026-11-20", checkout: "2026-11-23", nights: 3, guests: 2, price: { pay: 27000 } });
    expect(r.longStay).toEqual(site.price.tables.r1.longStay);
  });
  it("[R5-16・R5-17] 定休日をまたぐ連泊は空きなし", async () => {
    await put("INSERT INTO weekly_rules (weekday, stop, created_at, created_by, updated_at, updated_by) VALUES (2, 1, ?, 's', ?, 's')", at, at);
    const r = await quote(site, env.DB, "2026-11-23", 2, 2, NOW); // 月・火
    expect(r).toEqual({ ok: true, available: false, message: "その日程は空きがありません。日にちか人数を変えてお試しください。" });
  });
  it("[R4-1・R6-1] 受付の範囲・人数の上限はリリース1と同じ文で断る", async () => {
    await expect(quote(site, env.DB, "2026-11-01", 1, 2, NOW)).rejects.toThrow("当日以前の日は選べません");
    await expect(quote(site, env.DB, "2026-11-20", 31, 2, NOW)).rejects.toThrow("泊数が正しくありません");
    await expect(quote(site, env.DB, "2026-11-20", 1, 20, NOW)).rejects.toThrow("20名以上のご予約は、公式LINEでご相談ください（https://line.example.jp/inn）");
  });
});
