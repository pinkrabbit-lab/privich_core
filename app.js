const PASSWORD = "MySuperSecretPassword123"; 
const DB_URL = "https://privich-b5b4f-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentRoom = 'general';
let chatUsername = 'Аноним';
let userColor = '#00ff00';
let eventSource = null; 
// Локальное хранилище сообщений текущей комнаты для плавной отрисовки
let localMessages = {};

const NEON_COLORS = [
    'hsl(120, 100%, 60%)', 'hsl(180, 100%, 50%)', 'hsl(200, 100%, 60%)', 
    'hsl(60, 100%, 50%)',  'hsl(36, 100%, 50%)',  'hsl(0, 100%, 60%)',   
    'hsl(280, 100%, 65%)', 'hsl(150, 100%, 55%)'  
];

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
    if (!nameInput) return alert('Введите имя!');
    
    chatUsername = nameInput;
    currentRoom = 'general';
    
    userColor = await allocateUserColor(currentRoom, chatUsername);
    
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    
    updateHeaderUI();
    startChatSync(); 
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

// Рендеринг сообщений из локального хранилища на экран
function renderChat() {
    const chatWindow = document.getElementById('chat-window');
    const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
    
    chatWindow.innerHTML = '';

    const keys = Object.keys(localMessages);
    if (keys.length === 0) {
        chatWindow.innerHTML = '<div class="msg system">История чиста. Начните общение...</div>';
        return;
    }

    // Сортируем и выводим сообщения на экран
    keys.forEach(key => {
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

// УМНАЯ СИНХРОНИЗАЦИЯ С ОБРАБОТКОЙ ЖИВЫХ ИВЕНТОВ
function startChatSync() {
    if (eventSource) eventSource.close();
    
    localMessages = {}; // Очищаем старую комнату в памяти
    const chatWindow = document.getElementById('chat-window');
    chatWindow.innerHTML = '<div class="msg system">Подключение к комнате...</div>';

    eventSource = new EventSource(`${DB_URL}/rooms/${currentRoom}.json`, {
        headers: { "Accept": "text/event-stream" }
    });

    // Ивент 'put' срабатывает при первой загрузке или при полной очистке базы
    eventSource.addEventListener('put', (event) => {
        const payload = JSON.parse(event.data);
        
        if (payload.path === "/") {
            // Загрузилась вся база данных комнаты целиком
            localMessages = payload.data || {};
        } else if (payload.path === null || payload.data === null) {
            // Базу очистили
            localMessages = {};
        } else {
            // Изменилось конкретное сообщение по пути (например /key)
            const msgKey = payload.path.replace('/', '');
            if (payload.data) {
                localMessages[msgKey] = payload.data;
            } else {
                delete localMessages[msgKey];
            }
        }
        renderChat();
    });

    // Ивент 'patch' срабатывает, когда кто-то отправляет одно НОВОЕ сообщение
    eventSource.addEventListener('patch', (event) => {
        const payload = JSON.parse(event.data);
        
        if (payload.data) {
            // Добавляем новые сообщения в наше локальное хранилище памяти
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
    
    fetch(`${DB_URL}/rooms/${currentRoom}.json`, {
        method: 'POST',
        body: JSON.stringify(payload)
    })
    .then(() => {
        input.value = '';
    });
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
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

