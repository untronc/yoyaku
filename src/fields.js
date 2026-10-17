// 入力チェックの正本。ClaudeCode_入力チェック仕様_2026-10-13.md の表を「データ」にしたもの。
// サーバー（book.js・admin.js・rules.js）も画面（/validate.js を読む予約画面と管理画面）も、ここの validate で判定する。試験（test/field-cases.js）もこの表から作る。
// makeFields は画面にそのまま文字にして配る（/validate.js）。中で外の名前を使わないこと（import した物・この関数の外の変数は画面に無い）
export function makeFields() {
  "use strict";
  var BAR_RE = /[|｜¦│┃∣ǀ￨❘]/;
  var URL_RE = /:\/\/|www\.|https?:/i;
  var TEL_MSG = "電話番号の形が正しくありません（例：03-1234-5678、090-1234-5678）";
  var DAY = 86400000;

  // ----- 表（項目ごとの決まり） -----
  // kind：text（文字）・tel・email・choice（選択肢）・int（整数）・date（日付）・bool（印）・count（受付件数）・from/to（受付の設定の期間）・pick（決まった値のどれか）・month・flag（印あり／なし）
  // required：true（必須）・false（任意）・"web"（予約画面からの予約だけ必須。お客様の情報を直す画面）
  // max・lo・hi・options は施設の設定（site）から読む関数か、決まった数
  var F = {
    checkinWeb: { key: "checkin", label: "チェックイン", kind: "date", mode: "web", required: true },
    checkinAdmin: { key: "checkin", label: "チェックイン", kind: "date", mode: "admin", required: true },
    nights: { key: "nights", label: "泊数", kind: "int", required: true, lo: 1, hi: function (s) { return s.maxNights; }, msg: "泊数が正しくありません" },
    guestsWeb: { key: "guests", label: "人数", kind: "int", required: true, lo: 1, hi: function (s) { return s.maxGuests; }, msg: "人数が正しくありません", over: "line" },
    guests: { key: "guests", label: "人数", kind: "int", required: true, lo: 1, hi: function (s) { return s.maxGuests; }, msg: "人数が正しくありません" },
    name: { key: "name", label: "お名前", kind: "text", required: true, max: function (s) { return s.maxLen.name; }, noUrl: true, noBar: true },
    tel: { key: "tel", label: "電話番号", kind: "tel", required: true, msg: TEL_MSG },
    email: { key: "email", label: "メールアドレス", kind: "email", required: true, max: 254, msg: "メールアドレスの形が正しくありません" },
    address: { key: "address", label: "ご住所", kind: "text", required: true, max: function (s) { return s.maxLen.address; }, noUrl: true, noBar: true },
    arrival: { key: "arrival", label: "到着予定", kind: "choice", required: false, options: function (s) { return s.arrivalOptions; }, msg: "到着予定を選んでください" },
    note: { key: "note", label: "ご要望", kind: "text", required: false, newline: true, max: function (s) { return s.maxLen.note; }, noUrl: true, noBar: true },
    agree: { key: "agree", label: "キャンセル料への同意", kind: "bool", required: true, msg: "キャンセル料への同意が必要です" },
    privacyAgree: { key: "privacyAgree", label: "プライバシーポリシーへの同意", kind: "bool", required: true, msg: "プライバシーポリシーへの同意が必要です" },
    memo: { key: "memo", label: "宿のメモ", kind: "text", required: false, newline: true, max: 1000 },
    adminName: { key: "name", label: "名前", kind: "text", required: true, max: 100, noUrl: true, noBar: true },
    from: { key: "from", label: "から", kind: "from", required: true, msg: "期間が正しくありません" },
    to: { key: "to", label: "まで", kind: "to", required: true, days: 400, msg: "期間が正しくありません" },
    action: { key: "action", label: "どうするか", kind: "pick", required: true, options: function () { return ["stop", "limit", "open", "clear"]; }, msg: "操作が正しくありません" },
    limit: { key: "limit", label: "件数", kind: "count", lo: 0, hi: 9999, empty: "件数を入れてください", msg: "件数が正しくありません" },
    weekday: { key: "weekday", label: "曜日", kind: "int", required: true, lo: 0, hi: 6, msg: "曜日が正しくありません" },
    stop: { key: "stop", label: "定休日にする", kind: "flag" },
    month: { key: "month", label: "月", kind: "month", required: true, msg: "月の形が正しくありません" },
    // 管理画面の「設定」：画面の色（朱・緑・青。基本設計書 追補 2026-10-13 S-03）。並びは src/theme.js の THEME_KEYS と同じ
    theme: { key: "theme", label: "画面の色", kind: "pick", required: true, options: function () { return ["shu", "green", "blue"]; }, msg: "色を選んでください" },
    // 管理画面：金額の手入力（電話・LINE の予約だけ。要件差分 第2版 2026-10-14）。空は定価。合計金額は手入力のときだけ見る。上限は Claude案（基本設計書 6節）
    priceMode: { key: "priceMode", label: "金額の入れ方", kind: "priceMode", msg: "金額の入れ方が正しくありません" },
    customPay: { key: "customPay", label: "合計金額", kind: "pay", lo: 0, hi: 9999999, empty: "合計金額を入れてください", msg: "合計金額は 0〜9,999,999円の整数で入れてください" },
  };
  function withReq(f, required) { var o = {}; for (var k in f) o[k] = f[k]; o.required = required; return o; }

  // ----- フォーム（画面・API ごとの項目の並び。エラーはこの順に並ぶ） -----
  var FORMS = {
    // 予約画面：空きと料金（GET /api action=quote）・予約（POST /api action=book）
    quote: [F.checkinWeb, F.nights, F.guestsWeb],
    book: [F.checkinWeb, F.nights, F.guestsWeb, F.name, F.tel, F.email, F.address, F.arrival, F.note, F.agree, F.privacyAgree],
    // 管理画面：電話・LINE の予約を足す（/manual）
    manual: [F.checkinAdmin, F.nights, F.guests, F.name, withReq(F.tel, false), F.memo, F.priceMode, F.customPay],
    // 管理画面：料金の下見（/quote）
    stay: [F.checkinAdmin, F.nights, F.guests],
    // 管理画面：日付・人数・金額の変更（/change）
    change: [F.checkinAdmin, F.nights, F.guests, F.priceMode, F.customPay],
    // 管理画面：お客様の情報を直す（/info）。電話・メール・ご住所は、予約画面からの予約だけ必須
    info: [F.name, withReq(F.tel, "web"), withReq(F.email, "web"), withReq(F.address, "web"), F.arrival, F.note],
    memo: [F.memo],
    me: [F.adminName],
    rulesDay: [F.from, F.to, F.action, F.limit],
    rulesWeekly: [F.weekday, F.stop],
    month: [F.month],
    // 管理画面：設定（/settings）
    settings: [F.theme],
  };

  // ----- 整える処理 -----
  /** 改行をそろえ、タブ・（改行を残さないときは改行も）空白に、制御文字を除き、前後の空白を除く */
  function clean(v, keepNewline) {
    var t = String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n");
    if (!keepNewline) t = t.replace(/\n/g, " ");
    return t.replace(/\t/g, " ").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  }
  /** 電話番号：全角数字・全角ハイフンを半角に、空白を除いてから形を見る。合えば整えた文字、合わなければ null */
  function normalizeTel(s) {
    var t = String(s == null ? "" : s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); }).replace(/[－‐―ー−]/g, "-").replace(/\s/g, "");
    if (!/^\d+(-\d+)*$/.test(t)) return null;
    var d = t.replace(/-/g, "");
    // 0 から始まる10桁（00・050・070・080・090 で始まるものは除く）か、050・070・080・090 から始まる11桁
    if (/^0(?!0)(?![5789]0)\d{9}$/.test(d) || /^0[5789]0\d{8}$/.test(d)) return t;
    return null;
  }
  var len = function (v) { return Array.from(v).length; };
  var nfkc = function (v) { return v.normalize ? v.normalize("NFKC") : v; };
  var val = function (x, s) { return typeof x === "function" ? x(s) : x; };

  // ----- 日付（日本時間の暦。'YYYY-MM-DD' の文字で比べる） -----
  function ymdOk(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1;
  }
  function addDays(ymd, n) { var p = ymd.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * DAY).toISOString().slice(0, 10); }
  function today(now) { return new Date((now ? now.getTime() : Date.now()) + 9 * 3600000).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY); }
  /** 整数の文字か数。それ以外（空・小数・全角・真偽など）は NaN */
  function num(v) {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return NaN;
    var t = v.trim();
    return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }
  var isEmpty = function (v) { return v == null || (typeof v === "string" && v.trim() === ""); };
  function required(f, ctx) { return f.required === "web" ? ctx.source === "web" : !!f.required; }

  // ----- 1項目の判定：{ v: 整えた値 } か { e: エラーの文 } -----
  function check(f, raw, site, ctx, got) {
    var v, n;
    switch (f.kind) {
      case "text": {
        v = clean(raw, f.newline);
        if (!v) return required(f, ctx) ? { e: f.label + "を入れてください" } : { v: "" };
        var max = val(f.max, site), nk = nfkc(v);
        if (len(v) > max) return { e: f.label + "は" + max + "字までで入力してください" };
        if (f.noUrl && URL_RE.test(nk)) return { e: f.label + "にURLは入れられません" };
        if (f.noBar && (BAR_RE.test(v) || BAR_RE.test(nk))) return { e: f.label + "に「｜」などの縦線は使えません" };
        return { v: v };
      }
      case "tel":
        v = clean(raw);
        if (!v) return required(f, ctx) ? { e: f.msg } : { v: "" };
        v = normalizeTel(v);
        return v ? { v: v } : { e: f.msg };
      case "email":
        v = clean(raw);
        if (!v) return required(f, ctx) ? { e: f.msg } : { v: "" };
        // 半角（空白を除く ASCII）だけ・縦線なし・254字まで・○○@○○.○○ の形
        if (len(v) > f.max || !/^[\x21-\x7E]+$/.test(v) || /\|/.test(v) || !/^[^@]+@[^@]+\.[^@]+$/.test(v)) return { e: f.msg };
        return { v: v };
      case "choice":
        v = clean(raw);
        if (!v) return required(f, ctx) ? { e: f.msg } : { v: "" };
        return val(f.options, site).indexOf(v) >= 0 ? { v: v } : { e: f.msg };
      case "pick":
        v = clean(raw);
        return val(f.options, site).indexOf(v) >= 0 ? { v: v } : { e: f.msg };
      case "int":
        n = num(raw);
        if (!Number.isInteger(n) || n < f.lo) return { e: f.msg };
        if (n > val(f.hi, site)) {
          // 予約画面の人数の上限を超えたら、公式LINEへの案内（いまのまま）
          if (f.over === "line") return { e: val(f.hi, site) + 1 + "名以上のご予約は、公式LINEでご相談ください（" + site.contactLine + "）" };
          return { e: f.msg };
        }
        return { v: n };
      case "date": {
        v = clean(raw);
        if (!v) return { e: "チェックインの日を選んでください" };
        if (!ymdOk(v)) return { e: "日付の形が正しくありません" };
        var t = today(ctx.now);
        if (f.mode === "web") {
          if (!site.sameDay && v <= t) return { e: "当日以前の日は選べません" };
          if (v < t) return { e: "過去の日は選べません" };
          if (site.bookingStart && v < site.bookingStart) return { e: "ネット予約の受付は " + site.bookingStart + " のチェックインからです" };
          if (v > addDays(t, site.bookingDaysAhead)) return { e: "受付期間の外です" };
        } else if (v < t && ctx.source !== "manual") return { e: "過去の日は選べません" }; // 電話・LINE の予約は昨日以前も可（要件差分 第3版 業務の決まり 9・10）
        return { v: v };
      }
      case "from":
        v = clean(raw);
        if (!ymdOk(v) || v < today(ctx.now)) return { e: f.msg };
        return { v: v };
      case "to":
        v = clean(raw);
        if (!ymdOk(v)) return { e: f.msg };
        // から が正しいときだけ、始め ≦ 終わり・400日までを見る
        if (typeof got.from === "string" && (v < got.from || daysBetween(got.from, v) + 1 > f.days)) return { e: f.msg };
        return { v: v };
      case "count":
        // 件数は「受付件数の上限を決める」「この日は受ける」のときだけ。「この日は受ける」の空は、上限なし（既定の件数）
        if (got.action !== "limit" && got.action !== "open") return { v: null };
        if (isEmpty(raw)) return got.action === "limit" ? { e: f.empty } : { v: null };
        n = num(raw);
        return Number.isInteger(n) && n >= f.lo && n <= f.hi ? { v: n } : { e: f.msg };
      case "priceMode":
        // 空は定価
        v = clean(raw);
        if (!v) return { v: "list" };
        return v === "list" || v === "custom" ? { v: v } : { e: f.msg };
      case "pay":
        // 合計金額は手入力のときだけ見る。定価のときは使わない（null）
        if (got.priceMode !== "custom") return { v: null };
        if (isEmpty(raw)) return { e: f.empty };
        n = num(raw);
        return Number.isInteger(n) && n >= f.lo && n <= f.hi ? { v: n } : { e: f.msg };
      case "bool":
        return raw === true ? { v: true } : { e: f.msg };
      case "flag":
        return { v: raw === true };
      case "month":
        v = clean(raw);
        return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? { v: v } : { e: f.msg };
    }
    throw new Error("項目の種類がありません：" + f.kind);
  }

  /**
   * フォームの入力を判定する。まちがっている項目を全部まとめて返す
   * @returns {{ ok: boolean, value: object, errors: object, error: string }} value は整えた値、errors は 項目→文、error は最初の文
   */
  function validate(form, input, site, ctx) {
    var fields = FORMS[form];
    if (!fields) throw new Error("フォームがありません：" + form);
    input = input || {};
    ctx = ctx || {};
    var value = {}, errors = {}, first = "";
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], r = check(f, input[f.key], site, ctx, value);
      if ("e" in r) { errors[f.key] = r.e; if (!first) first = r.e; }
      else value[f.key] = r.v;
    }
    return { ok: !first, value: value, errors: errors, error: first };
  }

  return { FORMS: FORMS, F: F, validate: validate, clean: clean, normalizeTel: normalizeTel, today: today, addDays: addDays };
}

