require('dotenv').config({path: 'd:/dsa/trading-bot/backend/.env'});
const mongoose = require('mongoose');
const Portfolio = require('./models/Portfolio');

async function fixDB() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find all HAL stocks
    const halItems = await Portfolio.find({ symbol: 'HAL' });
    console.log('Found HAL items:', halItems.length);
    
    // Update them to HAL.NS
    const res = await Portfolio.updateMany(
        { symbol: 'HAL' },
        { $set: { symbol: 'HAL.NS' } }
    );
    console.log('Updated to HAL.NS:', res.modifiedCount);
    
    process.exit(0);
}
fixDB().catch(console.error);
