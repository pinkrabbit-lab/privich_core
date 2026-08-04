// НАСТРОЙКА ПРИВАТНОСТИ
// Кодовое слово для шифрования (должно быть одинаковым у вас и жены)
const PASSWORD = "MySuperSecretPassword123"; 

// Прямая ссылка на вашу азиатскую базу Firebase
const DB_URL = "https://privich-b5b4f-default-rtdb.asia-southeast1.firebasedatabase.app/";

let currentRoom = 'general';
let chatUsername = 'Аноним';
let userColor = '#00ff00';
let chatInterval = null;

// Палитра ярких неоновых цветов (киберпанк/матрица стиль), исключая розовый повтор
const NEON_COLORS = [
    'hsl(120, 100%, 60%)', // Ярко-зеленый
    'hsl(180, 100%, 50%)', // Циан / Голубой
    'hsl(200, 100%, 60%)', // Неоново-синий
    'hsl(60, 100%, 50%)',  // Желтый
    'hsl(36, 100%, 50%)',  // Оранжевый
    'hsl(0, 100%, 60%)',   // Красный
    'hsl(280, 100%, 65%)', // Фиолетовый
    'hsl(150, 100%, 55%)'  // Мятный
];

// Улучшенный генератор уникального незанятого цвета
async function allocateUserColor(room, name) {
    try {
        // Проверяем, какие цвета заняты в этой комнате
        const res = await fetch(`${DB_URL}/colors/${room}.json`);
        const takenColors = await res.json() || {};
        
        // Если этот пользователь уже занимал цвет ранее, возвращаем его
        if (takenColors[name]) return takenColors[name];
        
        const usedValues = Object.values(takenColors);
        // Фильтруем палитру, убирая уже занятые цвета
        let availableColors = NEON_COLORS.filter(c => !usedValues.includes(c));
        
        // Если все цвета заняты, берем любой случайный
        if (availableColors.length === 0) availableColors = NEON_COLORS;
        
        const randomColor = availableColors[Math.floor(Math.random() * availableColors.length)];
        
        // Записываем наш выбор в базу, чтобы забронировать его
        await fetch(`${DB_URL}/colors/${room}/${name}.json`, {
            method: 'PUT',
            body: JSON.stringify(randomColor)
        });
        
        return randomColor;
    } catch (e) {
        // Если сеть лагает, отдаем случайный из палитры
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
    currentRoom = document.getElementById('room-select').value;
    
    // Получаем уникальный цвет
    userColor = await allocateUserColor(currentRoom, chatUsername);
    
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    
    updateHeaderUI();
    startChatSync();
}

// Обновление вкладок в шапке
function updateHeaderUI() {
    document.getElementById('user-info').innerHTML = `Вы: <span style="color: ${userColor}; font-weight:bold;">&lt;${chatUsername}&gt;</span>`;
    
    // Сбрасываем активность всех вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active-tab'));
    
    // Подсвечиваем текущую вкладку
    const activeTab = document.getElementById(`tab-${currentRoom}`);
    if (activeTab) activeTab.classList.add('active-tab');
}

// Переключение комнат по кнопкам-закладкам
async function switchRoom(newRoom) {
    if (currentRoom === newRoom) return;
    currentRoom = newRoom;
    
    // Перерегистрируем цвет для новой комнаты
    userColor = await allocateUserColor(currentRoom, chatUsername);
    
    updateHeaderUI();
    // Мгновенно перерисовываем экран под новую комнату
    listenToRoom();
}

function startChatSync() {
    if (chatInterval) clearInterval(chatInterval);
    listenToRoom();
    chatInterval = setInterval(listenToRoom, 2000);
}

function listenToRoom() {
    fetch(`${DB_URL}/rooms/${currentRoom}.json`)
        .then(res => res.json())
        .then(data => {
            const chatWindow = document.getElementById('chat-window');
            // Запоминаем, был ли скролл в самом низу до обновления
            const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
            
            chatWindow.innerHTML = '';
            
            if (!data) {
                chatWindow.innerHTML = '<div class="msg system">История чиста. Начните общение...</div>';
                return;
            }
            
            Object.values(data).forEach(msgObj => {
                let decryptedText = xorDecipher(msgObj.text, PASSWORD);
                const msgDiv = document.createElement('div');
                msgDiv.className = 'msg';
                msgDiv.innerHTML = `
                    <span style="color: ${msgObj.color}; font-weight: bold;">&lt;${msgObj.user}&gt;</span> 
                    <span>${decryptedText}</span>
                    <span class="time">${msgObj.time}</span>
                `;
                chatWindow.appendChild(msgDiv);
            });
            
            if (isScrolledToBottom) {
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        })
        .catch(err => console.error("Ошибка обновления чата"));
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
        listenToRoom();
    });
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

function clearChat() {
    if (confirm('Вы уверены, что хотите полностью стереть переписку в этой вкладке?')) {
        fetch(`${DB_URL}/rooms/${currentRoom}.json`, { method: 'DELETE' })
            .then(() => {
                // Также очищаем занятые цвета для этой комнаты
                fetch(`${DB_URL}/colors/${currentRoom}.json`, { method: 'DELETE' });
                listenToRoom();
            });
    }
}

