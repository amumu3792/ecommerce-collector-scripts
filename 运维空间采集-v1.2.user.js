// ==UserScript==
// @name         运维空间采集 v1.2（抖店罗盘搜索词 + 抖音创作者中心视频 + 罗盘视频/短视频榜）
// @namespace    https://workspace/operations-space
// @version      1.2.8
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-v1.2.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/%E8%BF%90%E7%BB%B4%E7%A9%BA%E9%97%B4%E9%87%87%E9%9B%86-v1.2.user.js
// @description  纯 DOM 采集，不拦截 API、不写飞书、不改账号内容。抖店罗盘搜索词按表头原文指纹定位（商品曝光人数取“商品曝光人数”那列，绝不取第一个含“曝光人数”的列）；抖音创作者中心视频 14 列先过表头校验再采；罗盘自营/合作视频按“流量来源”分行采（投放行与非投放行分开，标杆数只作对照）；短视频榜按榜单表头采 200 条。导出 SpaceImport/1.0 JSON，运维空间一键导入。新加的两条视频线只走本地下载，不发 VPS。
// @author       Edison（运维空间打包）
// @match        *://compass.jinritemai.com/shop/search/drainage-terms*
// @match        *://fxg.jinritemai.com/ffa/mcompass/search*
// @match        *://compass.jinritemai.com/shop/video/self*
// @match        *://compass.jinritemai.com/shop/video/cooperate*
// @match        *://compass.jinritemai.com/shop/chance/video-rank*
// @match        https://creator.douyin.com/creator-micro/data-center/content*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==
// 唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts（本地 files/ 不再存脚本副本；改脚本直接在 GitHub 网页上改，Tampermonkey 按 @updateURL 自动更新）。
//
// ============================================================
// 自查结果（2026-11-09，本地离线自查，未联网、未登录任何平台）
// ------------------------------------------------------------
// node --check 语法：通过。纯函数本地测试共 21 项，全部通过（测试文件 /tmp/space-collector-test.cjs，离线，未联网）。
// 纯函数本地测试（/tmp 模拟表格 + 仿造 DOM，未联网）：
//  [过] cleanValue：1.2万→12000；2.31亿→231000000；区间“1000-2000”原样保留不转数；
//       ¥7.5万→75000；“1,531”→1531；“86.55%”→0.8655；“-”→null。
//  [过] 商品曝光列定位回归：表头含“搜索结果曝光人数”(第3列)和“商品曝光人数”(第6列)
//       时，product_exposure 取第 6 列；旧 v5 的“第一个含‘曝光人数’的列”bug 不复现。
//  [过] parseSmartCell 值/趋势分离：amount-data-range 取值、cp-change-ratio-value 取趋势，
//       upIdentify 加“+”、downIdentify 加“-”。
//  [过] 视频表头校验：14 列齐全才采；缺“5s完播率”时报错停下，不静默导出。
//  [过] 0 行 / 缺列时不下载空文件；翻页失败时部分导出（partial:true + 原因）。
// 只能等 lin 在登着后台的浏览器里实测的：
//  [待] 罗盘页面是否改版：表头原文、class 名、翻页按钮、日期控件是否还是 2026-05～07 的样子。
//  [待] 搜索词 5 列数值逐行核对（重点：商品曝光人数、搜索人数、支付金额）。
//  [待] 视频页 14 列表头顺序与数值逐列核对；滚动加载是否采全。
//  [待] 翻页在真实罗盘上是否成功、末页是否停下。
// ============================================================
//
// 出处（只抄下面列出的段落，其余为新写；飞书凭证、飞书写入一律不抄）：
//  - clean() 清洗：V19《抖店罗盘通用表格数据采集大师》(-19.0.user.js)，区间保护＋万/亿换算。
//  - extractComplexData 复合格拆解＋[图]处理＋排名修正：同上 V19。
//  - parseSmartCell 值/趋势分离：V64《抖店罗盘·最终稳定版》(V64.0_DOM___UI___-64.0.user.js)。
//  - getColumnMap 表头文本定列、waitForNewData 动态等待、XPath 翻页兜底：
//    V4.0《抖店推荐热词采集器》(V4.0_________-_________-4.0.0.user.js)。
//  - scanCellFeatures 特征扫描（label 分类、title- 类抓搜索词）：
//    V79《抖店罗盘·特征识别版》(V79.0___________-79.0.user.js)，
//    已去掉 V79.15“所有图片都归本店曝光商品”那一步，不抄。
//  - 视频 14 列字段定义＋滚动到底＋行数稳定 3 次判定：
//    v6.6.8《抖音→飞书（只同步“通过”视频）》(-6.6.8.user.js)，
//    不抄：固定列号、状态写死“通过”、不清洗数值、只写飞书、飞书凭证、逐条 confirm。
// 不能抄的（本脚本没有）：V79.15 的翻页、硬编码列索引、删“词下热门商品”；
//  旧 v5/v3 的抓错列逻辑；1688 自动下单；v7.8 隐藏低赞视频；任何 API 拦截（全批旧脚本
//  都没有真正读响应体的 API 拦截，本脚本不谎称有）。
// v1.2 改动（2026-11-11，草稿，未在登着后台的浏览器里实测）：
// 采集逻辑与 v1 完全相同，只加两样：①设置面板（VPS 地址+钥匙，GM_setValue 存浏览器
// 本地，面板里随时能改；钥匙绝不写进文件、绝不打印到日志）；②出口：填了地址+钥匙
// 就先发 VPS，成功不下载，没填或发不出去自动改回下载。v1 的 21 项离线自查结论仍适用，
// 新增的设置面板与发 VPS 部分只做了 node --check 语法检查与静态核对，没在真页面上跑过。
// 唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts，改脚本直接在
// GitHub 网页上改，Tampermonkey 按 @updateURL 自动更新。
// ============================================================

