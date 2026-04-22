const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. ПОДКЛЮЧЕНИЕ К БАЗЕ
// Мы берем ссылку из переменных окружения Render для безопасности
const MONGO_URI = process.env.MONGO_URI; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("БАЗА ДАННЫХ ПОДКЛЮЧЕНА"))
    .catch(err => console.error("ОШИБКА БАЗЫ:", err));

// 2. ОПИСАНИЕ МОДЕЛИ ИГРОКА
const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    clickPower: { type: Number, default: 0.0001 },
    autoPower: { type: Number, default: 0 },
    lastCheck: { type: Number, default: Date.now }
});
const Player = mongoose.model('Player', playerSchema);

// 3. СХЕМА ДЛЯ ГЛОБАЛЬНОЙ МАТЕРИИ
const stateSchema = new mongoose.Schema({
    key: { type: String, default: "global" },
    globalMatter: { type: Number, default: 1000.0000 }
});
const State = mongoose.model('State', stateSchema);

async function getGlobalState() {
    let state = await State.findOne({ key: "global" });
    if (!state) state = await State.create({ key: "global" });
    return state;
}

// 4. API ДЛЯ КЛИКОВ
app.post('/api/click', async (req, res) => {
    try {
        const { userId, userName, action, referrerId } = req.body;
        const now = Date.now();

        let player = await Player.findOne({ userId });
        let state = await getGlobalState();

        if (!player) {
            player = new Player({ userId, name: userName || 'Unknown', lastCheck: now });
            if (referrerId && referrerId !== userId) {
                await Player.updateOne({ userId: referrerId }, { $inc: { balance: 0.0100 } });
                state.globalMatter -= 0.0100;
            }
        }

        const timePassed = (now - player.lastCheck) / 1000;
        const passiveGain = timePassed * player.autoPower;
        
        if (passiveGain > 0 && state.globalMatter >= passiveGain) {
            player.balance += passiveGain;
            state.globalMatter -= passiveGain;
        }
        player.lastCheck = now;

        if (action === 'click') {
            if (state.globalMatter >= player.clickPower) {
                player.balance += player.clickPower;
                state.globalMatter -= player.clickPower;
            }
        }

        await player.save();
        await state.save();

        res.json({ balance: player.balance, globalMatter: state.globalMatter, autoPower: player.autoPower });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. API ДЛЯ АПГРЕЙДОВ
app.post('/api/upgrade', async (req, res) => {
    try {
        const { userId, type } = req.body;
        const player = await Player.findOne({ userId });
        if (!player) return res.json({ success: false });

        const costs = { click: 0.0050, auto: 0.0100 };
        const cost = costs[type];

        if (player.balance >= cost) {
            player.balance -= cost;
            if (type === 'click') player.clickPower *= 2;
            if (type === 'auto') player.autoPower += 0.0001;
            await player.save();
            res.json({ success: true, balance: player.balance });
        } else {
            res.json({ success: false, message: "Недостаточно материи" });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. ЛИДЕРБОРД
app.get('/api/leaderboard', async (req, res) => {
    const leaderboard = await Player.find().sort({ balance: -1 }).limit(10);
    res.json(leaderboard);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`));
