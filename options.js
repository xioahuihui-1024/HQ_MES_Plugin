const DEFAULT_CFG = {
    username: '',
    password: '',
    keepAliveEnabled: false, // [不掉登录 账号保活] 默认关闭
    tableManagerEnabled: true, // 表格管理
    saveViewSettings: false, // 默认不保存
    stickyHeaderEnabled: true, // 顶栏固定
    highlightColor: '#0078d7',
    highlightBackground: 'rgba(0,120,215,0.08)',
    highlightEnabled: true,
    tbFixEnabled: true,
    tbMinHeight: 580,
    tbTruncateThreshold: 30,
    dateFormatEnabled: true,
    dateFormatString: 'YY-MM-DD HH:mm:ss'

};

document.addEventListener('DOMContentLoaded', () => {
    // 加载配置
    chrome.storage.local.get(['mes_config'], (result) => {
        const cfg = { ...DEFAULT_CFG, ...result.mes_config };

        document.getElementById('cfg-user').value = cfg.username;
        document.getElementById('cfg-pwd').value = cfg.password;
        // 回显保活开关
        document.getElementById('cfg-keep-alive').checked = cfg.keepAliveEnabled;
        // 顶栏固定
        document.getElementById('cfg-table-manager').checked = cfg.tableManagerEnabled;
        document.getElementById('cfg-save-view').checked = cfg.saveViewSettings;
        document.getElementById('cfg-sticky-header').checked = cfg.stickyHeaderEnabled;
        document.getElementById('cfg-highlight-enable').checked = cfg.highlightEnabled;
        document.getElementById('cfg-color').value = cfg.highlightColor;
        document.getElementById('cfg-tb-enable').checked = cfg.tbFixEnabled;
        document.getElementById('cfg-tb-truncate').value = cfg.tbTruncateThreshold;

        // 确保日期格式有值
        document.getElementById('cfg-date-format-enable').checked = cfg.dateFormatEnabled;
        document.getElementById('cfg-date-format').value = cfg.dateFormatString || 'YY-MM-DD HH:mm:ss';
    });

    // 保存配置
    document.getElementById('btn-save').addEventListener('click', () => {
        const newCfg = {
            username: document.getElementById('cfg-user').value,
            password: document.getElementById('cfg-pwd').value,
            // 保存保活开关
            keepAliveEnabled: document.getElementById('cfg-keep-alive').checked,
            // 保存固定表头配置
            tableManagerEnabled: document.getElementById('cfg-table-manager').checked,
            saveViewSettings: document.getElementById('cfg-save-view').checked,
            stickyHeaderEnabled: document.getElementById('cfg-sticky-header').checked,
            highlightEnabled: document.getElementById('cfg-highlight-enable').checked,
            highlightColor: document.getElementById('cfg-color').value,
            highlightBackground: hexToRgba(document.getElementById('cfg-color').value, 0.1),
            tbFixEnabled: document.getElementById('cfg-tb-enable').checked,
            tbMinHeight: 580, // 保持默认或从界面获取
            tbTruncateThreshold: parseInt(document.getElementById('cfg-tb-truncate').value) || 30,
            dateFormatEnabled: document.getElementById('cfg-date-format-enable').checked,
            dateFormatString: document.getElementById('cfg-date-format').value || 'YY-MM-DD HH:mm:ss'
        };

        chrome.storage.local.set({ mes_config: newCfg }, () => {
            const btn = document.getElementById('btn-save');
            const originalText = btn.textContent;
            btn.textContent = '✅ 保存成功！';
            btn.style.background = '#218838';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '#28a745';
            }, 1500);
        });
    });

    // 登录测试 (Options 页面也可以保留这个功能)
    document.getElementById('btn-refresh-cookie').addEventListener('click', () => {
        const user = document.getElementById('cfg-user').value;
        const pwd = document.getElementById('cfg-pwd').value;
        const statusDiv = document.getElementById('login-status');

        if(!user || !pwd) {
            statusDiv.innerText = '❌ 请先填写用户名和密码';
            statusDiv.style.color = 'red';
            return;
        }

        statusDiv.innerText = "⏳ 正在连接后台...";
        statusDiv.style.color = "blue";

        chrome.runtime.sendMessage({
            action: "DO_LOGIN",
            data: { username: user, password: pwd }
        }, (response) => {
            if(response && response.success) {
                statusDiv.innerText = "✅ " + response.msg;
                statusDiv.style.color = "green";
            } else {
                statusDiv.innerText = "❌ " + (response ? response.msg : "请求超时");
                statusDiv.style.color = "red";
            }
        });
    });
});

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}