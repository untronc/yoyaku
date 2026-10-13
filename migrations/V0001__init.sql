-- 予約システム（リリース2）の表。D1 は施設ごとに1つなので、施設の列は持たない
-- 汎用 SQL で書く（SQLite・PostgreSQL・MySQL で同じ文が通る形。チャットボットの docs/release.md の「マイグレーション」と同じ決まり）
-- どの表にも監査項目の4つを持つ。監査専用で、業務の日時・人とは兼ねない。人は Google のアカウントID（sub）／guest（予約画面）／system（自動の処理）
-- 日時は ISO 8601（UTC）の文字、日付は YYYY-MM-DD の文字、金額は円の整数

-- 予約1件
CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(16) PRIMARY KEY,         -- 予約番号（261011-4821 の形。リリース1と同じ）
  source VARCHAR(10) NOT NULL,        -- web（予約画面）／manual（電話・LINE で宿が登録）
  status VARCHAR(10) NOT NULL,        -- booked（予約）／cancelled（キャンセル）
  checkin VARCHAR(10) NOT NULL,
  checkout VARCHAR(10) NOT NULL,
  nights INTEGER NOT NULL,
  guests INTEGER NOT NULL,
  per_person INTEGER NOT NULL,        -- 1名1泊
  total INTEGER NOT NULL,             -- 料金
  discount INTEGER NOT NULL,          -- 連泊割引
  pay INTEGER NOT NULL,               -- お支払い
  price_version VARCHAR(20) NOT NULL, -- 計算に使った料金表の版（日付・人数の変更で、予約したときの料金表で計算し直すため）
  name TEXT,                          -- 以下、お客様の個人情報。チェックアウトから3年で消す（pii_deleted_at）
  tel TEXT,
  email TEXT,
  address TEXT,
  arrival TEXT,
  note TEXT,
  inn_memo TEXT,                      -- 宿のメモ（お客様には見せない）
  mail_guest TEXT,                    -- 予約確認メール：sent／failed: 理由／none
  mail_inn TEXT,                      -- 予約通知メール：同上
  received_at VARCHAR(32) NOT NULL,   -- 受付日時
  cancelled_at VARCHAR(32),           -- キャンセルした日時
  pii_deleted_at VARCHAR(32),         -- 個人情報を消した日時
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);
CREATE INDEX bookings_stay ON bookings(status, checkin, checkout);
CREATE INDEX bookings_checkout ON bookings(checkout);

-- 日・期間の受付条件（決まりを入れた日だけ1行）
CREATE TABLE IF NOT EXISTS day_rules (
  day VARCHAR(10) PRIMARY KEY,
  stop INTEGER,                       -- 1＝受付停止／0＝この日は受ける（定休日を外す）／空＝決めない
  limit_count INTEGER,                -- その日の受付件数の上限（空なら設定の既定値）
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- 定休日（曜日ごと）
CREATE TABLE IF NOT EXISTS weekly_rules (
  weekday INTEGER PRIMARY KEY,        -- 0＝日〜6＝土。その曜日の夜は泊まれない
  stop INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- 変更履歴（予約・受付条件を変えるたびに1行。消さない）
CREATE TABLE IF NOT EXISTS change_history (
  id VARCHAR(36) PRIMARY KEY,
  target VARCHAR(20) NOT NULL,        -- booking／day_rule／weekly_rule
  target_key VARCHAR(36) NOT NULL,    -- 予約番号・日付・曜日
  kind VARCHAR(20) NOT NULL,          -- create／cancel／change／memo／rule
  before_json TEXT,                   -- 前（日付・泊数・人数・料金・状態・受付条件の値だけ。氏名・連絡先・メモの中身は入れない）
  after_json TEXT,
  changed_at VARCHAR(32) NOT NULL,
  changed_by VARCHAR(64) NOT NULL,    -- アカウントID／guest
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);
CREATE INDEX change_history_target ON change_history(target, target_key);

-- 管理画面の利用者（許可は施設の設定ファイルのメールアドレス。最初のログインでアカウントIDと名前が入る）
CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  google_sub VARCHAR(64),
  display_name VARCHAR(100) NOT NULL,
  active INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);
CREATE UNIQUE INDEX admin_users_sub ON admin_users(google_sub);
CREATE UNIQUE INDEX admin_users_email ON admin_users(email);

-- 不正利用対策の数（受付日・日本時間 × 印。印は * ＝全体、ほかは連絡先の SHA-256 の先頭。メールアドレス・電話番号そのものは残さない）
CREATE TABLE IF NOT EXISTS daily_counts (
  day VARCHAR(10) NOT NULL,
  mark VARCHAR(20) NOT NULL,
  n INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  PRIMARY KEY (day, mark)
);

-- 予約画面の操作ログ（個人情報なし。リリース1のシート「アクセス記録」と同じ項目）
CREATE TABLE IF NOT EXISTS access_log (
  id VARCHAR(36) PRIMARY KEY,
  received_at VARCHAR(32) NOT NULL,
  client_at VARCHAR(30),
  visit_id VARCHAR(20),
  action VARCHAR(20),
  result VARCHAR(10),
  ms INTEGER,
  error VARCHAR(300),
  detail VARCHAR(200),
  width VARCHAR(10),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);
CREATE INDEX access_log_received ON access_log(received_at);
