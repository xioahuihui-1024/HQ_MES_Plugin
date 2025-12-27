(function () {
    // 0. 全局防抖检查
    if (window._mesInitialized) return;
    window._mesInitialized = true;

    'use strict';

    // ==========================================
    // 配置模块 (ConfigModule)
    // ==========================================
    const ConfigModule = {
        // 默认配置
        default: {
            // 认证保活
            username: '',
            password: '',
            keepAliveEnabled: false,

            // 菜单高亮
            highlightEnabled: true,
            highlightColor: '#0078d7',
            highlightBackground: 'rgba(0,120,215,0.08)',

            // 表格总开关
            tbFixEnabled: true,
            tbMinHeight: 580,

            // 表格样式
            tableFontFamily: '"JetBrains Mono", "Consolas", monospace',
            tableFontSize: '12px',
            tablePadding: '3px 2px',
            useGoogleFonts: true,

            // 固定表头
            stickyHeaderEnabled: true,

            // 高级表格管理
            tableManagerEnabled: true,
            saveViewSettings: false,

            // 列宽控制
            colMaxWidth: 850,
            colMinWidth: 6,
            colSampleRows: 12,

            // 截断与Tooltip
            tbTruncateThreshold: 120,

            // 日期格式化
            dateFormatEnabled: true,
            dateFormatString: 'YY-MM-DD HH:mm:ss',

            // 搜索工具栏
            searchToolbarEnabled: true
        },

        // 加载配置
        load: function () {
            return new Promise(resolve => {
                if (!Utils.isExtensionValid()) {
                    resolve(this.default);
                    return;
                }
                chrome.storage.local.get(['mes_config'], (res) => {
                    resolve({ ...this.default, ...res.mes_config });
                });
            });
        }
    };

    // ==========================================
    // 工具模块 (Utils)
    // ==========================================
    const Utils = {
        // 检查扩展上下文是否有效
        isExtensionValid: function() {
            try {
                return !!(chrome && chrome.runtime && chrome.runtime.id);
            } catch (e) {
                return false;
            }
        },

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
                .replace(/YYYY/g, Y)
                .replace(/YYY/g, Y.slice(1))
                .replace(/YY/g, Y.slice(2))
                .replace(/Y/g, Y.slice(3))
                .replace(/MM/g, M).replace(/DD/g, D)
                .replace(/HH/g, H).replace(/mm/g, m).replace(/ss/g, s)
                .replace(/M(?!M)/g, parseInt(M)).replace(/D(?!D)/g, parseInt(D));
        }
    };

    // ==========================================
    // 认证模块 (AuthModule)
    // ==========================================
    const AuthModule = {
        isHandling: false,

        // 检查 DOM 中的过期提示
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

            if (!Utils.isExtensionValid()) {
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
                        if (Utils.isExtensionValid()) {
                            chrome.storage.local.remove('mes_manual_logout');
                        }
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

        // 绑定退出按钮
        bindLogout: function () {
            if (!location.pathname.toLowerCase().includes('top.aspx')) return;
            Utils.waitDOM(() => {
                const exitLinks = document.querySelectorAll('a[href*="Login.aspx"]');
                exitLinks.forEach(link => {
                    if (link.dataset.mesLogoutBound) return;
                    if (link.innerText.includes("退出")) {
                        link.dataset.mesLogoutBound = "true";
                        link.addEventListener('click', () => {
                            if (Utils.isExtensionValid()) {
                                chrome.runtime.sendMessage({action: "MANUAL_LOGOUT"});
                            }
                        });
                    }
                });
            });
        }
    };

    // ==========================================
    // 界面增强模块 (UIModule)
    // ==========================================
    const UIModule = {
        config: {},

        // 初始化
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

        // 注入样式
        injectStyles: function () {
            Utils.waitDOM(() => {
                // 引入 Google Fonts - JetBrains Mono
                if (this.config.useGoogleFonts && !document.getElementById('mes-google-fonts')) {
                    const fontLink = document.createElement('link');
                    fontLink.id = 'mes-google-fonts';
                    fontLink.rel = 'stylesheet';
                    fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap';
                    document.head.appendChild(fontLink);
                }

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
                        background-color: #f7f7f7 !important; box-shadow: 0 3px 1px rgba(0,0,0,0.08);
                    }
                ` : '';

                style.textContent = `
                    /* === 基础高亮 === */
                    .mes-highlight { background-color: ${cfg.highlightBackground || '#eef'} !important; color: ${cfg.highlightColor} !important; border: 1px solid ${cfg.highlightColor}; border-radius: 4px; padding: 2px 5px !important; }
                    
                    /* === 表格基础 === */
                    #tbDetail table { table-layout: fixed; width: 100%; border-collapse: separate; border-spacing: 0; font-family: ${cfg.tableFontFamily}; }
                    #tbDetail th, #tbDetail td { border: 1px solid #e8e8e8; padding: ${cfg.tablePadding}; position: relative; font-size: ${cfg.tableFontSize}; }

                    /* === 单行截断 === */
                    .mes-table-cell-fix { white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%; box-sizing: border-box; }
                    .mes-truncated-cell { cursor: pointer; }
                    .mes-truncated-cell:hover { color: #0078d7; font-weight: 500; }
                    .mes-col-hidden { display: none !important; }
                    
                    /* === 搜索命中展开样式 === */
                    .mes-search-expanded { 
                        white-space: normal !important; 
                        overflow: visible !important; 
                        text-overflow: clip !important;
                    }
                    .mes-search-hit {
                        background-color: #fffbe6 !important;
                    }
                    .mes-search-current {
                        background-color: #fff1b8 !important;
                    }
                    /* 关键词高亮样式 */
                    mark.mes-keyword-highlight {
                        background-color: #fadb14 !important;
                        color: #000 !important;
                        padding: 1px 2px;
                        border-radius: 2px;
                        font-weight: 500;
                    }
                    mark.mes-keyword-current {
                        background-color: #fa8c16 !important;
                        color: #fff !important;
                        box-shadow: 0 0 6px rgba(250, 140, 22, 0.8);
                    }
                    /* 保留链接样式 */
                    .mes-table-cell-fix a { color: #1890ff; text-decoration: underline; }
                    .mes-table-cell-fix a:hover { color: #40a9ff; }
                    .mes-table-cell-fix img { max-width: 100px; max-height: 60px; vertical-align: middle; }
                    
                    /* === 自定义搜索工具栏 === */
                    #mes-search-toolbar {
                        position: fixed;
                        top: -70px;
                        right: 20px;
                        z-index: 999999;
                        background: #fff;
                        border: 1px solid #d9d9d9;
                        border-radius: 8px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                        padding: 10px 14px;
                        transition: top 0.3s ease;
                        font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
                    }
                    #mes-search-toolbar.mes-search-visible {
                        top: 10px;
                    }
                    .mes-search-inner {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    .mes-search-icon {
                        font-size: 18px;
                    }
                    #mes-search-input {
                        width: 220px;
                        padding: 8px 12px;
                        border: 1px solid #d9d9d9;
                        border-radius: 4px;
                        font-size: 15px;
                        outline: none;
                        transition: border-color 0.3s;
                    }
                    #mes-search-input:focus {
                        border-color: #40a9ff;
                        box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
                    }
                    .mes-search-count {
                        font-size: 14px;
                        color: #666;
                        min-width: 50px;
                        text-align: center;
                    }
                    .mes-search-nav {
                        padding: 6px 10px;
                        border: 1px solid #d9d9d9;
                        background: #fff;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        transition: all 0.2s;
                    }
                    .mes-search-nav:hover {
                        border-color: #40a9ff;
                        color: #40a9ff;
                    }
                    .mes-search-close {
                        padding: 6px 10px;
                        border: none;
                        background: transparent;
                        cursor: pointer;
                        font-size: 16px;
                        color: #999;
                        transition: color 0.2s;
                    }
                    .mes-search-close:hover {
                        color: #ff4d4f;
                    }

                    ${stickyCss}

                    /* === 调整手柄 === */
                    .mes-resize-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 21; background: transparent; transition: background 0.2s; }
                    .mes-resize-handle:hover, .mes-resize-active { background: rgba(24, 144, 255, 0.3); }
                    
                    /* === 设置按钮 === */
                    #mes-col-settings-btn, #mes-export-btn {
                        padding: 1px 6px;
                        font-size: 11px;
                        border: 1px solid #d9d9d9; 
                        background: #fff; 
                        border-radius: 4px;
                        color: #666; 
                        display: inline-flex;
                        align-items: center; 
                        gap: 3px;
                        position: relative; 
                        transition: all 0.3s;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                        user-select: none;
                        vertical-align: middle; 
                        height: 20px;
                        line-height: 1;
                        cursor: pointer;
                    }
                    #mes-col-settings-btn:hover, #mes-export-btn:hover { color: #40a9ff; border-color: #40a9ff; }
                    
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
                    #mes-col-settings-menu, #mes-export-menu {
                        position: absolute; display: none; background: white; border: 1px solid #f0f0f0; 
                        box-shadow: 0 3px 6px -4px rgba(0,0,0,0.12), 0 6px 16px 0 rgba(0,0,0,0.08);
                        padding: 0; border-radius: 4px; z-index: 999999;
                        min-width: 200px; max-height: 500px; overflow-y: auto;
                        font-family: "Segoe UI", sans-serif;
                    }
                    #mes-export-menu {
                        min-width: 280px;
                        max-width: 320px;
                        overflow: visible;
                    }
                    .mes-export-format-section {
                        padding: 12px 14px;
                        border-bottom: 1px solid #f0f0f0;
                        background: #fff;
                        overflow: visible;
                        position: relative;
                    }
                    .mes-export-format-label {
                        font-size: 12px;
                        color: #666;
                        margin-bottom: 10px;
                        font-weight: 500;
                    }
                    .mes-export-format-options {
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 6px;
                    }
                    .mes-format-option {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        padding: 8px 6px;
                        border: 1px solid #d9d9d9;
                        border-radius: 6px;
                        background: #fff;
                        transition: all 0.2s;
                        font-size: 12px;
                        user-select: none;
                        position: relative;
                        box-sizing: border-box;
                    }
                    .mes-format-option:hover {
                        border-color: #40a9ff;
                        color: #40a9ff;
                        background: #f5faff;
                    }
                    .mes-format-option input[type="radio"] {
                        display: none;
                    }
                    .mes-format-option span:first-of-type {
                        font-weight: 500;
                    }
                    .mes-format-option:has(input[type="radio"]:checked) {
                        border-color: #1890ff;
                        background: #e6f7ff;
                        color: #1890ff;
                        font-weight: 600;
                        box-shadow: 0 0 0 1px #1890ff inset;
                    }
                    .mes-format-help {
                        margin-left: 3px;
                        color: #bbb;
                        cursor: help;
                        font-size: 10px;
                        width: 14px;
                        height: 14px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 50%;
                        border: 1px solid #e0e0e0;
                        background: #fafafa;
                        transition: all 0.2s;
                        flex-shrink: 0;
                    }
                    .mes-format-help:hover {
                        border-color: #1890ff;
                        color: #1890ff;
                        background: #e6f7ff;
                    }
                    .mes-format-tooltip {
                        position: fixed;
                        padding: 8px 12px;
                        background: rgba(0, 0, 0, 0.9);
                        color: #fff;
                        font-size: 12px;
                        font-weight: 400;
                        border-radius: 6px;
                        opacity: 0;
                        pointer-events: none;
                        transition: opacity 0.2s;
                        z-index: 10000000;
                        width: 200px;
                        white-space: normal;
                        line-height: 1.5;
                        text-align: left;
                        transform: translateX(-50%);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    }
                    .mes-format-tooltip::after {
                        display: none;
                    }
                    .mes-format-help:hover .mes-format-tooltip {
                        opacity: 1;
                    }
                    .mes-export-option {
                        padding: 10px 14px;
                        border-bottom: 1px solid #f0f0f0;
                        background: #fafafa;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        font-size: 12px;
                        color: #555;
                        position: relative;
                        overflow: visible;
                    }
                    .mes-export-option input[type="checkbox"] {
                        cursor: pointer;
                        width: 16px;
                        height: 16px;
                        accent-color: #1890ff;
                        flex-shrink: 0;
                    }
                    .mes-export-option label {
                        cursor: pointer;
                        user-select: none;
                        flex: 1;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        line-height: 1.4;
                    }
                    .mes-export-option-help {
                        color: #bbb;
                        cursor: help;
                        font-size: 10px;
                        width: 14px;
                        height: 14px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 50%;
                        border: 1px solid #e0e0e0;
                        background: #fff;
                        transition: all 0.2s;
                        flex-shrink: 0;
                    }
                    .mes-export-option-help:hover {
                        border-color: #1890ff;
                        color: #1890ff;
                        background: #e6f7ff;
                    }
                    .mes-export-option-help-tooltip {
                        position: fixed;
                        padding: 8px 12px;
                        background: rgba(0, 0, 0, 0.9);
                        color: #fff;
                        font-size: 12px;
                        border-radius: 6px;
                        white-space: normal;
                        opacity: 0;
                        pointer-events: none;
                        transition: opacity 0.2s;
                        z-index: 10000000;
                        width: 220px;
                        line-height: 1.5;
                        text-align: left;
                        transform: translateX(-50%);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    }
                    .mes-export-option-help-tooltip::after {
                        display: none;
                    }
                    .mes-export-option-help:hover .mes-export-option-help-tooltip {
                        opacity: 1;
                    }
                    .mes-export-actions {
                        padding: 12px 14px;
                        display: flex;
                        gap: 10px;
                        background: #fff;
                    }
                    .mes-export-action-btn {
                        flex: 1;
                        padding: 10px 12px;
                        border: 1px solid #d9d9d9;
                        border-radius: 6px;
                        background: #fff;
                        color: #333;
                        font-size: 13px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.2s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                        white-space: nowrap;
                    }
                    .mes-export-action-btn:hover {
                        border-color: #40a9ff;
                        color: #1890ff;
                        background: #f0f8ff;
                    }
                    .mes-export-action-btn:active {
                        background: #e6f7ff;
                        transform: scale(0.98);
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
                    } else {
                        this.el = document.getElementById('mes-smart-tooltip');
                    }
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
            hide: function() {
                if (!this.el) return;
                this.timer = setTimeout(() => { this.el.style.opacity = '0'; }, 100);
            }
        },

        // --- 表格管理器 (核心) ---
        TableManager: {
            settings: {},
            parentUI: null,
            dragSrcEl: null,
            // 运行时状态 (不持久化)
            sortState: { colName: '', direction: 'none' }, // none, asc, desc - 改用列名
            filterState: {}, // { colName: 'text' } - 改用列名作为 key

            init: function(parent) {
                this.parentUI = parent;
                // [修改] 只有当开启了"保存视图设置"时，才从 localStorage 读取
                // 否则 settings 保持为空，刷新即重置
                if (parent.config.saveViewSettings) {
                    const saved = localStorage.getItem('MES_TABLE_SETTINGS');
                    if (saved) {
                        try {
                            this.settings = JSON.parse(saved);
                        } catch(e) {}
                    }
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
                    this.sortState = { colName: '', direction: 'none' };
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
                }

                // 4. 应用单元格样式 (截断/Tooltip)
                this.applyCellInteractions(table);

                // 更新按钮状态
                this.updateBtnState(pageKey);
            },

            calculateAutoWidths: function(table, pageKey) {
                // [性能优化] 使用 requestAnimationFrame 避免阻塞渲染
                const self = this;
                const MAX_WIDTH = this.parentUI.config.colMaxWidth || 850;
                const MIN_WIDTH = this.parentUI.config.colMinWidth || 6;
                const sampleRows = this.parentUI.config.colSampleRows || 12;
                
                // 临时切换为 auto 布局计算宽度
                const originalLayout = table.style.tableLayout;
                table.style.tableLayout = 'auto';
                
                const headers = table.rows[0].cells;
                const widths = {};
                const rowCount = Math.min(table.rows.length, sampleRows + 1);

                for (let colIdx = 0; colIdx < headers.length; colIdx++) {
                    const th = headers[colIdx];
                    let maxWidth = th.offsetWidth;

                    // 遍历采样行
                    for (let i = 1; i < rowCount; i++) {
                        const cell = table.rows[i]?.cells[colIdx];
                        if (cell) {
                            const cellWidth = cell.scrollWidth;
                            if (cellWidth > maxWidth) {
                                maxWidth = cellWidth;
                            }
                        }
                    }

                    // 加余量并限制范围
                    let w = Math.min(Math.max(maxWidth + 10, MIN_WIDTH), MAX_WIDTH);
                    widths[th.innerText.trim()] = w;
                }
                
                this.getOrCreateConfig(pageKey).widths = widths;
                this.persist();
                table.style.tableLayout = 'fixed';
            },

            applyColumnSettings: function(table, pageKey) {
                const config = this.settings[pageKey];
                if (!config) return;

                const rows = table.rows;
                const headerRow = rows[0];
                const headerCells = headerRow.cells;
                
                // [性能优化] 使用 Map 替代对象，提高查找效率
                const headerMap = new Map();
                for (let i = 0; i < headerCells.length; i++) {
                    headerMap.set(headerCells[i].innerText.trim(), i);
                }

                const savedOrder = config.order || [];
                const currentHeaders = Array.from(headerMap.keys());
                const finalOrder = [...new Set([...savedOrder, ...currentHeaders])];
                
                // [性能优化] 预先创建隐藏列 Set
                const hiddenSet = new Set(config.hidden || []);
                const widths = config.widths || {};

                // [性能优化] 批量处理行
                for (let r = 0; r < rows.length; r++) {
                    const row = rows[r];
                    const cells = Array.from(row.cells);
                    const fragment = document.createDocumentFragment();
                    
                    for (let i = 0; i < finalOrder.length; i++) {
                        const colName = finalOrder[i];
                        const idx = headerMap.get(colName);
                        if (idx !== undefined && cells[idx]) {
                            const cell = cells[idx];
                            
                            // 处理隐藏
                            if (hiddenSet.has(colName)) {
                                cell.classList.add('mes-col-hidden');
                            } else {
                                cell.classList.remove('mes-col-hidden');
                            }

                            // 只对表头设置宽度
                            if (r === 0 && widths[colName]) {
                                cell.style.width = widths[colName] + 'px';
                            }
                            fragment.appendChild(cell);
                        }
                    }
                    row.textContent = '';
                    row.appendChild(fragment);
                }
            },

            applyCellInteractions: function(table) {
                const config = this.parentUI.config;
                const truncateLen = config.tbTruncateThreshold || 30;
                const dateFormatEnabled = config.dateFormatEnabled;
                const dateFormatString = config.dateFormatString;
                
                // [性能优化] 预先计算日期列索引
                const dateCols = new Set();
                const headerRow = table.rows[0];
                const headerCells = headerRow.cells;
                for (let i = 0; i < headerCells.length; i++) {
                    const txt = headerCells[i].innerText.toLowerCase();
                    if (txt.includes('time') || txt.includes('date')) {
                        dateCols.add(i);
                    }
                }

                // [性能优化] 使用 DocumentFragment 批量处理
                const rows = table.rows;
                const rowCount = rows.length;
                
                for (let rIdx = 1; rIdx < rowCount; rIdx++) {
                    const row = rows[rIdx];
                    const cells = row.cells;
                    const cellCount = cells.length;
                    
                    for (let cIdx = 0; cIdx < cellCount; cIdx++) {
                        const cell = cells[cIdx];
                        // [性能优化] 跳过已处理的单元格
                        if (cell.dataset.mesProcessed) continue;
                        cell.dataset.mesProcessed = '1';
                        
                        let text = cell.innerText.trim();
                        const originalHtml = cell.innerHTML.trim();
                        const hasHtmlTags = /<[^>]+>/.test(originalHtml);
                        const contentLength = hasHtmlTags ? originalHtml.length : text.length;

                        // 创建包装 div
                        const div = document.createElement('div');
                        div.className = 'mes-table-cell-fix';
                        
                        if (hasHtmlTags) {
                            div.innerHTML = originalHtml;
                        } else {
                            div.textContent = text; // [性能优化] 使用 textContent 替代 innerHTML
                        }

                        // 日期格式化
                        if (dateFormatEnabled && !hasHtmlTags && /^20\d{12}$/.test(text)) {
                            text = Utils.formatTimestamp(text, dateFormatString);
                            div.textContent = text;
                            div.classList.add('mes-date-cell');
                        }

                        // 清空并添加新内容
                        cell.textContent = '';
                        cell.appendChild(div);

                        // 截断处理
                        if (contentLength > truncateLen) {
                            div.classList.add('mes-truncated-cell');
                            div.dataset.fullText = text;
                            div.dataset.fullHtml = originalHtml;
                            div.dataset.hasHtml = hasHtmlTags ? '1' : '0';

                            // [性能优化] 使用事件委托替代每个单元格绑定事件
                            cell.dataset.mesTruncated = '1';
                        }
                    }
                }

                // [性能优化] 使用事件委托处理截断单元格的交互
                if (!table.dataset.mesEventBound) {
                    table.dataset.mesEventBound = '1';
                    const self = this;
                    
                    table.addEventListener('mouseenter', (e) => {
                        const cell = e.target.closest('td[data-mes-truncated="1"]');
                        if (!cell) return;
                        const div = cell.querySelector('.mes-truncated-cell');
                        if (!div || div.classList.contains('mes-search-expanded')) return;
                        const text = div.dataset.fullText || div.innerText;
                        self.parentUI.SmartTooltip.show(cell, text);
                    }, true);
                    
                    table.addEventListener('mouseleave', (e) => {
                        const cell = e.target.closest('td[data-mes-truncated="1"]');
                        if (cell) {
                            self.parentUI.SmartTooltip.hide();
                        }
                    }, true);
                    
                    table.addEventListener('click', (e) => {
                        if (e.target.tagName === 'A' || e.target.tagName === 'IMG') return;
                        const cell = e.target.closest('td[data-mes-truncated="1"]');
                        if (!cell) return;
                        const div = cell.querySelector('.mes-truncated-cell');
                        if (!div) return;
                        e.stopPropagation();
                        self.parentUI.SmartTooltip.hide();
                        const hasHtml = div.dataset.hasHtml === '1';
                        const content = hasHtml ? div.dataset.fullHtml : div.dataset.fullText;
                        self.parentUI.showDetailModal(content, hasHtml);
                    });
                }

                // 注入自定义搜索工具栏
                if (config.searchToolbarEnabled) {
                    this.injectSearchToolbar(table);
                }
            },

            // [新增] 自定义页内搜索工具栏
            injectSearchToolbar: function(table) {
                // 避免重复注入
                if (document.getElementById('mes-search-toolbar')) return;

                const self = this;
                const toolbar = document.createElement('div');
                toolbar.id = 'mes-search-toolbar';
                toolbar.innerHTML = `
                    <div class="mes-search-inner">
                        <span class="mes-search-icon">🔍</span>
                        <input type="text" id="mes-search-input" placeholder="表格内搜索..." autocomplete="off">
                        <span id="mes-search-count" class="mes-search-count"></span>
                        <button id="mes-search-prev" class="mes-search-nav" title="上一个 (Shift+Enter)">▲</button>
                        <button id="mes-search-next" class="mes-search-nav" title="下一个 (Enter)">▼</button>
                        <button id="mes-search-close" class="mes-search-close" title="关闭 (Esc)">✕</button>
                    </div>
                `;
                document.body.appendChild(toolbar);

                const input = document.getElementById('mes-search-input');
                const countEl = document.getElementById('mes-search-count');
                const prevBtn = document.getElementById('mes-search-prev');
                const nextBtn = document.getElementById('mes-search-next');
                const closeBtn = document.getElementById('mes-search-close');

                let matches = []; // 存储所有匹配的 mark 元素
                let currentIndex = -1;

                // 高亮关键词的函数
                const highlightKeyword = (div, keyword) => {
                    const fullText = div.dataset.fullText || div.innerText || '';
                    const hasHtml = div.dataset.hasHtml === '1';
                    const originalHtml = div.dataset.fullHtml || div.innerHTML;

                    // 如果是纯文本，直接高亮
                    if (!hasHtml) {
                        const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                        const highlighted = fullText.replace(regex, '<mark class="mes-keyword-highlight">$1</mark>');
                        div.innerHTML = highlighted;
                    } else {
                        // 有 HTML 标签的情况，只高亮文本节点
                        const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                        // 简单处理：先显示原始 HTML，再在文本部分高亮
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = originalHtml;
                        self.highlightTextNodes(tempDiv, regex);
                        div.innerHTML = tempDiv.innerHTML;
                    }

                    // 展开单元格
                    div.classList.add('mes-search-expanded');

                    // 返回这个 div 中所有的 mark 元素
                    return Array.from(div.querySelectorAll('mark.mes-keyword-highlight'));
                };

                // 搜索逻辑
                const doSearch = (keyword) => {
                    // 清除之前的高亮
                    self.clearSearchHighlight(table);
                    matches = [];
                    currentIndex = -1;

                    if (!keyword || keyword.length < 1) {
                        countEl.textContent = '';
                        return;
                    }

                    const lowerKeyword = keyword.toLowerCase();

                    // 遍历所有数据行
                    Array.from(table.rows).forEach((row, rIdx) => {
                        if (rIdx === 0) return; // 跳过表头

                        Array.from(row.cells).forEach((cell, cIdx) => {
                            const div = cell.querySelector('.mes-table-cell-fix');
                            if (!div) return;

                            // 获取完整内容（包括被截断的）
                            const fullText = (div.dataset.fullText || div.innerText || '').toLowerCase();
                            const fullHtml = (div.dataset.fullHtml || div.innerHTML || '').toLowerCase();

                            if (fullText.includes(lowerKeyword) || fullHtml.includes(lowerKeyword)) {
                                // 高亮关键词并收集 mark 元素
                                const marks = highlightKeyword(div, keyword);
                                marks.forEach(mark => {
                                    matches.push({ mark, cell, div, row });
                                });
                                cell.classList.add('mes-search-hit');
                            }
                        });
                    });

                    // 更新计数
                    if (matches.length > 0) {
                        currentIndex = 0;
                        countEl.textContent = `1/${matches.length}`;
                        self.scrollToMatch(matches[0]);
                    } else {
                        countEl.textContent = '0/0';
                    }
                };

                // 跳转到下一个
                const goNext = () => {
                    if (matches.length === 0) return;
                    // 移除当前高亮
                    if (currentIndex >= 0 && matches[currentIndex]) {
                        matches[currentIndex].mark.classList.remove('mes-keyword-current');
                        matches[currentIndex].cell.classList.remove('mes-search-current');
                    }
                    currentIndex = (currentIndex + 1) % matches.length;
                    countEl.textContent = `${currentIndex + 1}/${matches.length}`;
                    self.scrollToMatch(matches[currentIndex]);
                };

                // 跳转到上一个
                const goPrev = () => {
                    if (matches.length === 0) return;
                    if (currentIndex >= 0 && matches[currentIndex]) {
                        matches[currentIndex].mark.classList.remove('mes-keyword-current');
                        matches[currentIndex].cell.classList.remove('mes-search-current');
                    }
                    currentIndex = (currentIndex - 1 + matches.length) % matches.length;
                    countEl.textContent = `${currentIndex + 1}/${matches.length}`;
                    self.scrollToMatch(matches[currentIndex]);
                };

                // 关闭搜索
                const closeSearch = () => {
                    toolbar.classList.remove('mes-search-visible');
                    self.clearSearchHighlight(table);
                    input.value = '';
                    countEl.textContent = '';
                    matches = [];
                    currentIndex = -1;
                };

                // 绑定事件
                let debounceTimer;
                input.addEventListener('input', (e) => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => doSearch(e.target.value), 200);
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (e.shiftKey) goPrev();
                        else goNext();
                    } else if (e.key === 'Escape') {
                        closeSearch();
                    }
                });

                prevBtn.addEventListener('click', goPrev);
                nextBtn.addEventListener('click', goNext);
                closeBtn.addEventListener('click', closeSearch);

                // 监听 Ctrl+F，显示自定义搜索栏
                document.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                        // 检查当前页面是否有表格
                        if (table && table.rows.length > 1) {
                            e.preventDefault(); // 阻止浏览器默认搜索
                            toolbar.classList.add('mes-search-visible');
                            input.focus();
                            input.select();
                        }
                    }
                    if (e.key === 'Escape' && toolbar.classList.contains('mes-search-visible')) {
                        closeSearch();
                    }
                });
            },

            // 递归高亮文本节点中的关键词
            highlightTextNodes: function(element, regex) {
                const childNodes = Array.from(element.childNodes);
                childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = node.textContent;
                        if (regex.test(text)) {
                            const span = document.createElement('span');
                            span.innerHTML = text.replace(regex, '<mark class="mes-keyword-highlight">$1</mark>');
                            node.parentNode.replaceChild(span, node);
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'MARK') {
                        this.highlightTextNodes(node, regex);
                    }
                });
            },

            // 滚动到匹配项
            scrollToMatch: function(match) {
                if (!match) return;

                // 高亮当前关键词
                match.mark.classList.add('mes-keyword-current');
                match.cell.classList.add('mes-search-current');

                // 滚动到可视区域 - 滚动到 mark 元素
                match.mark.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            },

            // 清除搜索高亮
            clearSearchHighlight: function(table) {
                // 恢复原始内容
                table.querySelectorAll('.mes-search-expanded').forEach(div => {
                    const hasHtml = div.dataset.hasHtml === '1';
                    if (hasHtml) {
                        div.innerHTML = div.dataset.fullHtml || div.innerHTML;
                    } else {
                        const fullText = div.dataset.fullText || div.innerText;
                        div.innerHTML = Utils.escapeHtml(fullText);
                    }
                    div.classList.remove('mes-search-expanded');
                });
                table.querySelectorAll('.mes-search-hit').forEach(el => {
                    el.classList.remove('mes-search-hit');
                });
                table.querySelectorAll('.mes-search-current').forEach(el => {
                    el.classList.remove('mes-search-current');
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

                // 创建导出按钮
                const exportBtn = document.createElement('div');
                exportBtn.id = 'mes-export-btn';
                exportBtn.innerHTML = `<span>📥</span> 导出`;
                exportBtn.title = "导出表格数据";
                exportBtn.style.marginLeft = '8px';

                // 创建 Wrapper (inline-block)
                const wrapper = document.createElement('div');
                // margin-left: 10px 让它跟分页下拉框有点距离
                wrapper.style.cssText = "position:relative; display:inline-block; margin-left: 15px; vertical-align: middle;";
                wrapper.appendChild(btn);
                wrapper.appendChild(exportBtn);

                const menu = document.createElement('div');
                menu.id = 'mes-col-settings-menu';
                wrapper.appendChild(menu);

                // 导出菜单
                const exportMenu = document.createElement('div');
                exportMenu.id = 'mes-export-menu';
                exportMenu.style.cssText = menu.style.cssText;
                wrapper.appendChild(exportMenu);

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
                        // [修复] 动态获取当前表格，而不是使用闭包中的旧引用
                        const currentTable = document.querySelector('#tbDetail table');
                        if (!currentTable) {
                            alert('无法找到表格数据');
                            return;
                        }
                        this.renderMenuContent(menu, pageKey, currentTable);
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
                    if (!wrapper.contains(e.target)) {
                        menu.style.display = 'none';
                        exportMenu.style.display = 'none';
                    }
                });

                // 导出按钮事件
                exportBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isVisible = exportMenu.style.display === 'block';
                    if (!isVisible) {
                        // [修复] 动态获取当前表格，而不是使用闭包中的旧引用
                        const currentTable = document.querySelector('#tbDetail table');
                        if (!currentTable) {
                            alert('无法找到表格数据');
                            return;
                        }
                        this.renderExportMenu(exportMenu, currentTable);
                        exportMenu.style.display = 'block';
                        
                        // 智能定位（与视图菜单相同逻辑）
                        const rect = exportBtn.getBoundingClientRect();
                        const viewportHeight = window.innerHeight;
                        const viewportWidth = window.innerWidth;
                        
                        const spaceBelow = viewportHeight - rect.bottom;
                        const spaceAbove = rect.top;
                        
                        if (spaceAbove < 300 && spaceBelow > spaceAbove) {
                            exportMenu.style.top = '100%';
                            exportMenu.style.marginTop = '5px';
                            exportMenu.style.maxHeight = (spaceBelow - 20) + 'px';
                        } else {
                            exportMenu.style.bottom = '100%';
                            exportMenu.style.marginBottom = '5px';
                            exportMenu.style.maxHeight = Math.min(500, spaceAbove - 20) + 'px';
                        }
                        
                        if (rect.left > viewportWidth / 2) {
                            exportMenu.style.right = '0';
                        } else {
                            exportMenu.style.left = '0';
                        }
                    } else {
                        exportMenu.style.display = 'none';
                    }
                };
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

                    // 状态判断 - 使用列名而非索引
                    const isSortedAsc = this.sortState.colName === colName && this.sortState.direction === 'asc';
                    const isSortedDesc = this.sortState.colName === colName && this.sortState.direction === 'desc';
                    const hasFilter = this.filterState[colName] && this.filterState[colName].length > 0;

                    item.innerHTML = `
                        <span class="mes-col-drag-handle" title="拖拽排序">⋮⋮</span>
                        <input type="checkbox" id="${chkId}" class="mes-col-checkbox" ${!isHidden ? 'checked' : ''}>
                        <label for="${chkId}" class="mes-col-label" title="${colName}">${colName}</label>
                        <div class="mes-col-actions">
                            <span class="mes-action-btn sort-asc ${isSortedAsc ? 'active' : ''}" title="升序">⬆️</span>
                            <span class="mes-action-btn sort-desc ${isSortedDesc ? 'active' : ''}" title="降序">⬇️</span>
                            <input type="text" class="mes-filter-input ${hasFilter ? 'active' : ''}" placeholder="筛选" value="${this.filterState[colName] || ''}">
                        </div>
                    `;

                    // 绑定事件
                    item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                        this.toggleColumnVisibility(table, colName, !e.target.checked, pageKey);
                        this.updateBtnState(pageKey);
                    });

                    // 排序事件：使用列名
                    item.querySelector('.sort-asc').onclick = () => this.handleSortClick(table, colName, 'asc', pageKey, menu);
                    item.querySelector('.sort-desc').onclick = () => this.handleSortClick(table, colName, 'desc', pageKey, menu);

                    // 筛选：使用列名
                    const filterInput = item.querySelector('.mes-filter-input');
                    filterInput.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); });
                    filterInput.addEventListener('input', (e) => {
                        this.filterTableData(table, colName, e.target.value);
                        this.updateBtnState(pageKey);
                    });

                    this.bindDragEvents(item, list, table, pageKey);
                    list.appendChild(item);
                });
                menu.appendChild(list);

                menu.querySelector('#mes-reset-btn').onclick = () => {
                    if(confirm('恢复默认设置？（会清除所有宽度、顺序和筛选）')) {
                        // 清除持久化设置
                        delete this.settings[pageKey];
                        this.persist();
                        
                        // 清除运行时状态
                        this.sortState = { colName: '', direction: 'none' };
                        this.filterState = {};
                        
                        // 清除DOM标记，让表格重新处理
                        table.dataset.mesEnhanced = 'false';
                        
                        // 恢复所有列的显示
                        Array.from(table.rows).forEach(row => {
                            Array.from(row.cells).forEach(cell => {
                                cell.classList.remove('mes-col-hidden');
                            });
                        });
                        
                        // 清除筛选状态（显示所有行）
                        Array.from(table.querySelectorAll('tr:not(#trfirst)')).forEach(row => {
                            row.style.display = '';
                        });
                        
                        // 重新计算列宽
                        this.calculateAutoWidths(table, pageKey);
                        
                        // 重新应用设置（这会重置列宽）
                        this.applyColumnSettings(table, pageKey);
                        
                        // 更新按钮状态
                        this.updateBtnState(pageKey);
                        
                        // 重新渲染菜单
                        this.renderMenuContent(menu, pageKey, table);
                    }
                };
            },

            // [新增] 处理排序点击 (三态逻辑)
            handleSortClick: function(table, colName, direction, pageKey, menu) {
                // 如果点击的是当前已经激活的方向，则取消排序
                if (this.sortState.colName === colName && this.sortState.direction === direction) {
                    this.sortColumn(table, colName, 'none'); // 恢复默认
                } else {
                    this.sortColumn(table, colName, direction);
                }
                // 重新渲染菜单以更新高亮状态
                this.renderMenuContent(menu, pageKey, table);
                this.updateBtnState(pageKey);
            },

            // 根据列名获取当前列索引
            getColIndexByName: function(table, colName) {
                const headerCells = table.rows[0].cells;
                for (let i = 0; i < headerCells.length; i++) {
                    if (headerCells[i].innerText.trim() === colName) {
                        return i;
                    }
                }
                return -1;
            },

            sortColumn: function(table, colName, direction) {
                this.sortState = { colName: colName, direction: direction };
                
                // 动态获取当前列索引
                const colIdx = this.getColIndexByName(table, colName);
                if (colIdx === -1) return;

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

            filterTableData: function(table, colName, text) {
                this.filterState[colName] = text; // 使用列名保存状态
                
                // 构建列名到索引的映射
                const colNameToIdx = new Map();
                const headerCells = table.rows[0].cells;
                for (let i = 0; i < headerCells.length; i++) {
                    colNameToIdx.set(headerCells[i].innerText.trim(), i);
                }
                
                const rows = Array.from(table.querySelectorAll('tr:not(#trfirst)'));

                rows.forEach(row => {
                    // 需要同时满足所有列的筛选条件 (AND 逻辑)
                    let visible = true;
                    for (const [fColName, fText] of Object.entries(this.filterState)) {
                        if (!fText) continue;
                        const fIdx = colNameToIdx.get(fColName);
                        if (fIdx === undefined) continue;
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

            // 渲染导出菜单
            renderExportMenu: function(menu, table) {
                menu.innerHTML = `
                    <div class="mes-menu-header">
                        <span>导出数据</span>
                    </div>
                    <div class="mes-export-format-section">
                        <div class="mes-export-format-label">格式：</div>
                        <div class="mes-export-format-options">
                            <label class="mes-format-option">
                                <input type="radio" name="mes-export-format" value="tsv" checked>
                                <span>TSV</span>
                                <span class="mes-format-help">
                                    ?
                                    <span class="mes-format-tooltip">Tab分隔值，用制表符分隔列，适合Excel等表格软件</span>
                                </span>
                            </label>
                            <label class="mes-format-option">
                                <input type="radio" name="mes-export-format" value="csv">
                                <span>CSV</span>
                                <span class="mes-format-help">
                                    ?
                                    <span class="mes-format-tooltip">逗号分隔值，用逗号分隔列，最常用的表格格式</span>
                                </span>
                            </label>
                            <label class="mes-format-option">
                                <input type="radio" name="mes-export-format" value="txt">
                                <span>TXT</span>
                                <span class="mes-format-help">
                                    ?
                                    <span class="mes-format-tooltip">文本格式，用空格对齐列，适合阅读和打印</span>
                                </span>
                            </label>
                            <label class="mes-format-option">
                                <input type="radio" name="mes-export-format" value="json">
                                <span>JSON</span>
                                <span class="mes-format-help">
                                    ?
                                    <span class="mes-format-tooltip">JSON格式，结构化数据，适合程序处理</span>
                                </span>
                            </label>
                            <label class="mes-format-option">
                                <input type="radio" name="mes-export-format" value="excel">
                                <span>Excel</span>
                                <span class="mes-format-help">
                                    ?
                                    <span class="mes-format-tooltip">Excel格式（.xls），HTML表格格式，Excel可以直接打开并转换，完美支持中文</span>
                                </span>
                            </label>
                        </div>
                    </div>
                    <div class="mes-export-option">
                        <input type="checkbox" id="mes-export-filter-hidden" checked>
                        <label for="mes-export-filter-hidden">
                            过滤隐藏的列和行
                            <span class="mes-export-option-help">
                                ?
                                <span class="mes-export-option-help-tooltip">勾选后只导出当前可见的列和行，取消勾选则导出所有数据（包括被隐藏的列和筛选隐藏的行）</span>
                            </span>
                        </label>
                    </div>
                    <div class="mes-export-actions">
                        <button type="button" class="mes-export-action-btn" data-action="copy">📋 复制</button>
                        <button type="button" class="mes-export-action-btn" data-action="download">💾 下载</button>
                    </div>
                `;

                // [修复] 为 tooltip 添加动态定位（使用 fixed 定位避免被裁剪）
                menu.querySelectorAll('.mes-format-help, .mes-export-option-help').forEach(helpBtn => {
                    const tooltip = helpBtn.querySelector('.mes-format-tooltip, .mes-export-option-help-tooltip');
                    if (!tooltip) return;
                    
                    helpBtn.addEventListener('mouseenter', () => {
                        const rect = helpBtn.getBoundingClientRect();
                        const tooltipWidth = 200; // tooltip 大约宽度
                        let leftPos = rect.left + rect.width / 2;
                        
                        // 防止超出左边界
                        if (leftPos - tooltipWidth / 2 < 10) {
                            leftPos = tooltipWidth / 2 + 10;
                            tooltip.style.transform = 'translateX(-50%)';
                        }
                        // 防止超出右边界
                        if (leftPos + tooltipWidth / 2 > window.innerWidth - 10) {
                            leftPos = window.innerWidth - tooltipWidth / 2 - 10;
                        }
                        
                        tooltip.style.left = leftPos + 'px';
                        tooltip.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
                    });
                });

                const self = this;
                menu.querySelectorAll('.mes-export-action-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        // [关键修复] 阻止默认行为和事件冒泡，防止页面刷新
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        
                        const format = menu.querySelector('input[name="mes-export-format"]:checked').value;
                        const action = btn.dataset.action;
                        const filterHidden = menu.querySelector('#mes-export-filter-hidden').checked;
                        
                        // [修复] 使用 setTimeout 确保事件处理完成后再执行导出
                        setTimeout(() => {
                            self.exportTable(table, format, action, filterHidden);
                        }, 0);
                        
                        // [修复] 延迟关闭菜单，避免影响导出操作
                        setTimeout(() => {
                            menu.style.display = 'none';
                        }, 100);
                    });
                });
            },

            // 导出表格数据
            exportTable: function(table, format, action = 'download', filterHidden = true) {
                // [修复] 使用 try-catch 保护，确保不会影响表格显示
                try {
                    // [修复] 在操作前先保存表格引用，防止表格被意外修改
                    const tbDetail = table.closest('#tbDetail');
                    if (!tbDetail || !table) {
                        alert('无法找到表格数据');
                        return;
                    }

                    // [修复] 使用快照方式获取数据，避免影响原始表格
                    const rows = Array.from(table.rows);
                    if (rows.length === 0) {
                        alert('表格为空，无法导出');
                        return;
                    }

                    // 获取表头（使用快照）
                    const headers = Array.from(rows[0].cells).map(cell => {
                        return cell.innerText.trim();
                    });

                    // 获取数据行（使用快照）
                    const dataRows = [];
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        // 根据选项决定是否跳过隐藏的行
                        if (filterHidden && row.style.display === 'none') continue;
                        
                        const cells = Array.from(row.cells);
                        const rowData = [];
                        
                        cells.forEach((cell, idx) => {
                            // 根据选项决定是否跳过隐藏的列
                            if (filterHidden && cell.classList.contains('mes-col-hidden')) return;
                            
                            // 获取单元格文本（去除HTML标签）
                            let text = cell.innerText || cell.textContent || '';
                            // 清理文本：去除多余空白
                            text = text.trim().replace(/\s+/g, ' ');
                            rowData.push(text);
                        });
                        
                        if (rowData.length > 0) {
                            dataRows.push(rowData);
                        }
                    }

                    // 过滤表头
                    const visibleHeaders = [];
                    Array.from(rows[0].cells).forEach((cell, idx) => {
                        if (!filterHidden || !cell.classList.contains('mes-col-hidden')) {
                            visibleHeaders.push(headers[idx]);
                        }
                    });

                let content = '';
                let filename = '';
                let mimeType = '';

                switch (format) {
                    case 'tsv':
                        content = this.formatAsTSV([visibleHeaders, ...dataRows]);
                        filename = `table_${new Date().getTime()}.tsv`;
                        mimeType = 'text/tab-separated-values';
                        break;

                    case 'csv':
                        content = this.formatAsCSV([visibleHeaders, ...dataRows]);
                        filename = `table_${new Date().getTime()}.csv`;
                        mimeType = 'text/csv;charset=utf-8';
                        break;

                    case 'txt':
                        content = this.formatAsTXT([visibleHeaders, ...dataRows]);
                        filename = `table_${new Date().getTime()}.txt`;
                        mimeType = 'text/plain;charset=utf-8';
                        break;

                    case 'json':
                        const jsonData = dataRows.map(row => {
                            const obj = {};
                            visibleHeaders.forEach((header, idx) => {
                                obj[header] = row[idx] || '';
                            });
                            return obj;
                        });
                        content = JSON.stringify(jsonData, null, 2);
                        filename = `table_${new Date().getTime()}.json`;
                        mimeType = 'application/json;charset=utf-8';
                        break;

                    case 'excel':
                        // Excel格式：生成HTML格式，Excel可以直接打开
                        content = this.formatAsExcel([visibleHeaders, ...dataRows]);
                        filename = `table_${new Date().getTime()}.xls`;
                        mimeType = 'application/vnd.ms-excel';
                        break;
                }

                    // 根据操作类型执行
                    if (action === 'copy') {
                        // [修复] 使用异步方式复制，避免阻塞
                        Utils.copyText(content, () => {
                            setTimeout(() => {
                                this.showExportSuccess(`已复制到剪贴板 (${format.toUpperCase()})`);
                            }, 50);
                        });
                    } else {
                        // [修复] 使用异步方式下载，避免阻塞
                        setTimeout(() => {
                            this.downloadFile(content, filename, mimeType);
                            setTimeout(() => {
                                this.showExportSuccess(`已导出为 ${filename}`);
                            }, 100);
                        }, 50);
                    }
                } catch (error) {
                    console.error('导出失败:', error);
                    alert('导出失败，请重试');
                }
            },

            // 检查是否是需要保护的长数字（防止Excel科学计数法）
            isLongNumber: function(text) {
                // 纯数字且长度超过11位（Excel对超过11位的数字会用科学计数法）
                return /^\d{12,}$/.test(text);
            },

            // 格式化为TSV
            formatAsTSV: function(rows) {
                return rows.map(row => {
                    return row.map(cell => {
                        // 转义TSV特殊字符
                        let text = String(cell || '').replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '');
                        // [修复] 长数字加前缀防止Excel科学计数法
                        if (this.isLongNumber(text)) {
                            text = "'" + text; // 加单引号前缀，Excel会识别为文本
                        }
                        return text;
                    }).join('\t');
                }).join('\n');
            },

            // 格式化为CSV
            formatAsCSV: function(rows) {
                return rows.map(row => {
                    return row.map(cell => {
                        let text = String(cell || '');
                        // [修复] 长数字用="xxx"格式，强制Excel识别为文本
                        if (this.isLongNumber(text)) {
                            return '="' + text + '"';
                        }
                        // CSV转义：如果包含逗号、引号或换行，需要用引号包裹，并转义引号
                        if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
                            return '"' + text.replace(/"/g, '""') + '"';
                        }
                        return text;
                    }).join(',');
                }).join('\n');
            },

            // 格式化为TXT（空格分隔）
            formatAsTXT: function(rows) {
                // 计算每列的最大宽度
                const colWidths = [];
                rows.forEach(row => {
                    row.forEach((cell, idx) => {
                        const width = String(cell || '').length;
                        if (!colWidths[idx] || width > colWidths[idx]) {
                            colWidths[idx] = width;
                        }
                    });
                });

                // 格式化输出
                return rows.map(row => {
                    return row.map((cell, idx) => {
                        const text = String(cell || '');
                        const width = colWidths[idx] || 10;
                        return text.padEnd(width, ' ');
                    }).join('  '); // 两空格分隔
                }).join('\n');
            },

            // 格式化为Excel（HTML格式，Excel可以打开）
            formatAsExcel: function(rows) {
                // 使用HTML表格格式，Excel可以直接打开HTML文件并转换为Excel格式
                // 这是最兼容的方式，支持中文且不需要额外的库
                let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>导出数据</title></head><body><table border="1">';
                
                rows.forEach((row, rowIdx) => {
                    html += '<tr>';
                    row.forEach(cell => {
                        const cellValue = String(cell || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        const tag = rowIdx === 0 ? 'th' : 'td';
                        html += `<${tag}>${cellValue}</${tag}>`;
                    });
                    html += '</tr>';
                });
                
                html += '</table></body></html>';
                
                // 使用UTF-8 BOM确保中文正确显示
                return '\uFEFF' + html;
            },

            // 下载文件
            downloadFile: function(content, filename, mimeType) {
                // [修复] 创建Blob，确保编码正确
                const blob = new Blob([content], { type: mimeType });
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                // [关键修复] 设置 target 为 _blank 防止页面跳转
                a.target = '_blank';
                // [关键修复] 添加 rel 属性，防止安全问题
                a.rel = 'noopener noreferrer';
                
                document.body.appendChild(a);
                
                // [关键修复] 使用 setTimeout 确保 DOM 更新完成，并阻止默认行为
                setTimeout(() => {
                    // 创建鼠标事件来触发下载，而不是直接 click
                    const event = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    a.dispatchEvent(event);
                    
                    // [修复] 延迟移除，确保下载完成
                    setTimeout(() => {
                        if (a.parentElement) {
                            document.body.removeChild(a);
                        }
                        URL.revokeObjectURL(url);
                    }, 200);
                }, 10);
            },

            // 显示导出成功提示
            showExportSuccess: function(message) {
                // 移除之前的提示（如果存在）
                const existingTip = document.getElementById('mes-export-success-tip');
                if (existingTip) {
                    existingTip.remove();
                }

                const tip = document.createElement('div');
                tip.id = 'mes-export-success-tip';
                tip.textContent = '✅ ' + message;
                tip.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #52c41a;
                    color: white;
                    padding: 10px 16px;
                    border-radius: 4px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 1000001;
                    font-family: "Segoe UI", sans-serif;
                    font-size: 13px;
                    animation: mesSlideInRight 0.3s ease-out;
                    pointer-events: none;
                `;
                
                // 添加动画样式
                if (!document.getElementById('mes-export-anim-style')) {
                    const style = document.createElement('style');
                    style.id = 'mes-export-anim-style';
                    style.textContent = `
                        @keyframes mesSlideInRight {
                            from {
                                transform: translateX(100%);
                                opacity: 0;
                            }
                            to {
                                transform: translateX(0);
                                opacity: 1;
                            }
                        }
                    `;
                    document.head.appendChild(style);
                }
                
                document.body.appendChild(tip);
                
                // 延长显示时间到3.5秒，让用户看清楚
                setTimeout(() => {
                    tip.style.opacity = '0';
                    tip.style.transition = 'opacity 0.4s ease-out';
                    setTimeout(() => {
                        if (tip.parentElement) {
                            tip.remove();
                        }
                    }, 400);
                }, 3500);
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

        showDetailModal: function(content, isHtml = false) {
            const container = document.getElementById('mes-modal-container');
            if (!container) return;

            // 根据是否是 HTML 内容决定显示方式
            const displayContent = isHtml ? content : Utils.escapeHtml(content);
            const titleIcon = isHtml ? '🔗' : '📄';
            const titleText = isHtml ? '完整内容 (含链接)' : '完整内容';

            container.innerHTML = `<div class="mes-modal-overlay" id="mes-modal-close-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;justify-content:center;align-items:center;"><div class="mes-modal-content" style="background:white;padding:20px;border-radius:8px;width:600px;max-height:80vh;display:flex;flex-direction:column;"><div style="display:flex;justify-content:space-between;margin-bottom:15px;border-bottom:1px solid #eee;"><h3 style="margin:0;color:#0078d7;">${titleIcon} ${titleText}</h3><span id="mes-modal-close-btn" style="cursor:pointer;font-size:24px;">×</span></div><div id="mes-modal-text" style="flex:1;overflow-y:auto;padding:10px;background:#f9f9f9;border:1px solid #eee;white-space:pre-wrap;word-break:break-all;">${displayContent}</div><div style="margin-top:15px;text-align:right;"><span id="mes-copy-tip" style="color:green;margin-right:10px;opacity:0;transition:opacity 0.5s;">✅ 已复制!</span><button id="mes-btn-copy" style="padding:6px 15px;background:#0078d7;color:white;border:none;border-radius:4px;cursor:pointer;">复制</button></div></div></div>`;
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
                if (href.toLowerCase().startsWith('javascript') || (target !== 'mainFrame' && !link.classList.contains('a02'))) {
                    link.dataset.mesBound = "ignored";
                    return;
                }
                link.dataset.mesBound = "true";
                link.addEventListener('click', function () {
                    document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                    this.classList.add('mes-highlight');
                    const saveHref = href.replace(/^(\.\/|\/)/, '');
                    // 检查扩展上下文是否有效
                    if (Utils.isExtensionValid()) {
                        chrome.storage.local.set({'mes_last_selected_href': saveHref});
                    }
                });
            });
        },

        restoreMenu: function() {
            if (!Utils.isExtensionValid()) return;
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
                            p.style.display = 'block';
                            const idx = p.id.match(/^treeFuncn(\d+)Nodes$/)[1];
                            const toggle = document.getElementById('treeFunct' + idx);
                            if(toggle) toggle.classList.add('mes-menu-open');
                        }
                        p = p.parentElement;
                    }
                    link.scrollIntoView({block: 'center', behavior: 'smooth'});
                }
            });
        },

        // 主入口 - 处理表格
        fixTable: function () {
            if (!this.config.tbFixEnabled) return;
            this.TableManager.process();
        }
    };

    // ==========================================
    // 主程序入口 (Main)
    // ==========================================
    async function init() {
        console.log('[MES-Core] 初始化...');

        // 检查扩展上下文是否有效
        if (!Utils.isExtensionValid()) {
            console.warn('[MES-Core] 扩展上下文已失效，跳过初始化');
            return;
        }

        // 0. [关键修复] 如果当前是主页 (Index.aspx)，说明用户已经正常登录进来了
        // 必须清除之前的"手动退出"标记，否则下次过期时插件会以为用户还想退出
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

        // 4. 检查是否需要自动"重试查询" (回显数据 + 点击查询)
        AuthModule.checkAutoRetry();

        // 5. 环境判断与循环任务
        const path = location.pathname.toLowerCase();
        const isTop = path.includes('top.aspx');

        // 6. 执行逻辑
        if (isTop) {
            // Top 页只需要绑定一次退出，不需要 setInterval 循环检测
            AuthModule.bindLogout();
        }

        // 菜单页面处理 - 需要等待 DOM 加载
        Utils.waitDOM(() => {
            const isMenu = path.includes('left') || document.querySelector('#treeFunc');
            if (isMenu) {
                UIModule.bindMenu();
                setTimeout(() => UIModule.restoreMenu(), 500);
                
                const menuContainer = document.querySelector('#treeFunc');
                if (menuContainer) {
                    const menuObserver = new MutationObserver(() => {
                        UIModule.bindMenu();
                    });
                    menuObserver.observe(menuContainer, { childList: true, subtree: true });
                }
            }
        });

        // 表格页面处理 - 需要等待 DOM 加载
        Utils.waitDOM(() => {
            const isMain = path.includes('basicquery') || document.querySelector('#tbDetail');
            if (!isMain) return;
            
            UIModule.fixTable(); // 首次执行
            
            const tbDetail = document.getElementById('tbDetail');
            if (tbDetail) {
                const tableObserver = new MutationObserver((mutations) => {
                    // 只在有实际内容变化时处理
                    const hasTableChange = mutations.some(m => 
                        m.type === 'childList' && 
                        (m.addedNodes.length > 0 || m.removedNodes.length > 0)
                    );
                    if (hasTableChange) {
                        UIModule.fixTable();
                    }
                });
                tableObserver.observe(tbDetail, { childList: true, subtree: true });
            } else if (document.body) {
                // 如果 tbDetail 还不存在，等待它出现
                const bodyObserver = new MutationObserver((mutations, obs) => {
                    const tb = document.getElementById('tbDetail');
                    if (tb) {
                        obs.disconnect();
                        UIModule.fixTable();
                        const tableObserver = new MutationObserver((muts) => {
                            const hasTableChange = muts.some(m => 
                                m.type === 'childList' && 
                                (m.addedNodes.length > 0 || m.removedNodes.length > 0)
                            );
                            if (hasTableChange) {
                                UIModule.fixTable();
                            }
                        });
                        tableObserver.observe(tb, { childList: true, subtree: true });
                    }
                });
                bodyObserver.observe(document.body, { childList: true, subtree: true });
            }
        });
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
    if (Utils.isExtensionValid()) {
        chrome.storage.onChanged.addListener((changes) => {
            if (!Utils.isExtensionValid()) return;
            if (changes.mes_config) {
                UIModule.config = {...ConfigModule.default, ...changes.mes_config.newValue};
                UIModule.injectStyles();
                // 重置表格处理状态，以便重新格式化
                document.querySelectorAll('#tbDetail td').forEach(td => delete td.dataset.mesProcessed);
            }
        });
    }

    // 启动！
    init();

})();
