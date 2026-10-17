-- ネット予約の流入元（要件差分 予約の流入元 2026-10-17・基本設計書 予約の流入元 3-1）
-- 参照元のドメイン・utm の3つ・ランディングページ・直前のページ。取れなかった項目は NULL。電話・LINE の予約は NULL のまま
-- 3年たった予約は、個人情報と一緒に消す（src/cron.js）。SQLite・PostgreSQL・MySQL で同じ文が通る形（docs の「マイグレーション」）
ALTER TABLE bookings ADD COLUMN src_referrer VARCHAR(255) NULL;
ALTER TABLE bookings ADD COLUMN src_utm_source VARCHAR(100) NULL;
ALTER TABLE bookings ADD COLUMN src_utm_medium VARCHAR(100) NULL;
ALTER TABLE bookings ADD COLUMN src_utm_campaign VARCHAR(100) NULL;
ALTER TABLE bookings ADD COLUMN src_landing VARCHAR(300) NULL;
ALTER TABLE bookings ADD COLUMN src_prev VARCHAR(300) NULL;
