// НАСТРОЙКА КРИПТОГРАФИИ
// Измените этот ключ на свой собственный секретный пароль!
const SECRET_KEY = "MySuperSecretPassword123"; 

// НАСТРОЙКА FIREBASE
// Замените этот конфиг на данные из вашего аккаунта Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyDIDxe5e6J_Zx-dYvCOSbE8u_lJnX7y_48",
    authDomain: "privich-b5b4f.firebaseapp.com",
    databaseURL: "https://privich-b5b4f-default-rtdb.firebaseio.com",
    projectId: "privich-b5b4f",
    storageBucket: "privich-b5b4f.firebasestorage.app",
    messagingSenderId: "1047020946649",
    appId: "1:1047020946649:web:a6f1e95d9a7d3d3972aac8",
    measurementId: "G-D5H9WX1L9E"
};

// Инициализация
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

let currentRoom = 'general';
let username = 'Аноним';
let userColor = '#ffffff';

// Функция генерации уникального цвета на основе строки (имени)
function generateColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Генерируем сочные цвета, избегая слишком темных для черного фона
    const h = Math.abs(hash % 360);
    return `hsl(${h}, 80%, 65%)`;
}

// Вход в чат
function joinChat() {
    const nameInput = document.getElementById('username').value.trim();
    if (!nameInput) return alert('Введите имя!');
    
    username = nameInput;
    userColor = generateColor(username);
    currentRoom = document.getElementById('room-select').value;
    
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    document.getElementById('room-title').innerText = `Комната: ${currentRoom} (Вы: ${username})`;
    
    // Подключаемся к прослушиванию выбранной комнаты в Firebase
    listenToRoom();
}

// Слушаем изменения в комнате
function listenToRoom() {
    const roomRef = database.ref('rooms/' + currentRoom);
    
    roomRef.on('value', (snapshot) => {
        const chatWindow = document.getElementById('chat-window');
        chatWindow.innerHTML = ''; // Очищаем экран перед перерисовкой
        
        const data = snapshot.val();
        if (!data) {
            chatWindow.innerHTML = '<div class="msg system">История чиста. Начните общение...</div>';
            return;
        }
        
        // Рендерим сообщения
        Object.values(data).forEach(msgObj => {
            // Расшифровываем текст сообщения прямо в браузере
            let decryptedText = "";
            try {
                const bytes = CryptoJS.AES.decrypt(msgObj.text, SECRET_KEY);
                decryptedText = bytes.toString(CryptoJS.enc.Utf8);
            } catch (e) {
                decryptedText = "[Ошибка расшифровки / Ключ неверен]";
            }

            const msgDiv = document.createElement('div');
            msgDiv.className = 'msg';
            
            // Собираем структуру: <Ник (цветной)> текст [время]
            msgDiv.innerHTML = `
                <span style="color: ${msgObj.color}; font-weight: bold;">&lt;${msgObj.user}&gt;</span> 
                <span>${decryptedText}</span>
                <span class="time">${msgObj.time}</span>
            `;
            chatWindow.appendChild(msgDiv);
        });
        
        // Автоскролл вниз при новом сообщении
        chatWindow.scrollTop = chatWindow.scrollHeight;
    });
}

// Отправка сообщения
function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    
    // Шифруем текст сообщения перед отправкой на сервер
    const encryptedText = CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    
    // Записываем структуру в Firebase
    database.ref('rooms/' + currentRoom).push({
        user: username,
        color: userColor,
        text: encryptedText, // В облако улетает "каша" из букв
        time: timeStr
    });
    
    input.value = '';
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

// Функция полной очистки комнаты для обоих собеседников
function clearChat() {
    if (confirm('Вы уверены, что хотите стереть ВСЮ переписку в этой комнате?')) {
        database.ref('rooms/' + currentRoom).remove();
    }
}
