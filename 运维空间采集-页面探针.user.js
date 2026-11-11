// ==UserScript==
// @name         运维空间采集 · 页面探针
// @namespace    https://github.com/amumu3792/ecommerce-collector-scripts
// @version      1.1.1
// @description  罗盘全站通用探针。平时你正常逛罗盘，它悄悄把每页结构记下来；点“一键扫全部页面”，它自己顺着顶上导航栏一页一页翻过去抓完；最后点“导出全部结构”，只下一个总文件。每页都把导航栏原样记下来，不再猜导航长什么样。
// @author       Edison
// @match        https://compass.jinritemai.com/shop/*
// @match        https://fxg.jinritemai.com/ffa/mcompass/*
// @match        https://creator.douyin.com/creator-micro/data-center/content
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var STORE_KEY = 'spaceImport.probe.pages.v1';
  var WALK_KEY = 'spaceImport.probe.walk.v1';

  function clean(s) { return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }

  function storeGet(k, d) {
    try { var s = localStorage.getItem(k); return s === null ? d : JSON.parse(s); } catch (e) { return d; }
  }
  function storeSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
  }
  function storeDel(k) {
    try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
  }

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
      tool: 'page-probe/1.1',
      url: location.href,
      title: document.title,
      time: new Date().toISOString(),
      tables: [],
      pagination: {},
      navPages: [],
      navBar: {},
      dateControls: [],
      buttons: [],
      totalsText: []
    };

    Array.from(document.querySelectorAll('table')).forEach(function (tb, ti) {
      var ths = Array.from(tb.querySelectorAll('thead th')).map(function (th) { return clean(th.innerText || th.textContent); });
      var rows = Array.from(tb.querySelectorAll('tbody tr'));
      var sample = rows.slice(0, 2).map(function (tr) {
        return Array.from(tr.querySelectorAll('td')).map(function (td) { return clean(td.innerText || td.textContent).slice(0, 80); });
      });
      out.tables.push({ index: ti, headers: ths, rowCount: rows.length, sampleRows: sample });
    });

    var pag = document.querySelector('.arco-pagination, .auxo-pagination, .ecom-pagination, [class*="pagination"]');
    if (pag) {
      out.pagination.found = true;
      out.pagination.text = clean(pag.innerText || pag.textContent).slice(0, 1000);
      out.pagination.outerHTML = pag.outerHTML.slice(0, 8000);
      out.pagination.items = Array.from(pag.querySelectorAll('button, li, a, span')).map(elInfo);
    } else {
      out.pagination.found = false;
    }

    // 顶上导航栏本身：样子 + 每一项的名字（不管它是链接还是点一下跳转的）。
    // 以前老地图没记导航栏长什么样，这次每页都记下来，以后不再猜。
    var navBar = null;
    var navCands = document.querySelectorAll('header, nav, [class*="header"], [class*="top-bar"], [class*="topbar"], [class*="nav-bar"], [class*="navbar"], [class*="menu"]');
    for (var ni = 0; ni < navCands.length && !navBar; ni++) {
      var cand = navCands[ni];
      var ct = clean(cand.innerText || cand.textContent || '');
      if (ct.length > 10) navBar = cand;
    }
    if (navBar) {
      out.navBar.html = navBar.outerHTML.slice(0, 6000);
      out.navBar.items = [];
      var seenNav = {};
      Array.from(navBar.querySelectorAll('a, button, li, [role="menuitem"], [role="tab"]')).forEach(function (el) {
        var t = clean(el.innerText || el.textContent || '');
        if (!t || t.length > 20 || seenNav[t]) return;
        seenNav[t] = true;
        var href = (el.getAttribute && el.getAttribute('href')) || '';
        out.navBar.items.push({ text: t, href: href, tag: el.tagName.toLowerCase() });
      });
    }

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

    var bodyText = clean(document.body.innerText || document.body.textContent || '');
    var re = /共\s*\d+\s*[条页]|总数[^0-9]{0,5}\d+|\d+\s*\/\s*\d+/g;
    var m;
    while ((m = re.exec(bodyText)) !== null) out.totalsText.push(m[0]);

    Array.from(document.querySelectorAll('[class*="radio-button-wrapper-checked"], .arco-radio-checked, [aria-checked="true"]')).forEach(function (el) {
      var t = clean(el.innerText || el.textContent);
      if (t) out.dateControls.push(t.slice(0, 60));
    });

    Array.from(document.querySelectorAll('button, li, a')).forEach(function (el) {
      var t = clean(el.innerText || el.textContent);
      if (/下一页|上一页|查询|导出|下载/.test(t) && t.length < 30) out.buttons.push(elInfo(el));
    });

    return out;
  }

  function savePage(d) {
    var all = storeGet(STORE_KEY, {});
    all[d.url] = d;
    storeSet(STORE_KEY, all);
    return Object.keys(all).length;
  }

  function downloadFile(filename, obj) {
    var blob = new Blob(['\uFEFF' + JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }

  function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

  function exportAll() {
    var all = storeGet(STORE_KEY, {});
    var pages = Object.keys(all).map(function (k) { return all[k]; });
    if (!pages.length) { status('还没收录任何页面，先逛一逛或点“一键扫全部页面”。'); return; }
    downloadFile('probe-all-' + stamp() + '.json', { tool: 'page-probe/1.1', exportedAt: new Date().toISOString(), pageCount: pages.length, pages: pages });
    status('已导出全部结构：' + pages.length + ' 页，一个文件，发给 Edison 就行。');
  }

  function exportThisPage() {
    var d = dump();
    var n = savePage(d);
    var pageSlug = location.pathname.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
    downloadFile('page-probe-' + pageSlug + '-' + stamp() + '.json', d);
    status('本页已导出，也已记下来（共收录 ' + n + ' 页）。');
  }

  // ---- 一键扫全部：顺着菜单自己翻页，扫完只下一个总文件 ----
  function startWalk() {
    var d = dump();
    var queue = d.navPages.filter(function (p) { return p.href.indexOf(location.origin) === 0; });
    if (!queue.length) {
      // 导航栏里的项不是链接（点一下跳转的那种），翻页队排不出来。
      // 先把这页结构（含导航栏原样）记下来，发我看一眼再改，不硬猜。
      savePage(d);
      status('这页导航栏里的项不是链接，自动翻页排不出来。已把这页结构记下来了，点“导出全部结构”发我，我看一眼导航栏到底长什么样再改。');
      refreshPanel();
      return;
    }
    // 当前页先算进去，队列里去掉当前页
    savePage(d);
    queue = queue.filter(function (p) { return p.href.split('#')[0] !== location.href.split('#')[0]; });
    storeSet(WALK_KEY, { queue: queue, index: 0, total: queue.length + 1, startedAt: new Date().toISOString() });
    status('开始扫全部页面，共 ' + (queue.length + 1) + ' 页，正在去第 2 页…');
    setTimeout(function () { location.href = queue[0].href; }, 800);
  }

  function stopWalk() {
    storeDel(WALK_KEY);
    status('已停止扫描。已收录的还在，点“导出全部结构”可以先发出来。');
    refreshPanel();
  }

  function walkStep() {
    var walk = storeGet(WALK_KEY, null);
    if (!walk || !walk.queue || !walk.queue.length) return false;
    var n = savePage(dump());
    var next = walk.index + 1;
    if (next >= walk.queue.length) {
      storeDel(WALK_KEY);
      status('全部扫完：共 ' + walk.total + ' 页，正在下一个总文件…');
      setTimeout(exportAll, 600);
      return true;
    }
    walk.index = next;
    storeSet(WALK_KEY, walk);
    status('正在扫第 ' + (next + 1) + ' / 共 ' + walk.total + ' 页：' + (walk.queue[next].name || '') + '（已收录 ' + n + ' 页）');
    setTimeout(function () { location.href = walk.queue[next].href; }, 1200);
    return true;
  }

  function status(msg) {
    var el = document.getElementById('sip-probe-status');
    if (el) el.textContent = msg;
  }

  function refreshPanel() {
    var all = storeGet(STORE_KEY, {});
    var countEl = document.getElementById('sip-probe-count');
    if (countEl) countEl.textContent = '已收录 ' + Object.keys(all).length + ' 页';
    var walk = storeGet(WALK_KEY, null);
    var stopBtn = document.getElementById('sip-probe-stop');
    if (stopBtn) stopBtn.style.display = walk ? 'inline-block' : 'none';
    var walkBtn = document.getElementById('sip-probe-walk');
    if (walkBtn) walkBtn.style.display = walk ? 'none' : 'inline-block';
  }

  function init() {
    if (document.getElementById('sip-probe-panel')) return;
    var div = document.createElement('div');
    div.id = 'sip-probe-panel';
    div.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#111827;color:#fff;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.6;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:300px;font-family:sans-serif;';
    div.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">页面探针</div>'
      + '<div id="sip-probe-count" style="color:#cbd5e1;margin-bottom:8px;">已收录 0 页</div>'
      + '<div style="margin-bottom:8px;">'
      + '<button id="sip-probe-walk" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">一键扫全部页面</button>'
      + '<button id="sip-probe-stop" style="background:#dc2626;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;display:none;">停止</button>'
      + '<button id="sip-probe-all" style="background:#059669;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;">导出全部结构</button>'
      + '</div>'
      + '<div><button id="sip-probe-one" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:5px 10px;cursor:pointer;">只导出本页</button>'
      + '<button id="sip-probe-clear" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:5px 10px;cursor:pointer;margin-left:6px;">清空已收录</button></div>'
      + '<div id="sip-probe-status" style="margin-top:8px;color:#94a3b8;"></div>';
    document.body.appendChild(div);
    document.getElementById('sip-probe-walk').onclick = startWalk;
    document.getElementById('sip-probe-stop').onclick = stopWalk;
    document.getElementById('sip-probe-all').onclick = exportAll;
    document.getElementById('sip-probe-one').onclick = exportThisPage;
    document.getElementById('sip-probe-clear').onclick = function () {
      storeDel(STORE_KEY);
      refreshPanel();
      status('已清空，重新开始收。');
    };
    refreshPanel();

    // 平时正常逛：每页加载后悄悄记下来，不用点。
    // 扫描进行中：抓完这页就自动去下一页。
    setTimeout(function () {
      var walk = storeGet(WALK_KEY, null);
      if (walk && walk.queue && walk.queue.length) {
        walkStep();
      } else {
        var n = savePage(dump());
        var countEl = document.getElementById('sip-probe-count');
        if (countEl) countEl.textContent = '已收录 ' + n + ' 页';
      }
    }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
