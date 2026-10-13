-- 予約のときのプライバシーポリシーへの同意（要件定義書 第2版）
-- 予約画面からの予約は、同意した日時とそのときのポリシーの版を持つ。電話・LINE の予約は空のまま
ALTER TABLE bookings ADD COLUMN privacy_agreed_at VARCHAR(32);
ALTER TABLE bookings ADD COLUMN privacy_version VARCHAR(40);
