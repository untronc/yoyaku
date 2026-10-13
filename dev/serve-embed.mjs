// 手元の確認ページ：予約画面（web/embed.html）の呼び先を、手元の Worker（wrangler dev）に替えて出す
//   node dev/serve-embed.mjs [port] [api]   → http://localhost:8797/
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] || 8797);
const api = process.argv[3] || "http://localhost:8796/api";
const file = new URL("../../web/embed.html", import.meta.url);

createServer((req, res) => {
  if (req.url !== "/") { res.writeHead(404); return res.end(); }
  const html = readFileSync(file, "utf8").replace(/var YBK_API = '[^']*';/, `var YBK_API = '${api}';`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>予約画面（手元）</title><body style="margin:0">${html}</body>`);
}).listen(port, () => console.log(`http://localhost:${port}/ → ${api}`));
