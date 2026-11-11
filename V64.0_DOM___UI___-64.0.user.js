// ==UserScript==
// @name         抖店罗盘·最终稳定版 (V64.0 DOM根治+UI优化)
// @namespace    http://tampermonkey.net/
// @version      64.0
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V64.0_DOM___UI___-64.0.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V64.0_DOM___UI___-64.0.user.js
// @description  FINAL FIX: 根治DOM引用失效问题，确保搜索/过滤/翻页后数据仍能被精准采集。自动分离数据，忠诚输出原始表头。
// @author       Gemini Architect
// @match        *://compass.jinritemai.com/*
// @match        *://fxg.jinritemai.com/*
// @grant        none
// ==/UserScript==
// 模板参考，出处：V64.0《抖店罗盘·最终稳定版》：parseSmartCell 值/趋势分离。无凭证、无飞书写入，仅本地导出；以“运维空间采集-v1.2”为准。唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts。

(function() {
    'use strict';

    let state = {
        targetTable: null,
        detectedHeaders: [],
        allData: [],
        isRunning: false,
        stopSignal: false,
        pageLimit: 0,
        minimized: false
    };

    const DELAY = 2000;

    // ================= UI & Event Handlers =================
    function createControlPanel() {
        if(document.getElementById('gemini-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'gemini-panel';

        // 初始位置：右上角
        panel.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 999999;
            background: #222; border: 2px solid #2ecc71; border-radius: 6px;
            box-shadow: 0 10px 50px rgba(0,0,0,0.9); color: #fff; font-family: sans-serif;
            width: 280px; transition: all 0.3s ease-in-out;
        `;

        panel.innerHTML = `
            <div id="g-content">
                <div id="g-header" style="padding: 12px; cursor: move; border-bottom: 1px solid #444; background:#333; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight: bold; color: #2ecc71;">✅ V64.0 最终稳定版</span>
                    <span id="g-min-btn" style="cursor: pointer; font-weight:bold;">_</span>
                </div>
                <div id="g-body" style="padding: 15px;">
                    <button id="g-pick" style="width: 100%; padding: 10px; background: #e67e22; color: white; border: none; border-radius: 4px; font-weight: bold; margin-bottom:10px;">
                        👆 1. 点击锁定表格
                    </button>

                    <div id="g-controls" style="display:none;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                            <span>📑 页数:</span>
                            <input type="number" id="g-page-limit" placeholder="全部" style="width: 60px; text-align: center; color:black;">
                        </div>
                        <button id="g-run" style="width: 100%; padding: 10px; background: #1966ff; color: white; border: none; border-radius: 4px; font-weight: bold;">
                            🚀 2. 开始抓取
                        </button>
                    </div>

                    <button id="g-stop" style="width: 100%; padding: 6px; background: #c0392b; color: white; border: none; border-radius: 4px; margin-top:10px;">
                        🛑 停止
                    </button>
                </div>
            </div>

            <div id="g-minimized-btn" style="display:none; width: 50px; height: 50px; background: #2ecc71; border-radius: 50%; text-align: center; line-height: 50px; cursor: pointer; position:absolute; top:0; left:0;">
                <span style="font-size: 30px; font-weight: bold; color: white;">—</span>
            </div>

            <div id="g-status" style="padding: 8px; font-size: 12px; color: #ccc; border-top: 1px solid #444;">等待操作...</div>
        `;
        document.body.appendChild(panel);

        bindEvents(panel);
    }

    function minimizePanel(shouldMinimize, panel) {
        const content = document.getElementById('g-content');
        const minBtn = document.getElementById('g-minimized-btn');
        const status = document.getElementById('g-status');

        if (shouldMinimize) {
            panel.style.top = 'auto';
            panel.style.left = 'auto';
            panel.style.bottom = '20px';
            panel.style.right = '20px';

            panel.style.width = '50px';
            panel.style.height = '50px';
            panel.style.borderRadius = '50%';
            content.style.display = 'none';
            status.style.display = 'none';
            minBtn.style.display = 'block';
            state.minimized = true;
        } else {
            panel.style.bottom = 'auto';
            panel.style.right = '20px';
            panel.style.top = '20px';
            panel.style.left = 'auto';

            panel.style.width = '280px';
            panel.style.height = 'auto';
            panel.style.borderRadius = '6px';
            content.style.display = 'block';
            status.style.display = 'block';
            minBtn.style.display = 'none';
            state.minimized = false;
        }
    }

    function bindEvents(panel) {
        const header = document.getElementById('g-header');
        const minBtn = document.getElementById('g-min-btn');
        const restoredBtn = document.getElementById('g-minimized-btn');

        header.onmousedown = (e) => {
            let isDragging=true, startX=e.clientX, startY=e.clientY, initialLeft=panel.offsetLeft, initialTop=panel.offsetTop;
            document.onmousemove = (e) => {
                if(isDragging && !state.minimized) {
                    panel.style.left=(initialLeft+e.clientX-startX)+'px';
                    panel.style.top=(initialTop+e.clientY-startY)+'px';
                    panel.style.right='auto'; panel.style.bottom='auto';
                }
            };
            document.onmouseup = () => isDragging=false;
        };

        minBtn.onclick = () => minimizePanel(true, panel);
        restoredBtn.onclick = () => minimizePanel(false, panel);

        document.getElementById('g-pick').onclick = enablePicker;
        document.getElementById('g-run').onclick = startScraping;
        document.getElementById('g-stop').onclick = () => { state.stopSignal = true; updateMsg("🛑 正在停止..."); setTimeout(() => { if(state.allData.length > 0) exportCSV(); state.isRunning = false; }, 800); };
        document.getElementById('g-page-limit').onchange = (e) => state.pageLimit = parseInt(e.target.value) || 0;
    }

    function updateMsg(msg) { document.getElementById('g-status').innerText = msg; }

    function extractHeaders(table) {
        const thead = table.querySelector('thead');
        if (!thead) return false;

        const rows = Array.from(thead.querySelectorAll('tr'));
        const lastRow = rows[rows.length - 1];
        let headers = Array.from(lastRow.querySelectorAll('th')).map(th => th.innerText.replace(/\n/g, ' ').replace('span', '').replace('svg', '').trim());

        if(!headers[0] || headers[0].trim() === "" || headers[0].length < 3) {
             headers.shift();
        }
        state.detectedHeaders = headers;
        return true;
    }

    // --- 极简锁定 (强制锁定第一个有效表格) ---
    function enablePicker() {
        const table = document.querySelector('table');
        const panel = document.getElementById('gemini-panel');

        if (table) {
            if (state.targetTable) state.targetTable.style.outline = "";

            state.targetTable = table;
            table.style.outline = "3px solid #2ecc71";
            extractHeaders(table);

            document.getElementById('g-pick').style.display = 'none';
            document.getElementById('g-controls').style.display = 'block';
            updateMsg("✅ 表格已锁定！点击开始。");
            minimizePanel(false, panel);
        } else {
            updateMsg("❌ 页面未检测到表格，请刷新后重试。");
        }

        state.isSelecting = false;
        document.body.style.cursor = "default";
    }

    // --- 数据提取逻辑 ---
    function cleanNum(str) {
        if(!str) return "";
        let clean = str.replace(/,/g, '').trim();
        return clean.replace(/(\d+(\.\d+)?)万/g, (m, p1) => parseFloat(p1) * 10000);
    }

    function parseSmartCell(cell) {
        if(!cell) return { val: '', trend: '' };

        let result = { val: '', trend: '' };

        let valEl = cell.querySelector('[class*="amount-data-range"]') || cell.querySelector('[class*="unifyValue"]');
        if (valEl) result.val = cleanNum(valEl.innerText.replace(/\n/g, '').trim());

        let trendEl = cell.querySelector('[class*="cp-change-ratio-value"]');
        if (trendEl) {
             result.trend = trendEl.innerText.trim();

             if(result.trend && result.trend !== '-' && result.trend !== '持平') {
                if(cell.querySelector('[class*="upIdentify"]')) {
                     result.trend = '+' + result.trend;
                } else if (cell.querySelector('[class*="downIdentify"]')) {
                     result.trend = '-' + result.trend;
                }
             } else if (result.trend === '' && cell.innerText.includes('持平')) {
                 result.trend = '持平';
             }
        }

        return { val: result.val, trend: result.trend };
    }

    function parseRow(tr) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (cells.length < 11) return null;

        let r = {};
        const headers = state.detectedHeaders;
        let originalHeaderIndex = 0;

        cells.forEach((cell, i) => {
            if (i === 0) return;

            let originalHeader = headers[originalHeaderIndex];
            if(!originalHeader) { originalHeaderIndex++; return; }

            // 1. 关键词列 (Index 1)
            if (i === 1) {
                let text = cell.innerText;
                let lines = text.split('\n').filter(l=>l.trim());
                r['推荐热词'] = lines[0] || "";
                r['热词标签'] = Array.from(cell.querySelectorAll('[class*="sp-tag-content"]')).map(t=>t.innerText).join(' | ');
                originalHeaderIndex++;
            }
            // 2. 数据列 (Index 2-7: 总搜索人数 到 搜索用户支付金额)
            else if (i >= 2 && i <= 7) {
                let extracted = parseSmartCell(cells[i]);

                r[originalHeader + '(值)'] = extracted.val;
                r[originalHeader + '(趋势)'] = extracted.trend;

                if(cell.innerText.includes('本店')) {
                     let ratioText = cell.innerText.match(/本店曝光率.*?([\d.%-]+)/);
                     r[originalHeader + '(本店)'] = ratioText ? ratioText[0].trim() : "本店数据存在";
                }

                originalHeaderIndex++;
            }
            // 3. 运营/素材列 (Index 8, 9, 10)
            else if (i >= 8 && i <= 10) {
                let text = cell.innerText;

                let adviceLines = text.split('\n').filter(l=>l.includes('建议') || l.includes('添加'));
                if(adviceLines.length > 0) {
                    r[originalHeader + '_建议'] = adviceLines.length > 1 ? adviceLines.join(' | ') : adviceLines[0].trim();
                } else if (text.includes('暂无优化建议')) {
                    r[originalHeader + '_建议'] = '暂无优化建议';
                }

                let lift = text.match(/预估.*?([+-]?\d+(\.\d+)?%)/);
                if(lift) r[originalHeader + '_预估提升'] = lift[0];

                let infoLines = text.split('\n').filter(l => (l.includes('同行') || l.includes('支付金额')) && !l.includes('建议'));
                if (infoLines.length > 0) {
                     r[originalHeader + '_其他信息'] = infoLines.join(' | ').trim();
                }

                let imgs = Array.from(cell.querySelectorAll('[class*="item-"] img')).map(img => img.src).filter(s => s.startsWith('http'));
                if(imgs.length > 0) r[originalHeader + '_图片'] = imgs.join('\n');

                originalHeaderIndex++;
            }
        });

        return r['推荐热词'] ? r : null;
    }

    // ================= 主运行 & 导出 =================
    async function startScraping() {
        if(!state.targetTable) {
             updateMsg("表格未锁定，请先点击锁定按钮。");
             return;
        }
        if(state.minimized) minimizePanel(false, document.getElementById('gemini-panel'));

        state.isRunning = true;
        state.stopSignal = false;
        state.allData = [];
        let page = 1;
        state.pageLimit = parseInt(document.getElementById('g-page-limit').value) || 0;

        updateMsg(`🚀 正在抓取第 ${page} 页...`);

        while(!state.stopSignal) {
            if (state.pageLimit > 0 && page > state.pageLimit) break;

            // ★★★ 核心稳定修复：每次都重新确认表格内容引用 (DOM追踪) ★★★
            let activeTable = findActiveTable();
            if(!activeTable) {
                 updateMsg("❌ 页面找不到表格，停止。");
                 break;
            }
            state.targetTable = activeTable;

            let rows = activeTable.querySelectorAll('tbody tr');

            if (rows.length === 0) {
                 updateMsg(`⚠️ 第 ${page} 页无数据，停止。`);
                 break;
            }

            let pageCount = 0;
            rows.forEach(tr => {
                let data = parseRow(tr);
                if(data) {
                    state.allData.push(data);
                    pageCount++;
                }
            });

            updateMsg(`📄 第 ${page} 页: 已存 ${pageCount} 条 (总计 ${state.allData.length})`);

            const nextBtn = findNextButton();
            if(nextBtn && !nextBtn.disabled) {
                nextBtn.click();
                await new Promise(r => setTimeout(r, DELAY));
                page++;
            } else {
                updateMsg("🏁 翻页结束，数据导出中...");
                break;
            }
        }
        exportCSV();
        state.isRunning = false;
    }

    function findActiveTable() {
        // 全局搜索包含“推荐热词”和“总搜索人数”的表格（最有可能的目标表格）
        let targetTable = Array.from(document.querySelectorAll('table')).find(t => t.innerText.includes('推荐热词') && t.innerText.includes('总搜索人数'));

        if (targetTable) {
            extractHeaders(targetTable);
            return targetTable;
        }
        return null;
    }

    function findNextButton() {
        const selectors = [
            '.auxo-pagination-next:not([aria-disabled="true"]) button',
            '.ecom-pagination-next:not([aria-disabled="true"]) button',
            'li[title="下一页"]:not([aria-disabled="true"]) button'
        ];
        for(let sel of selectors) {
            const btn = document.querySelector(sel);
            if(btn) return btn;
        }
        return null;
    }

    function exportCSV() {
        if(state.allData.length === 0) return alert("结果为空！");

        let allKeys = new Set();
        state.allData.forEach(d => Object.keys(d).forEach(k => allKeys.add(k)));

        const metrics = ['总搜索人数', '平台曝光商品数', '商品曝光人数', '搜索成交人数', '曝光成交率', '搜索用户支付金额'];
        const opMetrics = ['词下本店未曝光商品', '词下本店曝光商品', '词下热门商品'];

        let finalHeaders = ['推荐热词', '热词标签'];

        metrics.forEach(base => {
            if (allKeys.has(base + '(值)')) {
                finalHeaders.push(base + '(值)');
                if (allKeys.has(base + '(趋势)')) finalHeaders.push(base + '(趋势)');
                if (allKeys.has(base + '(本店)')) finalHeaders.push(base + '(本店)');
            }
        });

        opMetrics.forEach(base => {
            if (allKeys.has(base + '_建议')) finalHeaders.push(base + '_建议');
            if (allKeys.has(base + '_预估提升')) finalHeaders.push(base + '_预估提升');
            if (allKeys.has(base + '_其他信息')) finalHeaders.push(base + '_其他信息');
            if (allKeys.has(base + '_图片')) finalHeaders.push(base + '_图片');
        });

        let uniqueHeaders = Array.from(new Set(finalHeaders));

        let csv = "\uFEFF" + uniqueHeaders.join(",") + "\n";
        state.allData.forEach(row => {
            let rowStr = uniqueHeaders.map(h => {
                let val = row[h] || "";
                val = String(val).replace(/"/g, '""');
                return `"${val}"`;
            }).join(",");
            csv += rowStr + "\n";
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `抖店最终数据_${new Date().toLocaleDateString()}.csv`;
        link.click();
        updateMsg("✅ 导出完成");
    }

    window.addEventListener('load', () => {
        createControlPanel();
    });
    setTimeout(createControlPanel, 1000);
})();