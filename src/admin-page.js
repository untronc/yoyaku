// 管理画面の HTML（1枚。画面の切り替えはこの中の JS）。スマートフォンでの利用を優先する
// 見た目は Bootstrap 5.3.3（Worker の静的ファイル /vendor/… から読む。CDN に頼らない）と src/theme.js。形は紙芝居の Bootstrap 版（基本設計書 追補 2026-10-13 S-01）
// 色は <html data-theme> で決まる。「設定」で色を変えると、その場で属性を替える（再読み込みなしで効く）
// 画面：月の表（/admin）・日の予約（/admin/d/日付）・予約の詳細（/admin/b/予約番号）・予約を足す（/admin/new）・受付の設定（/admin/rules）・月ごとの数字（/admin/stats）・設定（/admin/settings）・名前（/admin/me）
import { BOOTSTRAP_CSS, BOOTSTRAP_JS, ICONS_CSS } from "./assets.js";
import { THEME_KEYS, THEMES, adminCss, themeOf } from "./theme.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function head(site, theme) {
  return `<!doctype html><html lang="ja" data-theme="${esc(themeOf(theme))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(site.innName)} 予約管理</title><link rel="stylesheet" href="${BOOTSTRAP_CSS}"><link rel="stylesheet" href="${ICONS_CSS}"><style>${adminCss()}</style></head>`;
}

export function messagePage(site, message, withLogin, theme) {
  return `${head(site, theme)}<body><nav class="navbar adm-nav"><div class="container-fluid adm-nav-in"><span class="navbar-brand">${esc(site.innName)} 予約管理</span></div></nav>
<main class="adm-main"><div class="card card-body shadow-sm"><p>${esc(message)}</p>${withLogin ? '<p class="mb-0"><a class="btn btn-primary" href="/admin/login"><i class="bi bi-google" aria-hidden="true"></i> Google でログイン</a></p>' : ""}</div></main></body></html>`;
}

export function adminPage(site, theme) {
  const nav = (href, icon, label, key, id) =>
    `<li class="nav-item"><a class="nav-link" href="${href}" data-go data-nav="${key}"${id ? ` id="${id}"` : ""}><i class="bi bi-${icon}" aria-hidden="true"></i> <span>${label}</span></a></li>`;
  return `${head(site, theme)}<body>
<nav class="navbar navbar-expand-md adm-nav"><div class="container-fluid adm-nav-in">
<a class="navbar-brand" href="/admin" data-go>${esc(site.innName)} 予約管理</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#admNav" aria-controls="admNav" aria-expanded="false" aria-label="メニューを開く"><span class="navbar-toggler-icon"></span></button>
<div class="collapse navbar-collapse" id="admNav"><ul class="navbar-nav me-auto">
${nav("/admin", "calendar3", "月の表", "month")}${nav("/admin/rules", "sliders", "受付の設定", "rules")}${nav("/admin/stats", "bar-chart-line", "月ごとの数字", "stats")}${nav("/admin/settings", "palette", "設定", "settings")}
</ul><ul class="navbar-nav"><li class="nav-item"><a class="nav-link" href="/admin/me" data-go data-nav="me"><i class="bi bi-person-circle" aria-hidden="true"></i> <span id="me">…</span></a></li></ul></div></div></nav>
<main class="adm-main" id="main"><p class="text-secondary">読み込み中…</p></main>
<div class="modal fade" id="cancelModal" tabindex="-1" aria-labelledby="cancelModalLabel" aria-hidden="true"><div class="modal-dialog modal-dialog-centered"><div class="modal-content">
<div class="modal-header"><h5 class="modal-title" id="cancelModalLabel"><i class="bi bi-exclamation-triangle-fill text-danger" aria-hidden="true"></i> この予約をキャンセルにしますか？</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="閉じる"></button></div>
<div class="modal-body"><p class="mb-2"><b id="cancelName"></b></p><p class="mb-0">キャンセルすると、空きがすぐ戻ります。お客様へのメールは送りません。<b class="text-danger">キャンセルは取り消せません。</b></p></div>
<div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">やめる</button><button type="button" class="btn btn-danger" id="doCancelOk">キャンセルにする</button></div>
</div></div></div>
<script src="${BOOTSTRAP_JS}"></script>
<script src="/validate.js"></script>
<script>var YBK_THEMES = ${JSON.stringify(Object.fromEntries(THEME_KEYS.map((k) => [k, { label: THEMES[k].label, note: THEMES[k].note, p: THEMES[k].p, solid: THEMES[k].solid, sub: THEMES[k].sub }])))};</script>
<script>${SCRIPT}</script></body></html>`;
}

