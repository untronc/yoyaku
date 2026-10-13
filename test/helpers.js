// テストで使うもの：架空の宿の設定（test/site.fixture.js）、決まった「今」、表を空にする、ログインの Cookie
import { env } from "cloudflare:test";
import { sign } from "../src/auth.js";
import { defineSite } from "../src/config.js";
import base from "./site.fixture.js";

// 架空の宿の設定を使う（決まりの値はリリース1と同じ。施設の値が同じかは sites/<施設>/site.config.test.js で確かめる）
export const site = base;
export const siteWith = (over) => defineSite({ ...site, ...over });
// 2026-11-01（日）12:00 日本時間
export const NOW = new Date("2026-11-01T03:00:00Z");

export async function reset() {
  // FK があるので、指す側の表から先に消す
  for (const t of ["booking_changes", "rule_changes", "setting_changes", "site_settings", "bookings", "day_rules", "weekly_rules", "admin_users", "daily_counts", "access_log"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
}

export function bookBody(over = {}) {
  return { action: "book", checkin: "2026-11-20", nights: 2, guests: 3, name: "山田 花子", tel: "090-1234-5678", email: "hanako@example.com", address: "東京都千代田区", arrival: "15:00〜16:00", note: "", agree: true, privacyAgree: true, ...over };
}

/** 管理画面の利用者を1人入れて、ログインの Cookie を返す */
export async function login(email = "operator@example.com", sub = "sub-op", name = "運用者") {
  const at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO admin_users (id, email, google_sub, display_name, active, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,1,?,?,?,?)")
    .bind(crypto.randomUUID(), email, sub, name, at, sub, at, sub)
    .run();
  return "ybk_s=" + encodeURIComponent(await sign(env.SESSION_SECRET, { sub, exp: Date.now() + 3600000 }));
}

export const okMail = () => new Response(JSON.stringify({ id: "m1" }), { status: 200 });
