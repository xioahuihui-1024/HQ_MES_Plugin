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
        handleExpired: async function(requestPayload = null) {
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
            if (!cfg.keepAliveEnabled) { this.isHandling = false; return; }

            const storage = await new Promise(r => chrome.storage.local.get(['mes_manual_logout'], r));
            if (storage.mes_manual_logout) { this.isHandling = false; return; }

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
        checkAutoRetry: function() {
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
                            if(!document.getElementById('mes-anim-style')) {
                                const style = document.createElement('style');
                                style.id = 'mes-anim-style';
                                style.innerHTML = `@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`;
                                document.head.appendChild(style);
                            }

                            document.body.appendChild(bar);

                            // 延长到 8 秒后自动消失，让用户看清楚
                            setTimeout(() => { if(bar.parentElement) bar.remove(); }, 8000);
                        });
                    }, 1500);
                } catch(e) {
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
            // 初始化 Tooltip DOM
            this.SmartTooltip.init();

            Utils.waitDOM(() => {
                this.setupModalContainer();
            });
        },

        // [修改] 样式注入：解决表格换行问题，美化 Tooltip
        injectStyles: function () {
            Utils.waitDOM(() => {
                let style = document.getElementById('mes-dynamic-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'mes-dynamic-style';
                    document.head.appendChild(style);
                }
                const cfg = this.config;
                style.textContent = `
                    /* 基础高亮 */
                    .mes-highlight { background-color: ${cfg.highlightBackground || '#eef'} !important; color: ${cfg.highlightColor} !important; border: 1px solid ${cfg.highlightColor}; border-radius: 4px; padding: 2px 5px !important; }
                    .mes-highlight::before { content: '▶'; position: absolute; left: -12px; font-size: 10px; color: ${cfg.highlightColor}; }
                    
                    /* 表格优化核心 */
                    #tbDetail table { table-layout: fixed; width: 100%; } /* 建议开启固定布局，性能更好 */
                    
                    /* 强制所有单元格内容单行显示，超出部分在 JS 里处理截断 */
                    .mes-table-cell-fix { 
                        white-space: nowrap !important; 
                        overflow: hidden; 
                        text-overflow: ellipsis;
                        padding: 4px 8px !important; /* 增加一点呼吸感 */
                        height: 25px; /* 固定高度防止抖动 */
                    }

                    .mes-date-cell { font-family: Consolas, monospace; color: #666; }
                    
                    /* 截断列的样式 */
                    .mes-truncated-cell { 
                        cursor: help; 
                        background-color: rgba(0,0,0,0.02);
                        transition: background-color 0.2s;
                    }
                    .mes-truncated-cell:hover { background-color: rgba(0, 120, 215, 0.1); }
                    
                    /* 表格高度修正 */
                    #tbDetail { ${cfg.tbFixEnabled ? `min-height: ${cfg.tbMinHeight}px !important; height: auto !important;` : ''} }

                    /* === Smart Tooltip 样式 (仿大厂风格) === */
                    #mes-smart-tooltip {
                        position: fixed;
                        z-index: 100000;
                        background: rgba(0, 0, 0, 0.85);
                        color: #fff;
                        padding: 8px 12px;
                        border-radius: 4px;
                        font-size: 12px;
                        line-height: 1.5;
                        max-width: 400px;
                        word-wrap: break-word;
                        pointer-events: none; /* 让鼠标穿透，防止闪烁 */
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                        opacity: 0;
                        transition: opacity 0.15s, transform 0.1s;
                        font-family: "Segoe UI", sans-serif;
                    }
                    /* 小箭头 */
                    #mes-smart-tooltip::after {
                        content: '';
                        position: absolute;
                        border-width: 5px;
                        border-style: solid;
                    }
                    /* 箭头朝下 (Tooltip 在上方) */
                    #mes-smart-tooltip.is-top::after {
                        bottom: -10px; left: 50%; transform: translateX(-50%);
                        border-color: rgba(0,0,0,0.85) transparent transparent transparent;
                    }
                    /* 箭头朝上 (Tooltip 在下方) */
                    #mes-smart-tooltip.is-bottom::after {
                        top: -10px; left: 50%; transform: translateX(-50%);
                        border-color: transparent transparent rgba(0,0,0,0.85) transparent;
                    }
                `;
            });
        },

        // [新增] 智能 Tooltip 子模块
        SmartTooltip: {
            el: null,
            timer: null,

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

                // 1. 设置内容
                this.el.textContent = content;
                this.el.style.opacity = '1';

                // 2. 计算位置 (核心算法)
                const rect = target.getBoundingClientRect(); // 获取目标单元格的位置
                const tooltipRect = this.el.getBoundingClientRect(); // 获取 Tooltip 自身的大小

                const gap = 8; // 间距
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                // 默认位置：居中显示在目标下方
                let top = rect.bottom + gap;
                let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                let placement = 'bottom';

                // 3. 边界检测与修正

                // A. 垂直方向检测
                // 如果下方空间不够，改为显示在上方
                if (top + tooltipRect.height > viewportHeight) {
                    top = rect.top - tooltipRect.height - gap;
                    placement = 'top';
                }

                // B. 水平方向检测
                // 如果左边溢出
                if (left < 10) {
                    left = 10;
                    // 这里如果要做到箭头依然对准，需要复杂的 CSS 变量，简单起见先保证框体不溢出
                }
                // 如果右边溢出
                else if (left + tooltipRect.width > viewportWidth - 10) {
                    left = viewportWidth - tooltipRect.width - 10;
                }

                // 4. 应用样式
                this.el.style.top = top + 'px';
                this.el.style.left = left + 'px';

                // 设置箭头方向类
                this.el.className = 'is-' + placement;
            },

            hide: function() {
                if (!this.el) return;
                // 稍微延迟隐藏，防止鼠标快速划过时的闪烁
                this.timer = setTimeout(() => {
                    this.el.style.opacity = '0';
                }, 100);
            }
        },

        // ... setupModalContainer, showOverlay, showDetailModal 保持不变 ...
        setupModalContainer: function() { /*...*/ },
        showOverlay: function(msg, isError) { /*...*/ },
        showDetailModal: function(content) { /*...*/ },
        bindMenu: function() { /*...*/ },
        restoreMenu: function() { /*...*/ },

        // [修改] 表格优化逻辑：应用新样式和智能 Tooltip
        fixTable: function () {
            if (!this.config.tbFixEnabled) return;
            const tb = document.getElementById('tbDetail');
            if (!tb) return;
            tb.style.height = "auto";

            const tableEl = tb.querySelector('table');
            if (!tableEl) return;

            // 识别日期列
            if (!this.dateCols) this.dateCols = [];
            const headerRow = tableEl.querySelector('tr#trfirst') || tableEl.querySelector('tr');
            if (headerRow && this.dateCols.length === 0) {
                headerRow.querySelectorAll('td, th').forEach((th, idx) => {
                    const txt = th.innerText.toLowerCase();
                    if (txt.includes('time') || txt.includes('date')) this.dateCols.push(idx);
                });
            }

            // 处理数据行
            tableEl.querySelectorAll('tr:not(#trfirst) td').forEach((cell, idx) => {
                if (cell.dataset.mesProcessed) return;

                let text = cell.innerText.trim();

                // 1. 统一加上防止换行的类
                cell.classList.add('mes-table-cell-fix');

                // 2. 日期格式化
                if (this.config.dateFormatEnabled) {
                    const isTime = /^20\d{12}$/.test(text);
                    if (isTime || (this.dateCols.includes(idx) && isTime)) {
                        text = Utils.formatTimestamp(text, this.config.dateFormatString);
                        cell.innerText = text;
                        cell.classList.add('mes-date-cell');
                    }
                }

                // 3. 截断与智能 Tooltip
                if (text.length > this.config.tbTruncateThreshold) {
                    cell.classList.add('mes-truncated-cell');
                    // 移除原生的 title，防止双重提示
                    cell.removeAttribute('title');

                    // 绑定智能 Tooltip 事件
                    cell.addEventListener('mouseenter', (e) => {
                        this.SmartTooltip.show(e.target, text);
                    });
                    cell.addEventListener('mouseleave', () => {
                        this.SmartTooltip.hide();
                    });

                    // 点击依然弹出完整模态框
                    cell.onclick = (e) => {
                        e.stopPropagation();
                        // 点击时隐藏 Tooltip
                        this.SmartTooltip.hide();
                        this.showDetailModal(text);
                    };
                }
                cell.dataset.mesProcessed = "true";
            });
        }
    };

    // --- 4. 配置管理模块 (Config) ---
    const ConfigModule = {
        default: {
            keepAliveEnabled: false,
            highlightEnabled: true,
            highlightColor: '#0078d7',
            highlightBackground: 'rgba(0,120,215,0.08)',
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