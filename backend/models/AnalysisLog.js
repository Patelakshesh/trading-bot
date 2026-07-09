const mongoose = require('mongoose');

const analysisLogSchema = new mongoose.Schema({
    symbol: {
        type: String,
        required: true,
    },
    action: {
        type: String,
        enum: ['BUY', 'SELL', 'HOLD'],
        required: true,
    },
    reasoning: {
        type: String,
        required: true,
    }
}, { timestamps: true });

module.exports = mongoose.model('AnalysisLog', analysisLogSchema);
