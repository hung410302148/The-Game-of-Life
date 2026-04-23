import { db, ref, set, onValue, update, get, push } from './firebase.js';


// =============================================
// 音效系統
// =============================================
const _audio = {
    //bgm:  null,
    spin: null,
    coin: null,
    _loaded: false,

    init() {
        if (this._loaded) return;
        this._loaded = true;
        //this.bgm  = new Audio('./BGM.mp3');
        this.spin = new Audio('./SPIN.mp3');
        this.coin = new Audio('./COIN.mp3');
        //this.bgm.loop   = true;
        //this.bgm.volume = 0.2;
        this.spin.volume = 1;
        this.coin.volume = 0.8;
    },

    // playBGM() {
    //     this.init();
    //     if (!this.bgm) return;
    //     this.bgm.currentTime = 0;
    //     this.bgm.play().catch(() => {});
    // },

    playSpin() {
        this.init();
        if (!this.spin) return;
        this.spin.currentTime = 0;
        this.spin.play().catch(() => {});
    },

    playCoin() {
        this.init();
        if (!this.coin) return;
        this.coin.currentTime = 0;
        this.coin.play().catch(() => {});
    }
};

// =============================================
// 狀態變數
// =============================================
let currentModifyTarget = null;
let tempModifyValue = 0;
let inputMode = false;
let inputBuffer = "";
let inputDirection = null;
let isSpinning = false;
let activeFuncMode = null;

// HOUSE 子狀態
let houseSelection = null; // 'small' | 'medium' | 'luxury'
// CHANCE 子狀態
let chanceInvestAmount = 0;
let chancePhase = 'INPUT'; // 'INPUT' | 'SPIN'
// LOTTERY 子狀態
let lotteryMultiplier = 1;
let lotteryPicks = [];
let lotteryM = 0;

// =============================================
// 初始化
// =============================================
window.addEventListener('load', () => {
    const savedName   = localStorage.getItem('lifeGame_myName');
    const savedRoomId = localStorage.getItem('lifeGame_myRoomId');
    if (savedName && savedRoomId) {
        update(ref(db, `rooms/${savedRoomId}/players/${savedName}`), { status: "online", isVisible: true });
        showGamePage(savedName, savedRoomId);
    }
});

// =============================================
// 加入遊戲
// =============================================
document.getElementById('joinBtn').addEventListener('click', async () => {
    const name   = document.getElementById('playerName').value.trim();
    const roomId = document.getElementById('roomID').value.trim();
    if (!name)   return alert("請輸入名字");
    if (!roomId) return alert("請輸入房間號碼");
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    try {
        const snapshot = await get(playerRef);
        if (snapshot.exists()) {
            await update(playerRef, { status: "online", isVisible: true });
        } else {
            await set(playerRef, {
                name, balance: 0, lifeValue: 0, yearsLeft: 30, salary: 5000,
                marriage: false, baby: 0,
                house: { small: false, medium: false, luxury: false,
                         smallValue: 200000, mediumValue: 500000, luxuryValue: 1000000 },
                car: { car1: null, car2: null }, degree: { bachelor: false, phd: false },
                status: "online", isVisible: true
            });
        }
        localStorage.setItem('lifeGame_myName', name);
        localStorage.setItem('lifeGame_myRoomId', roomId);
        // 如果是新玩家，登記進入順序
        if (!snapshot.exists()) await registerPlayerOrder(roomId, name);
        showGamePage(name, roomId);
    } catch (e) {
        console.error("登入出錯:", e);
        alert("連線資料庫失敗");
    }
});

// =============================================
// 顯示遊戲頁
// =============================================
function showGamePage(name, roomId) {
    document.getElementById('join-page').style.display  = 'none';
    document.getElementById('log-page').style.display   = 'none';
    document.getElementById('game-page').style.display  = 'flex';
    document.querySelector('#welcome-msg-name').innerText = name;
    // 退出按鈕顯示房間號
    const leaveBtnEl = document.getElementById('leaveBtn');
    if (leaveBtnEl) leaveBtnEl.innerText = '退出 [' + roomId + '] 遊戲';
    // 播放 BGM（使用者已互動過，可以播放）
    //_audio.playBGM();
    listenToMyStatus(name, roomId);
    listenAllPlayers_NEW(roomId);
    listenGameStatus_NEW();
    setupTempControl(roomId);
}

// =============================================
// 監聽自己的資料
// =============================================
function listenToMyStatus(name, roomId) {
    onValue(ref(db, `rooms/${roomId}/players/${name}`), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        const balanceEl = document.getElementById('display-balance');
        const prevBalance = parseInt(balanceEl.dataset.val ?? data.balance, 10);
        balanceEl.dataset.val = data.balance;
        balanceEl.innerText = '$' + data.balance;
        balanceEl.classList.toggle('negative-money', data.balance < 0);
        if (prevBalance !== data.balance) animateStatBox('display-balance-box', data.balance > prevBalance);

        const lifeEl = document.getElementById('display-life');
        const prevLife = parseInt(lifeEl.dataset.val ?? data.lifeValue, 10);
        lifeEl.dataset.val = data.lifeValue;
        lifeEl.innerText = data.lifeValue;
        if (prevLife !== data.lifeValue) animateStatBox('display-life-box', data.lifeValue > prevLife);
        // years 由 listenGameStatus_NEW 從 status 更新，這裡不覆蓋
        document.getElementById('display-salary').innerText = formatSalary(data.salary ?? 0);
        document.getElementById('status-marriage').innerText = data.marriage ? '已婚' : '無';
        const baby = data.baby ?? 0;
        document.getElementById('status-child').innerText = baby > 0 ? baby : '無';
        const h = data.house ?? {};
        const houseList = [h.small && '小', h.medium && '中', h.luxury && '豪'].filter(Boolean);
        document.getElementById('status-house').innerText = houseList.length ? houseList.join('/') : '無';
        // car：顯示「轎/豪」順序（先轎後豪）
        const car = data.car ?? {};
        const carSlots = [car.car1, car.car2].filter(c => c && c.type);
        if (carSlots.length === 0) {
            document.getElementById('status-car').innerText = '無';
        } else {
            // 先轎後豪排序
            const sorted = [...carSlots].sort((a, b) => {
                if (a.type === 'sedan' && b.type !== 'sedan') return -1;
                if (a.type !== 'sedan' && b.type === 'sedan') return 1;
                return 0;
            });
            document.getElementById('status-car').innerText = sorted.map(c => {
                if (c.type === 'luxury') return (c.age ?? 0) >= 15 ? '古董' : '豪';
                return '轎';
            }).join('/');
        }
        // degree
        const deg = data.degree ?? {};
        if (deg.phd) document.getElementById('status-edu').innerText = '博士';
        else if (deg.bachelor) document.getElementById('status-edu').innerText = '學士';
        else document.getElementById('status-edu').innerText = '無';
    });
}

function animateStatBox(boxId, isPositive) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.classList.remove('stat-anim-up', 'stat-anim-down');
    // force reflow
    void box.offsetWidth;
    box.classList.add(isPositive ? 'stat-anim-up' : 'stat-anim-down');
    setTimeout(() => box.classList.remove('stat-anim-up', 'stat-anim-down'), 600);
}

function formatSalary(val) {
    if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'm';
    if (val >= 1000)    return '$' + (val / 1000).toFixed(1) + 'k';
    return '$' + val;
}
function formatMoney(val) {
    if (Math.abs(val) >= 1000000) return '$' + (val / 1000000).toFixed(2) + 'm';
    if (Math.abs(val) >= 1000)    return '$' + (val / 1000).toFixed(1) + 'k';
    return '$' + val;
}


// =============================================
// FUNC-PANEL：通用功能面板系統
// =============================================
let funcPanelDigitCallback = null;  // digit OK 按下後的 callback(value)
let funcPanelActive = false;

function openFuncPanel(title, bodyHTML, actionsHTML, showDigit = false, digitCallback = null) {
    funcPanelActive = true;
    const panel = document.getElementById('func-panel');
    document.getElementById('func-panel-title').innerText = title;
    document.getElementById('func-panel-body').innerHTML = bodyHTML;
    document.getElementById('func-panel-actions').innerHTML = actionsHTML;

    // digit pad
    const digitPad = document.getElementById('func-digit-pad');
    if (showDigit) {
        digitPad.style.display = 'block';
        document.getElementById('digit-display').innerText = '-';
        funcPanelDigitCallback = digitCallback;
        _digitBuffer = '';
    } else {
        digitPad.style.display = 'none';
        funcPanelDigitCallback = null;
    }

    panel.style.display = 'block';
    // 確保面板在視窗中可見
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeFuncPanel() {
    document.getElementById('func-panel').style.display = 'none';
    funcPanelActive = false;
    funcPanelDigitCallback = null;
    _digitBuffer = '';
    document.getElementById('digit-display').innerText = '-';
}

function updateFuncPanelBody(html) {
    document.getElementById('func-panel-body').innerHTML = html;
}

function updateFuncPanelMsg(msg, type = '') {
    const body = document.getElementById('func-panel-body');
    let msgEl = body.querySelector('.func-panel-msg');
    if (!msgEl) { msgEl = document.createElement('div'); msgEl.className = 'func-panel-msg'; body.appendChild(msgEl); }
    msgEl.className = 'func-panel-msg ' + type;
    msgEl.innerText = msg;
}

// 數字鍵盤輸入
let _digitBuffer = '';
document.getElementById('func-panel').addEventListener('click', (e) => {
    const btn = e.target.closest('.digit-btn');
    if (!btn) return;
    const d = btn.getAttribute('data-digit');
    if (d === 'del') {
        _digitBuffer = _digitBuffer.slice(0, -1);
    } else if (d === 'ok') {
        if (funcPanelDigitCallback && _digitBuffer) {
            funcPanelDigitCallback(parseInt(_digitBuffer, 10) || 0);
        }
        return;
    } else {
        if (_digitBuffer === '0') _digitBuffer = d;
        else _digitBuffer += d;
    }
    document.getElementById('digit-display').innerText = _digitBuffer || '-';
});

// X 關閉按鈕
document.getElementById('func-panel-close').addEventListener('click', () => {
    closeFuncPanel();
    resetOperation();
});

// =============================================
// 金錢 / 人生值 點擊 → func-panel digit mode
// =============================================
// =============================================
// 加減模式（使用 func-panel）
// =============================================
document.getElementById('display-balance-box').addEventListener('click', () => activateAdjust('balance'));
document.getElementById('display-life-box').addEventListener('click',   () => activateAdjust('lifeValue'));

function activateAdjust(target) {
    if (activeFuncMode) return;
    clearFuncActive();
    resetAdjustUI();
    currentModifyTarget = target;
    activeFuncMode = 'ADJUST_' + target;

    const label = target === 'balance' ? '💰 金錢' : '❤️ 人生值';
    const targetId = target === 'balance' ? 'display-balance-box' : 'display-life-box';
    document.getElementById(targetId).classList.add('active-status');
    setSpinLocked(true);
    setEndTurnLocked(true);

    let _adjDirection = null; // 先選方向

    openFuncPanel(
        label + ' 調整',
        '<div class="func-panel-msg" id="adj-msg">先按 ＋ 或 − 選擇方向</div>' +
        '<div class="func-panel-actions center" style="padding:8px 0 4px;">' +
            '<button class="func-action-btn confirm" id="adj-plus-btn" style="font-size:22px;padding:8px 20px;min-width:70px;line-height:1;">+</button>' +
            '<button class="func-action-btn sell" id="adj-minus-btn" style="font-size:22px;padding:8px 20px;min-width:70px;line-height:1;">-</button>' +
        '</div>',
        '',
        false  // digit pad hidden initially
    );

    setTimeout(() => {
        document.getElementById('adj-plus-btn')?.addEventListener('click', () => {
            _adjDirection = 'PLUS';
            document.getElementById('adj-msg').innerText = '＋ 輸入數字後按 OK';
            document.getElementById('func-digit-pad').style.display = 'block';
            funcPanelDigitCallback = (val) => { _pendingAdjustVal = val; };
            _digitBuffer = '';
            document.getElementById('digit-display').innerText = '-';
            // OK 送出
            funcPanelDigitCallback = (val) => { _pendingAdjustVal = val; commitAdjust(_adjDirection); };
        });
        document.getElementById('adj-minus-btn')?.addEventListener('click', () => {
            _adjDirection = 'MINUS';
            document.getElementById('adj-msg').innerText = '− 輸入數字後按 OK';
            document.getElementById('func-digit-pad').style.display = 'block';
            _digitBuffer = '';
            document.getElementById('digit-display').innerText = '-';
            funcPanelDigitCallback = (val) => { _pendingAdjustVal = val; commitAdjust(_adjDirection); };
        });
    }, 0);
}

let _pendingAdjustVal = 0;
async function commitAdjust(direction) {
    if (!currentModifyTarget || !_pendingAdjustVal) {
        updateFuncPanelMsg('⚠️ 請先輸入數字', 'warn'); return;
    }
    const delta = direction === 'PLUS' ? _pendingAdjustVal : -_pendingAdjustVal;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    if (snap.exists()) {
        const cur = snap.val()[currentModifyTarget] ?? 0;
        const newVal = cur + delta;
        await update(playerRef, { [currentModifyTarget]: newVal });
        const lbl = currentModifyTarget === 'balance' ? '金錢' : '人生值';
        addLog(roomId, name, lbl + ' ' + (delta > 0 ? '+' : '') + delta + ' → ' + newVal);
        if (delta > 0 && currentModifyTarget === 'balance') _audio.playCoin();
    }
    closeFuncPanel();
    resetOperation();
}

// =============================================
// func-btn 點擊
// =============================================
document.querySelectorAll('.func-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-val');

        // inputMode 已移至 func-panel，func-btn 點擊在功能進行中時不觸發新功能
        if (activeFuncMode && activeFuncMode !== 'LOTTERY') {
            // 功能進行中，忽略 func-btn 點擊（func-panel 處理輸入）
            return;
        }

        // 舊版 HOUSE/CAR/DEGREE func-btn 攔截已移至 func-panel

        const funcName = btn.querySelector('.func-label') ? btn.querySelector('.func-label').innerText.trim() : '';

        if (btn.classList.contains('func-active')) return;
        clearFuncActive();
        // LOTTERY 與 LOG 不加 func-active（避免白邊框鎖住自己）
        if (funcName !== 'LOTTERY' && funcName !== 'LOG') {
            btn.classList.add('func-active');
        }
        setSpinLocked(true);
        setEndTurnLocked(true);
        showSideButtons(true);
        document.getElementById('minusBtn').classList.remove('active');
        document.getElementById('plusBtn').classList.remove('active');
        dispatchFuncBtn(val, funcName);
    });
});

