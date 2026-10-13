// 管理画面の HTML（1枚。画面の切り替えはこの中の JS）。スマートフォンでの利用を優先し、色は宿のサイト（予約画面）にそろえる
// 画面：月の表（/admin）・日の予約（/admin/d/日付）・予約の詳細（/admin/b/予約番号）・予約を足す（/admin/new）・受付の設定（/admin/rules）・月ごとの数字（/admin/stats）・名前（/admin/me）
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
:root{--ink:#183D43;--mid:#5B7072;--line:#CBD9D8;--bg:#F7F8F3;--accent:#D35D35;--ok:#486C70;--stop:#E9E4DC}
*{box-sizing:border-box}
body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--ink);background:var(--bg);font-size:16px;line-height:1.6}
header{position:sticky;top:0;z-index:2;background:var(--ink);color:#fff;display:flex;align-items:center;gap:8px;padding:10px 12px}
header b{flex:1;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header a{color:#fff;font-size:12px;white-space:nowrap;text-decoration:none;border:1px solid rgba(255,255,255,.5);border-radius:4px;padding:4px 8px}
main{max-width:720px;margin:0 auto;padding:12px 12px 80px}
h1{font-size:18px;margin:8px 0 12px}
h2{font-size:15px;margin:20px 0 8px;color:var(--ok)}
a{color:var(--ok)}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.nav h1{margin:0;font-size:17px}
.nav .btn{padding:6px 10px;font-size:14px}
button,.btn{font:inherit;font-size:15px;border-radius:6px;border:1px solid var(--ok);background:#fff;color:var(--ok);padding:9px 14px;cursor:pointer;text-decoration:none;display:inline-block}
button.main,.btn.main{background:var(--ok);color:#fff}
button.danger{border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.5}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.cal .w{font-size:12px;text-align:center;color:var(--mid)}
.cal a{display:block;min-height:58px;background:#fff;border:1px solid var(--line);border-radius:6px;padding:3px;text-decoration:none;color:var(--ink);font-size:12px;line-height:1.35}
.cal a.stop{background:var(--stop)}
.cal a.full{border-color:var(--accent)}
.cal a.today{outline:2px solid var(--ok)}
.cal a b{font-size:14px}
.cal .n{display:block;font-weight:700;white-space:nowrap}
.cal .s{color:var(--mid)}
.tag{display:inline-block;font-size:12px;border-radius:4px;padding:0 6px;border:1px solid var(--line);color:var(--mid)}
.tag.c{border-color:var(--accent);color:var(--accent)}
.tag.m{border-color:var(--ok);color:var(--ok)}
dl{display:grid;grid-template-columns:7em 1fr;gap:4px 8px;margin:0}
dt{color:var(--mid);font-size:14px}
dd{margin:0;word-break:break-word;white-space:pre-wrap}
label{display:block;font-size:14px;color:var(--mid);margin:10px 0 4px}
input,select,textarea{font:inherit;width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}
textarea{min-height:90px}
.msg{padding:10px;border-radius:6px;margin:10px 0}
.msg.err{background:#FBEAE5;color:#8A2E14}
.msg.warn{background:#FFF6DD;color:#6B5200}
.msg.ok{background:#E6F0EE}
.list a{display:block;text-decoration:none;color:inherit}
.hist{font-size:14px;border-left:3px solid var(--line);padding-left:8px;margin:6px 0}
.muted{color:var(--mid);font-size:13px}
.st{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
.st th,.st td{border-bottom:1px solid var(--line);padding:6px;text-align:right;white-space:nowrap}
.st th:first-child,.st td:first-child{text-align:left}
.st tr.sum td{font-weight:bold}
.stwrap{overflow-x:auto;margin:0 0 14px}
`;

export function messagePage(site, message, withLogin) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(site.innName)} 予約管理</title><style>${CSS}</style></head><body><header><b>${esc(site.innName)} 予約管理</b></header>
<main><div class="card"><p>${esc(message)}</p>${withLogin ? '<p><a class="btn main" href="/admin/login">Google でログイン</a></p>' : ""}</div></main></body></html>`;
}

export function adminPage(site) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(site.innName)} 予約管理</title><style>${CSS}</style></head><body>
<header><b>${esc(site.innName)} 予約管理</b><a href="/admin" data-go>月の表</a><a href="/admin/rules" data-go>受付の設定</a><a href="/admin/stats" data-go>月ごとの数字</a><a href="/admin/me" data-go id="me">…</a></header>
<main id="main"><p class="muted">読み込み中…</p></main>
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
  function api(path, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ybk': '1' }, body: JSON.stringify(body) } : {};
    return fetch('/admin/api' + path, opt).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
      return r.json();
    }).then(function (j) { if (!j.ok) throw new Error(j.error || 'エラー'); return j; });
  }
  function err(x) { return '<div class="msg err">' + e(x && x.message || x) + '</div>'; }
  function go(path) { history.pushState(null, '', path); route(); }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-go]');
    if (a) { ev.preventDefault(); go(a.getAttribute('href')); }
  });
  window.addEventListener('popstate', route);

  function route() {
    var p = location.pathname, m;
    window.scrollTo(0, 0);
    if ((m = /^\/admin\/b\/([\w-]+)$/.exec(p))) return booking(decodeURIComponent(m[1]));
    if ((m = /^\/admin\/d\/(\d{4}-\d{2}-\d{2})$/.exec(p))) return day(m[1]);
    if (p === '/admin/new') return addForm(new URLSearchParams(location.search).get('d'));
    if (p === '/admin/rules') return rules();
    if (p === '/admin/stats') return stats();
    if (p === '/admin/me') return me();
    return month(new URLSearchParams(location.search).get('m') || today().slice(0, 7));
  }

  // ----- 月ごとの数字（チェックインの月ごと。キャンセルは件数だけ。試しの予約は入れない） -----
  function stats() {
    M.innerHTML = '<p class="muted">読み込み中…</p>';
    api('/stats').then(function (j) {
      var h = '<h1 style="font-size:17px">月ごとの数字</h1><p class="muted">泊まる月（チェックインの月）ごと。月をまたぐ予約はチェックインの月に入れる。金額は予約の合計（連泊割引のあと）。キャンセルは件数だけで、件数・金額には入れない。名前に「テスト」「試験」を含む予約は入れない。</p>';
      j.months.forEach(function (x) {
        var y = x.month.slice(0, 4), mm = +x.month.slice(5);
        var line = function (label, v, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td>' + v.count + '件</td><td>' + v.guests + '名</td><td>' + v.nights + '泊</td><td>' + yen(v.pay) + '</td></tr>'; };
        h += '<div class="stwrap"><table class="st"><tr><th><a href="/admin?m=' + e(x.month) + '" data-go>' + y + '年' + mm + '月</a></th><th>件数</th><th>人数</th><th>泊数</th><th>金額</th></tr>' +
          line('ネット予約', x.web) + line('電話・LINE', x.manual) + line('合計', x.total, 'sum') +
          '<tr><td>キャンセル</td><td>' + x.cancelled + '件</td><td></td><td></td><td></td></tr></table></div>';
      });
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 月の表 -----
  function month(mo) {
    M.innerHTML = '<p class="muted">読み込み中…</p>';
    var y = +mo.slice(0, 4), mm = +mo.slice(5, 7);
    var prev = ymd(new Date(Date.UTC(y, mm - 2, 1))).slice(0, 7), next = ymd(new Date(Date.UTC(y, mm, 1))).slice(0, 7);
    api('/month?m=' + mo).then(function (j) {
      var t = today(), first = new Date(Date.UTC(y, mm - 1, 1)).getUTCDay();
      var h = '<div class="nav"><a class="btn" href="/admin?m=' + prev + '" data-go>‹ 前の月</a><h1>' + y + '年' + mm + '月</h1><a class="btn" href="/admin?m=' + next + '" data-go>次の月 ›</a></div>';
      h += '<div class="cal">' + W.split('').map(function (w) { return '<div class="w">' + w + '</div>'; }).join('');
      for (var i = 0; i < first; i++) h += '<div></div>';
      Object.keys(j.days).forEach(function (k) {
        var d = j.days[k], cls = (d.stop ? 'stop ' : '') + (!d.stop && d.count >= d.limit ? 'full ' : '') + (k === t ? 'today' : '');
        h += '<a class="' + cls + '" href="/admin/d/' + k + '" data-go><b>' + (+k.slice(8)) + '</b>' +
          '<span class="n">' + (d.stop ? d.count + '件' : d.count + '/' + d.limit + '件') + '</span>' +
          // 受付停止・定休日でも予約があれば人数を出す（受け入れ試験 K4・2026-10-12）
          '<span class="s">' + [d.stop === 'stop' ? '停止' : d.stop === 'weekly' ? '定休' : '', d.guests ? d.guests + '名' : ''].filter(Boolean).join('・') + '</span></a>';
      });
      h += '</div><p class="row" style="margin-top:12px"><a class="btn main" href="/admin/new" data-go>＋ 電話・LINE の予約を足す</a></p>';
      h += '<p class="muted">「1/3件」は、その日の夜に泊まる予約の件数／受付件数の上限（キャンセルを除く）。下の数は人数。色の付いた日は受付停止・定休日、赤い枠は上限に達した日。</p>';
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 日の予約 -----
  function day(d) {
    M.innerHTML = '<p class="muted">読み込み中…</p>';
    api('/day?d=' + d).then(function (j) {
      var on = j.bookings.filter(function (b) { return b.status === 'booked'; }), off = j.bookings.filter(function (b) { return b.status !== 'booked'; });
      var h = '<p><a href="/admin?m=' + d.slice(0, 7) + '" data-go>‹ 月の表へ</a></p><h1>' + jp(d) + ' の夜</h1>';
      h += '<p class="muted">' + (j.stop === 'stop' ? '受付停止' : j.stop === 'weekly' ? '定休日' : '受付件数の上限 ' + j.limit + '件') + '・予約 ' + on.length + '件</p>';
      h += '<div class="list">' + (on.length ? on.map(row).join('') : '<p class="muted">この夜の予約はありません。</p>') + '</div>';
      if (off.length) h += '<h2>キャンセルした予約</h2><div class="list">' + off.map(row).join('') + '</div>';
      h += '<p><a class="btn main" href="/admin/new?d=' + d + '" data-go>＋ この日に予約を足す</a></p>';
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }
  function row(b) {
    return '<a href="/admin/b/' + encodeURIComponent(b.id) + '" data-go><div class="card"><div class="row"><b>' + e(b.name || '（消去済み）') + ' 様</b>' +
      (b.status !== 'booked' ? '<span class="tag c">キャンセル</span>' : '') + (b.source === 'manual' ? '<span class="tag m">電話・LINE</span>' : '<span class="tag">予約画面</span>') +
      '</div><div class="muted">' + e(b.guests) + '名・' + e(b.nights) + '泊（' + e(b.checkin.slice(5)) + '〜' + e(b.checkout.slice(5)) + '）・' + yen(b.pay) + (b.inn_memo ? '・メモあり' : '') + '</div></div></a>';
  }

  // ----- 予約の詳細 -----
  var KIND = { create: '作成', cancel: 'キャンセル', change: '日付・人数の変更', memo: 'メモを変更', info: 'お客様の情報を直す' };
  var FIELD = { name: 'お名前', tel: '電話', email: 'メール', address: 'ご住所', arrival: '到着予定', note: 'ご要望' };
  function infoText(x) { if (!x.before) return '（3年たったので値は消去済み）'; return Object.keys(x.after).map(function (k) { return (FIELD[k] || k) + '：' + (x.before[k] || '（空）') + ' → ' + (x.after[k] || '（空）'); }).join('\n'); }
  function stayText(s) { return s ? s.checkin + '〜' + s.checkout + '（' + s.nights + '泊）' + s.guests + '名・' + yen(s.pay) : ''; }
  function booking(id) {
    M.innerHTML = '<p class="muted">読み込み中…</p>';
    api('/booking?id=' + encodeURIComponent(id)).then(function (j) {
      var b = j.booking, live = b.status === 'booked';
      var h = '<p><a href="/admin/d/' + e(b.checkin) + '" data-go>‹ ' + jp(b.checkin) + ' の予約へ</a></p>';
      h += '<h1>' + e(b.name || '（個人情報は消去済み）') + ' 様 ' + (live ? '' : '<span class="tag c">キャンセル</span>') + '</h1>';
      h += '<div class="card"><dl>' +
        '<dt>予約番号</dt><dd>' + e(b.id) + '</dd>' +
        '<dt>宿泊</dt><dd>' + jp(b.checkin) + '〜' + jp(b.checkout) + '　' + e(b.nights) + '泊</dd>' +
        '<dt>人数</dt><dd>' + e(b.guests) + '名</dd>' +
        '<dt>料金</dt><dd>' + yen(b.per_person) + ' × ' + e(b.guests) + '名 × ' + e(b.nights) + '泊 ＝ ' + yen(b.total) + (b.discount ? '\n連泊割引 −' + yen(b.discount) : '') + '\nお支払い ' + yen(b.pay) + '</dd>' +
        '<dt>電話</dt><dd>' + (b.tel ? '<a href="tel:' + e(b.tel.replace(/[^\d+]/g, '')) + '">' + e(b.tel) + '</a>' : '') + '</dd>' +
        '<dt>メール</dt><dd>' + e(b.email) + '</dd>' +
        '<dt>ご住所</dt><dd>' + e(b.address) + '</dd>' +
        '<dt>到着予定</dt><dd>' + e(b.arrival) + '</dd>' +
        '<dt>ご要望</dt><dd>' + e(b.note) + '</dd>' +
        '<dt>受付</dt><dd>' + when(b.received_at) + '（' + (b.source === 'manual' ? '電話・LINE' : '予約画面') + '）</dd>' +
        (b.source === 'web' ? '<dt>メール</dt><dd>確認：' + (b.mail_guest === 'sent' ? '送信済み' : e(b.mail_guest)) + '\n宿への通知：' + (b.mail_inn === 'sent' ? '送信済み' : e(b.mail_inn)) + '</dd>' : '') +
        (b.privacy_agreed_at ? '<dt>個人情報</dt><dd>プライバシーポリシーに同意（' + when(b.privacy_agreed_at) + '・版 ' + e(b.privacy_version) + '）</dd>' : '') +
        (b.cancelled_at ? '<dt>キャンセル</dt><dd>' + when(b.cancelled_at) + '</dd>' : '') +
        '</dl></div>';
      if (!b.pii_deleted_at) {
        h += '<h2>お客様の情報を直す</h2><div class="card">' +
          '<label>お名前</label><input id="fNm" maxlength="50" value="' + e(b.name) + '">' +
          '<label>電話</label><input id="fTel" inputmode="tel" value="' + e(b.tel) + '">' +
          '<label>メール</label><input id="fEm" inputmode="email" value="' + e(b.email) + '">' +
          '<label>ご住所</label><input id="fAd" maxlength="100" value="' + e(b.address) + '">' +
          '<label>到着予定（例：15:00〜16:00）</label><input id="fAr" value="' + e(b.arrival) + '">' +
          '<label>ご要望</label><textarea id="fNo" maxlength="300">' + e(b.note) + '</textarea>' +
          '<div id="fMsg"></div><p><button id="saveInfo">直した内容を保存</button></p><p class="muted">直す前と後の値は変更履歴に残ります。お客様へのメールは送りません。</p></div>';
      }
      h += '<h2>宿のメモ（お客様には見えません）</h2><div class="card"><textarea id="memo">' + e(b.inn_memo) + '</textarea><p><button id="saveMemo">メモを保存</button> <span id="memoMsg" class="muted"></span></p></div>';
      if (live) {
        h += '<h2>日付・人数を変える</h2><div class="card"><div class="row">' +
          '<div style="flex:2"><label>チェックイン</label><input type="date" id="ci" value="' + e(b.checkin) + '"></div>' +
          '<div style="flex:1"><label>泊数</label>' + sel('ni', 1, INFO.maxNights, b.nights, '泊') + '</div>' +
          '<div style="flex:1"><label>人数</label>' + sel('gu', 1, INFO.maxGuests, b.guests, '名') + '</div></div>' +
          '<div id="chq"></div><p><button class="main" id="doChange">この内容に変える</button></p></div>';
        h += '<h2>キャンセル</h2><div class="card"><p class="muted">キャンセルすると、空きがすぐ戻ります。お客様へのメールは送りません。キャンセルは取り消せません。</p><button class="danger" id="doCancel">キャンセルにする</button></div>';
      }
      h += '<h2>変更履歴</h2>' + j.history.map(function (x) {
        return '<div class="hist"><b>' + e(KIND[x.kind] || x.kind) + '</b> ' + when(x.at) + '・' + e(x.by) +
          (x.kind === 'change' ? '<br>' + e(stayText(x.before)) + '<br>→ ' + e(stayText(x.after)) : x.kind === 'create' ? '<br>' + e(stayText(x.after)) : x.kind === 'info' ? '<br><span style="white-space:pre-wrap">' + e(infoText(x)) + '</span>' : '') + '</div>';
      }).join('');
      M.innerHTML = h;
      if (!b.pii_deleted_at) document.getElementById('saveInfo').onclick = function () {
        var m = document.getElementById('fMsg'); m.innerHTML = '';
        api('/info', { id: b.id, name: val('fNm'), tel: val('fTel'), email: val('fEm'), address: val('fAd'), arrival: val('fAr'), note: val('fNo') })
          .then(function () { booking(b.id); }).catch(function (x) { m.innerHTML = err(x); });
      };
      document.getElementById('saveMemo').onclick = function () {
        var t = document.getElementById('memoMsg'); t.textContent = '保存中…';
        api('/memo', { id: b.id, memo: document.getElementById('memo').value }).then(function () { booking(b.id); }).catch(function (x) { t.textContent = x.message; });
      };
      if (!live) return;
      var show = function () {
        var body = { id: b.id, checkin: val('ci'), nights: +val('ni'), guests: +val('gu') };
        api('/quote', body).then(function (q) {
          document.getElementById('chq').innerHTML = '<div class="msg ok">変更後：' + e(body.checkin) + '〜' + e(q.checkout) + '・' + yen(q.price.pay) + (q.price.discount ? '（連泊割引 −' + yen(q.price.discount) + '）' : '') + '</div>' +
            (q.full.length ? '<div class="msg warn">満室・受付停止の日が入っています（' + q.full.map(e).join('、') + '）。このまま変えることもできます。</div>' : '');
        }).catch(function (x) { document.getElementById('chq').innerHTML = err(x); });
      };
      ['ci', 'ni', 'gu'].forEach(function (k) { document.getElementById(k).onchange = show; });
      document.getElementById('doChange').onclick = function () {
        this.disabled = true;
        api('/change', { id: b.id, checkin: val('ci'), nights: +val('ni'), guests: +val('gu') }).then(function () { booking(b.id); }).catch(function (x) { document.getElementById('chq').innerHTML = err(x); document.getElementById('doChange').disabled = false; });
      };
      document.getElementById('doCancel').onclick = function () {
        if (!confirm('この予約をキャンセルにしますか？（取り消せません）')) return;
        this.disabled = true;
        api('/cancel', { id: b.id }).then(function () { booking(b.id); }).catch(function (x) { M.insertAdjacentHTML('afterbegin', err(x)); });
      };
    }).catch(function (x) { M.innerHTML = err(x); });
  }
  function sel(id, lo, hi, v, unit) {
    var h = '<select id="' + id + '">';
    for (var i = lo; i <= hi; i++) h += '<option value="' + i + '"' + (i === v ? ' selected' : '') + '>' + i + unit + '</option>';
    return h + '</select>';
  }
  function val(id) { return document.getElementById(id).value; }

  // ----- 電話・LINE の予約を足す -----
  function addForm(d) {
    var h = '<p><a href="/admin" data-go>‹ 月の表へ</a></p><h1>電話・LINE の予約を足す</h1><div class="card">' +
      '<label>チェックイン</label><input type="date" id="ci" value="' + e(d || today()) + '">' +
      '<div class="row"><div style="flex:1"><label>泊数</label>' + sel('ni', 1, INFO.maxNights, 1, '泊') + '</div><div style="flex:1"><label>人数</label>' + sel('gu', 1, INFO.maxGuests, 1, '名') + '</div></div>' +
      '<label>お名前（必須）</label><input id="nm" maxlength="50" autocomplete="off">' +
      '<label>電話（任意）</label><input id="tel" inputmode="tel" autocomplete="off">' +
      '<label>宿のメモ（任意・お客様には見えません）</label><textarea id="memo"></textarea>' +
      '<div id="q"></div><p><button class="main" id="add">登録する</button></p><p class="muted">メールは送りません。</p></div>';
    M.innerHTML = h;
    var show = function () {
      api('/quote', { checkin: val('ci'), nights: +val('ni'), guests: +val('gu') }).then(function (q) {
        document.getElementById('q').innerHTML = '<div class="msg ok">' + e(val('ci')) + '〜' + e(q.checkout) + '・' + yen(q.price.pay) + (q.price.discount ? '（連泊割引 −' + yen(q.price.discount) + '）' : '') + '</div>' +
          (q.full.length ? '<div class="msg warn">満室・受付停止の日が入っています（' + q.full.map(e).join('、') + '）。このまま登録することもできます。</div>' : '');
      }).catch(function (x) { document.getElementById('q').innerHTML = err(x); });
    };
    ['ci', 'ni', 'gu'].forEach(function (k) { document.getElementById(k).onchange = show; });
    show();
    document.getElementById('add').onclick = function () {
      this.disabled = true;
      api('/manual', { checkin: val('ci'), nights: +val('ni'), guests: +val('gu'), name: val('nm'), tel: val('tel'), memo: val('memo') })
        .then(function (j) { go('/admin/b/' + encodeURIComponent(j.id)); })
        .catch(function (x) { document.getElementById('q').innerHTML = err(x); document.getElementById('add').disabled = false; });
    };
  }

  // ----- 受付の設定 -----
  function rules() {
    M.innerHTML = '<p class="muted">読み込み中…</p>';
    var t = today(), to = ymd(new Date(parse(t).getTime() + 400 * 86400000));
    api('/rules?from=' + t + '&to=' + to).then(function (j) {
      var wk = {}; j.weekly.forEach(function (w) { wk[w.weekday] = w.stop; });
      var h = '<h1>受付の設定</h1>';
      h += '<h2>定休日（毎週）</h2><div class="card"><p class="muted">印を付けた曜日の夜は泊まれません。その曜日をまたぐ連泊も受けません。</p><div class="row">' +
        W.split('').map(function (w, i) { return '<label style="margin:0;color:inherit"><input type="checkbox" data-wd="' + i + '" style="width:auto"' + (wk[i] ? ' checked' : '') + '> ' + w + '</label>'; }).join(' ') + '</div></div>';
      h += '<h2>日・期間の決まり</h2><div class="card"><div class="row"><div style="flex:1"><label>から</label><input type="date" id="rf" value="' + t + '"></div><div style="flex:1"><label>まで</label><input type="date" id="rt" value="' + t + '"></div></div>' +
        '<label>どうするか</label><select id="ra"><option value="stop">受付停止</option><option value="limit">受付件数の上限を決める</option><option value="open">この日は受ける（定休日を外す）</option><option value="clear">決まりを外す（既定に戻す）</option></select>' +
        '<div id="rlw"><label>件数</label><input type="number" id="rl" min="0" value="' + j.defaultLimit + '"></div>' +
        '<div id="rm"></div><p><button class="main" id="rs">保存する</button></p><p class="muted">決まりの無い日の上限は ' + j.defaultLimit + '件。すでに入っている予約は消えません。</p></div>';
      h += '<h2>決まりを入れた日</h2><div class="card">' + (j.days.length ? j.days.map(function (d) {
        return '<div>' + jp(d.day) + '：' + (d.stop === 1 ? '受付停止' : d.stop === 0 ? 'この日は受ける' + (d.limit_count != null ? '（' + d.limit_count + '件まで）' : '') : '上限 ' + d.limit_count + '件') + '</div>';
      }).join('') : '<p class="muted">ありません。</p>') + '</div>';
      var WL = function (s) { return s && s.stop ? '定休日' : '定休日でない'; };
      var DL = function (s) { return !s ? '決まりなし' : s.stop === 1 ? '受付停止' : s.stop === 0 ? 'この日は受ける' + (s.limit_count != null ? '（' + s.limit_count + '件まで）' : '') : '上限 ' + s.limit_count + '件'; };
      h += '<h2>変更履歴</h2>' + (j.history.length ? j.history.map(function (x) {
        var what = x.target === 'weekly_rule' ? '毎週' + W[+x.key] + '曜：' + WL(x.before) + ' → ' + WL(x.after) : jp(x.key) + '：' + DL(x.before) + ' → ' + DL(x.after);
        return '<div class="hist">' + when(x.at) + '・' + e(x.by) + '<br>' + e(what) + '</div>';
      }).join('') : '<p class="muted">まだありません。</p>');
      M.innerHTML = h;
      var ra = document.getElementById('ra'), sync = function () { document.getElementById('rlw').style.display = ra.value === 'limit' || ra.value === 'open' ? '' : 'none'; };
      ra.onchange = sync; sync();
      document.getElementById('rs').onclick = function () {
        var body = { from: val('rf'), to: val('rt'), action: ra.value, limit: ra.value === 'limit' || ra.value === 'open' ? val('rl') : '' };
        this.disabled = true;
        api('/rules/day', body).then(rules).catch(function (x) { document.getElementById('rm').innerHTML = err(x); document.getElementById('rs').disabled = false; });
      };
      M.querySelectorAll('input[data-wd]').forEach(function (c) {
        c.onchange = function () { api('/rules/weekly', { weekday: +c.getAttribute('data-wd'), stop: c.checked }).then(rules).catch(function (x) { alert(x.message); rules(); }); };
      });
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 名前 -----
  function me() {
    M.innerHTML = '<h1>画面に出す名前</h1><div class="card"><p class="muted">' + e(INFO.me.email) + ' でログイン中</p><label>名前</label><input id="nm" maxlength="100" value="' + e(INFO.me.name) + '">' +
      '<div id="mm"></div><p><button class="main" id="sv">保存する</button> <a class="btn" href="/admin/logout">ログアウト</a></p><p class="muted">変更履歴の「だれが」に出る名前です。</p></div>';
    document.getElementById('sv').onclick = function () {
      api('/me', { name: val('nm') }).then(function (j) { INFO.me = j.me; document.getElementById('me').textContent = j.me.name; document.getElementById('mm').innerHTML = '<div class="msg ok">保存しました。</div>'; })
        .catch(function (x) { document.getElementById('mm').innerHTML = err(x); });
    };
  }

  api('/me').then(function (j) { INFO = j; document.getElementById('me').textContent = j.me.name; route(); }).catch(function (x) { M.innerHTML = err(x); });
})();
`;
