# yoyaku

宿の素泊まり予約のシステム。予約画面の API と、宿が使う管理画面（Google でログイン）を、Cloudflare Workers と D1 で動かす。

## 中身
- `src/`：仕組み（予約・空きの計算・管理画面・ログイン・メール・毎日の片づけ）
- `migrations/`：D1 の表（`V0001__説明.sql` の形。SQLite・PostgreSQL・MySQL で同じ文が通る形で書く）
- `test/`：単体テスト（架空の宿の設定 `test/site.fixture.js` で流す）
- `e2e/`：受け入れ試験（手元の D1 と Edge で、予約する・取り消す・ログインの流れを画面で動かす）と、入力チェックの画面の試験
- `dev/`：手元の確認の道具（`serve-embed.mjs`：予約画面を手元の Worker で出す。`/framed` は STUDIO の枠の形）
- `public/`：Worker の静的ファイル。`public/vendor/` は npm で入れた Bootstrap 5.3.3・Bootstrap Icons を `dev/copy-vendor.mjs` が写した物（npm install のたびに自動。Git に入れない）
- `sites/<施設>/`：施設ごとの設定（料金・受付の決まり・文面・メールの宛先・D1）。公開しない（`.gitignore`）

## 流し方
Node 22 以上。

```
npm install --legacy-peer-deps
npm run check     # 単体テスト（入力チェックの試験 test/fields.test.js を含む）
npm run accept    # 受け入れ試験（業務の流れ。PC に Edge が要る）
npm run fields    # 入力チェックの画面の試験（予約画面と管理画面の欄に値を打つ。PC に Edge が要る。accept と同時に流さない）
npm run looks     # 見た目の確かめ（3つの色 × 予約画面4段・管理画面8画面 × 幅 375・1280px で、はみ出し・文字と地の差 4.5:1。写真は .wrangler/looks/）
```

入力チェックの正本は `src/fields.js`（項目ごとの決まりの表）。サーバーも画面（`/validate.js` で配る）もここで判定し、試験の値もここから作る（`test/field-cases.js`）。

## 予約画面の配り方
STUDIO の埋め込みには `<div id="ybk" data-privacy="プライバシーポリシーの URL"></div><script src="https://<Worker>/embed.js"></script>` の2行だけを貼る。画面・色・入力チェックは Worker が `/embed.js`（`src/embed-page.js`）で配り、Bootstrap は同じ Worker の `/vendor/…`（静的ファイル）から読む。画面や色を変えても STUDIO の差し替えは要らない。枠（iframe）の中では上の帯と下のボタンを固定せず、高さ（ybk-h）・先頭へ（ybk-top）・GA4（ybk）を親へ知らせる。前の埋め込み（web/embed.html を丸ごと貼る形）も API と `/validate.js` はそのまま使える。

## 設定（画面の色）
管理画面の「設定」で、朱（既定）・緑・青から選ぶ。D1 の `site_settings`（行が無ければ朱）に入れ、`setting_changes` に だれが・いつ・前→後 を残す。管理画面はすぐ、予約画面は次に開いたときから変わる。色の決まりは `src/theme.js`（主の色1つ＋灰＋白）。

## 施設を足す
施設を足すときは `sites/<施設>/` に `site.config.js`（`src/config.js` の項目）・`index.js`・`wrangler.jsonc`（`"assets": { "directory": "../../public" }` を入れる）を置く。

## ライセンス
PolyForm Noncommercial License 1.0.0（`LICENSE`）。商用の利用はできない。商用で使いたいときは untronc（https://untronc.jp ）へ。
