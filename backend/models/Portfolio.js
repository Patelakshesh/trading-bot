const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true,
    },
    symbol: {
        type: String,
        required: true,
        uppercase: true,
    },
    buyPrice: {
        type: Number,
        required: true,
    },
    quantity: {
        type: Number,
        default: 1, // Assuming 1 if not provided via quick telegram command
    },
    status: {
        type: String,
        enum: ['HOLDING', 'SOLD'],
        default: 'HOLDING',
    },
    sellPrice: {
        type: Number
    },
    realizedProfit: {
        type: Number
    }
}, { timestamps: true });

module.exports = mongoose.model('Portfolio', portfolioSchema);
