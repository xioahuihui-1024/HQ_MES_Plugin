(function () {
    // 0. 全局防抖检查
    if (window._mesInitialized) return;
    window._mesInitialized = true;

    'use strict';

    // ==========================================
    // 模块定义区
    // ==========================================

    // --- 1. 工具模块 (Utils) ---
    const Utils = {
        // 安全等待 DOM 加载
        waitDOM: function (callback) {
            if (document.body && document.readyState !== 'loading') {
                callback();
            } else {
                document.addEventListener('DOMContentLoaded', callback);
            }
        },
        // 复制到剪贴板
        copyText: function (text, onSuccess) {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(onSuccess);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    if (document.execCommand('copy')) onSuccess();
                } catch (e) {
                }
                document.body.removeChild(textArea);
            }
        },
        // HTML 转义
        escapeHtml: function (unsafe) {
            return (unsafe || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        },
        // 时间格式化
        formatTimestamp: function (raw, formatStr) {
            if (!/^20\d{12}$/.test(raw)) return raw; // 简单的格式校验
            const Y = raw.slice(0, 4), M = raw.slice(4, 6), D = raw.slice(6, 8);
            const H = raw.slice(8, 10), m = raw.slice(10, 12), s = raw.slice(12, 14);
            return formatStr
                .replace(/YYYY/g, Y).replace(/YY/g, Y.slice(2))
                .replace(/MM/g, M).replace(/DD/g, D)
                .replace(/HH/g, H).replace(/mm/g, m).replace(/ss/g, s)
                .replace(/M(?!M)/g, parseInt(M)).replace(/D(?!D)/g, parseInt(D));
        }
    };

    // --- 2. 核心业务模块 (Auth & Request) ---
    const AuthModule = {
        isHandling: false,

        checkDomExpiry: function () {
            Utils.waitDOM(() => {
                const text = document.body.innerText;
                const html = document.body.innerHTML;
                if (text.includes("没有用户状态") && (html.includes("Login.aspx") || html.includes("window.parent.location"))) {
                    console.warn('🛑 [Auth] 页面加载了服务端过期提示');
                    this.handleExpired(null);
                }
            });
        },

        // 处理 Session 过期
        handleExpired: async function (requestPayload = null) {
            // [关键] 严格校验 payload，防止 boolean true 混入
            if (requestPayload && typeof requestPayload === 'object') {
                console.log('💾 [Auth] 捕获并保存请求数据:', requestPayload);
                sessionStorage.setItem('MES_REPLAY_DATA', JSON.stringify(requestPayload));
            } else if (requestPayload === true) {
                console.warn('⚠️ [Auth] 接收到无效的数据 true，忽略保存');
            }

            if (this.isHandling) return;
            this.isHandling = true;

            const cfg = await ConfigModule.load();
            if (!cfg.keepAliveEnabled) {
                this.isHandling = false;
                return;
            }

            const storage = await new Promise(r => chrome.storage.local.get(['mes_manual_logout'], r));
            if (storage.mes_manual_logout) {
                this.isHandling = false;
                return;
            }

            console.log('🔄 [Auth] 执行无感刷新...');
            UIModule.showOverlay("会话过期，正在自动续期...", false);

            if (cfg.username && cfg.password) {
                chrome.runtime.sendMessage({
                    action: "DO_LOGIN",
                    data: {username: cfg.username, password: cfg.password}
                }, (response) => {
                    this.isHandling = false;
                    if (response && response.success) {
                        console.log('✅ [Auth] 续期成功');
                        chrome.storage.local.remove('mes_manual_logout');
                        setTimeout(() => location.reload(), 500);
                    } else {
                        UIModule.showOverlay("❌ 续期失败，请检查密码", true);
                    }
                });
            } else {
                this.isHandling = false;
                UIModule.showOverlay("❌ 未配置账号密码", true);
            }
        },

        // 检查自动重试 重放
        checkAutoRetry: function () {
            const replayDataStr = sessionStorage.getItem('MES_REPLAY_DATA');

            if (replayDataStr) {
                sessionStorage.removeItem('MES_REPLAY_DATA'); // 清除标记
                try {
                    const replayData = JSON.parse(replayDataStr);
                    // 双重校验
                    if (!replayData || !replayData.url) return;

                    console.log('🚀 [Auth] 检测到重试数据，发送重发指令:', replayData);

                    // 延迟 1.5 秒，确保 inject.js 和 jQuery 彻底就绪
                    setTimeout(() => {
                        // 1. 发送指令让 inject.js 重发 AJAX
                        window.postMessage({
                            type: 'MES_DO_REPLAY',
                            payload: replayData
                        }, '*');

                        // 2. 显示优化后的提示条
                        Utils.waitDOM(() => {
                            const bar = document.createElement('div');
                            // 使用 Flex 布局，左边图标，中间文字，右边关闭按钮
                            bar.innerHTML = `
                                <div style="display:flex;align-items:center;justify-content:center; max-width: 800px; margin: 0 auto;">
                                    <span style="font-size:24px;margin-right:12px;">✅</span>
                                    <div style="text-align:left; flex:1;">
                                        <div style="font-weight:bold; font-size:15px; margin-bottom:2px;">已自动重放查询请求，表格数据已恢复！</div>
                                        <div style="font-size:13px; color:#5a7b38;">⚠️ 注意：此结果基于您上次的请求重放，<b style="text-decoration:underline;">上方的查询条件框可能已重置</b>，请勿混淆。</div>
                                    </div>
                                    <span style="margin-left:20px; cursor:pointer; opacity:0.8; font-weight:bold; border:1px solid #8cad76; padding:4px 12px; border-radius:4px; background:white; font-size:12px;" onclick="this.parentElement.parentElement.remove()">知道了</span>
                                </div>
                            `;

                            // 样式调整：稍微加高一点，背景色更柔和
                            bar.style.cssText = `
                                position: fixed; 
                                top: 0; 
                                left: 0; 
                                width: 100%; 
                                background: #dff0d8; 
                                color: #3c763d; 
                                border-bottom: 1px solid #d6e9c6; 
                                padding: 10px 20px; 
                                z-index: 9999999; 
                                font-family: "Segoe UI", "Microsoft YaHei", sans-serif; 
                                box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
                                animation: slideDown 0.5s ease-out;
                            `;

                            // 注入动画 (防止重复)
                            if (!document.getElementById('mes-anim-style')) {
                                const style = document.createElement('style');
                                style.id = 'mes-anim-style';
                                style.innerHTML = `@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`;
                                document.head.appendChild(style);
                            }

                            document.body.appendChild(bar);

                            // 延长到 8 秒后自动消失，让用户看清楚
                            setTimeout(() => {
                                if (bar.parentElement) bar.remove();
                            }, 8000);
                        });
                    }, 1500);
                } catch (e) {
                    console.error('重试数据解析失败', e);
                }
            }
        },
        bindLogout: function () {
            if (!location.pathname.toLowerCase().includes('top.aspx')) return;
            Utils.waitDOM(() => {
                const exitLinks = document.querySelectorAll('a[href*="Login.aspx"]');
                exitLinks.forEach(link => {
                    if (link.dataset.mesLogoutBound) return;
                    if (link.innerText.includes("退出")) {
                        link.dataset.mesLogoutBound = "true";
                        link.addEventListener('click', () => {
                            chrome.runtime.sendMessage({action: "MANUAL_LOGOUT"});
                        });
                    }
                });
            });
        }
    };

    // --- 3. 界面增强模块 (UI) ---
    const UIModule = {
        config: {},

        init: function (cfg) {
            this.config = cfg;
            this.injectStyles();

            // 模块独立初始化
            this.SmartTooltip.init();

            // 只有开启了高级管理器才初始化 TableManager
            if (this.config.tableManagerEnabled) {
                this.TableManager.init(this);
            }

            Utils.waitDOM(() => {
                this.setupModalContainer();
            });
        },

        injectStyles: function () {
            Utils.waitDOM(() => {
                let style = document.getElementById('mes-dynamic-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'mes-dynamic-style';
                    document.head.appendChild(style);
                }
                const cfg = this.config;

                // 1. 固定表头样式 (独立控制)
                const stickyCss = cfg.stickyHeaderEnabled ? `
                    #tbDetail #trfirst td, 
                    #tbDetail .tdContextColumn td,
                    #tbDetail th { 
                        position: sticky !important; 
                        top: 0 !important; 
                        z-index: 20 !important; /* 提高层级 */
                        background-color: #f5f5f5 !important; 
                        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    }
                ` : '';

                // 2. 高级管理器样式 (只有开启才注入，避免干扰)
                const managerCss = cfg.tableManagerEnabled ? `
                    /* 调整手柄 */
                    .mes-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: col-resize; z-index: 10; }
                    .mes-resize-handle:hover, .mes-resize-active { background: #0078d7; }
                    
                    /* 设置按钮 */
                    #mes-col-settings-btn {
                        float: right; margin-right: 10px; cursor: pointer; padding: 4px 10px;
                        border: 1px solid #ccc; background: #fff; border-radius: 4px;
                        color: #555; font-size: 12px; display: flex; align-items: center; gap: 5px;
                        position: relative; transition: all 0.2s;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    }
                    #mes-col-settings-btn:hover { background: #f8f8f8; border-color: #999; }
                    
                    /* [新功能] 按钮激活状态 (表示有自定义配置) */
                    #mes-col-settings-btn.is-active {
                        background-color: #e6f7ff; border-color: #1890ff; color: #0078d7; font-weight: bold;
                    }
                    #mes-col-settings-btn.is-active::after {
                        content: ''; position: absolute; top: -3px; right: -3px; width: 8px; height: 8px;
                        background: #ff4d4f; border-radius: 50%; border: 1px solid #fff;
                    }

                    /* [优化] 菜单样式：向下弹出，向左对齐 */
                    #mes-col-settings-menu {
                        position: absolute;
                        top: 100%; /* 向下弹出 */
                        right: 0;     /* 向左对齐 */
                        margin-bottom: 8px; 
                        background: white; border: 1px solid #ddd; 
                        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                        padding: 0; border-radius: 4px; z-index: 999999;
                        min-width: 280px; max-height: 500px; overflow-y: auto;
                        display: none; font-family: "Segoe UI", sans-serif;
                    }
                    
                    .mes-menu-header { padding: 10px; border-bottom: 1px solid #eee; background: #f9f9f9; font-weight: bold; color: #333; display: flex; justify-content: space-between; align-items: center; }
                    
                    .mes-col-item { display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid #f0f0f0; background: #fff; transition: background 0.2s; }
                    .mes-col-item:hover { background: #e6f7ff; }
                    .mes-col-item.dragging { opacity: 0.5; background: #eee; }
                    
                    .mes-col-drag-handle { cursor: move; color: #999; margin-right: 8px; font-size: 14px; }
                    .mes-col-checkbox { cursor: pointer; margin-right: 8px; }
                    .mes-col-label { flex: 1; font-size: 13px; color: #333; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;}
                    
                    /* [新功能] 排序与筛选 UI */
                    .mes-col-actions { display: flex; gap: 4px; margin-left: 8px; }
                    .mes-action-btn { cursor: pointer; padding: 2px; color: #999; border-radius: 2px; font-size: 12px; }
                    .mes-action-btn:hover { background: #ddd; color: #333; }
                    .mes-filter-input { width: 60px; border: 1px solid #ddd; border-radius: 2px; padding: 1px 4px; font-size: 11px; transition: width 0.2s; }
                    .mes-filter-input:focus { width: 100px; border-color: #1890ff; outline: none; }
                ` : '';

                style.textContent = `
                    /* === 基础高亮 === */
                    .mes-highlight { background-color: ${cfg.highlightBackground || '#eef'} !important; color: ${cfg.highlightColor} !important; border: 1px solid ${cfg.highlightColor}; border-radius: 4px; padding: 2px 5px !important; }
                    
                    /* === 表格样式 === */
                    #tbDetail table { 
                        /* 启用管理器时必须 fixed，否则 auto；如果未启用管理器但要截断，也建议 fixed */
                        table-layout: ${cfg.tableManagerEnabled ? 'fixed' : 'auto'}; 
                        width: 100%; border-collapse: collapse;
                    }
                    
                    #tbDetail th, #tbDetail td {
                        border: 1px solid #ccc;
                        padding: 4px 5px;
                        position: relative;
                    }

                    /* === 融合模式：单行截断 === */
                    .mes-table-cell-fix { 
                        white-space: nowrap !important; 
                        overflow: hidden; 
                        text-overflow: ellipsis;
                        display: block; 
                        width: 100%;
                        box-sizing: border-box;
                    }

                    .mes-truncated-cell { cursor: pointer; }
                    .mes-truncated-cell:hover { background-color: rgba(0, 120, 215, 0.1); }
                    .mes-col-hidden { display: none !important; }

                    /* === 注入动态生成的 CSS === */
                    ${stickyCss}
                    ${managerCss}

                    /* Tooltip 样式 */
                    #mes-smart-tooltip {
                        position: fixed; z-index: 100000; background: rgba(0, 0, 0, 0.85); color: #fff;
                        padding: 8px 12px; border-radius: 4px; font-size: 12px; line-height: 1.5;
                        max-width: 400px; word-wrap: break-word; pointer-events: none;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transition: opacity 0.15s;
                    }
                    #mes-smart-tooltip::after { content: ''; position: absolute; border-width: 5px; border-style: solid; }
                    #mes-smart-tooltip.is-top::after { bottom: -10px; left: 50%; transform: translateX(-50%); border-color: rgba(0,0,0,0.85) transparent transparent transparent; }
                    #mes-smart-tooltip.is-bottom::after { top: -10px; left: 50%; transform: translateX(-50%); border-color: transparent transparent rgba(0,0,0,0.85) transparent; }

                    #tbDetail { ${cfg.tbFixEnabled ? `min-height: ${cfg.tbMinHeight}px !important; height: auto !important;` : ''} }
                `;
            });
        },

        // --- 智能 Tooltip ---
        SmartTooltip: {
            el: null, timer: null,
            init: function () {
                Utils.waitDOM(() => {
                    if (!document.getElementById('mes-smart-tooltip')) {
                        this.el = document.createElement('div');
                        this.el.id = 'mes-smart-tooltip';
                        document.body.appendChild(this.el);
                    } else {
                        this.el = document.getElementById('mes-smart-tooltip');
                    }
                });
            },
            show: function (target, content) {
                if (!this.el) return;
                clearTimeout(this.timer);
                this.el.textContent = content;
                this.el.style.opacity = '1';
                const rect = target.getBoundingClientRect();
                const tooltipRect = this.el.getBoundingClientRect();
                const gap = 8;
                let top = rect.bottom + gap;
                let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                let placement = 'bottom';
                if (top + tooltipRect.height > window.innerHeight) {
                    top = rect.top - tooltipRect.height - gap;
                    placement = 'top';
                }
                if (left < 10) left = 10;
                else if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10;
                this.el.style.top = top + 'px';
                this.el.style.left = left + 'px';
                this.el.className = 'is-' + placement;
            },
            hide: function () {
                if (!this.el) return;
                this.timer = setTimeout(() => {
                    this.el.style.opacity = '0';
                }, 100);
            }
        },

        // --- 表格管理器 (高级功能) ---
        TableManager: {
            settings: {}, parentUI: null, dragSrcEl: null,

            init: function (parent) {
                this.parentUI = parent;
                const saved = localStorage.getItem('MES_TABLE_SETTINGS');
                if (saved) {
                    try {
                        this.settings = JSON.parse(saved);
                    } catch (e) {
                    }
                }
            },

            // 检查当前页面是否有自定义设置
            hasUserConfig: function (pageKey) {
                const config = this.settings[pageKey];
                if (!config) return false;
                // 只要有隐藏列、或者宽度的设定、或者排序设定，就算有配置
                return (config.hidden && config.hidden.length > 0) ||
                    (config.widths && Object.keys(config.widths).length > 0) ||
                    (config.order && config.order.length > 0);
            },

            process: function () {
                const tb = document.getElementById('tbDetail');
                if (!tb) return;
                const table = tb.querySelector('table');
                if (!table) return;

                if (table.dataset.mesEnhanced === 'true') return;
                table.dataset.mesEnhanced = 'true';

                const pageKey = location.pathname + location.search;

                // 1. 只有开启了管理器且没有保存宽度时，才自动计算初始宽度
                if (!this.settings[pageKey] || !this.settings[pageKey].widths) {
                    this.calculateAutoWidths(table, pageKey);
                }

                // 2. 应用设置
                this.applyColumnSettings(table, pageKey);

                // 3. 注入功能
                this.injectResizeHandles(table, pageKey);
                this.injectSettingsButton(pageKey, table);

                // 4. 更新单元格交互（截断/Tooltip）
                this.applyCellInteractions(table);
            },

            calculateAutoWidths: function (table, pageKey) {
                table.style.tableLayout = 'auto';
                const headers = Array.from(table.rows[0].cells);
                const widths = {};
                const MAX_WIDTH = 300;
                const MIN_WIDTH = 50;
                headers.forEach(th => {
                    let w = th.offsetWidth;
                    if (w > MAX_WIDTH) w = MAX_WIDTH;
                    if (w < MIN_WIDTH) w = MIN_WIDTH;
                    widths[th.innerText.trim()] = w;
                });
                this.getOrCreateConfig(pageKey).widths = widths;
                this.persist();
                table.style.tableLayout = 'fixed';
            },

            applyColumnSettings: function (table, pageKey) {
                const config = this.settings[pageKey];
                if (!config) return;

                const rows = Array.from(table.rows);
                const headerRow = rows[0];
                const headerMap = {};
                Array.from(headerRow.cells).forEach((cell, idx) => {
                    headerMap[cell.innerText.trim()] = idx;
                });

                const savedOrder = config.order || [];
                const currentHeaders = Object.keys(headerMap);
                const finalOrder = [...new Set([...savedOrder, ...currentHeaders])];

                rows.forEach(row => {
                    const cells = Array.from(row.cells);
                    const fragment = document.createDocumentFragment();
                    finalOrder.forEach(colName => {
                        const idx = headerMap[colName];
                        if (idx !== undefined && cells[idx]) {
                            const cell = cells[idx];
                            if (config.hidden && config.hidden.includes(colName)) cell.classList.add('mes-col-hidden');
                            else cell.classList.remove('mes-col-hidden');

                            if (row === headerRow && config.widths && config.widths[colName]) {
                                cell.style.width = config.widths[colName] + 'px';
                            }
                            fragment.appendChild(cell);
                        }
                    });
                    row.innerHTML = '';
                    row.appendChild(fragment);
                });
            },

            applyCellInteractions: function (table) {
                const config = this.parentUI.config;
                const truncateLen = config.tbTruncateThreshold || 30;
                let dateCols = [];
                const headerRow = table.rows[0];

                // 重新获取当前表头顺序对应的索引（因为可能重排了）
                Array.from(headerRow.cells).forEach((th, idx) => {
                    const txt = th.innerText.toLowerCase();
                    if (txt.includes('time') || txt.includes('date')) dateCols.push(idx);
                });

                Array.from(table.rows).forEach((row, rIdx) => {
                    if (rIdx === 0) return;
                    Array.from(row.cells).forEach((cell, cIdx) => {
                        let text = cell.innerText.trim();
                        cell.innerHTML = `<div class="mes-table-cell-fix">${Utils.escapeHtml(text)}</div>`;
                        const div = cell.firstChild;

                        if (config.dateFormatEnabled) {
                            const isTime = /^20\d{12}$/.test(text);
                            if (isTime || (dateCols.includes(cIdx) && isTime)) {
                                text = Utils.formatTimestamp(text, config.dateFormatString);
                                div.innerText = text;
                                div.classList.add('mes-date-cell');
                            }
                        }

                        if (text.length > truncateLen) {
                            div.classList.add('mes-truncated-cell');
                            cell.addEventListener('mouseenter', (e) => this.parentUI.SmartTooltip.show(e.target, text));
                            cell.addEventListener('mouseleave', () => this.parentUI.SmartTooltip.hide());
                            cell.addEventListener('click', (e) => {
                                e.stopPropagation();
                                this.parentUI.SmartTooltip.hide();
                                this.parentUI.showDetailModal(text);
                            });
                        }
                    });
                });
            },

            injectSettingsButton: function (pageKey, table) {
                const pageDiv = document.getElementById('divpage');
                if (!pageDiv || document.getElementById('mes-col-settings-btn')) return;

                const btn = document.createElement('div');
                btn.id = 'mes-col-settings-btn';
                btn.innerHTML = `<span>🛠️</span> 列设置`;

                // [新功能] 检查状态，如果用户改过设置，高亮按钮
                if (this.hasUserConfig(pageKey)) {
                    btn.classList.add('is-active');
                    btn.title = "当前应用了自定义列设置";
                }

                const wrapper = document.createElement('div');
                wrapper.style.cssText = "float:right; position:relative; display:inline-block;";
                wrapper.appendChild(btn);

                const menu = document.createElement('div');
                menu.id = 'mes-col-settings-menu';
                wrapper.appendChild(menu);

                pageDiv.insertBefore(wrapper, pageDiv.firstChild);

                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.renderMenuContent(menu, pageKey, table);
                    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                };
                document.addEventListener('click', (e) => {
                    if (!wrapper.contains(e.target)) menu.style.display = 'none';
                });
            },

            renderMenuContent: function (menu, pageKey, table) {
                menu.innerHTML = `<div class="mes-menu-header"><span>表格视图设置</span><span style="font-size:12px;font-weight:normal;color:#999">拖拽排序 / 勾选显示</span></div>`;

                const list = document.createElement('div');
                const headerCells = Array.from(table.rows[0].cells);
                const currentOrder = headerCells.map(c => c.innerText.trim());

                currentOrder.forEach((colName, idx) => {
                    const item = document.createElement('div');
                    item.className = 'mes-col-item';
                    item.draggable = true;
                    item.dataset.colName = colName;

                    const cell = headerCells[idx];
                    const isHidden = cell.classList.contains('mes-col-hidden');

                    item.innerHTML = `
                        <span class="mes-col-drag-handle">☰</span>
                        <input type="checkbox" class="mes-col-checkbox" ${!isHidden ? 'checked' : ''}>
                        <span class="mes-col-label" title="${colName}">${colName}</span>
                        <div class="mes-col-actions">
                            <span class="mes-action-btn sort-asc" title="当前页升序">⬆️</span>
                            <span class="mes-action-btn sort-desc" title="当前页降序">⬇️</span>
                            <input type="text" class="mes-filter-input" placeholder="筛选..." title="当前页筛选">
                        </div>
                    `;

                    // 显隐事件
                    item.querySelector('input').addEventListener('change', (e) => {
                        this.toggleColumnVisibility(table, colName, !e.target.checked, pageKey);
                        this.updateBtnState(pageKey);
                    });

                    // 排序事件 (Client Side Demo)
                    item.querySelector('.sort-asc').onclick = () => this.sortColumn(table, idx, true);
                    item.querySelector('.sort-desc').onclick = () => this.sortColumn(table, idx, false);

                    // 筛选事件 (Client Side Demo)
                    const filterInput = item.querySelector('.mes-filter-input');
                    filterInput.addEventListener('click', e => e.stopPropagation()); // 防止拖拽
                    filterInput.addEventListener('input', (e) => {
                        this.filterColumn(table, idx, e.target.value);
                    });

                    this.bindDragEvents(item, list, table, pageKey);
                    list.appendChild(item);
                });
                menu.appendChild(list);

                const footer = document.createElement('div');
                footer.style.padding = '8px 10px';
                footer.style.borderTop = '1px solid #eee';
                footer.style.textAlign = 'right';
                footer.innerHTML = '<a href="javascript:;" style="color:#d93025;font-size:12px;text-decoration:none;">↺ 重置所有设置</a>';
                footer.onclick = () => {
                    if (confirm('恢复默认列宽和顺序？')) {
                        delete this.settings[pageKey];
                        this.persist();
                        location.reload();
                    }
                };
                menu.appendChild(footer);
            },

            // 简单的客户端排序 (功能预留)
            sortColumn: function (table, colIdx, asc) {
                const tbody = table.tBodies[0] || table;
                const rows = Array.from(tbody.querySelectorAll('tr:not(#trfirst)')); // 排除表头

                rows.sort((a, b) => {
                    const txtA = a.cells[colIdx].innerText.trim();
                    const txtB = b.cells[colIdx].innerText.trim();
                    return asc ? txtA.localeCompare(txtB) : txtB.localeCompare(txtA);
                });

                rows.forEach(row => tbody.appendChild(row));
            },

            // 简单的客户端筛选 (功能预留)
            filterColumn: function (table, colIdx, text) {
                const rows = Array.from(table.querySelectorAll('tr:not(#trfirst)'));
                const lowerText = text.toLowerCase();

                rows.forEach(row => {
                    const cellText = row.cells[colIdx].innerText.toLowerCase();
                    if (cellText.includes(lowerText)) {
                        row.style.display = '';
                    } else {
                        row.style.display = 'none';
                    }
                });
            },

            updateBtnState: function (pageKey) {
                const btn = document.getElementById('mes-col-settings-btn');
                if (this.hasUserConfig(pageKey)) btn.classList.add('is-active');
                else btn.classList.remove('is-active');
            },

            bindDragEvents: function (item, list, table, pageKey) {
                item.addEventListener('dragstart', (e) => {
                    this.dragSrcEl = item;
                    e.dataTransfer.effectAllowed = 'move';
                    item.classList.add('dragging');
                });
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    return false;
                });
                item.addEventListener('dragenter', (e) => {
                    if (this.dragSrcEl !== item) item.style.borderTop = '2px solid #0078d7';
                });
                item.addEventListener('dragleave', () => {
                    item.style.borderTop = '';
                });
                item.addEventListener('drop', (e) => {
                    e.stopPropagation();
                    item.style.borderTop = '';
                    if (this.dragSrcEl !== item) {
                        const allItems = Array.from(list.querySelectorAll('.mes-col-item'));
                        const srcIdx = allItems.indexOf(this.dragSrcEl);
                        const tgtIdx = allItems.indexOf(item);
                        if (srcIdx < tgtIdx) list.insertBefore(this.dragSrcEl, item.nextSibling);
                        else list.insertBefore(this.dragSrcEl, item);
                        this.saveOrderFromMenu(list, pageKey);
                        this.applyColumnSettings(table, pageKey);
                        this.updateBtnState(pageKey);
                    }
                    return false;
                });
                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    list.querySelectorAll('.mes-col-item').forEach(i => i.style.borderTop = '');
                });
            },

            // ... injectResizeHandles, bindResizeEvent, toggleColumnVisibility, getOrCreateConfig, saveWidth, saveHidden, saveOrderFromMenu, persist 保持不变 ...
            injectResizeHandles: function (table, pageKey) {
                Array.from(table.rows[0].cells).forEach(th => {
                    if (th.querySelector('.mes-resize-handle')) return;
                    const handle = document.createElement('div');
                    handle.className = 'mes-resize-handle';
                    th.appendChild(handle);
                    this.bindResizeEvent(handle, th, pageKey);
                });
            },
            bindResizeEvent: function (handle, th, pageKey) {
                let startX, startWidth;
                const onMouseMove = (e) => {
                    const diff = e.pageX - startX;
                    th.style.width = Math.max(40, startWidth + diff) + 'px';
                };
                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    handle.classList.remove('mes-resize-active');
                    this.saveWidth(pageKey, th.innerText.trim(), parseInt(th.style.width));
                    this.updateBtnState(pageKey);
                };
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startX = e.pageX;
                    startWidth = th.offsetWidth;
                    handle.classList.add('mes-resize-active');
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
                handle.addEventListener('click', e => e.stopPropagation());
            },
            toggleColumnVisibility: function (table, colName, hidden, pageKey) {
                const headerCells = Array.from(table.rows[0].cells);
                let targetIndex = -1;
                for (let i = 0; i < headerCells.length; i++) {
                    if (headerCells[i].innerText.trim() === colName) {
                        targetIndex = i;
                        break;
                    }
                }
                if (targetIndex !== -1) {
                    Array.from(table.rows).forEach(row => {
                        if (row.cells[targetIndex]) {
                            if (hidden) row.cells[targetIndex].classList.add('mes-col-hidden');
                            else row.cells[targetIndex].classList.remove('mes-col-hidden');
                        }
                    });
                    this.saveHidden(pageKey, colName, hidden);
                }
            },
            getOrCreateConfig: function (pageKey) {
                if (!this.settings[pageKey]) this.settings[pageKey] = {order: [], hidden: [], widths: {}};
                return this.settings[pageKey];
            },
            saveWidth: function (pageKey, colName, width) {
                const cfg = this.getOrCreateConfig(pageKey);
                if (!cfg.widths) cfg.widths = {};
                cfg.widths[colName] = width;
                this.persist();
            },
            saveHidden: function (pageKey, colName, isHidden) {
                const cfg = this.getOrCreateConfig(pageKey);
                if (!cfg.hidden) cfg.hidden = [];
                if (isHidden) {
                    if (!cfg.hidden.includes(colName)) cfg.hidden.push(colName);
                } else {
                    cfg.hidden = cfg.hidden.filter(c => c !== colName);
                }
                this.persist();
            },
            saveOrderFromMenu: function (menuList, pageKey) {
                const cfg = this.getOrCreateConfig(pageKey);
                const items = Array.from(menuList.querySelectorAll('.mes-col-item'));
                cfg.order = items.map(el => el.dataset.colName);
                this.persist();
            },
            persist: function () {
                localStorage.setItem('MES_TABLE_SETTINGS', JSON.stringify(this.settings));
            }
        },

        // [修改] fixTable 逻辑
        fixTable: function () {
            // 如果开启了高级管理器
            if (this.config.tableManagerEnabled) {
                this.TableManager.process();
            } else if (this.config.tbFixEnabled) {
                // 如果只开启了基础优化（但没有管理器），我们只应用简单的截断样式
                // 这里为了简单，我们让 process 内部处理降级，或者这里写一个简单的 loop
                // 鉴于你想要融合，建议这里只调用 process，让 process 内部判断配置
                // 为了兼容旧配置，我们可以强制运行 applyCellInteractions
                // 但简单起见，建议用户在 Option 里两个都勾上。

                // 这里保留一个简单的 fallback：如果没开管理器，只做截断，不支持拖拽
                const tb = document.getElementById('tbDetail');
                if (!tb) return;
                const table = tb.querySelector('table');
                if (!table || table.dataset.mesEnhanced === 'true') return;
                table.dataset.mesEnhanced = 'true';
                this.TableManager.applyCellInteractions(table);
            }
        }
    };


    // --- 4. 配置管理模块 (Config) ---
    const ConfigModule = {
        default: {
            keepAliveEnabled: false,
            highlightEnabled: true,
            highlightColor: '#0078d7',
            highlightBackground: 'rgba(0,120,215,0.08)',
            tableManagerEnabled: true, // 表格管理
            stickyHeaderEnabled: true,
            tbFixEnabled: true,
            tbMinHeight: 580,
            tbTruncateThreshold: 30,
            dateFormatEnabled: true,
            dateFormatString: 'YY-MM-DD HH:mm:ss'
        },
        load: function () {
            return new Promise(resolve => {
                chrome.storage.local.get(['mes_config'], (res) => {
                    resolve({...this.default, ...res.mes_config});
                });
            });
        }
    };

    // ==========================================
    // 主程序入口 (Main)
    // ==========================================
    async function init() {
        console.log('[MES-Core] 初始化...');

        // 0. [关键修复] 如果当前是主页 (Index.aspx)，说明用户已经正常登录进来了
        // 必须清除之前的“手动退出”标记，否则下次过期时插件会以为用户还想退出
        if (location.pathname.toLowerCase().includes('index.aspx')) {
            console.log('🏠 [Main] 检测到进入首页，清除手动退出标记');
            chrome.storage.local.remove('mes_manual_logout');
        }

        // 1. 注入拦截器 [添加 charset]
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
        script.charset = "UTF-8"; // [关键] 解决乱码问题
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();


        // 2. 加载配置并启动 UI
        const cfg = await ConfigModule.load();
        UIModule.init(cfg);

        // 3. 检查是否是失效页面
        AuthModule.checkDomExpiry();

        // 4. 检查是否需要自动“重试查询” (回显数据 + 点击查询)
        AuthModule.checkAutoRetry();

        // 5. 环境判断与循环任务
        const path = location.pathname.toLowerCase();
        const isMenu = path.includes('left') || document.querySelector('#treeFunc');
        const isMain = path.includes('basicquery') || document.querySelector('#tbDetail');
        const isTop = path.includes('top.aspx');

        // 6. 执行逻辑
        if (isTop) {
            // Top 页只需要绑定一次退出，不需要 setInterval 循环检测
            // 因为 Top 页加载完就不会变了
            AuthModule.bindLogout();
        }

        if (isMenu) {
            setInterval(() => UIModule.bindMenu(), 1000); // 菜单可能是动态的
            setTimeout(() => UIModule.restoreMenu(), 500);
        }

        if (isMain) {
            setInterval(() => UIModule.fixTable(), 1000); // 表格内容会变
        }
    }

    // ==========================================
    // 事件监听
    // ==========================================

    // 监听来自 inject.js 的过期信号
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'MES_SESSION_EXPIRED') {
            console.warn('⚡ [MES-Core] 收到过期信号:', event.data);
            // 收到 inject.js 的信号，说明是 AJAX 请求或 Alert 弹窗触发的
            AuthModule.handleExpired(event.data.requestData);

        }
    });

    // 监听配置变更
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.mes_config) {
            UIModule.config = {...ConfigModule.default, ...changes.mes_config.newValue};
            UIModule.injectStyles();
            // 重置表格处理状态，以便重新格式化
            document.querySelectorAll('#tbDetail td').forEach(td => delete td.dataset.mesProcessed);
        }
    });

    // 启动！
    init();

})();