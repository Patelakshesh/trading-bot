require('dotenv').config({path: 'd:/dsa/trading-bot/backend/.env'});
const mongoose = require('mongoose');
const Portfolio = require('./models/Portfolio');

mongoose.connect(process.env.MONGODB_URI).then(() => {
    return Portfolio.updateOne(
        { _id: '6a508740432756c2e96d2220' },
        { $set: { quantity: 15 } }
    );
}).then(res => {
    console.log('UPDATED MONGODB:', res);
    process.exit(0);
}).catch(console.error);
