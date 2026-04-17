import { db, ref, set, onValue, update, get } from './firebase.js';

// =============================================
// 狀態變數
// =============================================
let currentModifyTarget = null; // 'balance' | 'lifeValue' | null
let tempModifyValue = 0;
let inputMode = false;       // 是否已選擇方向，可以輸入數字
let inputBuffer = "";
let inputDirection = null;   // 'PLUS' | 'MINUS' | null
let isSpinning = false;

// =============================================
// 初始化：若有儲存的名稱，直接進入遊戲
// =============================================
const savedName = localStorage.getItem('lifeGame_myName');
if (savedName) showGamePage(savedName);

// =============================================
// 加入遊戲
// =============================================
document.getElementById('joinBtn').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    if (!name) return alert("請輸入名字");

    set(ref(db, 'rooms/game123/players/' + name), {
        name,
        balance: 10000,
        lifeValue: 0,
        yearsLeft: 30,
        salary: 3000
    }).then(() => {
        localStorage.setItem('lifeGame_myName', name);
        showGamePage(name);
    });
});

function showGamePage(name) {
    document.getElementById('join-page').style.display = 'none';
    document.getElementById('game-page').style.display = 'flex';
    document.querySelector('#welcome-msg span').innerText = name;
    listenToMyStatus(name);
    listenAllPlayers();
    listenGameStatus();
}

// =============================================
// 監聽自己的資料
// =============================================
function listenToMyStatus(name) {
    onValue(ref(db, `rooms/game123/players/${name}`), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const balanceEl = document.getElementById('display-balance');
        balanceEl.innerText = `$${data.balance}`;
        balanceEl.classList.toggle('negative-money', data.balance < 0);

        document.getElementById('display-life').innerText = data.lifeValue;
        document.getElementById('display-years').innerText = data.yearsLeft;
        document.getElementById('display-salary').innerText = `$${data.salary}`;
    });
}

// =============================================
// 點擊數值格 → 啟動調整模式
// =============================================
document.getElementById('display-balance-box').addEventListener('click', () => activateAdjust('balance'));
document.getElementById('display-life-box').addEventListener('click', () => activateAdjust('lifeValue'));

function activateAdjust(target) {
    resetAdjustUI();

    currentModifyTarget = target;
    inputMode = false;       // 尚未選擇方向，還不能輸入數字
    inputDirection = null;
    inputBuffer = "";

    const targetId = target === 'balance' ? 'display-balance-box' : 'display-life-box';
    document.getElementById(targetId).classList.add('active-status');

    document.getElementById('minusBtn').classList.add('active');
    document.getElementById('plusBtn').classList.add('active');
    document.getElementById('resetBtn').classList.remove('hidden');
    document.getElementById('enterBtn').classList.remove('hidden');

    const label = target === 'balance' ? '金額' : '人生值';
    document.getElementById('turn-indicator').innerText = `先按 + 或 − 選擇方向`;
}

// =============================================
// 數字鍵 (1~10)：選好方向後才能輸入
// =============================================
document.querySelectorAll('.func-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!inputMode) return; // 必須先按過 + 或 −
        // data-val="10" 在輸入模式下作為 "0" 使用
        const digit = btn.getAttribute('data-val') === "10" ? "0" : btn.getAttribute('data-val');
        inputBuffer += digit;
        const sign = inputDirection === 'PLUS' ? '+' : '−';
        document.getElementById('turn-indicator').innerText = `${sign} ${inputBuffer}`;
    });
});

// =============================================
// 加 / 減按鈕：選擇方向，開啟數字輸入
// =============================================
document.getElementById('plusBtn').addEventListener('click', () => {
    if (!currentModifyTarget) return;
    inputDirection = 'PLUS';
    inputMode = true;
    inputBuffer = "";
    // 高亮 + 按鈕，取消 − 高亮
    document.getElementById('plusBtn').classList.add('selected');
    document.getElementById('minusBtn').classList.remove('selected');
    document.getElementById('turn-indicator').innerText = `+ 輸入數字...`;
});

document.getElementById('minusBtn').addEventListener('click', () => {
    if (!currentModifyTarget) return;
    inputDirection = 'MINUS';
    inputMode = true;
    inputBuffer = "";
    document.getElementById('minusBtn').classList.add('selected');
    document.getElementById('plusBtn').classList.remove('selected');
    document.getElementById('turn-indicator').innerText = `− 輸入數字...`;
});

// =============================================
// Enter：寫入 Firebase
// =============================================
document.getElementById('enterBtn').addEventListener('click', async () => {
    if (!currentModifyTarget || !inputDirection || !inputBuffer) return;

    const amount = parseInt(inputBuffer, 10);
    if (isNaN(amount) || amount === 0) return;
    tempModifyValue = inputDirection === 'PLUS' ? amount : -amount;

    const name = localStorage.getItem('lifeGame_myName');
    const playerRef = ref(db, `rooms/game123/players/${name}`);
    const snapshot = await get(playerRef);

    if (snapshot.exists()) {
        const currentVal = snapshot.val()[currentModifyTarget] ?? 0;
        await update(playerRef, { [currentModifyTarget]: currentVal + tempModifyValue });
    }
    resetOperation();
});