// =============================================
// 功能分派
// =============================================
function cleanPreviousMode() {
    // 清除上一個功能留下的視覺狀態（house-dim、digit-input 等）
    // 但不 resetOperation（讓呼叫端自己決定）
    document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
    document.body.classList.remove('digit-input');
    document.getElementById('minusBtn').classList.remove('active', 'selected');
    document.getElementById('plusBtn').classList.remove('active', 'selected');
    inputMode = false; inputBuffer = "";
    houseSelection = null; carSelection = null; degreeSelection = null;
    babyPending = 0; carPending = null; carSellSlot = null;
}

function dispatchFuncBtn(val, funcName) {
    switch (funcName) {
        case 'SALARY':
            activeFuncMode = 'SALARY';
            openFuncPanel('💼 薪資設定', '<div class="func-panel-msg">輸入新的薪資金額</div>', '', true, async (val) => {
                const r = localStorage.getItem('lifeGame_myRoomId'), n = localStorage.getItem('lifeGame_myName');
                const pRef = ref(db, `rooms/${r}/players/${n}`);
                const old = (await get(pRef)).val()?.salary ?? 0;
                await update(pRef, { salary: val });
                addLog(r, n, '薪資更新：' + formatSalary(old) + ' → ' + formatSalary(val));
                updateFuncPanelMsg('✅ 薪資已更新為 ' + formatSalary(val), 'success');
                setTimeout(() => { closeFuncPanel(); resetOperation(); }, 1200);
            });
            break;
        case 'YEARS':
            activeFuncMode = 'YEARS';
            openFuncPanel('📅 設定回合數', '<div class="func-panel-msg">輸入回合數（任何玩家均可設定）</div>', '', true, async (val) => {
                const r = localStorage.getItem('lifeGame_myRoomId'), n = localStorage.getItem('lifeGame_myName');
                await update(ref(db, `rooms/${r}/status`), { years: val, phase: 'PLAYING' });
                addLog(r, n, '設定回合數：' + val);
                updateFuncPanelMsg('✅ 設定 ' + val + ' 回合', 'success');
                setTimeout(() => { closeFuncPanel(); resetOperation(); }, 1200);
            });
            break;
        case 'LOG':
            // LOG 不加 func-active（避免白邊框導致自己鎖住）
            showLogPage();
            // 把 LOG btn 的 func-active 移除（不讓它保持白邊框）
            document.querySelectorAll('.func-btn').forEach(b => {
                if (b.getAttribute('data-val') === '9') b.classList.remove('func-active');
            });
            break;
        case 'MARRIAGE':
            activeFuncMode = 'MARRIAGE'; initMarriage(); break;
        case 'HOUSE':     activeFuncMode='HOUSE';   initHouse_panel(); break;
        case 'CAR':       activeFuncMode='CAR';     initCar_panel(); break;
        case 'BABY':      activeFuncMode='BABY';    initBaby_panel(); break;
        case 'DEGREE':    activeFuncMode='DEGREE';  initDegree_panel(); break;
        case 'CHANCE':    activeFuncMode='CHANCE';  initChance_panel(); break;
        case 'LOTTERY':   activeFuncMode='LOTTERY'; initLottery(); break;
        default:          activeFuncMode=funcName||'FUNC_'+val; document.getElementById('turn-indicator').innerText='功能 "'+funcName+'" 開發中...'; break;
    }
}

// MARRIAGE (init moved to func-panel below)

async function execMarriage() {
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const isMarried = data?.marriage === true;
    const giftPerPerson = isMarried ? 500 : 1000;

    const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
    const players = playersSnap.val() ?? {};
    let totalGift = 0;
    for (const p of Object.values(players)) {
        if (p.name !== name && p.isVisible) {
            await update(ref(db, `rooms/${roomId}/players/${p.name}`), { balance: (p.balance ?? 0) - giftPerPerson });
            totalGift += giftPerPerson;
        }
    }
    await update(playerRef, {
        balance: (data.balance ?? 0) + totalGift,
        lifeValue: (data.lifeValue ?? 0) + 3000,
        marriage: true
    });
    const label = isMarried ? '結婚周年' : '結婚';
    addLog(roomId, name, label + '！禮金 +' + formatMoney(totalGift) + '，人生值 +3000');
    document.getElementById('turn-indicator').innerText = '🎊 ' + label + '！+' + formatMoney(totalGift) + ' 禮金，+3000 人生值';
    cleanHouseDim();
    setTimeout(() => resetOperation(), 2000);
}

// =============================================
// HOUSE
// =============================================
const HOUSE_PRICES = { small: 200000, medium: 500000, luxury: 1000000 };
const HOUSE_LABELS = { small: '小房子', medium: '中房子', luxury: '豪華別墅' };
const HOUSE_KEYS   = { '1': 'small', '2': 'medium', '3': 'luxury' };
// initHouse moved to initHouse_panel below

async function selectHouseType(val) {
    const key = HOUSE_KEYS[val];
    if (!key) return;
    houseSelection = key;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const h      = snap.val()?.house ?? {};
    if (h[key]) {
        const currentValue = h[key + 'Value'] ?? HOUSE_PRICES[key];
        document.getElementById('minusBtn').classList.add('active');
        document.getElementById('turn-indicator').innerText = HOUSE_LABELS[key] + ' 現值 ' + formatMoney(currentValue) + ' → 按 - 賣出';
    } else {
        document.getElementById('plusBtn').classList.add('active');
        document.getElementById('turn-indicator').innerText = HOUSE_LABELS[key] + ' ' + formatMoney(HOUSE_PRICES[key]) + ' → 按 + 購買';
    }
}

async function execHouseBuy() {
    if (!houseSelection) return;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const price = HOUSE_PRICES[houseSelection];
    const upd = { balance: (data.balance ?? 0) - price };
    upd['house/' + houseSelection] = true;
    upd['house/' + houseSelection + 'Value'] = price;
    await update(playerRef, upd);
    addLog(roomId, name, '購買 ' + HOUSE_LABELS[houseSelection] + ' -' + formatMoney(price));
    document.getElementById('turn-indicator').innerText = '🏠 購買 ' + HOUSE_LABELS[houseSelection] + '！';
    cleanHouseDim(); setTimeout(() => resetOperation(), 1500);
}

async function execHouseSell() {
    if (!houseSelection) return;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const sellPrice = data?.house?.[houseSelection + 'Value'] ?? HOUSE_PRICES[houseSelection];
    const upd = { balance: (data.balance ?? 0) + sellPrice };
    upd['house/' + houseSelection] = false;
    upd['house/' + houseSelection + 'Value'] = HOUSE_PRICES[houseSelection];
    await update(playerRef, upd);
    addLog(roomId, name, '賣出 ' + HOUSE_LABELS[houseSelection] + ' +' + formatMoney(sellPrice));
    document.getElementById('turn-indicator').innerText = '🏠 賣出 ' + HOUSE_LABELS[houseSelection] + '！+' + formatMoney(sellPrice);
    cleanHouseDim(); setTimeout(() => resetOperation(), 1500);
}

function cleanHouseDim() {
    document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
    houseSelection = null;
}

async function applyHouseGrowth(roomId, name) {
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const h = data?.house ?? {};
    const upd = {};
    let lifeBonus = 0;
    for (const key of ['small', 'medium', 'luxury']) {
        if (h[key]) {
            const cur = h[key + 'Value'] ?? HOUSE_PRICES[key];
            upd['house/' + key + 'Value'] = Math.round(cur * 1.06);
            lifeBonus += 100;
        }
    }
    if (Object.keys(upd).length > 0) {
        upd.lifeValue = (data.lifeValue ?? 0) + lifeBonus;
        await update(playerRef, upd);
        addLog(roomId, name, '房產增值 6%，人生值 +' + lifeBonus);
    }
}

// =============================================
// CAR（支援同時兩台：car1 / car2）
// =============================================
const CAR_PRICES = { sedan: 10000, luxury: 50000 };
let carSelection = null;   // 'sedan' | 'luxury' | null
let carSellSlot  = null;   // 'car1' | 'car2' | null（賣車時用）
let carPending   = null;   // { slot, type, price } 按 ENTER 前暫存

function getCarLabel(c) {
    if (!c || !c.type) return null;
    if (c.type === 'luxury') return (c.age ?? 0) >= 15 ? '古董車' : '豪車';
    return '轎車';
}

// initCar moved to initCar_panel below

function selectCarType(val) {
    if (!['1','2'].includes(val)) return;
    carSelection = val === '1' ? 'sedan' : 'luxury';
    const price = CAR_PRICES[carSelection];
    const label = carSelection === 'sedan' ? '轎車' : '豪車';
    carPending = null;
    // 顯示金額，+ 確認
    document.getElementById('plusBtn').classList.add('active');
    document.getElementById('turn-indicator').innerText = label + ' ' + formatMoney(price) + '，按 + 確認，ENTER 購買';
}

async function execCarBuy() {
    if (!carSelection) return;
    const price = CAR_PRICES[carSelection];
    const label = carSelection === 'sedan' ? '轎車' : '豪車';

    // 找空槽
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const car = data?.car ?? {};
    const slot = (!car.car1 || !car.car1.type) ? 'car1' : (!car.car2 || !car.car2.type) ? 'car2' : null;
    if (!slot) {
        document.getElementById('turn-indicator').innerText = '⚠️ 車庫已滿（最多2台）';
        return;
    }
    // 暫存待確認
    carPending = { slot, type: carSelection, price };
    document.getElementById('turn-indicator').innerText = label + ' ' + formatMoney(price) + ' → 放入' + slot + '，按 ENTER 確認';
}

async function execCarSell() {
    // 選擇要賣哪台
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const car    = snap.val()?.car ?? {};
    const has1 = car.car1 && car.car1.type;
    const has2 = car.car2 && car.car2.type;

    if (!has1 && !has2) { document.getElementById('turn-indicator').innerText = '⚠️ 沒有車可賣'; return; }

    if (has1 && has2) {
        // 兩台都有：顯示選擇，下一次按 1/2 決定（暫存 sell mode）
        carSellSlot = 'CHOOSE';
        document.getElementById('turn-indicator').innerText =
            '賣哪台？1=' + getCarLabel(car.car1) + ' ' + formatMoney(car.car1.value) +
            '  2=' + getCarLabel(car.car2) + ' ' + formatMoney(car.car2.value);
    } else {
        carSellSlot = has1 ? 'car1' : 'car2';
        const c = car[carSellSlot];
        carPending = { slot: carSellSlot, sell: true, price: c.value };
        document.getElementById('turn-indicator').innerText =
            '賣出 ' + getCarLabel(c) + ' +' + formatMoney(c.value) + '，按 ENTER 確認';
    }
}

async function commitCar() {
    if (!carPending) return;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();

    if (carPending.sell) {
        const upd = { balance: (data.balance ?? 0) + carPending.price };
        upd['car/' + carPending.slot] = null;
        await update(playerRef, upd);
        addLog(roomId, name, '賣出車輛 (' + carPending.slot + ') +' + formatMoney(carPending.price));
        document.getElementById('turn-indicator').innerText = '🚗 賣出！+' + formatMoney(carPending.price);
    } else {
        const newCar = { type: carPending.type, value: carPending.price, age: 0 };
        const upd = { balance: (data.balance ?? 0) - carPending.price };
        upd['car/' + carPending.slot] = newCar;
        await update(playerRef, upd);
        const label = carPending.type === 'sedan' ? '轎車' : '豪車';
        addLog(roomId, name, '購買' + label + ' (' + carPending.slot + ') -' + formatMoney(carPending.price));
        document.getElementById('turn-indicator').innerText = '🚗 購買' + label + '！';
    }
    carPending = null; carSellSlot = null; carSelection = null;
    cleanCarDim(); setTimeout(() => resetOperation(), 1500);
}

function cleanCarDim() {
    document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
    carSelection = null; carSellSlot = null; carPending = null;
}

// 每回合車輛折舊/增值
async function applyCarAging(roomId, name) {
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const car = data?.car ?? {};
    const upd = {};
    let lifeBonus = 0;

    for (const slot of ['car1','car2']) {
        const c = car[slot];
        if (!c || !c.type) continue;
        const newAge = (c.age ?? 0) + 1;
        if (c.type === 'sedan') {
            const newVal = Math.max(0, (c.value ?? 0) - 1000);
            if (newAge >= 10) {
                upd['car/' + slot] = null;
                addLog(roomId, name, slot + ' 轎車報廢（10年）');
            } else {
                upd['car/' + slot + '/value'] = newVal;
                upd['car/' + slot + '/age'] = newAge;
            }
            lifeBonus += 100;
        } else if (c.type === 'luxury') {
            let newVal;
            if (newAge <= 8) {
                // 前8年折舊，最低10k
                newVal = Math.max(10000, (c.value ?? 0) - 5000);
            } else if (newAge < 15) {
                // 第9~14年：維持現值（不漲不跌）
                newVal = c.value ?? 0;
            } else {
                // 第15年起成為古董車，升值
                newVal = (c.value ?? 0) + 5000;
            }
            upd['car/' + slot + '/value'] = newVal;
            upd['car/' + slot + '/age'] = newAge;
            lifeBonus += 200;
        }
    }
    if (Object.keys(upd).length > 0) {
        upd.lifeValue = (data.lifeValue ?? 0) + lifeBonus;
        await update(playerRef, upd);
    }
}

// SPIN 跳過步數（轎車跳 1，豪車跳 1 和 2）
function getSpinSkips(carData) {
    if (!carData) return [];
    const slots = [carData.car1, carData.car2].filter(c => c && c.type);
    if (slots.some(c => c.type === 'luxury')) return [1, 2];
    if (slots.some(c => c.type === 'sedan')) return [1];
    return [];
}

