const express = require('express');
const path = require('path');
const fs = require('fs'); // Модуль для работы с файлами
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = './database.json';

// Загружаем данные из файла при старте сервера
let players = {};
if (fs.existsSync(DB_FILE)) {
    players = JSON.parse(fs.readFileSync(DB_FILE));
}

// Функция для сохранения данных в файл
function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(players, null, 2));
}

app.post('/api/click', (req, res) => {
    const { userId, userName, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'No user ID' });

    if (!players[userId]) {
        players[userId] = { balance: 0, name: userName || 'Unknown' };
    }

    // Если это не просто загрузка, а клик — добавляем очки
    if (action !== 'load') {
        players[userId].balance += 0.0001;
        saveDB(); // Сохраняем в файл после каждого клика
    }

    res.json({ balance: players[userId].balance });
});
// Маршрут для получения списка лидеров
app.get('/api/leaderboard', (req, res) => {
    // Превращаем объект игроков в массив, сортируем по балансу и берем топ-10
    const leaderboard = Object.values(players)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);
    
    res.json(leaderboard);
});
// Используем порт от Render (process.env.PORT) или 3000 для локалки
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`VOID Server is running on port ${PORT}`);
});
});
// В начале server.js, где загружаем данные:
let globalMatter = 1000.0000; // Весь запас Пустоты

// Внутри app.post('/api/click', ...):
app.post('/api/click', (req, res) => {
    const { userId, userName, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'No user ID' });

    if (!players[userId]) {
        players[userId] = { balance: 0, name: userName || 'Unknown' };
    }

    if (action !== 'load') {
        const reward = 0.0001;
        // Проверяем, осталось ли что-то в глобальном запасе
        if (globalMatter >= reward) {
            players[userId].balance += reward;
            globalMatter -= reward; // Уменьшаем общий пул
            saveDB();
        }
    }

    // Возвращаем и личный баланс, и остаток в мире
    res.json({ 
        balance: players[userId].balance,
        globalMatter: globalMatter 
    });
});