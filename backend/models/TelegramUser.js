const mongoose = require('mongoose');

const TelegramUserSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        default: ''
    },
    firstName: {
        type: String,
        default: ''
    },
    lastName: {
        type: String,
        default: ''
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('TelegramUser', TelegramUserSchema);
