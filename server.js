const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI).then(() => console.log("БАЗА ПОДКЛЮЧЕНА"));

// МОДЕЛЬ ИГРОКА
const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    clickLevel: { type: Number, default: 1 },
    autoLevel: { type: Number, default: 0 },
    lastCheck: { type: Number, default: Date.now },
    lastClickTime: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    lastBonusClaim: { type: Date, default: null },
    completedQuests: { type: [String], default: [] },
    referralCount: { type: Number, default: 0 } // Счетчик рефералов
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

// Функция расчета стоимости (важно: должна быть одинаковой везде)
const getUpgradeCost = (base, level) => base * Math.pow(1.5, level);

app.post('/api/click', async (req, res) => {
    try {
        const { userId, userName, action, referrerId } = req.body;
        const now = Date.now();
        let player = await Player.findOne({ userId });
        let state = await getGlobalState();

        if (!player) {
            player = new Player({ userId, name: userName || 'Unknown', lastCheck: now });
            // Если пришел по рефералке
            if (referrerId && referrerId !== userId) {
                const referrer = await Player.findOne({ userId: referrerId });
                if (referrer) {
                    referrer.balance += 0.0100;
                    referrer.referralCount += 1; // Увеличиваем счетчик у того, кто пригласил
                    await referrer.save();
                    state.globalMatter -= 0.0100;
                }
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
        res.json({ 
            balance: player.balance, 
            globalMatter: state.globalMatter, 
            autoPower, 
            clickLevel: player.clickLevel,
            autoLevel: player.autoLevel,
            referralCount: player.referralCount,
            nextClickCost: getUpgradeCost(0.0050, player.clickLevel - 1), 
            nextAutoCost: getUpgradeCost(0.0100, player.autoLevel) 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ИСПРАВЛЕННЫЙ АПГРЕЙД
app.post('/api/upgrade', async (req, res) => {
    const { userId, type } = req.body;
    const player = await Player.findOne({ userId });
    if (!player) return res.json({ success: false });

    let cost = 0;
    if (type === 'click') {
        cost = getUpgradeCost(0.0050, player.clickLevel - 1);
        if (player.balance >= cost) {
            player.balance -= cost;
            player.clickLevel += 1;
        } else return res.json({ success: false, message: "Недостаточно материи" });
    } else if (type === 'auto') {
        cost = getUpgradeCost(0.0100, player.autoLevel);
        if (player.balance >= cost) {
            player.balance -= cost;
            player.autoLevel += 1;
        } else return res.json({ success: false, message: "Недостаточно материи" });
    }

    await player.save();
    res.json({ success: true, balance: player.balance });
});

app.post('/api/daily-bonus', async (req, res) => {
    const { userId } = req.body;
    const player = await Player.findOne({ userId });
    if (!player) return res.json({ success: false });
    const now = new Date();
    const lastClaim = player.lastBonusClaim ? new Date(player.lastBonusClaim) : null;
    if (lastClaim && lastClaim.toDateString() === now.toDateString()) return res.json({ success: false, message: "Приходи завтра!" });
    const isConsecutive = lastClaim && (now - lastClaim) < (48 * 60 * 60 * 1000);
    player.streak = isConsecutive ? (player.streak + 1) : 1;
    if (player.streak > 7) player.streak = 1;
    const bonusAmount = 0.0010 * player.streak;
    player.balance += bonusAmount;
    player.lastBonusClaim = now;
    await player.save();
    res.json({ success: true, balance: player.balance, streak: player.streak, amount: bonusAmount });
});

// КВЕСТ НА ИНВАЙТ
app.post('/api/complete-quest', async (req, res) => {
    const { userId, questId } = req.body;
    const player = await Player.findOne({ userId });
    if (!player || player.completedQuests.includes(questId)) return res.json({ success: false, message: "Уже выполнено" });

    if (questId === 'invite_3') {
        if (player.referralCount >= 3) {
            player.balance += 0.1500;
            player.completedQuests.push(questId);
            await player.save();
            return res.json({ success: true, balance: player.balance });
        } else {
            return res.json({ success: false, message: `Нужно 3 друга, у тебя: ${player.referralCount}` });
        }
    }

    const rewards = { "sub_tg": 0.0500 };
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