// =============================================
// BABY
// =============================================
// initBaby moved to initBaby_panel below

let babyPending = 0; // 暫存要增加的數量，ENTER 後才執行

async function execBaby(delta) {
    // 按 + 每次 +1，最多累積到 2，預覽後 ENTER 確認
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const cur = snap.val()?.baby ?? 0;
    const next = babyPending + 1;
    if (next > 2) {
        document.getElementById('turn-indicator').innerText = '⚠️ 每次至多增加 2 個！按 ENTER 確認';
        return;
    }
    const newBaby = Math.min(9, cur + next);
    if (newBaby === cur && cur === 9) {
        document.getElementById('turn-indicator').innerText = '⚠️ 已達上限 9 個！';
        return;
    }
    babyPending = next;
    const actualNew = Math.min(9, cur + babyPending);
    document.getElementById('turn-indicator').innerText =
        '👶 增加 ' + babyPending + ' 個（共' + actualNew + '個）每人 -$' + (500 * babyPending) + '，按 ENTER 確認';
}

async function commitBaby() {
    if (babyPending <= 0) return;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const cur = data.baby ?? 0;
    const newBaby = cur + babyPending;

    let giftTotal = 0;
    const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
    for (const p of Object.values(playersSnap.val() ?? {})) {
        if (p.name !== name && p.isVisible) {
            await update(ref(db, `rooms/${roomId}/players/${p.name}`), { balance: (p.balance ?? 0) - 500 * babyPending });
            giftTotal += 500 * babyPending;
        }
    }
    await update(playerRef, {
        balance: (data.balance ?? 0) + giftTotal,
        baby: newBaby,
        lifeValue: (data.lifeValue ?? 0) + 350 * babyPending
    });
    addLog(roomId, name, 'BABY +' + babyPending + '（共' + newBaby + '個）禮金 +' + formatMoney(giftTotal) + ' 人生值 +' + (350 * babyPending));
    document.getElementById('turn-indicator').innerText = '👶 子女：' + newBaby + ' 個！禮金 +' + formatMoney(giftTotal);
    babyPending = 0;
    setTimeout(() => resetOperation(), 1500);
}

// 每回合 BABY 費用結算（在 endTurn 呼叫，不含本回合）
async function applyBabyCost(roomId, name) {
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const babies = data.baby ?? 0;
    if (babies === 0) return;
    const salary = data.salary ?? 0;
    // 每個 baby 扣 10% salary，最多 40%
    const pct = Math.min(0.4, babies * 0.1);
    const cost = Math.round(salary * pct);
    // 每個 baby 每回合 +350 人生值
    const lifeGain = babies * 350;
    await update(playerRef, {
        balance: (data.balance ?? 0) - cost,
        lifeValue: (data.lifeValue ?? 0) + lifeGain
    });
    if (cost > 0 || lifeGain > 0)
        addLog(roomId, name, 'BABY 結算：-' + formatMoney(cost) + ' 生活費，人生值 +' + lifeGain);
}

// =============================================
// MARRIAGE LIFE BONUS（結婚每回合 +1500 人生值）
// =============================================
async function applyMarriageBonus(roomId, name) {
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    if (!data?.marriage) return;
    await update(playerRef, { lifeValue: (data.lifeValue ?? 0) + 1500 });
    addLog(roomId, name, '婚姻加成 +1500 人生值');
}

// =============================================
// DEBT INTEREST（負債 10% 利息）
// =============================================
async function applyDebtInterest(roomId, name) {
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const balance = snap.val()?.balance ?? 0;
    if (balance >= 0) return;
    const interest = Math.round(Math.abs(balance) * 0.1);
    await update(playerRef, { balance: balance - interest });
    addLog(roomId, name, '負債利息 -' + formatMoney(interest) + '（10%）');
}

// =============================================
// DEGREE
// =============================================
const DEG_COSTS = { bachelor: 100000, phd: 300000 };
let degreeSelection = null; // 'bachelor' | 'phd'

// initDegree moved to initDegree_panel below

function selectDegreeType(val) {
    if (!['1','2'].includes(val)) return;
    degreeSelection = val === '1' ? 'bachelor' : 'phd';
    const label = degreeSelection === 'bachelor' ? '學士學位' : '博士學位';
    document.getElementById('turn-indicator').innerText = label + '，按 ENTER 確認';
}

async function execDegree() {
    if (!degreeSelection) return;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const deg = snap.val()?.degree ?? {};

    if (deg[degreeSelection]) {
        document.getElementById('turn-indicator').innerText = '✅ 已有此學位';
        setTimeout(() => { cleanDegreeDim(); resetOperation(); }, 1500); return;
    }

    // 不扣錢，直接記錄學位
    const upd = {};
    upd['degree/' + degreeSelection] = true;
    await update(playerRef, upd);
    const label = degreeSelection === 'bachelor' ? '學士' : '博士';
    addLog(roomId, name, '取得' + label + '學位');
    document.getElementById('turn-indicator').innerText = '🎓 取得' + label + '學位！';
    cleanDegreeDim(); setTimeout(() => resetOperation(), 1500);
}

function cleanDegreeDim() {
    document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
    degreeSelection = null;
}

// =============================================
// CHANCE
// =============================================
// initChance moved to initChance_panel below

async function execChanceInput() {
    const amount = parseInt(inputBuffer, 10);
    if (isNaN(amount) || amount < 0) return;
    if (amount > 100000) {
        document.getElementById('turn-indicator').innerText = '⚠️ 上限 $100,000!';
        inputBuffer = ""; return;
    }
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    //金錢可以為負數
    // if ((data.balance ?? 0) < amount) {
    //     document.getElementById('turn-indicator').innerText = '💸 金錢不足！';
    //     inputBuffer = ""; return;
    // }
    // 先記錄金額，不扣款，等 SPIN 後才處理
    chanceInvestAmount = amount;
    chancePhase = 'SPIN';
    inputMode = false;
    document.body.classList.remove('digit-input');
    const spinBtn = document.getElementById('spinBtn');
    spinBtn.classList.remove('spin-locked', 'spin-done');
    spinBtn.disabled = false;
    document.getElementById('turn-indicator').innerText = '金額 ' + formatMoney(amount) + '，按 SPIN 決定結果！';
}

async function execChanceSpin() {
    const chanceBtns = Array.from(document.querySelectorAll('.func-btn')).slice(0, 3);
    const resultIdx  = Math.floor(Math.random() * 3);
    let currentIndex = 0; let delay = 60;
    const totalSteps = 30 + resultIdx;
    for (let i = 0; i < totalSteps; i++) {
        chanceBtns.forEach(b => b.classList.remove('highlight'));
        chanceBtns[currentIndex].classList.add('highlight');
        if (i > totalSteps - 8) delay += 50;
        await new Promise(r => setTimeout(r, delay));
        currentIndex = (currentIndex + 1) % chanceBtns.length;
    }
    chanceBtns.forEach(b => b.classList.remove('highlight', 'light-on'));
    chanceBtns[resultIdx].classList.add('light-on');

    const success = resultIdx > 0;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const freshSnap = await get(playerRef);
    const curBal = freshSnap.val()?.balance ?? 0;
    if (success) {
        // 成功：淨賺投資金額（不扣本金，直接加倍回報）
        await update(playerRef, { balance: curBal + chanceInvestAmount });
        addLog(roomId, name, 'CHANCE 成功！增加 +' + formatMoney(chanceInvestAmount));
        document.getElementById('turn-indicator').innerText = '✅ 成功！增加 +' + formatMoney(chanceInvestAmount) + '  按 ENTER 結束';
    } else {
        // 失敗：扣除投資金額
        await update(playerRef, { balance: curBal - chanceInvestAmount });
        addLog(roomId, name, 'CHANCE 失敗！損失 -' + formatMoney(chanceInvestAmount));
        document.getElementById('turn-indicator').innerText = '❌ 失敗！損失 -' + formatMoney(chanceInvestAmount) + '  按 ENTER 結束';
    }
    chancePhase = 'DONE';
}


// =============================================
// MARRIAGE func-panel
// =============================================
async function initMarriage() {
    cleanPreviousMode();
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const isMarried = snap.val()?.marriage === true;
    const label = isMarried ? '結婚周年 💒' : '結婚吧！💒';
    const desc  = isMarried
        ? '每位玩家扣 $500 作為周年禮金，你將獲得 +3000 人生值'
        : '每位玩家扣 $1000 作為結婚禮金，你將獲得 +3000 人生值';

    // lock 所有 func-btn
    document.querySelectorAll('.func-btn').forEach(b => {
        if (!b.classList.contains('func-active')) b.classList.add('house-dim');
    });

    openFuncPanel(
        label,
        '<div class="func-panel-msg">' + desc + '</div>',
        '<div class="func-panel-actions center">' +
            '<button class="func-action-btn confirm" id="marriage-confirm-btn">✓ 確認</button>' +
            '<button class="func-action-btn cancel" id="marriage-cancel-btn">✕ 取消</button>' +
        '</div>'
    );
    setTimeout(() => {
        document.getElementById('marriage-confirm-btn')?.addEventListener('click', execMarriage);
        document.getElementById('marriage-cancel-btn')?.addEventListener('click', () => { closeFuncPanel(); resetOperation(); });
    }, 0);
}

// =============================================
// HOUSE func-panel
// =============================================
async function initHouse_panel() {
    cleanPreviousMode();
    houseSelection = null;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const h = snap.val()?.house ?? {};

    // dim 所有 func-btn（HOUSE 子選項在 panel 裡）
    document.querySelectorAll('.func-btn').forEach(b => {
        if (!b.classList.contains('func-active')) b.classList.add('house-dim');
    });

    const options = [
        { key: 'small', label: '🏡 小房子', price: HOUSE_PRICES.small },
        { key: 'medium', label: '🏘 中房子', price: HOUSE_PRICES.medium },
        { key: 'luxury', label: '🏰 豪華別墅', price: HOUSE_PRICES.luxury }
    ];

    let optHTML = '<div class="func-panel-msg">選擇房型：</div><div class="func-option-grid">';
    options.forEach(o => {
        const owned = h[o.key];
        const val   = owned ? (h[o.key + 'Value'] ?? o.price) : o.price;
        const sub   = owned ? '現值 ' + formatMoney(val) : formatMoney(o.price);
        const cls   = owned ? 'func-option-btn sell-option' : 'func-option-btn';
        optHTML += '<button class="' + cls + '" data-house="' + o.key + '">' +
            o.label + '<br><small>' + sub + '</small></button>';
    });
    optHTML += '</div><div class="func-panel-msg" id="house-panel-msg"></div>';

    openFuncPanel('🏠 房產買賣', optHTML,
        '<div class="func-panel-actions">' +
            '<button class="func-action-btn confirm" id="house-confirm-btn" disabled>確認</button>' +
            '<button class="func-action-btn cancel" id="house-cancel-btn">取消</button>' +
        '</div>'
    );

    setTimeout(() => {
        document.querySelectorAll('[data-house]').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('[data-house]').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                houseSelection = btn.getAttribute('data-house');
                const owned = h[houseSelection];
                const val   = owned ? (h[houseSelection + 'Value'] ?? HOUSE_PRICES[houseSelection]) : HOUSE_PRICES[houseSelection];
                const msg   = owned
                    ? HOUSE_LABELS[houseSelection] + ' 現值 ' + formatMoney(val) + ' — 按確認賣出'
                    : HOUSE_LABELS[houseSelection] + ' ' + formatMoney(val) + ' — 按確認購買';
                document.getElementById('house-panel-msg').innerText = msg;
                const confBtn = document.getElementById('house-confirm-btn');
                confBtn.disabled = false;
                confBtn.innerText = owned ? '賣出' : '購買';
                confBtn.className = 'func-action-btn ' + (owned ? 'sell' : 'confirm');
            });
        });
        document.getElementById('house-confirm-btn')?.addEventListener('click', async () => {
            if (!houseSelection) return;
            const ownedNow = (await get(ref(db, `rooms/${roomId}/players/${name}`))).val()?.house?.[houseSelection];
            if (ownedNow) await execHouseSell();
            else await execHouseBuy();
            closeFuncPanel(); cleanHouseDim();
        });
        document.getElementById('house-cancel-btn')?.addEventListener('click', () => {
            closeFuncPanel(); resetOperation(); cleanHouseDim();
        });
    }, 0);
}

