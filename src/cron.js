// 1日1回の後片付け（Cron Trigger）
//   ・前日までの不正利用対策の数を消す
//   ・site.accessLogDays 日を過ぎた操作ログを消す（基本設計書 4節の 5）
//   ・チェックアウトから site.piiRetentionYears 年たった予約の個人情報を消す（件数・金額・日付・状態・経路は残す。要件 7節）。変更履歴の中の、お客様の情報を直した前と後の値も消す
import { todayJst, ymd } from "./dates.js";

export function piiCutoff(site, now) {
  const t = todayJst(now);
  const c = new Date(Date.UTC(t.getUTCFullYear() - site.piiRetentionYears, t.getUTCMonth(), t.getUTCDate()));
  return ymd(c);
}

export async function dailyCleanup(site, env, now = new Date()) {
  const db = env.DB, at = now.toISOString(), today = ymd(todayJst(now));
  const cutoff = piiCutoff(site, now);
  const stmts = [
    db.prepare("DELETE FROM daily_counts WHERE day < ?").bind(today),
    // 先に変更履歴の値を消す（下で予約に印が付くと、対象が見分けられなくなるため）
    db.prepare(
      "UPDATE booking_changes SET before_json = NULL, after_json = NULL, updated_at = ?, updated_by = 'system' WHERE kind = 'info' AND before_json IS NOT NULL AND booking_id IN (SELECT id FROM bookings WHERE checkout <= ? AND pii_deleted_at IS NULL)"
    ).bind(at, cutoff),
    db.prepare(
      "UPDATE bookings SET name = NULL, tel = NULL, email = NULL, address = NULL, arrival = NULL, note = NULL, inn_memo = NULL, src_referrer = NULL, src_utm_source = NULL, src_utm_medium = NULL, src_utm_campaign = NULL, src_landing = NULL, src_prev = NULL, pii_deleted_at = ?, updated_at = ?, updated_by = 'system' WHERE checkout <= ? AND pii_deleted_at IS NULL"
    ).bind(at, at, cutoff),
  ];
  stmts.push(db.prepare("DELETE FROM access_log WHERE received_at < ?").bind(new Date(now.getTime() - site.accessLogDays * 86400000).toISOString()));
  const res = await db.batch(stmts);
  return { counts: res[0].meta.changes, history: res[1].meta.changes, pii: res[2].meta.changes, logs: res[3].meta.changes };
}
