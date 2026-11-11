// ==UserScript==
// @name         运维空间采集 · 页面探针
// @namespace    https://github.com/amumu3792/ecommerce-collector-scripts
// @version      1.0.2
// @description  罗盘全站通用探针：在罗盘任意一页点一下，导出那页的表头、分页、总数、日期控件、按钮，外加左边菜单里的全部页面清单（一页一个文件，文件名带页名）。
// @author       Edison
// @match        https://compass.jinritemai.com/shop/*
// @match        https://fxg.jinritemai.com/ffa/mcompass/*
// @match        https://creator.douyin.com/creator-micro/data-center/content
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function clean(s) { return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }

  function elInfo(el) {
    var r = { tag: el.tagName.toLowerCase(), cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 200) : '' };
    if (el.id) r.id = el.id;
    var t = clean(el.innerText || el.textContent || '');
    if (t) r.text = t.slice(0, 300);
    var dis = el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true');
    if (dis) r.disabled = true;
    return r;
  }

  function dump() {
    var out = {
      tool: 'page-probe/1.0',
      url: location.href,
      title: document.title,
      time: new Date().toISOString(),
      tables: [],
      pagination: {},
      navPages: [],
      dateControls: [],
      buttons: [],
      totalsText: []
    };

    // 全部表格：表头原文、行数、首行、每列前两个单元格
    Array.from(document.querySelectorAll('table')).forEach(function (tb, ti) {
      var ths = Array.from(tb.querySelectorAll('thead th')).map(function (th) { return clean(th.innerText || th.textContent); });
      var rows = Array.from(tb.querySelectorAll('tbody tr'));
      var sample = rows.slice(0, 2).map(function (tr) {
        return Array.from(tr.querySelectorAll('td')).map(function (td) { return clean(td.innerText || td.textContent).slice(0, 80); });
      });
      out.tables.push({ index: ti, headers: ths, rowCount: rows.length, sampleRows: sample });
    });

    // 分页区：整块原文 + 外层 HTML（截断到 8000 字，够看结构）
    var pag = document.querySelector('.arco-pagination, .auxo-pagination, .ecom-pagination, [class*="pagination"]');
    if (pag) {
      out.pagination.found = true;
      out.pagination.text = clean(pag.innerText || pag.textContent).slice(0, 1000);
      out.pagination.outerHTML = pag.outerHTML.slice(0, 8000);
      out.pagination.items = Array.from(pag.querySelectorAll('button, li, a, span')).map(elInfo);
    } else {
      out.pagination.found = false;
    }

    // 左边菜单里的全部页面清单：罗盘站内链接去重，名字 + 地址都有。
    // 在任意一页点一下就能拿到整站目录，不用一页一页翻。
    var seenHref = {};
    Array.from(document.querySelectorAll('a[href]')).forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('/shop/') === -1 && href.indexOf('compass.jinritemai.com') === -1) return;
      var full = href.indexOf('http') === 0 ? href : location.origin + href;
      if (seenHref[full]) return;
      var t = clean(a.innerText || a.textContent || '');
      if (!t) return;
      seenHref[full] = true;
      out.navPages.push({ name: t.slice(0, 40), href: full });
    });

    // 全页找“共 N 条 / 共 N 页 / x / y”这类总数文字
    var bodyText = clean(document.body.innerText || document.body.textContent || '');
    var re = /共\s*\d+\s*[条页]|总数[^0-9]{0,5}\d+|\d+\s*\/\s*\d+/g;
    var m;
    while ((m = re.exec(bodyText)) !== null) out.totalsText.push(m[0]);

    // 日期控件：选中的范围按钮
    Array.from(document.querySelectorAll('[class*="radio-button-wrapper-checked"], .arco-radio-checked, [aria-checked="true"]')).forEach(function (el) {
      var t = clean(el.innerText || el.textContent);
      if (t) out.dateControls.push(t.slice(0, 60));
    });

    // 关键按钮：下一页 / 上一页 / 查询 / 导出
    Array.from(document.querySelectorAll('button, li, a')).forEach(function (el) {
      var t = clean(el.innerText || el.textContent);
      if (/下一页|上一页|查询|导出|下载/.test(t) && t.length < 30) out.buttons.push(elInfo(el));
    });

    return out;
  }

  function download() {
    var data = dump();
    var blob = new Blob(['\uFEFF' + JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var pageSlug = location.pathname.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
    a.download = 'page-probe-' + pageSlug + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    status('已导出结构文件，发给 Edison 就行。');
  }

  function status(msg) {
    var el = document.getElementById('sip-probe-status');
    if (el) el.textContent = msg;
  }

  function init() {
    if (document.getElementById('sip-probe-panel')) return;
    var div = document.createElement('div');
    div.id = 'sip-probe-panel';
    div.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#111827;color:#fff;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.6;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:280px;font-family:sans-serif;';
    div.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">页面探针</div>'
      + '<div style="color:#cbd5e1;margin-bottom:8px;">点一下，把这页的表头、分页、总数整页结构导成一个文件。</div>'
      + '<button id="sip-probe-btn" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer;">导出页面结构</button>'
      + '<div id="sip-probe-status" style="margin-top:8px;color:#94a3b8;"></div>';
    document.body.appendChild(div);
    document.getElementById('sip-probe-btn').onclick = download;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
