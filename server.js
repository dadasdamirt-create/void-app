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

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify({ players, globalMatter }, null, 2)); }

app.post('/api/click', (req, res) => {
    const { userId, userName, action } = req.body;
    const now = Date.now();

    if (!players[userId]) {
        players[userId] = { balance: 0, name: userName || 'Unknown', clickPower: 0.0001, autoPower: 0, lastCheck: now };
    }

    // Считаем пассивный доход с момента последнего запроса
    const timePassed = (now - (players[userId].lastCheck || now)) / 1000; // в секундах
    const passiveGain = timePassed * (players[userId].autoPower || 0);
    
    if (passiveGain > 0 && globalMatter >= passiveGain) {
        players[userId].balance += passiveGain;
        globalMatter -= passiveGain;
    }
    players[userId].lastCheck = now;

    if (action === 'click') {
        const reward = players[userId].clickPower || 0.0001;
        if (globalMatter >= reward) {
            players[userId].balance += reward;
            globalMatter -= reward;
        }
    }
    saveDB();
    res.json({ balance: players[userId].balance, globalMatter, autoPower: players[userId].autoPower });
});

app.post('/api/upgrade', (req, res) => {
    const { userId, type } = req.body;
    const player = players[userId];
    if (!player) return res.json({ success: false });

    if (type === 'click' && player.balance >= 0.0050) {
        player.balance -= 0.0050;
        player.clickPower *= 2;
        saveDB();
        return res.json({ success: true, balance: player.balance });
    } 
    
    if (type === 'auto' && player.balance >= 0.0100) {
        player.balance -= 0.0100;
        player.autoPower = (player.autoPower || 0) + 0.0001; // +0.0001 в секунду
        saveDB();
        return res.json({ success: true, balance: player.balance });
    }

    res.json({ success: false, message: "Недостаточно материи" });
});

app.get('/api/leaderboard', (req, res) => {
    const leaderboard = Object.values(players).sort((a, b) => b.balance - a.balance).slice(0, 10);
    res.json(leaderboard);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log(`Server running on ${PORT}`); });
