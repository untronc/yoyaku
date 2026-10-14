-- 金額の手入力（要件差分 第2版 2026-10-14・基本設計書 金額の手入力 3-1）
-- 金額の入れ方：list＝定価（料金表＋連泊割引）／custom＝手入力（電話・LINE の予約だけ。合計は total・pay に入れ、割引は 0）
-- いまある予約は全部 list になる。SQLite・PostgreSQL・MySQL で同じ文が通る形（docs の「マイグレーション」）
ALTER TABLE bookings ADD COLUMN price_mode VARCHAR(10) NOT NULL DEFAULT 'list';