// =============================================
// CAR func-panel
// =============================================
async function initCar_panel() {
    cleanPreviousMode();
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const car    = snap.val()?.car ?? {};
    carSelection = null; carSellSlot = null; carPending = null;

    document.querySelectorAll('.func-btn').forEach(b => {
        if (!b.classList.contains('func-active')) b.classList.add('house-dim');
    });

    const c1 = car.car1, c2 = car.car2;
    const has1 = c1 && c1.type, has2 = c2 && c2.type;
    let garage = '';
    if (has1) garage += '<div>槽1：' + getCarLabel(c1) + ' 現值 ' + formatMoney(c1.value) + '</div>';
    if (has2) garage += '<div>槽2：' + getCarLabel(c2) + ' 現值 ' + formatMoney(c2.value) + '</div>';
    if (!has1 && !has2) garage = '<div>車庫空置</div>';

    let buyHTML = '<div class="func-option-grid two-col" style="margin-top:10px">' +
        '<button class="func-option-btn" data-cartype="sedan">🚗 轎車<br><small>' + formatMoney(CAR_PRICES.sedan) + '</small></button>' +
        '<button class="func-option-btn" data-cartype="luxury">🚙 豪車<br><small>' + formatMoney(CAR_PRICES.luxury) + '</small></button>' +
        '</div>';
    let sellHTML = (has1 || has2) ?
        '<div class="func-option-grid two-col" style="margin-top:6px">' +
        (has1 ? '<button class="func-option-btn sell-option" data-sellslot="car1">賣槽1<br><small>+' + formatMoney(c1.value) + '</small></button>' : '') +
        (has2 ? '<button class="func-option-btn sell-option" data-sellslot="car2">賣槽2<br><small>+' + formatMoney(c2.value) + '</small></button>' : '') +
        '</div>' : '';

    openFuncPanel('🚗 車輛',
        '<div class="func-panel-msg">' + garage + '</div>' +
        '<div style="font-size:12px;color:#aaa;margin-top:8px">購買：</div>' + buyHTML +
        (sellHTML ? '<div style="font-size:12px;color:#aaa;margin-top:8px">賣出：</div>' + sellHTML : '') +
        '<div class="func-panel-msg" id="car-panel-msg"></div>',
        '<div class="func-panel-actions">' +
            '<button class="func-action-btn confirm" id="car-confirm-btn" disabled>確認</button>' +
            '<button class="func-action-btn cancel" id="car-cancel-btn">取消</button>' +
        '</div>'
    );

    setTimeout(() => {
        document.querySelectorAll('[data-cartype]').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('[data-cartype],[data-sellslot]').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                carSelection = btn.getAttribute('data-cartype');
                carSellSlot = null;
                const price = CAR_PRICES[carSelection];
                const label = carSelection === 'sedan' ? '轎車' : '豪車';
                // 找空槽
                const curSnap = await get(ref(db, `rooms/${roomId}/players/${name}`));
                const curCar  = curSnap.val()?.car ?? {};
                const slot = (!curCar.car1 || !curCar.car1.type) ? 'car1' : (!curCar.car2 || !curCar.car2.type) ? 'car2' : null;
                if (!slot) {
                    document.getElementById('car-panel-msg').innerText = '⚠️ 車庫已滿（最多2台）';
                    document.getElementById('car-confirm-btn').disabled = true; return;
                }
                carPending = { slot, type: carSelection, price };
                document.getElementById('car-panel-msg').innerText = label + ' ' + formatMoney(price) + ' → 放入' + slot;
                const cb = document.getElementById('car-confirm-btn');
                cb.disabled = false; cb.innerText = '購買'; cb.className = 'func-action-btn confirm';
            });
        });
        document.querySelectorAll('[data-sellslot]').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('[data-cartype],[data-sellslot]').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                carSelection = null;
                const slot = btn.getAttribute('data-sellslot');
                const curSnap = await get(ref(db, `rooms/${roomId}/players/${name}`));
                const c = curSnap.val()?.car?.[slot];
                if (!c || !c.type) return;
                carPending = { slot, sell: true, price: c.value };
                carSellSlot = slot;
                document.getElementById('car-panel-msg').innerText = '賣出 ' + getCarLabel(c) + ' +' + formatMoney(c.value);
                const cb = document.getElementById('car-confirm-btn');
                cb.disabled = false; cb.innerText = '賣出'; cb.className = 'func-action-btn sell';
            });
        });
        document.getElementById('car-confirm-btn')?.addEventListener('click', async () => {
            if (!carPending) return;
            await commitCar();
            closeFuncPanel(); cleanCarDim();
        });
        document.getElementById('car-cancel-btn')?.addEventListener('click', () => {
            closeFuncPanel(); resetOperation(); cleanCarDim();
        });
    }, 0);
}

// =============================================
// BABY func-panel
// =============================================
async function initBaby_panel() {
    cleanPreviousMode();
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const babies = snap.val()?.baby ?? 0;
    babyPending = 0;

    document.querySelectorAll('.func-btn').forEach(b => {
        if (!b.classList.contains('func-active')) b.classList.add('house-dim');
    });

    openFuncPanel('👶 子女',
        '<div class="func-panel-msg">目前 ' + babies + ' 個子女（最多9）</div>' +
        '<div style="font-size:12px;color:#aaa;margin:8px 0 4px">每增加一個，其他玩家各扣 $500 作為賀禮</div>' +
        '<div style="display:flex;gap:12px;align-items:center;margin-top:8px">' +
            '<button class="func-action-btn confirm" id="baby-minus" style="font-size:20px;padding:6px 14px">−</button>' +
            '<span id="baby-count-display" style="font-size:22px;font-weight:bold;color:var(--primary);min-width:20px;text-align:center">0</span>' +
            '<button class="func-action-btn confirm" id="baby-plus" style="font-size:20px;padding:6px 14px">＋</button>' +
        '</div>' +
        '<div class="func-panel-msg" id="baby-panel-msg" style="margin-top:8px"></div>',
        '<div class="func-panel-actions">' +
            '<button class="func-action-btn confirm" id="baby-confirm-btn">確認</button>' +
            '<button class="func-action-btn cancel" id="baby-cancel-btn">取消</button>' +
        '</div>'
    );

    setTimeout(() => {
        document.getElementById('baby-plus')?.addEventListener('click', () => {
            if (babyPending >= 2) { document.getElementById('baby-panel-msg').innerText = '⚠️ 每次至多 +2'; return; }
            if (babies + babyPending + 1 > 9) { document.getElementById('baby-panel-msg').innerText = '⚠️ 已達上限 9 個'; return; }
            babyPending++;
            document.getElementById('baby-count-display').innerText = babyPending;
            const newTotal = babies + babyPending;
            document.getElementById('baby-panel-msg').innerText =
                '增加 ' + babyPending + ' 個（共' + newTotal + '），每位玩家 -$' + (500 * babyPending);
        });
        document.getElementById('baby-minus')?.addEventListener('click', () => {
            if (babyPending <= 0) return;
            babyPending--;
            document.getElementById('baby-count-display').innerText = babyPending;
            document.getElementById('baby-panel-msg').innerText = babyPending > 0
                ? '增加 ' + babyPending + ' 個（共' + (babies+babyPending) + '）' : '';
        });
        document.getElementById('baby-confirm-btn')?.addEventListener('click', async () => {
            await commitBaby();
            closeFuncPanel();
            document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
        });
        document.getElementById('baby-cancel-btn')?.addEventListener('click', () => {
            closeFuncPanel(); resetOperation();
            document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
        });
    }, 0);
}

// =============================================
// DEGREE func-panel
// =============================================
async function initDegree_panel() {
    cleanPreviousMode();
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const snap   = await get(ref(db, `rooms/${roomId}/players/${name}`));
    const deg    = snap.val()?.degree ?? {};
    degreeSelection = null;

    document.querySelectorAll('.func-btn').forEach(b => {
        if (!b.classList.contains('func-active')) b.classList.add('house-dim');
    });

    const bStatus = deg.bachelor ? '✅ 已有' : '尚無';
    const pStatus = deg.phd      ? '✅ 已有' : '尚無';

    openFuncPanel('🎓 學歷',
        '<div class="func-option-grid two-col">' +
            '<button class="func-option-btn ' + (deg.bachelor ? 'selected' : '') + '" data-deg="bachelor">學士學位<br><small>' + bStatus + '</small></button>' +
            '<button class="func-option-btn ' + (deg.phd ? 'selected' : '') + '" data-deg="phd">博士學位<br><small>' + pStatus + '</small></button>' +
        '</div>' +
        '<div class="func-panel-msg" id="deg-panel-msg" style="margin-top:8px">選擇要取得的學位</div>',
        '<div class="func-panel-actions">' +
            '<button class="func-action-btn confirm" id="deg-confirm-btn" disabled>確認取得</button>' +
            '<button class="func-action-btn cancel" id="deg-cancel-btn">取消</button>' +
        '</div>'
    );

    setTimeout(() => {
        document.querySelectorAll('[data-deg]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-deg]').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                degreeSelection = btn.getAttribute('data-deg');
                const already = deg[degreeSelection];
                const lbl = degreeSelection === 'bachelor' ? '學士' : '博士';
                document.getElementById('deg-panel-msg').innerText = already ? '✅ 已有' + lbl + '學位' : '取得' + lbl + '學位（免費）';
                document.getElementById('deg-confirm-btn').disabled = already;
            });
        });
        document.getElementById('deg-confirm-btn')?.addEventListener('click', async () => {
            await execDegree();
            closeFuncPanel();
            document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
        });
        document.getElementById('deg-cancel-btn')?.addEventListener('click', () => {
            closeFuncPanel(); resetOperation();
            document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
        });
    }, 0);
}

// =============================================
// CHANCE func-panel
// =============================================
function initChance_panel() {
    cleanPreviousMode();
    chancePhase = 'INPUT'; chanceInvestAmount = 0;
    document.querySelectorAll('.func-btn').forEach(b => {
        if (!b.classList.contains('func-active')) b.classList.add('house-dim');
    });

    openFuncPanel('🎲 CHANCE',
        '<div class="func-panel-msg">輸入金額（0 亦可）</div>' +
        '<div class="func-panel-msg warn" id="chance-panel-msg"></div>',
        '<div class="func-panel-actions">' +
            '<button class="func-action-btn confirm" id="chance-confirm-btn">確認金額</button>' +
            '<button class="func-action-btn cancel" id="chance-cancel-btn">取消</button>' +
        '</div>',
        true,
        (val) => {
            if (val > 100000) {
                document.getElementById('chance-panel-msg').innerText = '⚠️ 上限 $100,000，請重新輸入';
                document.getElementById('chance-confirm-btn').disabled = true;
                chanceInvestAmount = 0;
                return;
            }
            chanceInvestAmount = val;
            document.getElementById('chance-panel-msg').innerText = '金額：' + formatMoney(val);
            document.getElementById('chance-confirm-btn').disabled = false;
        }
    );

    setTimeout(() => {
        document.getElementById('chance-confirm-btn')?.addEventListener('click', () => {
            if (chanceInvestAmount > 100000) {
                document.getElementById('chance-panel-msg').innerText = '⚠️ 上限 $100,000';
                return;
            }
            chancePhase = 'SPIN';
            // 切換面板內容：顯示三個結果按鈕 + START
            document.getElementById('func-panel-title').innerText = '🎲 CHANCE 抽獎';
            document.getElementById('func-panel-body').innerHTML =
                '<div class="func-panel-msg">按 START 開始抽獎</div>' +
                '<div style="display:flex;gap:8px;justify-content:center;margin-top:10px">' +
                    '<div style="width:56px;height:56px;border-radius:50%;border:2px solid #555;display:flex;align-items:center;justify-content:center;font-size:13px;color:#888" id="chance-r0">0<br><small>失敗</small></div>' +
                    '<div style="width:56px;height:56px;border-radius:50%;border:2px solid #555;display:flex;align-items:center;justify-content:center;font-size:13px;color:#888" id="chance-r1">1<br><small>成功</small></div>' +
                    '<div style="width:56px;height:56px;border-radius:50%;border:2px solid #555;display:flex;align-items:center;justify-content:center;font-size:13px;color:#888" id="chance-r2">2<br><small>成功</small></div>' +
                '</div>';
            document.getElementById('func-digit-pad').style.display = 'none';
            document.getElementById('func-panel-actions').innerHTML =
                '<button class="func-action-btn confirm" id="chance-start-btn">▶ START</button>';
            setTimeout(() => {
                document.getElementById('chance-start-btn')?.addEventListener('click', () => execChanceSpin_panel());
            }, 0);
        });
        document.getElementById('chance-cancel-btn')?.addEventListener('click', () => {
            closeFuncPanel(); resetOperation();
            document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
        });
    }, 0);
}

async function execChanceSpin_panel() {
    const startBtn = document.getElementById('chance-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.innerText = '抽獎中...'; }

    const resultIdx = Math.floor(Math.random() * 3); // 0, 1, 2（等機率）
    const ids = ['chance-r0', 'chance-r1', 'chance-r2'];

    // 往右跑：永遠從 0→1→2→0→1→2...，慢下來停在 resultIdx
    // 至少跑完 2 圈後停在目標，不往左跳
    const fullRounds = 2;
    const totalSteps = fullRounds * 3 + resultIdx + 1; // 停在 resultIdx
    let cur = 0;
    let delay = 80;

    for (let i = 0; i < totalSteps; i++) {
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.borderColor = '#555'; });
        const el = document.getElementById(ids[cur % 3]);
        if (el) el.style.borderColor = 'var(--accent)';
        // 最後 5 步開始減速
        if (i >= totalSteps - 5) delay += 120;
        else if (i >= totalSteps - 8) delay += 40;
        await new Promise(r => setTimeout(r, delay));
        cur++;
    }
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.borderColor = '#555'; });
    const winEl = document.getElementById(ids[resultIdx]);
    if (winEl) winEl.style.cssText += 'border-color:var(--primary);box-shadow:0 0 12px var(--primary);color:var(--primary);';

    const success = resultIdx > 0;
    const roomId = myRoom(); const name = myName();
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const freshSnap = await get(playerRef);
    const curBal = freshSnap.val()?.balance ?? 0;

    if (success) {
        await update(playerRef, { balance: curBal + chanceInvestAmount });
        addLog(roomId, name, 'CHANCE 成功！+' + formatMoney(chanceInvestAmount));
        document.getElementById('func-panel-body').querySelector('.func-panel-msg').innerText = '✅ 成功！+' + formatMoney(chanceInvestAmount);
    } else {
        await update(playerRef, { balance: curBal - chanceInvestAmount });
        addLog(roomId, name, 'CHANCE 失敗！-' + formatMoney(chanceInvestAmount));
        document.getElementById('func-panel-body').querySelector('.func-panel-msg').innerText = '❌ 失敗！-' + formatMoney(chanceInvestAmount);
    }
    // 換成關閉按鈕
    document.getElementById('func-panel-actions').innerHTML =
        '<button class="func-action-btn confirm" id="chance-done-btn">確認</button>';
        setTimeout(() => {
            document.getElementById('chance-done-btn')?.addEventListener('click', () => {
                closeFuncPanel();
                resetOperation();
                document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
            });
        }, 0);
    chancePhase = 'DONE';
}

// =============================================
// LOTTERY
// ==============================================
async function initLottery() {
    cleanPreviousMode();
    _lotteryResultHandled = false;
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const name   = localStorage.getItem('lifeGame_myName');
    const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
    const players = Object.values(playersSnap.val() ?? {}).filter(p => p.isVisible);
    lotteryM = Math.ceil((players.length + 2) / 0.6);
    lotteryMultiplier = 1;
    lotteryPicks = [];

    const statusSnap = await get(ref(db, `rooms/${roomId}/status`));
    const round = statusSnap.val()?.round ?? 1;
    let pot = 50000;
    for (let i = 0; i < round; i++) pot *= (1.0 + Math.random() * 0.1);
    pot = Math.round(pot);

    await update(ref(db, `rooms/${roomId}/lottery`), {
        active: true, pot, M: lotteryM,
        initiator: name, picks: {}, winnerNumbers: null, phase: 'SELECT'
    });

    // 面板由 listenGameStatus 中的 lottery 監聽統一處理（對所有玩家）
}