// 画面の JS。サーバーから来た値は必ず e() でエスケープしてから HTML に入れる
const SCRIPT = String.raw`
(function () {
  var M = document.getElementById('main'), INFO = null;
  var W = '日月火水木金土';
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(n) { return Number(n || 0).toLocaleString('ja-JP') + '円'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parse(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function today() { return ymd(new Date(Date.now() + 9 * 3600000)); }
  function jp(s) { var d = parse(s); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日（' + W[d.getUTCDay()] + '）'; }
  function when(iso) { var d = new Date(new Date(iso).getTime() + 9 * 3600000); return ymd(d) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function bi(n) { return '<i class="bi bi-' + n + '" aria-hidden="true"></i>'; }
  function api(path, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ybk': '1' }, body: JSON.stringify(body) } : {};
    return fetch('/admin/api' + path, opt).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
      return r.json();
    }).then(function (j) { if (!j.ok) { var x = new Error(j.error || 'エラー'); x.errors = j.errors; throw x; } return j; });
  }
  function err(x) { return '<div class="alert alert-danger py-2" role="alert">' + bi('exclamation-triangle-fill') + ' ' + e(x && x.message || x) + '</div>'; }
  function loading() { M.innerHTML = '<p class="text-secondary">読み込み中…</p>'; }

  // ----- Bootstrap の小さな部品 -----
  function stBadge(b) { return b.status === 'booked' ? '<span class="badge text-bg-success">' + bi('check-circle-fill') + ' 予約中</span>' : '<span class="badge text-bg-secondary">' + bi('x-circle-fill') + ' キャンセル</span>'; }
  function srcBadge(b) { return b.source === 'manual' ? '<span class="badge text-bg-info">' + bi('telephone-fill') + ' 電話・LINE</span>' : '<span class="badge text-bg-light border">' + bi('globe2') + ' 予約画面</span>'; }
  function dash(v) { return v ? e(v) : '<span class="text-secondary">（未記入）</span>'; }
  function liRow(k, v) { return '<li class="list-group-item d-flex flex-column flex-sm-row gap-1 gap-sm-3"><span class="bs-k">' + k + '</span><span class="bs-v">' + v + '</span></li>'; }
  function lg(rows) { return '<ul class="list-group list-group-flush">' + rows.join('') + '</ul>'; }
  function cardBs(icon, title, body, attrs) { return '<div class="card mb-3 shadow-sm"' + (attrs || '') + '><div class="card-header fw-bold">' + bi(icon) + ' ' + title + '</div>' + body + '</div>'; }
  function crumbs(list) {
    return '<nav aria-label="breadcrumb"><ol class="breadcrumb mb-2 small">' + list.map(function (x, i) {
      return i === list.length - 1 ? '<li class="breadcrumb-item active" aria-current="page">' + x[0] + '</li>' : '<li class="breadcrumb-item"><a href="' + x[1] + '" data-go>' + x[0] + '</a></li>';
    }).join('') + '</ol></nav>';
  }
  /** 入力欄1つ：ラベル（必須／任意）・欄・説明・まちがいの文（data-err） */
  function field(key, id, label, req, inner, hint) {
    return '<div class="mb-3"><label class="form-label" for="' + id + '">' + label + (req === null ? '' : req ? '<span class="req">必須</span>' : '<span class="opt">任意</span>') + '</label>' + inner + (hint ? '<div class="form-text">' + hint + '</div>' : '') + errBox(key) + '</div>';
  }
  function input(key, id, v, extra) { return '<input class="form-control" id="' + id + '" data-fk="' + key + '" value="' + e(v) + '" ' + (extra || '') + '>'; }

  // ----- 入力チェック（/validate.js＝src/fields.js。サーバーと同じ決まり・同じ文）。まちがいは全部、その欄の下に出す -----
  function errBox(k) { return '<div class="invalid-feedback" data-err="' + k + '"></div>'; }
  function keysOf(form) { return window.YBK_FIELDS ? YBK_FIELDS.FORMS[form].map(function (f) { return f.key; }) : []; }
  function showErrs(box, errors, keys) {
    box.querySelectorAll('[data-err]').forEach(function (el) {
      var k = el.getAttribute('data-err');
      if (keys && keys.indexOf(k) < 0) return;
      el.textContent = (errors && errors[k]) || '';
      box.querySelectorAll('[data-fk="' + k + '"]').forEach(function (c) { c.classList.toggle('is-invalid', !!(errors && errors[k])); });
    });
  }
  /** 画面で判定する。まちがいがあれば欄の下に出して false（送らない） */
  function checkForm(box, form, input, ctx) {
    if (!window.YBK_FIELDS) return true;
    var r = YBK_FIELDS.validate(form, input, window.YBK_SITE, ctx || {});
    showErrs(box, r.errors, keysOf(form));
    return r.ok;
  }
  /** サーバーが項目ごとの文を返したら欄の下に、それ以外は枠（out）に出す */
  function fail(box, out, x) {
    if (x && x.errors) { showErrs(box, x.errors); return; }
    out(x);
  }
  function arrivalSel(id, v) {
    var opts = (window.YBK_SITE && YBK_SITE.arrivalOptions || []).slice();
    if (v && opts.indexOf(v) < 0) opts.push(v);
    return '<select class="form-select" id="' + id + '" data-fk="arrival"><option value="">（未記入）</option>' + opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + e(o) + '</option>'; }).join('') + '</select>';
  }
  function maxText(form, key) {
    var f = window.YBK_FIELDS && YBK_FIELDS.FORMS[form].filter(function (x) { return x.key === key; })[0];
    return f && typeof f.max === 'number' ? f.max + '字まで' : '';
  }
  function sel(id, key, lo, hi, v, unit) {
    var h = '<select class="form-select" id="' + id + '" data-fk="' + key + '">';
    for (var i = lo; i <= hi; i++) h += '<option value="' + i + '"' + (i === v ? ' selected' : '') + '>' + i + unit + '</option>';
    return h + '</select>';
  }
  function val(id) { return document.getElementById(id).value; }

  // ----- 画面の切り替え -----
  function go(path) { history.pushState(null, '', path); route(); }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-go]');
    if (a) {
      ev.preventDefault();
      var c = document.getElementById('admNav');
      if (c && c.classList.contains('show') && window.bootstrap) bootstrap.Collapse.getOrCreateInstance(c).hide();
      go(a.getAttribute('href'));
    }
  });
  window.addEventListener('popstate', route);
  function setNav(key) {
    document.querySelectorAll('.adm-nav [data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === key;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function route() {
    var p = location.pathname, m;
    window.scrollTo(0, 0);
    if ((m = /^\/admin\/b\/([\w-]+)$/.exec(p))) { setNav('month'); return booking(decodeURIComponent(m[1])); }
    if ((m = /^\/admin\/d\/(\d{4}-\d{2}-\d{2})$/.exec(p))) { setNav('month'); return day(m[1]); }
    if (p === '/admin/new') { setNav('month'); return addForm(new URLSearchParams(location.search).get('d')); }
    if (p === '/admin/rules') { setNav('rules'); return rules(); }
    if (p === '/admin/stats') { setNav('stats'); return stats(); }
    if (p === '/admin/settings') { setNav('settings'); return settings(); }
    if (p === '/admin/me') { setNav('me'); return me(); }
    setNav('month');
    return month(new URLSearchParams(location.search).get('m') || today().slice(0, 7));
  }

  // ----- 月ごとの数字（チェックインの月ごと。キャンセルは件数だけ。試しの予約は入れない） -----
  function stats() {
    loading();
    api('/stats').then(function (j) {
      var max = Math.max.apply(null, j.months.map(function (x) { return x.total.pay; }).concat([1]));
      var label = function (mo) { return mo.slice(0, 4) + '年' + (+mo.slice(5)) + '月'; };
      var h = '<h1>月ごとの数字</h1><p class="form-text">泊まる月（チェックインの月）ごと。月をまたぐ予約はチェックインの月に入れる。金額は予約の合計（連泊割引のあと）。キャンセルは件数だけで、件数・金額には入れない。名前に「テスト」「試験」を含む予約は入れない。</p>';
      h += cardBs('bar-chart-fill', '月ごとの金額の比べ', '<div class="card-body bs-bars">' + j.months.map(function (x) {
        var pct = Math.round(x.total.pay / max * 100);
        return '<div class="d-flex align-items-center gap-2 mb-2"><span class="bar-label">' + label(x.month) + '</span><div class="progress flex-grow-1" role="progressbar" aria-label="' + label(x.month) + 'の金額" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:' + pct + '%"></div></div><span class="fw-bold text-end" style="flex:0 0 6.2em;font-size:.8125rem">' + yen(x.total.pay) + '</span></div>';
      }).join('') + '</div>');
      var row = function (key, name, v, tag) { return '<tr data-row="' + key + '"><' + tag + '>' + name + '</' + tag + '><td>' + v.count + '件</td><td>' + v.guests + '名</td><td>' + v.nights + '泊</td><td>' + yen(v.pay) + '</td></tr>'; };
      j.months.forEach(function (x) {
        h += '<div class="card mb-3 shadow-sm" data-month="' + e(x.month) + '"><div class="card-header d-flex justify-content-between align-items-center fw-bold"><a href="/admin?m=' + e(x.month) + '" data-go>' + bi('calendar3') + ' ' + label(x.month) + '</a><span class="badge ' + (x.cancelled ? 'text-bg-secondary' : 'text-bg-light border') + '" data-row="cancelled">キャンセル ' + x.cancelled + '件</span></div>' +
          '<div class="table-responsive"><table class="table table-striped table-sm mb-0 align-middle"><thead><tr><th scope="col"></th><th scope="col">件数</th><th scope="col">人数</th><th scope="col">泊数</th><th scope="col">金額</th></tr></thead><tbody>' +
          row('web', 'ネット予約', x.web, 'td') + row('manual', '電話・LINE', x.manual, 'td') + '</tbody><tfoot class="table-group-divider">' + row('total', '合計', x.total, 'td').replace('<tr ', '<tr class="table-primary fw-bold" ') + '</tfoot></table></div></div>';
      });
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 月の表（予約のある日は薄い主の色、上限に達した日は主の色の塗り、停止・定休は灰） -----
  function month(mo) {
    loading();
    var y = +mo.slice(0, 4), mm = +mo.slice(5, 7);
    var prev = ymd(new Date(Date.UTC(y, mm - 2, 1))).slice(0, 7), next = ymd(new Date(Date.UTC(y, mm, 1))).slice(0, 7);
    api('/month?m=' + mo).then(function (j) {
      var t = today(), first = new Date(Date.UTC(y, mm - 1, 1)).getUTCDay();
      var h = '<div class="d-flex justify-content-between align-items-center gap-2 mb-2"><a class="btn btn-outline-secondary btn-sm" href="/admin?m=' + prev + '" data-go>' + bi('chevron-left') + ' 前の月</a><h1 class="mb-0">' + y + '年' + mm + '月</h1><a class="btn btn-outline-secondary btn-sm" href="/admin?m=' + next + '" data-go>次の月 ' + bi('chevron-right') + '</a></div>';
      h += '<div class="card card-body p-2 mb-2 shadow-sm"><div class="heat-grid">' + W.split('').map(function (w) { return '<div class="w">' + w + '</div>'; }).join('');
      for (var i = 0; i < first; i++) h += '<div></div>';
      Object.keys(j.days).forEach(function (k) {
        var d = j.days[k], lv = d.stop ? 's' : !d.count ? '0' : d.count >= d.limit ? 'f' : '1';
        var tag = d.stop === 'stop' ? '<span class="badge text-bg-secondary">停止</span>' : d.stop === 'weekly' ? '<span class="badge text-bg-secondary">定休</span>' : '';
        // 受付停止・定休日でも予約があれば人数を出す（受け入れ試験 K4・2026-10-12）
        h += '<a class="heat heat-' + lv + (k === t ? ' today' : '') + '" href="/admin/d/' + k + '" data-go><b>' + (+k.slice(8)) + '</b><span class="n">' + (d.stop ? d.count + '件' : d.count + '/' + d.limit + '件') + '</span>' +
          '<span class="s">' + tag + (d.guests ? (tag ? ' ' : '') + d.guests + '名' : (tag ? '' : '&nbsp;')) + '</span></a>';
      });
      h += '</div></div>';
      h += '<div class="d-flex flex-wrap small mb-3" style="gap:.4rem 1rem" aria-label="凡例"><span><i class="sw heat-0"></i>0件</span><span><i class="sw heat-1"></i>予約あり</span><span><i class="sw heat-f"></i>上限</span><span><i class="sw heat-s"></i>停止・定休</span></div>';
      h += '<p><a class="btn btn-primary" href="/admin/new" data-go>' + bi('plus-lg') + ' 電話・LINE の予約を足す</a></p>';
      h += '<p class="form-text">「1/3件」は、その日の夜に泊まる予約の件数／受付件数の上限（キャンセルを除く）。下の数は人数。薄い色の日は予約のある日、濃く塗った日は上限に達した日です。</p>';
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 日の予約 -----
  function day(d) {
    loading();
    api('/day?d=' + d).then(function (j) {
      var on = j.bookings.filter(function (b) { return b.status === 'booked'; }), off = j.bookings.filter(function (b) { return b.status !== 'booked'; });
      var h = crumbs([['月の表', '/admin?m=' + d.slice(0, 7)], [jp(d), '']]) + '<h1>' + jp(d) + ' の夜</h1>';
      h += '<p class="text-secondary small">' + (j.stop === 'stop' ? '受付停止' : j.stop === 'weekly' ? '定休日' : '受付件数の上限 ' + j.limit + '件') + '・予約 ' + on.length + '件</p>';
      h += on.length ? '<div class="list-group shadow-sm mb-3">' + on.map(row).join('') + '</div>' : '<div class="alert alert-light border">この夜の予約はありません。</div>';
      if (off.length) h += '<h2>キャンセルした予約</h2><div class="list-group shadow-sm mb-3">' + off.map(row).join('') + '</div>';
      h += '<p><a class="btn btn-primary" href="/admin/new?d=' + d + '" data-go>' + bi('plus-lg') + ' この日に予約を足す</a></p>';
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }
  function row(b) {
    return '<a class="list-group-item list-group-item-action py-3' + (b.status !== 'booked' ? ' text-secondary' : '') + '" href="/admin/b/' + encodeURIComponent(b.id) + '" data-go><div class="d-flex justify-content-between align-items-start gap-2"><div class="d-flex flex-wrap align-items-center gap-2"><b>' + e(b.name || '（消去済み）') + ' 様</b>' + stBadge(b) + srcBadge(b) + '</div>' + bi('chevron-right') + '</div>' +
      '<div class="small text-secondary mt-1">' + e(b.guests) + '名・' + e(b.nights) + '泊（' + e(b.checkin.slice(5)) + '〜' + e(b.checkout.slice(5)) + '）・' + yen(b.pay) + (b.inn_memo ? '・' + bi('sticky') + ' メモあり' : '') + '</div></a>';
  }

  // ----- 予約の詳細 -----
  var KIND = { create: '作成', cancel: 'キャンセル', change: '日付・人数の変更', memo: 'メモを変更', info: 'お客様の情報を直す' };
  var KICON = { create: 'plus-lg', cancel: 'x-lg', change: 'arrow-left-right', memo: 'journal-text', info: 'pencil-fill' };
  var FIELD = { name: 'お名前', tel: '電話', email: 'メール', address: 'ご住所', arrival: '到着予定', note: 'ご要望' };
  function infoText(x) { if (!x.before) return '（3年たったので値は消去済み）'; return Object.keys(x.after).map(function (k) { return (FIELD[k] || k) + '：' + (x.before[k] || '（空）') + ' → ' + (x.after[k] || '（空）'); }).join('\n'); }
  function stayText(s) { return s ? s.checkin + '〜' + s.checkout + '（' + s.nights + '泊）' + s.guests + '名・' + yen(s.pay) : ''; }
  function mailText(v) {
    if (v === 'sent') return '<span class="badge text-bg-success">' + bi('check-lg') + ' 送信済み</span>';
    if (/^skipped: /.test(v || '')) return '送っていない（' + e(v.slice(9)) + '）';
    if (/^failed: /.test(v || '')) return '<span class="text-danger">送れなかった（' + e(v.slice(8)) + '）</span>';
    return dash(v);
  }
  function booking(id) {
    loading();
    api('/booking?id=' + encodeURIComponent(id)).then(function (j) {
      var b = j.booking, live = b.status === 'booked', name = b.name || '（個人情報は消去済み）';
      var h = crumbs([['月の表', '/admin?m=' + b.checkin.slice(0, 7)], [jp(b.checkin), '/admin/d/' + b.checkin], [e(name) + ' 様', '']]);
      h += '<h1 class="d-flex flex-wrap align-items-center gap-2">' + e(name) + ' 様 ' + stBadge(b) + srcBadge(b) + '</h1>';
      h += cardBs('moon-stars', '宿泊', lg([
        liRow('予約番号', e(b.id)), liRow('宿泊', jp(b.checkin) + '〜' + jp(b.checkout) + '　' + e(b.nights) + '泊'), liRow('人数', e(b.guests) + '名'),
        liRow('受付', when(b.received_at) + '（' + (b.source === 'manual' ? '電話・LINE' : '予約画面') + '）')
      ].concat(b.cancelled_at ? [liRow('キャンセル', '<span class="text-danger">' + when(b.cancelled_at) + '</span>')] : [])));
      h += cardBs('person-lines-fill', 'お客様', lg([
        liRow('電話', b.tel ? '<a href="tel:' + e(b.tel.replace(/[^\d+]/g, '')) + '">' + e(b.tel) + '</a>' : dash('')), liRow('メール', dash(b.email)), liRow('ご住所', dash(b.address)),
        liRow('到着予定', dash(b.arrival)), liRow('ご要望', dash(b.note))
      ]));
      h += cardBs('cash-coin', 'お支払い', '<ul class="list-group list-group-flush"><li class="list-group-item bs-price">' +
        '<div class="bs-row"><span>' + yen(b.per_person) + ' × ' + e(b.guests) + '名 × ' + e(b.nights) + '泊</span><span>' + yen(b.total) + '</span></div>' +
        (b.discount ? '<div class="bs-row"><span>連泊割引</span><span>−' + yen(b.discount) + '</span></div>' : '') +
        '<hr class="my-2"><div class="d-flex justify-content-between align-items-baseline gap-2"><span class="fw-bold">お支払い</span><span class="bs-total">' + yen(b.pay) + '</span></div></li></ul>');
      h += cardBs('envelope', 'メール', b.source === 'web'
        ? lg([liRow('確認メール', mailText(b.mail_guest)), liRow('宿への通知', mailText(b.mail_inn))])
        : lg([liRow('送信', '<span class="badge text-bg-secondary">送っていません</span>')]));
      h += cardBs('shield-check', '同意', b.privacy_agreed_at
        ? lg([liRow('個人情報', '<span class="badge text-bg-success">' + bi('check2-circle') + ' 同意済み</span> プライバシーポリシーに同意（' + when(b.privacy_agreed_at) + '・版 ' + e(b.privacy_version) + '）')])
        : lg([liRow('個人情報', '<span class="badge text-bg-secondary">記録なし</span>')]));
      if (!b.pii_deleted_at) {
        h += '<h2 class="mt-4">お客様の情報を直す</h2><div class="card mb-3 shadow-sm"><div class="card-body" id="infoCard">' +
          field('name', 'fNm', 'お名前', true, input('name', 'fNm', b.name)) +
          field('tel', 'fTel', '電話', b.source === 'web', input('tel', 'fTel', b.tel, 'inputmode="tel"'), 'ハイフンはあってもなくても大丈夫です。') +
          field('email', 'fEm', 'メール', b.source === 'web', input('email', 'fEm', b.email, 'inputmode="email"'), '確認メールの送り先。直してもメールは送りません。') +
          field('address', 'fAd', 'ご住所', b.source === 'web', input('address', 'fAd', b.address)) +
          field('arrival', 'fAr', '到着予定', false, arrivalSel('fAr', b.arrival || '')) +
          field('note', 'fNo', 'ご要望', false, '<textarea class="form-control" id="fNo" data-fk="note" style="min-height:90px">' + e(b.note) + '</textarea>') +
          '<div id="fMsg"></div><button class="btn btn-outline-primary" id="saveInfo">' + bi('save') + ' 直した内容を保存</button><div class="form-text mt-2">直す前と後の値は変更履歴に残ります。お客様へのメールは送りません。</div></div></div>';
      }
      h += '<h2>宿のメモ（お客様には見えません）</h2><div class="card mb-3 shadow-sm"><div class="card-body" id="memoCard">' +
        field('memo', 'memo', '宿のメモ', false, '<textarea class="form-control" id="memo" data-fk="memo" style="min-height:90px">' + e(b.inn_memo) + '</textarea>', maxText('memo', 'memo')) +
        '<button class="btn btn-outline-primary" id="saveMemo">' + bi('save') + ' メモを保存</button> <span id="memoMsg" class="text-secondary small"></span></div></div>';
      if (live) {
        h += '<h2>日付・人数を変える</h2><div class="card mb-3 shadow-sm"><div class="card-body" id="chCard"><div class="row g-2">' +
          '<div class="col-12 col-sm-6"><label class="form-label" for="ci">チェックイン</label><input type="date" class="form-control" id="ci" data-fk="checkin" value="' + e(b.checkin) + '">' + errBox('checkin') + '</div>' +
          '<div class="col-6 col-sm-3"><label class="form-label" for="ni">泊数</label>' + sel('ni', 'nights', 1, INFO.maxNights, b.nights, '泊') + errBox('nights') + '</div>' +
          '<div class="col-6 col-sm-3"><label class="form-label" for="gu">人数</label>' + sel('gu', 'guests', 1, INFO.maxGuests, b.guests, '名') + errBox('guests') + '</div></div>' +
          '<div id="chq" class="mt-3"></div><button class="btn btn-primary" id="doChange">この内容に変える</button></div></div>';
        h += '<h2>キャンセル</h2><div class="card border-danger mb-3"><div class="card-body"><p class="text-secondary small">キャンセルすると、空きがすぐ戻ります。お客様へのメールは送りません。キャンセルは取り消せません。</p><button class="btn btn-outline-danger" id="doCancel" data-bs-toggle="modal" data-bs-target="#cancelModal">' + bi('x-circle') + ' キャンセルにする</button></div></div>';
      }
      h += cardBs('clock-history', '変更履歴<span class="fw-normal small text-secondary ms-2">新しい順</span>', '<ol class="timeline">' + j.history.slice().reverse().map(function (x) {
        var detail = x.kind === 'change' ? stayText(x.before) + '\n→ ' + stayText(x.after) : x.kind === 'create' ? stayText(x.after) : x.kind === 'info' ? infoText(x) : '';
        return '<li class="tl-item"><span class="tl-dot">' + bi(KICON[x.kind] || 'circle') + '</span><div class="tl-body"><div class="d-flex flex-wrap justify-content-between gap-1"><b>' + e(KIND[x.kind] || x.kind) + '</b><time class="small text-secondary">' + when(x.at) + '</time></div><div class="small text-secondary">' + bi('person') + ' ' + e(x.by) + '</div>' + (detail ? '<div class="tl-detail">' + e(detail) + '</div>' : '') + '</div></li>';
      }).join('') + '</ol>', ' id="history"');
      M.innerHTML = h;
      if (!b.pii_deleted_at) document.getElementById('saveInfo').onclick = function () {
        var m = document.getElementById('fMsg'), box = document.getElementById('infoCard'); m.innerHTML = '';
        var input = { name: val('fNm'), tel: val('fTel'), email: val('fEm'), address: val('fAd'), arrival: val('fAr'), note: val('fNo') };
        if (!checkForm(box, 'info', input, { source: b.source })) return;
        input.id = b.id;
        api('/info', input).then(function () { booking(b.id); }).catch(function (x) { fail(box, function (y) { m.innerHTML = err(y); }, x); });
      };
      document.getElementById('saveMemo').onclick = function () {
        var t = document.getElementById('memoMsg'), box = document.getElementById('memoCard'), input = { memo: document.getElementById('memo').value };
        t.textContent = '';
        if (!checkForm(box, 'memo', input)) return;
        t.textContent = '保存中…';
        api('/memo', { id: b.id, memo: input.memo }).then(function () { booking(b.id); }).catch(function (x) { t.textContent = ''; fail(box, function (y) { t.textContent = y.message; }, x); });
      };
      if (!live) return;
      document.getElementById('cancelName').textContent = name + ' 様（' + b.id + '）　' + jp(b.checkin) + '〜' + jp(b.checkout);
      var chBox = document.getElementById('chCard');
      var show = function () {
        var body = { id: b.id, checkin: val('ci'), nights: +val('ni'), guests: +val('gu') };
        if (!checkForm(chBox, 'stay', body)) { document.getElementById('chq').innerHTML = ''; return; }
        api('/quote', body).then(function (q) { document.getElementById('chq').innerHTML = quoteHtml('変更後：', body.checkin, q, '変える'); })
          .catch(function (x) { fail(chBox, function (y) { document.getElementById('chq').innerHTML = err(y); }, x); });
      };
      ['ci', 'ni', 'gu'].forEach(function (k) { document.getElementById(k).onchange = show; });
      document.getElementById('doChange').onclick = function () {
        var body = { id: b.id, checkin: val('ci'), nights: +val('ni'), guests: +val('gu') };
        if (!checkForm(chBox, 'stay', body)) return;
        this.disabled = true;
        api('/change', body).then(function () { booking(b.id); }).catch(function (x) { fail(chBox, function (y) { document.getElementById('chq').innerHTML = err(y); }, x); document.getElementById('doChange').disabled = false; });
      };
      document.getElementById('doCancelOk').onclick = function () {
        var ok = this;
        ok.disabled = true;
        api('/cancel', { id: b.id }).then(function () { hideModal(); ok.disabled = false; booking(b.id); })
          .catch(function (x) { hideModal(); ok.disabled = false; M.insertAdjacentHTML('afterbegin', err(x)); });
      };
    }).catch(function (x) { M.innerHTML = err(x); });
  }
  function hideModal() { var el = document.getElementById('cancelModal'); if (window.bootstrap) bootstrap.Modal.getOrCreateInstance(el).hide(); }
  // 日付・人数を変える／足す の下に出す、変更後の日程と金額（満室・停止の日が入っていれば注意）
  function quoteHtml(label, checkin, q, verb) {
    return '<div class="alert alert-success py-2">' + bi('calendar-check') + ' ' + label + e(checkin) + '〜' + e(q.checkout) + '・' + yen(q.price.pay) + (q.price.discount ? '（連泊割引 −' + yen(q.price.discount) + '）' : '') + '</div>' +
      (q.full.length ? '<div class="alert alert-warning py-2">' + bi('exclamation-triangle-fill') + ' 満室・受付停止の日が入っています（' + q.full.map(e).join('、') + '）。このまま' + verb + 'こともできます。</div>' : '');
  }

  // ----- 電話・LINE の予約を足す -----
  function addForm(d) {
    var h = crumbs([['月の表', '/admin'], ['予約を足す', '']]) + '<h1>電話・LINE の予約を足す</h1><div class="card shadow-sm mb-3"><div class="card-body" id="addCard">' +
      field('checkin', 'ci', 'チェックイン', true, '<input type="date" class="form-control" id="ci" data-fk="checkin" value="' + e(d || today()) + '">', 'お泊まりの最初の夜です。') +
      '<div class="row g-2"><div class="col-6">' + field('nights', 'ni', '泊数', true, sel('ni', 'nights', 1, INFO.maxNights, 1, '泊')) + '</div><div class="col-6">' + field('guests', 'gu', '人数', true, sel('gu', 'guests', 1, INFO.maxGuests, 1, '名')) + '</div></div>' +
      field('name', 'nm', 'お名前', true, input('name', 'nm', '', 'autocomplete="off"'), '予約台帳に出す名前です。') +
      field('tel', 'tel', '電話', false, input('tel', 'tel', '', 'inputmode="tel" autocomplete="off"')) +
      field('memo', 'memo', '宿のメモ', false, '<textarea class="form-control" id="memo" data-fk="memo" style="min-height:90px"></textarea>', 'お客様には見えません。' + maxText('manual', 'memo') + '。') +
      '<div id="q"></div><div class="d-grid gap-2 d-sm-flex mt-3"><button class="btn btn-primary" id="add">' + bi('check-lg') + ' 登録する</button><a class="btn btn-outline-secondary" href="/admin" data-go>やめる</a></div><div class="form-text mt-2">メールは送りません。</div></div></div>';
    M.innerHTML = h;
    var box = document.getElementById('addCard');
    var show = function () {
      var body = { checkin: val('ci'), nights: +val('ni'), guests: +val('gu') };
      if (!checkForm(box, 'stay', body)) { document.getElementById('q').innerHTML = ''; return; }
      api('/quote', body).then(function (q) { document.getElementById('q').innerHTML = quoteHtml('', val('ci'), q, '登録する'); })
        .catch(function (x) { fail(box, function (y) { document.getElementById('q').innerHTML = err(y); }, x); });
    };
    ['ci', 'ni', 'gu'].forEach(function (k) { document.getElementById(k).onchange = show; });
    show();
    document.getElementById('add').onclick = function () {
      var body = { checkin: val('ci'), nights: +val('ni'), guests: +val('gu'), name: val('nm'), tel: val('tel'), memo: val('memo') };
      if (!checkForm(box, 'manual', body)) return;
      this.disabled = true;
      api('/manual', body)
        .then(function (j) { go('/admin/b/' + encodeURIComponent(j.id)); })
        .catch(function (x) { fail(box, function (y) { document.getElementById('q').innerHTML = err(y); }, x); document.getElementById('add').disabled = false; });
    };
  }

  // ----- 受付の設定 -----
  function rules() {
    loading();
    var t = today(), to = ymd(new Date(parse(t).getTime() + 400 * 86400000));
    api('/rules?from=' + t + '&to=' + to).then(function (j) {
      var wk = {}; j.weekly.forEach(function (w) { wk[w.weekday] = w.stop; });
      var h = '<h1>受付の設定</h1>';
      h += '<h2>定休日（毎週）</h2><div class="card card-body mb-3 shadow-sm"><p class="text-secondary small">印を付けた曜日の夜は泊まれません。その曜日をまたぐ連泊も受けません。</p><div class="d-flex flex-wrap gap-3">' +
        W.split('').map(function (w, i) { return '<label class="d-flex align-items-center gap-1 m-0"><input type="checkbox" class="form-check-input mt-0" data-wd="' + i + '"' + (wk[i] ? ' checked' : '') + '> ' + w + '</label>'; }).join('') + '</div></div>';
      h += '<h2>日・期間の決まり</h2><div class="card card-body mb-3 shadow-sm" id="rlCard"><div class="row g-2"><div class="col-6">' + field('from', 'rf', 'から', null, '<input type="date" class="form-control" id="rf" data-fk="from" value="' + t + '">') + '</div><div class="col-6">' + field('to', 'rt', 'まで', null, '<input type="date" class="form-control" id="rt" data-fk="to" value="' + t + '">') + '</div></div>' +
        field('action', 'ra', 'どうするか', null, '<select class="form-select" id="ra" data-fk="action"><option value="stop">受付停止</option><option value="limit">受付件数の上限を決める</option><option value="open">この日は受ける（定休日を外す）</option><option value="clear">決まりを外す（既定に戻す）</option></select>') +
        '<div id="rlw">' + field('limit', 'rl', '件数', null, '<input type="number" class="form-control" id="rl" data-fk="limit" value="' + j.defaultLimit + '">') + '</div>' +
        '<div id="rm"></div><p class="mb-2"><button class="btn btn-primary" id="rs">保存する</button></p><p class="text-secondary small mb-0">決まりの無い日の上限は ' + j.defaultLimit + '件。すでに入っている予約は消えません。</p></div>';
      h += '<h2>決まりを入れた日</h2><div class="card card-body mb-3 shadow-sm">' + (j.days.length ? j.days.map(function (d) {
        return '<div>' + jp(d.day) + '：' + (d.stop === 1 ? '受付停止' : d.stop === 0 ? 'この日は受ける' + (d.limit_count != null ? '（' + d.limit_count + '件まで）' : '') : '上限 ' + d.limit_count + '件') + '</div>';
      }).join('') : '<p class="text-secondary mb-0">ありません。</p>') + '</div>';
      var WL = function (s) { return s && s.stop ? '定休日' : '定休日でない'; };
      var DL = function (s) { return !s ? '決まりなし' : s.stop === 1 ? '受付停止' : s.stop === 0 ? 'この日は受ける' + (s.limit_count != null ? '（' + s.limit_count + '件まで）' : '') : '上限 ' + s.limit_count + '件'; };
      h += '<h2>変更履歴</h2>' + (j.history.length ? j.history.map(function (x) {
        var what = x.target === 'weekly_rule' ? '毎週' + W[+x.key] + '曜：' + WL(x.before) + ' → ' + WL(x.after) : jp(x.key) + '：' + DL(x.before) + ' → ' + DL(x.after);
        return '<div class="hist">' + when(x.at) + '・' + e(x.by) + '<br>' + e(what) + '</div>';
      }).join('') : '<p class="text-secondary">まだありません。</p>');
      M.innerHTML = h;
      var ra = document.getElementById('ra'), sync = function () { document.getElementById('rlw').style.display = ra.value === 'limit' || ra.value === 'open' ? '' : 'none'; };
      ra.onchange = sync; sync();
      document.getElementById('rs').onclick = function () {
        var body = { from: val('rf'), to: val('rt'), action: ra.value, limit: ra.value === 'limit' || ra.value === 'open' ? val('rl') : '' };
        var box = document.getElementById('rlCard');
        document.getElementById('rm').innerHTML = '';
        if (!checkForm(box, 'rulesDay', body)) return;
        this.disabled = true;
        api('/rules/day', body).then(rules).catch(function (x) { fail(box, function (y) { document.getElementById('rm').innerHTML = err(y); }, x); document.getElementById('rs').disabled = false; });
      };
      M.querySelectorAll('input[data-wd]').forEach(function (c) {
        c.onchange = function () { api('/rules/weekly', { weekday: +c.getAttribute('data-wd'), stop: c.checked }).then(rules).catch(function (x) { alert(x.message); rules(); }); };
      });
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 設定（画面の色。基本設計書 追補 2026-10-13 S-03） -----
  function themeName(k) { var t = YBK_THEMES[k]; return t ? t.label : k; }
  function settings() {
    loading();
    api('/settings').then(function (j) {
      var h = '<h1>設定</h1>';
      h += cardBs('palette', '画面の色', '<div class="card-body" id="thCard"><p class="text-secondary small">予約画面（お客さま）と管理画面の色です。保存すると管理画面はすぐに、予約画面は次に開いたときから変わります。</p>' +
        Object.keys(YBK_THEMES).map(function (k) {
          var t = YBK_THEMES[k];
          return '<label class="theme-opt"><input class="form-check-input" type="radio" name="theme" value="' + k + '" data-fk="theme"' + (k === j.theme ? ' checked' : '') + '><span class="theme-sw" aria-hidden="true"><i style="background:' + t.solid + '"></i><i style="background:' + t.sub + '"></i><i style="background:#666666"></i></span><span><b>' + e(t.label) + '</b>' + (t.note ? '<span class="text-secondary small ms-2">' + e(t.note) + '</span>' : '') + '</span></label>';
        }).join('') + errBox('theme') + '<div id="thMsg"></div><button class="btn btn-primary mt-2" id="saveTheme">' + bi('save') + ' 保存する</button></div>');
      h += '<h2>変更履歴</h2><div id="thHist">' + histHtml(j.history) + '</div>';
      M.innerHTML = h;
      document.getElementById('saveTheme').onclick = function () {
        var box = document.getElementById('thCard'), msg = document.getElementById('thMsg'), c = M.querySelector('input[name="theme"]:checked');
        var body = { theme: c ? c.value : '' };
        msg.innerHTML = '';
        if (!checkForm(box, 'settings', body)) return;
        var b = this; b.disabled = true;
        api('/settings', body).then(function (r) {
          document.documentElement.setAttribute('data-theme', r.theme);
          document.getElementById('thHist').innerHTML = histHtml(r.history);
          msg.innerHTML = '<div class="alert alert-success py-2 mt-2">' + bi('check-lg') + ' 保存しました。</div>';
          b.disabled = false;
        }).catch(function (x) { b.disabled = false; fail(box, function (y) { msg.innerHTML = err(y); }, x); });
      };
    }).catch(function (x) { M.innerHTML = err(x); });
  }
  function histHtml(list) {
    return list.length ? list.map(function (x) { return '<div class="hist">' + when(x.at) + '・' + e(x.by) + '<br>画面の色：' + e(themeName(x.before)) + ' → ' + e(themeName(x.after)) + '</div>'; }).join('') : '<p class="text-secondary">まだありません。</p>';
  }

  // ----- 名前 -----
  function me() {
    M.innerHTML = '<h1>画面に出す名前</h1><div class="card card-body shadow-sm" id="meCard"><p class="text-secondary small">' + e(INFO.me.email) + ' でログイン中</p>' + field('name', 'nm', '名前', true, input('name', 'nm', INFO.me.name)) +
      '<div id="mm"></div><p class="mb-2"><button class="btn btn-primary" id="sv">保存する</button> <a class="btn btn-outline-secondary" href="/admin/logout">ログアウト</a></p><p class="text-secondary small mb-0">変更履歴の「だれが」に出る名前です。</p></div>';
    document.getElementById('sv').onclick = function () {
      var box = document.getElementById('meCard'), body = { name: val('nm') };
      document.getElementById('mm').innerHTML = '';
      if (!checkForm(box, 'me', body)) return;
      api('/me', body).then(function (j) { INFO.me = j.me; document.getElementById('me').textContent = j.me.name; document.getElementById('mm').innerHTML = '<div class="alert alert-success py-2">保存しました。</div>'; })
        .catch(function (x) { fail(box, function (y) { document.getElementById('mm').innerHTML = err(y); }, x); });
    };
  }

  api('/me').then(function (j) { INFO = j; document.getElementById('me').textContent = j.me.name; route(); }).catch(function (x) { M.innerHTML = err(x); });
})();
`;
