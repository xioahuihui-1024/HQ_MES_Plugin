// inject.js - 运行在网页的“主世界”，负责拦截脏活累活
(function() {
    console.log('💉 [MES助手] 注入脚本已加载，开始接管页面...');

    // 定义过期特征字符串 (来自你的 jsbasequery.js)
    const EXPIRED_STRINGS = [
        'FAIL:登陆信息已过期',
        '没有用户状态',
        'Login.aspx'
    ];

    function isExpired(text) {
        if (!text || typeof text !== 'string') return false;
        return EXPIRED_STRINGS.some(s => text.includes(s));
    }

    // ================= 1. 拦截 window.alert (最关键！) =================
    // 网页源码里写了 error: function(...) { alert(...) }
    // 我们必须在这里拦截，不让它弹窗
    const originalAlert = window.alert;
    window.alert = function(msg) {
        const str = String(msg);
        // 如果包含过期信息，或者包含 parsererror (因为登录页HTML会导致JSON解析失败)
        if (isExpired(str) || str.includes('parsererror')) {
            console.warn('🛑 [MES助手] 拦截到过期弹窗，已阻止:', str);

            // 通知 content.js 去处理登录
            window.postMessage({ type: 'MES_SESSION_EXPIRED', source: 'alert' }, '*');
            return; // 直接返回，不执行原始 alert
        }
        // 其他无关的 alert 正常放行
        return originalAlert.apply(this, arguments);
    };

    // ================= 2. 拦截 XMLHttpRequest (底层网络层) =================
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._mesUrl = url; // 记录 URL 方便调试
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        const xhr = this;
        // 监听 load 事件 (请求完成)
        xhr.addEventListener('load', function() {
            // 检查响应内容
            if (isExpired(xhr.responseText)) {
                console.warn('🔍 [MES助手] XHR 捕获到过期响应:', xhr._mesUrl);
                window.postMessage({ type: 'MES_SESSION_EXPIRED', url: xhr._mesUrl }, '*');
            }
        });
        return originalSend.apply(this, arguments);
    };

    // ================= 3. 拦截 Fetch (防止新代码漏网) =================
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch(...args);
        const clone = response.clone();
        clone.text().then(text => {
            if (isExpired(text)) {
                window.postMessage({ type: 'MES_SESSION_EXPIRED', url: args[0] }, '*');
            }
        });
        return response;
    };

})();