-- 変更履歴を、予約の履歴と受付条件の履歴に分け、FK（外部キー）でつなぐ
-- 変更した人は、管理画面の利用者への FK（changed_by_user_id）と、どこからの変更か（changed_via：admin 管理画面／guest 予約画面／system 自動）の2列で持つ
-- 日の受付条件・定休日の行は消さない（「決まりを外す」は中身を空にする）。履歴の FK が、消えた行を指さないため
-- FK は表の終わりに書く（MySQL は列の後ろに書いた REFERENCES を無視するため）

CREATE TABLE IF NOT EXISTS booking_changes (
  id VARCHAR(36) PRIMARY KEY,
  booking_id VARCHAR(16) NOT NULL,     -- 予約番号
  kind VARCHAR(20) NOT NULL,           -- create／cancel／change／info／memo
  before_json TEXT,                    -- 前（日付・泊数・人数・料金・状態、お客様の情報を直したときはその項目。メモの中身は入れない）
  after_json TEXT,
  changed_at VARCHAR(32) NOT NULL,
  changed_via VARCHAR(10) NOT NULL,    -- admin／guest／system
  changed_by_user_id VARCHAR(36),      -- 管理画面からの変更だけ入る
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (changed_by_user_id) REFERENCES admin_users(id)
);
CREATE INDEX booking_changes_booking ON booking_changes(booking_id);

CREATE TABLE IF NOT EXISTS rule_changes (
  id VARCHAR(36) PRIMARY KEY,
  day VARCHAR(10),                     -- 日の受付条件を変えたとき（weekday とどちらか一方）
  weekday INTEGER,                     -- 定休日を変えたとき
  before_json TEXT,
  after_json TEXT,
  changed_at VARCHAR(32) NOT NULL,
  changed_via VARCHAR(10) NOT NULL,
  changed_by_user_id VARCHAR(36),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (day) REFERENCES day_rules(day),
  FOREIGN KEY (weekday) REFERENCES weekly_rules(weekday),
  FOREIGN KEY (changed_by_user_id) REFERENCES admin_users(id)
);
CREATE INDEX rule_changes_at ON rule_changes(changed_at);

-- 前の変更履歴（change_history）から移す。指す行がもう無いもの（消した日の受付条件）は移さない
INSERT INTO booking_changes (id, booking_id, kind, before_json, after_json, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by)
SELECT h.id, h.target_key, h.kind, h.before_json, h.after_json, h.changed_at,
       CASE WHEN h.changed_by IN ('guest', 'system') THEN h.changed_by ELSE 'admin' END, u.id,
       h.created_at, h.created_by, h.updated_at, h.updated_by
FROM change_history h LEFT JOIN admin_users u ON u.google_sub = h.changed_by
WHERE h.target = 'booking' AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = h.target_key);

INSERT INTO rule_changes (id, day, weekday, before_json, after_json, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by)
SELECT h.id, h.target_key, NULL, h.before_json, h.after_json, h.changed_at,
       CASE WHEN h.changed_by IN ('guest', 'system') THEN h.changed_by ELSE 'admin' END, u.id,
       h.created_at, h.created_by, h.updated_at, h.updated_by
FROM change_history h LEFT JOIN admin_users u ON u.google_sub = h.changed_by
WHERE h.target = 'day_rule' AND EXISTS (SELECT 1 FROM day_rules d WHERE d.day = h.target_key);

INSERT INTO rule_changes (id, day, weekday, before_json, after_json, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by)
SELECT h.id, NULL, CAST(h.target_key AS INTEGER), h.before_json, h.after_json, h.changed_at,
       CASE WHEN h.changed_by IN ('guest', 'system') THEN h.changed_by ELSE 'admin' END, u.id,
       h.created_at, h.created_by, h.updated_at, h.updated_by
FROM change_history h LEFT JOIN admin_users u ON u.google_sub = h.changed_by
WHERE h.target = 'weekly_rule' AND EXISTS (SELECT 1 FROM weekly_rules w WHERE w.weekday = CAST(h.target_key AS INTEGER));

DROP TABLE change_history;
