document.addEventListener('DOMContentLoaded', () => {
    const SITE_ORIGIN = 'http://10.128.100.82/*';

    // 1. 打开配置页
    document.getElementById('open-options').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // 2. 请求站点访问权限，确保 content script 能注入
    const siteAccessBtn = document.getElementById('btn-site-access');
    const siteStatus = document.getElementById('site-access-status');

    function updateSiteAccessUI(granted) {
        if (granted) {
            siteAccessBtn.textContent = "✅ 已启用网页增强";
            siteAccessBtn.classList.add('btn-disabled');
            siteAccessBtn.disabled = true;
            siteStatus.textContent = "已授权访问 MES 网页，样式增强生效。";
            siteStatus.style.color = "green";
        } else {
            siteAccessBtn.textContent = "🚀 启用网页增强";
            siteAccessBtn.classList.remove('btn-disabled');
            siteAccessBtn.disabled = false;
            siteStatus.textContent = "尚未授权访问 http://10.128.100.82，页面样式无法注入。";
            siteStatus.style.color = "red";
        }
    }

    chrome.permissions.contains({ origins: [SITE_ORIGIN] }, (granted) => {
        updateSiteAccessUI(granted);
    });

    siteAccessBtn.addEventListener('click', () => {
        siteAccessBtn.disabled = true;
        siteAccessBtn.textContent = "⏳ 正在申请...";
        chrome.permissions.request({ origins: [SITE_ORIGIN] }, (granted) => {
            updateSiteAccessUI(granted);
            if (!granted) {
                siteStatus.textContent = "❌ 用户取消授权，需允许后功能才会生效。";
                siteStatus.style.color = "red";
            }
        });
    });

    // 3. 登录逻辑
    const loginBtn = document.getElementById('btn-login');
    const msgBox = document.getElementById('msg-box');

    loginBtn.addEventListener('click', () => {
        // 从存储中获取账号密码
        chrome.storage.local.get(['mes_config'], (result) => {
            const cfg = result.mes_config || {};

            if (!cfg.username || !cfg.password) {
                msgBox.textContent = "⚠️ 请先去配置页填写账号密码";
                msgBox.style.color = "red";
                // 闪烁配置按钮提示用户
                const optBtn = document.getElementById('open-options');
                optBtn.style.transform = "scale(1.1)";
                setTimeout(() => optBtn.style.transform = "scale(1)", 200);
                return;
            }

            // UI 状态更新
            loginBtn.disabled = true;
            loginBtn.textContent = "⏳ 正在刷新...";
            msgBox.textContent = "正在后台模拟登录...";
            msgBox.style.color = "#666";

            // 发送消息给 background.js 执行登录
            chrome.runtime.sendMessage({
                action: "DO_LOGIN",
                data: { username: cfg.username, password: cfg.password }
            }, (response) => {
                loginBtn.disabled = false;
                loginBtn.textContent = "🍪 刷新登录 Cookie";

                if (response && response.success) {
                    msgBox.textContent = "✅ 刷新成功！";
                    msgBox.style.color = "green";
                    // 2秒后清除成功消息
                    setTimeout(() => msgBox.textContent = "", 3000);
                } else {
                    msgBox.textContent = "❌ " + (response ? response.msg : "请求超时");
                    msgBox.style.color = "red";
                }
            });
        });
    });
});