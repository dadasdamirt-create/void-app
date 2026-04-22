const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = './database.json';
let players = {};
let globalMatter = 1000.0000;

// Загрузка базы данных при старте
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        players = data.players || {};
        globalMatter = data.globalMatter !== undefined ? data.globalMatter : 1000.0000;
    } catch (e) {
        console.log("Ошибка чтения базы, создаем новую");
    }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ players, globalMatter }, null, 2));
}

// API для кликов и загрузки
app.post('/api/click', (req, res) => {
    const { userId, userName, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'No user ID' });

    if (!players[userId]) {
        players[userId] = { balance: 0, name: userName || 'Unknown' };
    }

    if (action === 'click') {
        const reward = 0.0001;
        if (globalMatter >= reward) {
            players[userId].balance += reward;
            globalMatter -= reward;
            saveDB();
        }
    }

    res.json({ 
        balance: players[userId].balance, 
        globalMatter: globalMatter 
    });
});

// API для таблицы лидеров
app.get('/api/leaderboard', (req, res) => {
    const leaderboard = Object.values(players)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);
    res.json(leaderboard);
});

// Запуск сервера на порту, который выдает Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`VOID Server is running on port ${PORT}`);
});
