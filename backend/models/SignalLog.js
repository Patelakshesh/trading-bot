const mongoose = require('mongoose');

const SignalLogSchema = new mongoose.Schema({
    signalId: {
        type: String,
        required: true,
        unique: true
    },
    asset: {
        type: String,
        required: true // 'NIFTY', 'BANKNIFTY', 'CRUDE', 'GOLD', 'SILVER', 'NATGAS', or stock symbol
    },
    strategy: {
        type: String,
        required: true // 'PRE_SIGNAL_SQUEEZE', 'OI_SPIKE', 'MTFA_CONFLUENCE', 'US_VOLUME_BREAKOUT', 'INTRADAY_ORB_VWAP'
    },
    phase: {
        type: String,
        enum: ['PREPARE', 'EXECUTE'],
        default: 'EXECUTE'
    },
    direction: {
        type: String,
        enum: ['BUY_CE', 'BUY_PE', 'BUY_STOCK', 'SELL_STOCK', 'NO_TRADE'],
        required: true
    },
    strike: String,
    expiry: String,
    spotPriceAtSignal: Number,
    recommendedEntry: Number,
    targetPrice: Number,
    stopLossPrice: Number,
    riskRewardRatio: Number,
    confidenceScore: Number, // 0 to 100
    catalysts: [String],
    metricsSnapshot: {
        adx: Number,
        rsi: Number,
        bbWidth: Number,
        pcr: Number,
        oiChangePercent: Number,
        volumeMultiplier: Number,
        vwap: Number
    },
    outcome: {
        type: String,
        enum: ['PENDING', 'TARGET_HIT', 'STOPLOSS_HIT', 'EXPIRED', 'CANCELLED'],
        default: 'PENDING'
    },
    highestPriceReached: Number,
    lowestPriceReached: Number,
    exitPrice: Number,
    pnlPoints: Number,
    pnlPercent: Number,
    exitTime: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SignalLog', SignalLogSchema);