function showLotteryPanel(roomId, name, pot, M) {
    const panel = document.getElementById('lottery-panel');
    panel.style.display = 'block';
    document.getElementById('lottery-pot').innerText = '🎰 獎金 ' + formatMoney(Math.round(pot * lotteryMultiplier));

    get(ref(db, `rooms/${roomId}/lottery`)).then(snap => {
        const lottery = snap.val() ?? {};
        const isInitiator = lottery.initiator === name;
        const maxPicks = isInitiator ? 3 : 1;
        const myPicks = lottery.picks?.[name] ?? [];
        const allPicked = Object.values(lottery.picks ?? {}).flat();

        document.getElementById('lottery-info').innerText =
            isInitiator ? '請選擇 3 個號碼（1~' + (lottery.M ?? M) + '）' : '請選擇 1 個號碼（1~' + (lottery.M ?? M) + '）';

        const container = document.getElementById('lottery-numbers');
        container.innerHTML = '';
        const total = lottery.M ?? M;
        for (let i = 1; i <= total; i++) {
            const btn = document.createElement('button');
            btn.className = 'lottery-num-btn';
            btn.innerText = i;
            btn.dataset.num = i;
            if (myPicks.includes(i)) btn.classList.add('selected-num');
            if (allPicked.includes(i) && !myPicks.includes(i)) { btn.disabled = true; btn.classList.add('num-taken'); }
            btn.addEventListener('click', () => pickLotteryNumber(i, maxPicks, roomId, name, total, pot));
            container.appendChild(btn);
        }
    });
}

async function pickLotteryNumber(num, maxPicks, roomId, name, M, pot) {
    if (lotteryPicks.includes(num)) return;
    if (lotteryPicks.length >= maxPicks) {
        document.getElementById('lottery-info').innerText = '已選滿 ' + maxPicks + ' 個！'; return;
    }
    lotteryPicks.push(num);
    const btn = document.querySelector('.lottery-num-btn[data-num="' + num + '"]');
    if (btn) btn.classList.add('selected-num');
    document.getElementById('lottery-info').innerText = '已選 ' + lotteryPicks.join(', ') + ' (' + lotteryPicks.length + '/' + maxPicks + ')';

    if (lotteryPicks.length >= maxPicks) {
        const upd = {};
        upd[name] = lotteryPicks;
        await update(ref(db, `rooms/${roomId}/lottery/picks`), upd);
        document.getElementById('lottery-info').innerText += ' ✓ 等待其他玩家...';
    }
}

function listenLottery(roomId, name) {
    onValue(ref(db, `rooms/${roomId}/lottery`), async (snap) => {
        const lottery = snap.val();
        if (!lottery?.active) return;

        if (lottery.initiator === name && lottery.phase === 'SELECT') {
            const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
            const players = Object.values(playersSnap.val() ?? {}).filter(p => p.isVisible);
            const allDone = players.every(p => {
                const needed = p.name === name ? 3 : 1;
                return (lottery.picks?.[p.name]?.length ?? 0) >= needed;
            });
            if (allDone) {
                await update(ref(db, `rooms/${roomId}/lottery`), { phase: 'SPIN' });
                document.getElementById('lottery-info').innerText = '所有人已選號！按 SPIN 開獎';
                const spinBtn = document.getElementById('spinBtn');
                spinBtn.classList.remove('spin-locked', 'spin-done');
                spinBtn.disabled = false;
            }
        }

        if (lottery.phase === 'DONE' && lottery.winnerNumbers != null) {
            displayLotteryResult(lottery, name, roomId);
        }

        // 更新選號面板
        if (lottery.phase === 'SELECT') {
            showLotteryPanel(roomId, name, lottery.pot, lottery.M);
        }
    });
}

async function execLotterySpin() {
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    const snap   = await get(ref(db, `rooms/${roomId}/lottery`));
    const lottery = snap.val();
    if (!lottery) return;

    // 重置所有號碼狀態：selected-num 保持橘色，其他恢復白色 active
    document.querySelectorAll('.lottery-num-btn').forEach(b => {
        b.classList.remove('lottery-winner', 'lottery-highlight', 'num-taken');
        b.disabled = false;
        // 非自己選的號碼恢復白色
        if (!b.classList.contains('selected-num')) {
            b.style.borderColor = '';
            b.style.color = '';
            b.style.background = '';
        }
    });
    document.getElementById('lottery-confirm-btn')?.remove();
    document.getElementById('lottery-start-btn') && (document.getElementById('lottery-start-btn').innerText = '開獎中...');

    const winNum = Math.floor(Math.random() * lottery.M) + 1;

    // 先寫入 Firebase（ANIMATING phase）讓非發起者也開始跑動畫
    await update(ref(db, `rooms/${roomId}/lottery`), { winnerNumbers: winNum, phase: 'ANIMATING' });

    const numBtns = Array.from(document.querySelectorAll('.lottery-num-btn'));
    const targetIdx = numBtns.findIndex(b => parseInt(b.dataset.num) === winNum);
    const rounds = 2;
    const totalSteps = numBtns.length * rounds + targetIdx + 1;
    let delay = 40;

    for (let i = 0; i < totalSteps; i++) {
        const curIdx = i % numBtns.length;
        numBtns.forEach(b => b.classList.remove('lottery-highlight'));
        numBtns[curIdx].classList.add('lottery-highlight');
        if (i > totalSteps - 15) delay += 50;
        else if (i > totalSteps - 30) delay += 15;
        await new Promise(r => setTimeout(r, delay));
    }

    numBtns.forEach(b => b.classList.remove('lottery-highlight'));
    if (numBtns[targetIdx]) numBtns[targetIdx].classList.add('lottery-winner');

    // 動畫完成，寫入 DONE
    await update(ref(db, `rooms/${roomId}/lottery`), { phase: 'DONE' });
}

let _lotteryResultHandled = false;
let _lotteryResultWinNum = null; // 記錄上次處理的號碼，防重複

async function displayLotteryResult(lottery, myName, roomId) {
    // 防重複：同一個 winnerNumbers 只處理一次
    if (_lotteryResultHandled && _lotteryResultWinNum === lottery.winnerNumbers) return;
    _lotteryResultHandled = true;
    _lotteryResultWinNum = lottery.winnerNumbers;

    const picks  = lottery.picks ?? {};
    const winNum = lottery.winnerNumbers;
    const pot    = Math.round(lottery.pot);
    const winner = Object.entries(picks).find(([, nums]) => Array.isArray(nums) && nums.includes(winNum));

    // 顯示開獎號碼在 selected-num 保持，winner 亮紅燈
    const winBtn = document.querySelector('.lottery-num-btn[data-num="' + winNum + '"]');
    if (winBtn) { winBtn.classList.remove('lottery-highlight'); winBtn.classList.add('lottery-winner'); }

    // 移除 START 按鈕（下一輪會重建）
    document.getElementById('lottery-start-btn')?.remove();

    if (winner) {
        const winnerName = winner[0];
        const wRef = ref(db, `rooms/${roomId}/players/${winnerName}`);
        const wSnap = await get(wRef);
        await update(wRef, { balance: (wSnap.val()?.balance ?? 0) + pot });
        // 只有發起者寫 LOG，避免所有玩家都寫
        if (myName === lottery.initiator) {
            addLog(roomId, myName, '🎰 大樂透開獎！號碼：' + winNum + '　中獎：' + winnerName + ' +' + formatMoney(pot));
        }
        document.getElementById('lottery-info').innerText =
            winnerName === myName ? '🎉 恭喜你中獎！+' + formatMoney(pot) : '🎉 恭喜 ' + winnerName + ' 中獎！+' + formatMoney(pot);

        // 發起者顯示確認鍵（只加一次）
        if (myName === lottery.initiator && !document.getElementById('lottery-confirm-btn')) {
            const confirmBtn = document.createElement('button');
            confirmBtn.id = 'lottery-confirm-btn';
            confirmBtn.innerText = '✓ 確認結束 LOTTERY';
            confirmBtn.style.cssText = 'display:block;margin:10px auto;padding:8px 20px;background:var(--pass);color:#000;border:none;border-radius:8px;font-size:14px;cursor:pointer;';
            confirmBtn.addEventListener('click', async () => {
                confirmBtn.remove(); // 立即移除按鈕
                _lotteryResultHandled = false;
                _lotteryResultWinNum = null;
                await update(ref(db, `rooms/${roomId}/lottery`), { active: false });
            });
            document.getElementById('lottery-numbers').after(confirmBtn);
        }
    } else {
        const bonus = 1.2 + Math.random() * 0.4;
        lotteryMultiplier *= bonus;
        const newPot = Math.round(pot * bonus);
        // 只有發起者寫 LOG
        if (myName === lottery.initiator) {
            addLog(roomId, myName, '🎰 大樂透開獎！號碼：' + winNum + '　無人中獎，獎金加碼 → ' + formatMoney(newPot));
        }
        // 不重置 picks，保留每人選的號碼；僅重置 phase 讓 START 按鈕重新出現
        _lotteryResultHandled = false;
        // 移除已選號碼的鎖定（讓畫面保持可見但 START 觸發下一輪）
        await update(ref(db, `rooms/${roomId}/lottery`), { pot: newPot, phase: 'SPIN', winnerNumbers: null });
        document.getElementById('lottery-pot').innerText = '🎰 獎金 ' + formatMoney(newPot);
        // 無人中獎後回到 SPIN phase，START 按鈕會由監聽重建，更新說明文字
        // 注意：phase 已設為 'SPIN'，listenGameStatus_NEW 會更新 lottery-info
        document.getElementById('lottery-info').innerText = '😱 無人中獎！獎金加碼 → ' + formatMoney(newPot);
    }
}

// =============================================
// + / - 按鈕
// =============================================
// +/- 按鈕：已移至 func-panel，這裡保留空的 listener 避免 undefined
document.getElementById('plusBtn').addEventListener('click', async () => {});
document.getElementById('minusBtn').addEventListener('click', async () => {});

// =============================================
// ENTER
// =============================================
// ENTER 按鈕：功能已移至 func-panel；只保留 CHANCE DONE 結束
document.getElementById('enterBtn').addEventListener('click', async () => {
    if (activeFuncMode === 'CHANCE' && chancePhase === 'DONE') { resetOperation(); }
});

// =============================================
// UNDO
// =============================================
document.getElementById('resetBtn').addEventListener('click', async () => {
    // 若 LOTTERY 進行中，UNDO = 關閉（只有發起者）
    if (activeFuncMode === 'LOTTERY' || document.getElementById('lottery-panel')?.style.display !== 'none') {
        const roomId = myRoom();
        const snap = await get(ref(db, `rooms/${roomId}/lottery`));
        const lottery = snap.val();
        if (lottery?.active && lottery.initiator === myName()) {
            if (confirm('確定關閉大樂透？')) {
                await update(ref(db, `rooms/${roomId}/lottery`), { active: false });
                addLog(roomId, myName(), 'LOTTERY 手動關閉');
            }
        }
        return;
    }
    resetOperation();
});

function resetOperation() {
    currentModifyTarget = null; tempModifyValue = 0; _pendingAdjustVal = 0;
    inputMode = false; inputBuffer = ""; inputDirection = null;
    activeFuncMode = null; houseSelection = null; carSelection = null; degreeSelection = null;
    babyPending = 0; carPending = null; carSellSlot = null;
    chancePhase = 'INPUT'; chanceInvestAmount = 0;
    lotteryPicks = [];
    clearFuncActive(); resetAdjustUI(); cleanHouseDim();
    closeFuncPanel();  // 關閉通用面板
    setSpinLocked(false); setEndTurnLocked(false);
    // lottery-panel 不在 resetOperation 中隱藏（避免中斷 LOTTERY）
    document.getElementById('turn-indicator').innerText = '等待操作...';
}

function resetAdjustUI() {
    document.querySelectorAll('.stat-box').forEach(el => el.classList.remove('active-status'));
    document.getElementById('minusBtn').classList.remove('active', 'selected');
    document.getElementById('plusBtn').classList.remove('active', 'selected');
    document.body.classList.remove('digit-input');
    showSideButtons(false);
}

function clearFuncActive() {
    document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('func-active'));
}

// =============================================
// SPIN 統一入口
// =============================================
document.getElementById('spinBtn').addEventListener('click', async () => {
    // 硬性檢查：disabled 或 spin-locked 時完全不執行
    const _sb = document.getElementById('spinBtn');
    if (_sb.disabled || _sb.classList.contains('spin-locked') || _sb.classList.contains('spin-done')) return;
    if (isSpinning) return;
    _audio.playSpin();

    if (activeFuncMode === 'CHANCE' && chancePhase === 'SPIN') {
        isSpinning = true;
        document.getElementById('spinBtn').classList.add('spin-spinning');
        await execChanceSpin();
        isSpinning = false;
        document.getElementById('spinBtn').classList.remove('spin-spinning');
        document.getElementById('spinBtn').classList.add('spin-done');
        document.getElementById('spinBtn').disabled = true;
        return;
    }

    if (activeFuncMode === 'LOTTERY') {
        isSpinning = true;
        document.getElementById('spinBtn').classList.add('spin-spinning');
        await execLotterySpin();
        isSpinning = false;
        document.getElementById('spinBtn').classList.remove('spin-spinning');
        document.getElementById('spinBtn').classList.add('spin-done');
        document.getElementById('spinBtn').disabled = true;
        return;
    }

    // 先結算本回合（SETTLEMENT phase 改走 runSettlement）
    const statusSnap_sp = await get(ref(db, `rooms/${myRoom()}/status`));
    const phase_sp = statusSnap_sp.val()?.phase ?? 'PLAYING';

    if (phase_sp === 'SETTLEMENT') {
        await runSettlement();
        return;
    }

    if (phase_sp === 'WAITING') {
        document.getElementById('turn-indicator').innerText = '⚠️ 請先設定 YEARS 回合數！';
        return;
    }

    isSpinning = true;
    setFuncBtnsLocked(true);
    const spinBtn = document.getElementById('spinBtn');
    spinBtn.classList.add('spin-spinning');
    const roomId_s = myRoom();
    const name_s   = myName();

    // SPIN 開始：鎖住結束回合，避免誤觸
    setEndTurnLocked(true);

    // 在跑動畫前先做回合財產結算
    await onSpinPressed_turnCalc();

    const carSnap = await get(ref(db, `rooms/${roomId_s}/players/${name_s}/car`));
    const carData = carSnap.val();
    const skips = getSpinSkips(carData);
    // 生成 1~10 的隨機數，跳過指定步數
    let pool = [1,2,3,4,5,6,7,8,9,10].filter(n => !skips.includes(n));
    const result = pool[Math.floor(Math.random() * pool.length)];
    await runAdvancedSpin(result, skips); // 傳入 skipVals，SPIN 動畫跳過這些
    isSpinning = false;
    setFuncBtnsLocked(false);
    spinBtn.classList.remove('spin-spinning');
    spinBtn.classList.add('spin-done');
    spinBtn.disabled = true;
    addLog(roomId_s, name_s, 'SPIN → ' + result);
    // SPIN 完成後解鎖結束回合
    setEndTurnLocked(false);
});

