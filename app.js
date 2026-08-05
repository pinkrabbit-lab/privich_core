const DB_URL = "https://privich-b5b4f-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentRoom = 'general';
let chatUsername = 'Аноним';
let userColor = '#00ff00';
let eventSource = null; 

let decryptedChatKey = ""; 
let localMessages = {};

// Переменная для хранения ID редактируемого сообщения
let editingMessageId = null; 

const NEON_COLORS = [
    'hsl(120, 100%, 60%)', 'hsl(180, 100%, 50%)', 'hsl(200, 100%, 60%)', 
    'hsl(60, 100%, 50%)',  'hsl(36, 100%, 50%)',  'hsl(0, 100%, 60%)',   
    'hsl(280, 100%, 65%)', 'hsl(150, 100%, 55%)'  
];

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
    let utf8Text = unescape(encodeURIComponent(text));
    let result = "";
    for (let i = 0; i < utf8Text.length; i++) {
        result += String.fromCharCode(utf8Text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result); 
}

function xorDecipher(hash, key) {
    try {
        let text = atob(hash);
        let result = "";
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return decodeURIComponent(escape(result));
    } catch(e) { return "[Ошибка расшифровки]"; }
}

async function joinChat() {
    const nameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password').value.trim();
    
    if (!nameInput || !passwordInput) return alert('Введите ник и пароль!');
    
    try {
        const resAuth = await fetch(`${DB_URL}/users/${nameInput}.json`);
        const serverPasswordHash = await resAuth.json();
        
        if (!serverPasswordHash) return alert('Неверное имя пользователя или пароль');
        
        const clientPasswordHash = await sha256(passwordInput);
        if (clientPasswordHash !== serverPasswordHash) return alert('Неверное имя пользователя или пароль');
        
        const resVault = await fetch(`${DB_URL}/vault/${nameInput}.json`);
        const encryptedVaultData = await resVault.json();
        
        if (!encryptedVaultData) return alert('Сейф ключей не найден в базе данных vault!');
        
        decryptedChatKey = xorDecipher(encryptedVaultData, passwordInput);
        if (!decryptedChatKey.startsWith("OK_")) return alert('Ошибка дешифрования ключа чата!');
        
        decryptedChatKey = decryptedChatKey.replace("OK_", "");
        
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
    
    // Сбрасываем режим редактирования при смене комнаты
    cancelEdit();
    
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
        
        let decryptedText = xorDecipher(msgObj.text, decryptedChatKey);
        const msgDiv = document.createElement('div');
        
        // Красим рамку в зависимости от автора
        if (msgObj.user === chatUsername) {
            msgDiv.className = 'msg my-msg';
        } else {
            msgDiv.className = 'msg';
        }
        
        // Кнопки управления (показываем только для реальных СВОИХ сообщений)
        let actionsHtml = "";
        if (msgObj.user === chatUsername && !key.startsWith('temp_')) {
            actionsHtml = `
                <span class="msg-actions">
                    <span class="action-lnk edit-lnk" onclick="initEdit('${key}')">[e]</span>
                    <span class="action-lnk" onclick="deleteMessage('${key}')">[x]</span>
                </span>
            `;
        }

        msgDiv.innerHTML = `
            <span style="color: ${msgObj.color}; font-weight: bold;">${msgObj.user}:</span> 
            <span>${decryptedText}</span>
            <span class="time">${msgObj.time}</span>
            ${actionsHtml}
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
    
    eventSource = new EventSource(`${DB_URL}/rooms/${currentRoom}.json`, {
        headers: { "Accept": "text/event-stream" }
    });

    eventSource.addEventListener('put', (event) => {
        const payload = JSON.parse(event.data);
        
        if (payload.path === "/") {
            // Первая загрузка комнаты целиком
            localMessages = payload.data || {};
        } else if (payload.path === null || payload.data === null) {
            // Полная очистка всей комнаты
            if (payload.path === "/") localMessages = {};
        } else {
            // Точечное изменение или точечное УДАЛЕНИЕ одного сообщения (например, по пути /key)
            const msgKey = payload.path.replace('/', '');
            
            if (payload.data) {
                // Если данные прилетели (например, при редактировании)
                if (payload.data.text) {
                    // Если сервер прислал только измененный текст, сохраняем автора и время
                    if (localMessages[msgKey]) {
                        localMessages[msgKey].text = payload.data.text;
                    } else {
                        localMessages[msgKey] = payload.data;
                    }
                } else {
                    localMessages[msgKey] = payload.data;
                }
            } else {
                // Если данные НЕ прилетели (payload.data === null) — это точечное УДАЛЕНИЕ!
                // Стираем из локальной памяти строго это ОДНО сообщение
                delete localMessages[msgKey];
            }
        }
        renderChat();
    });

    eventSource.addEventListener('patch', (event) => {
        const payload = JSON.parse(event.data);
        
        if (payload.data) {
            if (payload.path === "/") {
                // Если прилетел массив новых сообщений
                Object.assign(localMessages, payload.data);
            } else {
                // Если прилетело изменение конкретного сообщения (например, путь "/-O3fgh...")
                const msgKey = payload.path.replace('/', '');
                
                if (localMessages[msgKey]) {
                    // Если это редактирование существующего сообщения, обновляем только текст!
                    // Благодаря этому имя автора и его цвет никогда не превратятся в undefined
                    localMessages[msgKey].text = payload.data.text;
                } else {
                    // Если это просто новое сообщение
                    localMessages[msgKey] = payload.data;
                }
            }
            renderChat();
        }
    });


}
// ОТПРАВКА ИЛИ РЕДАКТИРОВАНИЕ СООБЩЕНИЯ
function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    
    const encryptedText = xorCipher(text, decryptedChatKey);
    
    if (editingMessageId) {
        // --- РЕЖИМ РЕДАКТИРОВАНИЯ ---
        if (localMessages[editingMessageId]) {
            localMessages[editingMessageId].text = encryptedText;
        }
        renderChat(); 
        cancelEdit(); 
        
        // Отправляем на сервер обновленный текст, сохраняя автора и его цвет
        fetch(`${DB_URL}/rooms/${currentRoom}/${editingMessageId}.json`, {
            method: 'PATCH',
            body: JSON.stringify({ 
                text: encryptedText,
                user: chatUsername,
                color: userColor
            })
        });
    } else {

        // --- ОБЫЧНАЯ ОТПРАВКА ---
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const payload = {
            user: chatUsername,
            color: userColor,
            text: encryptedText,
            time: timeStr
        };

        const tempKey = 'temp_' + Date.now();
        localMessages[tempKey] = payload;
        
        renderChat(); 
        input.value = ''; 
        
        fetch(`${DB_URL}/rooms/${currentRoom}.json`, {
            method: 'POST',
            body: JSON.stringify(payload)
        }).catch(err => {
            delete localMessages[tempKey];
            renderChat();
            alert("Сообщение не ушло.");
        });
    }
}

// Запуск редактирования
function initEdit(key) {
    const msgObj = localMessages[key];
    if (!msgObj) return;
    
    editingMessageId = key;
    
    const input = document.getElementById('message-input');
    input.value = xorDecipher(msgObj.text, decryptedChatKey);
    input.focus();
    
    document.getElementById('send-button').innerText = "💾";
    input.style.borderColor = "#ffaa00";
}

function cancelEdit() {
    editingMessageId = null;
    const input = document.getElementById('message-input');
    input.value = "";
    input.style.borderColor = "#3a7ecc";
    document.getElementById('send-button').innerText = "➔";
}

function deleteMessage(key) {
    if (confirm("Удалить это сообщение для всех?")) {
        if (localMessages[key]) {
            delete localMessages[key];
        }
        renderChat();
        
        fetch(`${DB_URL}/rooms/${currentRoom}/${key}.json`, {
            method: 'DELETE'
        });
    }
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
