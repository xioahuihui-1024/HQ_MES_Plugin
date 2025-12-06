(function () {
    'use strict';

    const MES_BASE_URL = 'http://10.128.100.82/nsm_query/';
    const MES_HOME_URL = `${MES_BASE_URL}Index.aspx?isTest=N`;

    // ================= 1. 配置与默认值 =================
    const DEFAULT_CFG = {
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

        // [新增] 每一秒检查一次是否有退出按钮（因为在 Top Frame 加载完成前可能找不到）
        setInterval(bindLogoutEvent, 1000);

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

    // ================= 4. 样式注入 =================
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

    // ================= 5. 菜单高亮逻辑 (复用你的核心逻辑) =================
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


    // ================= 6. 表格优化逻辑 =================

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

    // [新增] 绑定退出按钮事件
    function bindLogoutEvent() {
        // 退出按钮是：<a href="Login.aspx" ...>退出</a>
        // 我们查找所有包含 "退出" 两个字的链接，或者 href 指向 Login.aspx 的链接
        const logoutLinks = document.querySelectorAll('a[href*="Login.aspx"], a');

        logoutLinks.forEach(link => {
            // 过滤：必须包含“退出”文本，或者是 Login.aspx
            const text = link.innerText || "";
            const href = link.getAttribute('href') || "";

            if (text.includes("退出") || href.indexOf("Login.aspx") > -1) {

                // 防止重复绑定
                if (link.dataset.mesLogoutBound) return;
                link.dataset.mesLogoutBound = "true";

                // 绑定点击事件
                link.addEventListener('click', function(e) {
                    console.log("🖱️ 监测到点击退出，正在请求清除 Cookie...");

                    // 发送消息给 background.js
                    chrome.runtime.sendMessage({ action: "CLEAR_COOKIES" });

                    // 注意：这里不阻止默认事件(e.preventDefault)，
                    // 让它继续执行跳转 Login.aspx 的操作，
                    // 因为 background.js 清除 Cookie 是异步的，通常跳转发生时 Cookie 已经被删了
                });
            }
        });
    }

})();