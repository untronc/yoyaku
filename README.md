# yoyaku

宿の素泊まり予約のシステム。予約画面の API と、宿が使う管理画面（Google でログイン）を、Cloudflare Workers と D1 で動かす。

## 中身
- `src/`：仕組み（予約・空きの計算・管理画面・ログイン・メール・毎日の片づけ）
- `migrations/`：D1 の表（`V0001__説明.sql` の形。SQLite・PostgreSQL・MySQL で同じ文が通る形で書く）
- `test/`：単体テスト（架空の宿の設定 `test/site.fixture.js` で流す）
- `e2e/`：受け入れ試験（手元の D1 と Edge で、予約する・取り消す・ログインの流れを画面で動かす）と、入力チェックの画面の試験
- `dev/`：手元の確認の道具
- `sites/<施設>/`：施設ごとの設定（料金・受付の決まり・文面・メールの宛先・D1）。公開しない（`.gitignore`）

## 流し方
Node 22 以上。

```
npm install --legacy-peer-deps
npm run check     # 単体テスト（入力チェックの試験 test/fields.test.js を含む）
npm run accept    # 受け入れ試験（業務の流れ。PC に Edge が要る）
npm run fields    # 入力チェックの画面の試験（予約画面と管理画面の欄に値を打つ。PC に Edge が要る。accept と同時に流さない）
```

入力チェックの正本は `src/fields.js`（項目ごとの決まりの表）。サーバーも画面（`/validate.js` で配る）もここで判定し、試験の値もここから作る（`test/field-cases.js`）。

施設を足すときは `sites/<施設>/` に `site.config.js`（`src/config.js` の項目）・`index.js`・`wrangler.jsonc` を置く。

## ライセンス
PolyForm Noncommercial License 1.0.0（`LICENSE`）。商用の利用はできない。商用で使いたいときは untronc（https://untronc.jp ）へ。
