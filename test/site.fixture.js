// 単体テストで使う施設の設定（架空の宿）。決まり（料金・受付・悪用対策）の値は最初の施設（リリース1）と同じにし、名前・住所・メールは架空のものにする
// 施設の設定がこの決まりと同じかは sites/<施設>/site.config.test.js で確かめる（施設の設定は公開しない）
import { defineSite } from "../src/config.js";

export default defineSite({
  innName: "試験の宿",
  adminUrl: "https://yoyaku.example.jp/admin",
  allowedOrigins: ["https://embed.example.jp"],
  admins: ["owner@example.com", "operator@example.com"],
  maxGuests: 19,
  price: {
    current: "r1",
    tables: {
      r1: {
        tiers: [
          { min: 1, max: 1, price: 5500 },
          { min: 2, max: 3, price: 5000 },
          { min: 4, max: 999, price: 4500 },
        ],
        longStay: [
          { minNights: 3, rate: 0.1 },
          { minNights: 7, rate: 0.15 },
        ],
      },
    },
  },
  bookingStart: "2026-10-10",
  maxNights: 30,
  bookingDaysAhead: 180,
  sameDay: false,
  maxOpen: 3,
  dailyLimit: 15,
  perContactDailyLimit: 3,
  maxLen: { name: 50, address: 100, note: 300 },
  noUrlFields: ["name", "address", "note"],
  // 到着予定の選択肢（予約画面の6つ。入力チェック仕様 2026-10-13：到着予定はこのどれか）
  arrivalOptions: ["15:00〜16:00", "16:00〜17:00", "17:00〜18:00", "18:00〜19:00", "19:00〜20:00", "20:00〜21:00"],
  checkIn: "15:00〜21:00",
  checkOut: "10:00",
  cancelPolicy: "7日前から30％、前日80％、当日・無断100％",
  payNote: "当日フロントでお支払いください。",
  contactLine: "https://line.example.jp/inn",
  contactTel: "03-0000-0000",
  safetyNote: "当館からメールでカード番号や事前の支払いを求めることはありません。",
  mail: {
    from: "試験の宿 <yoyaku@inn.example.jp>",
    notifyTo: "owner@example.com",
    replyTo: "owner@example.com",
    bcc: "operator@example.com",
  },
  piiRetentionYears: 3,
  accessLogDays: 90,
  privacyVersion: "第1版",
});
