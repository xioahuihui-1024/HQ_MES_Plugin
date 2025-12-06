// 监听来自 content.js 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "DO_LOGIN") {
        performLogin(request.data).then(res => {
            sendResponse(res);
        });
        return true; // 保持消息通道开启以进行异步响应
    }
});

// TODO 后续添加处理 监听http://10.128.100.82/nsm_query的任何请求，只要是 302 跳转，
// 且响应头带了跳转是 登录页Location: http://10.128.100.82/nsm_query/Login.asp 的跳转，则直接进行登录，然后再次重发该请求

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