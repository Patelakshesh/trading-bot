require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');

const Portfolio = require('./models/Portfolio');
const AnalysisLog = require('./models/AnalysisLog');
const { getLatestNews } = require('./services/newsService');
const { getStockPrice } = require('./services/stockService');
const { analyzePortfolio } = require('./services/aiService');
const { getTechnicalIndicators } = require('./services/technicalService');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Initialize Telegram Bot
let bot;
if(TELEGRAM_TOKEN && TELEGRAM_TOKEN !== 'your_telegram_bot_token_here') {
    bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});
    
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, 'Welcome to AI Portfolio Guardian! 📈\nSend me:\n`/bought <SYMBOL> <PRICE>` to track a stock.');
    });

    bot.onText(/\/bought (.+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[1].toUpperCase();
        const price = parseFloat(match[2]);
        
        try {
            await Portfolio.create({
                chatId: chatId.toString(),
                symbol: symbol,
                buyPrice: price,
                quantity: 1
            });
            bot.sendMessage(chatId, `✅ Saved! I am now tracking ${symbol} bought at ₹${price}. I will monitor the news and alert you!`);
        } catch(err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ Failed to save to database. Please check connection.');
        }
    });
}

// Connect to MongoDB
if(process.env.MONGODB_URI && process.env.MONGODB_URI !== 'your_mongodb_free_cluster_url_here') {
    mongoose.connect(process.env.MONGODB_URI)
        .then(async () => {
            console.log('✅ Connected to MongoDB Atlas');
            // Seed Default Admin User if it doesn't exist
            const Admin = require('./models/Admin');
            const adminCount = await Admin.countDocuments();
            if (adminCount === 0) {
                await Admin.create({
                    email: 'admin@trading.com',
                    password: 'admin' // simple default password
                });
                console.log('✅ Created default admin: admin@trading.com / admin');
            }
        })
        .catch(err => console.error('❌ MongoDB connection error:', err));
}

// Basic API Route
app.get('/', (req, res) => {
    res.send('AI Trading Bot Backend is running!');
});

// API Routes for React Frontend
app.use('/api', require('./routes/api'));

// Render Free Tier Keep-Alive (Pings itself every 14 minutes to prevent sleep)
setInterval(async () => {
    try {
        const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        await fetch(url);
        console.log('Keep-alive ping sent to prevent Render sleep mode.');
    } catch (err) {
        // Ignore errors if fetch isn't available or network fails
    }
}, 14 * 60 * 1000);

// Extract AI Workflow so it can be triggered by external cron services (cron-job.org)
const runDailyAnalysis = async () => {
    console.log('Running daily AI portfolio analysis...');
    
    if(!bot) return;

    try {
        const holdings = await Portfolio.find({ status: 'HOLDING' });
        const Watchlist = require('./models/Watchlist');
        const watchlist = await Watchlist.find();
        const { getAdvancedMetrics } = require('./services/advancedDataService');

        // Fetch Global/Financial News
        const news = await getLatestNews();
        
        // Fetch Current Prices and Technical Indicators for Portfolio AND Watchlist
        const currentPrices = {};
        const technicalData = {};
        const advancedData = {};
        for(let item of holdings) {
            if(!currentPrices[item.symbol]) {
                currentPrices[item.symbol] = await getStockPrice(item.symbol);
                technicalData[item.symbol] = await getTechnicalIndicators(item.symbol);
                advancedData[item.symbol] = await getAdvancedMetrics(item.symbol);
            }
        }
        for(let item of watchlist) {
            if(!currentPrices[item.symbol]) {
                currentPrices[item.symbol] = await getStockPrice(item.symbol);
                technicalData[item.symbol] = await getTechnicalIndicators(item.symbol);
                advancedData[item.symbol] = await getAdvancedMetrics(item.symbol);
            }
        }

        const enhancedHoldings = holdings.map(item => {
            const currentPrice = currentPrices[item.symbol];
            const profitPercent = currentPrice ? ((currentPrice - item.buyPrice) / item.buyPrice * 100).toFixed(2) : 0;
            const daysHeld = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
            
            return {
                ...item.toObject(),
                daysHeld,
                profitPercent: Number(profitPercent)
            };
        });

        // Ask AI for analysis (Now armed with Math and Smart Money Metrics!)
        const recommendations = await analyzePortfolio(enhancedHoldings, watchlist, news, currentPrices, technicalData, advancedData);

        // Send Telegram Alerts and Save Logs
        for(let rec of recommendations) {
            // Save to Analysis History Database
            await AnalysisLog.create({
                symbol: rec.symbol,
                action: rec.action,
                reasoning: rec.reasoning
            });

            // Find who owns this stock
            const owners = holdings.filter(h => h.symbol === rec.symbol);
            
            for(let owner of owners) {
                const alertMsg = `🚨 **AI TRADING ALERT** 🚨\n\n` +
                                 `📈 **Stock:** ${rec.symbol}\n` +
                                 `💰 **Your Buy Price:** ₹${owner.buyPrice}\n` +
                                 `📊 **Current Price:** ₹${currentPrices[rec.symbol] || 'N/A'}\n` +
                                 `🟢 **Action:** ${rec.action}\n\n` +
                                 `🧠 **AI Thoughts:** ${rec.reasoning}`;
                
                bot.sendMessage(owner.chatId, alertMsg, {parse_mode: 'Markdown'});
            }
        }
        
        
    } catch(err) {
        console.error('Error in CRON job:', err);
    }
};

// Internal Cron Job (Will only run if the server is awake at 9:30 AM)
cron.schedule('30 9 * * *', runDailyAnalysis);

// External Webhook to trigger the AI manually or via external free Cron service (cron-job.org)
app.get('/api/cron/trigger-analysis', async (req, res) => {
    console.log("External trigger received! Starting analysis...");
    // Run it asynchronously so we don't block the HTTP response
    runDailyAnalysis(); 
    res.json({ success: true, message: 'AI Analysis Workflow triggered successfully!' });
});

// MATHEMATICAL STOP-LOSS CRON JOB (Runs every 15 minutes)
cron.schedule('*/15 * * * *', async () => {
    console.log('Running Stop-Loss Check...');
    if(!bot) return;

    try {
        const holdings = await Portfolio.find({ status: 'HOLDING' });
        for(let item of holdings) {
            const currentPrice = await getStockPrice(item.symbol);
            if(currentPrice) {
                const dropPercentage = ((item.buyPrice - currentPrice) / item.buyPrice) * 100;
                
                // If it drops exactly 5% or more, send an emergency alert
                if(dropPercentage >= 5) {
                    const alertMsg = `⚠️ **EMERGENCY STOP-LOSS TRIGGERED** ⚠️\n\n` +
                                     `📉 **Stock:** ${item.symbol}\n` +
                                     `💰 **Buy Price:** ₹${item.buyPrice}\n` +
                                     `🚨 **Current Price:** ₹${currentPrice} (Dropped ${dropPercentage.toFixed(2)}%)\n\n` +
                                     `Mathematical Safety Net activated. Consider cutting your losses!`;
                    
                    if(item.chatId !== 'UI_USER') {
                        bot.sendMessage(item.chatId, alertMsg, {parse_mode: 'Markdown'});
                    }
                }
            }
        }
    } catch(err) {
        console.error('Error in Stop-Loss CRON:', err);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
