const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = './database.json';
let players = {};
let globalMatter = 1000.0000;

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        players = data.players || {};
        globalMatter = data.globalMatter !== undefined ? data.globalMatter : 1000.0000;
    } catch (e) { console.log("DB Error"); }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ players, globalMatter }, null, 2));
}

app.post('/api/click', (req, res) => {
    const { userId, userName, action } = req.body;
    if (!players[userId]) {
        players[userId] = { balance: 0, name: userName || 'Unknown', clickPower: 0.0001 };
    }

    if (action === 'click') {
        const reward = players[userId].clickPower || 0.0001;
        if (globalMatter >= reward) {
            players[userId].balance += reward;
            globalMatter -= reward;
            saveDB();
        }
    }
    res.json({ balance: players[userId].balance, globalMatter, clickPower: players[userId].clickPower });
});

// Новый маршрут для покупки улучшений
app.post('/api/upgrade', (req, res) => {
    const { userId } = req.body;
    const cost = 0.0050; // Стоимость улучшения

    if (players[userId] && players[userId].balance >= cost) {
        players[userId].balance -= cost;
        players[userId].clickPower = (players[userId].clickPower || 0.0001) * 2;
        saveDB();
        res.json({ success: true, balance: players[userId].balance, clickPower: players[userId].clickPower });
    } else {
        res.json({ success: false, message: "Недостаточно материи" });
    }
});

app.get('/api/leaderboard', (req, res) => {
    const leaderboard = Object.values(players).sort((a, b) => b.balance - a.balance).slice(0, 10);
    res.json(leaderboard);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`VOID Server running on port ${PORT}`);
});
