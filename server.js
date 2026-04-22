const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log("БАЗА ПОДКЛЮЧЕНА"))
    .catch(err => console.error("ОШИБКА МОНГО:", err));

const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    clickLevel: { type: Number, default: 1 },
    autoLevel: { type: Number, default: 0 },
    lastCheck: { type: Number, default: Date.now },
    lastClickTime: { type: Number, default: 0 }
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

// Формула цены: базовая цена * 1.5 в степени (уровень)
const getUpgradeCost = (base, level) => base * Math.pow(1.5, level);

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
        const timeDiff = (now - player.lastCheck) / 1000;
        const passiveGain = timeDiff * autoPower;

        if (passiveGain > 0 && state.globalMatter >= passiveGain) {
            player.balance += passiveGain;
            state.globalMatter -= passiveGain;
        }
        player.lastCheck = now;

        if (action === 'click') {
            // АНТИ-ЧИТ: не чаще 10 кликов в секунду (100мс)
            if (now - player.lastClickTime >= 100) {
                const clickPower = 0.0001 + (player.clickLevel - 1) * 0.0001;
                if (state.globalMatter >= clickPower) {
                    player.balance += clickPower;
                    state.globalMatter -= clickPower;
                    player.lastClickTime = now;
                }
            }
        }

        await player.save();
        await state.save();

        res.json({
            balance: player.balance,
            globalMatter: state.globalMatter,
            autoPower: autoPower,
            nextClickCost: getUpgradeCost(0.0050, player.clickLevel - 1),
            nextAutoCost: getUpgradeCost(0.0100, player.autoLevel)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/upgrade', async (req, res) => {
    try {
        const { userId, type } = req.body;
        const player = await Player.findOne({ userId });
        if (!player) return res.json({ success: false });

        let cost = 0;
        if (type === 'click') {
            cost = getUpgradeCost(0.0050, player.clickLevel - 1);
            if (player.balance >= cost) {
                player.balance -= cost;
                player.clickLevel += 1;
            } else return res.json({ success: false, message: "Мало материи" });
        } else if (type === 'auto') {
            cost = getUpgradeCost(0.0100, player.autoLevel);
            if (player.balance >= cost) {
                player.balance -= cost;
                player.autoLevel += 1;
            } else return res.json({ success: false, message: "Мало материи" });
        }
        await player.save();
        res.json({ success: true, balance: player.balance });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    const leaderboard = await Player.find().sort({ balance: -1 }).limit(10);
    res.json(leaderboard);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`VOID Server is running on port ${PORT}`);
});
