// 予約画面（お客さま）。STUDIO の埋め込みには「この JS を読む数行」だけを貼り、画面・色・入力チェックはこの Worker が配る（基本設計書 追補 2026-10-13 S-04）
//   <div id="ybk" data-privacy="プライバシーポリシーの URL"></div>
//   <script src="https://<この Worker>/embed.js"></script>
// /embed.js の中身：入力チェック（src/fields.js・施設の値つき）＋ 料金の計算（src/rules.js の price）＋ 施設の文面 ＋ いまの色 ＋ 画面の HTML・CSS・JS。
// Bootstrap は同じ Worker の静的ファイル（/vendor/…）から読む。形は紙芝居の「アプリ風」（S-02。下に固定のボタン・大きな日の丸・− ＋）
// 前の埋め込み（web/embed.html）の動きはそのまま持つ：操作ログ（action:log・3秒ためて送る・閉じるときも送る）、読むだけの呼び出しの打ち切りと取り直し、
// 月の先読み、親への知らせ（高さ ybk-h・先頭へ ybk-top・GA4 用の ybk）、入力チェック（欄の下に出す・サーバーの errors も欄の下へ）。
// 埋め込みの枠（iframe）の中では、親が枠の高さを中身に合わせて伸ばす（web/parent-height.html）ので、上の帯と下のボタンを固定しない（html.ybk-framed）
import { BOOTSTRAP_CSS } from "./assets.js";
import { validateJs } from "./fields.js";
import { price } from "./rules.js";
import { embedCss, themeOf } from "./theme.js";

/** /embed.js の中身。origin はこの Worker の住所（API と Bootstrap の読み先） */
export function embedJs(site, theme, origin) {
  const table = site.price.tables[site.price.current];
  const conf = {
    api: origin + "/api",
    css: origin + BOOTSTRAP_CSS,
    theme: themeOf(theme),
    maxNights: site.maxNights,
    maxGuests: site.maxGuests,
    arrivalOptions: site.arrivalOptions,
    payNote: site.payNote,
    cancelPolicy: site.cancelPolicy,
    // 料金の目安（下のボタンの上の合計）。確定の料金はサーバーの quote・book
    price: { current: site.price.current, tables: { [site.price.current]: table } },
  };
  return `// 予約画面（${site.innName}）。src/embed-page.js から作った物
${validateJs(site)}(function () {
var __name = function (f) { return f; };
var YBK_PRICE = ${price.toString()};
var C = ${JSON.stringify(conf)};
var CSS = ${JSON.stringify(embedCss())};
var HTML = ${JSON.stringify(HTML)};
${SCRIPT}
})();
`;
}

const DONE_MARK = '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const top = (n, title, back) =>
  `<div class="app-top"><div class="app-top-row">${back ? `<button type="button" class="app-back" data-back="${back}" aria-label="戻る">‹</button>` : "<span></span>"}<h2 class="app-title">${title}</h2><span></span></div>` +
  `<div class="app-prog" role="progressbar" aria-label="進み具合 ${n}/4" aria-valuenow="${n * 25}" aria-valuemin="0" aria-valuemax="100">${[1, 2, 3, 4].map((i) => `<i${i <= n ? ' class="on"' : ""}></i>`).join("")}</div></div>`;
const stepper = (k, label, unit) =>
  `<div class="app-row"><span class="app-k">${label}</span><span class="app-stepper"><button type="button" class="app-sb" data-step-k="${k}" data-d="-1" aria-label="${label}を1つ減らす">−</button><b class="app-sv" data-sv="${k}" aria-live="polite"></b><button type="button" class="app-sb" data-step-k="${k}" data-d="1" aria-label="${label}を1つ増やす">+</button></span></div><div class="invalid-feedback" data-err="${k}"></div>`;
