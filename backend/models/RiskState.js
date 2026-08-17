const mongoose = require('mongoose');

const riskStateSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD
    dailyLosses: { type: Number, default: 0 },
    dailyWins: { type: Number, default: 0 },
    consecutiveLosses: { type: Number, default: 0 },
    killSwitchActive: { type: Boolean, default: false },
    currentDailyLossAmount: { type: Number, default: 0 }
});

module.exports = mongoose.model('RiskState', riskStateSchema);
