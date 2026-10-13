// 管理画面の API（/admin/api/...）。ログインした利用者だけ。変更は変更履歴に、だれが（アカウントID）・いつ・何を、を残す
import { stayFields, bookingNo } from "./book.js";
import { FieldError, validOrThrow } from "./fields.js";
import { addDays, daysIn, monthOf, parseYmd, todayJst, ymd } from "./dates.js";
import { limitOf, loadRules, occupancy, price, stoppedOn } from "./rules.js";
import { currentTheme, setTheme, settingHistory } from "./settings.js";

const AUDIT = "created_at, created_by, updated_at, updated_by";
class Bad extends Error {}
const bad = (m) => { throw new Bad(m); };

// 変更履歴：予約は booking_changes、受付条件は rule_changes（どちらも FK でつながる。migrations/V0003）。管理画面からの変更なので changed_via は admin
const js = (v) => (v == null ? null : JSON.stringify(v));
function bookingHistory(db, user, bookingId, kind, before, after, at) {
  return db
    .prepare(`INSERT INTO booking_changes (id, booking_id, kind, before_json, after_json, changed_at, changed_via, changed_by_user_id, ${AUDIT}) VALUES (?,?,?,?,?,?,'admin',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), bookingId, kind, js(before), js(after), at, user.id, at, user.google_sub, at, user.google_sub);
}
function ruleHistory(db, user, { day = null, weekday = null }, before, after, at) {
  return db
    .prepare(`INSERT INTO rule_changes (id, day, weekday, before_json, after_json, changed_at, changed_via, changed_by_user_id, ${AUDIT}) VALUES (?,?,?,?,?,?,'admin',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), day, weekday, js(before), js(after), at, user.id, at, user.google_sub, at, user.google_sub);
}

// 入力の確かめは src/fields.js（入力チェック仕様 2026-10-13）。まちがいは FieldError（項目ごとの文 errors つき）
const monthRange = (site, m) => {
  const x = /^(\d{4})-(\d{2})$/.exec(validOrThrow("month", { month: m }, site).month);
  return [new Date(Date.UTC(+x[1], +x[2] - 1, 1)), new Date(Date.UTC(+x[1], +x[2], 1))];
};

/** 日付・泊数・人数を受けて、満室・受付停止の日を返す（変更・登録の画面で知らせるため） */
async function fullNights(site, db, checkin, checkout, exceptId) {
  const [occ, rules] = await Promise.all([occupancy(db, checkin, checkout), loadRules(db, checkin, checkout)]);
  let own = null;
  if (exceptId) own = await db.prepare("SELECT checkin, checkout, status FROM bookings WHERE id = ?").bind(exceptId).first();
  return Object.keys(occ).filter((k) => {
    const mine = own && own.status === "booked" && own.checkin <= k && own.checkout > k ? 1 : 0;
    return limitOf(site, rules, k) - (occ[k].count - mine) < 1;
  });
}

function stay(site, body, version, now) {
  const v = validOrThrow("stay", body, site, { now });
  const checkin = parseYmd(v.checkin), nights = v.nights, guests = v.guests;
  const checkout = addDays(checkin, nights);
  return { checkin, checkout, nights, guests, price: price(site, guests, nights, version) };
}

async function names(db) {
  const { results } = await db.prepare("SELECT id, display_name, email FROM admin_users").all();
  const map = {};
  for (const u of results) map[u.id] = u.display_name || u.email;
  return (via, userId) => (via === "guest" ? "予約画面" : via === "system" ? "自動" : map[userId] || "（不明）");
}

