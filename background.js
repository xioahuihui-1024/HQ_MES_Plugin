// ==================== [新增] webRequest 监听器：监控所有网络请求 ====================
// 注意：Manifest V3 中 webRequest API 功能受限，无法读取响应体
// 但可以监听响应头，作为补充检测手段
try {
    chrome.webRequest.onCompleted.addListener(
        async (details) => {
            // 只监听目标网站的请求
            if (!details.url.includes('10.128.100.82')) return;

            // 检查响应头中是否有 Session 过期的提示
            const contentType = details.responseHeaders?.find(
                h => h.name.toLowerCase() === 'content-type'
            )?.value || '';

            // 如果响应是 HTML 类型，可能是登录页（但无法读取响应体）
            // 这里主要作为补充，真正的检测在 content.js 中进行
            if (contentType.includes('text/html') && details.statusCode === 200) {
                // 可以在这里添加额外的检测逻辑
                console.debug('[Background] 检测到 HTML 响应:', details.url);
            }
        },
        {
            urls: ["http://10.128.100.82/*"],
            types: ["xmlhttprequest", "main_frame", "sub_frame"]
        },
        ["responseHeaders"]
    );
    console.log('✅ [Background] webRequest 监听器已初始化');
} catch (error) {
    console.warn('[Background] webRequest API 不可用（可能需要企业策略）:', error);
}

// 监听来自 content.js 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "DO_LOGIN") {
        performLogin(request.data).then(res => {
            if (res.success) {
                // 登录成功后，移除"手动退出"的标记，恢复保活功能
                chrome.storage.local.remove('mes_manual_logout');
            }
            sendResponse(res);
        });
        return true; // 保持消息通道开启以进行异步响应
    }
    // 2. [修改] 处理手动退出请求 (精准删除 SessionId)
    if (request.action === "MANUAL_LOGOUT") {
        handleManualLogout(sender.url).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
    // 3. [新增] 处理 Session 过期通知（从 content.js 的拦截器发送）
    if (request.action === "SESSION_EXPIRED") {
        console.warn('[Background] 收到 Session 过期通知:', request.url);
        // 可以在这里添加额外的处理逻辑
        sendResponse({ received: true });
        return true;
    }
});

// 处理手动退出：标记状态 + 删除特定 Cookie
async function handleManualLogout(urlStr) {
    // 1. 标记用户是手动退出的（防止 content.js 里的自动登录立即生效）
    await chrome.storage.local.set({ 'mes_manual_logout': true });
    console.log("🚫 用户手动退出，已标记，暂停自动保活。");

    if (!urlStr) return;
    const urlObj = new URL(urlStr);
    const domain = urlObj.hostname;

    try {
        // 2. 只删除 ASP.NET_SessionId
        // 如果你需要把登录用户的 Cookie 也清掉也可以，但只清 SessionId 足以让服务器认为未登录
        const cookieName = 'ASP.NET_SessionId';

        // 获取 Cookie 主要是为了拿到 path 和 secure 属性，确保删除成功
        const cookie = await chrome.cookies.get({ url: urlStr, name: cookieName });

        if (cookie) {
            let protocol = cookie.secure ? "https:" : "http:";
            let cookieUrl = `${protocol}//${cookie.domain}${cookie.path}`;

            await chrome.cookies.remove({
                url: cookieUrl,
                name: cookieName
            });
            console.log(`✅ 已清除 ${domain} 下的 ${cookieName}`);
        } else {
            console.log("未找到 SessionId Cookie，可能已清除");
        }

    } catch (e) {
        console.error("清除 Cookie 失败:", e);
    }
}
async function performLogin(userInfo) {
    const BASE_URL = "http://10.128.100.82/nsm_query/";
    const LOGIN_URL = BASE_URL + "Login.aspx";

    try {
        // 1. GET 获取 Login 页面以提取 ViewState
        const getResponse = await fetch(LOGIN_URL);
        const getText = await getResponse.text();

        // 正则提取 __VIEWSTATE
        const viewStateMatch = getText.match(/id="__VIEWSTATE".*?value="(.*?)"/);
        const viewStateGeneratorMatch = getText.match(/id="__VIEWSTATEGENERATOR".*?value="(.*?)"/);

        let viewState = viewStateMatch ? viewStateMatch[1] : "";
        let viewStateGenerator = viewStateGeneratorMatch ? viewStateGeneratorMatch[1] : "";


        // 2. 构造 Form Data
        const formData = new URLSearchParams();
        formData.append('__VIEWSTATE', viewState);
        if(viewStateGenerator) formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
        formData.append('txtUID', userInfo.username);
        formData.append('txtPWD', userInfo.password);
        formData.append('Button1', 'Login');
        formData.append('drpType', 'FA');
        formData.append('hidProductType', 'Server');
        formData.append('hidCustomer', 'NCS');

        // 3. POST 登录
        const postResponse = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'http://10.128.100.82',
                'Referer': LOGIN_URL
            },
            body: formData
        });

        // 4. 检查结果
        // Fetch 会自动处理 Cookie，所以只要状态码是 200 且 URL 变了或者内容里没有 Error 就算成功
        if (postResponse.redirected || postResponse.url.includes('Index.aspx?isTest=N') || postResponse.status === 200) {
            // 再次确认一下首页是否可访问
            const checkIndex = await fetch(BASE_URL + "Index.aspx?isTest=N");
            if(checkIndex.status === 200) {
                // 检测档前url, 如果不是  Index.aspx?isTest=N 那就跳转到 Index.aspx?isTest=N
                return { success: true, msg: "Cookie 刷新成功！已自动登录。请重新查询" };
            }
        }

        return { success: false, msg: "登录可能失败，请检查账号密码。" };

    } catch (error) {
        return { success: false, msg: "网络请求错误: " + error.message };
    }
}


// ==================== 新增：监听退出并清除 Cookie ====================

// 监听来自 content.js 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // ... 保留之前的 DO_LOGIN 逻辑 ...

    // [新增] 处理清除 Cookie 的请求
    if (request.action === "CLEAR_COOKIES") {
        clearCookiesForCurrentSite(sender.url).then(() => {
            console.log("✅ Cookie 清理完成");
            sendResponse({ success: true });
        });
        return true; // 保持异步通道开启
    }
});

// 执行清除当前域名下所有 Cookie 的逻辑
async function clearCookiesForCurrentSite(url) {
    try {
        if (!url) return;
        const urlObj = new URL(url);
        const domain = urlObj.hostname; // 获取当前 IP 或域名 (例如 10.128.100.82)

        // 1. 获取该域名下的所有 Cookie
        const cookies = await chrome.cookies.getAll({ domain: domain });

        console.log("获取到的 Cookie:", cookies)

        if (cookies.length === 0) {
            console.log("没有发现 Cookie，可能已经被清除或是在其他 path 下");
            return;
        }

        // 2. 遍历并逐个删除
        const removePromises = cookies.map(cookie => {
            let protocol = cookie.secure ? "https:" : "http:";
            let cookieUrl = `${protocol}//${cookie.domain}${cookie.path}`;

            return chrome.cookies.remove({
                url: cookieUrl,
                name: cookie.name
            });
        });

        await Promise.all(removePromises);
        console.log(`已清除 ${domain} 下的 ${cookies.length} 个 Cookie`);

    } catch (e) {
        console.error("清除 Cookie 失败:", e);
    }
}