const fieldHtml = (k, label, req, control, hint) =>
  `<div class="ybk-f"><label class="form-label" for="ybk-${k}">${label}<span class="${req ? "req" : "opt"}">${req ? "必須" : "任意"}</span></label>${control}${hint ? `<div class="form-text">${hint}</div>` : ""}<div class="invalid-feedback" data-err="${k}"></div></div>`;
const cta = (go, label) => `<div class="app-cta"><div class="app-total" data-total></div><button type="button" class="btn btn-primary app-cta-btn" data-go="${go}">${label}</button></div>`;

const HTML =
  // STEP 1：日にちを選ぶ
  `<section class="ybk-step" data-step="1">${top(1, "日にちを選ぶ")}<p class="app-lead">チェックインの日を選んでください。</p>
<div class="app-cal-card"><div class="ybk-cal-head"><button type="button" class="ybk-nav" data-nav="-1" aria-label="前の月">‹</button><span class="ybk-month"></span><button type="button" class="ybk-nav" data-nav="1" aria-label="次の月">›</button></div><div class="ybk-cal" role="grid"></div></div>
<p class="app-legend"><span><i></i> 空きあり</span><span><b>残り1</b> 残りわずか</span><span>薄い日は選べません</span></p>
<div class="app-card"><div class="app-row"><span class="app-k">チェックイン</span><b data-v="checkin">—</b></div><div class="invalid-feedback" data-err="checkin"></div>
${stepper("nights", "泊数")}${stepper("guests", "人数")}<div class="app-row"><span class="app-k">チェックアウト</span><b data-v="checkout">—</b></div></div>
<div class="alert alert-danger ybk-msg" data-msg="1" role="alert"></div>${cta("quote", "次へ　お客さまの情報")}</section>` +
  // STEP 2：お客さまの情報
  `<section class="ybk-step" data-step="2" hidden>${top(2, "お客さまの情報", 1)}<p class="app-lead">ご宿泊される代表の方の情報を入力してください。</p><div data-sum></div>
<div class="app-form">
${fieldHtml("name", "お名前", true, '<input class="form-control" id="ybk-name" data-f="name" data-fk="name" autocomplete="name">', "ご宿泊される代表の方のお名前です。")}
${fieldHtml("tel", "電話番号", true, '<input class="form-control" id="ybk-tel" data-f="tel" data-fk="tel" type="tel" autocomplete="tel" inputmode="tel" placeholder="例：090-1234-5678">', "当日連絡がつく番号をお願いします。ハイフンはあってもなくても大丈夫です。")}
${fieldHtml("email", "メールアドレス", true, '<input class="form-control" id="ybk-email" data-f="email" data-fk="email" type="email" autocomplete="email">', "確認メールをお送りします。")}
${fieldHtml("address", "ご住所", true, '<input class="form-control" id="ybk-address" data-f="address" data-fk="address" autocomplete="street-address">', "都道府県からお書きください。")}
${fieldHtml("arrival", "到着予定時刻", true, '<select class="form-select" id="ybk-arrival" data-f="arrival" data-fk="arrival"></select>')}
${fieldHtml("note", "ご要望", false, '<textarea class="form-control" id="ybk-note" data-f="note" data-fk="note" rows="3"></textarea>')}
</div><div class="alert alert-danger ybk-msg" data-msg="2" role="alert"></div>${cta("confirm", "確認へ")}</section>` +
  // STEP 3：内容の確認
  `<section class="ybk-step" data-step="3" hidden>${top(3, "内容の確認", 2)}<p class="app-lead">内容をご確認のうえ、予約を確定してください。</p><div data-dl></div>
<p class="ybk-note" data-pay></p>
<label class="ybk-agree"><input class="form-check-input" type="checkbox" data-f="agree" data-fk="agree"> <span>キャンセル料に同意します</span></label><div class="invalid-feedback" data-err="agree"></div>
<label class="ybk-agree"><input class="form-check-input" type="checkbox" data-f="privacy" data-fk="privacyAgree"> <span><a data-privacy-link target="_blank" rel="noopener">プライバシーポリシー</a>（海外の事業者のサービスへの個人情報の提供を含む）に同意します</span></label><div class="invalid-feedback" data-err="privacyAgree"></div>
<div class="alert alert-danger ybk-msg" data-msg="3" role="alert"></div>${cta("book", "予約を確定する")}</section>` +
  // 完了
  `<section class="ybk-step" data-step="4" hidden>${top(4, "ご予約完了")}<div class="app-done-mark">${DONE_MARK}</div><h3 class="ybk-h">ご予約を承りました。<br>ありがとうございました。</h3><div data-done></div></section>`;

