// 入力チェックの試験の値を、src/fields.js の表から作る（単体テスト test/fields.test.js と画面の試験 e2e/fields.mjs が使う）。
// 表（項目の種類・必須・上限・禁止・選択肢・文）を変えると、作る値と期待する答えも変わる。
// 期待する文は、仕様（ClaudeCode_入力チェック仕様_2026-10-13.md）の書き方でここで組み立てる（判定のコードを使わない）
import { FORMS } from "../src/fields.js";

const DAY = 86400000;
const todayOf = (now) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const plus = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const val = (x, site) => (typeof x === "function" ? x(site) : x);
const isRequired = (f, ctx) => (f.required === "web" ? ctx.source === "web" : !!f.required);

/** フォームの「正しい値」一式（試す項目だけを差し替えて送る） */
export function baseInput(form, site, ctx) {
  const t = todayOf(ctx.now);
  const guest = { name: "山田 華子", tel: "090-1111-2222", email: "base@example.com", address: "東京都千代田区1-2-3", arrival: site.arrivalOptions[1], note: "" };
  return {
    quote: { checkin: plus(t, 19), nights: 2, guests: 3 },
    book: { checkin: plus(t, 19), nights: 2, guests: 3, ...guest, agree: true, privacyAgree: true },
    manual: { checkin: plus(t, 24), nights: 1, guests: 2, name: "佐藤 一郎", tel: "", memo: "" },
    stay: { checkin: plus(t, 24), nights: 1, guests: 2 },
    info: guest,
    memo: { memo: "布団を1組多めに" },
    me: { name: "運用者 二号" },
    rulesDay: { from: t, to: t, action: "limit", limit: 1 },
    rulesWeekly: { weekday: 2, stop: true },
    month: { month: t.slice(0, 7) },
  }[form];
}

