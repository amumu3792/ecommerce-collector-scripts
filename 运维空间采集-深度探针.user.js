// ==UserScript==
// @name         运维空间采集-深度探针
// @namespace    https://workspace/operations-space
// @version      1.1.2
// @description  深度探针：拦截页面接口返回 + 抓非表结构。只读，不发任何额外请求；正文跨页缓存，一次导出全有。
// @match        https://compass.jinritemai.com/*
// @match        https://fxg.jinritemai.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-%E6%B7%B1%E5%BA%A6%E6%8E%A2%E9%92%88.user.js
// @downloadURL  https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-%E6%B7%B1%E5%BA%A6%E6%8E%A2%E9%92%88.user.js
// ==/UserScript==
(function () {
  'use strict';
  // 深度探针 v1.1.0（2026-11-12）
  // v1.0 的毛病：正文只存内存，一跳页就丢，导出只有当前页；200 上限被监控噪音占满，
  // 真正的数据接口被挤出去；链接里还带着登录 token。
  // v1.1 改法：正文进 IndexedDB 跨页缓存，逛完一次导出全有；噪音域名直接不记；
  // 链接里的 token 参数存之前去掉；单页应用跳页时按页切分记下来。
  var PAGE_KEY = 'spaceImport.deepProbe.pages.v1';
  var MAX_CALLS = 500;
  var MAX_BODY = 1024 * 1024;
  var MAX_STORED = 2000; // IndexedDB 里最多存 2000 条正文，满了就停并在面板说一声
  var FRAME = (window === window.top) ? 'top' : 'iframe';
  var calls = [];
  var bodies = {};
  var storedCount = 0;
  var db = null;
  var dbReady = false;
  var dbFull = false;

  // ---- 噪音域名：监控/上报/配置/图片 CDN，一律不记 ----
  var SKIP_HOSTS = ['mon.zijieapi.com', 'mcs.zijieapi.com', 'mssdk.bytedance.com', 'abtestvm.bytedance.com', 'vcs.zijieapi.com', 'lf3-config.bytetcc.com', 'lf6-cdn2-tos.bytegoofy.com', 'api.feelgood.cn', 'replay.maidouke.com'];
  function hostOf(url) { try { return new URL(url, location.href).hostname; } catch (e) { return ''; } }
  function pathOf(url) { try { return new URL(url, location.href).pathname; } catch (e) { return url || ''; } }
  function isNoise(url) {
    var h = hostOf(url);
    if (!h) return false;
    for (var i = 0; i < SKIP_HOSTS.length; i++) if (h === SKIP_HOSTS[i] || h.endsWith('.' + SKIP_HOSTS[i])) return true;
    if (/ecombdimg\.com$|byteimg\.com$|bytegoofy\.com$/.test(h)) return true;
    return /\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico|map)(\?|$)/i.test(url);
  }
  // 登录类接口只记元数据，不存正文（里面是账号信息）
  function isAuthPath(url) { var p = pathOf(url); return p.indexOf('/ecomauth/') === 0 || p.indexOf('/passport/') !== -1; }
  // 存正文的：金日买家域名下的数据类接口
  function keepBody(url) {
    var h = hostOf(url);
    if (h !== 'compass.jinritemai.com' && !h.endsWith('.jinritemai.com')) return false;
    if (isAuthPath(url)) return false;
    return true;
  }
  // 链接里的登录凭证参数，存之前去掉
  var STRIP_PARAMS = ['msToken', 'token', '_lid', 'fp', 'verifyFp', 'a_bogus', 'sec_user_id', 'sec_subject_uid', 'encode_member_id', 'sessionid', 'cookie'];
  function cleanUrl(url) {
    try {
      var u = new URL(url, location.href);
      for (var i = 0; i < STRIP_PARAMS.length; i++) u.searchParams.delete(STRIP_PARAMS[i]);
      return u.toString();
    } catch (e) { return url; }
  }
  function pagePath() { try { return location.pathname; } catch (e) { return ''; } }

  // ---- IndexedDB：正文跨页缓存 ----
  function openDb() {
    try {
      var req = indexedDB.open('spaceImportDeepProbe', 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('responses')) {
          var s = d.createObjectStore('responses', { keyPath: 'id', autoIncrement: true });
          s.createIndex('page', 'page', { unique: false });
        }
      };
      req.onsuccess = function () { db = req.result; dbReady = true; countStored(); };
      req.onerror = function () { db = null; };
    } catch (e) { db = null; }
  }
  function countStored() {
    if (!dbReady) return;
    try {
      var tx = db.transaction('responses', 'readonly');
      var req = tx.objectStore('responses').count();
      req.onsuccess = function () { storedCount = req.result || 0; refreshPanel(); };
    } catch (e) {}
  }
  function idbPut(rec) {
    if (!dbReady || dbFull) return;
    if (storedCount >= MAX_STORED) { dbFull = true; refreshPanel(); return; }
    try {
      var tx = db.transaction('responses', 'readwrite');
      tx.objectStore('responses').add(rec);
      tx.oncomplete = function () { storedCount++; refreshPanel(); };
      tx.onerror = function () {};
    } catch (e) {}
  }
  function idbAll(cb) {
    if (!dbReady) { cb([]); return; }
    try {
      var tx = db.transaction('responses', 'readonly');
      var req = tx.objectStore('responses').getAll();
      req.onsuccess = function () { cb(req.result || []); };
      req.onerror = function () { cb([]); };
    } catch (e) { cb([]); }
  }
  function idbClear(cb) {
    if (!dbReady) { if (cb) cb(); return; }
    try {
      var tx = db.transaction('responses', 'readwrite');
      var req = tx.objectStore('responses').clear();
      req.onsuccess = function () { storedCount = 0; dbFull = false; if (cb) cb(); };
      req.onerror = function () { if (cb) cb(); };
    } catch (e) { if (cb) cb(); }
  }
  openDb();

  function record(url, method, status, text) {
    try {
      if (isNoise(url)) return;
      url = cleanUrl(url);
      var entry = { url: url, method: method, status: status, time: Date.now(), frame: FRAME, bytes: (text || '').length, isJson: false, keys: [], sample: '' };
      var isJ = false;
      var keys = [];
      if (text) {
        try {
          var j = JSON.parse(text);
          isJ = true;
          if (j && typeof j === 'object') keys = Object.keys(j).slice(0, 40);
        } catch (e) {}
        entry.isJson = isJ;
        entry.keys = keys;
        entry.sample = text.slice(0, 300);
      }
      calls.push(entry);
      if (calls.length > MAX_CALLS) calls.shift();
      if (isJ && text && text.length <= MAX_BODY && keepBody(url)) {
        bodies[url] = text;
        idbPut({ page: pagePath(), url: url, method: method, status: status, time: Date.now(), frame: FRAME, body: text });
      }
      refreshPanel();
    } catch (e) { /* 忽略，绝不能影响页面 */ }
  }

  // ---- 拦截层：包 fetch 和 XHR，包完把 toString 还原成 native ----
  try {
    var nativeFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var url = '';
      var method = 'GET';
      try {
        url = String((args[0] && args[0].url) || args[0] || '');
        method = String((args[1] && args[1].method) || (args[0] && args[0].method) || 'GET');
      } catch (e) {}
      return nativeFetch.apply(this, args).then(function (resp) {
        if (url) {
          try {
            resp.clone().text().then(function (t) { record(url, method, resp.status, t); }).catch(function () {});
          } catch (e) {}
        }
        return resp;
      });
    };
    window.fetch.toString = function () { return 'function fetch() { [native code] }'; };
  } catch (e) {}
  try {
    var nativeOpen = XMLHttpRequest.prototype.open;
    var nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this._dpUrl = String(url || ''); this._dpMethod = String(method || 'GET'); } catch (e) {}
      return nativeOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      try {
        var url = xhr._dpUrl || '';
        if (url) {
          xhr.addEventListener('load', function () {
            try {
              var t = '';
              try { t = xhr.responseText || ''; } catch (e) { t = ''; }
              record(url, xhr._dpMethod || 'GET', xhr.status, t);
            } catch (e) {}
          });
        }
      } catch (e) {}
      return nativeSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open.toString = function () { return 'function open() { [native code] }'; };
    XMLHttpRequest.prototype.send.toString = function () { return 'function send() { [native code] }'; };
  } catch (e) {}

  // ---- 单页应用跳页：地址变了就按页切分记下来 ----
  var lastPath = pagePath();
  function storeGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function storeSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function savePageSummary(path) {
    var pages = storeGet(PAGE_KEY, {});
    pages[path] = {
      time: new Date().toISOString(), frame: FRAME, apiCount: calls.length,
      apis: calls.map(function (c) { return c.method + ' ' + c.url + ' [' + c.status + '] ' + (c.isJson ? 'JSON ' + c.keys.length + '键' : '非JSON'); })
    };
    storeSet(PAGE_KEY, pages);
  }
  function onPathChange() {
    var p = pagePath();
    if (p === lastPath) return;
    savePageSummary(lastPath);
    lastPath = p;
    calls.length = 0;
    bodies = {};
    refreshPanel();
  }
  try {
    var nativePush = history.pushState;
    var nativeReplace = history.replaceState;
    history.pushState = function () { var r = nativePush.apply(this, arguments); setTimeout(onPathChange, 300); return r; };
    history.replaceState = function () { var r = nativeReplace.apply(this, arguments); setTimeout(onPathChange, 300); return r; };
    window.addEventListener('popstate', function () { setTimeout(onPathChange, 300); });
    setInterval(onPathChange, 2000);
  } catch (e) {}
  window.addEventListener('beforeunload', function () { savePageSummary(lastPath); });

  // ---- 工具 ----
  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
  }
  function downloadFile(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function elText(el) { return ((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()); }

  function deepDump() {
    var out = { url: location.href, title: document.title, time: new Date().toISOString(), frame: FRAME, tables: [], lists: [], pageText: '', globals: [], pagination: '', iframes: [] };
    try {
      var tables = document.querySelectorAll('table');
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        var rows = t.querySelectorAll('tbody tr');
        var headers = [];
        var first = rows[0];
        if (first) { for (var c = 0; c < first.children.length; c++) headers.push(elText(first.children[c])); }
        var sampleRows = [];
        for (var r = 0; r < Math.min(rows.length, 3); r++) {
          var cells = [];
          for (var cc = 0; cc < rows[r].children.length; cc++) cells.push(elText(rows[r].children[cc]));
          sampleRows.push(cells);
        }
        out.tables.push({ headers: headers, rowCount: rows.length, sampleRows: sampleRows });
      }
    } catch (e) {}
    try {
      var cands = [];
      var all = document.querySelectorAll('div,ul,section');
      for (var j = 0; j < all.length && j < 3000; j++) {
        var p = all[j];
        var kids = [];
        for (var k = 0; k < p.children.length; k++) {
          var tg = p.children[k].tagName;
          if (tg === 'STYLE' || tg === 'SCRIPT' || tg === 'NOSCRIPT' || tg === 'TEMPLATE') continue;
          kids.push(p.children[k]);
        }
        if (kids.length < 3) continue;
        var tag0 = kids[0].tagName;
        var same = 0;
        for (var m = 0; m < kids.length; m++) if (kids[m].tagName === tag0) same++;
        if (same >= 3 && same === kids.length) {
          var texts = [];
          for (var n = 0; n < Math.min(3, kids.length); n++) texts.push(elText(kids[n]).slice(0, 120));
          cands.push({ tag: p.tagName, cls: String(p.className || '').slice(0, 80), count: kids.length, sample: texts });
        }
      }
      cands.sort(function (a, b) { return b.count - a.count; });
      out.lists = cands.slice(0, 8);
    } catch (e) {}
    try { out.pageText = (document.body.innerText || '').replace(/\s+\n/g, '\n').slice(0, 5000); } catch (e) {}
    try {
      var keys = Object.keys(window).filter(function (k) {
        if (k.indexOf('on') === 0) return false;
        return k.indexOf('_') === 0 || /Store|STORE|DataLayer|__DATA__/.test(k);
      }).slice(0, 30);
      out.globals = keys.map(function (k) { var v; try { v = typeof window[k]; } catch (e) { v = '?'; } return k + ':' + v; });
    } catch (e) {}
    try {
      var pg = document.querySelector('ul.aurora-pagination');
      if (pg) out.pagination = elText(pg).slice(0, 200);
    } catch (e) {}
    try {
      var frs = document.querySelectorAll('iframe');
      for (var f = 0; f < frs.length; f++) out.iframes.push({ src: (frs[f].src || '').slice(0, 200), name: frs[f].name || '' });
    } catch (e) {}
    return out;
  }

  // ---- 面板 ----
  var statusEl = null;
  var countEl = null;
  function refreshPanel() {
    if (!countEl) return;
    var jn = calls.filter(function (c) { return c.isJson; }).length;
    var txt = '本页接口：' + calls.length + ' 个（JSON ' + jn + ' 个）· 已缓存正文：' + storedCount + ' 条' + (dbFull ? '（已满，先导出再继续）' : '');
    countEl.textContent = txt;
  }
  function status(msg) { if (statusEl) statusEl.textContent = msg; }
  function exportAll() {
    savePageSummary(lastPath);
    status('正在从缓存里读全部页的数据…');
    idbAll(function (rows) {
      var byPage = {};
      rows.forEach(function (r) {
        var pg = byPage[r.page] || (byPage[r.page] = { calls: [], bodies: {} });
        pg.calls.push({ url: r.url, method: r.method, status: r.status, time: r.time, frame: r.frame, bytes: (r.body || '').length });
        pg.bodies[r.url] = r.body;
      });
      // 再把本页内存里还没进库的也带上
      var cur = byPage[lastPath] || (byPage[lastPath] = { calls: [], bodies: {} });
      calls.forEach(function (c) { cur.calls.push(c); });
      Object.keys(bodies).forEach(function (u) { cur.bodies[u] = bodies[u]; });
      var nPages = Object.keys(byPage).length;
      var nBodies = 0;
      Object.keys(byPage).forEach(function (p) { nBodies += Object.keys(byPage[p].bodies).length; });
      // 导出前把摘要里的链接再洗一遍：旧版（v1.1.0 之前）存在本地的摘要还带着登录 token，
      // 不洗就跟着导出来了。新记的调用本身已洗过，这里只洗旧摘要。
      var pagesRaw = storeGet(PAGE_KEY, {});
      var pages = {};
      Object.keys(pagesRaw).forEach(function (u) {
        var sm = pagesRaw[u] || {};
        pages[cleanUrl(u)] = {
          time: sm.time, frame: sm.frame, apiCount: sm.apiCount,
          apis: (sm.apis || []).map(function (a) {
            return String(a).replace(/\S+:\/\/\S+/, function (m) { return cleanUrl(m); });
          })
        };
      });
      downloadFile('deep-probe-all-' + stamp() + '.json', { tool: 'deep-probe/1.1.2', time: new Date().toISOString(), frame: FRAME, pages: pages, byPage: byPage });
      status('已导出全部缓存：' + nPages + ' 页、' + nBodies + ' 个接口正文。发我。');
    });
  }
  function initPanel() {
    if (document.getElementById('sip-deepprobe-panel')) return;
    var box = document.createElement('div');
    box.id = 'sip-deepprobe-panel';
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:999999;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.6;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:380px;';
    box.innerHTML = '<div id="sip-dp-head" style="display:flex;align-items:center;cursor:move;user-select:none;margin-bottom:4px;">'
      + '<span style="font-weight:700;flex:1;">深度探针 <span style="font-weight:400;color:#94a3b8;">v1.1.1 · 只读拦截 · ' + FRAME + '</span></span>'
      + '<button id="sip-dp-min" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:1px 8px;cursor:pointer;font-size:14px;line-height:1.4;">—</button>'
      + '</div>'
      + '<div id="sip-dp-body">'
      + '<div id="sip-dp-count" style="color:#7dd3fc;">本页接口：0 个</div>'
      + '<div style="margin-top:8px;">'
      + '<button id="sip-dp-export-all" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">导出全部缓存</button>'
      + '<button id="sip-dp-dump" style="background:#059669;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">抓本页深结构</button>'
      + '<button id="sip-dp-clear" style="background:#475569;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;">清空缓存</button>'
      + '</div>'
      + '<div id="sip-dp-status" style="color:#fbbf24;margin-top:6px;min-height:18px;">逛完要看的页，点“导出全部缓存”一次发我。</div>'
      + '</div>';
    document.body.appendChild(box);
    // 面板可缩小、可拖拽（2026-11-12 lin：面板挡住翻页按钮没法挪）
    (function () {
      var minKey = 'spaceImport.deepProbe.panelMin.v1';
      var posKey = 'spaceImport.deepProbe.panelPos.v1';
      var body = document.getElementById('sip-dp-body');
      var minBtn = document.getElementById('sip-dp-min');
      var head = document.getElementById('sip-dp-head');
      function applyMin(m) {
        body.style.display = m ? 'none' : 'block';
        minBtn.textContent = m ? '+' : '—';
        try { localStorage.setItem(minKey, m ? '1' : '0'); } catch (e) {}
      }
      minBtn.onclick = function () { applyMin(body.style.display !== 'none'); };
      try { if (localStorage.getItem(minKey) === '1') applyMin(true); } catch (e) {}
      try {
        var pos = JSON.parse(localStorage.getItem(posKey) || 'null');
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
          box.style.left = pos.left + 'px'; box.style.top = pos.top + 'px'; box.style.bottom = 'auto';
        }
      } catch (e) {}
      head.addEventListener('mousedown', function (e) {
        if (e.target === minBtn) return;
        var sx = e.clientX, sy = e.clientY;
        var r = box.getBoundingClientRect();
        var dx = sx - r.left, dy = sy - r.top;
        function move(ev) {
          var nx = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx));
          var ny = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
          box.style.left = nx + 'px'; box.style.top = ny + 'px'; box.style.bottom = 'auto';
        }
        function up(ev) {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          move(ev);
          try { localStorage.setItem(posKey, JSON.stringify({ left: parseInt(box.style.left, 10), top: parseInt(box.style.top, 10) })); } catch (e) {}
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
      });
    })();
    statusEl = document.getElementById('sip-dp-status');
    countEl = document.getElementById('sip-dp-count');
    document.getElementById('sip-dp-export-all').onclick = exportAll;
    document.getElementById('sip-dp-dump').onclick = function () {
      var d = deepDump();
      downloadFile('deep-dump-' + stamp() + '.json', { tool: 'deep-probe/1.1.2', dump: d });
      status('深结构已导出：表 ' + d.tables.length + ' 张、重复结构 ' + d.lists.length + ' 处、iframe ' + d.iframes.length + ' 个。发我。');
    };
    document.getElementById('sip-dp-clear').onclick = function () {
      calls.length = 0; bodies = {};
      try { localStorage.removeItem(PAGE_KEY); } catch (e) {}
      idbClear(function () { refreshPanel(); status('缓存已清空，从现在起重新记。'); });
    };
    refreshPanel();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel);
  } else {
    setTimeout(initPanel, 500);
  }
})();
