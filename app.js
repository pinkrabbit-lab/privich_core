// НАСТРОЙКА ПРИВАТНОСТИ
// Кодовое слово для шифрования (должно быть одинаковым у вас и жены)
const PASSWORD = "MySuperSecretPassword123"; 

// Прямая ссылка на вашу азиатскую базу Firebase
const DB_URL = "https://privich-b5b4f-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentRoom = 'general';
let chatUsername = 'Аноним';
let userColor = '#00ff00';
let eventSource = null; // Переменная для хранения открытого канала связи

// Палитра ярких неоновых цветов (киберпанк/матрица стиль)
const NEON_COLORS = [
    'hsl(120, 100%, 60%)', 'hsl(180, 100%, 50%)', 'hsl(200, 100%, 60%)', 
    'hsl(60, 100%, 50%)',  'hsl(36, 100%, 50%)',  'hsl(0, 100%, 60%)',   
    'hsl(280, 100%, 65%)', 'hsl(150, 100%, 55%)'  
];

// Улучшенный генератор уникального незанятого цвета
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
    startChatSync(); // Запускаем умную подписку
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
    startChatSync(); // Переподключаем канал связи на новую комнату
}

// УМНАЯ ПОДПИСКА НА ОБНОВЛЕНИЯ (БЕЗ ТАЙМЕРОВ И ПИНГОВ)
function startChatSync() {
    // Если канал уже был открыт (например, при смене комнаты), закрываем старый
    if (eventSource) {
        eventSource.close();
    }

    const chatWindow = document.getElementById('chat-window');
    chatWindow.innerHTML = '<div class="msg system">Подключение к комнате...</div>';

    // Открываем постоянное прямое соединение с базой данных Firebase
    // Флаг в конце ссылки говорит серверу: держи соединение открытым и присылай ивенты (SSE)
    eventSource = new EventSource(`${DB_URL}/rooms/${currentRoom}.json`, {
        headers: { "Accept": "text/event-stream" }
    });

    // Этот код сработает ТОЛЬКО когда в базе данных изменятся или добавятся сообщения
    eventSource.addEventListener('put', (event) => {
        const payload = JSON.parse(event.data);
        
        // Запоминаем, был ли скролл внизу
        const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
        chatWindow.innerHTML = '';

        // Если в комнате вообще нет сообщений
        if (!payload || !payload.data) {
            chatWindow.innerHTML = '<div class="msg system">История чиста. Начните общение...</div>';
            return;
        }

        // В зависимости от того, обновилась вся комната или прилетело одно сообщение, Firebase присылает разную структуру
        const messages = (event.target.url.includes(currentRoom) && payload.path === "/") ? payload.data : payload.data;
        
        if (messages) {
            Object.values(messages).forEach(msgObj => {
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
        }

        if (isScrolledToBottom) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
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
    
    // Отправляем сообщение обычным запросом. Поток eventSource сам поймает его и выведет на экран
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
            });
    }
}

