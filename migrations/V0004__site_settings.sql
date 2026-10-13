-- 施設の見た目の設定（基本設計書 追補 2026-10-13「Bootstrap と見た目の設定」S-03）
-- いまは画面の色（setting_key = 'theme'、値は shu 朱／green 緑／blue 青）の1行だけ。行が無いときは朱（既定）
-- 列の名前：基本設計の key は MySQL の予約語なので setting_key にした（汎用 SQL で同じ文が通るように）
-- 行は消さない（変更履歴の FK が指すため）。FK は表の終わりに書く（MySQL は列の後ろに書いた REFERENCES を無視するため）

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key VARCHAR(40) PRIMARY KEY,
  value VARCHAR(200) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- 設定の変更履歴（だれが・いつ・前→後）。変えた人は管理画面の利用者への FK
CREATE TABLE IF NOT EXISTS setting_changes (
  id VARCHAR(36) PRIMARY KEY,
  setting_key VARCHAR(40) NOT NULL,
  before_value VARCHAR(200),           -- 行が無かった（既定のまま）ときは空
  after_value VARCHAR(200) NOT NULL,
  changed_by_user_id VARCHAR(36) NOT NULL,
  changed_at VARCHAR(32) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (setting_key) REFERENCES site_settings(setting_key),
  FOREIGN KEY (changed_by_user_id) REFERENCES admin_users(id)
);
CREATE INDEX setting_changes_at ON setting_changes(changed_at);
