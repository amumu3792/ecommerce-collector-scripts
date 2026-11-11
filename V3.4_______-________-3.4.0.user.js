// ==UserScript==
// @name         抖店推荐热词采集器(V3.4 终极稳定版 - 动态等待修复)
// @namespace    http://tampermonkey.net/
// @version      3.4.0
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V3.4_______-________-3.4.0.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V3.4_______-________-3.4.0.user.js
// @description  引入动态等待机制，确保页面数据完全加载后再采集，彻底解决翻页和数据丢失问题。
// @author       You
// @match        https://fxg.jinritemai.com/ffa/mcompass/search*
// @grant        GM_setClipboard
// @grant        GM_log
// @run-at       document-idle
// ==/UserScript==
// 模板参考，出处：V3.4.0《抖店推荐热词采集器》：动态等待修复。无凭证、无飞书写入，仅本地导出；以“运维空间采集-v1.2”为准。唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts。

(function() {
    'use strict';

    let collectedData = [];
    let isCollecting = false;
    let lastRowCount = 0; // 记录上一页的行数，用于动态等待

    // --- 实用工具函数 ---

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // --- 任务停止函数 ---
    function stopCollection() {
        isCollecting = false;
        updateStats('任务已终止');
        alert(`任务已手动终止，共采集 ${collectedData.length} 条数据。`);
    }

    // --- 控制面板及状态更新 ---

    function createControlPanel() {
        if(document.getElementById('keyword-collector-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'keyword-collector-panel';
        panel.innerHTML = `
            <div style="position: fixed; top: 120px; right: 20px; width: 280px; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 16px; z-index: 99999; border: 1px solid #ebeef5;">
                <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #333; display: flex; justify-content: space-between;">
                    <span>🔍 热词采集器 v3.4</span>
                    <span id="close-panel" style="cursor: pointer; color: #999;">×</span>
                </h3>
                <div style="background: #f5f7fa; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-size: 12px; color: #606266;">
                    已采集: <strong id="total-count" style="color: #409eff;">${collectedData.length}</strong> 条<br>
                    当前状态: <span id="status-text">就绪</span>
                </div>
                <button id="collect-current" style="width: 100%; padding: 8px; background: #409eff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 8px;">采集当前页</button>
                <button id="collect-all" style="width: 100%; padding: 8px; background: #67c23a; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 8px;">自动翻页采集</button>
                <button id="stop-collection" style="width: 100%; padding: 8px; background: #f56c6c; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 12px; display: none;">🛑 停止任务</button>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
                <button id="export-csv" style="width: 100%; padding: 6px; background: #e6a23c; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 5px;">📊 导出 CSV</button>
                <button id="clear-data" style="width: 100%; padding: 6px; background: #f56c6c; color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️ 清空数据</button>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('close-panel').onclick = () => panel.style.display = 'none';
        document.getElementById('collect-current').onclick = collectCurrentPage;
        document.getElementById('collect-all').onclick = collectAllPages;
        document.getElementById('stop-collection').onclick = stopCollection;
        document.getElementById('export-csv').onclick = exportToCSV;
        document.getElementById('clear-data').onclick = () => { collectedData = []; updateStats('数据已清空'); };
        updateStats('就绪');
    }

    function updateStats(status) {
        document.getElementById('total-count').textContent = collectedData.length;
        if (status) document.getElementById('status-text').textContent = status;

        const collectCurrentBtn = document.getElementById('collect-current');
        const collectAllBtn = document.getElementById('collect-all');
        const stopBtn = document.getElementById('stop-collection');

        if (collectCurrentBtn && collectAllBtn && stopBtn) {
            collectCurrentBtn.disabled = isCollecting;
            collectAllBtn.disabled = isCollecting;
            stopBtn.style.display = isCollecting ? 'block' : 'none';
        }
    }

    // --- 关键词提取 (保持 V3.2/V3.3 稳定逻辑) ---

    const UI_CLEANUP_PATTERN = /(查看详情|热词分析|\[热\]|热度高|行业Top\d+|^\s*,\s*|,\s*,)/g;

    function parseKeywordCell(keywordCell) {
        let keywordRaw = '';
        let tags = [];
        let textNodes = [];

        // 1. 深度遍历，收集所有有意义的文本节点
        const walker = document.createTreeWalker(
            keywordCell,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = node.nodeValue.trim();

            if (text.length >= 2 && !text.includes('...') && !text.includes('：')) {
                // 排除纯数字
                if (!/^\d+$/.test(text) && !/^\s*[\d\.\s%]+\s*$/.test(text)) {
                     textNodes.push(text);
                }
            }
        }

        // 2. 找到最长的文本作为关键词主体
        let longestText = '';
        textNodes.forEach(text => {
            if (!UI_CLEANUP_PATTERN.test(text)) {
                if (text.length > longestText.length) {
                    longestText = text;
                }
            }
        });

        // 3. 关键词降级：如果 TreeWalker 失败，退回简单切割（关键容错）
        if (!longestText) {
            const rawText = keywordCell.innerText.trim();
            const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
            longestText = lines[0] || '';
            textNodes = lines;
        }

        keywordRaw = longestText;

        // 4. 最终清理和整合标签
        const finalKeyword = keywordRaw.replace(UI_CLEANUP_PATTERN, '').trim();

        const finalTags = textNodes
            .filter(t => t !== finalKeyword && !UI_CLEANUP_PATTERN.test(t))
            .map(t => t.replace(finalKeyword, '').trim())
            .map(t => t.replace(UI_CLEANUP_PATTERN, '').trim())
            .filter(t => t.length > 0)
            .join(', ')
            .replace(/,+$/, '').replace(/^,+/, '').replace(/\s*,\s*/g, ', ').trim();

        return {
            keyword: finalKeyword,
            tags: finalTags || '-'
        };
    }

    // --- 核心采集逻辑 ---

    function findBestTable() {
        const tables = Array.from(document.querySelectorAll('table'));
        const targetTable = tables.find(t =>
            t.querySelector('thead') && t.querySelector('tbody') &&
            (t.innerText.includes('热词') || t.innerText.includes('总搜索人数'))
        );
        return targetTable;
    }

    function getColumnMap(table) {
        const headers = Array.from(table.querySelectorAll('th'));
        const map = {};
        headers.forEach((th, index) => {
            const text = th.innerText.trim();
            if (text.includes('热词') || text.includes('关键词')) map.keyword = index;
            else if (text.includes('总搜索人数')) map.searchPeople = index;
            else if (text.includes('平台曝光商品数')) map.exposureProducts = index;
            else if (text.includes('商品曝光人数')) map.exposurePeople = index;
            else if (text.includes('搜索成交人数')) map.transactionPeople = index;
            else if (text.includes('曝光成交率')) map.conversionRate = index;
            else if (text.includes('支付金额')) map.paymentAmount = index;
        });
        return map;
    }

    function collectCurrentPage() {
        const table = findBestTable();
        if (!table) {
            updateStats('未找到数据表格');
            return [];
        }

        const map = getColumnMap(table);
        const defaultMap = { keyword: 1, searchPeople: 2, exposureProducts: 3, exposurePeople: 4, transactionPeople: 5, conversionRate: 6, paymentAmount: 7 };
        const activeMap = Object.keys(map).length > 2 ? map : defaultMap;

        const rows = table.querySelectorAll('tbody tr');
        let newItems = [];

        console.log(`[热词采集] 找到 ${rows.length} 行数据，开始解析...`);

        rows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');

            if (cells.length > 3 && activeMap.keyword !== undefined && cells[activeMap.keyword]) {
                const keywordCell = cells[activeMap.keyword];

                const { keyword: keywordRaw, tags } = parseKeywordCell(keywordCell);

                if (!keywordRaw || keywordRaw.length < 2) {
                    console.warn(`[热词采集] 行 ${index + 1} 跳过: 无法提取有效关键词。`);
                    return;
                }

                const item = {
                    keyword: keywordRaw,
                    tags: tags,
                    searchPeople: cells[activeMap.searchPeople]?.innerText.trim() || '-',
                    exposureProducts: cells[activeMap.exposureProducts]?.innerText.trim() || '-',
                    exposurePeople: cells[activeMap.exposurePeople]?.innerText.trim() || '-',
                    transactionPeople: cells[activeMap.transactionPeople]?.innerText.trim() || '-',
                    conversionRate: cells[activeMap.conversionRate]?.innerText.trim() || '-',
                    paymentAmount: cells[activeMap.paymentAmount]?.innerText.trim() || '-'
                };

                if (!collectedData.find(d => d.keyword === item.keyword)) {
                    collectedData.push(item);
                    newItems.push(item);
                }
            }
        });

        // 记录当前行数，用于下一页的动态等待
        lastRowCount = rows.length;

        updateStats(`本页采集 ${newItems.length} 条`);
        console.log(`[热词采集] 实际入库 ${newItems.length} 条`);
        return newItems;
    }

    // --- V3.4 翻页修复：动态等待新数据 ---

    // 动态等待函数：等待表格出现新的数据行
    async function waitForNewData() {
        const maxWaitTime = 8000; // 最大等待 8 秒
        const checkInterval = 500; // 每 0.5 秒检查一次
        let waitedTime = 0;

        console.log(`[动态等待] 等待新数据加载...上一页行数: ${lastRowCount}`);

        while (waitedTime < maxWaitTime) {
            const table = findBestTable();
            if (table) {
                const currentRows = table.querySelectorAll('tbody tr');

                // 满足条件：行数大于 0 且行数与上一次不同
                if (currentRows.length > 0 && currentRows.length !== lastRowCount) {
                    console.log(`[动态等待] 成功加载 ${currentRows.length} 条新数据。`);
                    return true;
                }

                // 如果当前行数与上一页相同，但又没找到下一页按钮，可能就是数据没变，或者已经到尾页了
                if (currentRows.length === lastRowCount && currentRows.length > 0 && waitedTime > 500) {
                     // 可能是尾页，或者数据加载延迟
                }
            }

            if (!isCollecting) return false; // 如果任务被停止，立即退出

            await sleep(checkInterval);
            waitedTime += checkInterval;
        }

        console.warn(`[动态等待] 超时 (${maxWaitTime}ms)，或未检测到数据行数变化。`);
        return false;
    }

    async function clickNextPage() {
        // 策略1：基于提供的 HTML 结构，精准定位 '下一页' 按钮。
        const nextBtnPrecise =
            document.querySelector('.ecom-pagination li[title="下一页"]:not([aria-disabled="true"]) button') ||
            document.querySelector('li[title="下一页"]:not(.ecom-pagination-next-disabled) button');

        if (nextBtnPrecise) {
            nextBtnPrecise.click();
            return true;
        }

        // 策略2：V3.2 的通用 CSS 组合（容错）
        const nextBtnCSS =
            document.querySelector('.arco-pagination-next:not(.arco-pagination-disabled)') ||
            document.querySelector('.ecom-pagination-next[aria-disabled="false"]');

        if (nextBtnCSS) {
            nextBtnCSS.click();
            return true;
        }

        // 策略3：XPath 通用定位（最后的容错手段）
        try {
            const xpathResult = document.evaluate(
                "//button[contains(., '下一页') and not(@disabled)] | //li[@title='下一页' and not(@aria-disabled='true')]//button",
                document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            );
            if (xpathResult.singleNodeValue) {
                xpathResult.singleNodeValue.click();
                return true;
            }
        } catch (e) {
             console.warn('[翻页] XPath 查找失败:', e);
        }

        return false;
    }

    async function collectAllPages() {
        if (isCollecting) return;
        isCollecting = true;
        updateStats('开始自动采集...');

        // 首次采集，初始化 lastRowCount
        collectCurrentPage();

        let page = 1;
        let hasNext = true;
        let consecutiveEmpty = 0;

        while (hasNext && isCollecting && page <= 500) {

            updateStats(`正在采集第 ${page} 页... (总计 ${collectedData.length} 条)`);

            if (!isCollecting) break;

            const success = await clickNextPage();
            if (!success) {
                hasNext = false;
                console.log('[翻页] 无法找到下一页按钮，采集结束。');
                break;
            }

            // V3.4 改进：动态等待新数据加载
            const dataLoaded = await waitForNewData();

            // 如果超时退出，或者任务被停止，则终止循环
            if (!dataLoaded || !isCollecting) {
                 hasNext = false;
                 break;
            }

            // 数据加载后，开始采集
            const items = collectCurrentPage();
            let itemsCollectedOnPage = items.length;

            updateStats(`第 ${page + 1} 页采集 ${itemsCollectedOnPage} 条 (总计 ${collectedData.length} 条)`);

            page++;

            // 连续空页判断
            if (itemsCollectedOnPage === 0) {
                consecutiveEmpty++;
                if (consecutiveEmpty >= 3) {
                    console.warn('[热词采集] 连续 3 页采集为 0，自动判断采集结束。');
                    break;
                }
            } else {
                consecutiveEmpty = 0;
            }
        }

        isCollecting = false;
        updateStats(`采集结束，共 ${collectedData.length} 条`);
        if (document.getElementById('status-text').textContent !== '任务已终止') {
             alert(`自动翻页采集完成！共 ${collectedData.length} 条数据。`);
        }
    }

    function exportToCSV() {
        if (collectedData.length === 0) { alert('无数据'); return; }
        let csv = '\uFEFF关键词,标签,总搜索人数,平台曝光商品数,商品曝光人数,搜索成交人数,曝光成交率,搜索用户支付金额\n';
        collectedData.forEach(row => {
            const clean = [
                `"${row.keyword.replace(/"/g, '""')}"`,
                `"${row.tags.replace(/"/g, '""')}"`,
                row.searchPeople, row.exposureProducts,
                row.exposurePeople, row.transactionPeople, row.conversionRate, row.paymentAmount
            ];
            csv += clean.join(',') + '\n';
        });
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `抖店热词_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    }

    // 重点：如果界面不出现，请将 2000 改为 5000 尝试
    window.addEventListener('load', () => setTimeout(createControlPanel, 2000));
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(createControlPanel, 2000); }
    }).observe(document, {subtree: true, childList: true});
})();