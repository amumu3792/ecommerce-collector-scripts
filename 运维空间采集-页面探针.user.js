// ==UserScript==
// @name         运维空间采集 · 页面探针
// @namespace    https://github.com/amumu3792/ecommerce-collector-scripts
// @version      1.1.9
// @description  罗盘全站通用探针。顶栏按 data-subway-href 认页面，左菜单按 data-left-menu-id 点一下走；点“一键扫全部页面”先悬停认下拉子页面，再自己一页一页翻过去抓完；平时正常逛也悄悄收录；最后点“导出全部结构”，只下一个总文件。
// @author       Edison
// @match        https://compass.jinritemai.com/*
// @match        https://fxg.jinritemai.com/*
// @match        https://creator.douyin.com/creator-micro/data-center/content
// @updateURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-%E9%A1%B5%E9%9D%A2%E6%8E%A2%E9%92%88.user.js
// @downloadURL  https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-%E9%A1%B5%E9%9D%A2%E6%8E%A2%E9%92%88.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var STORE_KEY = 'spaceImport.probe.pages.v1';
  var WALK_KEY = 'spaceImport.probe.walk.v1';
  var SUBMENU_KEY = 'spaceImport.probe.submenus.v1';
  var PACE_KEY = 'spaceImport.probe.pace.v1';
  // 真人节奏：每页停留 15~30 秒再走（默认慢速），间隔随机，不机械。
  // 平台反爬看的就是短时间内连续请求，宁可慢，不能快到报“请求太快”影响账号。
  // 2026-11-11 实测：65 页里 53 页抓空，就是翻得太快、表还没出来就抓了。
  function paceSlow() { return storeGet(PACE_KEY, 'slow') !== 'fast'; }
  function humanDelay() {
    if (paceSlow()) return 15000 + Math.random() * 15000;
    return 8000 + Math.random() * 7000;
  }
  function hoverDelay() {
    if (paceSlow()) return 900 + Math.random() * 700;
    return 500 + Math.random() * 300;
  }

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
      tool: 'page-probe/1.1.8',
      url: location.href,
      title: document.title,
      time: new Date().toISOString(),
      tables: [],
      pagination: {},
      navPages: [],
      navBar: {},
      leftMenu: { title: '', items: [] },
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
      Array.from(navBar.querySelectorAll('a, button, li, [role="menuitem"], [role="tab"], .menuName-iiOPo5, [data-subway-href]')).forEach(function (el) {
        var t = clean(el.innerText || el.textContent || '');
        if (!t || t.length > 20 || seenNav[t]) return;
        seenNav[t] = true;
        var href = (el.getAttribute && el.getAttribute('href')) || '';
        out.navBar.items.push({ text: t, href: href, tag: el.tagName.toLowerCase() });
      });
    }

    // 顶上导航栏的页面清单：地址在 data-subway-href 里（div，不是 <a> 链接）。
    // 再加以前悬停枚举到的下拉子页面。
    var seenHref = {};
    function addNavPage(name, href, parent) {
      if (!href) return;
      var full = href.indexOf('http') === 0 ? href : (href.charAt(0) === '/' ? location.origin + href : location.origin + '/' + href);
      if (seenHref[full]) return;
      var t = clean(name || '');
      if (!t) return;
      seenHref[full] = true;
      out.navPages.push({ name: t.slice(0, 40), href: full, parent: parent || '' });
    }
    Array.from(document.querySelectorAll('[data-subway-href]')).forEach(function (el) {
      addNavPage(el.innerText || el.textContent, el.getAttribute('data-subway-href'), '');
    });
    var storedSubs = storeGet(SUBMENU_KEY, []);
    storedSubs.forEach(function (sp) { addNavPage(sp.name, sp.href, sp.parent); });
    Array.from(document.querySelectorAll('a[href]')).forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('/shop/') === -1 && href.indexOf('compass.jinritemai.com') === -1) return;
      addNavPage(a.innerText || a.textContent, href, '');
    });

    // 左侧导航栏（每个模块里各有一排）：项是 div[data-left-menu-id]，没有地址，
    // 只能点一下跳过去；带锁的（.icon-Crx3Tu 里有锁形图标）是受限功能。
    var leftBox = document.querySelector('[data-marker-key="left-menu-container"]');
    if (leftBox) {
      var lt = leftBox.querySelector('.titleText-C31cAR');
      out.leftMenu.title = lt ? clean(lt.innerText || lt.textContent) : '';
      Array.from(leftBox.querySelectorAll('[data-left-menu-id]')).forEach(function (el) {
        var label = el.querySelector('.menuLabel-_yn12A');
        var name = clean((label ? label.innerText || label.textContent : el.innerText || el.textContent) || '');
        var locked = !!el.querySelector('.icon-Crx3Tu');
        var cls = (el.className && typeof el.className === 'string') ? el.className : '';
        out.leftMenu.items.push({
          id: el.getAttribute('data-left-menu-id'),
          name: name,
          active: cls.indexOf('active') !== -1,
          locked: locked
        });
      });
    }

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

  // 等表出来再抓：很多页数据是异步加载的，3 秒不够就抓空。
  // 2026-11-11 第二轮实测：空壳表也有 2 行（无表头、无文字），只看行数会提前抓空。
  // 所以等的是“数据行里有真文字、且行数两次看一样”；5 秒了连 table 都没有，
  // 说明这页本来就没表，不再空等；有表没数据最多等 20 秒。
  function waitForTables(done) {
    var waited = 0;
    var lastCount = -1;
    var stable = 0;
    var timer = setInterval(function () {
      waited += 1000;
      var tableCount = 0;
      var dataText = 0;
      var rowCount = 0;
      try {
        var tbs = document.querySelectorAll('table');
        tableCount = tbs.length;
        for (var i = 0; i < tbs.length; i++) {
          var rows = tbs[i].querySelectorAll('tbody tr');
          rowCount += rows.length;
          for (var j = 1; j < rows.length; j++) {
            dataText += (rows[j].innerText || rows[j].textContent || '').replace(/\s+/g, '').length;
          }
        }
      } catch (e) { /* 忽略 */ }
      if (tableCount === 0 && waited >= 5000) { clearInterval(timer); done(); return; }
      if (dataText > 0) {
        if (rowCount === lastCount) { stable++; } else { stable = 0; }
        lastCount = rowCount;
        if (stable >= 1) { clearInterval(timer); done(); return; }
      }
      if (waited >= 20000) { clearInterval(timer); done(); }
    }, 1000);
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
    downloadFile('probe-all-' + stamp() + '.json', { tool: 'page-probe/1.1.8', exportedAt: new Date().toISOString(), pageCount: pages.length, pages: pages });
    status('已导出全部结构：' + pages.length + ' 页，一个文件，发给 Edison 就行。');
  }

  function exportThisPage() {
    var d = dump();
    var n = savePage(d);
    var pageSlug = location.pathname.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
    downloadFile('page-probe-' + pageSlug + '-' + stamp() + '.json', d);
    status('本页已导出，也已记下来（共收录 ' + n + ' 页）。');
  }

  // ---- 下拉子页面枚举：逐项悬停顶栏，出来下拉就把里面的子页面记下来 ----
  // 顶栏每项都是 ecom-dropdown-trigger，子页面只在悬停后出现，不悬停看不到。
  function collectSubmenus(done) {
    var tops = Array.from(document.querySelectorAll('#compass-shop-header [data-subway-href], .menuName-iiOPo5[data-subway-href]'));
    if (!tops.length) { if (done) done(0); return; }
    var known = {};
    Array.from(document.querySelectorAll('[data-subway-href]')).forEach(function (el) {
      known[el.getAttribute('data-subway-href')] = true;
    });
    var found = storeGet(SUBMENU_KEY, []);
    var foundHref = {};
    found.forEach(function (sp) { foundHref[sp.href] = true; });
    var i = 0;
    function step() {
      if (i >= tops.length) {
        storeSet(SUBMENU_KEY, found);
        if (done) done(found.length);
        return;
      }
      var top = tops[i];
      var parentName = clean(top.innerText || top.textContent || '');
      try {
        top.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        top.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      } catch (e) { /* 忽略 */ }
      setTimeout(function () {
        Array.from(document.querySelectorAll('[data-subway-href]')).forEach(function (el) {
          var href = el.getAttribute('data-subway-href');
          if (!href || known[href]) return;
          var full = href.charAt(0) === '/' ? location.origin + href : href;
          if (foundHref[full]) return;
          foundHref[full] = true;
          found.push({ name: clean(el.innerText || el.textContent || '').slice(0, 40), href: full, parent: parentName });
        });
        i++;
        step();
      }, hoverDelay());
    }
    step();
  }

  // 页面签名：地址 + 表行数 + 首行，用来判断点一下之后页面变了没有。
  function pageSig() {
    var tb = document.querySelector('table');
    var rows = tb ? tb.querySelectorAll('tbody tr') : [];
    var first = rows.length ? clean(rows[0].innerText || rows[0].textContent).slice(0, 60) : '';
    return location.href + '|' + rows.length + '|' + first;
  }

  // ---- 一键扫全部：顶栏页按地址跳，左菜单项点一下跳 ----
  // 队里两种活：{kind:'url'} 按地址跳页；{kind:'click'} 点左菜单项。
  // 每到一页先抓结构，再把这页左菜单里没走过的项（跳过带锁的）排进队，
  // 本模块的点完再跳下一个顶栏页。
  function startWalk() { startWalkMode(false); }
  function startWalkEmpty() { startWalkMode(true); }
  function pathOf(href) { try { return new URL(href).pathname; } catch (e) { return href.split('?')[0]; } }
  function startWalkMode(onlyEmpty) {
    var stored = storeGet(SUBMENU_KEY, []);
    if (stored.length) { status('下拉子页面之前已认过，直接开始扫…'); startWalkGo(onlyEmpty); return; }
    status('先把顶栏每一项的下拉子页面认一遍…');
    collectSubmenus(function () { startWalkGo(onlyEmpty); });
  }
  function startWalkGo(onlyEmpty) {
      var d = dump();
      savePage(d);
      var queue = [];
      var queuedLeft0 = {};
      (d.leftMenu.items || []).forEach(function (it) {
        if (!it.locked && !it.active) {
          queuedLeft0[it.id] = true;
          queue.push({ kind: 'click', leftMenuId: it.id, name: it.name, parent: d.leftMenu.title || '' });
        }
      });
      d.navPages.forEach(function (p) {
        if (p.href.indexOf(location.origin) !== 0) return;
        if (p.href.split('#')[0].split('?')[0] === location.href.split('#')[0].split('?')[0]) return;
        queue.push({ kind: 'url', href: p.href, name: p.name });
      });
      if (onlyEmpty) {
        // 只补空页：已经抓到表的页不再走；总览页本来就没表，抓回来还是空，不用反复补。
        var all = storeGet(STORE_KEY, {});
        var hasTable = {};
        Object.keys(all).forEach(function (u) {
          if ((all[u].tables || []).length) hasTable[pathOf(u)] = true;
        });
        queue = queue.filter(function (e) {
          if (e.kind !== 'url') return true;
          return !hasTable[pathOf(e.href)];
        });
        if (!queue.length) { status('空页都补完了，没有需要再走的页。'); refreshPanel(); return; }
      }
      if (!queue.length) {
        status('这页没认到可走的页面。已把这页结构记下来了，点“导出全部结构”发我，我再看。');
        refreshPanel();
        return;
      }
      storeSet(WALK_KEY, { queue: queue, index: 0, queuedLeft: queuedLeft0, doneLeft: {}, startedAt: new Date().toISOString() });
      status('开始扫全部页面，正在去：' + (queue[0].name || '') + '…');
      setTimeout(function () { walkTakeNext(); }, 800);
  }

  function stopWalk() {
    storeDel(WALK_KEY);
    status('已停止扫描。已收录的还在，点“导出全部结构”可以先发出来。');
    refreshPanel();
  }

  function walkFinish() {
    var all = storeGet(STORE_KEY, {});
    storeDel(WALK_KEY);
    status('全部扫完：共收录 ' + Object.keys(all).length + ' 页，正在下一个总文件…');
    setTimeout(exportAll, 600);
    refreshPanel();
  }

  // 走队里下一个。点左菜单项时等页面变了（地址或表内容变）再继续；
  // 整页刷新了就由新页面加载后接着走，不会重复。
  function walkTakeNext() {
    var walk = storeGet(WALK_KEY, null);
    if (!walk) return;
    waitForTables(function () { walkTakeNextGo(walk); });
  }
  function walkTakeNextGo(walk) {
    var d = dump();
    var n = savePage(d);
    refreshPanel();
    (d.leftMenu.items || []).forEach(function (it) {
      if (it.locked || it.active) return;
      if (walk.queuedLeft[it.id] || walk.doneLeft[it.id]) return;
      walk.queuedLeft[it.id] = true;
      walk.queue.push({ kind: 'click', leftMenuId: it.id, name: it.name, parent: d.leftMenu.title || '' });
    });
    storeSet(WALK_KEY, walk);
    while (walk.index < walk.queue.length) {
      var next = walk.queue[walk.index];
      walk.index++;
      storeSet(WALK_KEY, walk);
      if (next.kind === 'url') {
        status('正在去：' + (next.name || next.href) + '（已收录 ' + n + ' 页）');
        setTimeout(function () { location.href = next.href; }, humanDelay());
        return;
      }
      // click 项：只在本模块的页面上点得到，找不到了就跳过。
      var el = document.querySelector('[data-left-menu-id="' + next.leftMenuId + '"]');
      if (!el) continue;
      if (walk.doneLeft[next.leftMenuId]) continue;
      walk.doneLeft[next.leftMenuId] = true;
      storeSet(WALK_KEY, walk);
      status('正在扫：' + (next.parent ? next.parent + ' / ' : '') + next.name + '（已收录 ' + n + ' 页）');
      var prevSig = pageSig();
      var prevUrl = location.href;
      try { el.click(); } catch (e) { /* 忽略 */ }
      var waited = 0;
      var timer = setInterval(function () {
        waited += 500;
        if (location.href !== prevUrl || pageSig() !== prevSig || waited >= 10000) {
          clearInterval(timer);
          setTimeout(walkTakeNext, humanDelay());
        }
      }, 500);
      return;
    }
    walkFinish();
  }

  function walkStep() {
    walkTakeNext();
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
    var emptyBtn = document.getElementById('sip-probe-empty');
    if (emptyBtn) emptyBtn.style.display = walk ? 'none' : 'inline-block';
  }

  function init() {
    if (document.getElementById('sip-probe-panel')) return;
    var div = document.createElement('div');
    div.id = 'sip-probe-panel';
    div.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#111827;color:#fff;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.6;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:300px;font-family:sans-serif;';
    div.innerHTML = '<div id="sip-probe-head" style="display:flex;align-items:center;cursor:move;user-select:none;margin-bottom:4px;">'
      + '<span style="font-weight:700;flex:1;">页面探针</span>'
      + '<button id="sip-probe-min" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:1px 8px;cursor:pointer;font-size:14px;line-height:1.4;">—</button>'
      + '</div>'
      + '<div id="sip-probe-body">'
      + '<div id="sip-probe-count" style="color:#cbd5e1;margin-bottom:8px;">已收录 0 页</div>'
      + '<div style="margin-bottom:8px;">'
      + '<button id="sip-probe-walk" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">一键扫全部页面</button>'
      + '<button id="sip-probe-empty" style="background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;">只补空页</button>'
      + '<button id="sip-probe-stop" style="background:#dc2626;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;margin-right:6px;display:none;">停止</button>'
      + '<button id="sip-probe-all" style="background:#059669;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;">导出全部结构</button>'
      + '</div>'
      + '<div style="margin-bottom:8px;"><button id="sip-probe-pace" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:5px 10px;cursor:pointer;">速度：慢（稳妥）</button></div>'
      + '<div><button id="sip-probe-one" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:5px 10px;cursor:pointer;">只导出本页</button>'
      + '<button id="sip-probe-clear" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:5px 10px;cursor:pointer;margin-left:6px;">清空已收录</button></div>'
      + '<div id="sip-probe-status" style="margin-top:8px;color:#94a3b8;"></div>'
      + '</div>';
    document.body.appendChild(div);
    // 面板可缩小、可拖拽（2026-11-12 lin：面板挡住翻页按钮没法挪）
    // 位置和缩小状态存在浏览器本地，换页还在。
    (function () {
      var minKey = 'spaceImport.probe.panelMin.v1';
      var posKey = 'spaceImport.probe.panelPos.v1';
      var body = document.getElementById('sip-probe-body');
      var minBtn = document.getElementById('sip-probe-min');
      var head = document.getElementById('sip-probe-head');
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
          div.style.right = 'auto'; div.style.bottom = 'auto';
          div.style.left = pos.left + 'px'; div.style.top = pos.top + 'px';
        }
      } catch (e) {}
      head.addEventListener('mousedown', function (e) {
        if (e.target === minBtn) return;
        var sx = e.clientX, sy = e.clientY;
        var r = div.getBoundingClientRect();
        var dx = sx - r.left, dy = sy - r.top;
        function move(ev) {
          var nx = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx));
          var ny = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
          div.style.right = 'auto'; div.style.bottom = 'auto';
          div.style.left = nx + 'px'; div.style.top = ny + 'px';
        }
        function up(ev) {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          move(ev);
          try { localStorage.setItem(posKey, JSON.stringify({ left: parseInt(div.style.left, 10), top: parseInt(div.style.top, 10) })); } catch (e) {}
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
      });
    })();
    var paceBtn = document.getElementById('sip-probe-pace');
    paceBtn.textContent = paceSlow() ? '速度：慢（稳妥）' : '速度：较快';
    paceBtn.onclick = function () {
      storeSet(PACE_KEY, paceSlow() ? 'fast' : 'slow');
      paceBtn.textContent = paceSlow() ? '速度：慢（稳妥）' : '速度：较快';
      status(paceSlow() ? '已切到慢速：每页停 15~30 秒再走。' : '已切到较快：每页停 8~15 秒。还是建议用慢速。');
    };
    document.getElementById('sip-probe-walk').onclick = startWalk;
    document.getElementById('sip-probe-empty').onclick = startWalkEmpty;
    document.getElementById('sip-probe-stop').onclick = stopWalk;
    document.getElementById('sip-probe-all').onclick = exportAll;
    document.getElementById('sip-probe-one').onclick = exportThisPage;
    document.getElementById('sip-probe-clear').onclick = function () {
      storeDel(STORE_KEY);
      refreshPanel();
      status('已清空，重新开始收。');
    };
    refreshPanel();

    // 平时正常逛：每页加载后悄悄记下来，不用点；
// 扫描进行中：抓完这页就自动去下一页。
    // 顺便在后台把下拉子页面也认一遍，攒着以后走。
    setTimeout(function () {
      var walk = storeGet(WALK_KEY, null);
      if (walk && walk.queue && walk.queue.length) {
        walkStep();
      } else {
        waitForTables(function () {
          var n = savePage(dump());
        var countEl = document.getElementById('sip-probe-count');
        if (countEl) countEl.textContent = '已收录 ' + n + ' 页';
          if (!storeGet(SUBMENU_KEY, []).length) collectSubmenus(function () { /* 后台认完，下次扫就用得上 */ });
        });
      }
    }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
