// 料金・受付の範囲・空きの数え方。決まりはリリース1（gas/Code.gs）のまま
import { addDays, daysIn, parseYmd, todayJst, ymd } from "./dates.js";

/** 料金表の版 version で、人数・泊数の料金を出す（リリース1の price_） */
export function price(site, guests, nights, version = site.price.current) {
  const table = site.price.tables[version];
  if (!table) throw new Error("料金表がありません：" + version);
  const tier = table.tiers.find((t) => guests >= t.min && guests <= t.max);
  if (!tier) throw new Error("人数に合う料金がありません");
  const total = tier.price * guests * nights;
  const ls = (table.longStay || []).filter((x) => nights >= x.minNights).sort((a, b) => b.minNights - a.minNights)[0];
  const discount = ls ? Math.round(total * ls.rate) : 0;
  return { perPerson: tier.price, total, discount, pay: total - discount };
}

export const beforeStart = (site, d) => !!site.bookingStart && d < parseYmd(site.bookingStart);

/** 予約画面で選べる日か（リリース1の checkRange_） */
export function checkRange(site, checkin, nights, now) {
  const t = todayJst(now);
  if (!site.sameDay && checkin <= t) throw new Error("当日以前の日は選べません");
  if (checkin < t) throw new Error("過去の日は選べません");
  if (beforeStart(site, checkin)) throw new Error("ネット予約の受付は " + site.bookingStart + " のチェックインからです");
  if (checkin > addDays(t, site.bookingDaysAhead)) throw new Error("受付期間の外です");
  if (!(nights >= 1 && nights <= site.maxNights)) throw new Error("泊数が正しくありません");
}

/** 人数（リリース1の checkGuests_） */
export function checkGuests(site, guests) {
  if (!(guests >= 1)) throw new Error("人数が正しくありません");
  if (guests > site.maxGuests) throw new Error(site.maxGuests + 1 + "名以上のご予約は、公式LINEでご相談ください（" + site.contactLine + "）");
}

/** 受付条件を読む：{ day: { 'YYYY-MM-DD': {stop, limit_count} }, weekly: { 2: 1, ... } } */
export async function loadRules(db, from, to) {
  const [d, w] = await db.batch([
    db.prepare("SELECT day, stop, limit_count FROM day_rules WHERE day >= ? AND day < ?").bind(ymd(from), ymd(to)),
    db.prepare("SELECT weekday, stop FROM weekly_rules"),
  ]);
  const day = {};
  for (const r of d.results) day[r.day] = r;
  const weekly = {};
  for (const r of w.results) weekly[r.weekday] = r.stop;
  return { day, weekly };
}

/** その日の受付件数の上限。受付停止・定休日は 0。「この日は受ける」（stop=0）は定休日より優先 */
export function limitOf(site, rules, day) {
  const r = rules.day[day];
  if (r?.stop === 1) return 0;
  if (rules.weekly[parseYmd(day).getUTCDay()] === 1 && r?.stop !== 0) return 0;
  return r?.limit_count ?? site.maxOpen;
}
/** 受付停止・定休日か（管理画面の色分け用） */
export function stoppedOn(rules, day) {
  const r = rules.day[day];
  if (r?.stop === 1) return "stop";
  if (rules.weekly[parseYmd(day).getUTCDay()] === 1 && r?.stop !== 0) return "weekly";
  return "";
}

/** [from, to) の日ごとに泊まっている予約（状態＝予約）の件数・人数。電話・LINE の予約も数える */
export async function occupancy(db, from, to) {
  const { results } = await db
    .prepare("SELECT checkin, checkout, guests FROM bookings WHERE status = 'booked' AND checkin < ? AND checkout > ?")
    .bind(ymd(to), ymd(from))
    .all();
  const days = {};
  for (const k of daysIn(from, to)) days[k] = { count: 0, guests: 0 };
  for (const b of results) {
    for (const k of daysIn(parseYmd(b.checkin), parseYmd(b.checkout))) {
      if (days[k]) { days[k].count += 1; days[k].guests += b.guests; }
    }
  }
  return days;
}

/** 予約画面の月の表（リリース1の buildMonths_ と同じ形：{ok, month, days: {日: {rooms, closed}}}） */
export async function monthCalendar(site, db, month, now) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  if (!m) throw new Error("月の形が正しくありません");
  const from = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  const to = new Date(Date.UTC(+m[1], +m[2], 1));
  const [occ, rules] = await Promise.all([occupancy(db, from, to), loadRules(db, from, to)]);
  const t = todayJst(now);
  const days = {};
  for (const k of Object.keys(occ)) {
    const d = parseYmd(k);
    const closed = (site.sameDay ? d < t : d <= t) || d > addDays(t, site.bookingDaysAhead) || beforeStart(site, d);
    days[k] = { rooms: closed ? 0 : Math.max(0, limitOf(site, rules, k) - occ[k].count), closed };
  }
  return { ok: true, month, days };
}

/** 空きの確かめと料金（リリース1の quote_） */
export async function quote(site, db, checkinStr, nights, guests, now) {
  const checkin = parseYmd(checkinStr);
  checkRange(site, checkin, nights, now);
  checkGuests(site, guests);
  const checkout = addDays(checkin, nights);
  const [occ, rules] = await Promise.all([occupancy(db, checkin, checkout), loadRules(db, checkin, checkout)]);
  // リリース1と同じく、泊まる日のどれかが受付期間の外・満室・受付停止なら空きなし
  const last = addDays(todayJst(now), site.bookingDaysAhead);
  const full = Object.keys(occ).some((k) => parseYmd(k) > last || limitOf(site, rules, k) - occ[k].count < 1);
  if (full) return { ok: true, available: false, message: "その日程は空きがありません。日にちか人数を変えてお試しください。" };
  const table = site.price.tables[site.price.current];
  return { ok: true, available: true, checkin: ymd(checkin), checkout: ymd(checkout), nights, guests, price: price(site, guests, nights), longStay: table.longStay };
}
