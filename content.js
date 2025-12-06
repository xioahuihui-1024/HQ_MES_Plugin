(function () {
    'use strict';

    const MES_BASE_URL = 'http://10.128.100.82/nsm_query/';
    const MES_HOME_URL = `${MES_BASE_URL}Index.aspx?isTest=N`;

    // ================= 1. 配置与默认值 =================
    const DEFAULT_CFG = {
        keepAliveEnabled: false, // 账号保活 默认关闭
        highlightColor: '#0078d7',
        highlightBackground: 'rgba(0,120,215,0.08)',
        highlightEnabled: true,
        tbFixEnabled: true,
        tbMinHeight: 580,
        tbTruncateThreshold: 30, // 超过多少字符截断
        dateFormatEnabled: true, // 启用日期格式化
        dateFormatString: 'YY-MM-DD HH:mm:ss' // 默认时间格式
    };

    let currentCfg = {...DEFAULT_CFG};
    let dateColumnIndices = []; // 缓存日期列的索引

    // ================= 2. 环境检测 =================
    const isMenuFrame = location.pathname.toLowerCase().includes('left') || !!document.querySelector('#treeFunc');
    const isMainFrame = location.pathname.toLowerCase().includes('basicquery') || !!document.querySelector('#tbDetail');

    // 顶层页面自动保持在首页
    if (window.top === window) {
        ensureHomeRedirection();
    }

    // ================= 3. 初始化 =================
    chrome.storage.local.get(['mes_config'], (result) => {
        if (result.mes_config) {
            currentCfg = {...DEFAULT_CFG, ...result.mes_config};
        }
         // 初始化运行
        init();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.mes_config) {
            currentCfg = {...DEFAULT_CFG, ...changes.mes_config.newValue};
            injectDynamicStyles();
            if (isMainFrame) {
                // 配置变更时重新扫描表格
                dateColumnIndices = [];
                document.querySelectorAll('#tbDetail td').forEach(td => delete td.dataset.mesProcessed);
                fixTableStyle();
            }
        }
    });

    async function ensureHomeRedirection() {
        if (isHomePage()) return;
        const path = location.pathname.toLowerCase();

        // 登录页/root 页才尝试跳转，避免干扰其他模块
        const isLoginPage = path.endsWith('/login.aspx');
        const isRootPage = path === '/nsm_query/' || path === '/nsm_query' || path.endsWith('/default.aspx');
        if (!isLoginPage && !isRootPage) return;

        try {
            const resp = await fetch(MES_HOME_URL, {
                method: 'GET',
                redirect: 'manual',
                credentials: 'include',
                cache: 'no-store'
            });
            if (resp.status === 200) {
                window.location.replace(MES_HOME_URL);
            }
        } catch (err) {
            console.warn('[MES] 首页跳转检查失败', err);
        }
    }

    function isHomePage() {
        const path = location.pathname.toLowerCase();
        const search = location.search.toLowerCase();

        console.log('path:',path,'\nsearch:',search ,'\n 结果：',(path.endsWith('/index.aspx') && search.includes('istest=n')))

        return path.endsWith('/index.aspx') && search.includes('istest=n');
    }

    function init() {
        injectDynamicStyles();

        // 1. 优先检查：是否是“失效页面”
        checkIfSessionExpired();
        // 2. 绑定退出按钮 (实现假退出变真退出)
        setInterval(bindLogoutEvent, 1500);

        if (isMenuFrame) {
            // 绑定菜单点击事件
            setInterval(bindMenuAnchors, 1000);
            // [新增] 恢复上次选中的状态（展开父级 + 高亮）
            setTimeout(restoreLastSelected, 500);
        }

        if (isMainFrame) {
            // 注入模态框容器
            if (!document.getElementById('mes-modal-container')) {
                const container = document.createElement('div');
                container.id = 'mes-modal-container';
                document.body.appendChild(container);
            }
            setInterval(fixTableStyle, 800);
        }
    }

    // ================= 3. 核心：检测 Session 失效与自动保活 =================
    async function checkIfSessionExpired() {
        // 检测特征：页面包含 "没有用户状态" 且包含那个特定的登录链接 HTML
        const bodyText = document.body.innerText;
        const bodyHtml = document.body.innerHTML;

        const isSessionLost = bodyText.includes("没有用户状态") && bodyHtml.includes("Login.aspx");
        location.pathname.toLowerCase().endsWith('login.aspx');
        if (isSessionLost) {
            console.log("⚠️ 检测到 Session 失效页面");
            // 如果没开启保活，啥也不做（或者你可以选择跳转 Login）
            if (!currentCfg.keepAliveEnabled) {
                console.log("未开启永久保活，停止操作。");
                return;
            }
            // 检查是否是用户“手动退出”的
            const storage = await chrome.storage.local.get(['mes_manual_logout']);
            if (storage.mes_manual_logout) {
                console.log("🛑 检测到用户刚才手动点击了退出，不执行自动登录，防止死循环。");
                // 此时页面停留在“没有用户状态”，用户可以点击页面上的“登录”回去
                // 或者我们可以帮他跳到 Login.aspx
                if(location.search.indexOf('isManualRedirect') === -1) {
                    window.location.href = "Login.aspx?isManualRedirect=1";
                }
                return;
            }

            // === 执行自动重登 ===
            console.log("🔄 正在尝试自动后台登录...");
            showOverlay("会话过期，MES 助手正在为您自动续期...");

            const cfg = currentCfg;
            if (cfg.username && cfg.password) {
                chrome.runtime.sendMessage({
                    action: "DO_LOGIN",
                    data: { username: cfg.username, password: cfg.password }
                }, (response) => {
                    if (response && response.success) {
                        console.log("✅ 续期成功，刷新页面...");
                        location.reload(); // 刷新当前页面，重发请求
                    } else {
                        showOverlay("❌ 自动续期失败，请检查账号密码。", true);
                    }
                });
            } else {
                showOverlay("❌ 未配置账号密码，无法自动续期。", true);
            }
        }

        // 如果在登录页，且开启了保活，且不是手动退出的 -> 也可以考虑自动登进去
        // 但这取决于你是否想让用户看到登录页。既然是“无感”，通常不需要这一步，除非用户收藏了 Login.aspx
        // 如果当前已经在首页（说明已经是登录状态），清除手动退出的标记，为下次保活做准备
        if (location.pathname.toLowerCase().includes("index.aspx")) {
            chrome.storage.local.remove('mes_manual_logout');
        }
    }
    // 显示一个全屏遮罩提示用户正在重登
    function showOverlay(msg, isError = false) {
        let overlay = document.getElementById('mes-relogin-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mes-relogin-overlay';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(255, 255, 255, 0.95); z-index: 999999;
                display: flex; justify-content: center; align-items: center;
                font-size: 20px; color: #333; font-family: "Segoe UI"; flex-direction: column;
            `;
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<div style="text-align:center;">
            <div style="font-size: 40px; margin-bottom: 20px;">${isError ? '⚠️' : '🍪'}</div>
            <div>${msg}</div>
            ${isError ? '<br><a href="Login.aspx" style="color:#0078d7; font-size:16px;">转到登录页</a>' : ''}
        </div>`;
    }

    // ================= 4. 优化：退出按钮绑定 =================
    function bindLogoutEvent() {
        // 查找所有可能的退出链接
        // 针对你的系统，可能是 href="Login.aspx" 或者 onclick="...Login.aspx"
        const logoutLinks = document.querySelectorAll('a[href*="Login.aspx"], a');

        logoutLinks.forEach(link => {
            if (link.dataset.mesLogoutBound) return;

            const text = link.innerText || "";
            const href = link.getAttribute('href') || "";

            // 只要包含“退出”或者是去 Login.aspx 的，都拦截
            if (text.includes("退出") || href.toLowerCase().includes("login.aspx")) {

                // 排除上面 checkSessionInvalid 生成的那个临时链接（如果有的话）
                if(href.includes("isManualRedirect")) return;

                link.dataset.mesLogoutBound = "true";
                link.style.border = "1px dashed red"; // (可选) 调试用，标红框表示已接管

                link.addEventListener('click', function(e) {
                    console.log("🖱️ 用户点击退出");
                    // 1. 发送手动退出指令
                    chrome.runtime.sendMessage({ action: "MANUAL_LOGOUT" });

                    // 2. 允许默认行为发生（即允许它跳转到 Login.aspx）
                    // 因为我们已经在 background 里删除了 Cookie 并设置了 manual_logout 标记
                    // 所以跳转后 content.js 会检测到 flag，从而不会触发自动重登
                });
            }
        });
    }

    // ================= 5. 样式注入 =================
    function injectDynamicStyles() {
        let styleId = 'mes-dynamic-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            (document.head || document.documentElement).appendChild(styleTag);
        }

        const css = `
            .mes-highlight {
                background-color: ${currentCfg.highlightBackground} !important;
                color: ${currentCfg.highlightColor} !important;
                border: 1px solid ${currentCfg.highlightColor} !important;
                border-radius: 4px;
                padding: 2px 5px !important;
            }
            .mes-highlight::before {
                content: '▶';
                position: absolute;
                left: -12px; font-size: 10px;
                color: ${currentCfg.highlightColor} !important;
            }
            #tbDetail {
                ${currentCfg.tbFixEnabled ? `
                min-height: ${currentCfg.tbMinHeight}px !important;
                height: auto !important;
                ` : ''}
            }
            /* 日期列不换行，保持整洁 */
            .mes-date-cell {
                white-space: nowrap !important;
                font-family: Consolas, Monaco, monospace;
                color: #666;
            }
        `;
        styleTag.textContent = css;
    }

    // ================= 6. 菜单高亮逻辑 (复用你的核心逻辑) =================
    function bindMenuAnchors() {
        if (!currentCfg.highlightEnabled) return;
        // 查找所有菜单链接
        const links = document.querySelectorAll('#treeFunc a, a[href*=".aspx"]');

        links.forEach(link => {
            // 如果已经处理过，直接跳过
            if (link.dataset.mesBound) return;

            const href = (link.getAttribute('href') || '').trim();
            const target = link.getAttribute('target');

            // [关键判断]
            // 1. 如果 href 是 "javascript:" 开头的（这是文件夹展开/折叠操作），忽略
            // 2. 如果 target 不是 "mainFrame"（说明不是去右侧打开页面的），忽略
            // (注：保留 !link.classList.contains('a02') 是为了兼容顶部可能存在的非 mainFrame 链接)
            if (href.toLowerCase().startsWith('javascript') || (target !== 'mainFrame' && !link.classList.contains('a02'))) {
                link.dataset.mesBound = "ignored"; // 标记为忽略，下次不再检查
                return;
            }

            // 只有真正的详情页链接，才绑定高亮事件
            link.dataset.mesBound = "true";
            link.addEventListener('click', function (e) {
                // 1. 移除页面上所有已存在的高亮
                document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                // 2. 给当前点击的这个链接添加高亮
                this.classList.add('mes-highlight');

                // 3. 保存当前选中的 href 到 storage
                // 移除 ./ 或 / 前缀，确保存储的是相对路径部分，方便匹配
                const saveHref = href.replace(/^(\.\/|\/)/, '');
                chrome.storage.local.set({ 'mes_last_selected_href': saveHref });
            });
        });
    }

    // 恢复上次选中的菜单状态
    function restoreLastSelected() {
        chrome.storage.local.get(['mes_last_selected_href'], (result) => {
            const lastHref = result.mes_last_selected_href;
            if (!lastHref) return;

            // 查找匹配的链接 (使用属性选择器模糊匹配)
            const link = document.querySelector(`a[href*="${lastHref}"]`);

            if (link) {
                // 恢复高亮
                document.querySelectorAll('.mes-highlight').forEach(el => el.classList.remove('mes-highlight'));
                link.classList.add('mes-highlight');

                // 展开父级菜单
                expandParentsFor(link);

                // 滚动到可视区域
                link.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
    }

    // 自动展开父级菜单 (适配 Manifest V3，不使用 eval)
    function expandParentsFor(el) {
        let p = el.parentElement;
        let safeGuard = 0; // 防止死循环

        while (p && safeGuard < 50) {
            safeGuard++;
            if (p.tagName === 'DIV' && p.id && /^treeFuncn\d+Nodes$/.test(p.id)) {
                const isHidden = p.style.display === 'none' || getComputedStyle(p).display === 'none';
                if (isHidden) {
                    p.style.display = 'block';
                    p.dataset.mesExpanded = 'true';
                    const idxMatch = p.id.match(/^treeFuncn(\d+)Nodes$/);
                    if (idxMatch) {
                        markToggleAsExpanded(idxMatch[1]);
                    }
                }
            }
            p = p.parentElement;
        }
    }

    function markToggleAsExpanded(idx) {
        const toggle = document.getElementById('treeFunct' + idx);
        if (toggle) {
            toggle.dataset.mesExpanded = 'true';
            toggle.classList.add('mes-menu-open');
        }
        const toggleIcon = document.getElementById('treeFuncn' + idx);
        if (toggleIcon) {
            toggleIcon.dataset.mesExpanded = 'true';
            toggleIcon.classList.add('mes-menu-open');
        }
    }


    // ================= 7. 表格优化逻辑 =================

    function fixTableStyle() {
        if (!currentCfg.tbFixEnabled) return;
        const tb = document.getElementById('tbDetail');
        if (!tb) return;

        tb.style.height = "auto";

        const tableEl = tb.querySelector('table');
        if (!tableEl) return;

        // 1. 识别表头，找到可能包含日期的列索引
        // 只在第一次或重置时扫描表头
        if (dateColumnIndices.length === 0) {
            const headerRow = tableEl.querySelector('tr#trfirst') || tableEl.querySelector('tr');
            if (headerRow) {
                const headers = headerRow.querySelectorAll('td, th');
                headers.forEach((th, index) => {
                    const headerText = th.innerText.toLowerCase();
                    // 只要表头包含 Time 或 Date，就标记为潜在日期列
                    if (headerText.includes('time') || headerText.includes('date')) {
                        dateColumnIndices.push(index);
                    }
                });
            }
        }

        // 2. 处理数据行
        const rows = tableEl.querySelectorAll('tr:not(#trfirst)');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            cells.forEach((cell, index) => {
                if (cell.dataset.mesProcessed) return; // 防止重复处理

                let textContent = cell.innerText.trim();

                // --- 日期格式化逻辑 ---
                // 如果当前列是日期列，或者内容看起来像 14 位时间戳 (202x...)
                // 增加正则判断 ^20\d{12}$ 确保是以 20 开头的 14 位数字，防止误伤其他ID
                if (currentCfg.dateFormatEnabled) {
                    // 确保是 14 位时间戳 (YYYYMMDDHHmmss)
                    const isTimestamp = /^20\d{12}$/.test(textContent);

                    if ((dateColumnIndices.includes(index) && isTimestamp) || isTimestamp) {
                        // [修改] 调用自定义格式化函数
                        const formattedDate = formatTimestamp(textContent, currentCfg.dateFormatString);

                        cell.innerText = formattedDate;
                        cell.classList.add('mes-date-cell');
                        textContent = formattedDate; // 更新文本以便后续弹窗显示格式化后的内容
                        cell.dataset.mesProcessed = "true";
                    }
                }

                // --- 截断逻辑 ---
                if (textContent.length > currentCfg.tbTruncateThreshold) {
                    cell.dataset.mesProcessed = "true";
                    cell.classList.add('mes-truncated-cell');
                    cell.title = textContent; // 鼠标悬停显示
                    cell.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showDetailModal(textContent);
                    });
                } else {
                    // 即使没被截断，如果是日期格式化过的，也标记一下，避免重复format
                    cell.dataset.mesProcessed = "true";
                }
            });
        });
    }

    // --- 弹窗逻辑 (含增强复制) ---
    function showDetailModal(content) {
        const container = document.getElementById('mes-modal-container');
        if (!container) return;

        container.innerHTML = `
            <div class="mes-modal-overlay" id="mes-modal-close-overlay">
                <div class="mes-modal-content">
                    <div class="mes-modal-header">
                        <h3>📄 完整内容详情</h3>
                        <span class="mes-modal-close" id="mes-modal-close-btn">×</span>
                    </div>
                    <div class="mes-modal-body" id="mes-modal-text">${escapeHtml(content)}</div>
                    <div class="mes-modal-footer">
                         <span id="mes-copy-tip" style="color:green; margin-right:10px; opacity:0; transition:opacity 0.5s;">✅ 已复制!</span>
                        <button id="mes-btn-copy" style="padding:6px 15px; cursor:pointer; background:#0078d7; color:white; border:none; border-radius:4px; font-weight:bold;">复制内容</button>
                    </div>
                </div>
            </div>
        `;

        const close = () => container.innerHTML = '';
        document.getElementById('mes-modal-close-btn').onclick = close;
        document.getElementById('mes-modal-close-overlay').onclick = (e) => {
            if (e.target === document.getElementById('mes-modal-close-overlay')) close();
        };

        // 增强版复制功能
        document.getElementById('mes-btn-copy').onclick = () => {
            const textToCopy = document.getElementById('mes-modal-text').innerText;
            copyToClipboard(textToCopy);
        };
    }

    // 兼容性最强的复制函数
    function copyToClipboard(text) {
        // 优先尝试标准 API
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(onCopySuccess, () => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    }

    // 降级方案：使用 textarea 复制
    function fallbackCopy(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;

        // 确保 textarea 不可见但存在于 DOM 中
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) onCopySuccess();
            else alert('复制失败，请手动选中复制');
        } catch (err) {
            alert('浏览器禁止了自动复制');
        }

        document.body.removeChild(textArea);
    }

    function onCopySuccess() {
        const tip = document.getElementById('mes-copy-tip');
        if (tip) {
            tip.style.opacity = 1;
            setTimeout(() => tip.style.opacity = 0, 2000);
        }
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // [新增] 通用时间戳格式化函数
    function formatTimestamp(raw, formatStr) {
        // 原始数据: 2025 11 20 18 48 17
        const Y = raw.slice(0, 4);
        const M = raw.slice(4, 6);
        const D = raw.slice(6, 8);
        const H = raw.slice(8, 10);
        const m = raw.slice(10, 12);
        const s = raw.slice(12, 14);

        // 正则替换顺序很重要：先匹配长的(YYYY)，再匹配短的(Y)
        return formatStr
            .replace(/YYYY/g, Y)            // 2025 (完整)
            .replace(/YYY/g, Y.slice(1))    // 025  (去掉第1位，保留后3位)
            .replace(/YY/g, Y.slice(2))     // 25   (去掉前2位，保留后2位)
            .replace(/Y/g, Y.slice(3))      // 5    (去掉前3位，保留最后1位)
            .replace(/MM/g, M)              // 11
            .replace(/DD/g, D)              // 20
            .replace(/HH/g, H)              // 18
            .replace(/mm/g, m)              // 48
            .replace(/ss/g, s)              // 17
            // 支持去除前导零的单字符格式 (如 09月 -> 9月)
            .replace(/M(?!M)/g, parseInt(M))
            .replace(/D(?!D)/g, parseInt(D));
    }



})();