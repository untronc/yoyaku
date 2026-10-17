// ネット予約の流入元（要件差分 予約の流入元 2026-10-17・基本設計書 予約の流入元 3-4）
// 予約画面が送る src（サイト側のコード web/site-source.html が拾った値）を、長さと形を整えて予約の列にする。
// おかしな値でも予約は断らず、その項目を空（null）にする（流入元のために予約を止めない・推測で埋めない）

const LEN = { referrer: 255, utm: 100, path: 300 };
// 制御文字を除き、前後の空白を落として長さで切る。文字列でなければ空
const text = (v, max) => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return t || null;
};
// パスは / で始まるものだけ。? と # 以降（問い合わせの値などが入りうる）は落とす
const path = (v) => {
  const t = text(v, 2000);
  if (!t || !t.startsWith("/") || t.startsWith("//")) return null;
  return t.split(/[?#]/)[0].slice(0, LEN.path) || null;
};
// 参照元はドメインの形（英数字・-・.）だけ。小文字にそろえる。自分のサイトを除くのはサイト側のコード
const domain = (v) => {
  const t = text(v, LEN.referrer);
  return t && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t) ? t.toLowerCase() : null;
};

/** 予約の列（src_*）にする。src が無い・オブジェクトでなければ全部 null */
export function sourceColumns(src) {
  const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  return {
    src_referrer: domain(s.referrer),
    src_utm_source: text(s.utm_source, LEN.utm),
    src_utm_medium: text(s.utm_medium, LEN.utm),
    src_utm_campaign: text(s.utm_campaign, LEN.utm),
    src_landing: path(s.landing),
    src_prev: path(s.prev),
  };
}

export const SOURCE_COLUMNS = Object.keys(sourceColumns(null));
