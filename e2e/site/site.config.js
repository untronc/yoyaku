// 受け入れ試験用の設定。単体テストの架空の宿（test/site.fixture.js）の設定をそのまま使い、予約画面の呼び元に手元の確認ページ（accept.mjs の EMBED_PORT）だけを足す
// ポートは accept.mjs の EMBED_PORT と同じにすること
import base from "../../test/site.fixture.js";
import { defineSite } from "../../src/config.js";

export default defineSite({
  ...base,
  allowedOrigins: [...base.allowedOrigins, "http://localhost:8788"],
});
