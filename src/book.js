// 予約画面からの予約（リリース1の book_）。入力の確かめは src/fields.js（入力チェック仕様 2026-10-13）。不正利用対策・文面はリリース1のまま。
// 空きの確かめ・1日の受付件数の確かめ・登録を1つの batch（D1 では1つのトランザクション）で行い、同時の予約でも上限を超えない
import { addDays, daysIn, jpDate, jstStamp, parseYmd, todayJst, ymd } from "./dates.js";
import { sendMail } from "./mail.js";
import { validOrThrow } from "./fields.js";
import { limitOf, loadRules, price } from "./rules.js";
import { sourceColumns } from "./source.js";

/** 連絡先の印（SHA-256 の先頭8バイトを16進。リリース1の contactMark_ と同じ値） */
export async function contactMark(kind, v) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kind + ":" + v));
  return [...new Uint8Array(buf).slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const yen = (n) => comma(n) + "円";

/** 予約番号（リリース1と同じ形：受付日 yyMMdd-4桁） */
export function bookingNo(now = new Date()) {
  return ymd(todayJst(now)).slice(2).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}

/** 宿への予約通知の本文（リリース1のカレンダーの説明欄と同じ）。受付は「予約画面」 */
export function innText(site, bk, stamp, via = "予約画面") {
  const p = { total: bk.total, perPerson: bk.per_person, discount: bk.discount };
  return [
    "予約番号：" + bk.id,
    "人数：" + bk.guests + "名／" + bk.nights + "泊（" + bk.checkin + "〜" + bk.checkout + "）",
    "お名前：" + bk.name,
    "電話：" + (bk.tel || ""),
    "メール：" + (bk.email || ""),
    "ご住所：" + (bk.address || ""),
    "到着予定：" + (bk.arrival || "未記入"),
    "ご要望：" + (bk.note || "なし"),
    "料金：" + yen(p.total) + "（1名1泊 " + yen(p.perPerson) + "）" + (p.discount ? "／連泊割引 −" + yen(p.discount) + "（当日フロントで値引き）" : ""),
    "受付：" + stamp + "（" + via + "）",
  ].join("\n");
}

/** お客様への予約確認メールの本文（リリース1のまま） */
export function guestText(site, bk) {
  const checkin = parseYmd(bk.checkin), checkout = parseYmd(bk.checkout);
  return [
    bk.name + " 様",
    "",
    "このたびは、" + site.innName + "をご予約いただきありがとうございます。",
    "以下の内容でご予約を承りました。",
    "",
    "■ご予約内容",
    "予約番号：" + bk.id,
    "ご宿泊日：" + jpDate(checkin) + "〜" + jpDate(checkout, bk.checkout.slice(0, 4) !== bk.checkin.slice(0, 4)) + "　" + bk.nights + "泊",
    "人数：" + bk.guests + "名",
    "到着予定：" + (bk.arrival || "未記入"),
    "ご要望：" + (bk.note || "なし"),
    "",
    "■料金（1人1泊・税込・食事なし）",
    yen(bk.per_person) + " × " + bk.guests + "名 × " + bk.nights + "泊 ＝ " + yen(bk.total),
    ...(bk.discount ? ["連泊割引 −" + yen(bk.discount)] : []),
    "お支払い " + yen(bk.pay),
    site.payNote,
    "",
    "■お客さまの情報",
    "お名前：" + bk.name,
    "電話：" + bk.tel,
    "メール：" + bk.email,
    "ご住所：" + bk.address,
    "",
    "■ご案内",
    "チェックイン：" + site.checkIn,
    "チェックアウト：" + site.checkOut,
    "キャンセル料：" + site.cancelPolicy,
    "",
    "ご質問・日程の変更・キャンセルは、公式LINEかお電話でご連絡ください。",
    "公式LINE：" + site.contactLine,
    "電話：" + site.contactTel,
    site.safetyNote,
    "",
    site.innName,
  ].join("\n");
}

const AUDIT = "created_at, created_by, updated_at, updated_by";

export async function book(site, env, raw, now = new Date()) {
  // プライバシーポリシーの版は施設の設定（site.privacyVersion。要件定義書 第2版 5節・6節の11）。版が決まるまでは予約を受けない
  if (!site.privacyVersion) throw new Error("プライバシーポリシーの版が設定されていません");
  // 入力の確かめ（まちがいは全部まとめて FieldError で返す）
  const b = validOrThrow("book", raw, site, { now });
  const { nights, guests, tel } = b;
  const checkin = parseYmd(b.checkin);
  const checkout = addDays(checkin, nights);
  const p = price(site, guests, nights);
  const stays = daysIn(checkin, checkout);
  const rules = await loadRules(env.DB, checkin, checkout);
  const day = ymd(todayJst(now));
  const marks = ["e" + (await contactMark("email", String(b.email).toLowerCase())), "t" + (await contactMark("tel", tel.replace(/\D/g, "")))];
  const at = now.toISOString();
  const stamp = jstStamp(now);

  const bk = {
    source: "web", status: "booked", checkin: ymd(checkin), checkout: ymd(checkout), nights, guests,
    per_person: p.perPerson, total: p.total, discount: p.discount, pay: p.pay, price_version: site.price.current,
    name: b.name, tel, email: b.email, address: b.address, arrival: b.arrival || "", note: b.note || "", received_at: at,
    privacy_agreed_at: at, privacy_version: site.privacyVersion,
    // 流入元（要件差分 予約の流入元 2026-10-17）。おかしな値はその項目を空にして、予約は受ける
    ...sourceColumns(raw && raw.src),
  };

  // 全泊の空き・1日の受付件数（全体・同じ連絡先）を確かめながら入れる。予約番号がかぶったら（主キー）番号を変えてやり直す
  let inserted = false;
  for (let i = 0; i < 5 && !inserted; i++) {
    bk.id = bookingNo(now);
    const cols = Object.keys(bk);
    // 泊ごとの [日, その日の上限] を1つの値（JSON）で渡す。1泊ごとに ? を3つ使うと、23泊以上で D1 の上限（1文に100個）を超えて予約できなかった（2026-10-13 入力チェックの試験で見つけた）
    const roomCond = "NOT EXISTS (SELECT 1 FROM json_each(?) AS s WHERE (SELECT COUNT(*) FROM bookings WHERE status = 'booked' AND checkin <= json_extract(s.value, '$[0]') AND checkout > json_extract(s.value, '$[0]')) >= json_extract(s.value, '$[1]'))";
    const roomArgs = [JSON.stringify(stays.map((k) => [k, limitOf(site, rules, k)]))];
    const countCond = "COALESCE((SELECT n FROM daily_counts WHERE day = ? AND mark = '*'), 0) < ? AND COALESCE((SELECT n FROM daily_counts WHERE day = ? AND mark = ?), 0) < ? AND COALESCE((SELECT n FROM daily_counts WHERE day = ? AND mark = ?), 0) < ?";
    const countArgs = [day, site.dailyLimit, day, marks[0], site.perContactDailyLimit, day, marks[1], site.perContactDailyLimit];
    const insert = env.DB.prepare(
      `INSERT INTO bookings (${cols.join(", ")}, ${AUDIT}) SELECT ${cols.map(() => "?").join(", ")}, ?, 'guest', ?, 'guest' WHERE ${roomCond} AND ${countCond}`
    ).bind(...cols.map((c) => bk[c]), at, at, ...roomArgs, ...countArgs);
    const bump = (mark) =>
      env.DB.prepare(
        `INSERT INTO daily_counts (day, mark, n, ${AUDIT}) SELECT ?, ?, 1, ?, 'guest', ?, 'guest' WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND received_at = ?) ` +
          "ON CONFLICT (day, mark) DO UPDATE SET n = n + 1, updated_at = excluded.updated_at, updated_by = 'guest'"
      ).bind(day, mark, at, at, bk.id, at);
    const hist = env.DB.prepare(
      `INSERT INTO booking_changes (id, booking_id, kind, before_json, after_json, changed_at, changed_via, changed_by_user_id, ${AUDIT}) ` +
        `SELECT ?, ?, 'create', NULL, ?, ?, 'guest', NULL, ?, 'guest', ?, 'guest' WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND received_at = ?)`
    ).bind(crypto.randomUUID(), bk.id, JSON.stringify(stayFields(bk)), at, at, at, bk.id, at);
    try {
      const res = await env.DB.batch([insert, bump("*"), bump(marks[0]), bump(marks[1]), hist]);
      if (res[0].meta.changes !== 1) return refused(site, env.DB, day, marks);
      inserted = true;
    } catch (err) {
      if (!/UNIQUE|PRIMARY KEY|constraint/i.test(String(err?.message))) throw err;
    }
  }
  if (!inserted) throw new Error("混み合っています。少し時間をおいてお試しください。");

  // メールが送れなくても予約は成功として扱う。送れたかは予約に残す
  const subject = "【" + site.innName + "】ご予約を承りました（予約番号 " + bk.id + "）";
  const mailGuest = await sendMail(env, site, { idem: bk.id, to: bk.email, subject, text: guestText(site, bk), replyTo: site.mail.replyTo, bcc: site.mail.bcc });
  let mailInn = "none";
  if (site.mail.notifyTo) {
    // 件名にお名前は入れない（リリース1のまま）。本文の最後に管理画面のリンクを足す（要件 6節-9）
    const nsub = "【予約】" + bk.checkin + " " + guests + "名" + nights + "泊";
    const text = innText(site, bk, stamp) + "\n\n管理画面：" + adminLink(site, bk.id);
    mailInn = await sendMail(env, site, { idem: bk.id + "-notify", to: site.mail.notifyTo, subject: nsub, text, replyTo: bk.email });
  }
  await env.DB.prepare("UPDATE bookings SET mail_guest = ?, mail_inn = ? WHERE id = ?").bind(mailGuest, mailInn, bk.id).run();
  return { ok: true, no: bk.id, checkin: bk.checkin, checkout: bk.checkout, nights, guests, price: p, mailOk: mailGuest === "sent" || mailGuest.startsWith("skipped") };
}

export const adminLink = (site, id) => site.adminUrl.replace(/\/$/, "") + "/b/" + encodeURIComponent(id);

/** 変更履歴に入れる値（氏名・連絡先・メモの中身は入れない） */
export const stayFields = (b) => ({ checkin: b.checkin, checkout: b.checkout, nights: b.nights, guests: b.guests, total: b.total, discount: b.discount, pay: b.pay, status: b.status, price_mode: b.price_mode ?? "list" });

/** 入れられなかった理由を返す（リリース1と同じく、1日の受付件数を先に見る） */
async function refused(site, db, day, marks) {
  const { results } = await db.prepare("SELECT mark, n FROM daily_counts WHERE day = ?").bind(day).all();
  const n = Object.fromEntries(results.map((r) => [r.mark, r.n]));
  const contact = "公式LINE（" + site.contactLine + "）かお電話（" + site.contactTel + "）でご連絡ください。";
  if ((n["*"] || 0) >= site.dailyLimit) throw new Error("本日のネット予約の受付は終了しました。" + contact);
  if (marks.some((m) => (n[m] || 0) >= site.perContactDailyLimit)) {
    throw new Error("同じメールアドレス・電話番号からのネット予約は、1日" + site.perContactDailyLimit + "件までです。" + contact);
  }
  return { ok: false, error: "申し訳ありません。直前に埋まりました。日にちか人数を変えてお試しください。" };
}
