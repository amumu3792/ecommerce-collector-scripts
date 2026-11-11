// ==UserScript==
// @name         抖店推荐热词采集器(V4.0 终极结构兼容版 - 解决列错位问题)
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V4.0_________-_________-4.0.0.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/V4.0_________-_________-4.0.0.user.js
// @description  解决抖店新页面结构导致的关键词采集错位问题，采用精准列索引和动态等待。
// @author       ChatGPT / Gemini (Final Refinement)
// @match        https://fxg.jinritemai.com/ffa/mcompass/search*
// @grant        GM_setClipboard
// @grant        GM_log
// @run-at       document-idle
// ==/UserScript==
// 模板参考，出处：V4.0.0《抖店推荐热词采集器》：getColumnMap 表头定列 + 动态等待 + XPath 翻页兜底。无凭证、无飞书写入，仅本地导出；以“运维空间采集-v1.2”为准。唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts。

(function() {
    'use strict';

    let collectedData = [];
    let isCollecting = false;
    let lastRowCount = 0; // 记录上一页的行数，用于动态等待

    // --- 实用工具函数 ---
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    function stopCollection() {
        isCollecting = false;
        updateStats('任务已终止');
        alert(`任务已手动终止，共采集 ${collectedData.length} 条数据。`);
    }

    // --- 控制面板及状态更新 (保持 V3.4 结构) ---

    function createControlPanel() {
        if(document.getElementById('keyword-collector-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'keyword-collector-panel';
        panel.innerHTML = `
            <div style="position: fixed; top: 120px; right: 20px; width: 280px; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 16px; z-index: 99999; border: 1px solid #ebeef5;">
                <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #333; display: flex; justify-content: space-between;">
                    <span>🔍 热词采集器 v4.0</span>
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
    
    // --- V4.0 关键词提取：适应新结构 ---

    const UI_CLEANUP_PATTERN = /(查看详情|热词分析|\[热\]|热度高|新增|行业Top\d+|^\s*,\s*|,\s*,|词下最高排名\d+)/g;

    function parseKeywordCell(keywordCell) {
        let keywordRaw = '';
        let tags = [];
        let textNodes = [];
        
        // 1. 深度遍历，收集所有有意义的文本节点 (V3.3 稳定逻辑)
        const walker = document.createTreeWalker(keywordCell, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
            const text = walker.currentNode.nodeValue.trim();
            if (text.length >= 2 && !/^\d+$/.test(text) && !/^\s*[\d\.\s%]+\s*$/.test(text)) {
                 textNodes.push(text);
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

        keywordRaw = longestText;

        // 3. 最终清理和整合标签
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
        // V4.0 适配: 查找包含 '搜索词' 和 '总搜索人数' 的表格
        const targetTable = tables.find(t => 
            t.querySelector('thead') && t.querySelector('tbody') && 
            (t.innerText.includes('搜索词') || t.innerText.includes('总搜索人数'))
        );
        return targetTable;
    }

    function getColumnMap(table) {
        const headers = Array.from(table.querySelectorAll('th'));
        const map = {};
        
        // V4.0 适配: 根据最新的表头文本进行精准匹配
        headers.forEach((th, index) => {
            const text = th.innerText.trim();
            if (text.includes('搜索词')) map.keyword = index;
            else if (text.includes('总搜索人数')) map.searchPeople = index;
            else if (text.includes('词下-整体数据')) map.overallData = index;
            else if (text.includes('本店-搜索曝光数据')) map.storeExposure = index;
            else if (text.includes('本店-搜索成交数据')) map.storeTransaction = index;
            // 固定列，根据您的结构，本店曝光商品在倒数第二列
            else if (text.includes('本店曝光商品')) map.storeProducts = index;
            // 最后一列
            else if (text.includes('推荐优化项')) map.optimizeItem = index;
        });
        return map;
    }

    function extractComplexCellData(cell, targetLabel) {
        if (!cell) return '-';
        // 查找包含目标标签的 div 容器，提取其后的值
        const containers = cell.querySelectorAll('.ecom-space-horizontal');
        for (const container of containers) {
            if (container.innerText.includes(targetLabel)) {
                // 尝试提取所有数字/范围/百分比数据，并用 "-" 拼接
                const values = Array.from(container.querySelectorAll('.unifyValue_56616, .dashed-NkpMqn span:not([class])'))
                                .map(el => el.innerText.trim())
                                .filter(t => t.length > 0);
                return values.join('-') || container.innerText.trim().replace(targetLabel, '').trim();
            }
        }
        // 对于最简单的单元格，直接返回 innerText
        return cell.innerText.trim().replace(/[\n\t]/g, ' ').replace(/:/g, '');
    }

    function collectCurrentPage() {
        const table = findBestTable();
        if (!table) {
            updateStats('未找到数据表格');
            return [];
        }

        const map = getColumnMap(table);
        // V4.0 默认映射：基于您提供的 HTML 结构索引 (0:关键词, 1:总搜, 2:空, 3:整体, 4:曝光, 5:成交...)
        const defaultMap = { 
            keyword: 0, 
            searchPeople: 1, 
            overallData: 3, 
            storeExposure: 4, 
            storeTransaction: 5 
        };
        const activeMap = Object.keys(map).length > 2 ? map : defaultMap; 

        const rows = table.querySelectorAll('tbody tr');
        let newItems = [];
        
        console.log(`[热词采集] 找到 ${rows.length} 行数据，开始解析...`);

        rows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            
            // 确保是有效的行，且有足够的列来容纳关键词和总搜索人数 (至少 2 列)
            if (cells.length >= 2 && activeMap.keyword !== undefined && cells[activeMap.keyword]) {
                
                const keywordCell = cells[activeMap.keyword];
                
                // 关键词/标签解析
                const { keyword: keywordRaw, tags } = parseKeywordCell(keywordCell);
                
                if (!keywordRaw || keywordRaw.length < 2) {
                    console.warn(`[热词采集] 行 ${index + 1} 跳过: 无法提取有效关键词。`);
                    return;
                }

                // V4.0 数据提取：根据新结构和复杂嵌套提取数据
                // 整体数据 (词下-整体数据) - 复杂嵌套
                const overallDataText = cells[activeMap.overallData] ? extractComplexCellData(cells[activeMap.overallData], '') : '-';
                // 店铺曝光数据 (本店-搜索曝光数据) - 复杂嵌套
                const storeExposureData = cells[activeMap.storeExposure] ? extractComplexCellData(cells[activeMap.storeExposure], '') : '-';
                // 店铺成交数据 (本店-搜索成交数据) - 复杂嵌套
                const storeTransactionData = cells[activeMap.storeTransaction] ? extractComplexCellData(cells[activeMap.storeTransaction], '') : '-';

                const item = {
                    keyword: keywordRaw, 
                    tags: tags,
                    searchPeople: cells[activeMap.searchPeople]?.innerText.trim() || '-',
                    overallData: overallDataText,
                    storeExposure: storeExposureData,
                    storeTransaction: storeTransactionData
                };

                if (!collectedData.find(d => d.keyword === item.keyword)) {
                    collectedData.push(item);
                    newItems.push(item);
                }
            }
        });
        
        lastRowCount = rows.length; 

        updateStats(`本页采集 ${newItems.length} 条`);
        console.log(`[热词采集] 实际入库 ${newItems.length} 条`);
        return newItems;
    }

    // --- V4.0 翻页修复：动态等待新数据 ---
    
    async function waitForNewData() {
        const maxWaitTime = 8000; 
        const checkInterval = 500; 
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
            }
            
            if (!isCollecting) return false; 

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

        // 策略2/3：通用容错
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

            const dataLoaded = await waitForNewData();
            
            if (!dataLoaded || !isCollecting) {
                 hasNext = false;
                 break;
            }

            const items = collectCurrentPage();
            let itemsCollectedOnPage = items.length;
            
            updateStats(`第 ${page + 1} 页采集 ${itemsCollectedOnPage} 条 (总计 ${collectedData.length} 条)`);
            
            page++;
            
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
        // V4.0 CSV 表头适配新结构
        let csv = '\uFEFF关键词,标签,总搜索人数,词下-整体数据,本店-搜索曝光数据,本店-搜索成交数据\n';
        collectedData.forEach(item => {
            const clean = [
                `"${item.keyword.replace(/"/g, '""')}"`, 
                `"${item.tags.replace(/"/g, '""')}"`, 
                `"${item.searchPeople}"`,
                `"${item.overallData}"`,
                `"${item.storeExposure}"`,
                `"${item.storeTransaction}"`
            ];
            csv += clean.join(',') + '\n';
        });
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `抖店热词_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    }

    window.addEventListener('load', () => setTimeout(createControlPanel, 2000));
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(createControlPanel, 2000); }
    }).observe(document, {subtree: true, childList: true});
})();