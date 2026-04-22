const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI).then(() => console.log("БАЗА ПОДКЛЮЧЕНА"));

// Обновленная схема игрока
const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    clickLevel: { type: Number, default: 1 }, // Уровень клика
    autoLevel: { type: Number, default: 0 },  // Уровень авто-майнера
    lastCheck: { type: Number, default: Date.now },
    lastClickTime: { type: Number, default: 0 } // Для анти-чита
});
const Player = mongoose.model('Player', playerSchema);

const State = mongoose.model('State', new mongoose.Schema({
    key: { type: String, default: "global" },
    globalMatter: { type: Number, default: 1000.0000 }
}));

async function getGlobalState() {
    let state = await State.findOne({ key: "global" });
    if (!state) state = await State.create({ key: "global" });
    return state;
}

// Расчет стоимости апгрейда: база * (1.5 ^ уровень)
const getUpgradeCost = (base, level) => base * Math.pow(1.5, level);

app.post('/api/click', async (req, res) => {
    try {
        const { userId, userName, action } = req.body;
        const now = Date.now();
        let player = await Player.findOne({ userId });
        let state = await getGlobalState();

        if (!player) {
            player = new Player({ userId, name: userName || 'Unknown', lastCheck: now });
        }

        // --- ЛОГИКА ПАССИВКИ ---
        const autoPower = player.autoLevel * 0.0001; // 0.0001 за каждый уровень в сек
        const passiveGain = ((now - player.lastCheck) / 1000) * autoPower;
        if (passiveGain > 0 && state.globalMatter >= passiveGain) {
            player.balance += passiveGain;
            state.globalMatter -= passiveGain;
        }
        player.lastCheck = now;

        // --- АНТИ-ЧИТ + КЛИК ---
        if (action === 'click') {
            // Если между кликами меньше 80мс — игнорируем (защита от быстрых кликеров)
            if (now - player.lastClickTime > 80) {
                const clickPower = 0.0001 + (player.clickLevel - 1) * 0.0001; // Линейный рост
                if (state.globalMatter >= clickPower) {
                    player.balance += clickPower;
                    state.globalMatter -= clickPower;
                    player.lastClickTime = now;
                }
            } else {
                console.log(`Подозрение на читы у ${player.name}`);
            }
        }

        await player.save();
        await state.save();

        res.json({ 
            balance: player.balance, 
            globalMatter: state.globalMatter, 
            clickLevel: player.clickLevel,
            autoLevel: player.autoLevel,
            nextClickCost: getUpgradeCost(0.0050, player.clickLevel),
            nextAutoCost: getUpgradeCost(0.0100, player.autoLevel + 1)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upgrade', async (req, res) => {
    const { userId, type } = req.body;
    const player = await Player.findOne({ userId });
    if (!player) return res.json({ success: false });

    let cost = 0;
    if (type === 'click') {
        cost = getUpgradeCost(0.0050, player.clickLevel);
        if (player.balance >= cost) {
            player.balance -= cost;
            player.clickLevel += 1;
        } else return res.json({ success: false, message: "Недостаточно материи" });
    } else if (type === 'auto') {
        cost = getUpgradeCost(0.0100, player.autoLevel + 1);
        if (player.balance >= cost) {
            player.balance -= cost;
            player.autoLevel += 1;
        } else return res.json({ success: false, message: "Недостаточно материи" });
    }

    await player.save();
    res.json({ success: true, balance: player.balance });
});

app.get('/api/leaderboard', async (req, res) => {
