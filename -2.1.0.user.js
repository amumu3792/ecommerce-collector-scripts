// ==UserScript==
// @name         抖店推荐热词采集器(增强版)
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/-2.1.0.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/-2.1.0.user.js
// @description  自动采集抖店搜索运营页面的推荐热词，支持导出为Markdown/CSV/Excel格式
// @author       You
// @match        https://fxg.jinritemai.com/ffa/mcompass/search*
// @grant        GM_setClipboard
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==
// 模板参考，出处：v2.1.0《抖店推荐热词采集器（增强版）》：“导出飞书”只是复制 Markdown 到剪贴板，不调飞书接口。无凭证、无飞书写入，仅本地导出；以“运维空间采集-v1.2”为准。唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts。

/*
 * 更新日志 v2.1.0:
 * - ✅ 改进表格识别逻辑（通过表头内容而非索引，更可靠）
 * - ✅ 增强等待和加载机制（延长等待时间，改进数据检测）
 * - ✅ 优化分页按钮查找（5种策略，兼容性更强）
 * - ✅ 改进页码获取（3种策略）
 * - ✅ 添加详细的调试日志（便于排查问题）
 * - ✅ 新增诊断功能（一键检测问题）
 * - ✅ 改进初始化流程（多次重试，确保加载完成）
 * - ✅ 改进数据验证（过滤无效数据）
 */

