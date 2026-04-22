const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к MongoDB через переменную Render
const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI).then(() => console.log("БАЗА ПОДКЛЮЧЕНА"));

// Схема игрока
const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    totalExtracted: { type: Number, default: 0 }, // Для опыта
    clickLevel: { type: Number, default: 1 },
    autoLevel: { type: Number, default: 0 },
    lastCheck: { type: Number, default: Date.now },
    lastClickTime: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    lastBonusClaim: { type: Date, default: null },
    completedQuests: { type: [String], default: [] },
    referralCount: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// Схема глобального состояния
const State = mongoose.model('State', new mongoose.Schema({
    key: { type: String, default: "global" },
    globalMatter: { type: Number, default: 1000.0000 }
}));

async function getGlobalState() {
    let state = await State.findOne({ key: "global" });
    if (!state) state = await State.create({ key: "global" });
    return state;
}

// Формулы
const getUpgradeCost = (base, level) => base * Math.pow(1.5, level);
const getPlayerLevel = (total) => Math.floor(total / 0.5) + 1; // Уровень каждые 0.5 материи

// --- API ЗАПРОСЫ ---

app.post('/api/click', async (req, res) => {
    try {
        const { userId, userName, action, referrerId } = req.body;
        const now = Date.now();
        let player = await Player.findOne({ userId });
        let state = await getGlobalState();

        if (!player) {
            player = new Player({ userId, name: userName || 'Unknown', lastCheck: now });
            if (referrerId && referrerId !== userId) {
                const ref = await Player.findOne({ userId: referrerId });
                if (ref) { ref.balance += 0.01; ref.referralCount += 1; await ref.save(); state.globalMatter -= 0.01; }
            }
        }

        const level = getPlayerLevel(player.totalExtracted);
        const levelMultiplier = 1 + (level - 1) * 0.01; // +1% за уровень

        // Пассивный доход
        const autoPower = player.autoLevel * 0.0001 * levelMultiplier; 
        const passiveGain = ((now - player.lastCheck) / 1000) * autoPower;
        
        if (passiveGain > 0 && state.globalMatter >= passiveGain) {
            player.balance += passiveGain;
            player.totalExtracted += passiveGain;
            state.globalMatter -= passiveGain;
        }
        player.lastCheck = now;

        // Клик с анти-читом
        if (action === 'click' && (now - player.lastClickTime >= 100)) {
            const clickPower = (0.0001 + (player.clickLevel - 1) * 0.0001) * levelMultiplier;
            if (state.globalMatter >= clickPower) {
                player.balance += clickPower;
                player.totalExtracted += clickPower;
                state.globalMatter -= clickPower;
                player.lastClickTime = now;
            }
        }

        await player.save();
        await state.save();
        res.json({ 
            balance: player.balance, 
            globalMatter: state.globalMatter, 
            autoPower,
            level,
            totalExtracted: player.totalExtracted,
            referralCount: player.referralCount,
            nextClickCost: getUpgradeCost(0.005, player.clickLevel - 1), 
            nextAutoCost: getUpgradeCost(0.01, player.autoLevel) 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upgrade', async (req, res) => {
    try {
        const { userId, type } = req.body;
        const player = await Player.findOne({ userId });
        if (!player) return res.json({ success: false });

        let cost = (type === 'click') ? getUpgradeCost(0.005, player.clickLevel - 1) : getUpgradeCost(0.01, player.autoLevel);
        
        if (player.balance >= cost) {
            player.balance -= cost;
            if (type === 'click') player.clickLevel += 1; else player.autoLevel += 1;
            await player.save();
            res.json({ success: true, balance: player.balance });
        } else res.json({ success: false, message: "Недостаточно материи" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/daily-bonus', async (req, res) => {
    try {
        const { userId } = req.body;
        const player = await Player.findOne({ userId });
        const now = new Date();
        const lastClaim = player.lastBonusClaim ? new Date(player.lastBonusClaim) : null;
        
        if (lastClaim && lastClaim.toDateString() === now.toDateString()) {
            return res.json({ success: false, message: "Приходи завтра!" });
        }

        player.streak = (lastClaim && (now - lastClaim) < 48 * 3600000) ? player.streak + 1 : 1;
        const bonus = 0.001 * player.streak;
        player.balance += bonus;
        player.lastBonusClaim = now;
        await player.save();
        res.json({ success: true, balance: player.balance, amount: bonus });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/complete-quest', async (req, res) => {
    try {
        const { userId, questId } = req.body;
        const player = await Player.findOne({ userId });
        if (player.completedQuests.includes(questId)) return res.json({ success: false, message: "Выполнено" });

        if (questId === 'invite_3' && player.referralCount >= 3) {
            player.balance += 0.15; 
            player.completedQuests.push(questId); 
            await player.save();
            return res.json({ success: true });
        }
        res.json({ success: false, message: "Условия не выполнены" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaders = await Player.find().sort({ balance: -1 }).limit(10);
        res.json(leaders);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server live on ${PORT}`));
