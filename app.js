const DB_URL = "https://privich-b5b4f-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentRoom = 'general';
let chatUsername = 'Аноним';
let userColor = '#00ff00';
let eventSource = null; 
let decryptedChatKey = "";
let localMessages = {};

const NEON_COLORS = [
    'hsl(120, 100%, 60%)', 'hsl(180, 100%, 50%)', 'hsl(200, 100%, 60%)', 
    'hsl(60, 100%, 50%)',  'hsl(36, 100%, 50%)',  'hsl(0, 100%, 60%)',   
    'hsl(280, 100%, 65%)', 'hsl(150, 100%, 55%)'  
];

// Функция генерации SHA-256 хэша силами встроенного движка браузера (без сторонних библиотек)
async function sha256(string) {
    const utf8 = new TextEncoder().encode(string);
    const hashBuffer = await crypto.subtle.digest('SHA-256', utf8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function allocateUserColor(room, name) {
    try {
        const res = await fetch(`${DB_URL}/colors/${room}.json`);
        const takenColors = await res.json() || {};
        if (takenColors[name]) return takenColors[name];
        
        const usedValues = Object.values(takenColors);
        let availableColors = NEON_COLORS.filter(c => !usedValues.includes(c));
        if (availableColors.length === 0) availableColors = NEON_COLORS;
        
        const randomColor = availableColors[Math.floor(Math.random() * availableColors.length)];
        await fetch(`${DB_URL}/colors/${room}/${name}.json`, {
            method: 'PUT',
            body: JSON.stringify(randomColor)
        });
        return randomColor;
    } catch (e) {
        return NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
    }
}

function xorCipher(text, key) {
    let result = "";
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(unescape(encodeURIComponent(result)));
}

function xorDecipher(hash, key) {
    try {
        let text = decodeURIComponent(escape(atob(hash)));
        let result = "";
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch(e) { return "[Ошибка расшифровки]"; }
}

async function joinChat() {
    const nameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password').value.trim();
    
    if (!nameInput || !passwordInput) return alert('Введите ник и пароль!');
    
    try {
        // 1. Проверяем хэш авторизации
        const resAuth = await fetch(`${DB_URL}/users/${nameInput}.json`);
        const serverPasswordHash = await resAuth.json();
        
        if (!serverPasswordHash) return alert('Неверное имя пользователя или пароль');
        
        const clientPasswordHash = await sha256(passwordInput);
        if (clientPasswordHash !== serverPasswordHash) return alert('Неверное имя пользователя или пароль');
        
        // 2. Скачиваем зашифрованный сейф этого пользователя
        const resVault = await fetch(`${DB_URL}/vault/${nameInput}.json`);
        const encryptedVaultData = await resVault.json();
        
        if (!encryptedVaultData) {
            return alert('Сейф ключей не найден в базе данных!');
        }
        
        // 3. Открываем сейф с помощью введенного личного пароля
        decryptedChatKey = xorDecipher(encryptedVaultData, passwordInput);
        
        // Проверка успешности открытия сейфа (проверим, содержит ли он маркер "OK_")
        if (!decryptedChatKey.startsWith("OK_")) {
            return alert('Ошибка дешифрования ключа чата!');
        }
        
        // Убираем технический маркер и получаем чистый ключ чата
        decryptedChatKey = decryptedChatKey.replace("OK_", "");
        
        // Пускаем в чат
        chatUsername = nameInput;
        currentRoom = 'general';
        
        userColor = await allocateUserColor(currentRoom, chatUsername);
        
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('chat-screen').classList.add('active');
        
        updateHeaderUI();
        startChatSync(); 
        
    } catch (e) {
        console.error(e);
        alert('Ошибка сети или конфигурации базы данных.');
    }
}

function updateHeaderUI() {
    document.getElementById('user-info').innerHTML = `Вы: <span style="color: ${userColor}; font-weight:bold;">${chatUsername}</span>`;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active-tab'));
    const activeTab = document.getElementById(`tab-${currentRoom}`);
    if (activeTab) activeTab.classList.add('active-tab');
}

async function switchRoom(newRoom) {
    if (currentRoom === newRoom) return;
    currentRoom = newRoom;
    
    userColor = await allocateUserColor(currentRoom, chatUsername);
    updateHeaderUI();
    startChatSync(); 
}

function renderChat() {
    const chatWindow = document.getElementById('chat-window');
    const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
    
    chatWindow.innerHTML = '';

    const keys = Object.keys(localMessages);
    if (keys.length === 0) {
        chatWindow.innerHTML = '<div class="msg system">История чиста. Начните общение...</div>';
        return;
    }

    const serverMessageTexts = keys
        .filter(key => !key.startsWith('temp_') && localMessages[key]?.user === chatUsername)
        .map(key => localMessages[key]?.text);

    const finalKeys = keys.filter(key => {
        if (key.startsWith('temp_')) {
            const tempMsg = localMessages[key];
            if (serverMessageTexts.includes(tempMsg.text)) {
                delete localMessages[key];
                return false;
            }
        }
        return true;
    });

    finalKeys.forEach(key => {
        const msgObj = localMessages[key];
        if (!msgObj || !msgObj.text) return;
        
        let decryptedText = xorDecipher(msgObj.text, PASSWORD);
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg';
        msgDiv.innerHTML = `
            <span style="color: ${msgObj.color}; font-weight: bold;">${msgObj.user}:</span> 
            <span>${decryptedText}</span>
            <span class="time">${msgObj.time}</span>
        `;
        chatWindow.appendChild(msgDiv);
    });

    if (isScrolledToBottom) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}

function startChatSync() {
    if (eventSource) eventSource.close();
    
    localMessages = {}; 
    const chatWindow = document.getElementById('chat-window');
    chatWindow.innerHTML = '<div class="msg system">Подключение к комнате...</div>';

    eventSource = new EventSource(`${DB_URL}/rooms/${currentRoom}.json`, {
        headers: { "Accept": "text/event-stream" }
    });

    eventSource.addEventListener('put', (event) => {
        const payload = JSON.parse(event.data);
        if (payload.path === "/") {
            localMessages = payload.data || {};
        } else if (payload.path === null || payload.data === null) {
            localMessages = {};
        } else {
            const msgKey = payload.path.replace('/', '');
            if (payload.data) {
                localMessages[msgKey] = payload.data;
            } else {
                delete localMessages[msgKey];
            }
        }
        renderChat();
    });

    eventSource.addEventListener('patch', (event) => {
        const payload = JSON.parse(event.data);
        if (payload.data) {
            Object.assign(localMessages, payload.data);
            renderChat();
        }
    });

    eventSource.onerror = (err) => {
        console.error("Ошибка потока данных, переподключение...", err);
    };
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    
    const encryptedText = xorCipher(text, PASSWORD);
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    const payload = {
        user: chatUsername,
        color: userColor,
        text: encryptedText,
        time: timeStr
    };

    const tempKey = 'temp_' + Date.now();
    localMessages[tempKey] = {
        user: chatUsername,
        color: userColor,
        text: encryptedText, 
        time: timeStr
    };
    
    renderChat(); 
    input.value = ''; 
    
    fetch(`${DB_URL}/rooms/${currentRoom}.json`, {
        method: 'POST',
        body: JSON.stringify(payload)
    })
    .catch(err => {
        delete localMessages[tempKey];
        renderChat();
        alert("Сообщение не ушло. Проверьте связь.");
    });
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

function handleLoginKeyPress(event) {
    if (event.key === 'Enter') joinChat();
}

function clearChat() {
    if (confirm('Вы уверены, что хотите полностью стереть переписку в этой вкладке?')) {
        fetch(`${DB_URL}/rooms/${currentRoom}.json`, { method: 'DELETE' })
            .then(() => {
                fetch(`${DB_URL}/colors/${currentRoom}.json`, { method: 'DELETE' });
                localMessages = {};
                renderChat();
            });
    }
}


