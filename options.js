const DEFAULT_CFG = {
    // 认证保活
    username: '',
    password: '',
    keepAliveEnabled: false,
    // 菜单高亮
    highlightEnabled: true,
    highlightColor: '#0078d7',
    highlightBackground: 'rgba(0,120,215,0.08)',
    // 表格总开关
    tbFixEnabled: true,
    tbMinHeight: 580,
    // 表格样式
    tableFontFamily: '"JetBrains Mono", "Consolas", monospace',
    tableFontSize: '12px',
    tablePadding: '3px 2px',
    useGoogleFonts: true,
    // 固定表头
    stickyHeaderEnabled: true,
    // 高级表格管理
    tableManagerEnabled: true,
    saveViewSettings: false,
    // 列宽控制
    colMaxWidth: 850,
    colMinWidth: 4,
    colSampleRows: 12,
    // 截断与Tooltip
    tbTruncateThreshold: 120,
    // 日期格式化
    dateFormatEnabled: true,
    dateFormatString: 'YY-MM-DD HH:mm:ss',
    // 搜索工具栏
    searchToolbarEnabled: true
};

// 配置项与DOM元素的映射
const CONFIG_FIELDS = [
    // 认证
    { key: 'username', type: 'text' },
    { key: 'password', type: 'text' },
    { key: 'keepAliveEnabled', type: 'checkbox' },
    // 菜单
    { key: 'highlightEnabled', type: 'checkbox' },
    { key: 'highlightColor', type: 'color' },
    // 表格总开关
    { key: 'tbFixEnabled', type: 'checkbox' },
    { key: 'tbMinHeight', type: 'number' },
    // 表格样式
    { key: 'tableFontFamily', type: 'select' },
    { key: 'tableFontSize', type: 'select' },
    { key: 'tablePadding', type: 'select' },
    { key: 'useGoogleFonts', type: 'checkbox' },
    // 固定表头
    { key: 'stickyHeaderEnabled', type: 'checkbox' },
    // 高级管理
    { key: 'tableManagerEnabled', type: 'checkbox' },
    { key: 'saveViewSettings', type: 'checkbox' },
    // 列宽
    { key: 'colMaxWidth', type: 'number' },
    { key: 'colMinWidth', type: 'number' },
    { key: 'colSampleRows', type: 'number' },
    // 截断
    { key: 'tbTruncateThreshold', type: 'number' },
    // 日期
    { key: 'dateFormatEnabled', type: 'checkbox' },
    { key: 'dateFormatString', type: 'select' },
    { key: 'dateFormatCustom', type: 'text' },
    // 搜索
    { key: 'searchToolbarEnabled', type: 'checkbox' }
];

function getElement(key) {
    return document.getElementById('cfg-' + key);
}

function loadConfig() {
    chrome.storage.local.get(['mes_config'], (result) => {
        const cfg = { ...DEFAULT_CFG, ...result.mes_config };
        
        CONFIG_FIELDS.forEach(field => {
            const el = getElement(field.key);
            if (!el) return;
            
            if (field.type === 'checkbox') {
                el.checked = cfg[field.key];
            } else if (field.type === 'number') {
                el.value = cfg[field.key];
            } else {
                el.value = cfg[field.key];
            }
        });
        
        // [新增] 处理日期格式自定义选项
        const dateFormatSelect = getElement('dateFormatString');
        const dateFormatCustom = getElement('dateFormatCustom');
        const customRow = document.getElementById('dateFormatCustomRow');
        
        if (dateFormatSelect && dateFormatCustom && customRow) {
            // 检查是否使用了自定义格式
            const currentFormat = cfg.dateFormatString || DEFAULT_CFG.dateFormatString;
            const isCustom = !dateFormatSelect.querySelector(`option[value="${currentFormat}"]`);
            
            if (isCustom && currentFormat !== '__CUSTOM__') {
                // 当前格式不在预设列表中，显示为自定义
                dateFormatSelect.value = '__CUSTOM__';
                dateFormatCustom.value = currentFormat;
                customRow.style.display = 'block';
            } else if (currentFormat === '__CUSTOM__') {
                // 如果保存的是 __CUSTOM__，使用自定义输入框的值
                dateFormatCustom.value = cfg.dateFormatCustom || DEFAULT_CFG.dateFormatString;
                customRow.style.display = 'block';
            } else {
                customRow.style.display = 'none';
            }
            
            // 监听下拉框变化
            dateFormatSelect.addEventListener('change', function() {
                if (this.value === '__CUSTOM__') {
                    customRow.style.display = 'block';
                    if (!dateFormatCustom.value) {
                        dateFormatCustom.value = DEFAULT_CFG.dateFormatString;
                    }
                    dateFormatCustom.focus();
                } else {
                    customRow.style.display = 'none';
                    dateFormatCustom.value = '';
                }
            });
        }
    });
}

function saveConfig() {
    const cfg = {};
    
    CONFIG_FIELDS.forEach(field => {
        const el = getElement(field.key);
        if (!el) return;
        
        if (field.type === 'checkbox') {
            cfg[field.key] = el.checked;
        } else if (field.type === 'number') {
            cfg[field.key] = parseInt(el.value) || DEFAULT_CFG[field.key];
        } else {
            cfg[field.key] = el.value;
        }
    });
    
    // [新增] 处理日期格式：如果选择了自定义，使用自定义输入框的值
    const dateFormatSelect = getElement('dateFormatString');
    const dateFormatCustom = getElement('dateFormatCustom');
    if (dateFormatSelect && dateFormatCustom) {
        if (dateFormatSelect.value === '__CUSTOM__') {
            // 使用自定义格式
            cfg.dateFormatString = dateFormatCustom.value.trim() || DEFAULT_CFG.dateFormatString;
            cfg.dateFormatCustom = dateFormatCustom.value.trim();
        } else {
            // 使用预设格式
            cfg.dateFormatString = dateFormatSelect.value;
            cfg.dateFormatCustom = '';
        }
    }
    
    // 自动生成高亮背景色
    cfg.highlightBackground = hexToRgba(cfg.highlightColor, 0.1);
    
    chrome.storage.local.set({ mes_config: cfg }, () => {
        const btn = document.getElementById('btn-save');
        const originalText = btn.textContent;
        btn.textContent = '✅ 保存成功！';
        btn.style.background = '#52c41a';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    });
}

function testLogin() {
    const user = getElement('username').value;
    const pwd = getElement('password').value;
    const statusDiv = document.getElementById('login-status');

    if (!user || !pwd) {
        statusDiv.innerText = '❌ 请先填写用户名和密码';
        statusDiv.style.color = '#ff4d4f';
        return;
    }

    statusDiv.innerText = '⏳ 正在测试...';
    statusDiv.style.color = '#1890ff';

    chrome.runtime.sendMessage({
        action: 'DO_LOGIN',
        data: { username: user, password: pwd }
    }, (response) => {
        if (response && response.success) {
            statusDiv.innerText = '✅ ' + response.msg;
            statusDiv.style.color = '#52c41a';
        } else {
            statusDiv.innerText = '❌ ' + (response ? response.msg : '请求超时');
            statusDiv.style.color = '#ff4d4f';
        }
    });
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    document.getElementById('btn-save').addEventListener('click', saveConfig);
    document.getElementById('btn-test-login').addEventListener('click', testLogin);
});