// ----- 種類ごとの試す値：[値の説明, 値, 期待するエラーの文（通すなら null）, ほかの項目の差し替え] -----
function textCases(f, site, ctx) {
  const max = val(f.max, site), L = f.label, req = isRequired(f, ctx);
  const lenMsg = `${L}は${max}字までで入力してください`, url = f.noUrl ? `${L}にURLは入れられません` : null, bar = f.noBar ? `${L}に「｜」などの縦線は使えません` : null;
  return [
    ["空", "", req ? `${L}を入れてください` : null],
    ["空白だけ", "　 ", req ? `${L}を入れてください` : null],
    ["最小（1字）", "あ", null],
    [`最大（${max}字）`, "あ".repeat(max), null],
    [`最大＋1（${max + 1}字）`, "あ".repeat(max + 1), lenMsg],
    [`最大＋前後の空白`, "  " + "あ".repeat(max) + "  ", null],
    [`絵文字で最大（${max}字）`, "😀".repeat(max), null],
    [`絵文字で最大＋1`, "😀".repeat(max + 1), lenMsg],
    ["全角の英数字", "ＡＢＣ１２３", null],
    ["URL", "https://example.com", url],
    ["全角のURL", "ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ", url],
    ["www.", "www.example.com", url],
    ["縦線", "山田|花子", bar],
    ["全角の縦線", "山田｜花子", bar],
    ["改行", "1行目\n2行目", null],
  ];
}
function telCases(f, site, ctx) {
  const m = f.msg;
  return [
    ["空", "", isRequired(f, ctx) ? m : null],
    ["固定電話（ハイフンあり）", "03-1234-5678", null],
    ["固定電話（ハイフンなし）", "0312345678", null],
    ["携帯（ハイフンあり）", "090-1234-5678", null],
    ["携帯（ハイフンなし）", "09012345678", null],
    ["050 の11桁", "050-1234-5678", null],
    ["全角", "０９０－１２３４－５６７８", null],
    ["00 始まり", "0012345678", m],
    ["050 の10桁", "0501234567", m],
    ["9桁", "031234567", m],
    ["12桁", "031234567890", m],
    ["文字まじり", "03-1234-567a", m],
    ["ハイフンが続く", "03--1234-5678", m],
    ["+81", "+81-3-1234-5678", m],
    ["URL", "https://example.com", m],
    ["縦線", "03|1234|5678", m],
  ];
}
function emailCases(f, site, ctx) {
  const m = f.msg, max = val(f.max, site), dom = "@example.jp";
  return [
    ["空", "", isRequired(f, ctx) ? m : null],
    ["ふつう", "a@b.jp", null],
    ["前後の空白", " a@b.jp ", null],
    [`最大（${max}字）`, "a".repeat(max - dom.length) + dom, null],
    [`最大＋1（${max + 1}字）`, "a".repeat(max + 1 - dom.length) + dom, m],
    ["全角", "ａ@example.jp", m],
    ["日本語", "あ@い.う", m],
    ["空白", "a b@example.jp", m],
    ["縦線", "a|b@example.jp", m],
    ["@ なし", "example.jp", m],
    [". なし", "a@example", m],
    ["URL", "https://example.com", m],
  ];
}
function choiceCases(f, site, ctx) {
  const opts = val(f.options, site), m = f.msg;
  return [
    ["空", "", isRequired(f, ctx) ? m : null],
    [`選択肢の最初（${opts[0]}）`, opts[0], null],
    [`選択肢の最後（${opts.at(-1)}）`, opts.at(-1), null],
    ["選択肢の外（時刻の形）", "99:99〜99:99", m],
    ["選択肢の外（文字）", "夜", m],
    ["選択肢の外（半角の～）", opts[0].replace("〜", "~"), m],
  ];
}
function pickCases(f, site) {
  return [...val(f.options, site).map((o) => [`選択肢（${o}）`, o, null]), ["選択肢の外", "delete", f.msg], ["空", "", f.msg]];
}
function intCases(f, site) {
  const lo = f.lo, hi = val(f.hi, site), m = f.msg;
  const over = f.over === "line" ? `${hi + 1}名以上のご予約は、公式LINEでご相談ください（${site.contactLine}）` : m;
  const cases = [
    ["空", "", m],
    [`最小（${lo}）`, lo, null],
    [`最大（${hi}）`, hi, null],
    [`最大＋1（${hi + 1}）`, hi + 1, over],
    ["最小－1", lo - 1, m],
    ["小数", lo + 0.5, m],
    ["数字の文字", String(lo), null],
    ["全角の数字", String.fromCharCode(0xff10 + Math.min(9, Math.max(1, lo))), m],
    ["文字", "あ", m],
  ];
  return cases;
}
function dateCases(f, site, ctx) {
  const t = todayOf(ctx.now), ahead = site.bookingDaysAhead;
  const fmt = "日付の形が正しくありません";
  if (f.mode === "web") {
    // 予約画面：明日以降（当日予約なし）・受付開始日以降・今日から bookingDaysAhead 日先まで（並びは仕様の「いまの文のまま」の順）
    const expect = (d) => {
      if (!site.sameDay && d <= t) return "当日以前の日は選べません";
      if (d < t) return "過去の日は選べません";
      if (site.bookingStart && d < site.bookingStart) return `ネット予約の受付は ${site.bookingStart} のチェックインからです`;
      if (d > plus(t, ahead)) return "受付期間の外です";
      return null;
    };
    const out = [
      ["空", "", "チェックインの日を選んでください"],
      ["昨日", plus(t, -1), expect(plus(t, -1))],
      ["今日", t, expect(t)],
      ["明日", plus(t, 1), expect(plus(t, 1))],
      [`${ahead}日先`, plus(t, ahead), expect(plus(t, ahead))],
      [`${ahead + 1}日先`, plus(t, ahead + 1), expect(plus(t, ahead + 1))],
      ["形の違い（/）", plus(t, 19).replace(/-/g, "/"), fmt],
      ["無い日（2月30日）", `${Number(t.slice(0, 4)) + 1}-02-30`, fmt],
    ];
    if (site.bookingStart && site.bookingStart > plus(t, 1)) out.push(["受付開始日の前日", plus(site.bookingStart, -1), expect(plus(site.bookingStart, -1))]);
    return out;
  }
  // 管理画面（電話・LINE の予約・日付の変更）：今日以降。先の上限なし
  return [
    ["空", "", "チェックインの日を選んでください"],
    ["昨日", plus(t, -1), "過去の日は選べません"],
    ["今日", t, null],
    ["400日先", plus(t, 400), null],
    ["形の違い（/）", plus(t, 19).replace(/-/g, "/"), fmt],
    ["無い日（2月30日）", `${Number(t.slice(0, 4)) + 1}-02-30`, fmt],
  ];
}
function boolCases(f) {
  return [["印あり（true）", true, null], ["印なし（false）", false, f.msg], ["文字の true", "true", f.msg], ["数の 1", 1, f.msg]];
}
function periodCases(f, site, ctx) {
  const t = todayOf(ctx.now), m = f.msg;
  if (f.kind === "from") {
    return [["今日", t, null, { to: t }], ["昨日", plus(t, -1), m, { to: t }], ["空", "", m], ["形の違い（/）", t.replace(/-/g, "/"), m]];
  }
  return [
    ["始めと同じ日", t, null],
    [`${f.days}日（始めから${f.days - 1}日先）`, plus(t, f.days - 1), null],
    [`${f.days + 1}日`, plus(t, f.days), m],
    ["始めより前（逆順）", plus(t, 5), m, { from: plus(t, 6) }],
    ["空", "", m],
    ["形の違い（/）", t.replace(/-/g, "/"), m],
  ];
}
function countCases(f) {
  return [
    ["上限を決める：空", "", f.empty, { action: "limit" }],
    ["この日は受ける：空（上限なし）", "", null, { action: "open" }],
    [`最小（${f.lo}）`, f.lo, null],
    [`最大（${f.hi}）`, f.hi, null],
    [`最大＋1（${f.hi + 1}）`, f.hi + 1, f.msg],
    ["最小－1", f.lo - 1, f.msg],
    ["小数", 1.5, f.msg],
    ["文字", "あ", f.msg],
    ["受付停止のときは見ない", "あ", null, { action: "stop" }],
  ];
}
function flagCases() {
  // 印あり／なしだけ。true だけを「定休日」にし、文字の "false" などは「なし」（stored に保存される値）
  return [["印あり（true）", true, null, {}, 1], ["印なし（false）", false, null, {}, 0], ['文字の "false"', "false", null, {}, 0], ["数の 1", 1, null, {}, 0]];
}
function monthCases(f, site, ctx) {
  const y = todayOf(ctx.now).slice(0, 4);
  return [["1月", `${y}-01`, null], ["12月", `${y}-12`, null], ["13月", `${y}-13`, f.msg], ["0月", `${y}-00`, f.msg], ["1桁の月", `${y}-1`, f.msg], ["空", "", f.msg]];
}

const BY_KIND = { text: textCases, tel: telCases, email: emailCases, choice: choiceCases, pick: pickCases, int: intCases, date: dateCases, bool: boolCases, from: periodCases, to: periodCases, count: countCases, flag: flagCases, month: monthCases };

/**
 * フォームの試験の値の一覧
 * @returns {{form, key, label, name, value, input, expect, stored?}[]} input は送る値一式、expect はその項目に出るはずの文（通すなら null）
 */
export function fieldCases(form, site, ctx) {
  const base = baseInput(form, site, ctx);
  const out = [];
  for (const f of FORMS[form]) {
    const make = BY_KIND[f.kind];
    if (!make) throw new Error("試験の値の作り方がありません：" + f.kind);
    for (const [name, value, expect, other = {}, stored] of make(f, site, ctx)) {
      out.push({ form, key: f.key, label: f.label, kind: f.kind, name, value, input: { ...base, ...other, [f.key]: value }, expect, ...(stored !== undefined ? { stored } : {}) });
    }
  }
  return out;
}
