// НАСТРОЙКА ПРИВАТНОСТИ
// Кодовое слово для шифрования (должно быть одинаковым у вас и жены)
const PASSWORD = "MySuperSecretPassword123"; 

// Прямая ссылка на вашу азиатскую базу Firebase
const DB_URL = "https://firebasedatabase.app";

let currentRoom = 'general';
let chatUsername = 'Аноним';
let userColor = '#ffffff';
let cryptoKey;

// Встроенное шифрование браузера (генерация ключа)
async function initCrypto() {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(PASSWORD.padEnd(32, '0').slice(0,32)), 
        {name: "AES-CBC"}, false, ["encrypt", "decrypt"]
    );
    cryptoKey = keyMaterial;
}

// Простая функция XOR шифрования/дешифрования как резерв, если AES сбоит
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

function generateColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 80%, 65%)`;
}

function joinChat() {
    const nameInput = document.getElementById('username').value.trim();
    if (!nameInput) return alert('Введите имя!');
    
    chatUsername = nameInput;
    userColor = generateColor(chatUsername);
    currentRoom = document.getElementById('room-select').value;
    
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    document.getElementById('room-title').innerText = `Комната: ${currentRoom} (Вы: ${chatUsername})`;
    
    // Запускаем постоянное обновление чата каждые 2 секунды
    listenToRoom();
    setInterval(listenToRoom, 2000);
}

// Запрос обновлений из базы через стандартный fetch браузера
function listenToRoom() {
    fetch(`${DB_URL}/rooms/${currentRoom}.json`)
        .then(res => res.json())
        .then(data => {
            const chatWindow = document.getElementById('chat-window');
            chatWindow.innerHTML = '';
            
            if (!data) {
                chatWindow.innerHTML = '<div class="msg system">История чиста. Начните общение...</div>';
                return;
            }
            
            Object.values(data).forEach(msgObj => {
                // Расшифровываем текст
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
            chatWindow.scrollTop = chatWindow.scrollHeight;
        })
        .catch(err => console.error("Ошибка сети:", err));
}

// Отправка данных в базу через стандартный POST/PUSH запрос
function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    
    // Шифруем
    const encryptedText = xorCipher(text, PASSWORD);
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    
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
    })
    .catch(err => alert("Не удалось отправить сообщение"));
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

function clearChat() {
    if (confirm('Вы уверены, что хотите стереть ВСЮ переписку?')) {
        fetch(`${DB_URL}/rooms/${currentRoom}.json`, { method: 'DELETE' })
            .then(() => listenToRoom());
    }
}