(function() {
    'use strict';

    // 存储采集的数据
    let collectedData = [];
    let isCollecting = false;

    // 创建浮动控制面板
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'keyword-collector-panel';
        panel.innerHTML = `
            <div style="
                position: fixed;
                top: 100px;
                right: 20px;
                width: 300px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                padding: 16px;
                z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            ">
                <div style="
                    font-size: 16px;
                    font-weight: bold;
                    color: #667eea;
                    margin-bottom: 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                ">
                    🔍 推荐热词采集器
                    <button id="close-panel" style="
                        margin-left: auto;
                        background: none;
                        border: none;
                        font-size: 18px;
                        cursor: pointer;
                        color: #999;
                    ">×</button>
                </div>

                <div style="
                    background: #f0f4ff;
                    padding: 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    color: #555;
                    margin-bottom: 12px;
                    line-height: 1.5;
                ">
                    已采集: <span id="total-count" style="font-weight: bold; color: #667eea;">0</span> 条<br>
                    当前页: <span id="current-page" style="font-weight: bold; color: #667eea;">1</span>
                </div>

                <button id="collect-current" style="
                    width: 100%;
                    padding: 10px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    margin-bottom: 8px;
                ">采集当前页</button>

                <button id="collect-all" style="
                    width: 100%;
                    padding: 10px;
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    margin-bottom: 12px;
                ">自动采集所有页</button>

                <div style="font-size: 11px; color: #999; margin-bottom: 6px;">导出格式:</div>

                <button id="export-csv" disabled style="
                    width: 100%;
                    padding: 8px;
                    background: #d1d5db;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: not-allowed;
                    margin-bottom: 6px;
                ">📊 CSV表格(推荐)</button>

                <button id="export-excel" disabled style="
                    width: 100%;
                    padding: 8px;
                    background: #d1d5db;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: not-allowed;
                    margin-bottom: 6px;
                ">📑 Excel表格</button>

                <button id="export-feishu" disabled style="
                    width: 100%;
                    padding: 8px;
                    background: #d1d5db;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: not-allowed;
                    margin-bottom: 12px;
                ">📝 Markdown格式</button>

                <button id="clear-data" style="
                    width: 100%;
                    padding: 10px;
                    background: #ef4444;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    margin-bottom: 6px;
                ">清空数据</button>

                <button id="run-diagnostics" style="
                    width: 100%;
                    padding: 8px;
                    background: #6b7280;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                ">🔧 运行诊断</button>

                <div id="status-message" style="
                    margin-top: 12px;
                    padding: 8px;
                    border-radius: 6px;
                    font-size: 12px;
                    text-align: center;
                    display: none;
                "></div>
            </div>
        `;

        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('close-panel').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        document.getElementById('collect-current').addEventListener('click', collectCurrentPage);
        document.getElementById('collect-all').addEventListener('click', collectAllPages);
        document.getElementById('export-feishu').addEventListener('click', exportToFeishu);
        document.getElementById('export-csv').addEventListener('click', exportToCSV);
        document.getElementById('export-excel').addEventListener('click', exportToExcel);
        document.getElementById('clear-data').addEventListener('click', clearData);
        document.getElementById('run-diagnostics').addEventListener('click', () => {
            showStatus('正在运行诊断...请查看控制台', 'info');
            runDiagnostics();
        });
    }

    // 采集当前页面的推荐热词
    function collectCurrentPage() {
        const keywords = getCurrentPageKeywords();

        if (keywords.length === 0) {
            showStatus('未找到推荐热词数据', 'error');
            return;
        }

        // 合并数据（去重）
        keywords.forEach(item => {
            const exists = collectedData.find(d => d.keyword === item.keyword);
            if (!exists) {
                collectedData.push(item);
            }
        });

        updateStats();
        showStatus(`成功采集 ${keywords.length} 条热词`, 'success');

        // 启用所有导出按钮
        enableExportButtons();
    }

    // 启用所有导出按钮
    function enableExportButtons() {
        const buttons = [
            { id: 'export-csv', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
            { id: 'export-excel', gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' },
            { id: 'export-feishu', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }
        ];

        buttons.forEach(btn => {
            const el = document.getElementById(btn.id);
            if (el) {
                el.disabled = false;
                el.style.background = btn.gradient;
                el.style.cursor = 'pointer';
            }
        });
    }

    // 等待数据加载完成（增强版）
    async function waitForDataLoad(previousKeywords, maxWaitTime = 8000) {
        const startTime = Date.now();
        let checkCount = 0;

        console.log('开始等待数据加载...');

        while (Date.now() - startTime < maxWaitTime) {
            await sleep(500);
            checkCount++;

            const currentKeywords = getCurrentPageKeywords();
            console.log(`第 ${checkCount} 次检查，发现 ${currentKeywords.length} 条数据`);

            // 检查是否有新数据且与之前不同
            if (currentKeywords.length > 0 && previousKeywords.length > 0) {
                // 比较第一条数据的关键词是否不同
                const isDifferent = currentKeywords[0].keyword !== previousKeywords[0].keyword;

                if (isDifferent) {
                    console.log('✓ 检测到新数据已加载');
                    // 再等待500ms确保数据完全加载
                    await sleep(500);
                    return true;
                }
            } else if (currentKeywords.length > 0 && previousKeywords.length === 0) {
                // 之前没有数据，现在有了
                console.log('✓ 检测到数据已加载（首次）');
                await sleep(500);
                return true;
            }
        }

        console.warn('⚠ 等待数据加载超时');
        return false;
    }

    // 自动采集所有页面
    async function collectAllPages() {
        if (isCollecting) {
            showStatus('正在采集中，请稍候...', 'info');
            return;
        }

        isCollecting = true;
        const collectBtn = document.getElementById('collect-all');
        const originalText = collectBtn.textContent;
        collectBtn.textContent = '采集中...';
        collectBtn.disabled = true;

        showStatus('开始自动采集所有页面...', 'info');

        try {
            let currentPage = 1;
            const maxPages = 23;
            let consecutiveFailures = 0;
            const maxConsecutiveFailures = 3;

            for (let i = 0; i < maxPages; i++) {
                console.log(`\n===== 开始采集第 ${currentPage} 页 =====`);

                // 采集当前页
                const keywords = getCurrentPageKeywords();

                if (keywords.length === 0) {
                    console.log('当前页无数据，停止采集');
                    consecutiveFailures++;
                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        showStatus('连续多页无数据，采集结束', 'info');
                        break;
                    }
                } else {
                    consecutiveFailures = 0;

                    // 合并数据
                    let newCount = 0;
                    keywords.forEach(item => {
                        const exists = collectedData.find(d => d.keyword === item.keyword);
                        if (!exists) {
                            collectedData.push(item);
                            newCount++;
                        }
                    });

                    console.log(`第 ${currentPage} 页采集到 ${keywords.length} 条数据，新增 ${newCount} 条`);
                    updateStats();
                    showStatus(`正在采集第 ${currentPage} 页... 已采集 ${collectedData.length} 条`, 'info');
                }

                // 如果不是最后一页，点击下一页
                if (i < maxPages - 1) {
                    console.log('准备翻到下一页...');

                    // 保存当前页数据用于验证
                    const previousKeywords = keywords;
                    const previousPage = currentPage;

                    // 尝试点击下一页
                    const nextClicked = clickNextPage();
                    if (!nextClicked) {
                        console.log('无法找到下一页按钮，采集结束');
                        showStatus('已到达最后一页，采集结束', 'info');
                        break;
                    }

                    console.log('已点击下一页按钮，等待页面加载...');

                    // 等待页面加载和数据更新
                    await sleep(2000); // 先等待2秒让页面开始加载

                    // 等待新数据加载
                    const dataLoaded = await waitForDataLoad(previousKeywords, 5000);

                    if (!dataLoaded) {
                        console.log('等待新数据超时，尝试继续...');
                    }

                    // 验证页码是否变化
                    const newPage = getCurrentPageNumber();
                    console.log(`页码变化: ${previousPage} -> ${newPage}`);

                    if (newPage === previousPage) {
                        console.log('页码未变化，可能已到最后一页');
                        // 再尝试一次
                        await sleep(1000);
                        const retryPage = getCurrentPageNumber();
                        if (retryPage === previousPage) {
                            showStatus('页码未变化，采集结束', 'info');
                            break;
                        }
                        currentPage = retryPage;
                    } else {
                        currentPage = newPage;
                    }

                    console.log(`成功翻到第 ${currentPage} 页`);

                    // 额外等待一下确保页面稳定
                    await sleep(500);
                }
            }

            showStatus(`采集完成！共采集 ${collectedData.length} 条热词`, 'success');

            // 启用所有导出按钮
            enableExportButtons();

        } catch (error) {
            console.error('采集出错:', error);
            showStatus('采集出错: ' + error.message, 'error');
        } finally {
            isCollecting = false;
            collectBtn.textContent = originalText;
            collectBtn.disabled = false;
        }
    }

    // 获取当前页面的推荐热词（增强版）
    function getCurrentPageKeywords() {
        const keywords = [];

        try {
            console.log('===== 开始查找推荐热词表格 =====');

            // 方法1: 通过表头内容识别目标表格（最可靠）
            let targetTable = null;
            const tables = document.querySelectorAll('table');
            console.log(`找到 ${tables.length} 个表格`);

            for (let i = 0; i < tables.length; i++) {
                const table = tables[i];
                const headerText = table.innerText || '';

                // 查找包含"推荐热词"相关表头的表格
                if (headerText.includes('推荐热词') ||
                    headerText.includes('总搜索人数') ||
                    headerText.includes('平台曝光商品数')) {
                    targetTable = table;
                    console.log(`✓ 找到目标表格（第 ${i + 1} 个表格）`);
                    break;
                }
            }

            // 方法2: 如果方法1失败，尝试使用索引（兼容旧版本）
            if (!targetTable && tables.length >= 2) {
                targetTable = tables[1];
                console.log('使用索引方式获取第2个表格（降级方案）');
            }

            if (!targetTable) {
                console.warn('❌ 未找到推荐热词表格');
                return keywords;
            }

            const rows = targetTable.querySelectorAll('tbody tr');
            console.log(`表格中有 ${rows.length} 行数据`);

            if (rows.length === 0) {
                console.warn('表格中没有数据行');
                return keywords;
            }

            // 跳过第一行（可能是隐藏行）
            let startIndex = 0;
            if (rows[0] && rows[0].style.display === 'none') {
                startIndex = 1;
                console.log('跳过第一行隐藏行');
            }

            for (let i = startIndex; i < rows.length; i++) {
                try {
                    const row = rows[i];

                    // 跳过隐藏行
                    if (row.style.display === 'none' || row.offsetParent === null) {
                        continue;
                    }

                    const cells = row.querySelectorAll('td');

                    if (cells.length >= 7) {
                        const keywordText = (cells[1].innerText || '').trim().split('\n')[0];

                        // 验证关键词有效性
                        if (keywordText && keywordText.length > 0 && !keywordText.includes('推荐热词')) {
                            const cellFullText = cells[1].innerText || '';
                            const tags = [];
                            if (cellFullText.includes('增速快')) tags.push('增速快');
                            if (cellFullText.includes('热度高')) tags.push('热度高');
                            if (cellFullText.includes('竞争小')) tags.push('竞争小');
                            if (cellFullText.includes('看后搜热词')) tags.push('看后搜热词');

                            keywords.push({
                                keyword: keywordText,
                                tags: tags.join(','),
                                searchPeople: extractCellText(cells[2]),
                                exposureProducts: extractCellText(cells[3]),
                                exposurePeople: extractCellText(cells[4]),
                                transactionPeople: extractCellText(cells[5]),
                                conversionRate: extractCellText(cells[6]),
                                paymentAmount: cells.length > 7 ? extractCellText(cells[7]) : ''
                            });
                        }
                    }
                } catch (e) {
                    console.error(`处理行 ${i} 出错:`, e);
                }
            }

            console.log(`✓ 成功提取 ${keywords.length} 条关键词`);
        } catch (error) {
            console.error('❌ 采集数据时出错:', error);
        }

        return keywords;
    }

    // 提取单元格文本
    function extractCellText(cell) {
        if (!cell) return '';
        const text = (cell.innerText || '').trim();
        const lines = text.split('\n').filter(line => line.trim());
        return lines.slice(0, 3).join('-');
    }

    // 点击下一页（增强版 - 多种查找策略）
    function clickNextPage() {
        console.log('===== 开始查找下一页按钮 =====');

        try {
            // 策略1: 查找 .ecom-pagination-next（最准确，针对抖店页面）
            const nextPageItem = document.querySelector('.ecom-pagination-next');
            if (nextPageItem) {
                const ariaDisabled = nextPageItem.getAttribute('aria-disabled');
                console.log(`策略1: 找到 .ecom-pagination-next，aria-disabled: ${ariaDisabled}`);

                if (ariaDisabled !== 'true') {
                    const btn = nextPageItem.querySelector('button');
                    if (btn && !btn.disabled) {
                        console.log('✓ 找到下一页按钮（策略1）');
                        btn.click();
                        return true;
                    }
                } else {
                    console.log('已到最后一页（策略1确认）');
                    return false;
                }
            }

            // 策略2: 通过 title="下一页" 查找
            const nextByTitle = document.querySelector('li[title="下一页"]');
            if (nextByTitle) {
                const ariaDisabled = nextByTitle.getAttribute('aria-disabled');
                console.log(`策略2: 找到 title="下一页"，aria-disabled: ${ariaDisabled}`);

                if (ariaDisabled !== 'true') {
                    const btn = nextByTitle.querySelector('button');
                    if (btn && !btn.disabled) {
                        console.log('✓ 找到下一页按钮（策略2）');
                        btn.click();
                        return true;
                    }
                }
            }

            // 策略3: 查找包含向右箭头的按钮
            const allButtons = document.querySelectorAll('button');
            for (let btn of allButtons) {
                const btnText = btn.innerText || '';
                const title = btn.getAttribute('title') || '';
                const ariaLabel = btn.getAttribute('aria-label') || '';

                if (btnText.includes('>') || btnText.includes('›') || btnText.includes('»') ||
                    title.includes('下一页') || ariaLabel.includes('下一页') || ariaLabel.includes('next')) {

                    if (!btn.disabled && btn.offsetParent !== null) {
                        console.log('✓ 找到下一页按钮（策略3 - 箭头按钮）');
                        btn.click();
                        return true;
                    }
                }
            }

            // 策略4: 通过分页结构查找
            const pageItems = document.querySelectorAll('[class*="pagination"] li, [class*="pager"] li');
            console.log(`策略4: 找到 ${pageItems.length} 个分页项`);

            for (let item of pageItems) {
                const title = item.getAttribute('title') || '';
                const itemText = item.textContent || '';
                const ariaLabel = item.getAttribute('aria-label') || '';

                if (title.includes('下一页') || itemText.includes('下一页') || ariaLabel.includes('next')) {
                    const ariaDisabled = item.getAttribute('aria-disabled');
                    if (ariaDisabled !== 'true') {
                        const btn = item.querySelector('button');
                        if (btn && !btn.disabled) {
                            console.log('✓ 找到下一页按钮（策略4）');
                            btn.click();
                            return true;
                        }
                    } else {
                        console.log('已到最后一页（策略4确认）');
                        return false;
                    }
                }
            }

            // 策略5: 查找class包含"next"的元素
            const nextElements = document.querySelectorAll('[class*="next"], [class*="Next"]');
            console.log(`策略5: 找到 ${nextElements.length} 个包含next的元素`);

            for (let elem of nextElements) {
                const ariaDisabled = elem.getAttribute('aria-disabled');
                if (ariaDisabled !== 'true' && elem.offsetParent !== null) {
                    const btn = elem.tagName === 'BUTTON' ? elem : elem.querySelector('button');
                    if (btn && !btn.disabled) {
                        console.log('✓ 找到下一页按钮（策略5）');
                        btn.click();
                        return true;
                    }
                }
            }

            console.warn('❌ 所有策略均未找到可用的下一页按钮');
            return false;

        } catch (error) {
            console.error('❌ 点击下一页出错:', error);
            return false;
        }
    }

    // 获取当前页码（增强版）
    function getCurrentPageNumber() {
        try {
            // 策略1: 查找 ecom-pagination-item-active（针对抖店页面）
            const activeItem = document.querySelector('.ecom-pagination-item-active');
            if (activeItem) {
                const text = (activeItem.textContent || '').trim();
                if (/^\d+$/.test(text)) {
                    const pageNum = parseInt(text);
                    console.log(`✓ 当前页码: ${pageNum}（策略1）`);
                    return pageNum;
                }
            }

            // 策略2: 查找包含 active 类的分页元素
            const activeItems = document.querySelectorAll('[class*="active"][class*="page"], [class*="pagination"][class*="active"]');
            for (let item of activeItems) {
                const text = (item.innerText || '').trim();
                if (/^\d+$/.test(text)) {
                    const pageNum = parseInt(text);
                    console.log(`✓ 当前页码: ${pageNum}（策略2）`);
                    return pageNum;
                }
            }

            // 策略3: 通过aria-current属性查找
            const currentPage = document.querySelector('[aria-current="page"]');
            if (currentPage) {
                const text = (currentPage.innerText || '').trim();
                if (/^\d+$/.test(text)) {
                    const pageNum = parseInt(text);
                    console.log(`✓ 当前页码: ${pageNum}（策略3）`);
                    return pageNum;
                }
            }

            console.log('未找到页码，返回默认值 1');
        } catch (e) {
            console.error('获取页码出错:', e);
        }
        return 1;
    }

    // 导出为飞书Markdown格式
    function exportToFeishu() {
        if (collectedData.length === 0) {
            showStatus('没有数据可以导出', 'error');
            return;
        }

        // 生成飞书表格格式（Markdown）
        let markdown = `# 抖店推荐热词数据采集\n\n`;
        markdown += `采集时间：${new Date().toLocaleString('zh-CN')}\n`;
        markdown += `总计：${collectedData.length} 条\n\n`;
        markdown += `| 序号 | 推荐热词 | 标签 | 总搜索人数 | 平台曝光商品数 | 商品曝光人数 | 搜索成交人数 | 曝光成交率 | 搜索用户支付金额 |\n`;
        markdown += `|------|----------|------|------------|----------------|--------------|--------------|------------|------------------|\n`;

        collectedData.forEach((item, index) => {
            markdown += `| ${index + 1} | ${item.keyword} | ${item.tags} | ${item.searchPeople} | ${item.exposureProducts} | ${item.exposurePeople} | ${item.transactionPeople} | ${item.conversionRate} | ${item.paymentAmount} |\n`;
        });

        markdown += `\n---\n数据来源：抖店搜索运营-推荐热词\n`;

        // 复制到剪贴板
        if (typeof GM_setClipboard !== 'undefined') {
            GM_setClipboard(markdown);
            showStatus('已复制到剪贴板！可直接粘贴到飞书文档', 'success');
        } else {
            // 降级方案：使用浏览器API
            navigator.clipboard.writeText(markdown).then(() => {
                showStatus('已复制到剪贴板！可直接粘贴到飞书文档', 'success');
            }).catch(err => {
                console.error('复制失败:', err);
                // 下载为文件
                downloadFile(markdown, `抖店推荐热词_${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
                showStatus('已下载为Markdown文件', 'success');
            });
        }
    }

    // 导出CSV格式
    function exportToCSV() {
        if (collectedData.length === 0) {
            showStatus('没有数据可以导出', 'error');
            return;
        }

        // 生成CSV内容（使用UTF-8 BOM以支持Excel打开中文）
        let csv = '\uFEFF'; // UTF-8 BOM
        csv += '序号,推荐热词,标签,总搜索人数,平台曝光商品数,商品曝光人数,搜索成交人数,曝光成交率,搜索用户支付金额\n';

        collectedData.forEach((item, index) => {
            const row = [
                index + 1,
                `"${item.keyword.replace(/"/g, '""')}"`, // 转义引号
                `"${item.tags.replace(/"/g, '""')}"`,
                `"${item.searchPeople}"`,
                `"${item.exposureProducts}"`,
                `"${item.exposurePeople}"`,
                `"${item.transactionPeople}"`,
                `"${item.conversionRate}"`,
                `"${item.paymentAmount}"`
            ];
            csv += row.join(',') + '\n';
        });

        // 下载CSV文件
        const filename = `抖店推荐热词_${new Date().toISOString().slice(0, 10)}.csv`;
        downloadFile(csv, filename, 'text/csv;charset=utf-8');
        showStatus('CSV文件已下载！可导入Excel或飞书多维表格', 'success');
    }

    // 导出Excel格式（使用HTML表格转换）
    function exportToExcel() {
        if (collectedData.length === 0) {
            showStatus('没有数据可以导出', 'error');
            return;
        }

        // 生成HTML表格（Excel可以直接打开）
        let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">';
        html += '<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>';
        html += '<x:Name>推荐热词</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>';
        html += '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>';
        html += '<body><table border="1">';

        // 表头
        html += '<thead><tr style="background-color: #667eea; color: white; font-weight: bold;">';
        html += '<th>序号</th><th>推荐热词</th><th>标签</th><th>总搜索人数</th><th>平台曝光商品数</th>';
        html += '<th>商品曝光人数</th><th>搜索成交人数</th><th>曝光成交率</th><th>搜索用户支付金额</th>';
        html += '</tr></thead><tbody>';

        // 数据行
        collectedData.forEach((item, index) => {
            html += '<tr>';
            html += `<td>${index + 1}</td>`;
            html += `<td>${item.keyword}</td>`;
            html += `<td>${item.tags}</td>`;
            html += `<td>${item.searchPeople}</td>`;
            html += `<td>${item.exposureProducts}</td>`;
            html += `<td>${item.exposurePeople}</td>`;
            html += `<td>${item.transactionPeople}</td>`;
            html += `<td>${item.conversionRate}</td>`;
            html += `<td>${item.paymentAmount}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table></body></html>';

        // 下载Excel文件
        const filename = `抖店推荐热词_${new Date().toISOString().slice(0, 10)}.xls`;
        downloadFile(html, filename, 'application/vnd.ms-excel');
        showStatus('Excel文件已下载！可直接用Excel打开', 'success');
    }

    // 通用下载文件函数
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 清空数据
    function clearData() {
        if (confirm('确定要清空所有已采集的数据吗？')) {
            collectedData = [];
            updateStats();
            showStatus('数据已清空', 'info');

            // 禁用所有导出按钮
            ['export-feishu', 'export-csv', 'export-excel'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.disabled = true;
                    btn.style.background = '#d1d5db';
                    btn.style.cursor = 'not-allowed';
                }
            });
        }
    }

    // 更新统计信息
    function updateStats() {
        const totalCount = document.getElementById('total-count');
        const currentPage = document.getElementById('current-page');

        if (totalCount) {
            totalCount.textContent = collectedData.length;
        }

        if (currentPage) {
            currentPage.textContent = getCurrentPageNumber();
        }
    }

    // 显示状态消息
    function showStatus(message, type = 'info') {
        const statusEl = document.getElementById('status-message');
        if (!statusEl) return;

        statusEl.textContent = message;
        statusEl.style.display = 'block';

        // 设置颜色
        if (type === 'success') {
            statusEl.style.background = '#d1fae5';
            statusEl.style.color = '#065f46';
        } else if (type === 'error') {
            statusEl.style.background = '#fee2e2';
            statusEl.style.color = '#991b1b';
        } else {
            statusEl.style.background = '#dbeafe';
            statusEl.style.color = '#1e40af';
        }

        // 3秒后自动隐藏（除非是采集中的消息）
        if (type !== 'info' || !message.includes('采集中')) {
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 3000);
        }
    }

    // 睡眠函数
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 初始化（增强版）
    function init() {
        console.log('===================================');
        console.log('抖店推荐热词采集器(增强版) v2.1.0');
        console.log('===================================');

        // 检查是否在正确的页面
        const currentUrl = window.location.href;
        console.log('当前URL:', currentUrl);

        if (!currentUrl.includes('fxg.jinritemai.com/ffa/mcompass/search')) {
            console.warn('⚠ 警告: 当前不在抖店搜索运营页面');
            console.warn('请访问: https://fxg.jinritemai.com/ffa/mcompass/search');
        }

        // 延迟初始化，确保页面完全加载
        function tryInit(attempt = 1, maxAttempts = 5) {
            console.log(`初始化尝试 ${attempt}/${maxAttempts}...`);

            // 检查关键元素是否存在
            const tables = document.querySelectorAll('table');
            const hasData = tables.length > 0;

            console.log(`检测到 ${tables.length} 个表格`);

            if (hasData || attempt >= maxAttempts) {
                // 创建控制面板
                if (!document.getElementById('keyword-collector-panel')) {
                    createControlPanel();
                    console.log('✓ 控制面板已创建');

                    // 运行诊断
                    setTimeout(() => {
                        runDiagnostics();
                    }, 2000);
                } else {
                    console.log('控制面板已存在，跳过创建');
                }
            } else {
                // 继续尝试
                console.log(`页面数据未完全加载，${2000}ms后重试...`);
                setTimeout(() => tryInit(attempt + 1, maxAttempts), 2000);
            }
        }

        // 等待页面完全加载
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => tryInit(), 1000);
            });
        } else {
            setTimeout(() => tryInit(), 1000);
        }

        console.log('✓ 采集器已启动');
    }

    // 运行诊断（帮助用户排查问题）
    function runDiagnostics() {
        console.log('\n===== 运行诊断检查 =====');

        try {
            // 1. 检查表格
            const tables = document.querySelectorAll('table');
            console.log(`✓ 表格数量: ${tables.length}`);

            if (tables.length >= 2) {
                const targetTable = tables[1];
                const rows = targetTable.querySelectorAll('tbody tr');
                console.log(`✓ 第二个表格行数: ${rows.length}`);
            }

            // 2. 检查分页按钮
            const nextBtn = document.querySelector('.ecom-pagination-next');
            console.log(`✓ 分页按钮存在: ${!!nextBtn}`);

            if (nextBtn) {
                const disabled = nextBtn.getAttribute('aria-disabled');
                console.log(`  - aria-disabled: ${disabled}`);
            }

            // 3. 检查当前页码
            const pageNum = getCurrentPageNumber();
            console.log(`✓ 当前页码: ${pageNum}`);

            // 4. 尝试采集数据
            const keywords = getCurrentPageKeywords();
            console.log(`✓ 可采集关键词数: ${keywords.length}`);

            if (keywords.length > 0) {
                console.log(`  示例: "${keywords[0].keyword}"`);
            }

            console.log('===== 诊断完成 =====\n');

            // 如果没有数据，给出提示
            if (keywords.length === 0) {
                console.warn('⚠ 未能采集到数据，可能的原因:');
                console.warn('1. 页面还在加载中，请稍候再试');
                console.warn('2. 页面结构可能已更新，请联系开发者');
                console.warn('3. 请确保已登录抖店后台');
            }

        } catch (error) {
            console.error('诊断过程出错:', error);
        }
    }

    init();
})();
