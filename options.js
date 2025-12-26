const DEFAULT_CFG = {
    username: '',
    password: '',
    keepAliveEnabled: false,
    highlightEnabled: true,
    highlightColor: '#0078d7',
    tbFixEnabled: true,
    tbMinHeight: 580,
    tableFontFamily: '"JetBrains Mono", "Consolas", monospace',
    tableFontSize: '12px',
    tablePadding: '3px 2px',
    useGoogleFonts: true,
    stickyHeaderEnabled: true,
    tableManagerEnabled: true,
    saveViewSettings: false,
    colMaxWidth: 850,
    colMinWidth: 4,
    colSampleRows: 12,
    tbTruncateThreshold: 120,
    dateFormatEnabled: true,
    dateFormatString: 'YY-MM-DD HH:mm:ss',
    searchToolbarEnabled: true
};

const CONFIG_FIELDS = [
    { key: 'username', type: 'text' },
    { key: 'password', type: 'text' },
    { key: 'keepAliveEnabled', type: 'checkbox' },
    { key: 'highlightEnabled', type: 'checkbox' },
    { key: 'highlightColor', type: 'color' },
    { key: 'tbFixEnabled', type: 'checkbox' },
    { key: 'tableFontFamily', type: 'select' },
    { key: 'tableFontSize', type: 'select' },
    { key: 'tablePadding', type: 'select' },
    { key: 'useGoogleFonts', type: 'checkbox' },
    { key: 'stickyHeaderEnabled', type: 'checkbox' },
    { key: 'tableManagerEnabled', type: 'checkbox' },
    { key: 'saveViewSettings', type: 'checkbox' },
    { key: 'colMaxWidth', type: 'number' },
    { key: 'colMinWidth', type: 'number' },
    { key: 'colSampleRows', type: 'number' },
    { key: 'tbTruncateThreshold', type: 'number' },
    { key: 'dateFormatEnabled', type: 'checkbox' },
    { key: 'dateFormatString', type: 'select' },
    { key: 'dateFormatCustom', type: 'text' },
    { key: 'searchToolbarEnabled', type: 'checkbox' }
];

function getElement(key) {
    return document.getElementById('cfg-' + key);
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// === UI 交互逻辑 ===

// 1. 导航栏点击平滑滚动与高亮
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            // 移除其他激活状态
            navItems.forEach(nav => nav.classList.remove('active'));
            // 激活当前
            item.classList.add('active');

            // 滚动到目标区域
            const targetId = item.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if(targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

// === 新增：颜色选择器逻辑 ===
function setupColorPicker(savedColor) {
    const input = document.getElementById('cfg-highlightColor');
    const palette = document.getElementById('color-palette');
    const customBtn = document.getElementById('btn-custom-color');
    const options = palette.querySelectorAll('.color-option');

    // 1. 辅助函数：设置激活状态
    function setActive(color) {
        // 清除所有激活状态
        options.forEach(opt => opt.classList.remove('active'));
        customBtn.style.border = '2px solid rgba(0,0,0,0.1)';

        // 尝试找到匹配的预设色
        let found = false;
        options.forEach(opt => {
            if (opt.dataset.color.toLowerCase() === color.toLowerCase()) {
                opt.classList.add('active');
                found = true;
            }
        });

        // 如果不是预设色，说明是自定义的
        if (!found) {
            customBtn.style.background = color; // 让按钮显示当前颜色
            customBtn.style.border = '2px solid #000'; // 给个边框表示选中
        }

        // 更新隐藏的 input 值
        input.value = color;
    }

    // 2. 初始化显示
    setActive(savedColor || '#3b82f6');

    // 3. 预设色点击事件
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            setActive(opt.dataset.color);
        });
    });

    // 4. 自定义按钮点击 -> 触发原生 Input
    customBtn.addEventListener('click', () => {
        input.click(); // 触发隐藏 input 的颜色面板
    });

    // 5. 原生 Input 变化事件 (用户选完自定义颜色后)
    input.addEventListener('input', (e) => {
        setActive(e.target.value);
    });
}


// 2. 滑动条与数字输入框联动
function setupRangeSync() {
    const range = document.getElementById('cfg-tbTruncateThreshold-range');
    const number = document.getElementById('cfg-tbTruncateThreshold');

    if(range && number) {
        range.addEventListener('input', (e) => number.value = e.target.value);
        number.addEventListener('input', (e) => range.value = e.target.value);
    }
}

