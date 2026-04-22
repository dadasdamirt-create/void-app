const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI).then(() => console.log("БАЗА ПОДКЛЮЧЕНА"));

// ОБНОВЛЕННАЯ МОДЕЛЬ
const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    clickLevel: { type: Number, default: 1 },
    autoLevel: { type: Number, default: 0 },
    lastCheck: { type: Number, default: Date.now },
    lastClickTime: { type: Number, default: 0 },
    // Поля для квестов и бонусов
    streak: { type: Number, default: 0 },
    lastBonusClaim: { type: Date, default: null },
    completedQuests: { type: [String], default: [] }
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

const getUpgradeCost = (base, level) => base * Math.pow(1.5, level);

// --- API ДЛЯ КЛИКОВ И СИНХРОНИЗАЦИИ ---
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

        const autoPower = player.autoLevel * 0.0001; 
        const passiveGain = ((now - player.lastCheck) / 1000) * autoPower;
        if (passiveGain > 0 && state.globalMatter >= passiveGain) {
            player.balance += passiveGain;
            state.globalMatter -= passiveGain;
        }
        player.lastCheck = now;

        if (action === 'click' && (now - player.lastClickTime >= 100)) {
            const clickPower = 0.0001 + (player.clickLevel - 1) * 0.0001;
            if (state.globalMatter >= clickPower) {
                player.balance += clickPower;
                state.globalMatter -= clickPower;
                player.lastClickTime = now;
            }
        }

        await player.save();
        await state.save();
        res.json({ balance: player.balance, globalMatter: state.globalMatter, autoPower, nextClickCost: getUpgradeCost(0.0050, player.clickLevel - 1), nextAutoCost: getUpgradeCost(0.0100, player.autoLevel) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- API: ЕЖЕДНЕВНЫЙ БОНУС ---
app.post('/api/daily-bonus', async (req, res) => {
    const { userId } = req.body;
    const player = await Player.findOne({ userId });
    if (!player) return res.json({ success: false });

    const now = new Date();
    const lastClaim = player.lastBonusClaim ? new Date(player.lastBonusClaim) : null;
    
    // Проверка: прошел ли день?
    const isToday = lastClaim && lastClaim.toDateString() === now.toDateString();
    if (isToday) return res.json({ success: false, message: "Приходи завтра!" });

    // Проверка серии (было ли вчера?)
    const oneDayInMs = 24 * 60 * 60 * 1000;
    const isConsecutive = lastClaim && (now - lastClaim) < (oneDayInMs * 2);

    player.streak = isConsecutive ? (player.streak + 1) : 1;
    if (player.streak > 7) player.streak = 1; // Цикл 7 дней

    const bonusAmount = 0.0010 * player.streak; // Бонус растет с каждым днем
    player.balance += bonusAmount;
    player.lastBonusClaim = now;
    
    await player.save();
    res.json({ success: true, balance: player.balance, streak: player.streak, amount: bonusAmount });
});

// --- API: КВЕСТЫ ---
app.post('/api/complete-quest', async (req, res) => {
    const { userId, questId } = req.body;
    const player = await Player.findOne({ userId });
    if (!player || player.completedQuests.includes(questId)) return res.json({ success: false, message: "Уже выполнено" });

    const rewards = { "sub_tg": 0.0500, "invite_3": 0.1500 }; // Награды за квесты
    const reward = rewards[questId];

    if (reward) {
        player.balance += reward;
        player.completedQuests.push(questId);
        await player.save();
        return res.json({ success: true, balance: player.balance });
    }
    res.json({ success: false });
});

app.get('/api/leaderboard', async (req, res) => {
    const leaderboard = await Player.find().sort({ balance: -1 }).limit(10);
    res.json(leaderboard);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server started`));
