// Worker の入口。施設の設定を受け取って、fetch と scheduled を返す
//   /api                 予約画面の API（api.js）
//   /admin               管理画面（ログインしていなければ Google のログインへ）
//   /admin/b/<予約番号>   予約通知メールのリンク。管理画面のその予約を開く
//   /admin/login・/admin/callback・/admin/logout
//   /admin/api/...       管理画面の API（admin.js）
//   /validate.js         画面の入力チェック（src/fields.js をこの施設の値つきで配る。予約画面と管理画面が読む）
import { handleAdminApi } from "./admin.js";
import { adminPage, messagePage } from "./admin-page.js";
import { handleApi } from "./api.js";
import { admit, clearStateCookie, currentUser, finishLogin, logoutCookie, startLogin } from "./auth.js";
import { dailyCleanup } from "./cron.js";
import { validateJs } from "./fields.js";

const SECURITY = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'",
};
const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY, ...extra } });

/** opts.now：「今」を返す関数（単体テストで日付を決めるため。ふだんは使わない） */
export function createWorker(site, opts = {}) {
  const clock = opts.now || (() => new Date());
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      // 送受信は HTTPS だけ（プライバシーポリシーに「予約画面の送受信は HTTPS」と書くため）。
      // HTTP で来たら、読むだけのものは HTTPS へ移し、書き込みは断る（中身を HTTP で受け取らない）。untronc.jp のゾーンの設定には頼らない
      if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        if (request.method === "GET" || request.method === "HEAD") {
          url.protocol = "https:";
          return new Response(null, { status: 301, headers: { Location: url.toString() } });
        }
        return new Response("HTTPS only", { status: 403 });
      }
      const res = await route(request, env, url);
      // ブラウザに「この住所は HTTPS だけ」と覚えてもらう（HSTS・1年）
      const h = new Headers(res.headers);
      h.set("Strict-Transport-Security", "max-age=31536000");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    },
    async scheduled(_event, env, ctx) {
      ctx.waitUntil(dailyCleanup(site, env));
    },
  };

  // 住所ごとの振り分け
  async function route(request, env, url) {
    const p = url.pathname;
    {
      if (p === "/api") return handleApi(site, request, env, clock());
      if (p === "/validate.js") {
        return new Response(validateJs(site), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
      }
      if (p === "/admin/login") return startLogin(site, env, url.searchParams.get("next"));
      if (p === "/admin/callback") {
        const who = await finishLogin(site, env, request);
        if (who.error) return html(messagePage(site, who.error, true), 400, { "Set-Cookie": clearStateCookie() });
        const c = await admit(site, env, who);
        if (!c) return html(messagePage(site, "このアカウント（" + who.email + "）では使えません。", true), 403, { "Set-Cookie": clearStateCookie() });
        const h = new Headers({ Location: who.next, "Cache-Control": "no-store" });
        h.append("Set-Cookie", c);
        h.append("Set-Cookie", clearStateCookie());
        return new Response(null, { status: 302, headers: h });
      }
      if (p === "/admin/logout") return html(messagePage(site, "ログアウトしました。", true), 200, { "Set-Cookie": logoutCookie() });
      if (p === "/admin" || p.startsWith("/admin/")) {
        const user = await currentUser(site, env, request);
        if (p.startsWith("/admin/api/")) {
          if (!user) return new Response(JSON.stringify({ ok: false, error: "login" }), { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } });
          return handleAdminApi(site, env, request, user, clock());
        }
        if (!user) return new Response(null, { status: 302, headers: { Location: "/admin/login?next=" + encodeURIComponent(p) } });
        return html(adminPage(site));
      }
      return new Response("Not found", { status: 404 });
    }
  }
}
