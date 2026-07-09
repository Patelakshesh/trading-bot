const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true
    },
    symbol: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Watchlist', watchlistSchema);