// 3. 核心配置加载逻辑
function loadConfig() {
    chrome.storage.local.get(['mes_config'], (result) => {
        const cfg = { ...DEFAULT_CFG, ...result.mes_config };

        CONFIG_FIELDS.forEach(field => {
            const el = getElement(field.key);
            if (!el) return;
            if (field.type === 'checkbox') el.checked = cfg[field.key];
            else if (field.type === 'number') el.value = cfg[field.key];
            else if (field.key !== 'highlightColor') el.value = cfg[field.key]; // 跳过旧的颜色赋值
        });

        // 初始化 Range Slider 的值
        const range = document.getElementById('cfg-tbTruncateThreshold-range');
        if (range) range.value = cfg.tbTruncateThreshold;

        // 【新增】初始化新的颜色选择器
        setupColorPicker(cfg.highlightColor);

        // 处理日期自定义 UI
        handleDateFormatUI(cfg);
    });
}

function handleDateFormatUI(cfg) {
    const dateFormatSelect = getElement('dateFormatString');
    const dateFormatCustom = getElement('dateFormatCustom');
    const customRow = document.getElementById('dateFormatCustomRow');

    if (dateFormatSelect && dateFormatCustom && customRow) {
        const currentFormat = cfg.dateFormatString || DEFAULT_CFG.dateFormatString;
        const isCustom = !dateFormatSelect.querySelector(`option[value="${currentFormat}"]`);

        // 判断是否是自定义格式
        if (isCustom && currentFormat !== '__CUSTOM__') {
            dateFormatSelect.value = '__CUSTOM__';
            dateFormatCustom.value = currentFormat;
            customRow.classList.remove('hidden');
            customRow.style.display = 'block';
        } else if (currentFormat === '__CUSTOM__') {
            dateFormatCustom.value = cfg.dateFormatCustom || DEFAULT_CFG.dateFormatString;
            customRow.classList.remove('hidden');
            customRow.style.display = 'block';
        } else {
            customRow.classList.add('hidden');
            customRow.style.display = 'none';
        }

        dateFormatSelect.addEventListener('change', function() {
            if (this.value === '__CUSTOM__') {
                customRow.classList.remove('hidden');
                customRow.style.display = 'block';
                if (!dateFormatCustom.value) dateFormatCustom.value = DEFAULT_CFG.dateFormatString;
                dateFormatCustom.focus();
            } else {
                customRow.classList.add('hidden');
                customRow.style.display = 'none';
            }
        });
    }
}

function saveConfig() {
    const cfg = {};
    const btn = document.getElementById('btn-save');
    const originalContent = btn.innerHTML;

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

    // 日期格式特殊处理
    const dateFormatSelect = getElement('dateFormatString');
    const dateFormatCustom = getElement('dateFormatCustom');
    if (dateFormatSelect && dateFormatSelect.value === '__CUSTOM__') {
        cfg.dateFormatString = dateFormatCustom.value.trim() || DEFAULT_CFG.dateFormatString;
        cfg.dateFormatCustom = dateFormatCustom.value.trim();
    } else {
        cfg.dateFormatString = dateFormatSelect.value;
        cfg.dateFormatCustom = '';
    }

    cfg.highlightBackground = hexToRgba(cfg.highlightColor, 0.1);

    // UI 反馈动画
    btn.innerHTML = '<i class="fa-solid fa-check"></i> 保存成功';
    btn.style.backgroundColor = '#10b981'; // Success Green
    btn.style.borderColor = '#10b981';

    chrome.storage.local.set({ mes_config: cfg }, () => {
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.style.backgroundColor = '';
            btn.style.borderColor = '';
        }, 1500);
    });
}

function testLogin() {
    const user = getElement('username').value;
    const pwd = getElement('password').value;
    const statusDiv = document.getElementById('login-status');

    if (!user || !pwd) {
        statusDiv.innerText = '请先填写用户名和密码';
        statusDiv.style.color = '#ef4444'; // Red
        return;
    }

    statusDiv.innerText = '正在连接 MES...';
    statusDiv.style.color = '#3b82f6'; // Blue

    chrome.runtime.sendMessage({
        action: 'DO_LOGIN',
        data: { username: user, password: pwd }
    }, (response) => {
        if (response && response.success) {
            statusDiv.innerHTML = '<i class="fa-solid fa-check-circle"></i> 测试通过';
            statusDiv.style.color = '#10b981'; // Green
        } else {
            statusDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + (response ? response.msg : '请求超时');
            statusDiv.style.color = '#ef4444'; // Red
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    setupNavigation();
    setupRangeSync();
    document.getElementById('btn-save').addEventListener('click', saveConfig);
    document.getElementById('btn-test-login').addEventListener('click', testLogin);
});