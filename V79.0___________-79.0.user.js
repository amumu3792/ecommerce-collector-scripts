// ==UserScript==
// @name         抖店罗盘·特征识别版 (V79.0 拒绝错位+完整区间)
// @namespace    http://tampermonkey.net/
// @version      79.0
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V79.0___________-79.0.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V79.0___________-79.0.user.js
// @description  合伙人验收版：1. 放弃列号定位，改用[特征识别]抓取搜索词，解决错位；2. 强制保留[数据区间](1000-2000)；3. 深度提取[趋势/百分比]；4. 自动识别Tab模式。
// @author       Gemini Architect
// @match        *://compass.jinritemai.com/*
// @match        *://fxg.jinritemai.com/*
// @grant        none
// ==/UserScript==
// 模板参考，出处：V79.0《抖店罗盘·特征识别版》：特征扫描（label 分类、title- 类抓搜索词）。无凭证、无飞书写入，仅本地导出；以“运维空间采集-v1.2”为准。唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts。

(function() {
    'use strict';

    let state = {
        targetTable: null,
        mode: 'auto', // auto detect
        allData: [],
        isRunning: false,
        stopSignal: false,
        pageLimit: 0,
        minimized: false,
        isSelecting: false
    };

    const DELAY = 2000;

    // ================= UI 界面 =================
    function createControlPanel() {
        if(document.getElementById('gemini-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'gemini-panel';

        panel.style.cssText = `
            position: fixed; top: 80px; right: 20px; z-index: 999999;
            background: #2c3e50; border: 2px solid #e74c3c; border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5); color: #fff; font-family: "Microsoft YaHei", sans-serif;
            width: 260px; font-size: 14px; transition: all 0.3s ease;
        `;

        panel.innerHTML = `
            <div id="g-header" style="padding: 10px; background:#c0392b; border-radius: 6px 6px 0 0; font-weight:bold; color:#fff; display:flex; justify-content:space-between; cursor:move; align-items:center;">
                <span>🔥 V79.0 特征识别版</span>
                <span id="g-min" style="cursor:pointer; font-size:18px;">_</span>
            </div>
            <div id="g-body" style="padding: 15px;">
                <div style="margin-bottom:10px; color:#ecf0f1; font-size:12px; border-bottom:1px solid #7f8c8d; padding-bottom:5px;">
                    <strong>核心修复：搜索词找回 & 区间完整</strong>
                </div>
                <div style="margin-bottom:15px; font-size:12px; color:#bdc3c7;">
                    1. 切换页面<br>
                    2. 点击【重新锁定】<br>
                    3. 点击表格变绿 -> 开始
                </div>

                <button id="g-lock-btn" style="width: 100%; padding: 10px; background: #e67e22; color: white; border: none; border-radius: 4px; font-weight: bold; margin-bottom:10px; cursor:pointer;">
                    🔄 1. 重新锁定表格
                </button>

                <div id="g-controls" style="display:none;">
                    <div id="g-lock-msg" style="margin-bottom:5px; color:#2ecc71; font-weight:bold; font-size:12px;">✅ 已锁定</div>

                    <div style="display: flex; justify-content: space-between; align-items:center; margin-bottom:10px;">
                        <span style="font-size:12px;">页数 (0=全部):</span>
                        <input type="number" id="g-page-limit" placeholder="0" style="width: 50px; text-align: center; color:#333; border-radius:4px; border:none; padding:4px;">
                    </div>

                    <button id="g-start-btn" style="width: 100%; padding: 10px; background: #27ae60; color: white; border: none; border-radius: 4px; font-weight: bold; cursor:pointer;">
                        🚀 2. 开始抓取 (自动识别)
                    </button>
                </div>

                <button id="g-stop-btn" style="width: 100%; padding: 8px; background: #7f8c8d; color: white; border: none; border-radius: 4px; cursor:pointer; display:none;">
                    🛑 停止并导出
                </button>
            </div>
            <div id="g-status" style="padding: 8px; background:#222; border-radius: 0 0 6px 6px; font-size: 12px; color: #ecf0f1;">等待操作...</div>

            <div id="g-ball" style="display:none; width:50px; height:50px; background:#e74c3c; border-radius:50%; position:absolute; right:0; bottom:0; cursor:pointer; box-shadow:0 5px 15px rgba(0,0,0,0.3); text-align:center; line-height:50px; font-size:24px; color:#fff; font-weight:bold;">+</div>
        `;
        document.body.appendChild(panel);
        bindEvents(panel);
    }

    function bindEvents(panel) {
        const header = document.getElementById('g-header');
        const body = document.getElementById('g-body');
        const status = document.getElementById('g-status');
        const ball = document.getElementById('g-ball');

        const toggleMin = (min) => {
            state.minimized = min;
            if(min) {
                body.style.display = 'none'; status.style.display = 'none'; header.style.display = 'none';
                panel.style.width = '50px'; panel.style.height = '50px'; panel.style.background = 'transparent'; panel.style.border = 'none';
                panel.style.top = 'auto'; panel.style.bottom = '100px';
                ball.style.display = 'block';
            } else {
                body.style.display = 'block'; status.style.display = 'block'; header.style.display = 'flex';
                panel.style.width = '280px'; panel.style.height = 'auto'; panel.style.background = '#2c3e50'; panel.style.border = '2px solid #e74c3c';
                panel.style.bottom = 'auto'; panel.style.top = '80px';
                ball.style.display = 'none';
            }
        };

        document.getElementById('g-min').onclick = () => toggleMin(true);
        ball.onclick = () => toggleMin(false);
        document.getElementById('g-lock-btn').onclick = startLockProcess;
        document.getElementById('g-start-btn').onclick = startScraping;
        document.getElementById('g-stop-btn').onclick = () => { state.stopSignal = true; updateMsg("正在停止..."); };
        document.getElementById('g-page-limit').onchange = (e) => state.pageLimit = parseInt(e.target.value) || 0;

        let isDragging=false, startX, startY, initLeft, initTop;
        header.onmousedown = (e) => { isDragging=true; startX=e.clientX; startY=e.clientY; initLeft=panel.offsetLeft; initTop=panel.offsetTop; };
        document.onmousemove = (e) => { if(isDragging) { panel.style.left=(initLeft+e.clientX-startX)+'px'; panel.style.top=(initTop+e.clientY-startY)+'px'; }};
        document.onmouseup = () => isDragging=false;
    }

    function updateMsg(msg) { document.getElementById('g-status').innerText = msg; }

    // ================= 核心 1: 锁定表格 =================
    function startLockProcess() {
        state.targetTable = null; state.allData = []; state.isSelecting = true;
        document.getElementById('g-controls').style.display = 'none';
        document.body.style.cursor = "crosshair";
        updateMsg("👀 请将鼠标移动到表格上，变色后点击！");
        document.addEventListener('mouseover', highlightTable);
        document.addEventListener('click', confirmTable, {capture: true});
    }

    function highlightTable(e) {
        if(!state.isSelecting) return;
        e.stopPropagation();
        let el = e.target.closest('table');
        if (window.lastHighlit && window.lastHighlit !== el) window.lastHighlit.style.outline = "";
        if (el) { el.style.outline = "4px solid #f39c12"; window.lastHighlit = el; }
    }

    function confirmTable(e) {
        if(!state.isSelecting) return;
        e.preventDefault(); e.stopPropagation();
        let el = e.target.closest('table');
        if (el) {
            state.targetTable = el;
            state.isSelecting = false;
            el.style.outline = "4px solid #2ecc71";
            document.body.style.cursor = "default";
            document.getElementById('g-controls').style.display = 'block';
            updateMsg(`✅ 锁定成功! 点击开始自动识别数据`);
            document.removeEventListener('mouseover', highlightTable);
            document.removeEventListener('click', confirmTable, {capture: true});
        }
    }

    // ================= 核心 2: 特征识别解析器 (V79.0 Core) =================
    // 不依赖列号，依赖内容特征

    // 工具：获取完整文本（解决区间值问题）
    function getFullText(el) {
        if(!el) return "";
        // 移除换行，保留中间的横杠等符号，去除多余空格
        return el.innerText.replace(/[\n\r]+/g, '').trim();
    }

    // 扫描单元格，根据内容决定怎么解析
    function scanCellFeatures(cell, rowData) {
        let text = cell.innerText;
        let html = cell.innerHTML;

        // 1. 特征：搜索词 (标题类名)
        // 修复：必须精准定位到 title- 类名，否则会抓空
        let titleEl = cell.querySelector('[class*="title-"]');
        if (titleEl && !rowData['搜索词']) {
            rowData['搜索词'] = titleEl.innerText.trim();
            // 顺便抓属性
            let tags = [];
            cell.querySelectorAll('[class*="sp-tag-content"]').forEach(t => tags.push(t.innerText.trim()));
            if(tags.length) rowData['词属性'] = tags.join('|');
            return; // 这是一个搜索词列，不再解析其他
        }

        // 2. 特征：复合数据 (含有 Label)
        // 针对“本店引流”这种一格多数的
        let labels = Array.from(cell.querySelectorAll('label'));
        if (labels.length > 0) {
            // 判断大类 (词下整体 vs 本店数据)
            let category = "数据";
            if(text.includes('点击人数') && text.includes('成交人数')) category = "词下整体";
            else if(text.includes('本店曝光率')) category = "本店曝光";
            else if(text.includes('转化率')) category = "本店成交";

            labels.forEach(label => {
                let labelText = label.innerText.trim();
                let container = label.closest('.ecom-space-horizontal') || label.parentElement.parentElement;

                if (container) {
                    // 获取数值：优先找 amount-data-range (区间)，没有则找 unifyValue
                    let valEl = container.querySelector('[class*="amount-data-range"]') || container.querySelector('[class*="unifyValue"]');
                    // ★★★ 核心修复：直接取 innerText，保留 "1000-2500" 格式 ★★★
                    let val = valEl ? valEl.innerText.replace(/[\n\r]/g, '').trim() : "";

                    // 获取趋势
                    let trend = "";
                    if(container.querySelector('[class*="upIdentify"]')) trend = "上升";
                    else if(container.querySelector('[class*="downIdentify"]')) trend = "下降";

                    let trendValEl = container.querySelector('[class*="cp-change-ratio-value"]');
                    if (trendValEl && trendValEl.innerText.trim() !== '-') {
                        trend += " " + trendValEl.innerText.trim();
                    }

                    rowData[`${category}_${labelText}`] = val;
                    if(trend) rowData[`${category}_${labelText}_趋势`] = trend;
                }
            });
            return;
        }

        // 3. 特征：纯区间数值 (没有 Label，只有数值)
        // 针对“总搜索人数”等
        let rangeEl = cell.querySelector('[class*="amount-data-range"]');
        if (rangeEl && !cell.querySelector('label')) {
             // ★★★ 核心修复：保留区间 ★★★
             let val = rangeEl.innerText.replace(/[\n\r]/g, '').trim();
             // 试图推断这是什么列？比较难，只能按出现顺序或假设
             // 如果还没有“总搜索人数”，就认为是它
             if (!rowData['总搜索人数']) rowData['总搜索人数'] = val;
             else rowData['其他指标'] = val; // 兜底

             // 找趋势
             let trendEl = cell.querySelector('[class*="cp-change-ratio-value"]');
             if(trendEl) {
                 let tVal = trendEl.innerText.trim();
                 let dir = "";
                 if(cell.querySelector('[class*="upIdentify"]')) dir = "上升";
                 else if(cell.querySelector('[class*="downIdentify"]')) dir = "下降";
                 rowData['搜索人数趋势'] = dir + " " + tVal;
             }
             return;
        }

        // 4. 特征：图片 (本店曝光商品)
        let imgs = Array.from(cell.querySelectorAll('img')).map(img => img.src).filter(s => s.startsWith('http'));
        if (imgs.length > 0 && !rowData['商品图片']) {
            rowData['商品图片'] = imgs.join('\n');
            let rank = cell.querySelector('[class*="mask-"]');
            if(rank) rowData['商品排名'] = rank.innerText;
            return;
        }

        // 5. 特征：热点指数 (针对热点Tab)
        if (text.includes('热点指数') || (cell.querySelector('.unifyValue') && !rangeEl && !labels.length)) {
             let v = cell.querySelector('.unifyValue');
             if(v) rowData['热点指数/数值'] = v.innerText.trim();
        }
    }

    function parseRow(tr) {
        const cells = Array.from(tr.querySelectorAll('td'));
        // 必须有足够单元格才处理
        if (cells.length < 3) return null;

        let r = {};
        // 遍历所有单元格，进行特征扫描
        cells.forEach(cell => {
            // 跳过 checkbox 列 (特征：含 input type=checkbox)
            if (cell.querySelector('input[type="checkbox"]')) return;
            scanCellFeatures(cell, r);
        });

        // 只有抓到了搜索词或者热点标题才算有效行
        if (r['搜索词'] || r['热点标题'] || r['总搜索人数']) return r;
        return null;
    }

    // ================= 采集主程序 =================
    async function startScraping() {
        if(!state.targetTable) return alert("请先点击【重新锁定表格】！");

        state.isRunning = true; state.stopSignal = false; state.allData = [];
        let page = 1;

        document.getElementById('g-stop-btn').style.display = 'block';

        while(!state.stopSignal) {
            if (state.pageLimit > 0 && page > state.pageLimit) break;
            updateMsg(`🚀 正在特征识别抓取第 ${page} 页...`);

            // DOM 保护
            if (!document.body.contains(state.targetTable)) {
                let newTable = document.querySelector('table[style*="outline"]') || document.querySelector('.ecom-table-content table');
                if(newTable) state.targetTable = newTable;
                else { updateMsg("❌ 表格丢失，请重新锁定"); break; }
            }

            let rows = state.targetTable.querySelectorAll('tbody tr');
            if (rows.length === 0) { updateMsg("⚠️ 无数据"); break; }

            let count = 0;
            rows.forEach(tr => {
                let d = parseRow(tr);
                if (d) { state.allData.push(d); count++; }
            });

            updateMsg(`✅ 第 ${page} 页：成功 ${count} 条 (总计 ${state.allData.length})`);

            const nextBtn = document.querySelector('.ecom-pagination-next:not([aria-disabled="true"]) button') ||
                            document.querySelector('li[title="下一页"]:not([aria-disabled="true"]) button');

            if (nextBtn) {
                nextBtn.click();
                await new Promise(r => setTimeout(r, DELAY));
                page++;
            } else {
                updateMsg("🏁 翻页结束，导出中...");
                break;
            }
        }
        exportCSV();
        state.isRunning = false;
        document.getElementById('g-stop-btn').style.display = 'none';
    }

    function exportCSV() {
        if(state.allData.length === 0) return alert("未采集到有效数据，请检查是否点击了正确的表格！");

        // 动态生成表头，智能排序
        let headerSet = new Set();
        // 强制顺序
        let priority = ['搜索词', '词属性', '总搜索人数', '搜索人数趋势',
                        '词下整体_曝光人数', '词下整体_点击人数', '词下整体_成交人数',
                        '本店曝光_曝光人数', '本店曝光_本店曝光率',
                        '本店成交_曝光成交转化率', '本店成交_成交人数', '本店成交_用户支付金额',
                        '商品图片', '商品排名'];

        priority.forEach(k => headerSet.add(k));
        state.allData.forEach(row => Object.keys(row).forEach(k => headerSet.add(k)));

        let headers = Array.from(headerSet);
        let csv = "\uFEFF" + headers.join(",") + "\n";

        state.allData.forEach(row => {
            let line = headers.map(h => {
                let val = row[h] || "";
                return `"${String(val).replace(/"/g, '""')}"`; // 防止CSV错位
            }).join(",");
            csv += line + "\n";
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `抖店数据_智能识别_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        updateMsg("🎉 导出成功！");
    }

    window.addEventListener('load', createControlPanel);
    setTimeout(createControlPanel, 1000);
})();