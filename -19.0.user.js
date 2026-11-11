// ==UserScript==
// @name         抖店罗盘通用表格 数据采集大师
// @namespace    http://tampermonkey.net/
// @version      19.0
// @updateURL      https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/-19.0.user.js
// @downloadURL    https://raw.githubusercontent.com/amumu3792/ecommerce-collector-scripts/main/-19.0.user.js
// @description  1.【交互升级】面板和悬浮球均可自由拖拽，不再遮挡翻页。2.区间保护。3.数值归一化。4.多行拆解。
// @author       Gemini & User
// @match        *://compass.jinritemai.com/*
// @match        *://fxg.jinritemai.com/*
// @grant        GM_setClipboard
// ==/UserScript==
// 模板参考，出处：V19.0《抖店罗盘通用表格数据采集大师》：SOP §7 清洗唯一完整实现。无凭证、无飞书写入，仅本地导出；以“运维空间采集-v1.2”为准。唯一正本在 GitHub 公开仓库 amumu3792/ecommerce-collector-scripts。

(function() {
    'use strict';

    // --- 全局变量 ---
    let cacheData = [];
    let flatHeaders = [];
    let targetTable = null;
    let isPicking = false;
    let isAutoCollecting = false;

    // --- 1. UI 构建 (增加 cursor: move) ---
    const css = `
        .dd-ball { position:fixed; top:100px; right:20px; width:45px; height:45px; background:#1E80FF; color:#fff; border-radius:50%; text-align:center; line-height:45px; cursor:move; box-shadow:0 4px 15px rgba(0,0,0,0.4); z-index:99999; font-size:24px; display:none; user-select:none; }
        .dd-panel { position:fixed; top:80px; right:20px; width:340px; background:#fff; border-radius:8px; box-shadow:0 5px 30px rgba(0,0,0,0.3); z-index:99998; border:2px solid #1E80FF; font-family:"PingFang SC", sans-serif; font-size:12px; display:block; }
        .dd-head { background:#1E80FF; color:#fff; padding:10px 15px; font-weight:bold; display:flex; justify-content:space-between; align-items:center; cursor:move; user-select:none; }
        .dd-body { padding:15px; max-height:80vh; overflow-y:auto; }
        .dd-step { margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px dashed #eee; }
        .dd-btn { width:100%; padding:10px 0; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px; margin-bottom:6px; transition:0.2s; }
        .dd-btn:active { transform: scale(0.98); }
        .dd-btn:disabled { background:#eee !important; color:#999 !important; cursor:not-allowed; }
        .dd-btn-orange { background:#FF9A2E; color:#fff; }
        .dd-btn-purple { background:#722ED1; color:#fff; }
        .dd-btn-red { background:#FF4D4F; color:#fff; }
        .dd-btn-green { background:#00B42A; color:#fff; }
        .dd-btn-gray { background:#f2f3f5; color:#333; border:1px solid #ccc; }
        .dd-checkbox { display:flex; align-items:center; margin-bottom:6px; cursor:pointer; user-select:none; }
        .dd-checkbox input { margin-right:6px; }
        .dd-tag { background:#e6f7ff; color:#1890ff; padding:2px 5px; border-radius:2px; font-size:10px; margin-left:auto; }
        .dd-preview { background:#f9f9f9; padding:8px; border-radius:4px; font-family:monospace; color:#666; font-size:11px; max-height:100px; overflow-y:auto; margin-top:5px; border:1px solid #eee; }
        .dd-outline { outline: 3px solid red !important; cursor: crosshair !important; }
    `;
    const style = document.createElement('style'); style.innerHTML = css; document.head.appendChild(style);

    // 悬浮球
    const ball = document.createElement('div');
    ball.className = 'dd-ball';
    ball.innerText = '🛒';
    document.body.appendChild(ball);

    // 面板
    const panel = document.createElement('div');
    panel.className = 'dd-panel';
    panel.innerHTML = `
        <div class="dd-head" id="dd_head_drag">
            <span>💎抖店罗盘通用表格 完美采集  (可拖拽)</span>
            <span id="dd_min" style="cursor:pointer; font-size:18px; padding:0 5px;">➖</span>
        </div>
        <div class="dd-body">
            <div class="dd-step" style="background:#f0f5ff; padding:10px; border-radius:6px;">
                <div style="font-weight:bold; color:#1E80FF; margin-bottom:8px;">⚙️ 智能清洗策略</div>
                <label class="dd-checkbox">
                    <input type="checkbox" id="cfg_unit" checked> <span><b>数值归一</b> (1万->10000)</span>
                </label>
                 <div style="font-size:10px; color:#999; margin-left:20px; margin-bottom:5px;">* 自动保护 "100-200" 格式不被破坏</div>
                <label class="dd-checkbox">
                    <input type="checkbox" id="cfg_split" checked> <span><b>多行拆解</b> (一行变多列)</span>
                </label>
                <label class="dd-checkbox">
                    <input type="checkbox" id="cfg_deep" checked> <span><b>箭头补全</b> (红涨绿跌)</span>
                </label>
                <label class="dd-checkbox">
                    <input type="checkbox" id="cfg_rank" checked> <span><b>排名修正</b> (图片转数字)</span>
                </label>
            </div>

            <div class="dd-step">
                <div style="color:#999; margin-bottom:5px;">STEP 1: 锁定表格</div>
                <button id="dd_lock" class="dd-btn dd-btn-gray">🎯 锁定表格</button>
                <div id="dd_lock_info" style="display:none; color:green; margin-top:5px;">✅ 已锁定 <span id="dd_col_num">0</span> 原列</div>
            </div>

            <div class="dd-step">
                <div style="color:#d46b08; margin-bottom:5px; font-weight:bold;">STEP 2: 进货</div>
                <button id="dd_add" class="dd-btn dd-btn-orange" disabled>➕ 采集本页 (手动)</button>
                <button id="dd_auto" class="dd-btn dd-btn-purple" disabled>▶️ 自动翻页采集</button>
                <button id="dd_stop" class="dd-btn dd-btn-red" style="display:none;">🛑 停止</button>
                <div style="margin-top:8px;">购物车: <span id="dd_total" style="color:#FF9A2E; font-size:16px; font-weight:bold;">0</span> 条 <a id="dd_clear" style="float:right; cursor:pointer; color:#999;">清空</a></div>
                <div id="dd_preview" class="dd-preview" style="display:none;"></div>
            </div>

            <div>
                <button id="dd_export" class="dd-btn dd-btn-green" disabled>📦 导出 CSV</button>
            </div>
            <div id="dd_msg" style="text-align:center; color:red; margin-top:10px; min-height:18px;"></div>
        </div>
    `;
    document.body.appendChild(panel);

    // --- 2. 交互绑定 ---
    const ui = {
        min: document.getElementById('dd_min'),
        head: document.getElementById('dd_head_drag'), // 拖拽手柄
        lock: document.getElementById('dd_lock'), lockInfo: document.getElementById('dd_lock_info'), colNum: document.getElementById('dd_col_num'),
        add: document.getElementById('dd_add'), auto: document.getElementById('dd_auto'), stop: document.getElementById('dd_stop'),
        total: document.getElementById('dd_total'), clear: document.getElementById('dd_clear'), preview: document.getElementById('dd_preview'),
        export: document.getElementById('dd_export'),
        // 配置
        cfgUnit: document.getElementById('cfg_unit'),
        cfgSplit: document.getElementById('cfg_split'),
        cfgDeep: document.getElementById('cfg_deep'),
        cfgRank: document.getElementById('cfg_rank'),
        msg: (t,c='red') => { const m=document.getElementById('dd_msg'); m.innerText=t; m.style.color=c; setTimeout(()=>m.innerText='',3000); }
    };

    ui.min.onclick = () => { panel.style.display='none'; ball.style.display='block'; };
    ball.onclick = () => { ball.style.display='none'; panel.style.display='block'; };

    // --- 🔥 核心：实现拖拽功能 (Make Draggable) 🔥 ---
    function makeDraggable(element, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            // 记录初始鼠标位置
            startX = e.clientX;
            startY = e.clientY;
            // 记录元素当前位置 (需处理 right 定位的情况)
            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            // 移除 right 定位，改为 left 定位，防止冲突
            element.style.right = 'auto';
            element.style.left = `${initialLeft}px`;
            element.style.top = `${initialTop}px`;

            handle.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none'; // 防止拖拽时选中文字
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            element.style.left = `${initialLeft + dx}px`;
            element.style.top = `${initialTop + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'move';
                document.body.style.userSelect = '';
            }
        });
    }

    // 启用拖拽
    makeDraggable(panel, ui.head); // 拖面板标题栏
    makeDraggable(ball, ball);     // 拖悬浮球本身

    // --- 锁定逻辑 ---
    let pickMode = '';
    ui.lock.onclick = () => { isPicking = true; pickMode = 'table'; ui.lock.innerText = '🖱️ 请点击表格...'; document.body.addEventListener('click', picker, true); document.body.addEventListener('mouseover', highlighter); };
    function highlighter(e) { if(!isPicking) return; e.stopPropagation(); let t = e.target.closest('table'); if(t) t.classList.add('dd-outline'); }
    function picker(e) {
        if(!isPicking) return; e.stopPropagation(); e.preventDefault();
        document.querySelectorAll('.dd-outline').forEach(e=>e.classList.remove('dd-outline'));
        let t = e.target.closest('table') || e.target.closest('.arco-table-container') || e.target.closest('.el-table');
        if(t) { targetTable = t; lockSuccess(); }
        isPicking = false; ui.lock.innerText = '🎯 重新锁定'; document.body.removeEventListener('click', picker, true); document.body.removeEventListener('mouseover', highlighter);
    }
    function lockSuccess() {
        let tr = targetTable.querySelector('tbody tr');
        let len = tr ? tr.querySelectorAll('td').length : 0;
        ui.lockInfo.style.display = 'block'; ui.colNum.innerText = len;
        ui.add.disabled = false; ui.auto.disabled = false; ui.msg('锁定成功', 'green');
    }

    // --- 采集主逻辑 ---
    async function doCollect() {
        if(!targetTable) return 0;
        await autoScroll(targetTable);

        const config = {
            unitConvert: ui.cfgUnit.checked,
            splitMode: ui.cfgSplit.checked,
            deepMining: ui.cfgDeep.checked,
            rankFix: ui.cfgRank.checked
        };

        let rawComplexRows = extractComplexData(targetTable, config);
        if(!rawComplexRows || rawComplexRows.length === 0) return 0;

        if (cacheData.length === 0) {
            let baseHeaders = findBaseHeaders(targetTable);
            if (config.splitMode) {
                flatHeaders = generateFlatHeaders(baseHeaders, rawComplexRows);
            } else {
                flatHeaders = baseHeaders;
            }
        }

        let newFlatRows = rawComplexRows.map(row => flattenRow(row, flatHeaders, config));

        let added = 0;
        newFlatRows.forEach(row => {
            let key = row.join('||');
            if(!cacheData.some(r => r.join('||') === key)) { cacheData.push(row); added++; }
        });

        ui.total.innerText = cacheData.length;
        ui.export.disabled = false;
        if(added > 0) {
            ui.preview.style.display = 'block';
            ui.preview.innerHTML = `本次+${added}条 | 模式: ${config.splitMode?'拆解':'合并'}`;
        }
        return added;
    }

    // --- 提取逻辑 ---
    function extractComplexData(table, config) {
        let rows = Array.from(table.querySelectorAll('tbody tr, .arco-table-body tr.arco-table-row'));
        let complexRows = [];

        rows.forEach((tr, rowIndex) => {
            let tds = Array.from(tr.querySelectorAll('td'));
            if(tds.length === 0) return;

            let rowData = tds.map((td, colIndex) => {
                if (config.rankFix) {
                    let img = td.querySelector('img');
                    if (colIndex === 0 && img && !td.innerText.trim()) return [(rowIndex + 1).toString()];
                }

                let clone = td.cloneNode(true);
                if (config.deepMining) {
                    let allNodes = clone.querySelectorAll('*');
                    allNodes.forEach(node => {
                        let clues = [node.className.toString().toLowerCase(), node.getAttribute('aria-label')||''];
                        let style = window.getComputedStyle(node);
                        if (clues.some(c => c.includes('up')||c.includes('rise'))) node.prepend(' ↑ ');
                        else if (clues.some(c => c.includes('down')||c.includes('fall'))) node.prepend(' ↓ ');
                        else if (isRed(style.color) && !node.innerText.match(/[↑↓]/)) {
                            if(node.tagName==='SVG'||node.tagName==='I'||node.tagName==='SPAN') node.after(' ↑ ');
                        }
                        else if (isGreen(style.color) && !node.innerText.match(/[↑↓]/)) {
                            if(node.tagName==='SVG'||node.tagName==='I'||node.tagName==='SPAN') node.after(' ↓ ');
                        }
                    });
                }

                clone.querySelectorAll('img').forEach(img => {
                    if(img.src && !img.src.startsWith('data:')) img.replaceWith(` [图]${img.src} `);
                    else img.remove();
                });

                clone.querySelectorAll('div, p, br').forEach(el => el.after('\n'));
                let text = clone.innerText;
                let parts = text.split('\n').map(t => t.trim()).filter(t => t);
                return parts.length > 0 ? parts : [''];
            });

            if(rowData.some(cell => cell.length > 0 && cell[0] !== '')) complexRows.push(rowData);
        });

        return complexRows;
    }

    function flattenRow(complexRow, headers, config) {
        let flat = [];
        if (config.splitMode) {
            let depths = window._dd_depths || [];
            complexRow.forEach((cellData, i) => {
                let d = depths[i] || 1;
                for(let k=0; k<d; k++) {
                    flat.push(clean(cellData[k] || '', config));
                }
            });
        } else {
            complexRow.forEach(cellData => {
                flat.push(clean(cellData.join(' '), config));
            });
        }
        return flat;
    }

    // --- 数据清洗 ---
    function clean(v, config) {
        if(!v) return '';
        if(v.includes('[图]')) return v;

        let val = v;
        val = val.replace(/[¥￥,]/g, '').trim();

        if (!config.unitConvert) return val;

        let isRange = /^[\d\.]+[万wW亿]?\s*-\s*[\d\.]+[万wW亿]?$/.test(val);
        if (isRange) return val;

        let cleanVal = val.replace(/[+>]/g, '');
        if (cleanVal.includes('万') || cleanVal.toLowerCase().includes('w')) {
            let num = parseFloat(cleanVal.replace(/万|w/i, ''));
            if (!isNaN(num)) val = (num * 10000).toString();
        } else if (cleanVal.includes('亿')) {
            let num = parseFloat(cleanVal.replace('亿', ''));
            if (!isNaN(num)) val = (num * 100000000).toString();
        }

        return val;
    }

    function generateFlatHeaders(baseHeaders, sampleRows) {
        let colDepths = new Array(baseHeaders.length).fill(1);
        sampleRows.forEach(row => {
            row.forEach((cellData, colIndex) => {
                if (colIndex < colDepths.length && cellData.length > colDepths[colIndex]) {
                    colDepths[colIndex] = cellData.length;
                }
            });
        });
        window._dd_depths = colDepths;
        let newHeaders = [];
        baseHeaders.forEach((h, i) => {
            let d = colDepths[i] || 1;
            if(d === 1) newHeaders.push(h);
            else {
                newHeaders.push(h);
                for(let k=1; k<d; k++) newHeaders.push(h + `_${k}`);
            }
        });
        return newHeaders;
    }

    function findBaseHeaders(t) {
        let th = Array.from(t.querySelectorAll('thead th'));
        if(th.length) return th.map(t=>t.innerText.replace(/\n/g,'').trim());
        let tr = t.querySelector('tr');
        return tr ? Array.from(tr.querySelectorAll('td,th')).map(t=>t.innerText.replace(/\n/g,'').trim()) : [];
    }
    function isRed(c) { let m=c.match(/\d+/g); return m && parseInt(m[0]) > parseInt(m[1])+50; }
    function isGreen(c) { let m=c.match(/\d+/g); return m && parseInt(m[1]) > parseInt(m[0])+20; }
    async function autoScroll(el) {
        let c = el.querySelector('.arco-table-body') || el.parentElement;
        if(c) { c.scrollTop = c.scrollHeight; await new Promise(r=>setTimeout(r,500)); c.scrollTop = 0; await new Promise(r=>setTimeout(r,200)); }
    }

    ui.add.onclick = async () => { ui.add.innerText = '⏳ 采集中...'; let n = await doCollect(); ui.add.innerText = '➕ 采集本页 (手动)'; n>0?ui.msg(`采集 ${n} 条`,'green'):ui.msg('无新数据','#FF9A2E'); };
    ui.auto.onclick = async () => {
        if(isAutoCollecting) return; isAutoCollecting = true;
        ui.auto.style.display = 'none'; ui.stop.style.display = 'block';
        ui.lock.disabled=true; ui.add.disabled=true; ui.export.disabled=true;
        ui.msg('🚀 自动运行中...', 'purple');
        while(isAutoCollecting) {
            await doCollect();
            let nextBtn = document.querySelector('.arco-pagination-next') || document.querySelector('.btn-next');
            if (!nextBtn || nextBtn.classList.contains('arco-pagination-disabled') || nextBtn.disabled) { ui.msg('✅ 完成', 'green'); break; }
            nextBtn.click(); await new Promise(r => setTimeout(r, 3000));
        }
        isAutoCollecting = false; ui.auto.style.display = 'block'; ui.stop.style.display = 'none'; ui.lock.disabled=false; ui.add.disabled=false; ui.export.disabled=false;
    };
    ui.stop.onclick = () => { isAutoCollecting = false; ui.msg('🛑 已停止', 'red'); };
    ui.clear.onclick = () => { cacheData=[]; ui.total.innerText='0'; ui.preview.style.display='none'; ui.export.disabled=true; ui.msg('已清空'); };
    ui.export.onclick = () => {
        if(cacheData.length === 0) return;
        let txt = flatHeaders.join('\t') + '\n' + cacheData.map(r=>r.join('\t')).join('\n');
        GM_setClipboard(txt);
        const blob = new Blob(['\uFEFF' + flatHeaders.join(',') + '\n' + cacheData.map(r=>r.map(c=>`"${c.replace(/"/g,'""')}"`).join(',')).join('\n')], {type:'text/csv;charset=utf-8'});
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `抖店罗盘-通用表格数据_${Date.now()}.csv`; link.click();
        ui.msg('✅ 下载成功', 'green');
    };
})();