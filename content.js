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
        waitDOM: function(callback) {
            if (document.body && document.readyState !== 'loading') {
                callback();
            } else {
                document.addEventListener('DOMContentLoaded', callback);
            }
        },
        // 复制到剪贴板
        copyText: function(text, onSuccess) {
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
                    if(document.execCommand('copy')) onSuccess();
                } catch (e) {}
                document.body.removeChild(textArea);
            }
        },
        // HTML 转义
        escapeHtml: function(unsafe) {
            return (unsafe || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        },
        // 时间格式化
        formatTimestamp: function(raw, formatStr) {
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

        // 检查页面是否是服务端返回的错误页
        checkDomExpiry: function() {
            Utils.waitDOM(() => {
                const text = document.body.innerText;
                const html = document.body.innerHTML;
                // 特征：没有用户状态 + Login.aspx 链接
                if (text.includes("没有用户状态") && html.includes("Login.aspx")) {
                    console.warn('🛑 [Auth] 页面加载了服务端过期提示，准备重登');
                    this.handleExpired(false);
                }
            });
        },

        // 处理 Session 过期
        // saveCurrentForm: 是否尝试保存当前页面的表单数据 (AJAX拦截时需要，DOM检测时通常不需要)
        handleExpired: async function(saveCurrentForm = true) {
            if (this.isHandling) return;
            this.isHandling = true;

            const cfg = await ConfigModule.load();
            if (!cfg.keepAliveEnabled) {
                this.isHandling = false;
                return;
            }

            // 检查手动退出标记
            const storage = await new Promise(r => chrome.storage.local.get(['mes_manual_logout'], r));
            if (storage.mes_manual_logout) {
                console.log('🚫 [Auth] 检测到手动退出标记 (mes_manual_logout=true)，暂停保活');
                // 这里加一个提示，方便调试知道为什么不自动登
                // UIModule.showOverlay("已手动退出，暂停自动登录", true);
                this.isHandling = false;
                return;
            }

            console.log('🔄 [Auth] 执行无感刷新...');
            if (saveCurrentForm) this.saveFormState();
            UIModule.showOverlay("会话过期，正在自动续期...", false);

            if (cfg.username && cfg.password) {
                chrome.runtime.sendMessage({
                    action: "DO_LOGIN",
                    data: {username: cfg.username, password: cfg.password}
                }, (response) => {
                    this.isHandling = false;
                    if (response && response.success) {
                        console.log('✅ [Auth] 续期成功');
                        // 登录成功，务必清除“手动退出”标记，防止下次误判 [关键!]
                        chrome.storage.local.remove('mes_manual_logout');

                        if (document.getElementById('btnQuery') || sessionStorage.getItem('MES_FORM_DATA')) {
                            sessionStorage.setItem('MES_AUTO_RETRY', 'true');
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

        // 保存表单数据到 SessionStorage
        saveFormState: function() {
            try {
                const formData = {};
                // 保存查询类型下拉框
                const ddlQuery = document.getElementById('ddlQueryType');
                if (ddlQuery) formData['ddlQueryType'] = ddlQuery.value;

                // 保存所有文本输入框 (日期、时间、动态生成的条件)
                document.querySelectorAll('input[type="text"], select').forEach(el => {
                    if (el.id) {
                        formData[el.id] = el.value;
                    }
                });

                if (Object.keys(formData).length > 0) {
                    sessionStorage.setItem('MES_FORM_DATA', JSON.stringify(formData));
                    console.log('💾 [Auth] 查询条件已保存');
                }
            } catch (e) {
                console.warn('保存表单失败', e);
            }
        },

        // 恢复表单数据
        restoreFormState: function() {
            const dataStr = sessionStorage.getItem('MES_FORM_DATA');
            if (!dataStr) return;

            try {
                const formData = JSON.parse(dataStr);
                let restoreCount = 0;

                // 1. 先恢复下拉框 (QueryType)
                if (formData['ddlQueryType']) {
                    const ddl = document.getElementById('ddlQueryType');
                    if (ddl && ddl.value !== formData['ddlQueryType']) {
                        ddl.value = formData['ddlQueryType'];
                        // 触发 change 事件，让原网页 JS (jsbasequery.js) 去加载对应的动态输入框
                        // 注意：原网页加载动态输入框是 AJAX，所以我们需要延迟恢复其他字段
                        const event = new Event('change');
                        ddl.dispatchEvent(event);
                    }
                }

                // 2. 延迟恢复其他输入框 (给原网页一点时间生成 DOM)
                setTimeout(() => {
                    for (const [id, value] of Object.entries(formData)) {
                        if (id === 'ddlQueryType') continue;
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = value;
                            restoreCount++;
                        }
                    }
                    console.log(`♻️ [Auth] 已恢复 ${restoreCount} 个查询条件`);
                    sessionStorage.removeItem('MES_FORM_DATA'); // 用完即焚
                }, 800); // 延迟 800ms，等待动态表单生成

            } catch (e) {
                console.warn('恢复表单失败', e);
            }
        },

        // 检查并执行自动重试
        checkAutoRetry: function() {
            if (sessionStorage.getItem('MES_AUTO_RETRY') === 'true') {
                console.log('🚀 [Auth] 检测到自动重试标记...');
                sessionStorage.removeItem('MES_AUTO_RETRY');

                // 1. 先尝试回显数据
                this.restoreFormState();

                // 2. 延迟点击查询按钮 (等待数据回显完毕)
                setTimeout(() => {
                    const btn = document.getElementById('btnQuery');
                    if (btn) {
                        console.log('👆 [Auth] 自动点击查询按钮');
                        btn.click();

                        // 显示提示
                        const tip = document.createElement('div');
                        tip.innerText = '已为您自动恢复条件并查询';
                        tip.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#e1f3d8;color:#67c23a;padding:5px 10px;border-radius:4px;z-index:999999;font-size:12px;border:1px solid #c2e7b0;box-shadow:0 2px 10px rgba(0,0,0,0.1);animation: fadeInOut 3s forwards;';
                        document.body.appendChild(tip);
                        setTimeout(() => tip.remove(), 3000);
                    }
                }, 1500); // 1.5秒后点击，给 DOM 生成和赋值留足时间
            }
        },

        // [优化] 绑定退出按钮：只在 Top.aspx 中执行，且只绑定一次
        bindLogout: function() {
            // 1. 性能优化：只在头部 Frame 检测
            if (!location.pathname.toLowerCase().includes('top.aspx')) return;

            console.log('绑定退出按钮 页面 找到了')
            // 2. 精准定位：根据你提供的 HTML 结构查找
            Utils.waitDOM(() => {
                // 查找包含“退出”字样或链接到 Login.aspx 的 A 标签
                const exitLinks = document.querySelectorAll('a[href*="Login.aspx"]');

                exitLinks.forEach(link => {
                    if (link.dataset.mesLogoutBound) return; // 防止重复绑定

                    // 再次确认文本内容，防止误伤
                    if (link.innerText.includes("退出")) {
                        console.log('Found Logout Button:', link); // 调试用
                        link.dataset.mesLogoutBound = "true";
                        console.log('绑定退出按钮 绑定成功')
                        link.addEventListener('click', () => {
                            console.log('👋 用户点击了退出，标记手动退出状态');
                            chrome.runtime.sendMessage({action: "MANUAL_LOGOUT"});
                        });
                    }
                });
            });
        }
    };

    // --- 3. 界面增强模块 (UI) ---
    const UIModule = {
        config: {}, // 缓存配置

        init: function(cfg) {
            this.config = cfg;
            this.injectStyles();

            // 安全等待 DOM 后执行
            Utils.waitDOM(() => {
                this.setupModalContainer();
            });
        },

        // 注入 CSS
        injectStyles: function() {
            Utils.waitDOM(() => {
                let style = document.getElementById('mes-dynamic-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'mes-dynamic-style';
                    document.head.appendChild(style);
                }
                const cfg = this.config;
                style.textContent = `
                    .mes-highlight { background-color: ${cfg.highlightBackground || '#eef'} !important; color: ${cfg.highlightColor} !important; border: 1px solid ${cfg.highlightColor}; border-radius: 4px; padding: 2px 5px !important; }
                    .mes-highlight::before { content: '▶'; position: absolute; left: -12px; font-size: 10px; color: ${cfg.highlightColor}; }
                    .mes-date-cell { white-space: nowrap !important; font-family: Consolas, monospace; color: #666; }
                    .mes-truncated-cell { max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
                    .mes-truncated-cell:hover { background-color: rgba(0, 120, 215, 0.1); }
                    #tbDetail { ${cfg.tbFixEnabled ? `min-height: ${cfg.tbMinHeight}px !important; height: auto !important;` : ''} }
                `;
            });
        },

        // 初始化模态框容器
        setupModalContainer: function() {
            if (!document.getElementById('mes-modal-container')) {
                const c = document.createElement('div');
                c.id = 'mes-modal-container';
                document.body.appendChild(c);
            }
        },

        // 显示遮罩
        showOverlay: function(msg, isError) {
            Utils.waitDOM(() => {
                let overlay = document.getElementById('mes-relogin-overlay');
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'mes-relogin-overlay';
                    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255, 255, 255, 0.95); z-index: 999999; display: flex; justify-content: center; align-items: center; font-size: 20px; color: #333; font-family: "Segoe UI"; flex-direction: column;`;
                    document.body.appendChild(overlay);
                }
                overlay.innerHTML = `<div style="text-align:center;">
                    <div style="font-size: 40px; margin-bottom: 20px;">${isError ? '⚠️' : '🍪'}</div>
                    <div>${msg}</div>
                    ${isError ? '<br><a href="Login.aspx" style="color:#0078d7; font-size:16px;">转到登录页</a>' : ''}
                </div>`;
            });
        },

        // 显示详情弹窗
        showDetailModal: function(content) {
            const container = document.getElementById('mes-modal-container');
            if (!container) return;

            container.innerHTML = `
                <div class="mes-modal-overlay" id="mes-modal-close-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;justify-content:center;align-items:center;">
                    <div class="mes-modal-content" style="background:white;padding:20px;border-radius:8px;width:600px;max-height:80vh;display:flex;flex-direction:column;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:15px;border-bottom:1px solid #eee;">
                            <h3 style="margin:0;color:#0078d7;">📄 完整内容</h3>
                            <span id="mes-modal-close-btn" style="cursor:pointer;font-size:24px;">×</span>
                        </div>
                        <div id="mes-modal-text" style="flex:1;overflow-y:auto;padding:10px;background:#f9f9f9;border:1px solid #eee;white-space:pre-wrap;word-break:break-all;">${Utils.escapeHtml(content)}</div>
                        <div style="margin-top:15px;text-align:right;">
                             <span id="mes-copy-tip" style="color:green;margin-right:10px;opacity:0;transition:opacity 0.5s;">✅ 已复制!</span>
                            <button id="mes-btn-copy" style="padding:6px 15px;background:#0078d7;color:white;border:none;border-radius:4px;cursor:pointer;">复制</button>
                        </div>
                    </div>
                </div>`;

            const close = () => container.innerHTML = '';
            document.getElementById('mes-modal-close-btn').onclick = close;
            document.getElementById('mes-modal-close-overlay').onclick = (e) => {
                if (e.target.id === 'mes-modal-close-overlay') close();
            };
            document.getElementById('mes-btn-copy').onclick = () => {
                Utils.copyText(document.getElementById('mes-modal-text').innerText, () => {
                    const tip = document.getElementById('mes-copy-tip');
                    if(tip) { tip.style.opacity = 1; setTimeout(() => tip.style.opacity = 0, 2000); }
                });
            };
        },

        // 菜单高亮逻辑
        bindMenu: function() {
            if (!this.config.highlightEnabled) return;

            document.querySelectorAll('#treeFunc a, a[href*=".aspx"]').forEach(link => {
                if (link.dataset.mesBound) return;

                const href = (link.getAttribute('href') || '').trim();
                const target = link.getAttribute('target');

                // 过滤规则
                if (href.toLowerCase().startsWith('javascript') || (target !== 'mainFrame' && !link.classList.contains('a02'))) {
                    link.dataset.mesBound = "ignored";
                    return;
                }

                link.dataset.mesBound = "true";
                link.addEventListener('click', function () {
                    document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                    this.classList.add('mes-highlight');
                    const saveHref = href.replace(/^(\.\/|\/)/, '');
                    chrome.storage.local.set({'mes_last_selected_href': saveHref});
                });
            });
        },

        // 恢复上次菜单状态
        restoreMenu: function() {
            chrome.storage.local.get(['mes_last_selected_href'], (result) => {
                const lastHref = result.mes_last_selected_href;
                if (!lastHref) return;
                const link = document.querySelector(`a[href*="${lastHref}"]`);
                if (link) {
                    document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                    link.classList.add('mes-highlight');

                    // 展开父级 (解决了你之前的 ReferenceError)
                    let p = link.parentElement;
                    let safe = 0;
                    while (p && safe < 50) {
                        safe++;
                        // 匹配类似 treeFuncn1Nodes 的 ID
                        if (p.tagName === 'DIV' && p.id && /^treeFuncn\d+Nodes$/.test(p.id)) {
                            p.style.display = 'block'; // 展开
                            const idx = p.id.match(/^treeFuncn(\d+)Nodes$/)[1];
                            // 尝试高亮父级图标
                            const toggle = document.getElementById('treeFunct' + idx);
                            if(toggle) toggle.classList.add('mes-menu-open');
                        }
                        p = p.parentElement;
                    }
                    link.scrollIntoView({block: 'center', behavior: 'smooth'});
                }
            });
        },

        // 表格优化逻辑
        fixTable: function() {
            if (!this.config.tbFixEnabled) return;
            const tb = document.getElementById('tbDetail');
            if (!tb) return;
            tb.style.height = "auto";

            const tableEl = tb.querySelector('table');
            if (!tableEl) return;

            // 识别日期列 (简单缓存机制)
            if (!this.dateCols) this.dateCols = [];
            const headerRow = tableEl.querySelector('tr#trfirst') || tableEl.querySelector('tr');
            if (headerRow && this.dateCols.length === 0) {
                headerRow.querySelectorAll('td, th').forEach((th, idx) => {
                    const txt = th.innerText.toLowerCase();
                    if (txt.includes('time') || txt.includes('date')) this.dateCols.push(idx);
                });
            }

            // 处理单元格
            tableEl.querySelectorAll('tr:not(#trfirst) td').forEach((cell, idx) => {
                if (cell.dataset.mesProcessed) return;

                let text = cell.innerText.trim();

                // 日期格式化
                if (this.config.dateFormatEnabled) {
                    const isTime = /^20\d{12}$/.test(text);
                    if (isTime || (this.dateCols.includes(idx) && isTime)) {
                        text = Utils.formatTimestamp(text, this.config.dateFormatString);
                        cell.innerText = text;
                        cell.classList.add('mes-date-cell');
                    }
                }

                // 截断
                if (text.length > this.config.tbTruncateThreshold) {
                    cell.classList.add('mes-truncated-cell');
                    cell.title = text;
                    cell.onclick = (e) => {
                        e.stopPropagation();
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
        load: function() {
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

        // 1. 注入拦截器
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
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
    window.addEventListener('message', function(event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'MES_SESSION_EXPIRED') {
            console.warn('⚡ [MES-Core] 收到过期信号:', event.data );
            AuthModule.handleExpired();
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