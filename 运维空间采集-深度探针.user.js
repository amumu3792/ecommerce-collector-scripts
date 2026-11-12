// ==UserScript==
// @name         运维空间采集-深度探针
// @namespace    https://workspace/operations-space
// @version      1.0.0
// @description  深度探针：拦截页面接口返回 + 抓非表结构。只读，不发任何额外请求。
// @match        https://compass.jinritemai.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-%E6%B7%B1%E5%BA%A6%E6%8E%A2%E9%92%88.user.js
// @downloadURL  https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-%E6%B7%B1%E5%BA%A6%E6%8E%A2%E9%92%88.user.js
// ==/UserScript==
(function () {
  'use strict';
  // 深度探针 v1.0.0（2026-11-12）
  // 表只是数据最后长出来的样子。数据本身是 JSON 从接口拉回来的——表没出来，
  // 不代表数据没到。这支脚本在数据回来的路上记下来，顺带抓非表结构。
  // 只读：不发任何额外请求，不改请求，不改返回，不改页面行为。
  // 跑在你自己的浏览器里，用你自己的登录态和指纹，不是另外一台机器在爬。
  var PAGE_KEY = 'spaceImport.deepProbe.pages.v1';
  var MAX_CALLS = 200;      // 一页最多记 200 个接口
  var MAX_BODY = 1024 * 1024; // 单个响应正文最多记 1MB
  var calls = [];   // {url, method, status, time, bytes, isJson, keys, sample}
  var bodies = {};  // url -> JSON 正文（只存能解析成 JSON 的）

  function isStatic(url) {
    return /\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico|map)(\?|$)/i.test(url);
  }
  function record(url, method, status, text) {
    try {
      var entry = { url: url, method: method, status: status, time: Date.now(), bytes: (text || '').length, isJson: false, keys: [], sample: '' };
      if (text) {
        try {
          var j = JSON.parse(text);
          entry.isJson = true;
          if (j && typeof j === 'object') entry.keys = Object.keys(j).slice(0, 40);
          if (text.length <= MAX_BODY) bodies[url] = text;
        } catch (e) { /* 不是 JSON，只记元数据 */ }
        entry.sample = text.slice(0, 300);
      }
      calls.push(entry);
      if (calls.length > MAX_CALLS) calls.shift();
      refreshCount();
    } catch (e) { /* 忽略，绝不能影响页面 */ }
  }

  // ---- 拦截层：包 fetch 和 XHR，包完把 toString 还原成 native，页面查不出来 ----
  try {
    var nativeFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var url = '';
      var method = 'GET';
      try {
        url = String((args[0] && args[0].url) || args[0] || '');
        method = String((args[1] && args[1].method) || (args[0] && args[0].method) || 'GET');
      } catch (e) { /* 忽略 */ }
      return nativeFetch.apply(this, args).then(function (resp) {
        if (url && !isStatic(url)) {
          try {
            resp.clone().text().then(function (t) { record(url, method, resp.status, t); }).catch(function () {});
          } catch (e) { /* 忽略 */ }
        }
        return resp;
      });
    };
    window.fetch.toString = function () { return 'function fetch() { [native code] }'; };
  } catch (e) { /* 忽略 */ }

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
        if (url && !isStatic(url)) {
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
  } catch (e) { /* 忽略 */ }

  // ---- 工具 ----
  function storeGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function storeSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
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

  // ---- 深结构：表 + 非表重复结构 + 页面可见文字 + 全局状态键 ----
  function deepDump() {
    var out = { url: location.href, title: document.title, time: new Date().toISOString(), tables: [], lists: [], pageText: '', globals: [], pagination: '' };
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
      // 非表重复结构：找孩子多、孩子长得一样的容器（卡片墙、虚拟列表都长这样）
      var cands = [];
      var all = document.querySelectorAll('div,ul,section');
      for (var j = 0; j < all.length && j < 3000; j++) {
        var p = all[j];
        var kids = p.children;
        if (kids.length < 3) continue;
        var tag0 = kids[0].tagName;
        var same = 0;
        for (var k = 0; k < kids.length; k++) if (kids[k].tagName === tag0) same++;
        if (same >= 3 && same === kids.length) {
          var texts = [];
          for (var m = 0; m < Math.min(3, kids.length); m++) texts.push(elText(kids[m]).slice(0, 120));
          cands.push({ tag: p.tagName, cls: (p.className && p.className.baseVal !== undefined) ? '' : String(p.className || '').slice(0, 80), count: kids.length, sample: texts });
        }
      }
      cands.sort(function (a, b) { return b.count - a.count; });
      out.lists = cands.slice(0, 8);
    } catch (e) {}
    try { out.pageText = (document.body.innerText || '').replace(/\s+\n/g, '\n').slice(0, 5000); } catch (e) {}
    try {
      var keys = Object.keys(window).filter(function (k) { return /STATE|DATA|__STORE|redux|store/i.test(k); }).slice(0, 30);
      out.globals = keys.map(function (k) { var v; try { v = typeof window[k]; } catch (e) { v = '?'; } return k + ':' + v; });
    } catch (e) {}
    try {
      var pg = document.querySelector('ul.aurora-pagination');
      if (pg) out.pagination = elText(pg).slice(0, 200);
    } catch (e) {}
    return out;
  }

  function savePageSummary() {
    var pages = storeGet(PAGE_KEY, {});
    var apis = calls.map(function (c) { return c.method + ' ' + c.url + ' [' + c.status + '] ' + (c.isJson ? 'JSON ' + c.keys.length + '键' : '非JSON'); });
    pages[location.href.split('?')[0]] = { time: new Date().toISOString(), apiCount: calls.length, apis: apis };
    storeSet(PAGE_KEY, pages);
  }

  // ---- 面板 ----
  var statusEl = null;
  var countEl = null;
  function refreshCount() {
    if (countEl) countEl.textContent = '已拦截接口：' + calls.length + ' 个（JSON ' + calls.filter(function (c) { return c.isJson; }).length + ' 个）';
  }
  function status(msg) { if (statusEl) statusEl.textContent = msg; }
  function initPanel() {
    if (document.getElementById('sip-deepprobe-panel')) return;
    var box = document.createElement('div');
    box.id = 'sip-deepprobe-panel';
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:999999;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.6;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:360px;';
    box.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">深度探针 <span style="font-weight:400;color:#94a3b8;">v1.0.0 · 只读拦截</span></div>'
      + '<div id="sip-dp-count" style="color:#7dd3fc;">已拦截接口：0 个</div>'
      + '<div style="margin-top:8px;">'
      + '<button id="sip-dp-export" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">导出本页接口数据</button>'
      + '<button id="sip-dp-dump" style="background:#059669;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">抓本页深结构</button>'
      + '<button id="sip-dp-clear" style="background:#475569;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;">清空记录</button>'
      + '</div>'
      + '<div id="sip-dp-status" style="color:#fbbf24;margin-top:6px;min-height:18px;">等页面加载完，接口会自动记下来。</div>';
    document.body.appendChild(box);
    statusEl = document.getElementById('sip-dp-status');
    countEl = document.getElementById('sip-dp-count');
    document.getElementById('sip-dp-export').onclick = function () {
      savePageSummary();
      downloadFile('deep-probe-' + stamp() + '.json', { tool: 'deep-probe/1.0.0', url: location.href, time: new Date().toISOString(), calls: calls, bodies: bodies, pages: storeGet(PAGE_KEY, {}) });
      status('已导出本页 ' + calls.length + ' 个接口（含 JSON 正文），发我。');
    };
    document.getElementById('sip-dp-dump').onclick = function () {
      var d = deepDump();
      downloadFile('deep-dump-' + stamp() + '.json', { tool: 'deep-probe/1.0.0', dump: d });
      status('深结构已导出：表 ' + d.tables.length + ' 张、重复结构 ' + d.lists.length + ' 处。发我。');
    };
    document.getElementById('sip-dp-clear').onclick = function () {
      calls.length = 0; bodies = {}; refreshCount(); status('已清空，从现在起重新记。');
    };
    refreshCount();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel);
  } else {
    setTimeout(initPanel, 500);
  }
  // 页面快关掉/跳走之前，把这页的接口清单记下来（正文只在导出时带走）
  window.addEventListener('beforeunload', savePageSummary);
})();