async function runAdvancedSpin(targetValue, skipVals = []) {
    const allBtns = Array.from(document.querySelectorAll('.func-btn'));

    // 標記跳過的按鈕（暗掉）
    allBtns.forEach(b => {
        b.classList.remove('spin-skip', 'highlight', 'light-on');
        if (skipVals.includes(parseInt(b.dataset.val))) {
            b.classList.add('spin-skip');
        }
    });

    // 只用「有效按鈕」（非 skip）跑動畫
    const activeBtns = allBtns.filter(b => !b.classList.contains('spin-skip'));
    const targetBtn  = allBtns.find(b => b.dataset.val == targetValue);
    const targetActiveIdx = activeBtns.indexOf(targetBtn);

    if (targetActiveIdx === -1) {
        // 目標被 skip 了（不應該發生），直接亮起
        allBtns.forEach(b => b.classList.remove('spin-skip'));
        if (targetBtn) targetBtn.classList.add('light-on');
        return;
    }

    // totalSteps：至少跑 1.5 圈有效格子，再停在目標
    const rounds = 2;
    const totalSteps = activeBtns.length * rounds + targetActiveIdx + 1;
    let delay = 120;

    for (let i = 0; i < totalSteps; i++) {
        const curActive = i % activeBtns.length;
        activeBtns.forEach(b => b.classList.remove('highlight'));
        activeBtns[curActive].classList.add('highlight');

        if (i < 5)                        delay = 120;
        else if (i < 10)                  delay = 80;
        else if (i > totalSteps - 8)      delay += 55;
        else if (i > totalSteps - 15)     delay += 20;
        else                              delay = 60;

        await new Promise(r => setTimeout(r, delay));
    }

    // 結束：清所有狀態，只亮目標
    allBtns.forEach(b => b.classList.remove('highlight', 'light-on', 'spin-skip'));
    targetBtn.classList.add('light-on');
}

// =============================================
// 結束回合
// =============================================
document.getElementById('endTurnBtn').addEventListener('click', async () => {
    const statusSnap_et = await get(ref(db, `rooms/${myRoom()}/status`));
    const phase_et = statusSnap_et.val()?.phase ?? 'PLAYING';

    if (phase_et === 'SETTLEMENT') {
        // 結算階段：推進到下一位
        await advanceSettlement();
        return;
    }

    resetOperation();
    document.querySelectorAll('.func-btn').forEach(btn => btn.classList.remove('light-on', 'highlight', 'func-active'));
    const spinBtn = document.getElementById('spinBtn');
    spinBtn.classList.remove('spin-done', 'spin-locked', 'spin-spinning');
    spinBtn.disabled = false;

    // 立即鎖住結束回合（下一位拿到控制權後會自動解鎖）
    setEndTurnLocked(true);
    await endTurn_NEW();
    // turn-indicator 由 listenGameStatus_NEW 自動更新，不需要手動設
});

// =============================================
// UI 工具
// =============================================
function showSideButtons(show) {
    document.getElementById('resetBtn').classList.toggle('hidden', !show);
    document.getElementById('enterBtn').classList.toggle('hidden', !show);
}
function setEndTurnLocked(locked) {
    const btn = document.getElementById('endTurnBtn');
    btn.disabled = locked;
    btn.classList.toggle('btn-locked', locked);
}
function setSpinLocked(locked) {
    const spinBtn = document.getElementById('spinBtn');
    if (locked) { spinBtn.classList.add('spin-locked'); spinBtn.disabled = true; }
    else {
        if (!document.querySelector('.func-btn.func-active') && !currentModifyTarget) {
            spinBtn.classList.remove('spin-locked'); spinBtn.disabled = false;
        }
    }
}
function setFuncBtnsLocked(locked) {
    document.querySelectorAll('.func-btn').forEach(btn => btn.classList.toggle('locked', locked));
}

// =============================================
// 監聽回合狀態（舊版，已由 listenGameStatus_NEW 取代）
// =============================================
function listenGameStatus() { listenGameStatus_NEW(); }
function _OLD_listenGameStatus_unused() {
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    onValue(ref(db, `rooms/${roomId}/status`), (snapshot) => {
        const status = snapshot.val();
        if (!status) return;
        const myName = localStorage.getItem('lifeGame_myName');
        const isMyTurn = status.currentTurn === myName;
        document.body.classList.toggle('active-turn', isMyTurn);
        document.getElementById('turn-indicator').innerText = isMyTurn
            ? '★ 您的回合'
            : status.currentTurn ? '等待 ' + status.currentTurn + ' 的回合...' : '等待下一回合...';
    });

    // 監聽 lottery：所有玩家都能看到大樂透面板
    onValue(ref(db, `rooms/${roomId}/lottery`), async (snap) => {
        const lottery = snap.val();
        const myName = localStorage.getItem('lifeGame_myName');
        if (!lottery?.active) {
            // LOTTERY 已結束：隱藏面板，解除 func-btn lock
            document.getElementById('lottery-panel').style.display = 'none';
            document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('house-dim'));
            // 若本人是 activeFuncMode=LOTTERY，清除（只清 lottery 相關，不影響其他功能）
            if (activeFuncMode === 'LOTTERY') {
                activeFuncMode = null;
                clearFuncActive();
                document.getElementById('turn-indicator').innerText = '等待操作...';
            }
            return;
        }
        // 顯示面板（對所有玩家）
        document.getElementById('lottery-panel').style.display = 'block';
        document.getElementById('lottery-pot').innerText = '🎰 獎金 ' + formatMoney(Math.round(lottery.pot));

        // 加入面板 X 關閉按鈕（只有發起者可關閉）
        if (!document.getElementById('lottery-close-btn')) {
            const closeBtn = document.createElement('button');
            closeBtn.id = 'lottery-close-btn';
            closeBtn.innerText = '✕';
            closeBtn.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;color:#888;font-size:16px;cursor:pointer;z-index:10;';
            closeBtn.addEventListener('click', () => {
                if (lottery.initiator === myName()) {
                    if (confirm('確定關閉大樂透？')) {
                        update(ref(db, `rooms/${myRoom()}/lottery`), { active: false });
                        addLog(myRoom(), myName(), 'LOTTERY 手動關閉');
                    }
                } else {
                    alert('只有發起者可關閉大樂透');
                }
            });
            const lp = document.getElementById('lottery-panel');
            lp.style.position = 'relative';
            lp.appendChild(closeBtn);
        }

        // LOTTERY 期間：lock 所有 func-btn，只留 LOG（9號）
        document.querySelectorAll('.func-btn').forEach(b => {
            if (b.getAttribute('data-val') === '9') {
                b.classList.remove('house-dim'); // LOG 永遠可用
            } else {
                b.classList.add('house-dim');
            }
        });

        const isInitiator = lottery.initiator === myName;
        const maxPicks = isInitiator ? 3 : 1;
        const myPicks = Object.values(lottery.picks?.[myName] ?? {});
        const allPicked = Object.values(lottery.picks ?? {}).flatMap(v => Array.isArray(v) ? v : Object.values(v));

        if (lottery.phase === 'SELECT') {
            document.getElementById('lottery-info').innerText =
                isInitiator ? '請選擇 3 個號碼（1~' + lottery.M + '）' : '請選擇 1 個號碼（1~' + lottery.M + '）';

            const container = document.getElementById('lottery-numbers');
            container.innerHTML = '';
            for (let i = 1; i <= lottery.M; i++) {
                const btn = document.createElement('button');
                btn.className = 'lottery-num-btn';
                btn.innerText = i;
                btn.dataset.num = i;
                if (myPicks.includes(i)) btn.classList.add('selected-num');
                if (allPicked.includes(i) && !myPicks.includes(i)) { btn.disabled = true; btn.classList.add('num-taken'); }
                btn.addEventListener('click', () => {
                    // 已選完，不能再選
                    if (myPicks.length >= maxPicks) {
                        document.getElementById('lottery-info').innerText = '✓ 已選完，等待其他玩家...'; return;
                    }
                    if (myPicks.includes(i)) return;
                    myPicks.push(i);
                    btn.classList.add('selected-num');
                    document.getElementById('lottery-info').innerText = '已選 ' + myPicks.join(', ') + ' (' + myPicks.length + '/' + maxPicks + ')';
                    if (myPicks.length >= maxPicks) {
                        const upd = {}; upd[myName] = myPicks;
                        update(ref(db, `rooms/${roomId}/lottery/picks`), upd).then(() => {
                            document.getElementById('lottery-info').innerText = '✓ 已選 ' + myPicks.join(', ') + '，等待其他玩家...';
                            // 選完後 lock 所有號碼按鈕（不能重選）
                            document.querySelectorAll('.lottery-num-btn').forEach(b => {
                                if (!b.classList.contains('selected-num')) { b.disabled = true; b.classList.add('num-taken'); }
                            });
                        });
                    }
                });
                container.appendChild(btn);
            }

            // 發起者：檢查是否所有人都選完了
            if (isInitiator) {
                get(ref(db, `rooms/${roomId}/players`)).then(ps => {
                    const players = Object.values(ps.val() ?? {}).filter(p => p.isVisible);
                    const allDone = players.every(p => {
                        const needed = p.name === myName ? 3 : 1;
                        const picked = lottery.picks?.[p.name];
                        const cnt = Array.isArray(picked) ? picked.length : Object.keys(picked ?? {}).length;
                        return cnt >= needed;
                    });
                    if (allDone && lottery.phase === 'SELECT') {
                        update(ref(db, `rooms/${roomId}/lottery`), { phase: 'SPIN' });
                    }
                });
            }
        }

        if (lottery.phase === 'SPIN' && isInitiator) {
            document.getElementById('lottery-info').innerText = '所有人已選號！按 SPIN 開獎';
            const spinBtn = document.getElementById('spinBtn');
            spinBtn.classList.remove('spin-locked', 'spin-done');
            spinBtn.disabled = false;
            // 確保 LOTTERY 模式
            if (activeFuncMode !== 'LOTTERY') activeFuncMode = 'LOTTERY';
        }

        if (lottery.phase === 'DONE' && lottery.winnerNumbers != null) {
            displayLotteryResult(lottery, myName, roomId);
        }
    });
}

// =============================================
// 監聽所有玩家
// =============================================
function refreshPlayerList() {
    // 強制重繪玩家列表（不重新監聽，只更新 ← 標記）
    document.querySelectorAll('.player-item').forEach(item => {
        const nameEl = item.querySelector('strong');
        if (!nameEl) return;
        const pName = nameEl.innerText;
        const isCurrent = (window._currentTurn === pName);
        const isMe = item.classList.contains('player-me');
        const prefix = isMe ? '⭐ ' : '👤 ';
        const span = nameEl.closest('span');
        if (span) span.innerHTML = prefix + '<strong>' + pName + '</strong>' + (isCurrent ? ' ←' : '');
    });
}

function listenAllPlayers(roomId) { listenAllPlayers_NEW(roomId); }
function listenAllPlayers_NEW(roomId) {
    // 同時監聽 players 和 status，確保 ← 永遠正確
    function renderPlayers(players, currentCtrl) {
        const listDiv = document.getElementById('other-players-list');
        if (!listDiv) return;
        listDiv.innerHTML = "";
        if (!players) return;
        const me = myName();
        Object.values(players).forEach(p => {
            if (p.isVisible !== true) return;
            const isMe = p.name === me;
            const isCurrent = (currentCtrl === p.name);
            const item = document.createElement('div');
            item.className = 'player-item' + (isMe ? ' player-me' : '');
            item.style.cursor = isMe ? 'default' : 'pointer';
            item.innerHTML = '<span>' + (isMe ? '⭐ ' : '👤 ') + '<strong>' + p.name + '</strong>' + (isCurrent ? ' ←' : '') + '</span>' +
                '<span>💰 ' + (p.balance ?? 0) + ' &nbsp;|&nbsp; ❤️ ' + (p.lifeValue ?? 0) + '</span>';
            listDiv.appendChild(item);
        });
    }

    let _cachedPlayers = null;
    let _cachedCtrl = window._currentTurn ?? null;

    onValue(ref(db, `rooms/${roomId}/players`), (snapshot) => {
        _cachedPlayers = snapshot.val();
        renderPlayers(_cachedPlayers, _cachedCtrl);
    });

    onValue(ref(db, `rooms/${roomId}/status`), (snapshot) => {
        const status = snapshot.val();
        if (!status) return;
        _cachedCtrl = status.tempController ?? status.currentTurn;
        window._currentTurn = _cachedCtrl;
        renderPlayers(_cachedPlayers, _cachedCtrl);
    });
}

// =============================================
// LOG
// =============================================
async function addLog(roomId, name, message) {
    if (!roomId || !name) return;
    const timestamp = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    try { await push(ref(db, `rooms/${roomId}/log`), { name, message, timestamp }); }
    catch (e) { console.warn("log 寫入失敗", e); }
}