// 画面の JS（前の web/embed.html の動きを持ったまま、アプリ風の部品に合わせたもの）。サーバーから来た値・お客さまの入力は e() か textContent で入れる
const SCRIPT = String.raw`
  var script = document.currentScript;
  var root = document.getElementById('ybk');
  if (!root) { root = document.createElement('div'); root.id = 'ybk'; script.parentNode.insertBefore(root, script); }
  var framed = window.parent !== window;
  var html = document.documentElement;
  html.setAttribute('data-theme', C.theme);
  if (framed) html.classList.add('ybk-framed');
  // Bootstrap（Worker の静的ファイル）とこの画面の CSS。読み終わるまで中身を隠す（形の崩れた画面を見せない。4秒で出す）
  root.setAttribute('data-loading', '');
  var shown = function () { root.removeAttribute('data-loading'); sendHeight(); };
  var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = C.css; link.onload = shown; link.onerror = shown;
  var style = document.createElement('style'); style.textContent = CSS;
  (document.head || document.documentElement).appendChild(link);
  (document.head || document.documentElement).appendChild(style);
  setTimeout(shown, 4000);
  root.innerHTML = HTML;

  var YBK_API = C.api;
  var q = function (s) { return root.querySelector(s); };
  var qa = function (s) { return [].slice.call(root.querySelectorAll(s)); };
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  q('[data-privacy-link]').href = root.getAttribute('data-privacy') || '#';
  q('[data-f="arrival"]').innerHTML = C.arrivalOptions.map(function (o) { return '<option>' + e(o) + '</option>'; }).join('');
  q('[data-pay]').innerHTML = e(C.payNote) + '<br>キャンセル料：' + e(C.cancelPolicy) + '。';
  var state = { checkin: null, quote: null, month: null, nights: 1, guests: 1 };
  var yen = function (n) { return Number(n).toLocaleString('ja-JP') + '円'; };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var W = '日月火水木金土';
  // 2026-11-04 → 2026年11月4日（水）。年が同じならチェックアウト側は年を省く
  var jpDate = function (ymd, withYear) {
    var a = ymd.split('-').map(Number), w = W[new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay()];
    return (withYear === false ? '' : a[0] + '年') + a[1] + '月' + a[2] + '日（' + w + '）';
  };
  var jpShort = function (ymd) { return jpDate(ymd, false); };
  var addDays = function (ymd, n) { var a = ymd.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2] + n)).toISOString().slice(0, 10); };
  var stay = function (j) {
    return jpDate(j.checkin) + '〜' + jpDate(j.checkout, j.checkout.slice(0, 4) !== j.checkin.slice(0, 4)) + '　' + j.nights + '泊・' + j.guests + '名';
  };

  // アクセス記録（API の action=log → D1 の access_log）。個人情報は送らない（したこと・結果・かかった時間・エラーの文言・日程と人数・画面幅だけ）。
  // 1回ずつ送らず、3秒ためてまとめて送る。画面を閉じる・隠すときも送る
  var SID = Math.random().toString(36).slice(2, 10);
  var logQ = [], logTimer = null;
  function log(ev, ok, ms, err, info) {
    logQ.push({ at: new Date().toISOString(), sid: SID, ev: ev, ok: !!ok, ms: ms || '', err: err ? String(err).slice(0, 300) : '', info: info || '', w: String(window.innerWidth || '') });
    clearTimeout(logTimer); logTimer = setTimeout(flushLog, 3000);
  }
  function flushLog() {
    clearTimeout(logTimer);
    if (!logQ.length) return;
    var items = logQ.splice(0, 50);
    try {
      fetch(YBK_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'log', items: items }), keepalive: true }).catch(function () {});
    } catch (x) {}
    if (logQ.length) flushLog();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushLog(); });
  window.addEventListener('pagehide', flushLog);

  // info はアクセス記録の「内容」に入る（個人情報を入れない）
  // 読むだけの呼び出し（GET：calendar・quote）は 12 秒で打ち切り、1回だけ取り直す。
  // 予約の送信（POST：book）は二重予約を避けるため、打ち切りも取り直しもしない
  var READ_TIMEOUT = 12000, READ_RETRY = 1;
  function api(params, body, info, tries) {
    var url = YBK_API + (params ? '?' + new URLSearchParams(params).toString() : '');
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) } : {};
    var t0 = performance.now();
    var ev = (params && params.action) || (body && body.action);
    var read = !body, timer = null, ctl = (read && window.AbortController) ? new AbortController() : null;
    if (ctl) { opt.signal = ctl.signal; timer = setTimeout(function () { ctl.abort(); }, READ_TIMEOUT); }
    tries = tries || 0;
    return fetch(url, opt).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      j._ms = Math.round(performance.now() - t0);
      if (window.console) console.log('[ybk]', ev, j._ms + 'ms');
      log(ev, j.ok, j._ms, j.ok ? '' : j.error, (info || '') + (j.available === false ? ' 空きなし' : '') + (tries ? ' 取り直し' + tries : ''));
      return j;
    }, function (err) {
      clearTimeout(timer);
      var why = (err && err.name === 'AbortError') ? (READ_TIMEOUT / 1000) + '秒で打ち切り' : '通信できませんでした：' + String(err && err.message || err);
      log(ev, false, Math.round(performance.now() - t0), why, (info || '') + (tries ? ' 取り直し' + tries : ''));
      if (read && tries < READ_RETRY) return api(params, body, info, tries + 1);
      throw err;
    });
  }
  // 外側のページ（STUDIO /yoyaku のカスタムコード web/parent-ga4.html）へ知らせ、そこから GA4 に送る（流入元と結びつけるため）。個人情報は送らない
  function notify(name, j) {
    try { window.parent.postMessage({ type: 'ybk', event: name, nights: j.nights, guests: j.guests, value: j.price.pay, currency: 'JPY' }, '*'); } catch (x) {}
  }
  // STEP を替えたら先頭へ。埋め込みの中から scrollIntoView すると外側の固定ヘッダーの下に隠れるので、外側のページに頼む（2026-10-06）。外側が無いときだけ自分で動かす
  function show(n) {
    qa('.ybk-step').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== String(n); });
    total();
    sendHeight();
    if (framed) { try { window.parent.postMessage({ type: 'ybk-top' }, '*'); } catch (x) {} }
    else root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function msg(n, t) { q('[data-msg="' + n + '"]').textContent = t || ''; sendHeight(); }
  function f(name) {
    if (name === 'nights' || name === 'guests') return String(state[name]);
    var el = q('[data-f="' + name + '"]'); return el.type === 'checkbox' ? el.checked : el.value.trim();
  }

  // ----- 泊数・人数（− ＋）。人数は「上限＋1」を「○名以上」として選べ、サーバーが公式LINEへの案内を返す（2026-09-29 nao） -----
  var LIMIT = { nights: [1, C.maxNights], guests: [1, C.maxGuests + 1] };
  function countText(k, v) { return k === 'nights' ? v + '泊' : v > C.maxGuests ? v + '名以上' : v + '名'; }
  function syncCounts() {
    ['nights', 'guests'].forEach(function (k) {
      q('[data-sv="' + k + '"]').textContent = countText(k, state[k]);
      qa('[data-step-k="' + k + '"]').forEach(function (b) { var d = +b.getAttribute('data-d'); b.disabled = d < 0 ? state[k] <= LIMIT[k][0] : state[k] >= LIMIT[k][1]; });
    });
    q('[data-v="checkin"]').textContent = state.checkin ? jpShort(state.checkin) : '—';
    q('[data-v="checkout"]').textContent = state.checkin ? jpShort(addDays(state.checkin, state.nights)) : '—';
    total();
  }
  // 下のボタンの上の合計。STEP 1 はいまの選びで計算した目安、STEP 2・3 は空きと料金の答え（quote）
  function total() {
    var vis = qa('.ybk-step').filter(function (el) { return !el.hidden; })[0], step = vis ? vis.getAttribute('data-step') : '1';
    var h;
    if (step !== '1' && state.quote) {
      var p = state.quote.price;
      h = '<span>合計（' + state.quote.nights + '泊・' + state.quote.guests + '名' + (p.discount ? '・連泊割引後' : '') + '）</span><b>' + yen(p.pay) + '</b>';
    } else if (!state.checkin) h = '<span>チェックインの日を選んでください</span>';
    else if (state.guests > C.maxGuests) h = '<span>' + (C.maxGuests + 1) + '名以上のご予約は、公式LINEでご相談ください</span>';
    else {
      var x = YBK_PRICE(C, state.guests, state.nights);
      h = '<span>合計（' + state.nights + '泊・' + state.guests + '名' + (x.discount ? '・連泊割引後' : '') + '）</span><b>' + yen(x.pay) + '</b>';
    }
    qa('[data-total]').forEach(function (el) { el.innerHTML = h; });
  }

  // ----- 入力チェック（入力チェック仕様 2026-10-13） -----
  // この JS の先頭に入れた src/fields.js（施設の値つき）で、サーバーと同じ決まり・同じ文で判定する。まちがいは全部、その欄の下に出す
  var STEP_KEYS = { 1: ['checkin', 'nights', 'guests'], 2: ['name', 'tel', 'email', 'address', 'arrival', 'note'], 3: ['agree', 'privacyAgree'] };
  function input() {
    return { checkin: state.checkin || '', nights: state.nights, guests: state.guests, name: f('name'), tel: f('tel'), email: f('email'), address: f('address'), arrival: f('arrival'), note: f('note'), agree: f('agree'), privacyAgree: f('privacy') };
  }
  function showErrs(keys, errors) {
    keys.forEach(function (k) {
      var el = q('[data-err="' + k + '"]'); if (el) el.textContent = (errors && errors[k]) || '';
      qa('[data-fk="' + k + '"]').forEach(function (c) { c.classList.toggle('is-invalid', !!(errors && errors[k])); });
    });
    sendHeight();
  }
  // 注意が出ている欄を直し始めたら、その欄の注意を消す（もう一度判定するのは次へ進むとき）
  function clearOnEdit(ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[data-fk]');
    if (!t || !t.classList.contains('is-invalid')) return;
    showErrs([t.getAttribute('data-fk')], {});
  }
  root.addEventListener('input', clearOnEdit);
  root.addEventListener('change', clearOnEdit);
  // その STEP の項目を判定し、まちがいを欄の下に出す。まちがいが無ければ true
  function checkStep(n, form) {
    if (!window.YBK_FIELDS) return true;
    var r = window.YBK_FIELDS.validate(form, input(), window.YBK_SITE, {});
    var bad = STEP_KEYS[n].filter(function (k) { return r.errors[k]; });
    showErrs(STEP_KEYS[n], r.errors);
    if (bad.length) log('check', false, '', r.errors[bad[0]]);
    return !bad.length;
  }
  // サーバーが項目ごとの文を返したとき：その欄の下に出し、いちばん前の STEP へ戻す。返したら true
  function serverErrs(j, here) {
    if (!j.errors) return false;
    var first = 0;
    [1, 2, 3].forEach(function (n) {
      showErrs(STEP_KEYS[n], j.errors);
      if (!first && STEP_KEYS[n].some(function (k) { return j.errors[k]; })) first = n;
    });
    if (!first) return false;
    if (first !== here) show(first);
    return true;
  }

  // 月のカレンダー：一度取った月は覚えておき、表示した月の次の2か月を先に取っておく。
  // 同じ月を取りに行っている最中なら、その答えを待つ。表示中でない月の答えは描かない（月を続けて切り替えたときに古い月で上書きしない）
  var calCache = {}, calReq = {};
  var WEEK = W.split('').map(function (w) { return '<span class="w">' + w + '</span>'; }).join('');
  var monthKey = function (m) { return m.getFullYear() + '-' + pad(m.getMonth() + 1); };
  function fetchMonth(key) {
    if (calCache[key]) return Promise.resolve(calCache[key]);
    if (calReq[key]) return calReq[key];
    calReq[key] = api({ action: 'calendar', month: key }, null, key).then(function (j) {
      delete calReq[key];
      if (j.ok) calCache[key] = j;
      return j;
    }, function (err) { delete calReq[key]; throw err; });
    return calReq[key];
  }
  function prefetch(m, n) {
    for (var i = 1; i <= n; i++) fetchMonth(monthKey(new Date(m.getFullYear(), m.getMonth() + i, 1))).catch(function () {});
  }
  function loadMonth(d) {
    var m = new Date(d.getFullYear(), d.getMonth(), 1), key = monthKey(m);
    state.month = m;
    q('.ybk-month').textContent = m.getFullYear() + '年' + (m.getMonth() + 1) + '月';
    var cal = q('.ybk-cal');
    if (!calCache[key]) cal.innerHTML = WEEK + '<span class="ybk-wait">読み込み中…</span>';
    fetchMonth(key).then(function (j) {
      if (monthKey(state.month) !== key) return;
      if (!j.ok) { cal.innerHTML = WEEK; msg(1, j.error); return; }
      var h = WEEK;
      for (var b = 0; b < m.getDay(); b++) h += '<span></span>';
      Object.keys(j.days).sort().forEach(function (k) {
        // ○ 空きあり（小さな点）・△ 残りわずか（「残り N」）・× 満室・受付停止・− 受付期間外（何も出さず薄く）
        var d = j.days[k], mark = d.closed ? '−' : d.rooms >= 3 ? '○' : d.rooms >= 1 ? '△' : '×', dis = !d.rooms, sel = state.checkin === k;
        var mk = mark === '○' ? '<i aria-hidden="true"></i>' : mark === '△' ? '残り' + d.rooms : '';
        var lbl = (+k.slice(5, 7)) + '月' + (+k.slice(8)) + '日' + (mark === '○' ? '、空きあり' : mark === '△' ? '、残り' + d.rooms : '、選べません');
        h += '<button type="button" class="app-day' + (sel ? ' sel' : '') + '" data-day="' + k + '" data-mark="' + mark + '"' + (dis ? ' disabled' : '') + ' aria-label="' + lbl + '" aria-pressed="' + (sel ? 'true' : 'false') + '"><span class="dn">' + (+k.slice(8)) + '</span><span class="dk">' + mk + '</span></button>';
      });
      cal.innerHTML = h;
      sendHeight();
      if (q('[data-msg="1"]').getAttribute('data-calerr')) { q('[data-msg="1"]').removeAttribute('data-calerr'); msg(1, ''); }
      prefetch(m, 2);
    }).catch(function () {
      if (monthKey(state.month) !== key) return;
      cal.innerHTML = WEEK + '<span class="ybk-wait">空きを読み込めませんでした<br><button type="button" class="btn btn-outline-secondary btn-sm mt-2" data-retry>もう一度読み込む</button></span>';
      q('[data-msg="1"]').setAttribute('data-calerr', '1');
      msg(1, '何度か試しても読み込めないときは、公式LINEかお電話でお問い合わせください。');
    });
  }

  function confirmHtml() {
    var j = state.quote, p = j.price;
    var rows = [['お名前', f('name')], ['電話番号', f('tel')], ['メール', f('email')], ['ご住所', f('address')], ['到着予定', f('arrival')], ['ご要望', f('note') || 'なし']];
    return '<div class="app-card app-confirm">' +
      '<section class="app-sec"><div class="app-sec-h"><span>ご宿泊</span><button type="button" class="app-change" data-back="1">変更</button></div><div class="app-strong">' + e(jpShort(j.checkin) + ' 〜 ' + jpShort(j.checkout)) + '</div><div class="app-sub">' + j.nights + '泊・' + j.guests + '名・お部屋は宿で決めます（選べません）</div></section>' +
      '<section class="app-sec"><div class="app-sec-h"><span>お客さまの情報</span><button type="button" class="app-change" data-back="2">変更</button></div><dl class="app-dl">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + e(r[1]) + '</dd>'; }).join('') + '</dl></section>' +
      '<section class="app-sec app-price" data-price><div class="app-prow"><span>' + yen(p.perPerson) + ' × ' + j.guests + '名 × ' + j.nights + '泊</span><span>' + yen(p.total) + '</span></div>' +
      (p.discount ? '<div class="app-prow"><span>連泊割引</span><span>−' + yen(p.discount) + '</span></div>' : '') +
      '<div class="app-pay"><span>お支払い</span><b>' + yen(p.pay) + '</b></div></section></div>';
  }

  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button'); if (!t || !root.contains(t)) return;
    if (t.hasAttribute('data-nav')) return loadMonth(new Date(state.month.getFullYear(), state.month.getMonth() + Number(t.getAttribute('data-nav')), 1));
    if (t.hasAttribute('data-retry')) return loadMonth(state.month);
    if (t.hasAttribute('data-step-k')) {
      var k = t.getAttribute('data-step-k');
      state[k] = Math.max(LIMIT[k][0], Math.min(LIMIT[k][1], state[k] + Number(t.getAttribute('data-d'))));
      showErrs([k], null);
      return syncCounts();
    }
    if (t.hasAttribute('data-day')) {
      state.checkin = t.getAttribute('data-day');
      qa('.ybk-cal [data-day]').forEach(function (b) { b.classList.toggle('sel', b === t); b.setAttribute('aria-pressed', b === t ? 'true' : 'false'); });
      showErrs(['checkin'], null);
      syncCounts();
      return msg(1, '');
    }
    if (t.hasAttribute('data-back')) return show(t.getAttribute('data-back'));
    var go = t.getAttribute('data-go');
    if (go === 'quote') {
      if (!checkStep(1, 'quote')) return msg(1, '');
      t.disabled = true; msg(1, '');
      api({ action: 'quote', checkin: state.checkin, nights: f('nights'), guests: f('guests') }, null, state.checkin + ' ' + f('nights') + '泊 ' + f('guests') + '名').then(function (j) {
        t.disabled = false;
        if (!j.ok) { if (serverErrs(j, 1)) return msg(1, ''); return msg(1, j.error); }
        if (!j.available) return msg(1, j.message);
        state.quote = j;
        q('[data-sum]').innerHTML = '<div class="app-card app-stay"><div><div class="app-sub">ご宿泊</div><div class="app-strong">' + e(jpShort(j.checkin) + ' 〜 ' + jpShort(j.checkout)) + '</div><div class="app-sub">' + j.nights + '泊・' + j.guests + '名</div></div><button type="button" class="app-change" data-back="1">変更</button></div>';
        show(2);
        notify('yoyaku_quote', j);
      }).catch(function () { t.disabled = false; msg(1, '通信できませんでした。時間をおいてお試しください。'); });
    }
    if (go === 'confirm') {
      if (!checkStep(2, 'book')) return msg(2, '');
      q('[data-dl]').innerHTML = confirmHtml();
      msg(2, ''); show(3);
    }
    if (go === 'book') {
      if (!checkStep(3, 'book')) return msg(3, '');
      t.disabled = true; msg(3, '送信しています…');
      var qd = state.quote;
      api(null, { action: 'book', checkin: qd.checkin, nights: qd.nights, guests: qd.guests, name: f('name'), tel: f('tel'), email: f('email'), address: f('address'), arrival: f('arrival'), note: f('note'), agree: true, privacyAgree: true, src: src }, qd.checkin + ' ' + qd.nights + '泊 ' + qd.guests + '名').then(function (j) {
        t.disabled = false;
        if (!j.ok) { if (serverErrs(j, 3)) return msg(3, ''); return msg(3, j.error); }
        msg(3, '');
        var mail = j.mailOk === false ? '予約は受け付けました。確認メールは遅れて届く場合があります。ご質問・キャンセルは公式LINEかお電話でお知らせください。' : '届かないときや、ご質問・キャンセルは公式LINEかお電話でお知らせください。';
        q('[data-done]').innerHTML = '<div class="app-card text-center"><div class="app-sub">予約番号</div><div class="app-no">' + e(j.no) + '</div><div class="app-sub mt-1">' + e(stay(j)) + '</div></div>' +
          '<div class="app-card"><h4 class="app-h4">次にすること</h4><ol class="app-todo">' +
          '<li><div><b>確認メールをご覧ください</b><span data-mailnote>' + e(mail) + '</span></div></li>' +
          '<li><div><b>当日は ' + e(f('arrival')) + ' ごろにお越しください</b><span>ご到着が遅れるときは、公式LINEかお電話でお知らせください。</span></div></li>' +
          '<li><div><b>' + e(C.payNote) + '</b><span>キャンセル料：' + e(C.cancelPolicy) + '。</span></div></li></ol></div>';
        show(4);
        notify('yoyaku_complete', j);
      }).catch(function () { t.disabled = false; msg(3, '通信できませんでした。予約が入ったか分からないため、公式LINEかお電話でお問い合わせください。'); });
    }
  });

  // 流入元（要件差分 予約の流入元 2026-10-17）：外側のページ（サイト全体のカスタムコード web/site-source.html）に聞き、返ってきた値を予約に添える。
  // 受けるのは外側のページ（window.parent）からの返事だけ。返事が無くても予約はいつもどおり（src は null のまま）
  var src = null;
  window.addEventListener('message', function (e) {
    if (!framed || e.source !== window.parent) return;
    var d = e.data;
    if (d && d.type === 'ybk-src' && typeof d.src === 'object') src = d.src;
  });
  if (framed) { try { window.parent.postMessage({ type: 'ybk-src-ask' }, '*'); } catch (x) {} }

  // 画面の高さを外側のページ（STUDIO /yoyaku のカスタムコード web/parent-height.html）へ知らせ、枠の高さを中身に合わせてもらう（下に白い余白が残らないように。2026-10-06 nao）
  var lastH = 0;
  function sendHeight() {
    var h = Math.ceil(root.getBoundingClientRect().bottom + (window.scrollY || 0)) + 2;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    try { window.parent.postMessage({ type: 'ybk-h', h: h }, '*'); } catch (x) {}
  }
  if (window.ResizeObserver) new ResizeObserver(sendHeight).observe(root);
  window.addEventListener('load', sendHeight);
  window.addEventListener('resize', sendHeight);

  syncCounts();
  sendHeight();
  log('open', true);
  loadMonth(new Date());
`;
