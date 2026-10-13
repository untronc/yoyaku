// 画面の試験（accept.mjs・fields.mjs）で使う手元の道具：手元の D1（毎回消してマイグレーションから作り直す）・手元の wrangler dev・手元の確認ページ（dev/serve-embed.mjs）。
// テスト環境（リモート）・本番にはつながない。メールは送らない（e2e/site/wrangler.jsonc の MAIL_MODE=log）。起動した子プロセスは stopAll で止める
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { sign } from "../src/auth.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const SITE_CONFIG = "e2e/site/wrangler.jsonc";
export const API_PORT = 8786;
export const EMBED_PORT = 8788; // e2e/site/site.config.js の allowedOrigins と同じ番号
export const API = `http://localhost:${API_PORT}`;
export const EMBED = `http://localhost:${EMBED_PORT}/`;
export const SECRET = randomBytes(24).toString("hex"); // この実行だけの署名の鍵（どこにも残さない）

const children = [];

// ----- 子プロセス -----
export function start(name, args, opts = {}) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...opts });
  const out = [];
  const keep = (b) => { out.push(...String(b).split(/\r?\n/).filter(Boolean)); if (out.length > 400) out.splice(0, out.length - 400); };
  p.stdout.on("data", keep);
  p.stderr.on("data", keep);
  const child = { name, p, out };
  children.push(child);
  return child;
}
export function stopAll() {
  for (const c of children.splice(0)) {
    if (c.p.exitCode !== null || !c.p.pid) continue;
    // 自分で起動した子プロセスの木だけを止める
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(c.p.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { c.p.kill("SIGKILL"); } catch {} }
  }
}
function runWrangler(args, what) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" }, windowsHide: true });
  if (r.status !== 0) throw new Error(`${what}に失敗：${(r.stdout + r.stderr).split(/\r?\n/).filter(Boolean).slice(-8).join(" / ")}`);
  return r.stdout;
}
const portFree = (port) => new Promise((ok) => {
  const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
  s.listen(port, "127.0.0.1");
});
async function waitFor(url, what, child, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child.p.exitCode !== null) throw new Error(`${what}が途中で止まった：${child.out.slice(-6).join(" / ")}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${what}が${ms / 1000}秒で立ち上がらない：${child.out.slice(-6).join(" / ")}`);
}

/** 管理画面のログインの Cookie の値（Google を通さない。この実行の鍵で署名） */
export const sessionCookie = async (sub, secret = SECRET, exp = Date.now() + 3600000) => encodeURIComponent(await sign(secret, { sub, exp }));

/**
 * 手元の D1 をまっさらにし、利用者を入れ、wrangler dev と予約画面の確認ページを立ち上げる
 * @param state 手元の D1 の置き場（ROOT からの相対）
 * @param users [{ id, email, sub, active }]
 */
export async function startLocal({ state, users }) {
  for (const p of [API_PORT, EMBED_PORT]) if (!(await portFree(p))) throw new Error(`ポート ${p} が使われています（ほかの作業の wrangler など）。このスクリプトは止めません`);
  rmSync(`${ROOT}/${state}`, { recursive: true, force: true });
  runWrangler(["d1", "migrations", "apply", "DB", "--local", "-c", SITE_CONFIG, "--persist-to", state], "マイグレーション");
  const now = new Date().toISOString();
  const row = (u) => `INSERT INTO admin_users (id, email, google_sub, display_name, active, created_at, created_by, updated_at, updated_by) VALUES ('${u.id}', '${u.email}', '${u.sub}', '${u.id}', ${u.active}, '${now}', 'e2e', '${now}', 'e2e')`;
  runWrangler(["d1", "execute", "DB", "--local", "-c", SITE_CONFIG, "--persist-to", state, "--command", users.map(row).join("; ")], "利用者の登録");
  const wr = start("wrangler dev", [WRANGLER, "dev", "-c", SITE_CONFIG, "--port", String(API_PORT), "--persist-to", state, "--var", `SESSION_SECRET:${SECRET}`, "--show-interactive-dev-session=false"]);
  const emb = start("serve-embed", ["dev/serve-embed.mjs", String(EMBED_PORT), `${API}/api`]);
  await waitFor(`${API}/api?action=ping`, "wrangler dev", wr);
  await waitFor(EMBED, "予約画面の確認ページ", emb, 15000);
  return { wr, sql: (command) => JSON.parse(runWrangler(["d1", "execute", "DB", "--local", "-c", SITE_CONFIG, "--persist-to", state, "--json", "--command", command], "D1 の読み取り"))[0].results };
}
