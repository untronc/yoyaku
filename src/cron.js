// 1日1回の後片付け（Cron Trigger）
//   ・前日までの不正利用対策の数を消す
//   ・site.accessLogDays 日を過ぎた操作ログを消す（基本設計書 4節の 5）
//   ・お客様の個人情報と流入元は消さない（2026-10-19 要件差分「個人情報の削除をやめる」。期限を決めずに残す）
import { todayJst, ymd } from "./dates.js";

export async function dailyCleanup(site, env, now = new Date()) {
  const db = env.DB, today = ymd(todayJst(now));
  const res = await db.batch([
    db.prepare("DELETE FROM daily_counts WHERE day < ?").bind(today),
    db.prepare("DELETE FROM access_log WHERE received_at < ?").bind(new Date(now.getTime() - site.accessLogDays * 86400000).toISOString()),
  ]);
  return { counts: res[0].meta.changes, logs: res[1].meta.changes };
}
