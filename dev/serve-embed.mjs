// 手元の確認ページ：STUDIO に貼る数行（web/ClaudeCode_予約画面_埋め込み_読み込み型_テスト環境_2026-10-13.html）の読み先を、手元の Worker（wrangler dev）に替えて出す
//   node dev/serve-embed.mjs [port] [api]   → http://localhost:8797/
//   /         数行だけのページ（単独で開いた形。下のボタンは画面の下に固定）
//   /framed   STUDIO の形をまねたページ：親ページに web/parent-height.html・parent-ga4.html の中身を入れ、予約画面（/）を枠（iframe）で読む。
//             親の決まり（*.studioiframesandbox.com からの知らせだけ受ける）は、手元の住所（localhost）からも受けるように替えてある
//   /lp・/lp2 サイトのほかのページの見本：サイト全体のカスタムコード web/site-source.html だけを入れる（流入元の試験。/framed にも入れてある）
//   /old      前の埋め込み（web/embed.html を丸ごと貼る形）。本番の Worker がいまの埋め込みのままでも動くかを見るため
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] || 8797);
const api = process.argv[3] || "http://localhost:8796/api";
const origin = new URL(api).origin;
const web = (f) => readFileSync(new URL(`../../web/${f}`, import.meta.url), "utf8");
const SNIPPET = "ClaudeCode_予約画面_埋め込み_読み込み型_テスト環境_2026-10-13.html";
const page = (title, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0">${body}</body></html>`;
// 親ページのカスタムコード：知らせを受ける相手に手元の住所を足す（STUDIO では *.studioiframesandbox.com だけ）
const parentCode = (f) => web(f).split(String.raw`/\.studioiframesandbox\.com$/`).join(String.raw`/(\.studioiframesandbox\.com|^localhost)$/`);

createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  let html;
  if (path === "/") html = page("予約画面（手元）", web(SNIPPET).replace("https://yoyaku-test.untronc-nao.workers.dev", origin));
  else if (path === "/framed") {
    html = page("予約画面（手元・STUDIO の枠の形）",
      `<header style="position:sticky;top:0;z-index:5;height:68px;background:#183D43;color:#fff;display:flex;align-items:center;padding:0 18px;font:700 16px sans-serif">宿のサイト（見本の固定ヘッダー）</header>` +
      `<div style="max-width:720px;margin:0 auto;padding:24px 18px"><h1 style="font:700 20px sans-serif">ご予約</h1>` +
      `<sandbox-iframe style="display:block;height:1000px"><iframe src="/" title="予約" style="width:100%;height:100%;border:0;display:block"></iframe></sandbox-iframe>` +
      `<p style="font:14px sans-serif;color:#666">（ここから下はサイトのフッター）</p><div style="height:600px;background:#eee"></div></div>` +
      parentCode("site-source.html") + parentCode("parent-height.html") + parentCode("parent-ga4.html"));
  } else if (path === "/lp" || path === "/lp2") {
    html = page("サイトのほかのページ（手元）", `<p><a href="/framed">予約へ</a></p>` + parentCode("site-source.html"));
  } else if (path === "/old") html = page("前の予約画面（手元）", web("embed.html").replace(/var YBK_API = '[^']*';/, `var YBK_API = '${api}';`));
  if (!html) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}).listen(port, () => console.log(`http://localhost:${port}/ （/framed・/old）→ ${origin}`));
