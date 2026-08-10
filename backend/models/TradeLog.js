const mongoose = require('mongoose');

const tradeLogSchema = new mongoose.Schema({
    strategy: {
        type: String,
        enum: ['intraday_v4', 'intraday_july30', 'top10', 'above4', 'combined_best', 'fno', 'swing_tip'],
        required: true,
    },
    symbol: {
        type: String,
        required: true,
        uppercase: true,
    },
    signalTime: {
        type: Date,
        default: Date.now,
    },
    entryPrice: {
        type: Number,
        required: true,
    },
    targetPrice: {
        type: Number,
        required: true,
    },
    stopLossPrice: {
        type: Number,
        required: true,
    },
    // Tracked by auto-checker cron
    outcome: {
        type: String,
        enum: ['PENDING', 'WIN', 'LOSS', 'TIMEOUT', 'EXPIRED'],
        default: 'PENDING',
    },
    exitPrice: {
        type: Number,
    },
    exitTime: {
        type: Date,
    },
    pnlAmount: {
        type: Number,
    },
    pnlPercent: {
        type: Number,
    },
    // Predictive score at time of signal
    predictiveScore: {
        type: Number
    }
});

const TradeLog = mongoose.model('TradeLog', tradeLogSchema);
module.exports = TradeLog;
