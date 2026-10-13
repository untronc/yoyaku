// 予約画面（STUDIO の埋め込み）から呼ぶ API。呼び方と返す形はリリース1の Apps Script と同じ
//   GET  /api?action=calendar&month=2026-11
//   GET  /api?action=quote&checkin=2026-11-20&nights=2&guests=3
//   GET  /api?action=ping
//   POST /api  本文 JSON {action:'book', ...} / {action:'log', items:[...]}（Content-Type は text/plain）
import { book } from "./book.js";
import { monthCalendar, quote } from "./rules.js";

export function corsHeaders(site, origin) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && site.allowedOrigins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export async function handleApi(site, request, env, now = new Date()) {
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(site, origin);
  const out = (obj) => new Response(JSON.stringify(obj), { headers });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" } });
  }
  try {
    if (request.method === "GET") {
      const p = Object.fromEntries(new URL(request.url).searchParams);
      if (p.action === "calendar") return out(await monthCalendar(site, env.DB, p.month, now));
      if (p.action === "quote") return out(await quote(site, env.DB, p.checkin, Number(p.nights), Number(p.guests), now));
      if (p.action === "ping") return out({ ok: true, at: now.toISOString() });
      return out({ ok: false, error: "unknown action" });
    }
    if (request.method === "POST") {
      // 書き込みは、許可した住所の画面からだけ受ける
      if (!site.allowedOrigins.includes(origin)) return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers });
      let body;
      try { body = JSON.parse((await request.text()) || "{}"); } catch { return out({ ok: false, error: "壊れた入力です" }); }
      if (body.action === "book") return out(await book(site, env, body, now));
      if (body.action === "log") return out(await log(env.DB, body, now));
      return out({ ok: false, error: "unknown action" });
    }
    return new Response("Method not allowed", { status: 405, headers });
  } catch (err) {
    return out({ ok: false, error: String(err?.message ?? err) });
  }
}

/** 操作ログ（リリース1の log_。個人情報は受け取らない） */
async function log(db, body, now) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 50);
  if (!items.length) return { ok: true, n: 0 };
  const at = now.toISOString();
  const s = (v, n) => String(v ?? "").slice(0, n);
  await db.batch(
    items.map((it) =>
      db
        .prepare(
          "INSERT INTO access_log (id, received_at, client_at, visit_id, action, result, ms, error, detail, width, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,'guest',?,'guest')"
        )
        .bind(crypto.randomUUID(), at, s(it.at, 30), s(it.sid, 20), s(it.ev, 20), it.ok ? "成功" : "エラー", Number(it.ms) || null, s(it.err, 300), s(it.info, 200), s(it.w, 10), at, at)
    )
  );
  return { ok: true, n: items.length };
}