// v1.2.8 改动（2026-11-13 已推，未在 lin 登着后台的浏览器里实测）：
// 新加两条视频线，接的是 2026-11-11 三份探针实测的表头（probe-all-2026-11-11-16-33-19.json），
// 不是五六月份旧地图：
//  ① 罗盘自营视频 /shop/video/self、合作视频 /shop/video/cooperate：单表无分页，
//     表头：流量来源 | 视频观看次数(占比) | 商品曝光次数 | 商品点击次数 | 用户支付金额(占比)
//     | 成交订单数 | 商品千次曝光成交 | 引流直播用户支付金额(占比) | 引流直播间次数
//     | 引流直播成交订单数。格子是“自家数 + 同行标杆”拼的（如 '76 同行标杆 1,162'），
//     用 parseOwnVsBenchmark 拆开：自家值、标杆值分开存，标杆只作对照，绝不拿标杆数
//     当自家数算转化率（2026-11-11 lin 纠正：投放行标杆是烧钱烧出来的，花多少不知道）。
//     流量来源那列原样导出（'全域+乘方投放时段' / '非投放时段' / 以后出现的新行），
//     投放和非投放分行算，不混在一起。缺“流量来源/视频观看次数/商品曝光次数/
//     商品点击次数/用户支付金额/成交订单数”任一列就停下报错，不瞎采。
//     缺列的闸比旧线更严：必备列只认按名认到，按位置对上的不算数——删了一列
//     不能悄悄拿邻列的数顶替。离线自查还抓到一处孪生列陷阱：删掉“成交订单数”后，
//     包含式 core 匹配会把它认到“引流直播成交订单数”那列去（“用户支付金额”同理，
//     会认到“引流直播用户支付金额”），18 项里那 1 项失败就是它；修法是 nameMatched，
//     core 模式只认核心词完全相等的，不认包含式命中，修好后才全过。
//     注意：探针只存了前两行样本，自营页非投放那行只知道存在（rowCount 3 = 表头 + 2 行数据），
//     具体数值探针里没有——脚本不猜，跑起来有几行就采几行。
//  ② 短视频榜 /shop/chance/video-rank（这才是短视频榜）：表头：排名 | 短视频 | 观看次数
//     | 用户支付金额 | 点赞数 | 评论数 | 转发数 | 关联商品 | 操作；每页 20 条，共 10 页，200 条。
//     纠正：/shop/chance/rank-video 表头是“直播内容/直播用户支付金额”，那是直播榜，
//     不是短视频榜，这版不接它，别接错页。榜单数值多是区间（'100万 - 250万'），
//     区间原样保留不转数；'一键跟拍'记成 follow_shoot，方便以后抄标。
//     翻页复用搜索词那套：aurora 分页、先读总页数、翻页前停 3~7 秒随机、
//     签名看第二行 + 末行、表头行跳过。
//  两条新线只走本地下载，不发 VPS（2026-11-10 lin 定：先跑本地，不加 VPS；
//  收数端没装、钥匙也没生成）。旧两条线（搜索词、创作者视频）逻辑一字不动，
//  只把导出里的 collector 版本字样从 v1.2.0 改成 v1.2.8。
//  商品榜 /shop/chance/rank-product（200 条、20 页）这次没接，留到视频榜跑通后再接，
//  一层一层加，不一口吃掉。
//
(function () {
'use strict';

/* __PURE_START__ */
// ---- 纯函数区：不碰 document，可在 node 里离线测试 ----

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function cleanText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// cleanValue：V19 clean() 的改写。返回 { raw, num, isRange, range, kind }
// kind: 'number' | 'rate' | 'range' | 'text' | 'empty'
// 区间原样保留不转数；万/亿换算；¥/逗号去掉；百分号转小数；'-'/'暂无' 为空。
function cleanValue(rawText) {
  var raw = cleanText(rawText);
  if (!raw || raw === '-' || raw === '--' || raw === '暂无' || raw === '—') {
    return { raw: raw, num: null, isRange: false, range: null, kind: 'empty' };
  }
  var v = raw.replace(/[¥￥,，]/g, '').trim();
  // 区间保护：1000-2000 / 1.2万-2.5万 / ¥7.5万-¥10万
  if (/^[\d.]+[万亿wW]?\s*-\s*[\d.]+[万亿wW]?$/.test(v)) {
    return { raw: raw, num: null, isRange: true, range: v, kind: 'range' };
  }
  var isRate = /%$/.test(v);
  var body = v.replace(/[%＋+>]/g, '').trim();
  var mult = 1;
  if (/亿/.test(body)) { mult = 100000000; body = body.replace(/亿/g, ''); }
  else if (/万/i.test(body)) { mult = 10000; body = body.replace(/万|w/i, ''); }
  var n = parseFloat(body);
  if (isNaN(n)) return { raw: raw, num: null, isRange: false, range: null, kind: 'text' };
  n = n * mult;
  if (isRate) n = Math.round((n / 100) * 10000) / 10000; // 86.55% -> 0.8655，不留 0.8654999… 这种浮点尾巴
  return { raw: raw, num: n, isRange: false, range: null, kind: isRate ? 'rate' : 'number' };
}

// parseSmartCell：V64 的改写。值/趋势分离。
// 值：[class*="amount-data-range"] 或 [class*="unifyValue"]；
// 趋势：[class*="cp-change-ratio-value"]，upIdentify 加 +、downIdentify 加 -。
function parseSmartCell(cell) {
  if (!cell) return { value: null, valueText: '', trend: '', trendNum: null };
  var valEl = null;
  try {
    valEl = cell.querySelector('[class*="amount-data-range"]') || cell.querySelector('[class*="unifyValue"]');
  } catch (e) { valEl = null; }
  var valueText = valEl ? cleanText(valEl.innerText || valEl.textContent) : '';
  var value = valueText ? cleanValue(valueText) : { raw: '', num: null, isRange: false, range: null, kind: 'empty' };
  // 没有值节点时，用单元格首行文本兜底（不静默造数，raw 留痕）
  if (!valEl) {
    var firstLine = cleanText(cell.innerText || cell.textContent).split(' ').filter(Boolean)[0] || '';
    valueText = firstLine;
    value = firstLine ? cleanValue(firstLine) : value;
  }
  var trend = '';
  var trendNum = null;
  var trendEl = null;
  try { trendEl = cell.querySelector('[class*="cp-change-ratio-value"]'); } catch (e) { trendEl = null; }
  if (trendEl) {
    var t = cleanText(trendEl.innerText || trendEl.textContent);
    if (t && t !== '-' && t !== '持平') {
      var dir = '';
      try {
        if (cell.querySelector('[class*="upIdentify"]')) dir = '+';
        else if (cell.querySelector('[class*="downIdentify"]')) dir = '-';
      } catch (e) { /* 忽略 */ }
      trend = dir + t;
      var tn = cleanValue(t);
      trendNum = tn.num;
    } else if (t === '持平') { trend = '持平'; }
  }
  return { value: value.num, valueText: valueText, valueIsRange: value.isRange, valueRange: value.range, trend: trend, trendNum: trendNum };
}

// extractCellParts：V19 extractComplexData 的轻量改写。
// 图片转 [图]url；div/p/br 换行；按行拆成多段（用于词下热门商品等多行格）。
function extractCellParts(cell) {
  if (!cell) return [];
  var clone = cell.cloneNode(true);
  var imgs = clone.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var src = imgs[i].getAttribute('src') || '';
    if (src && src.indexOf('data:') !== 0) {
      var t = document.createTextNode(' [图]' + src + ' ');
      imgs[i].parentNode.replaceChild(t, imgs[i]);
    } else if (imgs[i].parentNode) { imgs[i].parentNode.removeChild(imgs[i]); }
  }
  var blocks = clone.querySelectorAll('div, p, br');
  for (var j = 0; j < blocks.length; j++) {
    if (blocks[j].tagName === 'BR') blocks[j].parentNode.insertBefore(document.createTextNode('\n'), blocks[j]);
    else blocks[j].appendChild(document.createTextNode('\n'));
  }
  var text = clone.innerText || clone.textContent || '';
  return text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
}

// buildColumnMap：自适应列定位，改名也不用回来改代码。
// 认列顺序（按顺序试，先中的为准）：
//   ① 精确表头原文 → ② 以前学过的别名（存在浏览器本地）
//   → ③ 脚本里写的旧名 → ④ 去括号核心词（如“商品点击率(人数)”去括号后就是“商品点击率”）
//   → ⑤ 按列位置兜底（表头顺序基本不变；按位置对上的会标出来让你核对）。
// 只有五步全认不到，才报缺列停下。返回 how 说明每列是怎么认到的，
// learnedNew 是这次新学到的别名，采完存起来，下次直接按名认。
function coreOf(h) {
  return cleanText(h).replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '');
}
function buildColumnMap(headers, spec, learned) {
  var norm = headers.map(function (h) { return cleanText(h).replace(/\s+/g, ''); });
  var core = headers.map(function (h) { return coreOf(h); });
  var map = {};
  var missing = [];
  var how = {};
  var learnedNew = {};
  learned = learned || {};
  spec.forEach(function (s) {
    var idx = -1;
    var mode = '';
    var exactNorm = s.exact.replace(/\s+/g, '');
    for (var i = 0; i < norm.length && idx === -1; i++) {
      if (norm[i] === exactNorm) { idx = i; mode = 'exact'; }
    }
    if (idx === -1) {
      var known = (learned[s.key] || []).concat(s.alts || []);
      for (var a = 0; a < known.length && idx === -1; a++) {
        var altNorm = String(known[a]).replace(/\s+/g, '');
        for (var k = 0; k < norm.length; k++) {
          if (norm[k] === altNorm) { idx = k; mode = 'learned'; }
        }
      }
    }
    if (idx === -1 && s.core) {
      var coreNorm = s.core.replace(/\s+/g, '');
      for (var j = 0; j < core.length && idx === -1; j++) {
        if (core[j] === coreNorm) { idx = j; mode = 'core'; }
      }
      if (idx === -1) {
        var hits = [];
        for (var m = 0; m < core.length; m++) {
          if (core[m].indexOf(coreNorm) !== -1) hits.push(m);
        }
        if (hits.length === 1) { idx = hits[0]; mode = 'core'; }
      }
    }
    if (idx === -1 && typeof s.pos === 'number' && s.pos < norm.length) {
      idx = s.pos; mode = 'pos';
    }
    if (idx === -1) { missing.push(s.exact); }
    else {
      map[s.key] = idx;
      how[s.key] = mode;
      if (mode === 'core' || mode === 'pos') {
        var htxt = headers[idx];
        var already = (learned[s.key] || []).concat(s.alts || []);
        if (htxt && already.indexOf(htxt) === -1 && htxt !== s.exact) learnedNew[s.key] = htxt;
      }
    }
  });
  return { map: map, missing: missing, how: how, learnedNew: learnedNew };
}

// 学过的表头别名存在浏览器本地（油猴存储），不在脚本文件里，
// 面板设置区能看、能清；清掉就回到只认脚本里写的名字。
var HEADER_ALTS_KEY = 'spaceImport.collector.headerAlts.v1';
function loadHeaderAlts() {
  var raw = gmGet(HEADER_ALTS_KEY, '');
  if (!raw) return {};
  try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
function saveHeaderAlts(alts) {
  try { gmSet(HEADER_ALTS_KEY, JSON.stringify(alts)); } catch (e) { /* 忽略 */ }
}

// 搜索词表指纹：表头含 ≥3 个关键词才认（结构地图 tableFingerprints 思路）。
function fingerprintSearchTable(headers) {
  var keys = ['搜索词', '搜索结果曝光人数', '搜索人数', '搜索用户支付金额', '商品曝光人数', '商品点击率', '点击'];
  var hit = 0;
  var joined = headers.join('|');
  keys.forEach(function (k) { if (joined.indexOf(k) !== -1) hit++; });
  return hit >= 3;
}


// parseOwnVsBenchmark：罗盘自营/合作视频表的格子是“自家数 + 同行标杆”拼在一起，
// 如 '76 同行标杆 1,162'、'75 （ 12.63% ） 同行标杆 597'、'¥0 （ 0% ） 同行标杆 ¥2,737.14'。
// 拆成自家值 / 自家占比 / 标杆值，三者都留原文；没有“同行标杆”时整格就是自家值。
// 标杆只作对照，绝不拿标杆数当自家数算转化率（2026-11-11 lin 纠正：投放行标杆是烧钱烧出来的）。
function parseOwnVsBenchmark(rawText) {
  var raw = cleanText(rawText);
  var out = { own: null, ownText: '', ownShare: null, ownShareText: '', benchmark: null, benchmarkText: '', raw: raw };
  if (!raw || raw === '-' || raw === '--' || raw === '暂无' || raw === '—') return out;
  var parts = raw.split('同行标杆');
  var ownPart = cleanText(parts[0]);
  out.ownText = ownPart;
  var shareM = ownPart.match(/[(（]\s*([\d.]+)\s*%\s*[)）]/);
  if (shareM) {
    out.ownShare = Math.round((parseFloat(shareM[1]) / 100) * 10000) / 10000;
    out.ownShareText = shareM[1] + '%';
    ownPart = cleanText(ownPart.replace(/[(（]\s*[\d.]+\s*%\s*[)）]/, ''));
    out.ownText = ownPart;
  }
  var ownCv = cleanValue(ownPart);
  out.own = ownCv.num;
  if (parts.length > 1) {
    var benchPart = cleanText(parts.slice(1).join('同行标杆'));
    out.benchmarkText = benchPart;
    var benchCv = cleanValue(benchPart);
    out.benchmark = benchCv.num;
  }
  return out;
}

// splitRankVideoCell：短视频榜“短视频”格是标题 + 店铺 + 发布时间拼在一起，
// 如 '装甲蜗牛双十一活动开始了！#双十一 … 装甲蜗牛山巅汽车用品专卖店 11/03 17:30'。
// 只拆出发布时间（MM/DD HH:MM），标题和店铺不硬拆，全文留 raw。
function splitRankVideoCell(rawText) {
  var raw = cleanText(rawText);
  var m = raw.match(/(\d{2}\/\d{2}\s+\d{2}:\d{2})/);
  return { raw: raw, publishTime: m ? m[1] : '', title: m ? cleanText(raw.split(m[1])[0]) : raw };
}

// nameMatched：必备列“按名认到”才算数（新线专用闸）。
// exact/learned 直接算；core 模式只认核心词完全相等的那种，不认“包含”式命中——
// '成交订单数'绝不能认到'引流直播成交订单数'那列去，'用户支付金额'也不能认到
// '引流直播用户支付金额'那列去（两对孪生列，buildColumnMap 的包含式 core 匹配会抓错）。
// pos（按位置对上）不算数。缺了就报缺列停下，不拿邻列/孪生列的数顶替。
function nameMatched(built, headers, spec, key) {
  var idx = built.map[key];
  if (idx === undefined) return false;
  var how = built.how[key];
  if (how === 'exact' || how === 'learned') return true;
  if (how === 'core') {
    var sp = null;
    for (var i = 0; i < spec.length; i++) { if (spec[i].key === key) { sp = spec[i]; break; } }
    if (!sp) return false;
    return coreOf(headers[idx]) === coreOf(sp.exact);
  }
  return false;
}

/* __PURE_END__ */

// ---- 通用：表头、表格查找、日期、导出、面板 ----

var STORE_KEYS = {
  compassSearch: 'spaceImport.collector.compassSearch.v1',
  creatorVideo: 'spaceImport.collector.creatorVideo.v1',
  creatorVideoReport: 'spaceImport.collector.creatorVideo.report.v1',
  compassVideo: 'spaceImport.collector.compassVideo.v1',
  videoRank: 'spaceImport.collector.videoRank.v1'
};
// ---- 设置面板（v1.2 新增）：VPS 地址 + 钥匙，存在浏览器本地 ----
// 钥匙绝不写进这个文件，绝不打印到日志、绝不出现在状态文字里。
// 第一次用：在面板“设置”区填一次 VPS 地址（含端口）和钥匙，点“保存设置”，
// 存在油猴自己的存储（GM_setValue）里，只在你这台电脑的浏览器里。
// 想改就进面板改，不用改脚本代码，不用每次重填。
// 没填钥匙（或没填地址）时不发 VPS，走原来下载文件的老路；
// 填了钥匙但 VPS 没收到时，也自动改回下载，数不会丢。
var SETTINGS_KEY = 'spaceImport.collector.settings.v1';
var DEFAULT_RECEIVER_URL = '';
function gmGet(k, d) {
  try { if (typeof GM_getValue === 'function') { var v = GM_getValue(k, d); return (v === undefined || v === null) ? d : v; } } catch (e) { /* 忽略 */ }
  try { var s = localStorage.getItem(k); return s === null ? d : s; } catch (e2) { return d; }
}
function gmSet(k, v) {
  try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* 忽略 */ }
  try { localStorage.setItem(k, v); } catch (e2) { /* 忽略 */ }
}
function loadSettings() {
  var s = { receiverUrl: DEFAULT_RECEIVER_URL, token: '' };
  var raw = gmGet(SETTINGS_KEY, '');
  if (raw) {
    try {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        if (typeof o.receiverUrl === 'string' && o.receiverUrl) s.receiverUrl = o.receiverUrl;
        if (typeof o.token === 'string') s.token = o.token;
      }
    } catch (e) { /* 读不懂就用默认 */ }
  }
  return s;
}
function saveSettings(receiverUrl, token) {
  gmSet(SETTINGS_KEY, JSON.stringify({ receiverUrl: receiverUrl, token: token }));
}
function receiverConfigured() {
  var s = loadSettings();
  return !!(s.receiverUrl && s.token);
}
// 发往 VPS：只发采集到的 JSON 和钥匙（放请求头里），钥匙不出现在任何提示文字里。
function postToReceiver(payload, onOk, onFail) {
  var s = loadSettings();
  if (!s.receiverUrl || !s.token) { onFail('没填 VPS 地址或钥匙'); return; }
  if (typeof GM_xmlhttpRequest !== 'function') { onFail('浏览器不支持发往 VPS'); return; }
  GM_xmlhttpRequest({
    method: 'POST',
    url: s.receiverUrl,
    headers: { 'Content-Type': 'application/json', 'X-Space-Token': s.token },
    data: JSON.stringify(payload),
    timeout: 15000,
    onload: function (res) {
      try {
        var r = JSON.parse(res.responseText || '{}');
        if (res.status === 200 && r.ok) onOk(r);
        else onFail('VPS 回了 ' + res.status);
      } catch (e) { onFail('VPS 回的东西看不懂'); }
    },
    onerror: function () { onFail('连不上 VPS（家里宽带能打开才行，手机移动数据打不开是 IP 被封了）'); },
    ontimeout: function () { onFail('发往 VPS 超时 15 秒'); }
  });
}


