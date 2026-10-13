// 施設の見た目の設定（D1 の site_settings・setting_changes。migrations/V0004）。基本設計書 追補 2026-10-13 S-03
// いまは画面の色（theme）だけ。行が無いとき・知らない値のときは朱（既定）
import { DEFAULT_THEME, themeOf } from "./theme.js";

/** いまの画面の色（shu｜green｜blue）。D1 が読めないときも既定の朱で画面を出す */
export async function currentTheme(db) {
  try {
    const r = await db.prepare("SELECT value FROM site_settings WHERE setting_key = 'theme'").first();
    return themeOf(r?.value);
  } catch (err) {
    console.log("theme read failed", String(err?.message ?? err));
    return DEFAULT_THEME;
  }
}

/** 画面の色を変え、変更履歴に残す。変わらなければ false */
export async function setTheme(db, user, theme, at) {
  const cur = await db.prepare("SELECT value FROM site_settings WHERE setting_key = 'theme'").first();
  const before = cur ? themeOf(cur.value) : DEFAULT_THEME;
  if (before === theme) return false;
  const who = user.google_sub;
  await db.batch([
    db.prepare("INSERT INTO site_settings (setting_key, value, created_at, created_by, updated_at, updated_by) VALUES ('theme', ?, ?, ?, ?, ?) ON CONFLICT (setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
      .bind(theme, at, who, at, who),
    db.prepare("INSERT INTO setting_changes (id, setting_key, before_value, after_value, changed_by_user_id, changed_at, created_at, created_by, updated_at, updated_by) VALUES (?, 'theme', ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), cur ? cur.value : null, theme, user.id, at, at, who, at, who),
  ]);
  return true;
}

/** 設定の変更履歴（新しい順・100件まで） */
export async function settingHistory(db) {
  const { results } = await db
    .prepare("SELECT c.setting_key, c.before_value, c.after_value, c.changed_at, u.display_name, u.email FROM setting_changes c LEFT JOIN admin_users u ON u.id = c.changed_by_user_id ORDER BY c.changed_at DESC LIMIT 100")
    .all();
  return results.map((r) => ({ key: r.setting_key, before: r.before_value ? themeOf(r.before_value) : DEFAULT_THEME, after: r.after_value, at: r.changed_at, by: r.display_name || r.email || "（不明）" }));
}
