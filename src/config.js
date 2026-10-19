// 施設の設定を確かめる。値の中身（料金・受付の決まり・文面）は施設の設定ファイル（sites/<名前>/site.config.js）に書き、ここには既定の値を置かない。
// 足りない項目があれば、起動の前に止める（決まっていない値を仮で埋めないため）

const REQUIRED = [
  "innName", "adminUrl", "allowedOrigins", "admins",
  "maxGuests", "price", "bookingStart", "maxNights", "bookingDaysAhead", "sameDay", "maxOpen",
  "dailyLimit", "perContactDailyLimit", "maxLen", "noUrlFields", "arrivalOptions",
  "checkIn", "checkOut", "cancelPolicy", "payNote", "contactLine", "contactTel", "safetyNote",
  "mail", "accessLogDays",
];

export function defineSite(site) {
  const missing = REQUIRED.filter((k) => site[k] === undefined || site[k] === null);
  if (missing.length) throw new Error(`施設の設定に足りない項目があります：${missing.join(", ")}`);
  if (!site.price.current || !site.price.tables?.[site.price.current]) throw new Error("price.current の料金表がありません");
  for (const k of ["from", "notifyTo", "replyTo"]) if (site.mail[k] === undefined) throw new Error(`mail.${k} がありません`);
  return Object.freeze({ ...site, admins: site.admins.map((a) => a.toLowerCase()) });
}
