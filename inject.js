// inject.js - 运行在网页主世界
(function() {
    // 防止乱码影响逻辑，使用英文 Log
    console.log('💉 [MES-Inject] Script loaded.');

    const originalAlert = window.alert;
    // 增加更多拦截关键词
    const BLOCK_KEYWORDS = ['FAIL:登陆信息已过期', '没有用户状态', 'Login.aspx', 'parsererror', '用户已过期'];

    function shouldBlock(msg) {
        if (!msg) return false;
        return BLOCK_KEYWORDS.some(kw => String(msg).includes(kw));
    }

    // 1. 强力拦截 Alert
    window.alert = function(msg) {
        if (shouldBlock(msg)) {
            console.warn('🛑 [MES-Inject] Alert blocked:', msg);
            // 发送过期信号 (来源 alert)
            window.postMessage({ type: 'MES_SESSION_EXPIRED', source: 'alert' }, '*');
            return true; // 返回 true 欺骗可能的调用者
        }
        return originalAlert.apply(this, arguments);
    };

    // 2. 拦截 XHR (捕获请求参数)
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._mesMethod = method;
        this._mesUrl = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        this._mesBody = body;

        xhr.addEventListener('load', function() {
            // 如果响应内容包含过期信息
            if (shouldBlock(xhr.responseText)) {
                console.warn('🔍 [MES-Inject] XHR Expired:', xhr._mesUrl);

                // 构造请求数据对象
                const reqData = {
                    url: xhr._mesUrl,
                    method: xhr._mesMethod,
                    body: xhr._mesBody
                };

                // 发送过期信号 (来源 xhr，携带数据)
                window.postMessage({
                    type: 'MES_SESSION_EXPIRED',
                    source: 'xhr',
                    requestData: reqData
                }, '*');
            }
        });
        return originalSend.apply(this, arguments);
    };

    // 3. 监听重发指令
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'MES_DO_REPLAY') {
            const req = event.data.payload;

            // [关键] 严格校验，防止发送 true
            if (!req || typeof req !== 'object' || !req.url) {
                console.error('❌ [MES-Inject] Invalid replay data:', req);
                return;
            }

            console.log('🚀 [MES-Inject] Replaying request...', req);
            replayRequest(req);
        }
    });

    // 4. 重发逻辑 (保持之前的 text dataType + eval 解析方案)
    function replayRequest(req) {
        if (!window.$ || !window.$.ajax) return;

        window.$.ajax({
            type: req.method || 'post',
            url: req.url,
            data: req.body,
            dataType: "text", // 避免 jQuery 解析报错
            success: function(responseText) {
                if (responseText.includes("FAIL")) return;

                let jsonResult;
                try {
                    jsonResult = JSON.parse(responseText);
                } catch (e) {
                    try {
                        jsonResult = eval('(' + responseText + ')');
                    } catch (e2) { return; }
                }
                // 调用渲染
                renderTableToDom(jsonResult);
            }
        });
    }

    // 5. 渲染逻辑 (保持不变，省略以节省篇幅，请保留你上一次代码中的 renderTableToDom 函数)
    function renderTableToDom(allArray) {
        // ... 请保留上次的 renderTableToDom 代码 ...
        // 如果你需要我再次提供这部分，请告诉我
        const $ = window.$;
        $("#lblMsg").html("");
        if (allArray["results"].result == "FAIL") {
            $("#lblMsg").html(allArray["results"].message);
            $("#tbDetail").html("");
            return;
        }
        // ... (此处省略几十行渲染表格的代码，直接复用之前的即可) ...
        // 简单版渲染（防止你漏掉代码）：
        let htmlStr = "";
        if (allArray.table && allArray.table[1]) {
            // 简易渲染逻辑，确保有东西显示
            htmlStr = "<table border='1' class='tablelist01' width='100%'>";
            // Header
            htmlStr += "<tr class='tdContextColumn'>";
            for(let k in allArray.table[0].data[0]) htmlStr += `<td class='td_head01'>${k}</td>`;
            htmlStr += "</tr>";
            // Body
            for(let i=0; i<allArray.table[0].data.length; i++) {
                htmlStr += "<tr class='tdContext'>";
                for(let k in allArray.table[0].data[i]) {
                    let v = allArray.table[0].data[i][k];
                    htmlStr += `<td class='td_list01'>${v==null?'':v}</td>`;
                }
                htmlStr += "</tr>";
            }
            htmlStr += "</table>";
            $("#tbDetail").html(htmlStr);
            $("#lblRowCount").html(allArray.table[1].data[0].TotalRecord || 0);
        }
    }
})();