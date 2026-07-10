require('dotenv').config({path: 'd:/dsa/trading-bot/backend/.env'});
const { getTop10Recommendations } = require('d:/dsa/trading-bot/backend/services/aiService');
getTop10Recommendations([]).then(console.log).catch(console.error);