// =============================================
// Reset：清除調整模式（狀態 + UI）
// =============================================
document.getElementById('resetBtn').addEventListener('click', resetOperation);

function resetOperation() {
    currentModifyTarget = null;
    tempModifyValue = 0;
    inputMode = false;
    inputBuffer = "";
    inputDirection = null;
    resetAdjustUI();
    document.getElementById('turn-indicator').innerText = "等待操作...";
}

// 只重設 UI（供 activateAdjust 內部呼叫，避免重複邏輯）
function resetAdjustUI() {
    document.querySelectorAll('.stat-box').forEach(el => el.classList.remove('active-status'));
    document.getElementById('minusBtn').classList.remove('active', 'selected');
    document.getElementById('plusBtn').classList.remove('active', 'selected');
    document.getElementById('resetBtn').classList.add('hidden');
    document.getElementById('enterBtn').classList.add('hidden');
}

// =============================================
// SPIN：跑馬燈動畫（由快到慢）
// =============================================
async function runAdvancedSpin(targetValue) {
    const btns = Array.from(document.querySelectorAll('.func-btn'));
    const targetIndex = btns.findIndex(b => b.dataset.val == targetValue);
    const totalSteps = 40 + targetIndex;
    let currentIndex = 0;
    let delay = 50;

    for (let i = 0; i < totalSteps; i++) {
        btns.forEach(b => b.classList.remove('highlight'));
        btns[currentIndex].classList.add('highlight');

        if (i > totalSteps - 10) delay += 40;
        else if (i > totalSteps - 20) delay += 15;

        await new Promise(r => setTimeout(r, delay));
        currentIndex = (currentIndex + 1) % btns.length;
    }

    btns.forEach(b => b.classList.remove('highlight', 'light-on'));
    btns[targetIndex].classList.add('light-on');
}

document.getElementById('spinBtn').addEventListener('click', async () => {
    if (isSpinning) return;
    isSpinning = true;
    setButtonsLocked(true);

    const result = Math.floor(Math.random() * 10) + 1;
    document.getElementById('spin-result').innerText = "";
    await runAdvancedSpin(result);

    //document.getElementById('spin-result').innerText = result;
    isSpinning = false;
    setButtonsLocked(false);
});

// =============================================
// 結束回合
// =============================================
document.getElementById('endTurnBtn').addEventListener('click', async () => {
    resetOperation();
    document.querySelectorAll('.func-btn').forEach(btn => {
        btn.classList.remove('light-on', 'highlight');
    });

    const name = localStorage.getItem('lifeGame_myName');
    await update(ref(db, 'rooms/game123/status'), {
        lastTurn: name,
        currentTurn: null
    });

    document.getElementById('turn-indicator').innerText = "回合結束，等待下一位...";
});

// =============================================
// 監聽遊戲回合狀態
// =============================================
function listenGameStatus() {
    onValue(ref(db, 'rooms/game123/status'), (snapshot) => {
        const status = snapshot.val();
        if (!status) return;

        const myName = localStorage.getItem('lifeGame_myName');
        const isMyTurn = status.currentTurn === myName;

        document.body.classList.toggle('active-turn', isMyTurn);
        document.getElementById('turn-indicator').innerText = isMyTurn
            ? "★ 您的回合"
            : status.currentTurn
                ? `等待 ${status.currentTurn} 的回合...`
                : "等待下一回合...";
    });
}

// =============================================
// 監聽所有玩家狀態
// =============================================
function listenAllPlayers() {
    onValue(ref(db, 'rooms/game123/players'), (snapshot) => {
        const players = snapshot.val();
        const listDiv = document.getElementById('other-players-list');
        if (!listDiv) return;

        listDiv.innerHTML = "";
        if (!players) return;

        const myName = localStorage.getItem('lifeGame_myName');
        Object.values(players).forEach(p => {
            const isMe = p.name === myName;
            const item = document.createElement('div');
            item.className = `player-item${isMe ? ' player-me' : ''}`;
            item.innerHTML = `
                <span>${isMe ? '⭐' : '👤'} <strong>${p.name}</strong></span>
                <span>💰 ${p.balance} &nbsp;|&nbsp; ❤️ ${p.lifeValue}</span>
            `;
            listDiv.appendChild(item);
        });
    });
}

// =============================================
// 工具函式
// =============================================
function setButtonsLocked(locked) {
    document.querySelectorAll('.func-btn').forEach(btn => {
        btn.classList.toggle('locked', locked);
    });
}

// =============================================
// 退出遊戲
// =============================================
document.getElementById('leaveBtn').addEventListener('click', () => {
    if (confirm("確定退出遊戲嗎？")) {
        localStorage.removeItem('lifeGame_myName');
        location.reload();
    }
});