const fields = makeFields();
export const { FORMS, validate, clean, normalizeTel } = fields;

/** 入力のまちがい。message は最初の文、errors は 項目→文（全部） */
export class FieldError extends Error {
  constructor(r) {
    super(r.error);
    this.errors = r.errors;
  }
}
/** 判定して、まちがいがあれば FieldError を投げ、整えた値を返す */
export function validOrThrow(form, input, site, ctx) {
  const r = validate(form, input, site, ctx);
  if (!r.ok) throw new FieldError(r);
  return r.value;
}

// 画面に配る施設の値（判定に使う物だけ。宛先・アカウントなどは入れない）
const PUBLIC = ["maxLen", "maxNights", "maxGuests", "bookingStart", "bookingDaysAhead", "sameDay", "arrivalOptions", "contactLine"];
/** /validate.js の中身：画面で window.YBK_FIELDS.validate(form, input, window.YBK_SITE, ctx) として使う */
export function validateJs(site) {
  const pub = Object.fromEntries(PUBLIC.map((k) => [k, site[k]]));
  // 束ねる道具（esbuild の keepNames）が関数の中に __name(...) を足すことがあるので、何もしない __name を置く
  return `// 入力チェック（src/fields.js から作った物。施設の値つき）\n(function () {\nvar __name = function (f) { return f; };\nwindow.YBK_FIELDS = (${makeFields.toString()})();\nwindow.YBK_SITE = ${JSON.stringify(pub)};\n})();\n`;
}
