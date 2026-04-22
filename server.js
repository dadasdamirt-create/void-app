const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// НАСТРОЙКИ
const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = "ТВОЙ_ТОКЕН_ОТ_BOTFATHER"; // Замени на свой
const CHANNEL_ID = "-100XXXXXXXXXX";       // Замени на свой

mongoose.connect(MONGO_URI).then(() => console.log("БАЗА ПОДКЛЮЧЕНА"));

const playerSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    totalExtracted: { type: Number, default: 0 },
    clickLevel: { type: Number, default: 1 },
    autoLevel: { type: Number, default: 0 },
    lastCheck: { type: Number, default: Date.now },
    lastClickTime: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    lastBonusClaim: { type: Date, default: null },
    completedQuests: { type: [String], default: [] },
    referralCount: { type: Number, default: 0 },
    currentSkin: { type: String, default: 'white' },
    ownedSkins: { type: [String], default: ['white'] }
});
const Player = mongoose.model('Player', playerSchema);

const State = mongoose.model('State', new mongoose.Schema({
    key: { type: String, default: "global" },
    globalMatter: { type: Number, default: 1000000.0000 },
    eventActive: { type: Boolean, default: false },
    eventEndTime: { type: Number, default: 0 }
}));

async function getGlobalState() {
    let state = await State.findOne({ key: "global" });
    if (!state) state = await State.create({ key: "global", globalMatter: 1000000.0 });
    const now = Date.now();
    if (!state.eventActive && Math.random() < 0.01) {
        state.eventActive = true; state.eventEndTime = now + 30000;
        await state.save();
    } else if (state.eventActive && now > state.eventEndTime) {
        state.eventActive = false; await state.save();
    }
    return state;
}

const skinConfig = {
    'white': { bonus: 1.0 }, 'gold': { price: 0.5, bonus: 1.1 },
    'plasma': { price: 2.0, bonus: 1.3 }, 'emerald': { price: 10.0, bonus: 1.6 },
    'ruby': { price: 50.0, bonus: 2.5 }
};

const getUpgradeCost = (base, level) => base * Math.pow(1.6, level);
const getPlayerLevel = (total) => Math.floor(total / 0.5) + 1;

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
        const skinBonus = skinConfig[player.currentSkin]?.bonus || 1.0;
        let totalMult = (1 + (level - 1) * 0.01) * skinBonus;
        if (state.eventActive) totalMult *= 5;

        const autoPower = player.autoLevel * 0.0001 * totalMult; 
        const timeDiff = (now - player.lastCheck) / 1000;
        const passiveGain = timeDiff > 0 ? timeDiff * autoPower : 0;
        
        if (passiveGain > 0 && state.globalMatter >= passiveGain) {
            player.balance += passiveGain; player.totalExtracted += passiveGain; state.globalMatter -= passiveGain;
        }
        player.lastCheck = now;

        if (action === 'click' && (now - player.lastClickTime >= 100)) {
            const clickPower = (0.0001 + (player.clickLevel - 1) * 0.0001) * totalMult;
            if (state.globalMatter >= clickPower) {
                player.balance += clickPower; player.totalExtracted += clickPower; state.globalMatter -= clickPower;
                player.lastClickTime = now;
            }
        }
        await player.save(); await state.save();
        res.json({ 
            balance: player.balance, globalMatter: state.globalMatter, 
            autoPower, level, totalExtracted: player.totalExtracted,
            currentSkin: player.currentSkin, ownedSkins: player.ownedSkins,
            eventActive: state.eventActive, referralCount: player.referralCount,
            nextClickCost: getUpgradeCost(0.005, player.clickLevel - 1),
            nextAutoCost: getUpgradeCost(0.01, player.autoLevel)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/skin', async (req, res) => {
    try {
        const { userId, skinId, action } = req.body;
        const player = await Player.findOne({ userId });
        const prices = { 'gold': 0.5, 'plasma': 2.0, 'emerald': 10.0, 'ruby': 50.0 };
        if (action === 'buy') {
            if (player.balance >= prices[skinId] && !player.ownedSkins.includes(skinId)) {
                player.balance -= prices[skinId]; player.ownedSkins.push(skinId); player.currentSkin = skinId;
            } else return res.json({ success: false });
        } else { if (player.ownedSkins.includes(skinId)) player.currentSkin = skinId; }
        await player.save();
        res.json({ success: true, currentSkin: player.currentSkin, ownedSkins: player.ownedSkins });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/upgrade', async (req, res) => {
    try {
        const { userId, type } = req.body;
        const player = await Player.findOne({ userId });
        let cost = (type === 'click') ? getUpgradeCost(0.005, player.clickLevel - 1) : getUpgradeCost(0.01, player.autoLevel);
        if (player.balance >= cost) {
            player.balance -= cost;
            if (type === 'click') player.clickLevel += 1; else player.autoLevel += 1;
            await player.save(); res.json({ success: true, balance: player.balance });
        } else res.json({ success: false });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/daily-bonus', async (req, res) => {
    try {
        const { userId } = req.body;
        const player = await Player.findOne({ userId });
        const now = new Date();
        const lastClaim = player.lastBonusClaim ? new Date(player.lastBonusClaim) : null;
        if (lastClaim && lastClaim.toDateString() === now.toDateString()) return res.json({ success: false, message: "Tomorrow!" });
        player.streak = (lastClaim && (now - lastClaim) < 48 * 3600000) ? player.streak + 1 : 1;
        const bonus = 0.001 * Math.min(player.streak, 7);
        player.balance += bonus; player.lastBonusClaim = now; await player.save();
        res.json({ success: true, balance: player.balance, amount: bonus });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/complete-quest', async (req, res) => {
    try {
        const { userId, questId } = req.body;
        const player = await Player.findOne({ userId });
        if (player.completedQuests.includes(questId)) return res.json({ success: false });
        if (questId === 'sub_tg') {
            const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${userId}`;
            const resp = await axios.get(url);
            if (['member', 'administrator', 'creator'].includes(resp.data.result.status)) {
                player.balance += 0.1; player.completedQuests.push(questId); await player.save();
                return res.json({ success: true });
            }
        }
        if (questId === 'invite_3' && player.referralCount >= 3) {
            player.balance += 0.15; player.completedQuests.push(questId); await player.save();
            return res.json({ success: true });
        }
        res.json({ success: false });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaders = await Player.find().sort({ balance: -1 }).limit(10);
        res.json(leaders);
    } catch (e) { res.json([]); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running`));
