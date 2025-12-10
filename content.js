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
    // --- 3. 界面增强模块 (UI) ---
    const UIModule = {
        config: {},

        init: function (cfg) {
            this.config = cfg;
            this.injectStyles();
            this.SmartTooltip.init();

            // 无论配置如何，TableManager 都需要初始化以处理基础截断
            this.TableManager.init(this);

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

                // 固定表头
                const stickyCss = cfg.stickyHeaderEnabled ? `
                    #tbDetail #trfirst td, 
                    #tbDetail .tdContextColumn td,
                    #tbDetail th { 
                        position: sticky !important; top: 0 !important; z-index: 20 !important; 
                        background-color: #f7f7f7 !important; box-shadow: 0 1px 2px rgba(0,0,0,0.08);
                    }
                ` : '';

                style.textContent = `
                    /* === 基础高亮 === */
                    .mes-highlight { background-color: ${cfg.highlightBackground || '#eef'} !important; color: ${cfg.highlightColor} !important; border: 1px solid ${cfg.highlightColor}; border-radius: 4px; padding: 2px 5px !important; }
                    
                    /* === 表格基础 === */
                    #tbDetail table { table-layout: fixed; width: 100%; border-collapse: separate; border-spacing: 0; }
                    #tbDetail th, #tbDetail td { border: 1px solid #e8e8e8; padding: 8px 8px; position: relative; font-size: 12px; }

                    /* === 单行截断 === */
                    .mes-table-cell-fix { white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%; box-sizing: border-box; }
                    .mes-truncated-cell { cursor: pointer; }
                    .mes-truncated-cell:hover { color: #0078d7; font-weight: 500; }
                    .mes-col-hidden { display: none !important; }

                    ${stickyCss}

                    /* === 调整手柄 === */
                    .mes-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 21; background: transparent; transition: background 0.2s; }
                    .mes-resize-handle:hover, .mes-resize-active { background: rgba(24, 144, 255, 0.3); }
                    
                    /* === 设置按钮 === */
                    #mes-col-settings-btn {
                        /* float: right;  <-- 删掉 float */
                        cursor: pointer; padding: 2px 10px;
                        border: 1px solid #d9d9d9; background: #fff; border-radius: 4px;
                        color: #666; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;
                        position: relative; transition: all 0.3s;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                        user-select: none;
                        /* vertical-align: middle; */
                    }
                    #mes-col-settings-btn:hover { color: #40a9ff; border-color: #40a9ff; }
                    
                    /* [新增] 按钮脏状态 (有修改时) - 橙色警示 */
                    #mes-col-settings-btn.is-dirty {
                        color: #fa8c16; border-color: #fa8c16; background: #fff7e6; font-weight: 600;
                    }
                    /* 红点提示 */
                    #mes-col-settings-btn.is-dirty::after {
                        content: ''; position: absolute; top: -3px; right: -3px; width: 8px; height: 8px;
                        background: #ff4d4f; border-radius: 50%; border: 1px solid #fff;
                    }

                    /* === 菜单 === */
                    #mes-col-settings-menu {
                        position: absolute; display: none; background: white; border: 1px solid #f0f0f0; 
                        box-shadow: 0 3px 6px -4px rgba(0,0,0,0.12), 0 6px 16px 0 rgba(0,0,0,0.08);
                        padding: 0; border-radius: 4px; z-index: 999999;
                        min-width: 340px; max-height: 500px; overflow-y: auto;
                        font-family: "Segoe UI", sans-serif;
                    }
                    .mes-menu-header { 
                        padding: 10px 16px; border-bottom: 1px solid #f0f0f0; background: #fff; 
                        font-weight: 600; color: #333; display: flex; justify-content: space-between; align-items: center;
                        position: sticky; top: 0; z-index: 10;
                    }
                    .mes-col-item { display: flex; align-items: center; padding: 8px 16px; border-bottom: 1px solid #f9f9f9; background: #fff; transition: background 0.2s; }
                    .mes-col-item:hover { background: #fafafa; }
                    .mes-col-item.dragging { opacity: 0.5; background: #e6f7ff; border: 1px dashed #1890ff; }
                    .mes-col-drag-handle { cursor: grab; color: #bfbfbf; margin-right: 8px; font-size: 14px; }
                    .mes-col-checkbox { cursor: pointer; margin-right: 10px; width: 14px; height: 14px; accent-color: #1890ff; }
                    .mes-col-label { flex: 1; font-size: 13px; color: #333; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;}

                    /* === 排序与筛选 UI === */
                    .mes-col-actions { display: flex; align-items: center; gap: 4px; }
                    .mes-action-btn { 
                        cursor: pointer; padding: 2px 6px; color: #d9d9d9; border-radius: 3px; font-size: 12px; border: 1px solid transparent; transition: all 0.2s;
                    }
                    .mes-action-btn:hover { color: #666; background: #f0f0f0; }
                    
                    /* 高亮排序状态 */
                    .mes-action-btn.active { color: #fff; background: #1890ff; border-color: #1890ff; }
                    
                    .mes-filter-input { width: 60px; border: 1px solid #d9d9d9; border-radius: 2px; padding: 2px 4px; font-size: 12px; transition: all 0.3s; }
                    .mes-filter-input:focus { width: 100px; border-color: #40a9ff; outline: none; }
                    .mes-filter-input.active { border-color: #fa8c16; background: #fff7e6; }

                    /* Tooltip */
                    #mes-smart-tooltip {
                        position: fixed; z-index: 100000; background: rgba(0, 0, 0, 0.85); color: #fff;
                        padding: 6px 12px; border-radius: 2px; font-size: 12px; line-height: 1.5;
                        max-width: 400px; word-wrap: break-word; pointer-events: none;
                        box-shadow: 0 3px 6px -4px rgba(0,0,0,0.12), 0 6px 16px 0 rgba(0,0,0,0.08); opacity: 0; transition: opacity 0.1s;
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
            init: function() {
                Utils.waitDOM(() => {
                    if (!document.getElementById('mes-smart-tooltip')) {
                        this.el = document.createElement('div');
                        this.el.id = 'mes-smart-tooltip';
                        document.body.appendChild(this.el);
                    } else { this.el = document.getElementById('mes-smart-tooltip'); }
                });
            },
            show: function(target, content) {
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
                if (top + tooltipRect.height > window.innerHeight) { top = rect.top - tooltipRect.height - gap; placement = 'top'; }
                if (left < 10) left = 10;
                else if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10;
                this.el.style.top = top + 'px';
                this.el.style.left = left + 'px';
                this.el.className = 'is-' + placement;
            },
            hide: function() {
                if (!this.el) return;
                this.timer = setTimeout(() => { this.el.style.opacity = '0'; }, 100);
            }
        },

        // --- 表格管理器 (核心) ---
        TableManager: {
            settings: {}, parentUI: null, dragSrcEl: null,
            // 运行时状态 (不持久化)
            sortState: { colIndex: -1, direction: 'none' }, // none, asc, desc
            filterState: {}, // { colIndex: 'text' }

            init: function(parent) {
                this.parentUI = parent;
                // [修改] 只有当开启了"保存视图设置"时，才从 localStorage 读取
                // 否则 settings 保持为空，刷新即重置
                if (parent.config.saveViewSettings) {
                    const saved = localStorage.getItem('MES_TABLE_SETTINGS');
                    if (saved) { try { this.settings = JSON.parse(saved); } catch(e) {} }
                }
            },

            // 检查是否有用户修改
            isDirty: function(pageKey) {
                // 1. 运行时状态
                if (this.sortState.direction !== 'none') return true;
                if (Object.keys(this.filterState).some(k => this.filterState[k])) return true;

                // 2. 持久化配置
                const config = this.settings[pageKey];
                if (!config) return false;

                // 只要隐藏了列，绝对是脏的
                if (config.hidden && config.hidden.length > 0) return true;

                // 只要保存了顺序数组（说明拖拽过），认为是脏的
                // (只有点击"重置"才会清除这个数组)
                if (config.order && config.order.length > 0) return true;

                return false;
            },

            process: function() {
                const tb = document.getElementById('tbDetail');
                if (!tb) return;
                const table = tb.querySelector('table');
                if (!table) return;

                // [关键] 如果检测到新表格 (dataset标记不同)，重置运行时状态
                // 原网页每次查询都会替换 innerHTML，这里利用这个特性
                if (table.dataset.mesEnhanced !== 'true') {
                    // 重置排序和筛选状态，因为数据变了，之前的排序已经失效
                    this.sortState = { colIndex: -1, direction: 'none' };
                    this.filterState = {};

                    // 给所有行添加原始索引，方便取消排序时恢复
                    Array.from(table.rows).forEach((row, idx) => {
                        if(idx > 0) row.dataset.mesOriginalIdx = idx;
                    });
                } else {
                    return; // 已经处理过，跳过
                }

                table.dataset.mesEnhanced = 'true';
                const pageKey = location.pathname + location.search;

                // 1. 初始宽度
                if (!this.settings[pageKey] || !this.settings[pageKey].widths) {
                    this.calculateAutoWidths(table, pageKey);
                }

                // 2. 应用保存的配置
                this.applyColumnSettings(table, pageKey);

                // 3. 注入交互组件
                if (this.parentUI.config.tableManagerEnabled) {
                    this.injectResizeHandles(table, pageKey);
                    this.injectSettingsButton(pageKey, table);
                } else {
                    // 即使没开管理器，为了融合模式的截断，也要处理单元格
                }

                // 4. 应用单元格样式 (截断/Tooltip)
                this.applyCellInteractions(table);

                // 更新按钮状态
                this.updateBtnState(pageKey);
            },

            calculateAutoWidths: function(table, pageKey) {
                table.style.tableLayout = 'auto';
                const headers = Array.from(table.rows[0].cells);
                const widths = {};
                const MAX_WIDTH = 300; const MIN_WIDTH = 60;
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

            applyColumnSettings: function(table, pageKey) {
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
                    row.innerHTML = ''; row.appendChild(fragment);
                });
            },

            applyCellInteractions: function(table) {
                const config = this.parentUI.config;
                const truncateLen = config.tbTruncateThreshold || 30;
                let dateCols = [];
                const headerRow = table.rows[0];
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

            injectSettingsButton: function(pageKey, table) {
                const pageDiv = document.getElementById('divpage');
                // 找分页下拉框，插在它后面
                const targetEl = document.getElementById('dplPageIndex');

                if (!pageDiv || document.getElementById('mes-col-settings-btn')) return;

                const btn = document.createElement('div');
                btn.id = 'mes-col-settings-btn';
                btn.innerHTML = `<span>⚙️</span> 视图`;
                btn.title = "点击配置列显示与排序";

                this.updateBtnState(pageKey);

                // 创建 Wrapper (inline-block)
                const wrapper = document.createElement('div');
                // margin-left: 10px 让它跟分页下拉框有点距离
                wrapper.style.cssText = "position:relative; display:inline-block; margin-left: 15px; vertical-align: middle;";
                wrapper.appendChild(btn);

                const menu = document.createElement('div');
                menu.id = 'mes-col-settings-menu';
                wrapper.appendChild(menu);

                // [关键修改] 插入到下拉框后面，而不是 divpage 最前面
                if (targetEl && targetEl.nextSibling) {
                    targetEl.parentNode.insertBefore(wrapper, targetEl.nextSibling);
                } else {
                    pageDiv.appendChild(wrapper); // 兜底
                }

                btn.onclick = (e) => {
                    e.stopPropagation();
                    const isVisible = menu.style.display === 'block';
                    if (!isVisible) {
                        this.renderMenuContent(menu, pageKey, table);
                        menu.style.display = 'block';

                        // [智能定位 v2.0]
                        menu.style.top = 'auto'; menu.style.bottom = 'auto'; menu.style.left = 'auto'; menu.style.right = 'auto';
                        menu.style.maxHeight = 'none';

                        const rect = btn.getBoundingClientRect();
                        const viewportHeight = window.innerHeight;
                        const viewportWidth = window.innerWidth;

                        const spaceBelow = viewportHeight - rect.bottom;
                        const spaceAbove = rect.top;

                        // 1. 垂直方向 (上/下)
                        if (spaceAbove < 300 && spaceBelow > spaceAbove) {
                            menu.style.top = '100%';
                            menu.style.marginTop = '5px';
                            menu.style.maxHeight = (spaceBelow - 20) + 'px';
                        } else {
                            menu.style.bottom = '100%';
                            menu.style.marginBottom = '5px';
                            menu.style.maxHeight = Math.min(500, spaceAbove - 20) + 'px';
                        }

                        // 2. 水平方向 (左/右)
                        // 如果按钮太靠右，菜单就向左展开 (right: 0)
                        // 如果按钮靠左，菜单向右展开 (left: 0)
                        if (rect.left > viewportWidth / 2) {
                            menu.style.right = '0'; // 右对齐
                        } else {
                            menu.style.left = '0';  // 左对齐
                        }
                    } else {
                        menu.style.display = 'none';
                    }
                };

                document.addEventListener('click', (e) => {
                    if (!wrapper.contains(e.target)) menu.style.display = 'none';
                });
            },

            injectResizeHandles: function(table, pageKey) {
                Array.from(table.rows[0].cells).forEach(th => {
                    if (th.querySelector('.mes-resize-handle')) return;
                    const handle = document.createElement('div');
                    handle.className = 'mes-resize-handle';
                    th.appendChild(handle);
                    this.bindResizeEvent(handle, th, pageKey);
                });
            },

            bindResizeEvent: function(handle, th, pageKey) {
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
                    e.preventDefault(); e.stopPropagation();
                    startX = e.pageX; startWidth = th.offsetWidth;
                    handle.classList.add('mes-resize-active');
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
                handle.addEventListener('click', e => e.stopPropagation());
            },

            renderMenuContent: function(menu, pageKey, table) {
                menu.innerHTML = `
                    <div class="mes-menu-header">
                        <span>自定义视图</span>
                        <a href="javascript:;" id="mes-reset-btn" style="font-size:12px;font-weight:normal;color:#1890ff;text-decoration:none;">↺ 恢复默认</a>
                    </div>
                `;

                const list = document.createElement('div');
                const headerCells = Array.from(table.rows[0].cells);
                // 获取当前实际显示的顺序
                const currentOrder = headerCells.map(c => c.innerText.trim());

                currentOrder.forEach((colName, idx) => {
                    const item = document.createElement('div');
                    item.className = 'mes-col-item';
                    item.draggable = true;
                    item.dataset.colName = colName;

                    const cell = headerCells.find(c => c.innerText.trim() === colName);
                    const isHidden = cell ? cell.classList.contains('mes-col-hidden') : false;
                    const chkId = 'chk-' + Math.random().toString(36).substr(2, 9);

                    // 状态判断
                    const isSortedAsc = this.sortState.colIndex === idx && this.sortState.direction === 'asc';
                    const isSortedDesc = this.sortState.colIndex === idx && this.sortState.direction === 'desc';
                    const hasFilter = this.filterState[idx] && this.filterState[idx].length > 0;

                    item.innerHTML = `
                        <span class="mes-col-drag-handle" title="拖拽排序">⋮⋮</span>
                        <input type="checkbox" id="${chkId}" class="mes-col-checkbox" ${!isHidden ? 'checked' : ''}>
                        <label for="${chkId}" class="mes-col-label" title="${colName}">${colName}</label>
                        <div class="mes-col-actions">
                            <span class="mes-action-btn sort-asc ${isSortedAsc ? 'active' : ''}" title="升序">⬆️</span>
                            <span class="mes-action-btn sort-desc ${isSortedDesc ? 'active' : ''}" title="降序">⬇️</span>
                            <input type="text" class="mes-filter-input ${hasFilter ? 'active' : ''}" placeholder="筛选" value="${this.filterState[idx] || ''}">
                        </div>
                    `;

                    // 绑定事件
                    item.querySelector('input').addEventListener('change', (e) => {
                        this.toggleColumnVisibility(table, colName, !e.target.checked, pageKey);
                        this.updateBtnState(pageKey);
                    });

                    // [修改] 排序事件：三态切换 (点击高亮的会取消)
                    item.querySelector('.sort-asc').onclick = () => this.handleSortClick(table, idx, 'asc', pageKey, menu);
                    item.querySelector('.sort-desc').onclick = () => this.handleSortClick(table, idx, 'desc', pageKey, menu);

                    // 筛选
                    const filterInput = item.querySelector('.mes-filter-input');
                    filterInput.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); });
                    filterInput.addEventListener('input', (e) => {
                        this.filterTableData(table, idx, e.target.value);
                        this.updateBtnState(pageKey);
                    });

                    this.bindDragEvents(item, list, table, pageKey);
                    list.appendChild(item);
                });
                menu.appendChild(list);

                menu.querySelector('#mes-reset-btn').onclick = () => {
                    if(confirm('恢复默认设置？（会清除所有宽度、顺序和筛选）')) {
                        delete this.settings[pageKey];
                        this.persist();
                        location.reload();
                    }
                };
            },

            // [新增] 处理排序点击 (三态逻辑)
            handleSortClick: function(table, colIdx, direction, pageKey, menu) {
                // 如果点击的是当前已经激活的方向，则取消排序
                if (this.sortState.colIndex === colIdx && this.sortState.direction === direction) {
                    this.sortColumn(table, colIdx, 'none'); // 恢复默认
                } else {
                    this.sortColumn(table, colIdx, direction);
                }
                // 重新渲染菜单以更新高亮状态
                this.renderMenuContent(menu, pageKey, table);
                this.updateBtnState(pageKey);
            },

            sortColumn: function(table, colIdx, direction) {
                this.sortState = { colIndex: colIdx, direction: direction };

                const tbody = table.tBodies[0] || table;
                const rows = Array.from(tbody.querySelectorAll('tr:not(#trfirst)'));

                if (direction === 'none') {
                    // 恢复原始顺序
                    rows.sort((a, b) => {
                        return (a.dataset.mesOriginalIdx || 0) - (b.dataset.mesOriginalIdx || 0);
                    });
                } else {
                    const asc = direction === 'asc';
                    rows.sort((a, b) => {
                        const txtA = a.cells[colIdx] ? a.cells[colIdx].innerText.trim() : '';
                        const txtB = b.cells[colIdx] ? b.cells[colIdx].innerText.trim() : '';

                        const numA = parseFloat(txtA);
                        const numB = parseFloat(txtB);

                        if (!isNaN(numA) && !isNaN(numB)) {
                            return asc ? numA - numB : numB - numA;
                        }
                        return asc ? txtA.localeCompare(txtB) : txtB.localeCompare(txtA);
                    });
                }

                rows.forEach(row => tbody.appendChild(row));
            },

            filterTableData: function(table, colIdx, text) {
                this.filterState[colIdx] = text; // 保存状态
                const rows = Array.from(table.querySelectorAll('tr:not(#trfirst)'));
                const lowerText = text.toLowerCase();

                rows.forEach(row => {
                    const cell = row.cells[colIdx];
                    if (!cell) return;

                    // 需要同时满足所有列的筛选条件 (AND 逻辑)
                    let visible = true;
                    for (const [fIdx, fText] of Object.entries(this.filterState)) {
                        if (!fText) continue;
                        const fCell = row.cells[fIdx];
                        if (!fCell || !fCell.innerText.toLowerCase().includes(fText.toLowerCase())) {
                            visible = false;
                            break;
                        }
                    }

                    row.style.display = visible ? '' : 'none';
                });
            },

            updateBtnState: function(pageKey) {
                const btn = document.getElementById('mes-col-settings-btn');
                if (!btn) return;

                // 获取当前原始表头顺序用于比对
                let currentHeaders = null;
                const tb = document.getElementById('tbDetail');
                if (tb) {
                    const table = tb.querySelector('table');
                    if (table && table.rows.length > 0) {
                        // 注意：这里需要获取 DOM 中目前的顺序，但 isDirty 需要比对的是"默认顺序"
                        // 实际上，只要 config.order 存在且不为空，我们就认为用户调整过顺序（即使调回去了）
                        // 为了简化逻辑，我们假设只要有 order 记录就算脏，除非我们存了原始 defaultOrder

                        // 既然要严格判断，那我们修改策略：
                        // 只要 localStorage 里有这个 key 且不为空，就算脏。
                        // 或者更简单：相信 isDirty 的判断。

                        // 这里我们传入 null，让 isDirty 只检查 hidden 和 runtime state
                        // 如果你想检查 order，你需要在此处获取原始顺序。
                        // 由于原始顺序在 process 时可能已经丢失（因为 DOM 被重排了），这比较难办。

                        // === 修正方案 ===
                        // 我们只检查 显式的 hidden 和 运行时的 sort/filter
                        // 对于 order，只有当它与"当前DOM顺序"不一致时... 不对，当前DOM就是order后的。

                        // 妥协方案：只要 config.order 有值，就认为脏。
                        // 并在"重置"时清除 config.order。
                    }
                }

                if (this.isDirty(pageKey)) {
                    btn.classList.add('is-active');
                    btn.classList.add('is-dirty');
                    btn.title = "视图已修改 (有隐藏列、排序或筛选)";
                } else {
                    btn.classList.remove('is-active');
                    btn.classList.remove('is-dirty');
                    btn.title = "点击配置列";
                }
            },

            bindDragEvents: function(item, list, table, pageKey) {
                item.addEventListener('dragstart', (e) => {
                    this.dragSrcEl = item; e.dataTransfer.effectAllowed = 'move';
                    item.classList.add('dragging');
                });
                item.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; });
                item.addEventListener('dragenter', (e) => { if(this.dragSrcEl !== item) item.style.background = '#e6f7ff'; });
                item.addEventListener('dragleave', () => { item.style.background = ''; });
                item.addEventListener('drop', (e) => {
                    e.stopPropagation(); item.style.background = '';
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
                item.addEventListener('dragend', () => { item.classList.remove('dragging'); list.querySelectorAll('.mes-col-item').forEach(i => i.style.background = ''); });
            },

            toggleColumnVisibility: function(table, colName, hidden, pageKey) {
                const headerCells = Array.from(table.rows[0].cells);
                let targetIndex = -1;
                for (let i = 0; i < headerCells.length; i++) {
                    if (headerCells[i].innerText.trim() === colName) { targetIndex = i; break; }
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

            getOrCreateConfig: function(pageKey) {
                if (!this.settings[pageKey]) this.settings[pageKey] = { order: [], hidden: [], widths: {} };
                return this.settings[pageKey];
            },
            saveWidth: function(pageKey, colName, width) {
                const cfg = this.getOrCreateConfig(pageKey);
                if (!cfg.widths) cfg.widths = {};
                cfg.widths[colName] = width;
                this.persist();
            },
            saveHidden: function(pageKey, colName, isHidden) {
                const cfg = this.getOrCreateConfig(pageKey);
                if (!cfg.hidden) cfg.hidden = [];
                if (isHidden) { if (!cfg.hidden.includes(colName)) cfg.hidden.push(colName); }
                else { cfg.hidden = cfg.hidden.filter(c => c !== colName); }
                this.persist();
            },
            saveOrderFromMenu: function(menuList, pageKey) {
                const cfg = this.getOrCreateConfig(pageKey);
                const items = Array.from(menuList.querySelectorAll('.mes-col-item'));
                cfg.order = items.map(el => el.dataset.colName);
                this.persist();
            },
            persist: function() {
                // [修改] 仅当配置允许时才写入 localStorage
                if (this.parentUI.config.saveViewSettings) {
                    localStorage.setItem('MES_TABLE_SETTINGS', JSON.stringify(this.settings));
                }
            },

            // 主入口
            fixTable: function () {
                if (!this.config.tbFixEnabled) return;
                this.TableManager.process();
            }
        },

        // 占位函数
        setupModalContainer: function() {
            if (!document.getElementById('mes-modal-container')) {
                const c = document.createElement('div');
                c.id = 'mes-modal-container';
                document.body.appendChild(c);
            }
        },
        showOverlay: function(msg, isError) {
            Utils.waitDOM(() => {
                let overlay = document.getElementById('mes-relogin-overlay');
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'mes-relogin-overlay';
                    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255, 255, 255, 0.95); z-index: 999999; display: flex; justify-content: center; align-items: center; font-size: 20px; color: #333; font-family: "Segoe UI"; flex-direction: column;`;
                    document.body.appendChild(overlay);
                }
                overlay.innerHTML = `<div style="text-align:center;"><div style="font-size: 40px; margin-bottom: 20px;">${isError ? '⚠️' : '🍪'}</div><div>${msg}</div>${isError ? '<br><a href="Login.aspx" style="color:#0078d7; font-size:16px;">转到登录页</a>' : ''}</div>`;
            });
        },
        showDetailModal: function(content) {
            const container = document.getElementById('mes-modal-container');
            if (!container) return;
            container.innerHTML = `<div class="mes-modal-overlay" id="mes-modal-close-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;justify-content:center;align-items:center;"><div class="mes-modal-content" style="background:white;padding:20px;border-radius:8px;width:600px;max-height:80vh;display:flex;flex-direction:column;"><div style="display:flex;justify-content:space-between;margin-bottom:15px;border-bottom:1px solid #eee;"><h3 style="margin:0;color:#0078d7;">📄 完整内容</h3><span id="mes-modal-close-btn" style="cursor:pointer;font-size:24px;">×</span></div><div id="mes-modal-text" style="flex:1;overflow-y:auto;padding:10px;background:#f9f9f9;border:1px solid #eee;white-space:pre-wrap;word-break:break-all;">${Utils.escapeHtml(content)}</div><div style="margin-top:15px;text-align:right;"><span id="mes-copy-tip" style="color:green;margin-right:10px;opacity:0;transition:opacity 0.5s;">✅ 已复制!</span><button id="mes-btn-copy" style="padding:6px 15px;background:#0078d7;color:white;border:none;border-radius:4px;cursor:pointer;">复制</button></div></div></div>`;
            const close = () => container.innerHTML = '';
            document.getElementById('mes-modal-close-btn').onclick = close;
            document.getElementById('mes-modal-close-overlay').onclick = (e) => { if (e.target.id === 'mes-modal-close-overlay') close(); };
            document.getElementById('mes-btn-copy').onclick = () => {
                Utils.copyText(document.getElementById('mes-modal-text').innerText, () => {
                    const tip = document.getElementById('mes-copy-tip');
                    if(tip) { tip.style.opacity = 1; setTimeout(() => tip.style.opacity = 0, 2000); }
                });
            };
        },
        bindMenu: function() {
            if (!this.config.highlightEnabled) return;
            document.querySelectorAll('#treeFunc a, a[href*=".aspx"]').forEach(link => {
                if (link.dataset.mesBound) return;
                const href = (link.getAttribute('href') || '').trim();
                const target = link.getAttribute('target');
                if (href.toLowerCase().startsWith('javascript') || (target !== 'mainFrame' && !link.classList.contains('a02'))) { link.dataset.mesBound = "ignored"; return; }
                link.dataset.mesBound = "true";
                link.addEventListener('click', function () {
                    document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                    this.classList.add('mes-highlight');
                    const saveHref = href.replace(/^(\.\/|\/)/, '');
                    chrome.storage.local.set({'mes_last_selected_href': saveHref});
                });
            });
        },
        restoreMenu: function() {
            chrome.storage.local.get(['mes_last_selected_href'], (result) => {
                const lastHref = result.mes_last_selected_href;
                if (!lastHref) return;
                const link = document.querySelector(`a[href*="${lastHref}"]`);
                if (link) {
                    document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                    link.classList.add('mes-highlight');
                    let p = link.parentElement; let safe = 0;
                    while (p && safe < 50) {
                        safe++;
                        if (p.tagName === 'DIV' && p.id && /^treeFuncn\d+Nodes$/.test(p.id)) {
                            p.style.display = 'block'; const idx = p.id.match(/^treeFuncn(\d+)Nodes$/)[1];
                            const toggle = document.getElementById('treeFunct' + idx);
                            if(toggle) toggle.classList.add('mes-menu-open');
                        }
                        p = p.parentElement;
                    }
                    link.scrollIntoView({block: 'center', behavior: 'smooth'});
                }
            });
        },

        // 主入口
        fixTable: function () {
            if (!this.config.tbFixEnabled) return;
            this.TableManager.process();
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