function showLogPage() {
    // 不 resetOperation，保留 LOTTERY 等狀態
    // 進入 LOG 前先隱藏 side-btn（UNDO/ENTER）
    showSideButtons(false);
    document.getElementById('game-page').style.display = 'none';
    document.getElementById('log-page').style.display  = 'flex';
    const roomId  = localStorage.getItem('lifeGame_myRoomId');
    const logList = document.getElementById('log-list');
    logList.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">載入中...</p>';
    get(ref(db, `rooms/${roomId}/log`)).then(snapshot => {
        logList.innerHTML = "";
        if (!snapshot.exists()) { logList.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">尚無記錄</p>'; return; }
        Object.values(snapshot.val()).reverse().forEach(entry => {
            const item = document.createElement('div');
            item.className = 'log-item';
            item.innerHTML = '<span class="log-time">' + entry.timestamp + '</span><span class="log-name">' + entry.name + '</span><span class="log-msg">' + entry.message + '</span>';
            logList.appendChild(item);
        });
    });
}

document.getElementById('logBackBtn').addEventListener('click', () => {
    document.getElementById('log-page').style.display  = 'none';
    document.getElementById('game-page').style.display = 'flex';
    const roomId = myRoom();
    if (!roomId) return;
    // 重新套用控制鎖（LOTTERY 進行中 → 重新鎖住；觀戰者 → 鎖住大部分）
    get(ref(db, `rooms/${roomId}/status`)).then(snap => {
        if (snap.val()) applyControlLock(snap.val(), myName());
    });
    // 若 LOTTERY 進行中，重新執行 func-btn 鎖定
    get(ref(db, `rooms/${roomId}/lottery`)).then(snap => {
        const lottery = snap.val();
        if (lottery?.active) {
            document.querySelectorAll('.func-btn').forEach(b => {
                if (b.getAttribute('data-val') === '9') b.classList.remove('house-dim');
                else b.classList.add('house-dim');
            });
        }
    });
    // 移除 LOG btn 的 func-active 白邊框（LOG 不該保持高亮）
    document.querySelectorAll('.func-btn').forEach(b => b.classList.remove('func-active'));
});

// =============================================
// TURN SYSTEM — 完整回合控制系統
// 這段程式碼要插入 script.js 的適當位置
// =============================================

// ── Firebase 結構 ──
// rooms/{roomId}/status:
//   { currentTurn, playerOrder, years, phase, round,
//     firstPlayer, lastPlayerIndex, tempController, tempFrom }
// phase: 'WAITING'|'PLAYING'|'SETTLEMENT'|'FINAL'

// ── 本地狀態 ──
let hasControl = false;  // 我是否有遊戲控制權
let isTempControl = false; // 是否是暫時控制

// ── 取得我的名字與房間 ──
function myName() { return localStorage.getItem('lifeGame_myName'); }
function myRoom() { return localStorage.getItem('lifeGame_myRoomId'); }

// =============================================
// 加入遊戲：記錄加入順序
// =============================================
// 在 joinBtn listener 中，set 新玩家資料後需要把玩家加入 playerOrder
// 在 joinBtn 的 else 分支（新玩家）後：
async function registerPlayerOrder(roomId, name) {
    const statusRef = ref(db, `rooms/${roomId}/status`);
    const snap = await get(statusRef);
    const status = snap.val() ?? {};
    const order = status.playerOrder ?? [];
    if (!order.includes(name)) {
        order.push(name);
        await update(statusRef, { playerOrder: order });
        // 第一位玩家：給他遊戲控制權，設 phase=WAITING（等設定 YEARS）
        if (order.length === 1) {
            window._currentTurn = name; // 本地立即更新 ← 符號
            await update(statusRef, {
                currentTurn: name,
                firstPlayer: name,
                phase: 'WAITING',
                years: 0,
                round: 0,
                lastPlayerIndex: 0
            });
        }
    }
}

// =============================================
// listenGameStatus 重寫：處理 turn / phase / 鎖定
// =============================================
function listenGameStatus_NEW() {
    const roomId = myRoom();

    onValue(ref(db, `rooms/${roomId}/status`), async (snapshot) => {
        const status = snapshot.val();
        if (!status) return;
        const me = myName();

        const ctrl = status.tempController ?? status.currentTurn;
        const wasMyTurn = hasControl;
        hasControl = (ctrl === me);
        isTempControl = (status.tempController === me);
        window._currentTurn = ctrl; // 給玩家列表用
        // status 更新時強制重繪玩家列表（確保 ← 符號一致）
        refreshPlayerList();

        // 輪到自己時震動提示（狀態從非控制→控制）
        // if (hasControl && !wasMyTurn && navigator.vibrate) {
        //     navigator.vibrate([100, 50, 100]);
        // }

        // 更新 UI 控制鎖
        applyControlLock(status, me);

        // turn-indicator 文字
        const ind = document.getElementById('turn-indicator');
        // turn-indicator 永遠顯示誰的回合
        if (status.phase === 'SETTLEMENT') {
            ind.innerText = hasControl ? '🏁 ' + myName() + ' 的結算' : ctrl + ' 結算中...';
        } else if (status.phase === 'FINAL') {
            ind.innerText = '🎉 遊戲結束！';
            // 所有玩家同時顯示排行榜
            showFinalRanking();
        } else if (hasControl && isTempControl) {
            ind.innerText = '🔄 ' + myName() + ' 暫時控制中';
        } else if (hasControl) {
            ind.innerText = '★ ' + myName() + ' 的回合';
        } else {
            ind.innerText = ctrl + ' 的回合';
        }

        // 顯示 years（從 status 讀，是房間共通的）
        if (status.years !== undefined) {
            document.getElementById('display-years').innerText = status.years;
        }

        document.body.classList.toggle('active-turn', hasControl);
    });

    // 監聽 lottery（所有玩家）
    onValue(ref(db, `rooms/${roomId}/lottery`), async (snap) => {
        const lottery = snap.val();
        const me = myName();
        if (!lottery?.active) {
            document.getElementById('lottery-panel').style.display = 'none';
            // 移除 X 按鈕，讓下次重新建立
            document.getElementById('lottery-close-btn')?.remove();
            // lottery 結束後重新套用控制鎖（恢復原本狀態）
            get(ref(db, `rooms/${roomId}/status`)).then(ss => {
                if (ss.val()) applyControlLock(ss.val(), me);
            });
            if (activeFuncMode === 'LOTTERY') {
                activeFuncMode = null;
                clearFuncActive();
            }
            return;
        }
        document.getElementById('lottery-panel').style.display = 'block';
        document.getElementById('lottery-pot').innerText = '🎰 獎金 ' + formatMoney(Math.round(lottery.pot));

        // X 關閉按鈕（每次都重建，避免殘留）
        const existingClose = document.getElementById('lottery-close-btn');
        if (!existingClose) {
            const closeBtn = document.createElement('button');
            closeBtn.id = 'lottery-close-btn';
            closeBtn.innerText = '✕';
            closeBtn.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;color:#888;font-size:16px;cursor:pointer;z-index:10;';
            closeBtn.addEventListener('click', () => {
                if (lottery.initiator === me) {
                    if (confirm('確定關閉大樂透？')) {
                        update(ref(db, `rooms/${roomId}/lottery`), { active: false });
                        addLog(roomId, me, 'LOTTERY 手動關閉');
                    }
                } else {
                    alert('只有發起者可關閉大樂透');
                }
            });
            const lp = document.getElementById('lottery-panel');
            lp.style.position = 'relative';
            lp.appendChild(closeBtn);
        }

        // LOTTERY 期間：所有 func-btn 鎖住，只留 LOG（9）
        document.querySelectorAll('.func-btn').forEach(b => {
            if (b.getAttribute('data-val') === '9') b.classList.remove('house-dim');
            else b.classList.add('house-dim');
        });
        const isInitiator = lottery.initiator === me;
        const maxPicks = isInitiator ? 3 : 1;
        const myPicks = Object.values(lottery.picks?.[me] ?? {});
        const allPicked = Object.values(lottery.picks ?? {}).flatMap(v => Array.isArray(v) ? v : Object.values(v));
        if (lottery.phase === 'SELECT') {
            document.getElementById('lottery-info').innerText =
                isInitiator ? '請選擇 3 個號碼（1~' + lottery.M + '）' : '請選擇 1 個號碼（1~' + lottery.M + '）';
            const container = document.getElementById('lottery-numbers');
            container.innerHTML = '';
            for (let i = 1; i <= lottery.M; i++) {
                const btn = document.createElement('button');
                btn.className = 'lottery-num-btn';
                btn.innerText = i; btn.dataset.num = i;
                if (myPicks.includes(i)) btn.classList.add('selected-num');
                if (allPicked.includes(i) && !myPicks.includes(i)) { btn.disabled = true; btn.classList.add('num-taken'); }
                btn.addEventListener('click', () => {
                    if (myPicks.length >= maxPicks) { document.getElementById('lottery-info').innerText = '✓ 已選完'; return; }
                    if (myPicks.includes(i)) return;
                    myPicks.push(i);
                    btn.classList.add('selected-num');
                    document.getElementById('lottery-info').innerText = '已選 ' + myPicks.join(', ') + ' (' + myPicks.length + '/' + maxPicks + ')';
                    if (myPicks.length >= maxPicks) {
                        const upd = {}; upd[me] = myPicks;
                        update(ref(db, `rooms/${roomId}/lottery/picks`), upd).then(() => {
                            document.getElementById('lottery-info').innerText = '✓ 已選 ' + myPicks.join(', ') + '，等待其他玩家...';
                            document.querySelectorAll('.lottery-num-btn').forEach(b => {
                                if (!b.classList.contains('selected-num')) { b.disabled = true; b.classList.add('num-taken'); }
                            });
                        });
                    }
                });
                container.appendChild(btn);
            }
            if (isInitiator) {
                get(ref(db, `rooms/${roomId}/players`)).then(ps => {
                    const players = Object.values(ps.val() ?? {}).filter(p => p.isVisible);
                    const allDone = players.every(p => {
                        const needed = p.name === me ? 3 : 1;
                        const picked = lottery.picks?.[p.name];
                        const cnt = Array.isArray(picked) ? picked.length : Object.keys(picked ?? {}).length;
                        return cnt >= needed;
                    });
                    if (allDone && lottery.phase === 'SELECT') update(ref(db, `rooms/${roomId}/lottery`), { phase: 'SPIN' });
                });
            }
        }
        if (lottery.phase === 'SPIN' && isInitiator) {
            // 有 winnerNumbers 表示剛加碼（上一輪已開過），否則是第一次
            const prevWin = lottery.winnerNumbers;
            if (prevWin == null) {
                document.getElementById('lottery-info').innerText = '所有人已選號！按 START 開獎';
            } else {
                document.getElementById('lottery-info').innerText = '無人中獎，獎金加碼 → ' + formatMoney(lottery.pot) + '，按 START 再次開獎';
            }
            // 加入 START 按鈕
            if (!document.getElementById('lottery-start-btn')) {
                const startBtn = document.createElement('button');
                startBtn.id = 'lottery-start-btn';
                startBtn.innerText = '🎰 START';
                startBtn.style.cssText = 'display:block;margin:10px auto;padding:10px 28px;background:var(--primary);color:#000;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;';
                startBtn.addEventListener('click', async () => {
                    startBtn.disabled = true; startBtn.innerText = '開獎中...';
                    await execLotterySpin();
                });
                document.getElementById('lottery-numbers').after(startBtn);
            }
            if (activeFuncMode !== 'LOTTERY') activeFuncMode = 'LOTTERY';
        }
        // ANIMATING：非發起者也跑動畫（發起者自己跑，非發起者由 Firebase 觸發）
        if (lottery.phase === 'ANIMATING' && lottery.winnerNumbers != null) {
            const me2 = myName();
            const isInit2 = lottery.initiator === me2;
            if (!isInit2) {
                // 非發起者：在自己的裝置上跑動畫
                const numBtns = Array.from(document.querySelectorAll('.lottery-num-btn'));
                // 先把號碼恢復白色（active 狀態）
                numBtns.forEach(b => {
                    b.classList.remove('lottery-winner', 'lottery-highlight', 'num-taken');
                    if (!b.classList.contains('selected-num')) b.style.borderColor = '';
                    b.disabled = false;
                });
                const winNum2 = lottery.winnerNumbers;
                const targetIdx2 = numBtns.findIndex(b => parseInt(b.dataset.num) === winNum2);
                const rounds2 = 2;
                const totalSteps2 = numBtns.length * rounds2 + targetIdx2 + 1;
                let delay2 = 40;
                (async () => {
                    for (let i = 0; i < totalSteps2; i++) {
                        const curIdx2 = i % numBtns.length;
                        numBtns.forEach(b => b.classList.remove('lottery-highlight'));
                        numBtns[curIdx2].classList.add('lottery-highlight');
                        if (i > totalSteps2 - 15) delay2 += 50;
                        else if (i > totalSteps2 - 30) delay2 += 15;
                        await new Promise(r => setTimeout(r, delay2));
                    }
                    numBtns.forEach(b => b.classList.remove('lottery-highlight'));
                    if (numBtns[targetIdx2]) numBtns[targetIdx2].classList.add('lottery-winner');
                })();
            }
        }
        // DONE：紅框由動畫結束後顯示（ANIMATING 跑完後才到 DONE）
        if (lottery.phase === 'DONE') {
            const numBtns = Array.from(document.querySelectorAll('.lottery-num-btn'));
            const winNum = lottery.winnerNumbers;
            if (winNum != null) {
                const targetBtn = numBtns.find(b => parseInt(b.dataset.num) === winNum);
                if (targetBtn && !targetBtn.classList.contains('lottery-winner')) {
                    numBtns.forEach(b => b.classList.remove('lottery-highlight'));
                    targetBtn.classList.add('lottery-winner');
                }
            }
        }
        if (lottery.phase === 'DONE' && lottery.winnerNumbers != null) displayLotteryResult(lottery, me, roomId);
    });
}

// =============================================
// applyControlLock：依控制權鎖定 UI
// =============================================
function applyControlLock(status, me) {
    const ctrl = status.tempController ?? status.currentTurn;
    const iHaveControl = (ctrl === me);
    const isTemp = (status.tempController === me);
    const phase = status.phase ?? 'PLAYING';

    // 無控制權：鎖全部
    if (!iHaveControl) {
        lockAllUI(true);
        // LOG 和退出永遠可用
        const logBtn = document.querySelector('.func-btn[data-val="9"]');
        if (logBtn) logBtn.classList.remove('house-dim');
        return;
    }

    // 有控制權：解鎖
    lockAllUI(false);

    // 未 SPIN 前鎖住結束回合（SPIN 完成後由 spin handler 解鎖）
    const spinDone = document.getElementById('spinBtn')?.classList.contains('spin-done');
    if (!spinDone) {
        document.getElementById('endTurnBtn').disabled = true;
        document.getElementById('endTurnBtn').classList.add('btn-locked');
    }

    // 暫時控制：只能調整金錢/人生值、LOG、結束回合
    if (isTemp) {
        document.querySelectorAll('.func-btn').forEach(b => {
            if (b.getAttribute('data-val') === '9') b.classList.remove('house-dim');
            else b.classList.add('house-dim');
        });
        setSpinLocked(true);
        // UNDO 按鈕不顯示（暫時控制只能用結束回合交回）
        showSideButtons(false);
        // 結束回合解鎖（暫時控制可按結束回合交回）
        document.getElementById('endTurnBtn').disabled = false;
        document.getElementById('endTurnBtn').classList.remove('btn-locked');
        return;
    }

    // WAITING phase：不再限制任何操作

    // SETTLEMENT phase：SPIN 亮（用來觸發結算），endTurn 暗（結算後才亮）
    if (phase === 'SETTLEMENT') {
        document.querySelectorAll('.func-btn').forEach(b => b.classList.add('house-dim'));
        const logBtn = document.querySelector('.func-btn[data-val="9"]');
        if (logBtn) logBtn.classList.remove('house-dim');
        // 若 spin-done 表示已結算，SPIN 保持暗，endTurn 亮
        const alreadySettled = document.getElementById('spinBtn')?.classList.contains('spin-done');
        if (alreadySettled) {
            setSpinLocked(true);
            document.getElementById('endTurnBtn').disabled = false;
            document.getElementById('endTurnBtn').classList.remove('btn-locked');
        } else {
            setSpinLocked(false); // 尚未結算，SPIN 可按
            document.getElementById('endTurnBtn').disabled = true;
            document.getElementById('endTurnBtn').classList.add('btn-locked');
        }
        return;
    }
}

function lockAllUI(lock) {
    // func-btn
    document.querySelectorAll('.func-btn').forEach(b => {
        if (lock) b.classList.add('house-dim');
        else b.classList.remove('house-dim');
    });
    // stat-box（金錢/人生值點擊）
    ['display-balance-box','display-life-box'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.pointerEvents = lock ? 'none' : '';
    });
    // SPIN
    const sb = document.getElementById('spinBtn');
    if (lock) { sb.classList.add('spin-locked'); sb.disabled = true; }
    else if (!sb.classList.contains('spin-done')) { sb.classList.remove('spin-locked'); sb.disabled = false; }
    // endTurn
    const et = document.getElementById('endTurnBtn');
    et.disabled = lock;
    et.classList.toggle('btn-locked', lock);
    // op-btn, side-btn
    document.querySelectorAll('.op-btn').forEach(b => { b.style.pointerEvents = lock ? 'none' : ''; b.style.opacity = lock ? '0.1' : ''; });
    if (lock) { showSideButtons(false); }
}