export async function handleAdminApi(site, env, request, user, now = new Date()) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\/api/, "");
  const q = Object.fromEntries(url.searchParams);
  const db = env.DB, who = user.google_sub, at = now.toISOString();
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

  if (request.method === "POST") {
    // よそのページからの書き込みを受けない（独自の見出しはよその住所からは付けられない）
    const origin = request.headers.get("Origin");
    if (request.headers.get("X-Ybk") !== "1" || (origin && origin !== url.origin)) return json({ ok: false, error: "forbidden" }, 403);
  }
  let body = {};
  if (request.method === "POST") { try { body = await request.json(); } catch { return json({ ok: false, error: "壊れた入力です" }, 400); } }

  try {
    const r = await route();
    return json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof FieldError) return json({ ok: false, error: err.message, errors: err.errors }, 400);
    if (err instanceof Bad || /形が正しくありません|料金/.test(String(err?.message))) return json({ ok: false, error: err.message }, 400);
    throw err;
  }

  async function route() {
    const key = request.method + " " + path;
    switch (key) {
      case "GET /me":
        return { me: { name: user.display_name, email: user.email }, inn: site.innName, maxGuests: site.maxGuests, maxNights: site.maxNights };
      case "POST /me": {
        const { name } = validOrThrow("me", body, site);
        await db.prepare("UPDATE admin_users SET display_name = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(name, at, who, user.id).run();
        return { me: { name, email: user.email } };
      }
      case "GET /month": {
        const [from, to] = monthRange(site, q.m);
        const [occ, rules] = await Promise.all([occupancy(db, from, to), loadRules(db, from, to)]);
        const days = {};
        for (const k of Object.keys(occ)) days[k] = { count: occ[k].count, guests: occ[k].guests, limit: limitOf(site, rules, k), stop: stoppedOn(rules, k) };
        return { month: q.m, days };
      }
      case "GET /stats": {
        // 月ごとの数字（2026-10-13 よろづやの依頼）。チェックインの月に、件数・人数・泊数・金額（保存してある pay）を全部入れる。
        // キャンセルは件数だけ。名前に「テスト」「試験」を含む試しの予約は入れない。受付を始めた月から受付期間の最後の月まで、0件の月も並べる
        const first = site.bookingStart.slice(0, 7), last = monthOf(addDays(todayJst(now), site.bookingDaysAhead));
        const { results } = await db
          .prepare("SELECT substr(checkin, 1, 7) AS m, source, status, COUNT(*) AS n, SUM(guests) AS g, SUM(nights) AS ni, SUM(pay) AS p FROM bookings WHERE COALESCE(name, '') NOT LIKE '%テスト%' AND COALESCE(name, '') NOT LIKE '%試験%' AND checkin >= ? AND checkin < ? GROUP BY 1, 2, 3")
          .bind(first + "-01", ymd(addDays(parseYmd(last + "-01"), 31)).slice(0, 7) + "-01")
          .all();
        const zero = () => ({ count: 0, guests: 0, nights: 0, pay: 0 });
        const months = [];
        for (let d = parseYmd(first + "-01"); monthOf(d) <= last; d = parseYmd(monthOf(addDays(d, 31)) + "-01")) {
          months.push({ month: monthOf(d), web: zero(), manual: zero(), total: zero(), cancelled: 0 });
        }
        const byMonth = Object.fromEntries(months.map((x) => [x.month, x]));
        for (const r of results) {
          const x = byMonth[r.m];
          if (!x) continue;
          if (r.status !== "booked") { x.cancelled += r.n; continue; }
          for (const k of [r.source === "web" ? "web" : "manual", "total"]) {
            x[k].count += r.n; x[k].guests += r.g; x[k].nights += r.ni; x[k].pay += r.p;
          }
        }
        return { months };
      }
      case "GET /day": {
        const d = ymd(parseYmd(q.d));
        const { results } = await db
          .prepare("SELECT id, source, status, checkin, checkout, nights, guests, name, pay, inn_memo FROM bookings WHERE checkin <= ? AND checkout > ? ORDER BY status, received_at")
          .bind(d, d)
          .all();
        const rules = await loadRules(db, parseYmd(d), addDays(parseYmd(d), 1));
        return { day: d, limit: limitOf(site, rules, d), stop: stoppedOn(rules, d), bookings: results };
      }
      case "GET /booking": {
        const b = (await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(String(q.id)).first()) || bad("予約が見つかりません");
        const { results } = await db.prepare("SELECT kind, before_json, after_json, changed_at, changed_via, changed_by_user_id FROM booking_changes WHERE booking_id = ? ORDER BY changed_at").bind(b.id).all();
        const nameOf = await names(db);
        return { booking: b, history: results.map((h) => ({ kind: h.kind, before: JSON.parse(h.before_json || "null"), after: JSON.parse(h.after_json || "null"), at: h.changed_at, by: nameOf(h.changed_via, h.changed_by_user_id) })) };
      }
      case "POST /quote": {
        // 変更・登録の前に、料金と満室の日を見せる
        const b = body.id ? (await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(String(body.id)).first()) || bad("予約が見つかりません") : null;
        const s = stay(site, body, b ? b.price_version : site.price.current, now);
        return { price: s.price, checkout: ymd(s.checkout), full: await fullNights(site, db, s.checkin, s.checkout, b?.id) };
      }
      case "POST /cancel": {
        const b = (await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(String(body.id)).first()) || bad("予約が見つかりません");
        if (b.status === "cancelled") bad("この予約はキャンセル済みです");
        await db.batch([
          db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'booked'").bind(at, at, who, b.id),
          bookingHistory(db, user, b.id, "cancel", stayFields(b), stayFields({ ...b, status: "cancelled" }), at),
        ]);
        return { id: b.id };
      }
      case "POST /change": {
        const b = (await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(String(body.id)).first()) || bad("予約が見つかりません");
        if (b.status === "cancelled") bad("キャンセルした予約は変えられません");
        // 料金は予約したときの料金表で計算し直す。満室・受付停止の日への変更も受ける（宿の判断。要件 5節）
        const s = stay(site, body, b.price_version, now);
        const after = { ...b, checkin: ymd(s.checkin), checkout: ymd(s.checkout), nights: s.nights, guests: s.guests, per_person: s.price.perPerson, total: s.price.total, discount: s.price.discount, pay: s.price.pay };
        if (JSON.stringify(stayFields(after)) === JSON.stringify(stayFields(b))) bad("変わったところがありません");
        await db.batch([
          db.prepare("UPDATE bookings SET checkin = ?, checkout = ?, nights = ?, guests = ?, per_person = ?, total = ?, discount = ?, pay = ?, updated_at = ?, updated_by = ? WHERE id = ?")
            .bind(after.checkin, after.checkout, after.nights, after.guests, after.per_person, after.total, after.discount, after.pay, at, who, b.id),
          bookingHistory(db, user, b.id, "change", stayFields(b), stayFields(after), at),
        ]);
        return { id: b.id };
      }
      case "POST /info": {
        // お客様の情報の打ち間違いを直す。確かめはリリース1の予約画面と同じ
        // 変更履歴には、直した項目の前と後の値を残す。3年で個人情報を消すとき、この値も消す（cron.js）
        const b = (await db.prepare("SELECT * FROM bookings WHERE id = ?").bind(String(body.id)).first()) || bad("予約が見つかりません");
        if (b.pii_deleted_at) bad("この予約の個人情報は消去済みです");
        // 電話・メール・ご住所は、予約画面からの予約（source=web）だけ必須
        const next = validOrThrow("info", body, site, { source: b.source });
        const changed = Object.keys(next).filter((k) => (b[k] ?? "") !== next[k]);
        if (!changed.length) bad("変わったところがありません");
        await db.batch([
          db.prepare("UPDATE bookings SET name = ?, tel = ?, email = ?, address = ?, arrival = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?")
            .bind(next.name, next.tel, next.email, next.address, next.arrival, next.note, at, who, b.id),
          bookingHistory(db, user, b.id, "info", Object.fromEntries(changed.map((k) => [k, b[k] ?? ""])), Object.fromEntries(changed.map((k) => [k, next[k]])), at),
        ]);
        return { id: b.id, changed };
      }
      case "POST /memo": {
        const b = (await db.prepare("SELECT id FROM bookings WHERE id = ?").bind(String(body.id)).first()) || bad("予約が見つかりません");
        const { memo } = validOrThrow("memo", body, site);
        // メモの中身は変更履歴に入れない（変えたことだけ）
        await db.batch([
          db.prepare("UPDATE bookings SET inn_memo = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(memo, at, who, b.id),
          bookingHistory(db, user, b.id, "memo", null, null, at),
        ]);
        return { id: b.id };
      }
      case "POST /manual": {
        // 電話・LINE の予約。日付・泊数・人数・氏名（電話・メモは任意）。メールは送らない。不正利用対策の数には入れない
        const v = validOrThrow("manual", body, site, { now });
        const s = stay(site, v, site.price.current, now);
        const { name, tel, memo } = v;
        const full = await fullNights(site, db, s.checkin, s.checkout);
        // 満室・受付停止の日への登録も、知らせを出したうえで受ける（画面で知らせる）
        const bk = {
          source: "manual", status: "booked", checkin: ymd(s.checkin), checkout: ymd(s.checkout), nights: s.nights, guests: s.guests,
          per_person: s.price.perPerson, total: s.price.total, discount: s.price.discount, pay: s.price.pay, price_version: site.price.current,
          name, tel, email: "", address: "", arrival: "", note: "", inn_memo: memo, mail_guest: "none", mail_inn: "none", received_at: at,
        };
        for (let i = 0; i < 5; i++) {
          bk.id = bookingNo(now);
          const cols = Object.keys(bk);
          try {
            await db.batch([
              db.prepare(`INSERT INTO bookings (${cols.join(", ")}, ${AUDIT}) VALUES (${cols.map(() => "?").join(", ")}, ?, ?, ?, ?)`).bind(...cols.map((c) => bk[c]), at, who, at, who),
              bookingHistory(db, user, bk.id, "create", null, stayFields(bk), at),
            ]);
            return { id: bk.id, full };
          } catch (err) {
            if (!/UNIQUE|PRIMARY KEY|constraint/i.test(String(err?.message))) throw err;
          }
        }
        bad("混み合っています。もう一度お試しください");
      }
      case "GET /rules": {
        const from = parseYmd(q.from), to = addDays(parseYmd(q.to), 1);
        const [d, w, h] = await db.batch([
          db.prepare("SELECT day, stop, limit_count FROM day_rules WHERE day >= ? AND day < ? AND (stop IS NOT NULL OR limit_count IS NOT NULL) ORDER BY day").bind(ymd(from), ymd(to)),
          db.prepare("SELECT weekday, stop FROM weekly_rules ORDER BY weekday"),
          db.prepare("SELECT day, weekday, before_json, after_json, changed_at, changed_via, changed_by_user_id FROM rule_changes ORDER BY changed_at DESC LIMIT 100"),
        ]);
        const nameOf = await names(db);
        return {
          defaultLimit: site.maxOpen,
          days: d.results,
          weekly: w.results,
          history: h.results.map((x) => ({ target: x.day ? "day_rule" : "weekly_rule", key: x.day ?? String(x.weekday), before: JSON.parse(x.before_json || "null"), after: JSON.parse(x.after_json || "null"), at: x.changed_at, by: nameOf(x.changed_via, x.changed_by_user_id) })),
        };
      }
      case "POST /rules/day": {
        // 日・期間に「受付停止」「○件まで」「この日は受ける（定休日を外す）」「決まりを外す」
        // 期間（今日以降・始め ≦ 終わり・400日まで）・操作・件数は src/fields.js
        const v = validOrThrow("rulesDay", body, site, { now });
        const from = parseYmd(v.from), to = addDays(parseYmd(v.to), 1);
        const days = daysIn(from, to);
        const next = {
          stop: { stop: 1, limit_count: null },
          limit: { stop: null, limit_count: v.limit },
          open: { stop: 0, limit_count: v.limit },
          clear: { stop: null, limit_count: null },
        }[v.action];
        const { results } = await db.prepare("SELECT day, stop, limit_count FROM day_rules WHERE day >= ? AND day < ?").bind(ymd(from), ymd(to)).all();
        // 中身が空の行（決まりを外した日）は「決まりなし」と同じに扱う
        const empty = (r) => !r || (r.stop == null && r.limit_count == null);
        const cur = Object.fromEntries(results.filter((r) => !empty(r)).map((r) => [r.day, { stop: r.stop, limit_count: r.limit_count }]));
        const nextVal = empty(next) ? null : next;
        const stmts = [];
        for (const k of days) {
          const before = cur[k] || null;
          if (JSON.stringify(before) === JSON.stringify(nextVal)) continue;
          // 行は消さない（履歴の FK が指すため）。決まりを外すときは中身を空にする
          stmts.push(
            db.prepare(`INSERT INTO day_rules (day, stop, limit_count, ${AUDIT}) VALUES (?,?,?,?,?,?,?) ON CONFLICT (day) DO UPDATE SET stop = excluded.stop, limit_count = excluded.limit_count, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
              .bind(k, next.stop, next.limit_count, at, who, at, who)
          );
          stmts.push(ruleHistory(db, user, { day: k }, before, nextVal, at));
        }
        if (stmts.length) await db.batch(stmts);
        return { changed: stmts.length / 2 };
      }
      case "POST /rules/weekly": {
        // 定休日は印あり（true）／なしだけ。文字の "false" などは「なし」
        const v = validOrThrow("rulesWeekly", body, site);
        const wd = v.weekday, stop = v.stop ? 1 : 0;
        const cur = await db.prepare("SELECT stop FROM weekly_rules WHERE weekday = ?").bind(wd).first();
        if ((cur?.stop ?? 0) === stop) return { changed: 0 };
        await db.batch([
          db.prepare(`INSERT INTO weekly_rules (weekday, stop, ${AUDIT}) VALUES (?,?,?,?,?,?) ON CONFLICT (weekday) DO UPDATE SET stop = excluded.stop, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(wd, stop, at, who, at, who),
          ruleHistory(db, user, { weekday: wd }, { stop: cur?.stop ?? 0 }, { stop }, at),
        ]);
        return { changed: 1 };
      }
      case "GET /settings":
        // 見た目の設定（画面の色）。管理画面に入れる人ならだれでも見て変えられる（基本設計書 追補 2026-10-13 S-03）
        return { theme: await currentTheme(db), history: await settingHistory(db) };
      case "POST /settings": {
        // 知らない色は src/fields.js で断る。変えたら変更履歴（setting_changes）に、だれが・いつ・前→後を残す
        const { theme } = validOrThrow("settings", body, site);
        if (!(await setTheme(db, user, theme, at))) bad("変わったところがありません");
        return { theme, history: await settingHistory(db) };
      }
      default:
        return bad("ありません");
    }
  }
}