function readHeaders(table) {
  var thead = table.querySelector('thead');
  var ths = [];
  if (thead) {
    var rows = thead.querySelectorAll('tr');
    var last = rows[rows.length - 1];
    if (last) ths = Array.from(last.querySelectorAll('th'));
  }
  if (!ths.length) {
    var first = table.querySelector('tr');
    if (first) ths = Array.from(first.querySelectorAll('th, td'));
  }
  var headers = ths.map(function (th) { return cleanText(th.innerText || th.textContent).replace(/\n/g, ' ').trim(); });
  // 首列常为 16px 展开图标空列，空表头去掉（V64 的做法）
  if (headers.length && (!headers[0] || headers[0].length < 2)) headers.shift();
  return headers;
}

// 每次重新找表（SPA 翻页后旧引用会失效，V64/SOP §7-A 的教训）。
function findTableByFingerprint(fingerprintFn) {
  var tables = Array.from(document.querySelectorAll('table'));
  for (var i = 0; i < tables.length; i++) {
    var headers = readHeaders(tables[i]);
    if (headers.length >= 3 && fingerprintFn(headers)) return { table: tables[i], headers: headers };
  }
  return null;
}

function rowSignature(table) {
  var rows = table.querySelectorAll('tbody tr');
  // 2026-11-11 实测：tbody 第一行就是表头原文，各页都一样；
  // 只看首行翻页永远等超时——这就是“翻一页就停”的真因。
  // 签名看第二行（第一条数据）+ 末行 + 行数。
  function rowText(tr) { return cleanText(tr.innerText || tr.textContent).slice(0, 60); }
  var first = rows.length > 1 ? rowText(rows[1]) : (rows.length ? rowText(rows[0]) : '');
  var last = rows.length ? rowText(rows[rows.length - 1]) : '';
  return rows.length + '|' + first + '|' + last;
}

// 日期范围：读页面当前选中的范围写进导出，不写死“今日/近7天/近30天”。
// 找不到就返回空字符串并在导出里注明，不直接报错 abort。
function readDateRangeText() {
  var candidates = document.querySelectorAll('.ecom-radio-button-wrapper-checked, [class*="radio-button-wrapper-checked"], .arco-radio-checked, [aria-checked="true"]');
  for (var i = 0; i < candidates.length; i++) {
    var t = cleanText(candidates[i].innerText || candidates[i].textContent);
    if (t && t.length <= 20) return t;
  }
  var btns = document.querySelectorAll('button');
  for (var j = 0; j < btns.length; j++) {
    var b = cleanText(btns[j].innerText || btns[j].textContent);
    if (/^(近\d+天|近\d+日|今日|昨日|近7天|近30天|自定义)$/.test(b)) return b;
  }
  return '';
}

function downloadJSON(filename, obj) {
  var text = JSON.stringify(obj, null, 2);
  var blob = new Blob(['\uFEFF' + text], { type: 'application/json;charset=utf-8' });
  if (typeof GM_download === 'function') {
    var url = URL.createObjectURL(blob);
    try {
      GM_download({ url: url, name: filename, saveAs: true });
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return true;
    } catch (e) { /* 掉到 anchor 兜底 */ }
  }
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  return true;
}

function exportSpaceImport(dataset, platform, rows, meta) {
  var now = new Date();
  var stamp = now.toISOString().slice(0, 10);
  var file = 'space-import-' + dataset + '-' + stamp + '.json';
  var payload = {
    protocol: 'SpaceImport/1.0',
    platform: platform,
    dataset: dataset,
    source_url: location.href,
    captured_at: now.toISOString(),
    date_range_text: meta.dateRangeText || '',
    date_range: meta.dateRange || null,
    headers: meta.headers || [],
    rows: rows,
    total_rows: rows.length,
    partial: !!meta.partial,
    partial_reason: meta.partialReason || '',
    errors: meta.errors || [],
    collector: 'operations-space-collector v1.2.8 (DOM only, no API interception)'
  };
  // v1.2：填了 VPS 地址+钥匙就先发 VPS，成功就不下载；没填、或 VPS 没收到，
  // 都自动改回下载到本地，数不丢。GM_xmlhttpRequest 是异步的，返回 null
  // 表示“正在发”，结果由面板状态显示。
  if (receiverConfigured()) {
    postToReceiver(payload,
      function (r) { panelStatus('已发到 VPS（' + rows.length + ' 条，存成 ' + (r.saved || '') + '），不用下载。'); },
      function (why) {
        downloadJSON(file, payload);
        panelStatus('VPS 没收到（' + why + '），已改成下载到本地：' + file + '。');
      });
    return null; // null = 已走“发 VPS”这条路，不再按老样子报文件名
  }
  downloadJSON(file, payload);
  return file;
}

function saveState(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
}