// =============================================
// SPIN 按下：計算財產增減（原本在 endTurn 的結算移到這裡）
// =============================================
async function onSpinPressed_turnCalc() {
    const roomId = myRoom();
    const name   = myName();
    // 計算本回合財產增減
    await applyHouseGrowth(roomId, name);
    await applyCarAging(roomId, name);
    await applyBabyCost(roomId, name);
    await applyDebtInterest(roomId, name);
    // 領薪資
    await applySalary(roomId, name);
    await applyMarriageBonus(roomId, name);
    addLog(roomId, name, '--- 回合結算 ---');
}

async function applySalary(roomId, name) {
    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();
    const salary = data?.salary ?? 0;
    if (salary <= 0) return;
    await update(playerRef, { balance: (data.balance ?? 0) + salary });
    addLog(roomId, name, '領取薪資 +' + formatSalary(salary));
    // 只有自己的薪資才播音效
    if (name === myName()) _audio.playCoin();
}

// =============================================
// 結束回合：交接控制權
// =============================================
async function endTurn_NEW() {
    const roomId = myRoom();
    const name   = myName();
    const statusSnap = await get(ref(db, `rooms/${roomId}/status`));
    const status = statusSnap.val() ?? {};
    const order  = status.playerOrder ?? [name];
    const phase  = status.phase ?? 'PLAYING';

    // 暫時控制：交回原本控制者
    if (status.tempController) {
        await update(ref(db, `rooms/${roomId}/status`), {
            tempController: null,
            currentTurn: status.tempFrom ?? status.currentTurn
        });
        addLog(roomId, name, '暫時控制結束，交回 ' + (status.tempFrom ?? status.currentTurn));
        return;
    }

    // 找下一位可見玩家
    const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
    const players = playersSnap.val() ?? {};
    const curIdx = order.indexOf(name);
    let nextIdx = (curIdx + 1) % order.length;
    for (let i = 0; i < order.length; i++) {
        if (players[order[nextIdx]]?.isVisible) break;
        nextIdx = (nextIdx + 1) % order.length;
    }
    const nextPlayer = order[nextIdx];

    // 所有人都輪完一圈（回到第一位）→ years -1
    const completedRound = (nextIdx === 0 || nextPlayer === order[0]);
    let newYears = status.years ?? 0;
    if (completedRound && phase === 'PLAYING') {
        newYears = Math.max(0, newYears - 1);
        if (newYears <= 0) {
            await update(ref(db, `rooms/${roomId}/status`), {
                currentTurn: order[0], years: 0,
                round: (status.round ?? 0) + 1,
                phase: 'SETTLEMENT', settlementIndex: 0
            });
            addLog(roomId, name, '遊戲年數歸零，進入結算！'); return;
        }
        window._currentTurn = nextPlayer;
        await update(ref(db, `rooms/${roomId}/status`), {
            currentTurn: nextPlayer, years: newYears,
            round: (status.round ?? 0) + 1
        });
        addLog(roomId, name, '回合結束，years → ' + newYears + '，輪到 ' + nextPlayer);
    } else {
        window._currentTurn = nextPlayer; // 立即更新本地，讓 ← 馬上變
        await update(ref(db, `rooms/${roomId}/status`), { currentTurn: nextPlayer });
        addLog(roomId, name, '回合結束，輪到 ' + nextPlayer);
    }
    // 更新玩家列表的 ← 符號
    document.querySelectorAll('.player-item strong').forEach(el => {
        const name_el = el.innerText;
        const arrow = el.parentElement.querySelector('← ') ?? el.nextSibling;
        const isNowCurrent = (name_el === window._currentTurn);
        const span = el.closest('span');
        if (span) {
            span.innerHTML = (span.innerHTML.includes('⭐') ? '⭐ ' : '👤 ') + '<strong>' + name_el + '</strong>' + (isNowCurrent ? ' ←' : '');
        }
    });
}

// =============================================
// 暫時控制權：點擊玩家欄位
// =============================================
function setupTempControl(roomId) {
    document.getElementById('other-players-list').addEventListener('click', async (e) => {
        const item = e.target.closest('.player-item');
        if (!item) return;
        const targetName = item.querySelector('strong')?.innerText;
        if (!targetName || targetName === myName()) return;

        // 只有有控制權的人才能交棒
        const statusSnap = await get(ref(db, `rooms/${roomId}/status`));
        const status = statusSnap.val() ?? {};
        const ctrl = status.tempController ?? status.currentTurn;
        if (ctrl !== myName()) return;
        if (status.tempController) { alert('已在暫時控制中'); return; }

        if (confirm('交棒給 ' + targetName + '？\n（只能調整金錢/人生值，完成後交回你）')) {
            await update(ref(db, `rooms/${roomId}/status`), {
                tempController: targetName,
                tempFrom: myName()
            });
            addLog(roomId, myName(), '暫時交棒給 ' + targetName);
        }
    });
}

// =============================================
// SETTLEMENT PHASE（結算）
// =============================================
async function runSettlement() {
    const roomId = myRoom();
    const name   = myName();
    const statusSnap = await get(ref(db, `rooms/${roomId}/status`));
    const status = statusSnap.val() ?? {};
    const order = status.playerOrder ?? [name];
    const idx   = status.settlementIndex ?? 0;
    const targetName = order[idx];

    if (targetName !== name) return; // 不是我的結算

    const playerRef = ref(db, `rooms/${roomId}/players/${name}`);
    const snap = await get(playerRef);
    const data = snap.val();

    // 把房子和車子轉換為金錢
    let liquidated = 0;
    const h = data.house ?? {};
    const upd = {};
    for (const key of ['small','medium','luxury']) {
        if (h[key]) {
            liquidated += h[key + 'Value'] ?? 0;
            upd['house/' + key] = false;
            upd['house/' + key + 'Value'] = 0;
        }
    }
    const car = data.car ?? {};
    for (const slot of ['car1','car2']) {
        if (car[slot]?.type) {
            liquidated += car[slot].value ?? 0;
            upd['car/' + slot] = null;
        }
    }

    const totalBalance = (data.balance ?? 0) + liquidated;

    // 取得或建立本局唯一轉換比例（存在 status.settlementRate）
    const statusSnap2 = await get(ref(db, `rooms/${roomId}/status`));
    const status2 = statusSnap2.val() ?? {};
    let rate = status2.settlementRate;
    if (!rate) {
        rate = 80 + Math.floor(Math.random() * 41); // 80~120，只產生一次
        await update(ref(db, `rooms/${roomId}/status`), { settlementRate: rate });
    }

    // 負債也換算為負人生值（totalBalance 可為負）
    const lifeFromMoney = totalBalance >= 0
        ? Math.floor(totalBalance / rate)
        : -Math.floor(Math.abs(totalBalance) / rate);
    const finalLife = (data.lifeValue ?? 0) + lifeFromMoney;

    // 先顯示資產總額，延遲後才轉換
    document.getElementById('turn-indicator').innerText =
        '🏁 資產：' + formatMoney(liquidated) + ' 現金：' + formatMoney(data.balance ?? 0) +
        ' 合計：' + formatMoney(totalBalance);
    document.getElementById('endTurnBtn').disabled = true;
    document.getElementById('endTurnBtn').classList.add('btn-locked');

    // 延遲 3 秒讓玩家看清楚資產，再轉換人生值
    await new Promise(r => setTimeout(r, 3000));

    upd.balance = 0;
    upd.lifeValue = finalLife;
    upd.settlementDone = true;
    upd.finalLife = finalLife;
    await update(playerRef, upd);

    addLog(roomId, name, '結算：資產 ' + formatMoney(liquidated) + ' + 現金 ' + formatMoney(data.balance ?? 0) +
        ' → 共 ' + formatMoney(totalBalance) + '，人生值 +' + lifeFromMoney + ' = ' + finalLife);

    document.getElementById('turn-indicator').innerText =
        '🏁 結算完成！人生值 +' + lifeFromMoney + ' = ' + finalLife + ' 點，按結束回合';

    // 結算完成：SPIN 暗掉，結束回合亮起
    const spinBtnS = document.getElementById('spinBtn');
    spinBtnS.classList.add('spin-done');
    spinBtnS.disabled = true;
    document.getElementById('endTurnBtn').disabled = false;
    document.getElementById('endTurnBtn').classList.remove('btn-locked');
}

async function advanceSettlement() {
    const roomId = myRoom();
    const statusSnap = await get(ref(db, `rooms/${roomId}/status`));
    const status = statusSnap.val() ?? {};
    const order = status.playerOrder ?? [];
    const nextIdx = (status.settlementIndex ?? 0) + 1;

    if (nextIdx >= order.length) {
        // 所有人結算完畢
        await update(ref(db, `rooms/${roomId}/status`), { phase: 'FINAL' });
        showFinalRanking();
    } else {
        await update(ref(db, `rooms/${roomId}/status`), {
            settlementIndex: nextIdx,
            currentTurn: order[nextIdx]
        });
    }
}

// =============================================
// FINAL RANKING（結算排行榜）
// =============================================
async function showFinalRanking() {
    if (document.getElementById('ranking-page').style.display === 'flex') return; // 避免重複
    document.getElementById('game-page').style.display = 'none';
    document.getElementById('log-page').style.display = 'none';
    document.getElementById('ranking-page').style.display = 'flex';

    const roomId = myRoom();
    const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
    const players = Object.values(playersSnap.val() ?? {}).filter(p => p.isVisible);
    players.sort((a, b) => (b.finalLife ?? b.lifeValue ?? 0) - (a.finalLife ?? a.lifeValue ?? 0));

    const list = document.getElementById('ranking-list');
    list.innerHTML = '';
    players.forEach((p, i) => {
        const medals = ['🥇','🥈','🥉'];
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.innerHTML = '<span class="rank-medal">' + (medals[i] ?? (i+1)+'位') + '</span>' +
            '<span class="rank-name">' + p.name + '</span>' +
            '<span class="rank-life">❤️ ' + (p.finalLife ?? p.lifeValue ?? 0) + '</span>';
        list.appendChild(item);
    });
}

document.getElementById('endGameBtn')?.addEventListener('click', () => {
    const name   = myName();
    const roomId = myRoom();
    update(ref(db, `rooms/${roomId}/players/${name}`), { status: "offline", isVisible: false }).then(() => {
        localStorage.removeItem('lifeGame_myName');
        localStorage.removeItem('lifeGame_myRoomId');
        location.reload();
    });
});


// =============================================
// 退出遊戲
// =============================================
document.getElementById('leaveBtn').addEventListener('click', () => {
    const name   = localStorage.getItem('lifeGame_myName');
    const roomId = localStorage.getItem('lifeGame_myRoomId');
    // 按鈕文字顯示房間號碼
    document.getElementById('leaveBtn').innerText = '退出 [' + (roomId ?? '') + '] 遊戲';
    if (confirm("確定退出房間 [" + (roomId ?? '') + "] 嗎？")) {
        update(ref(db, `rooms/${roomId}/players/${name}`), { status: "offline", isVisible: false })
            .then(() => { localStorage.removeItem('lifeGame_myName'); localStorage.removeItem('lifeGame_myRoomId'); location.reload(); });
    }
});