// ---- 面板 ----
function makePanel(title) {
  if (document.getElementById('space-import-panel')) return document.getElementById('space-import-panel');
  var panel = document.createElement('div');
  panel.id = 'space-import-panel';
  panel.style.cssText = 'position:fixed;top:80px;right:20px;width:300px;background:#fff;border:2px solid #1E80FF;border-radius:8px;box-shadow:0 5px 30px rgba(0,0,0,.3);z-index:999999;font-family:sans-serif;font-size:13px;color:#333;';
  panel.innerHTML =
    '<div id="sip-head" style="background:#1E80FF;color:#fff;padding:10px 12px;font-weight:bold;cursor:move;display:flex;justify-content:space-between;"><span>' + title + '</span><span id="sip-min" style="cursor:pointer;">_</span></div>' +
    '<div id="sip-body" style="padding:12px;">' +
    '<div id="sip-status" style="background:#f5f7fa;padding:8px;border-radius:4px;margin-bottom:10px;font-size:12px;color:#606266;">就绪。只采当前页面，不改账号内容。</div>' +
    '<div id="sip-errors" style="display:none;background:#fef0f0;color:#f56c6c;padding:8px;border-radius:4px;margin-bottom:10px;font-size:12px;white-space:pre-wrap;"></div>' +
    '<div id="sip-report" style="display:none;background:#f0f9eb;color:#606266;padding:8px;border-radius:4px;margin-bottom:10px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto;"></div>' +
    '<button id="sip-collect" style="width:100%;padding:10px;background:#409eff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-bottom:8px;">采集本页</button>' +
    '<button id="sip-all" style="width:100%;padding:10px;background:#67c23a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-bottom:8px;">自动翻页采集</button>' +
    '<button id="sip-stop" style="width:100%;padding:8px;background:#f56c6c;color:#fff;border:none;border-radius:4px;cursor:pointer;display:none;margin-bottom:8px;">停止并导出已采的</button>' +
    '<button id="sip-export" style="width:100%;padding:8px;background:#e6a23c;color:#fff;border:none;border-radius:4px;cursor:pointer;">导出 SpaceImport JSON</button>' +
    '<div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px;">' +
    '<div style="font-weight:bold;margin-bottom:6px;">设置（只存你这台电脑的浏览器里）</div>' +
    '<label style="font-size:12px;color:#606266;">VPS 地址（含端口）<input id="sip-receiver-url" type="text" style="width:100%;box-sizing:border-box;padding:6px;margin:4px 0 8px;border:1px solid #dcdfe6;border-radius:4px;" placeholder="http://地址:端口/ingest"></label>' +
    '<label style="font-size:12px;color:#606266;">钥匙<input id="sip-receiver-token" type="password" style="width:100%;box-sizing:border-box;padding:6px;margin:4px 0 8px;border:1px solid #dcdfe6;border-radius:4px;" placeholder="只存浏览器本地，不写进脚本"></label>' +
    '<button id="sip-save-settings" style="width:100%;padding:8px;background:#909399;color:#fff;border:none;border-radius:4px;cursor:pointer;">保存设置</button>' +
    '<div id="sip-settings-status" style="font-size:11px;color:#999;margin-top:6px;"></div>' +
    '</div>' +
    '<div style="font-size:11px;color:#999;margin-top:8px;">纯 DOM 采集，不拦截 API；缺列/0 行不导出空文件。v1.2.8：创作者中心一键采集带进度和完成报告；新加罗盘视频（分投放/非投放行）与短视频榜。</div>' +
    '</div>';
  document.body.appendChild(panel);
  var head = panel.querySelector('#sip-head');
  var dragging = false, sx = 0, sy = 0, il = 0, it = 0;
  head.addEventListener('mousedown', function (e) {
    dragging = true; sx = e.clientX; sy = e.clientY;
    var r = panel.getBoundingClientRect(); il = r.left; it = r.top;
    panel.style.right = 'auto'; panel.style.left = il + 'px'; panel.style.top = it + 'px';
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    panel.style.left = (il + e.clientX - sx) + 'px';
    panel.style.top = (it + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', function () { dragging = false; });
  panel.querySelector('#sip-min').onclick = function () {
    var b = panel.querySelector('#sip-body');
    b.style.display = b.style.display === 'none' ? 'block' : 'none';
  };
  // v1.2 设置区接线：填一次存浏览器本地，随时能改。钥匙框是 password，不明文显示。
  (function initSettingsUI() {
    var urlEl = panel.querySelector('#sip-receiver-url');
    var tokenEl = panel.querySelector('#sip-receiver-token');
    var stEl = panel.querySelector('#sip-settings-status');
    var s = loadSettings();
    if (urlEl) urlEl.value = s.receiverUrl || '';
    if (tokenEl) tokenEl.value = s.token || '';
    function refreshSettingsStatus() {
      if (!stEl) return;
      stEl.textContent = receiverConfigured() ? '已设置 VPS 发送：采完先发 VPS，发不出去自动改下载。' : '未设置钥匙：采完会下载到本地文件。';
    }
    refreshSettingsStatus();
    var saveBtn = panel.querySelector('#sip-save-settings');
    if (saveBtn) saveBtn.onclick = function () {
      var u = urlEl ? urlEl.value.trim() : '';
      var tt = tokenEl ? tokenEl.value.trim() : '';
      saveSettings(u, tt);
      refreshSettingsStatus();
      panelStatus('设置已保存（只存在这台电脑的浏览器里）。');
    };
  })();
  return panel;
}

function panelStatus(msg) {
  var el = document.getElementById('sip-status');
  if (el) el.textContent = msg;
}
function panelErrors(list) {
  var el = document.getElementById('sip-errors');
  if (!el) return;
  if (!list || !list.length) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  el.textContent = list.join('\n');
}
// 完成报告：写面板里留着，也存浏览器本地，换页刷新还在。
function videoReport(text) {
  var el = document.getElementById('sip-report');
  if (el) { el.style.display = text ? 'block' : 'none'; el.textContent = text || ''; }
  try {
    if (text) localStorage.setItem(STORE_KEYS.creatorVideoReport, text);
    else localStorage.removeItem(STORE_KEYS.creatorVideoReport);
  } catch (e) {}
}
function renderVideoReport() {
  try {
    var t = localStorage.getItem(STORE_KEYS.creatorVideoReport);
    if (t) videoReport(t);
  } catch (e) {}
}
function shortTime() { return new Date().toTimeString().slice(0, 5); }

// ---- 翻页：先读总页数，再按页码翻到底（v1.2.4 改写） ----
// 老做法只会一路点“下一页”，点不动就悄悄停，还当成采完了。
// 新做法：开始先读总页数，翻页优先直接点下一页的页码数字，
// 每一页都报“第 X / 共 Y 页”，翻不动就明说停在哪一页，不当采完。
var NEXT_SELECTORS = [
  '.aurora-pagination-next:not(.aurora-pagination-disabled) button',
  '.aurora-pagination-next:not(.aurora-pagination-disabled)',
  '.arco-pagination-next:not(.arco-pagination-disabled):not([aria-disabled="true"]) button',
  '.auxo-pagination-next:not([aria-disabled="true"]) button',
  '.ecom-pagination-next:not([aria-disabled="true"]) button',
  'li[title="下一页"]:not([aria-disabled="true"]) button',
  'li[title="下一页"]:not(.ecom-pagination-next-disabled) button',
  'button[aria-label*="下一页"]:not([disabled])',
  '.arco-pagination-item-next:not(.arco-pagination-item-disabled)',
  '.auxo-pagination-next:not(.auxo-pagination-disabled)',
  '.ecom-pagination-next:not(.ecom-pagination-next-disabled)'
];

function isDisabledEl(el) {
  var n = el;
  for (var i = 0; i < 4 && n; i++) {
    if (n.disabled) return true;
    if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
    var c = (n.className && typeof n.className === 'string') ? n.className : '';
    if (c.indexOf('disabled') !== -1) return true;
    n = n.parentElement;
  }
  return false;
}
function visibleEl(el) {
  try {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch (e) { return true; }
}

function findNextButton() {
  for (var i = 0; i < NEXT_SELECTORS.length; i++) {
    var btn = document.querySelector(NEXT_SELECTORS[i]);
    if (btn && !isDisabledEl(btn) && visibleEl(btn)) return btn;
  }
  try {
    var xr = document.evaluate(
      "//button[contains(., '下一页') and not(@disabled)] | //li[@title='下一页' and not(@aria-disabled='true')]//button",
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    );
    var node = xr.singleNodeValue;
    if (node && !isDisabledEl(node) && visibleEl(node)) return node;
  } catch (e) { /* 忽略 */ }
  return null;
}

// 直接点第 n 页的页码数字（比“下一页”按钮稳：末页没有下一页时也不会点错）。
function findPageButton(n) {
  var scope = document.querySelector('.arco-pagination, .auxo-pagination, .ecom-pagination, [class*="pagination"]') || document;
  var els = scope.querySelectorAll('button, li, a');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var t = cleanText(el.textContent || '');
    if (t !== String(n)) continue;
    if (isDisabledEl(el) || !visibleEl(el)) continue;
    var c = (el.className && typeof el.className === 'string') ? el.className : '';
    if (c.indexOf('active') !== -1 || el.getAttribute('aria-current') === 'true') continue;
    if (el.tagName === 'A' && el.parentElement && /aurora-pagination-item/.test(el.parentElement.className || '')) return el.parentElement;
    return el;
  }
  return null;
}

// 读总页数：先看“共 N 条 / 共 N 页 / 1 / N”文字，再看页码按钮里最大的数字，
// 最后用总条数除以每页行数算。读不到就返回 null，外面按“翻到底”走。
function readPaginationTotal() {
  var out = { totalPages: null, totalRows: null, pageSize: null };
  var scope = document.querySelector('.arco-pagination, .auxo-pagination, .ecom-pagination, [class*="pagination"]') || document.body;
  var text = cleanText(scope.innerText || scope.textContent || '');
  var m = text.match(/共\s*(\d+)\s*条/);
  if (m) out.totalRows = parseInt(m[1], 10);
  var m2 = text.match(/共\s*(\d+)\s*页/);
  if (m2) out.totalPages = parseInt(m2[1], 10);
  var m3 = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!out.totalPages && m3) out.totalPages = parseInt(m3[2], 10);
  var nums = [];
  var els = scope.querySelectorAll('button, li, a, span');
  for (var i = 0; i < els.length; i++) {
    var t = cleanText(els[i].textContent || '');
    if (/^\d+$/.test(t)) nums.push(parseInt(t, 10));
  }
  var maxNum = nums.length ? Math.max.apply(null, nums) : 0;
  if (!out.totalPages && maxNum > 1) out.totalPages = maxNum;
  try {
    var found = findTableByFingerprint(fingerprintSearchTable);
    if (found) out.pageSize = found.table.querySelectorAll('tbody tr').length;
  } catch (e) { /* 忽略 */ }
  if (!out.totalPages && out.totalRows && out.pageSize) out.totalPages = Math.ceil(out.totalRows / out.pageSize);
  return out;
}

// V4.0 waitForNewData 的改写：行签名（行数＋首行）变化才算翻页成功。
// fingerprintFn 可选，默认搜索词表指纹；短视频榜翻页时传自己的指纹。
async function waitForNewData(table, prevSig, isCollecting, fingerprintFn) {
  var fp = fingerprintFn || fingerprintSearchTable;
  var maxWait = 10000, interval = 500, waited = 0;
  while (waited < maxWait) {
    if (isCollecting && !isCollecting()) return false;
    var t = findTableByFingerprint(fp);
    var cur = t ? t.table : table;
    if (cur && rowSignature(cur) !== prevSig) return true;
    await sleep(interval);
    waited += interval;
  }
  return false;
}

// 翻到第 targetPage 页：先点页码数字，再点“下一页”；
// 点一次没动静就再点一次（加载慢、第一次点击被加载态吞掉很常见）。
// 返回 'ok' | 'no-button' | 'timeout' | 'stopped'。
async function gotoPage(targetPage, prevSig, isCollecting, fingerprintFn) {
  var btn = findPageButton(targetPage) || findNextButton();
  if (!btn) return 'no-button';
  btn.click();
  if (await waitForNewData(null, prevSig, isCollecting, fingerprintFn)) return 'ok';
  if (isCollecting && !isCollecting()) return 'stopped';
  var btn2 = findPageButton(targetPage) || findNextButton();
  if (btn2) {
    btn2.click();
    if (await waitForNewData(null, prevSig, isCollecting, fingerprintFn)) return 'ok';
  }
  if (isCollecting && !isCollecting()) return 'stopped';
  return 'timeout';
}

// 新线路（v1.2.8）只走本地下载：2026-11-10 lin 定“先跑本地，不加 VPS”，
// 收数端没装、钥匙也没生成，新页不发 VPS，数直接落本地文件。
function exportLocal(dataset, platform, rows, meta) {
  var now = new Date();
  var stamp = now.toISOString().slice(0, 10);
  var file = 'space-import-' + dataset + '-' + stamp + '.json';
  var payload = {
    protocol: 'SpaceImport/1.0',
    platform: platform,
    dataset: dataset,
    source_url: location.href,
    captured_at: now.toISOString(),
    date_range_text: meta.dateRangeText || '',
    date_range: meta.dateRange || null,
    headers: meta.headers || [],
    rows: rows,
    total_rows: rows.length,
    partial: !!meta.partial,
    partialReason: meta.partialReason || '',
    errors: meta.errors || [],
    collector: 'operations-space-collector v1.2.8 (DOM only, no API interception, local download only)'
  };
  downloadJSON(file, payload);
  return file;
}

// ============================================================
// 线路 1：抖店罗盘搜索词分析
// 页面：compass.jinritemai.com/shop/search/drainage-terms
// （fxg.jinritemai.com/ffa/mcompass/search* 同表结构时也认）
// ============================================================

var SEARCH_SPEC = [
  { key: 'search_term', exact: '搜索词信息', alts: ['搜索词'], core: '搜索词', pos: 1, allowIncludes: false },
  // 关键：商品曝光人数只认精确表头“商品曝光人数”。
  // “搜索结果曝光人数”是另一列（第 3 列），旧 v5 取第一个含“曝光人数”的列
  // 抓到的是搜索曝光，这版绝不能重犯。
  { key: 'search_result_exposure', exact: '搜索结果曝光人数', core: '搜索结果曝光人数', pos: 2, allowIncludes: false },
  { key: 'search_people', exact: '搜索人数', core: '搜索人数', pos: 3, allowIncludes: false },
  { key: 'search_payment_amount', exact: '搜索用户支付金额', core: '搜索用户支付金额', pos: 4, allowIncludes: false },
  { key: 'product_exposure', exact: '商品曝光人数', core: '商品曝光人数', pos: 5, allowIncludes: false },
  { key: 'product_click_rate', exact: '商品点击率(人数)', alts: ['商品点击率'], core: '商品点击率', pos: 6, allowIncludes: false },
  { key: 'product_click_conversion_rate', exact: '商品点击-成交转化率(人数)', alts: ['商品点击-成交转化率'], core: '商品点击-成交转化率', pos: 8, allowIncludes: false },
  { key: 'shop_exposed_products', exact: '词下本店曝光商品', core: '词下本店曝光商品', pos: 9, allowIncludes: true },
  { key: 'hot_products', exact: '词下热门商品', core: '词下热门商品', pos: 10, allowIncludes: true }
];
// 必备列：缺任何一列就报错停下，不静默填空。
var SEARCH_REQUIRED = ['search_term', 'search_result_exposure', 'search_people', 'search_payment_amount', 'product_exposure', 'product_click_rate', 'product_click_conversion_rate'];

var searchState = { rows: [], headers: [], errors: [], running: false, stop: false, partial: false, partialReason: '' };

function searchTermFromCell(cell) {
  if (!cell) return '';
  // V79 特征扫描：title- 类名抓搜索词
  var titleEl = null;
  try { titleEl = cell.querySelector('[class*="title-"]'); } catch (e) { titleEl = null; }
  if (titleEl) return cleanText(titleEl.innerText || titleEl.textContent);
  var parts = extractCellParts(cell);
  return parts.length ? parts[0] : '';
}

async function collectSearchPage() {
  // 表是异步加载的：等表出现（最多 15 秒），别一上来找不到就报错。
  // 2026-11-11 实测：搜索词页第一次打开 3 秒内表还没出来。
  var found = null;
  for (var w = 0; w < 30 && !found; w++) {
    found = findTableByFingerprint(fingerprintSearchTable);
    if (!found) await sleep(500);
  }
  if (!found) return { ok: false, errors: ['等了 15 秒还是没找到搜索词表：页面上没有含“搜索词/商品曝光人数”等表头的表格。请确认打开的是罗盘搜索词分析页，且表格已加载。'] };
  var table = found.table;
  var headers = readHeaders(table);
  var learned = loadHeaderAlts();
  var built = buildColumnMap(headers, SEARCH_SPEC, learned);
  var missingRequired = SEARCH_REQUIRED.filter(function (k) { return built.map[k] === undefined; });
  if (missingRequired.length) {
    var missingNames = missingRequired.map(function (k) {
      var s = SEARCH_SPEC.filter(function (x) { return x.key === k; })[0];
      return s ? s.exact : k;
    });
    return { ok: false, errors: ['表头缺列，先停下不采：缺 ' + missingNames.join('、') + '。页面实际表头：' + headers.join(' | ')] };
  }
  searchState.headers = headers;
  // 新学到的别名存起来，下次直接按名认；按位置对上的列在面板里标出来核对。
  var newNames = Object.keys(built.learnedNew || {});
  if (newNames.length) {
    newNames.forEach(function (k) {
      learned[k] = (learned[k] || []).concat([built.learnedNew[k]]);
    });
    saveHeaderAlts(learned);
  }
  var posCols = Object.keys(built.how || {}).filter(function (k) { return built.how[k] === 'pos'; });
  searchState.columnNote = posCols.length
    ? '提醒：' + posCols.length + ' 列是按位置对上的（表头没认出来），导出前请核对一下这几列的数。'
    : (newNames.length ? '已自动记住新表头名，下次直接认。' : '');
  var m = built.map;
  var rows = table.querySelectorAll('tbody tr');
  var added = 0;
  var seen = {};
  searchState.rows.forEach(function (r) { seen[r.search_term] = true; });
  rows.forEach(function (tr) {
    var cells = Array.from(tr.querySelectorAll('td'));
    if (!cells.length) return;
    // 首列常为空的展开图标列：表头已去掉空首列时，td 也要对齐去掉
    var headerCount = headers.length;
    if (cells.length === headerCount + 1) cells = cells.slice(1);
    if (cells.length < headerCount) return;
    function cellAt(key) { return cells[m[key]]; }
    function numAt(key) {
      var c = cellAt(key);
      if (!c) return { num: null, text: '', isRange: false, range: null };
      var p = parseSmartCell(c);
      return { num: p.value, text: p.valueText, isRange: p.valueIsRange, range: p.valueRange, trend: p.trend, trendNum: p.trendNum };
    }
    var term = searchTermFromCell(cellAt('search_term'));
    if (!term) return;
    // tbody 第一行就是表头原文（2026-11-11 实测），不是数据，跳过。
    if (term === headers[m['search_term']]) return;
    if (seen[term]) return;
    seen[term] = true;
    var sre = numAt('search_result_exposure');
    var sp = numAt('search_people');
    var spa = numAt('search_payment_amount');
    var pe = numAt('product_exposure');
    var pcr = numAt('product_click_rate');
    var pccr = numAt('product_click_conversion_rate');
    // 词下热门商品：单独列，不并入本店曝光商品（V79.15 的误归不抄）。
    var hotParts = cellAt('hot_products') ? extractCellParts(cellAt('hot_products')) : [];
    var shopParts = cellAt('shop_exposed_products') ? extractCellParts(cellAt('shop_exposed_products')) : [];
    searchState.rows.push({
      kind: 'search_term',
      search_term: term,
      search_result_exposure: sre.num, search_result_exposure_text: sre.text, search_result_exposure_trend: sre.trend || '',
      search_people: sp.num, search_people_text: sp.text,
      search_payment_amount: spa.num, search_payment_amount_text: spa.text, search_payment_amount_is_range: !!spa.isRange, search_payment_amount_range: spa.range,
      product_exposure: pe.num, product_exposure_text: pe.text, product_exposure_trend: pe.trend || '',
      product_click_rate: pcr.num, product_click_rate_text: pcr.text,
      product_click_conversion_rate: pccr.num, product_click_conversion_rate_text: pccr.text,
      shop_exposed_products: shopParts,
      hot_products: hotParts
    });
    added++;
  });
  return { ok: true, added: added };
}

async function runSearchCollect(autoPaging) {
  if (searchState.running) return;
  searchState.running = true;
  searchState.stop = false;
  searchState.partial = false;
  searchState.partialReason = '';
  searchState.errors = [];
  panelErrors([]);
  var page = 1;
  var maxPages = 500;
  var total = readPaginationTotal();
  var totalPages = total.totalPages;
  searchState.totalPages = totalPages || 0;
  searchState.pagesCollected = 0;
  try {
    while (!searchState.stop) {
      panelStatus('正在采集第 ' + page + (totalPages ? ' / 共 ' + totalPages : '') + ' 页…（已采 ' + searchState.rows.length + ' 条）');
      var res = await collectSearchPage();
      if (!res.ok) {
        searchState.errors = res.errors;
        panelErrors(res.errors);
        panelStatus('已停：' + res.errors[0]);
        break;
      }
      searchState.pagesCollected = page;
      panelStatus('第 ' + page + (totalPages ? ' / 共 ' + totalPages : '') + ' 页完成，本页新增 ' + res.added + ' 条，总计 ' + searchState.rows.length + ' 条' + (searchState.columnNote ? '。' + searchState.columnNote : ''));
      if (!autoPaging) break;
      if (totalPages && page >= totalPages) {
        // 读到的总数可能是只显示出来的页码窗口（比如只看到 1~5 页），
        // 还有下一页按钮就继续翻到底，不当采完。
        var more = findPageButton(page + 1) || findNextButton();
        if (!more) break;
        totalPages = null;
        searchState.totalPages = 0;
      }
      if (page >= maxPages) break;
      var found = findTableByFingerprint(fingerprintSearchTable);
      if (!found) { searchState.partial = true; searchState.partialReason = '翻页后找不到表格，已采的 ' + searchState.rows.length + ' 条保留。'; break; }
      var prevSig = rowSignature(found.table);
      // 真人节奏：翻页前停 3~7 秒（随机），别像机器一样一页接一页点，
      // 平台反爬看的就是短时间内连续请求。
      await sleep(3000 + Math.random() * 4000);
      var nav = await gotoPage(page + 1, prevSig, function () { return !searchState.stop; });
      if (nav === 'stopped') break;
      if (nav === 'no-button') {
        if (totalPages && page < totalPages) {
          searchState.partial = true;
          searchState.partialReason = '找不到下一页按钮（共 ' + totalPages + ' 页，只采到第 ' + page + ' 页）。';
        }
        break;
      }
      if (nav === 'timeout') {
        searchState.partial = true;
        searchState.partialReason = '第 ' + page + ' 页之后翻不动了' + (totalPages ? '（共 ' + totalPages + ' 页）' : '') + '，已采的 ' + searchState.rows.length + ' 条保留，导出为部分数据。';
        break;
      }
      page++;
    }
  } finally {
    searchState.running = false;
    saveState(STORE_KEYS.compassSearch, { lastRun: new Date().toISOString(), rows: searchState.rows.length, partial: searchState.partial });
  }
  if (searchState.rows.length === 0) {
    panelStatus('0 行，未导出空文件。先看上面红字错误。');
    return;
  }
  var file = exportSpaceImport('compass_search_terms', 'douyin', searchState.rows, {
    dateRangeText: readDateRangeText(),
    headers: searchState.headers,
    partial: searchState.partial,
    partialReason: searchState.partialReason,
    errors: searchState.errors
  });
  if (file) panelStatus('已采 ' + searchState.pagesCollected + (totalPages ? ' / 共 ' + totalPages : '') + ' 页，' + searchState.rows.length + ' 条' + (searchState.partial ? '，部分数据：' + searchState.partialReason : '') + '。');
  else panelStatus('正在发往 VPS…（' + searchState.rows.length + ' 条' + (searchState.partial ? '，部分数据' : '') + '），发不出去会自动改下载。');
}

function initSearchPanel() {
  var panel = makePanel('运维空间采集 · 罗盘搜索词 v1');
  panel.querySelector('#sip-collect').onclick = function () { runSearchCollect(false); };
  panel.querySelector('#sip-all').onclick = function () { runSearchCollect(true); };
  panel.querySelector('#sip-stop').style.display = 'block';
  panel.querySelector('#sip-stop').onclick = function () { searchState.stop = true; panelStatus('正在停止，停下后导出已采的…'); };
  panel.querySelector('#sip-export').onclick = function () {
    if (!searchState.rows.length) { panelStatus('还没采到数据，先点“采集本页”。'); return; }
    var file = exportSpaceImport('compass_search_terms', 'douyin', searchState.rows, {
      dateRangeText: readDateRangeText(), headers: searchState.headers, partial: searchState.partial, partialReason: searchState.partialReason, errors: searchState.errors
    });
    if (file) panelStatus('已导出 ' + file + '。');
    else panelStatus('正在发往 VPS…发不出去会自动改下载。');
  };
  panelStatus('已就绪：打开罗盘搜索词分析页，点“采集本页”或“自动翻页采集”。');
}

// ============================================================
// 线路 2：抖音创作者中心视频数据
// 页面：creator.douyin.com/creator-micro/data-center/content
// 字段定义借 -6.6.8 的 14 列，但：先过表头校验再采；审核状态照实取；
// 数值清洗万/亿；导出文件不写飞书；失败不弹 confirm。
// ============================================================

// 14 列中文表头（v1.1 §6，-6.6.8 代码）。顺序可能变，按表头文本映射，不按列号。
var VIDEO_HEADERS = ['作品名称', '审核状态', '播放量', '完播率', '5s完播率', '封面点击率', '2s跳失率', '平均播放时长', '点赞量', '分享量', '评论量', '收藏量', '主页访问量', '粉丝增量'];
var VIDEO_KEYS = ['title', 'status', 'plays', 'complete_rate', 'five_sec_complete_rate', 'cover_click_rate', 'two_sec_loss_rate', 'avg_play_time', 'likes', 'shares', 'comments', 'collects', 'home_visits', 'fan_growth'];

var videoState = { rows: [], headers: [], errors: [], running: false, stop: false };

function validateVideoHeaders(headers) {
  var norm = headers.map(function (h) { return cleanText(h).replace(/\s+/g, ''); });
  var missing = [];
  VIDEO_HEADERS.forEach(function (h) {
    if (norm.indexOf(h.replace(/\s+/g, '')) === -1) missing.push(h);
  });
  return missing;
}

function parseVideoRow(tr, colMap) {
  var cells = Array.from(tr.querySelectorAll('td'));
  if (cells.length < 14) return null;
  function at(key) {
    var i = colMap[key];
    return (i === undefined || !cells[i]) ? '' : cleanText(cells[i].innerText || cells[i].textContent);
  }
  function numAt(key) {
    var t = at(key);
    if (!t || t === '-') return { num: null, text: t };
    var c = cleanValue(t);
    return { num: c.num, text: t, isRange: c.isRange, range: c.range };
  }
  // 第 1 列“作品名称＋发布时间”拼在一起，靠日期正则拆（-6.6.8 的做法）。
  var cell0 = at('title');
  var title = cell0;
  var publishTime = '';
  var tm = cell0.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  if (tm) { publishTime = tm[1]; title = cell0.split(tm[0])[0].trim(); }
  // 审核状态照页面原样写，不强制改“通过”（-6.6.8 写死“通过”的毛病不抄）。
  var status = at('status');
  var plays = numAt('plays');
  if (!title && plays.num === null) return null;
  var row = {
    kind: 'video',
    title: title || '无标题',
    publish_time: publishTime,
    status: status,
    plays: plays.num, plays_text: plays.text,
    complete_rate: numAt('complete_rate').num, complete_rate_text: numAt('complete_rate').text,
    five_sec_complete_rate: numAt('five_sec_complete_rate').num, five_sec_complete_rate_text: numAt('five_sec_complete_rate').text,
    cover_click_rate: numAt('cover_click_rate').num, cover_click_rate_text: numAt('cover_click_rate').text,
    two_sec_loss_rate: numAt('two_sec_loss_rate').num, two_sec_loss_rate_text: numAt('two_sec_loss_rate').text,
    avg_play_time: numAt('avg_play_time').num, avg_play_time_text: numAt('avg_play_time').text,
    likes: numAt('likes').num, likes_text: numAt('likes').text,
    shares: numAt('shares').num, shares_text: numAt('shares').text,
    comments: numAt('comments').num, comments_text: numAt('comments').text,
    collects: numAt('collects').num, collects_text: numAt('collects').text,
    home_visits: numAt('home_visits').num, home_visits_text: numAt('home_visits').text,
    fan_growth: numAt('fan_growth').num, fan_growth_text: numAt('fan_growth').text
  };
  return row;
}

// 滚动加载：滚动到底，行数稳定 3 次才停（-6.6.8 loadAllData 的做法），最多 120 秒。
// 每轮报一次已加载行数；表如果在内层滚动容器里（窗口滚不动），把表的所有祖先滚动容器也一起滚到底。
function videoRowCount() {
  var best = 0;
  document.querySelectorAll('table').forEach(function (tb) {
    var n = tb.querySelectorAll('tbody tr').length;
    if (n > best) best = n;
  });
  return best;
}
function scrollVideoList() {
  try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
  var tb = document.querySelector('table');
  var n = tb;
  while (n) {
    try { if (n.scrollHeight > n.clientHeight + 50) n.scrollTop = n.scrollHeight; } catch (e2) {}
    n = n.parentElement;
  }
}
async function loadAllVideoRows() {
  return new Promise(function (resolve) {
    var last = -1, stable = 0, elapsed = 0;
    var iv = setInterval(function () {
      if (videoState.stop) { clearInterval(iv); resolve(false); return; }
      scrollVideoList();
      var n = videoRowCount();
      videoState.loadedRows = n;
      if (n === last) { stable++; if (stable >= 3) { clearInterval(iv); setTimeout(function () { resolve(true); }, 1500); } }
      else { stable = 0; }
      last = n;
      elapsed += 1600;
      panelStatus('正在滚动加载…已加载 ' + n + ' 行（稳定 ' + stable + '/3 次，已用 ' + Math.round(elapsed / 1000) + ' 秒）');
      if (elapsed >= 120000) { clearInterval(iv); resolve(true); }
    }, 1600);
  });
}

async function runVideoCollect() {
  if (videoState.running) return;
  videoState.running = true;
  videoState.stop = false;
  videoState.errors = [];
  panelErrors([]);
  try {
    videoReport('');
    panelStatus('正在滚动加载全部视频…（行数稳定 3 次后开始采）');
    await loadAllVideoRows();
    if (videoState.stop) {
      panelStatus('已停止。');
      videoReport('已停止（' + shortTime() + '）：滚动加载到 ' + (videoState.loadedRows || 0) + ' 行后停下，未导出。');
      return;
    }
    var table = document.querySelector('table');
    if (!table) {
      videoState.errors = ['未找到视频表格：请确认打开的是创作者中心数据中心/内容页。'];
      panelErrors(videoState.errors); panelStatus('已停：未找到视频表格。');
      videoReport('没采成（' + shortTime() + '）：页面上没找到视频表格。请确认打开的是创作者中心数据中心/内容页，页面完全加载后再点一次。');
      return;
    }
    var headers = readHeaders(table);
    videoState.headers = headers;
    // 表头校验：14 列缺任何一列就报错停下，不按固定列号硬采。
    var missing = validateVideoHeaders(headers);
    if (missing.length) {
      videoState.errors = ['表头校验失败，缺列：' + missing.join('、') + '。页面实际表头：' + headers.join(' | ') + '。请先核对字段表 v1.1 §6，确认页面是否改版。'];
      panelErrors(videoState.errors);
      panelStatus('已停：表头对不上，不导出。');
      videoReport('没采成（' + shortTime() + '）：表头对不上，缺列：' + missing.join('、') + '。\n页面实际表头：' + headers.join(' | ') + '。\n请把这段发给 Edison，页面可能改版了。');
      return;
    }
    var spec = VIDEO_HEADERS.map(function (h, i) { return { key: VIDEO_KEYS[i], exact: h, allowIncludes: false }; });
    var built = buildColumnMap(headers, spec);
    if (built.missing.length) {
      videoState.errors = ['表头映射失败，缺：' + built.missing.join('、')];
      panelErrors(videoState.errors);
      panelStatus('已停：表头映射失败。');
      videoReport('没采成（' + shortTime() + '）：表头映射失败，缺：' + built.missing.join('、') + '。请把这段发给 Edison。');
      return;
    }
    var rows = table.querySelectorAll('tbody tr');
    var seen = {};
    var skipped = 0;
    videoState.rows = [];
    rows.forEach(function (tr) {
      var r = parseVideoRow(tr, built.map);
      if (!r) { skipped++; return; }
      var key = r.title + '|' + r.publish_time;
      if (seen[key]) { skipped++; return; }
      seen[key] = true;
      videoState.rows.push(r);
    });
    saveState(STORE_KEYS.creatorVideo, { lastRun: new Date().toISOString(), rows: videoState.rows.length });
    if (!videoState.rows.length) {
      panelStatus('0 行，未导出空文件。请确认页面已加载出视频行，且表头校验已通过。');
      videoReport('没采成（' + shortTime() + '）：表头校验通过，但一行有效视频都没采到（页面行数 ' + rows.length + '，跳过 ' + skipped + ' 行）。请确认页面已加载出视频行。');
      return;
    }
    var file = exportSpaceImport('creator_video', 'douyin', videoState.rows, {
      dateRangeText: readDateRangeText(),
      headers: headers,
      partial: false,
      partialReason: '',
      errors: []
    });
    var dr = readDateRangeText();
    var report = '采完了（' + shortTime() + '）：' + videoState.rows.length + ' 条视频，表头 14 列全对，跳过 ' + skipped + ' 行（空行/重复）。'
      + (dr ? '\n日期范围：' + dr : '')
      + (file ? '\n文件：' + file + '（已下载到本地）' : '\n正在发往 VPS，发不出去会自动改下载。');
    videoReport(report);
    if (file) panelStatus('已导出 ' + file + '（' + videoState.rows.length + ' 条视频），报告在上面。');
    else panelStatus('正在发往 VPS…（' + videoState.rows.length + ' 条视频），发不出去会自动改下载。');
  } finally {
    videoState.running = false;
  }
}

function initVideoPanel() {
  var panel = makePanel('运维空间采集 · 抖音视频数据 v1.2.8');
  renderVideoReport();
  panel.querySelector('#sip-collect').textContent = '滚动加载并采集全部视频';
  panel.querySelector('#sip-all').style.display = 'none';
  panel.querySelector('#sip-collect').onclick = function () { runVideoCollect(); };
  panel.querySelector('#sip-stop').style.display = 'block';
  panel.querySelector('#sip-stop').onclick = function () { videoState.stop = true; panelStatus('正在停止…'); };
  panel.querySelector('#sip-export').onclick = function () {
    if (!videoState.rows.length) { panelStatus('还没采到数据，先点“滚动加载并采集全部视频”。'); return; }
    var file = exportSpaceImport('creator_video', 'douyin', videoState.rows, {
      dateRangeText: readDateRangeText(), headers: videoState.headers, partial: false, partialReason: '', errors: []
    });
    if (file) panelStatus('已导出 ' + file + '。');
    else panelStatus('正在发往 VPS…发不出去会自动改下载。');
  };
  panelStatus('已就绪：打开创作者中心数据中心/内容页，点“滚动加载并采集全部视频”。先过表头校验，14 列缺一列就停下。');
}

// ============================================================
// 线路 3：罗盘自营 / 合作视频（按流量来源分行）
// 页面：compass.jinritemai.com/shop/video/self、/shop/video/cooperate
// 表头（2026-11-11 探针实测，probe-all-2026-11-11-16-33-19.json）：
// 流量来源 | 视频观看次数(占比) | 商品曝光次数 | 商品点击次数 | 用户支付金额(占比)
// | 成交订单数 | 商品千次曝光成交 | 引流直播用户支付金额(占比) | 引流直播间次数 | 引流直播成交订单数
// 单表无分页。行是流量来源本身（'全域+乘方投放时段' / '非投放时段'），
// 有几行采几行，不写死只有两行。自营页探针 rowCount 3（表头 + 2 行数据），
// 但样本只存了投放那行，非投放那行的数探针里没有——脚本不猜，跑起来见分晓。
// ============================================================

function fingerprintCompassVideo(headers) {
  var joined = headers.join('|');
  return joined.indexOf('流量来源') !== -1 && joined.indexOf('商品点击次数') !== -1 && joined.indexOf('成交订单数') !== -1;
}

var COMPASS_VIDEO_SPEC = [
  { key: 'traffic_source', exact: '流量来源', core: '流量来源', pos: 0, allowIncludes: false },
  { key: 'views', exact: '视频观看次数(占比)', core: '视频观看次数', pos: 1, allowIncludes: false },
  { key: 'exposure', exact: '商品曝光次数', core: '商品曝光次数', pos: 2, allowIncludes: false },
  { key: 'clicks', exact: '商品点击次数', core: '商品点击次数', pos: 3, allowIncludes: false },
  { key: 'payment', exact: '用户支付金额(占比)', core: '用户支付金额', pos: 4, allowIncludes: false },
  { key: 'orders', exact: '成交订单数', core: '成交订单数', pos: 5, allowIncludes: false },
  { key: 'per_mille', exact: '商品千次曝光成交', core: '商品千次曝光成交', pos: 6, allowIncludes: false },
  { key: 'live_payment', exact: '引流直播用户支付金额(占比)', core: '引流直播用户支付金额', pos: 7, allowIncludes: false },
  { key: 'live_rooms', exact: '引流直播间次数', core: '引流直播间次数', pos: 8, allowIncludes: false },
  { key: 'live_orders', exact: '引流直播成交订单数', core: '引流直播成交订单数', pos: 9, allowIncludes: false }
];
var COMPASS_VIDEO_REQUIRED = ['traffic_source', 'views', 'exposure', 'clicks', 'payment', 'orders'];

var compassVideoState = { rows: [], headers: [], errors: [], running: false, stop: false };

async function runCompassVideoCollect() {
  if (compassVideoState.running) return;
  compassVideoState.running = true;
  compassVideoState.stop = false;
  compassVideoState.errors = [];
  panelErrors([]);
  var pageKind = location.pathname.indexOf('/shop/video/cooperate') !== -1 ? 'cooperate' : 'self';
  var dataset = pageKind === 'cooperate' ? 'compass_video_cooperate' : 'compass_video_self';
  try {
    panelStatus('正在等视频表出来…（最多 15 秒）');
    var found = null;
    for (var w = 0; w < 30 && !found; w++) {
      found = findTableByFingerprint(fingerprintCompassVideo);
      if (!found) await sleep(500);
    }
    if (!found) {
      compassVideoState.errors = ['等了 15 秒还是没找到视频表：页面上没有含“流量来源/商品点击次数/成交订单数”的表格。请确认打开的是罗盘自营视频或合作视频页，且表格已加载。'];
      panelErrors(compassVideoState.errors);
      panelStatus('已停：' + compassVideoState.errors[0]);
      return;
    }
    var table = found.table;
    var headers = readHeaders(table);
    var learned = loadHeaderAlts();
    var built = buildColumnMap(headers, COMPASS_VIDEO_SPEC, learned);
    // 必备列只认“按名认到”（nameMatched）：按位置对上的、含糊认到孪生列的都不算数，
    // 缺了就停下，不拿邻列的数顶替（2026-11-11 lin 定：缺列先停下不采）。
    var missingRequired = COMPASS_VIDEO_REQUIRED.filter(function (k) { return !nameMatched(built, headers, COMPASS_VIDEO_SPEC, k); });
    if (missingRequired.length) {
      var missingNames = missingRequired.map(function (k) {
        var sp = COMPASS_VIDEO_SPEC.filter(function (x) { return x.key === k; })[0];
        return sp ? sp.exact : k;
      });
      compassVideoState.errors = ['表头缺列，先停下不采：缺 ' + missingNames.join('、') + '。页面实际表头：' + headers.join(' | ')];
      panelErrors(compassVideoState.errors);
      panelStatus('已停：' + compassVideoState.errors[0]);
      return;
    }
    compassVideoState.headers = headers;
    var newNames = Object.keys(built.learnedNew || {});
    if (newNames.length) {
      newNames.forEach(function (k) { learned[k] = (learned[k] || []).concat([built.learnedNew[k]]); });
      saveHeaderAlts(learned);
    }
    var m = built.map;
    var rows = table.querySelectorAll('tbody tr');
    var seen = {};
    compassVideoState.rows = [];
    rows.forEach(function (tr) {
      var cells = Array.from(tr.querySelectorAll('td'));
      if (!cells.length) return;
      if (cells.length === headers.length + 1) cells = cells.slice(1);
      if (cells.length < headers.length) return;
      function cellText(key) {
        var c = cells[m[key]];
        return c ? cleanText(c.innerText || c.textContent) : '';
      }
      var source = cellText('traffic_source').split(' ')[0] || cellText('traffic_source');
      if (!source) return;
      // tbody 第一行就是表头原文（2026-11-11 实测），不是数据，跳过。
      if (source === headers[m['traffic_source']]) return;
      if (seen[source]) return;
      seen[source] = true;
      function colOut(key) {
        var p = parseOwnVsBenchmark(cellText(key));
        return { own: p.own, ownText: p.ownText, ownShare: p.ownShare, ownShareText: p.ownShareText, benchmark: p.benchmark, benchmarkText: p.benchmarkText };
      }
      var views = colOut('views');
      var exposure = colOut('exposure');
      var clicks = colOut('clicks');
      var payment = colOut('payment');
      var orders = colOut('orders');
      var perMille = colOut('per_mille');
      var livePayment = colOut('live_payment');
      var liveRooms = colOut('live_rooms');
      var liveOrders = colOut('live_orders');
      compassVideoState.rows.push({
        kind: 'compass_video',
        page: pageKind,
        traffic_source: source,
        views_own: views.own, views_own_text: views.ownText, views_own_share: views.ownShare, views_own_share_text: views.ownShareText, views_benchmark: views.benchmark, views_benchmark_text: views.benchmarkText,
        exposure_own: exposure.own, exposure_own_text: exposure.ownText, exposure_benchmark: exposure.benchmark, exposure_benchmark_text: exposure.benchmarkText,
        clicks_own: clicks.own, clicks_own_text: clicks.ownText, clicks_benchmark: clicks.benchmark, clicks_benchmark_text: clicks.benchmarkText,
        payment_own: payment.own, payment_own_text: payment.ownText, payment_own_share: payment.ownShare, payment_own_share_text: payment.ownShareText, payment_benchmark: payment.benchmark, payment_benchmark_text: payment.benchmarkText,
        orders_own: orders.own, orders_own_text: orders.ownText, orders_benchmark: orders.benchmark, orders_benchmark_text: orders.benchmarkText,
        per_mille_own: perMille.own, per_mille_own_text: perMille.ownText, per_mille_benchmark: perMille.benchmark, per_mille_benchmark_text: perMille.benchmarkText,
        live_payment_own: livePayment.own, live_payment_own_text: livePayment.ownText, live_payment_benchmark: livePayment.benchmark, live_payment_benchmark_text: livePayment.benchmarkText,
        live_rooms_own: liveRooms.own, live_rooms_own_text: liveRooms.ownText, live_rooms_benchmark: liveRooms.benchmark, live_rooms_benchmark_text: liveRooms.benchmarkText,
        live_orders_own: liveOrders.own, live_orders_own_text: liveOrders.ownText, live_orders_benchmark: liveOrders.benchmark, live_orders_benchmark_text: liveOrders.benchmarkText
      });
    });
    saveState(STORE_KEYS.compassVideo, { lastRun: new Date().toISOString(), page: pageKind, rows: compassVideoState.rows.length });
    if (!compassVideoState.rows.length) {
      panelStatus('0 行，未导出空文件。请确认表格已加载出数据行。');
      return;
    }
    var file = exportLocal(dataset, 'douyin', compassVideoState.rows, {
      dateRangeText: readDateRangeText(),
      headers: headers,
      partial: false,
      partialReason: '',
      errors: []
    });
    panelStatus('已导出 ' + file + '（' + compassVideoState.rows.length + ' 行，按流量来源分：' + compassVideoState.rows.map(function (r) { return r.traffic_source; }).join('、') + '）。只存本地，没发 VPS。');
  } finally {
    compassVideoState.running = false;
  }
}

function initCompassVideoPanel() {
  var panel = makePanel('运维空间采集 · 罗盘视频 v1.2.8');
  panel.querySelector('#sip-collect').textContent = '采集本页（按流量来源分行）';
  panel.querySelector('#sip-all').style.display = 'none';
  panel.querySelector('#sip-collect').onclick = function () { runCompassVideoCollect(); };
  panel.querySelector('#sip-stop').style.display = 'block';
  panel.querySelector('#sip-stop').onclick = function () { compassVideoState.stop = true; panelStatus('正在停止…'); };
  panel.querySelector('#sip-export').onclick = function () {
    if (!compassVideoState.rows.length) { panelStatus('还没采到数据，先点“采集本页”。'); return; }
    var dataset = location.pathname.indexOf('/shop/video/cooperate') !== -1 ? 'compass_video_cooperate' : 'compass_video_self';
    var file = exportLocal(dataset, 'douyin', compassVideoState.rows, {
      dateRangeText: readDateRangeText(), headers: compassVideoState.headers, partial: false, partialReason: '', errors: []
    });
    panelStatus('已导出 ' + file + '。只存本地，没发 VPS。');
  };
  panelStatus('已就绪：打开罗盘自营视频或合作视频页，点“采集本页”。投放行和非投放行分开采，标杆数只作对照。');
}

// ============================================================
// 线路 4：短视频榜（市场 → 短视频排行）
// 页面：compass.jinritemai.com/shop/chance/video-rank
// 表头（2026-11-11 探针实测）：排名 | 短视频 | 观看次数 | 用户支付金额 | 点赞数
// | 评论数 | 转发数 | 关联商品 | 操作；每页 20 条，共 10 页，200 条。
// 注意别接错页：/shop/chance/rank-video 表头是“直播内容/直播用户支付金额”，
// 那是直播榜，不是短视频榜。
// ============================================================

function fingerprintVideoRank(headers) {
  var joined = headers.join('|');
  return joined.indexOf('短视频') !== -1 && joined.indexOf('观看次数') !== -1 && joined.indexOf('用户支付金额') !== -1 && joined.indexOf('点赞数') !== -1;
}

var VIDEO_RANK_SPEC = [
  { key: 'rank', exact: '排名', core: '排名', pos: 0, allowIncludes: false },
  { key: 'video', exact: '短视频', core: '短视频', pos: 1, allowIncludes: false },
  { key: 'views', exact: '观看次数', core: '观看次数', pos: 2, allowIncludes: false },
  { key: 'payment', exact: '用户支付金额', core: '用户支付金额', pos: 3, allowIncludes: false },
  { key: 'likes', exact: '点赞数', core: '点赞数', pos: 4, allowIncludes: false },
  { key: 'comments', exact: '评论数', core: '评论数', pos: 5, allowIncludes: false },
  { key: 'shares', exact: '转发数', core: '转发数', pos: 6, allowIncludes: false },
  { key: 'products', exact: '关联商品', core: '关联商品', pos: 7, allowIncludes: true }
];
var VIDEO_RANK_REQUIRED = ['video', 'views', 'payment', 'likes', 'comments', 'shares'];

var videoRankState = { rows: [], headers: [], errors: [], running: false, stop: false, partial: false, partialReason: '' };

async function collectVideoRankPage() {
  var found = null;
  for (var w = 0; w < 30 && !found; w++) {
    found = findTableByFingerprint(fingerprintVideoRank);
    if (!found) await sleep(500);
  }
  if (!found) return { ok: false, errors: ['等了 15 秒还是没找到短视频榜表：页面上没有含“短视频/观看次数/点赞数”的表格。请确认打开的是市场-短视频排行页，且表格已加载。'] };
  var table = found.table;
  var headers = readHeaders(table);
  var learned = loadHeaderAlts();
  var built = buildColumnMap(headers, VIDEO_RANK_SPEC, learned);
  // 必备列只认“按名认到”（nameMatched）：按位置对上的、含糊认到孪生列的都不算数，
  // 缺了就停下，不拿邻列的数顶替（2026-11-11 lin 定：缺列先停下不采）。
  var missingRequired = VIDEO_RANK_REQUIRED.filter(function (k) { return !nameMatched(built, headers, VIDEO_RANK_SPEC, k); });
  if (missingRequired.length) {
    var missingNames = missingRequired.map(function (k) {
      var sp = VIDEO_RANK_SPEC.filter(function (x) { return x.key === k; })[0];
      return sp ? sp.exact : k;
    });
    return { ok: false, errors: ['表头缺列，先停下不采：缺 ' + missingNames.join('、') + '。页面实际表头：' + headers.join(' | ')] };
  }
  videoRankState.headers = headers;
  var newNames = Object.keys(built.learnedNew || {});
  if (newNames.length) {
    newNames.forEach(function (k) { learned[k] = (learned[k] || []).concat([built.learnedNew[k]]); });
    saveHeaderAlts(learned);
  }
  var m = built.map;
  var rows = table.querySelectorAll('tbody tr');
  var added = 0;
  var seen = {};
  videoRankState.rows.forEach(function (r) { seen[r.rank + '|' + r.video_raw] = true; });
  rows.forEach(function (tr) {
    var cells = Array.from(tr.querySelectorAll('td'));
    if (!cells.length) return;
    if (cells.length === headers.length + 1) cells = cells.slice(1);
    if (cells.length < headers.length) return;
    function cellText(key) {
      var c = cells[m[key]];
      return c ? cleanText(c.innerText || c.textContent) : '';
    }
    var rank = cellText('rank');
    // tbody 第一行就是表头原文（2026-11-11 实测），不是数据，跳过。
    if (rank === '排名') return;
    var videoCell = cells[m['video']];
    var videoParts = videoCell ? extractCellParts(videoCell) : [];
    var videoRaw = videoParts.join(' ');
    if (!videoRaw) return;
    var split = splitRankVideoCell(videoRaw);
    var key = rank + '|' + videoRaw;
    if (seen[key]) return;
    seen[key] = true;
    var views = cleanValue(cellText('views'));
    var payment = cleanValue(cellText('payment'));
    var likes = cleanValue(cellText('likes'));
    var comments = cleanValue(cellText('comments'));
    var shares = cleanValue(cellText('shares'));
    var opText = m['products'] !== undefined && cells.length > 7 ? cleanText(cells[cells.length - 1].innerText || cells[cells.length - 1].textContent) : '';
    videoRankState.rows.push({
      kind: 'video_rank',
      rank: rank,
      video_raw: videoRaw,
      video_title: split.title,
      publish_time: split.publishTime,
      views: views.num, views_text: views.raw, views_is_range: !!views.isRange, views_range: views.range,
      payment: payment.num, payment_text: payment.raw, payment_is_range: !!payment.isRange, payment_range: payment.range,
      likes: likes.num, likes_text: likes.raw,
      comments: comments.num, comments_text: comments.raw,
      shares: shares.num, shares_text: shares.raw,
      linked_products: cellText('products'),
      follow_shoot: opText.indexOf('一键跟拍') !== -1,
      ops_text: opText
    });
    added++;
  });
  return { ok: true, added: added };
}

async function runVideoRankCollect(autoPaging) {
  if (videoRankState.running) return;
  videoRankState.running = true;
  videoRankState.stop = false;
  videoRankState.partial = false;
  videoRankState.partialReason = '';
  videoRankState.errors = [];
  panelErrors([]);
  var page = 1;
  var maxPages = 500;
  var total = readPaginationTotal();
  var totalPages = total.totalPages;
  videoRankState.totalPages = totalPages || 0;
  videoRankState.pagesCollected = 0;
  try {
    while (!videoRankState.stop) {
      panelStatus('正在采集第 ' + page + (totalPages ? ' / 共 ' + totalPages : '') + ' 页…（已采 ' + videoRankState.rows.length + ' 条）');
      var res = await collectVideoRankPage();
      if (!res.ok) {
        videoRankState.errors = res.errors;
        panelErrors(res.errors);
        panelStatus('已停：' + res.errors[0]);
        break;
      }
      videoRankState.pagesCollected = page;
      panelStatus('第 ' + page + (totalPages ? ' / 共 ' + totalPages : '') + ' 页完成，本页新增 ' + res.added + ' 条，总计 ' + videoRankState.rows.length + ' 条');
      if (!autoPaging) break;
      if (totalPages && page >= totalPages) {
        var more = findPageButton(page + 1) || findNextButton();
        if (!more) break;
        totalPages = null;
        videoRankState.totalPages = 0;
      }
      if (page >= maxPages) break;
      var found = findTableByFingerprint(fingerprintVideoRank);
      if (!found) { videoRankState.partial = true; videoRankState.partialReason = '翻页后找不到表格，已采的 ' + videoRankState.rows.length + ' 条保留。'; break; }
      var prevSig = rowSignature(found.table);
      // 真人节奏：翻页前停 3~7 秒（随机），别像机器一样一页接一页点。
      await sleep(3000 + Math.random() * 4000);
      var nav = await gotoPage(page + 1, prevSig, function () { return !videoRankState.stop; }, fingerprintVideoRank);
      if (nav === 'stopped') break;
      if (nav === 'no-button') {
        if (totalPages && page < totalPages) {
          videoRankState.partial = true;
          videoRankState.partialReason = '找不到下一页按钮（共 ' + totalPages + ' 页，只采到第 ' + page + ' 页）。';
        }
        break;
      }
      if (nav === 'timeout') {
        videoRankState.partial = true;
        videoRankState.partialReason = '第 ' + page + ' 页之后翻不动了' + (totalPages ? '（共 ' + totalPages + ' 页）' : '') + '，已采的 ' + videoRankState.rows.length + ' 条保留，导出为部分数据。';
        break;
      }
      page++;
    }
  } finally {
    videoRankState.running = false;
    saveState(STORE_KEYS.videoRank, { lastRun: new Date().toISOString(), rows: videoRankState.rows.length, partial: videoRankState.partial });
  }
  if (videoRankState.rows.length === 0) {
    panelStatus('0 行，未导出空文件。先看上面红字错误。');
    return;
  }
  var file = exportLocal('compass_video_rank', 'douyin', videoRankState.rows, {
    dateRangeText: readDateRangeText(),
    headers: videoRankState.headers,
    partial: videoRankState.partial,
    partialReason: videoRankState.partialReason,
    errors: videoRankState.errors
  });
  panelStatus('已采 ' + videoRankState.pagesCollected + (totalPages ? ' / 共 ' + totalPages : '') + ' 页，' + videoRankState.rows.length + ' 条' + (videoRankState.partial ? '，部分数据：' + videoRankState.partialReason : '') + '。只存本地，没发 VPS。');
}

function initVideoRankPanel() {
  var panel = makePanel('运维空间采集 · 短视频榜 v1.2.8');
  panel.querySelector('#sip-collect').onclick = function () { runVideoRankCollect(false); };
  panel.querySelector('#sip-all').onclick = function () { runVideoRankCollect(true); };
  panel.querySelector('#sip-stop').style.display = 'block';
  panel.querySelector('#sip-stop').onclick = function () { videoRankState.stop = true; panelStatus('正在停止，停下后导出已采的…'); };
  panel.querySelector('#sip-export').onclick = function () {
    if (!videoRankState.rows.length) { panelStatus('还没采到数据，先点“采集本页”。'); return; }
    var file = exportLocal('compass_video_rank', 'douyin', videoRankState.rows, {
      dateRangeText: readDateRangeText(), headers: videoRankState.headers, partial: videoRankState.partial, partialReason: videoRankState.partialReason, errors: videoRankState.errors
    });
    panelStatus('已导出 ' + file + '。只存本地，没发 VPS。');
  };
  panelStatus('已就绪：打开市场-短视频排行页，点“采集本页”或“自动翻页采集”。200 条分 10 页，翻页前停 3~7 秒。');
}

// ---- 启动 ----
(function boot() {
  function start() {
    var host = location.hostname;
    var path = location.pathname;
    if (host.indexOf('creator.douyin.com') !== -1 && path.indexOf('/creator-micro/data-center/content') !== -1) {
      initVideoPanel();
    } else if (host.indexOf('jinritemai.com') !== -1 && (path.indexOf('/shop/search/drainage-terms') !== -1 || path.indexOf('/ffa/mcompass/search') !== -1)) {
      initSearchPanel();
    } else if (host.indexOf('jinritemai.com') !== -1 && (path.indexOf('/shop/video/self') !== -1 || path.indexOf('/shop/video/cooperate') !== -1)) {
      initCompassVideoPanel();
    } else if (host.indexOf('jinritemai.com') !== -1 && path.indexOf('/shop/chance/video-rank') !== -1) {
      initVideoRankPanel();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 500);
  setTimeout(start, 2000);
})();

})();
