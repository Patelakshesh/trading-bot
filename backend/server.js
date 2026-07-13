require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');

const Portfolio = require('./models/Portfolio');
const AnalysisLog = require('./models/AnalysisLog');
const { getLatestNews } = require('./services/newsService');
const { getStockPrice, searchSymbol } = require('./services/stockService');
const { analyzePortfolio, getStockAnalysis } = require('./services/aiService');
const { getTechnicalIndicators } = require('./services/technicalService');
const advancedDataService = require('./services/advancedDataService');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Anti-Spam Memory: Prevents the bot from spamming the same alert every 15 minutes
const sentAlertsMemory = new Set();

// Initialize Telegram Bot
let bot;
if(TELEGRAM_TOKEN && TELEGRAM_TOKEN !== 'your_telegram_bot_token_here') {
    bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});
    
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, 'Welcome to AI Portfolio Guardian! 📈\n\n**Commands:**\n`/bought <SYMBOL> <PRICE>` - Track a stock\n`/price <SYMBOL>` - Check live price\n`/tip <SYMBOL>` - Get an instant AI swing-trade recommendation\n`/profit` - View total portfolio profit', {parse_mode: 'Markdown'});
    });

    // 1. Upgraded /bought command to automatically fetch live price if omitted
    bot.onText(/\/bought ([^\s]+)(?:\s+([\d.]+))?(?:\s+(\d+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const rawSymbol = match[1];
        bot.sendMessage(chatId, `🔍 Finding correct ticker for "${rawSymbol}"...`);
        const symbol = await searchSymbol(rawSymbol);
        
        let price = match[2] ? parseFloat(match[2]) : null;
        const quantity = match[3] ? parseInt(match[3]) : 1;
        
        try {
            const livePrice = await getStockPrice(symbol);
            if (!price) {
                if (livePrice) {
                    price = livePrice;
                } else {
                    bot.sendMessage(chatId, `❌ Could not automatically fetch the live price for ${symbol}. Please try again and manually enter the price: \`/bought ${symbol} <PRICE>\``, {parse_mode: 'Markdown'});
                    return;
                }
            }

            await Portfolio.create({
                chatId: chatId.toString(),
                symbol: symbol,
                buyPrice: price,
                quantity: quantity
            });
            
            const profit = livePrice ? (((livePrice - price) / price) * 100).toFixed(2) : '0.00';
            const totalInvested = price * quantity;
            const liveValue = livePrice ? livePrice * quantity : totalInvested;
            
            bot.sendMessage(chatId, `✅ **Saved to Portfolio!**\n\n📈 **Stock:** ${symbol}\n📦 **Quantity:** ${quantity}\n💰 **Your Buy Price:** ₹${price} (Total: ₹${totalInvested})\n📊 **Live Market Price:** ₹${livePrice || price} (Total: ₹${liveValue})\n💸 **Current Profit:** ${profit}%\n\nI will now monitor this 24/7 and alert you when to sell!`, {parse_mode: 'Markdown'});
        } catch(err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ Failed to save to database. Please check connection.');
        }
    });

    // 1.5 New /sold command
    bot.onText(/\/sold ([A-Za-z0-9.]+) (\d+\.?\d*)(?: (\d+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        let symbol = match[1].toUpperCase();
        if (!symbol.includes('.')) {
            symbol = symbol + '.NS';
        }
        const sellPrice = parseFloat(match[2]);
        const quantity = match[3] ? parseInt(match[3]) : 1;
        
        try {
            // Find the oldest HOLDING position for this symbol
            const position = await Portfolio.findOne({ chatId: chatId.toString(), symbol: symbol, status: 'HOLDING' }).sort({ createdAt: 1 });
            
            if (!position) {
                return bot.sendMessage(chatId, `❌ You don't have any open (HOLDING) positions for ${symbol}.`);
            }
            
            // If they are selling fewer shares than they own, split the position
            if (quantity < position.quantity) {
                // Reduce the current holding
                position.quantity -= quantity;
                await position.save();
                
                // Create a new sold entry for the realized profit
                const realizedProfit = (sellPrice - position.buyPrice) * quantity;
                await Portfolio.create({
                    chatId: chatId.toString(),
                    symbol: symbol,
                    buyPrice: position.buyPrice,
                    quantity: quantity,
                    status: 'SOLD',
                    sellPrice: sellPrice,
                    realizedProfit: realizedProfit
                });
                
                const sign = realizedProfit >= 0 ? '+' : '';
                const emoji = realizedProfit >= 0 ? '🤑' : '🩸';
                bot.sendMessage(chatId, `✅ **Partial Sale Logged!**\n\n📉 **Stock:** ${symbol}\n📦 **Sold:** ${quantity} shares\n💰 **Sell Price:** ₹${sellPrice}\n${emoji} **Realized Profit:** ${sign}₹${realizedProfit.toFixed(2)}\n\n(You still hold ${position.quantity} shares).`, {parse_mode: 'Markdown'});
            } else {
                // Selling the whole position
                const realizedProfit = (sellPrice - position.buyPrice) * position.quantity;
                position.status = 'SOLD';
                position.sellPrice = sellPrice;
                position.realizedProfit = realizedProfit;
                await position.save();
                
                const sign = realizedProfit >= 0 ? '+' : '';
                const emoji = realizedProfit >= 0 ? '🤑' : '🩸';
                bot.sendMessage(chatId, `✅ **Full Position Sold!**\n\n📉 **Stock:** ${symbol}\n📦 **Sold:** ${position.quantity} shares\n💰 **Sell Price:** ₹${sellPrice}\n${emoji} **Realized Profit:** ${sign}₹${realizedProfit.toFixed(2)}`, {parse_mode: 'Markdown'});
            }
        } catch(err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ Failed to update portfolio database. Please check connection.');
        }
    });

    // 2. New /price command
    bot.onText(/\/price (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const rawSymbol = match[1];
        const symbol = await searchSymbol(rawSymbol);
        bot.sendMessage(chatId, `🔍 Fetching live price for ${symbol}...`);
        
        const livePrice = await getStockPrice(symbol);
        if (livePrice) {
            bot.sendMessage(chatId, `📊 **${symbol}** Live Price: **₹${livePrice}**`, {parse_mode: 'Markdown'});
        } else {
            bot.sendMessage(chatId, `❌ Could not find live price for ${symbol}. Make sure the company name or symbol is valid.`);
        }
    });

    // 3. New /tip command (Instant AI Recommendation or Global Top 5)
    bot.onText(/\/tip(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const rawSymbol = match[1]; // Might be undefined if they just typed /tip
        
        let budget = null;
        let priceRange = null;
        let symbolSearch = null;

        if (rawSymbol) {
            // Check for range like "1-500" anywhere in the text
            const rangeMatch = rawSymbol.match(/(\d+)\s*-\s*(\d+)/);
            if (rangeMatch) {
                priceRange = { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
            }
            
            // Check for a standalone number which represents the budget
            const words = rawSymbol.split(/\s+/);
            const pureNumbers = words.filter(w => /^\d+$/.test(w) || /^\d+,\d+$/.test(w));
            if (pureNumbers.length > 0) {
                budget = parseFloat(pureNumbers[0].replace(/,/g, ''));
            }
            
            // If neither budget nor range was found, and it's a single word, it's a symbol
            if (!rangeMatch && pureNumbers.length === 0) {
                symbolSearch = rawSymbol.trim();
            }
        }
        
        if (symbolSearch) {
            // ----- MODE 1: SINGLE STOCK TIP -----
            const statusMsg = await bot.sendMessage(chatId, `🔍 <b>Identifying ticker for "${symbolSearch}"...</b>`, {parse_mode: 'HTML'});
            const symbol = await searchSymbol(symbolSearch);
            
            await bot.editMessageText(`🧠 <b>Connecting to Wall Street Data for ${symbol}...</b>\n\n[🟩⬛⬛⬛⬛⬛] 20% - Connecting...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
            
            try {
                const news = await getLatestNews();
                await bot.editMessageText(`🧠 <b>Connecting to Wall Street Data for ${symbol}...</b>\n\n[🟩🟩🟩⬛⬛⬛] 50% - Reading News...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                
                const technicals = await getTechnicalIndicators(symbol);
                await bot.editMessageText(`🧠 <b>Connecting to Wall Street Data for ${symbol}...</b>\n\n[🟩🟩🟩🟩🟩⬛] 80% - AI Crunching Technicals...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                
                const { getStockAnalysis } = require('./services/aiService');
                const analysis = await getStockAnalysis(symbol, news, technicals);
                
                // Fetch the live price for the single stock tip
                const currentPrice = await getStockPrice(symbol);
                const priceText = currentPrice ? `₹${currentPrice}` : 'N/A';
                
                if (analysis && analysis.action) {
                    let targetLine = '';
                    if (analysis.target && analysis.stopLoss && analysis.action === 'BUY') {
                        targetLine = `🎯 <b>Target:</b> ${analysis.target} | 🛡️ <b>SL:</b> ${analysis.stopLoss}\n`;
                    }
                
                    const finalMsg = `🚨 <b>INSTANT AI TIP: ${symbol}</b> 🚨\n\n` +
                                     `💰 <b>Live Price:</b> ${priceText}\n` +
                                     `📈 <b>Action:</b> ${analysis.action} (Confidence: ${analysis.confidence}%)\n` +
                                     targetLine +
                                     `🧠 <b>AI Logic:</b> ${analysis.rationale}`;
                    bot.editMessageText(finalMsg, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                } else {
                    await bot.editMessageText(`❌ AI failed to generate a tip for ${symbol} right now. Data might be unavailable.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                }
            } catch (error) {
                await bot.editMessageText(`❌ Error analyzing ${symbol}.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
            }
        } else {
            // ----- MODE 2: GLOBAL TOP 5 TIPS (98% Success Rate Style) -----
            const budgetMsg = budget ? `\n💰 <b>Optimizing for Budget: ₹${budget.toLocaleString('en-IN')}</b>` : "";
            const rangeMsg = priceRange ? `\n🎯 <b>Price Filter: ₹${priceRange.min} - ₹${priceRange.max}</b>` : "";
            
            const statusMsg = await bot.sendMessage(chatId, `🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[⬛⬛⬛⬛⬛⬛⬛⬛] 0% - Initializing AI...`, {parse_mode: 'HTML'});
            
            try {
                const { getMarketMovers } = require('./services/stockService');
                const { getGlobalTop5TradingTips } = require('./services/aiService');
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩⬛⬛⬛⬛⬛⬛] 25% - Scraping Breaking News...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                const news = await getLatestNews();
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩⬛⬛⬛⬛] 50% - Fetching Market Movers...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                const movers = await getMarketMovers();
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩🟩🟩⬛⬛] 75% - Quant AI crunching 98% algorithms...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                const top5 = await getGlobalTop5TradingTips(news, movers, budget, priceRange);
                
                if (top5 && top5.length > 0) {
                    await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩🟩🟩🟩🟩] 100% - Trades Generated!`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                    
                    let msgText = `🎯 <b>TOP 5 ELITE SWING TRADES</b> (98% Algorithmic Conviction)\n\n`;
                    top5.forEach((t, i) => {
                        const icon = t.action.includes('BUY') ? '🟢' : '🔴';
                        const companyStr = t.companyName ? ` (${t.companyName})` : '';
                        msgText += `${i+1}. <b>${t.symbol}</b>${companyStr} ${icon} <b>${t.action}</b>\n`;
                        if (t.currentPrice) {
                            msgText += `💸 Current Price: <b>${t.currentPrice}</b>\n`;
                        }
                        if (t.allocatedFunds && t.sharesToBuy) {
                            msgText += `💸 Allocate: <b>${t.allocatedFunds}</b> (Buy ${t.sharesToBuy} shares)\n`;
                        }
                        msgText += `⏳ Hold: <b>${t.duration}</b>\n`;
                        msgText += `🎯 Target: <b>${t.target}</b> | 🛡️ SL: <b>${t.stopLoss}</b>\n`;
                        msgText += `🧠 <i>${t.rationale}</i>\n\n`;
                    });
                    
                    // Replace the progress bar with the final result!
                    await bot.editMessageText(msgText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                } else {
                    await bot.editMessageText(`❌ Wall Street servers blocked the AI scan. Try again in 2 minutes.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                }
            } catch (err) {
                console.error("TELEGRAM GLOBAL TIP ERROR:", err);
                // Fallback in case statusMsg.message_id is somehow unavailable or threw an error
                await bot.sendMessage(chatId, `❌ Error fetching global AI tips.`);
            }
        }
    });
    // 4. New /profit command (Total Portfolio Summary)
    bot.onText(/\/(profit|portfolio)/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `📊 Calculating your total Hedge Fund profit...`);
        
        try {
            const holdings = await Portfolio.find({ status: 'HOLDING' });
            const soldTrades = await Portfolio.find({ status: 'SOLD' });
            
            if (holdings.length === 0 && soldTrades.length === 0) {
                return bot.sendMessage(chatId, `Your portfolio is empty! Buy some stocks to see your profit.`);
            }

            let totalInvested = 0;
            let totalCurrentValue = 0;
            let holdingsList = `\n📋 **ACTIVE HOLDINGS & TARGETS**\n`;

            for (let item of holdings) {
                const currentPrice = await getStockPrice(item.symbol);
                const invested = item.buyPrice * item.quantity;
                const current = currentPrice ? currentPrice * item.quantity : invested; // fallback to invested if price fails
                
                totalInvested += invested;
                totalCurrentValue += current;
                
                const target = (item.buyPrice * 1.05).toFixed(2);
                const stopLoss = (item.buyPrice * 0.95).toFixed(2);
                holdingsList += `🔹 **${item.symbol}:** Buy ₹${item.buyPrice} ➡️ Target: ₹${target} | SL: ₹${stopLoss}\n`;
            }
            
            if (holdings.length === 0) {
                holdingsList += `_No active holdings._\n`;
            }
            
            let totalRealizedProfit = 0;
            for (let trade of soldTrades) {
                totalRealizedProfit += trade.realizedProfit;
            }

            const totalUnrealizedProfit = totalCurrentValue - totalInvested;
            const totalProfitPercent = totalInvested > 0 ? ((totalUnrealizedProfit / totalInvested) * 100).toFixed(2) : 0;
            
            const unrealizedSign = totalUnrealizedProfit >= 0 ? '+' : '';
            const unrealizedEmoji = totalUnrealizedProfit >= 0 ? '🟢' : '🔴';
            
            const realizedSign = totalRealizedProfit >= 0 ? '+' : '';
            const realizedEmoji = totalRealizedProfit >= 0 ? '🤑' : '🩸';

            bot.sendMessage(chatId, `🏆 **PORTFOLIO SUMMARY** 🏆\n\n` +
                                    `💰 **Active Invested:** ₹${totalInvested.toFixed(2)}\n` +
                                    `📈 **Live Value:** ₹${totalCurrentValue.toFixed(2)}\n` +
                                    `${unrealizedEmoji} **Unrealized Profit:** ${unrealizedSign}₹${totalUnrealizedProfit.toFixed(2)} (${unrealizedSign}${totalProfitPercent}%)\n\n` +
                                    `🏦 **BANKED HISTORY**\n` +
                                    `${realizedEmoji} **Realized Profit (SOLD):** ${realizedSign}₹${totalRealizedProfit.toFixed(2)}\n\n` +
                                    `💎 **NET GAINS:** ${totalUnrealizedProfit + totalRealizedProfit >= 0 ? '+' : ''}₹${(totalUnrealizedProfit + totalRealizedProfit).toFixed(2)}\n` +
                                    holdingsList, {parse_mode: 'Markdown'});
        } catch (error) {
            console.error('Error calculating profit:', error);
            bot.sendMessage(chatId, `❌ Error calculating portfolio profit.`);
        }
    });

    // 5. Beautiful Welcome / Help Menu
    bot.onText(/\/(start|help)/, (msg) => {
        const chatId = msg.chat.id;
        const welcomeMsg = `🤖 **Welcome to the AI Hedge Fund Bot!** 🤖\n\n` +
                           `I am your 24/7 personal trading assistant. I monitor the markets, read the news, and execute mathematical strategies for you.\n\n` +
                           `📌 **AVAILABLE COMMANDS:**\n\n` +
                           `🛒 \`/bought <SYMBOL> <PRICE> <QTY>\`\n` +
                           `↳ *Example: /bought ZOMATO 250 100*\n` +
                           `↳ Adds a stock to your live Web Dashboard.\n\n` +
                           `🤝 \`/sold <SYMBOL> <PRICE> <QTY>\`\n` +
                           `↳ *Example: /sold ZOMATO 260 100*\n` +
                           `↳ Sells the stock and stores your earned profit in history.\n\n` +
                           `🏆 \`/profit\` or \`/portfolio\`\n` +
                           `↳ Scans your entire portfolio and shows your total profit in rupees.\n\n` +
                           `🧠 \`/tip <SYMBOL>\`\n` +
                           `↳ *Example: /tip RELIANCE*\n` +
                           `↳ Uses Gemini AI, Math, and Breaking News to give you an instant BUY/SELL/HOLD recommendation.\n\n` +
                           `📊 \`/price <SYMBOL>\`\n` +
                           `↳ Instantly fetches the exact live market price.\n\n` +
                           `🚀 \`/movers\`\n` +
                           `↳ Shows today's top Market Gainers and Losers.\n\n` +
                           `*(Remember: If I detect a +5% profit or Bad Breaking News on your stocks, I will automatically alert you here!)*`;
                           
        bot.sendMessage(chatId, welcomeMsg, {parse_mode: 'Markdown'});
    });

    // 6. Market Movers Command
    bot.onText(/\/movers/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🚀 Scanning Wall Street for Top Movers...`);
        try {
            const { getMarketMovers } = require('./services/stockService');
            const movers = await getMarketMovers();
            let moverMsg = `📈 <b>TOP 5 GAINERS:</b>\n`;
            movers.gainers.slice(0, 5).forEach(g => {
                moverMsg += `🟢 ${g.symbol} (${g.name}): ₹${g.price} (+${g.changePercent}%)\n`;
            });
            moverMsg += `\n📉 <b>TOP 5 LOSERS:</b>\n`;
            movers.losers.slice(0, 5).forEach(l => {
                moverMsg += `🔴 ${l.symbol} (${l.name}): ₹${l.price} (${l.changePercent}%)\n`;
            });
            await bot.sendMessage(chatId, moverMsg, {parse_mode: 'HTML'});
        } catch(err) {
            console.error("TELEGRAM MOVERS ERROR:", err);
            bot.sendMessage(chatId, `❌ Error fetching market movers: ${err.message}`);
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

// External Webhook to trigger the AI manually or via external free Cron service (cron-job.org)
// (Must be above /api so it doesn't get blocked by JWT Auth)
app.get('/api/cron/trigger-analysis', async (req, res) => {
    console.log("External trigger received! Starting analysis...");
    runDailyAnalysis(); 
    res.json({ success: true, message: 'AI Analysis Workflow triggered successfully!' });
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

            // If Telegram is configured, send alerts
            if (bot) {
                // Find who owns this stock
                const owners = holdings.filter(h => h.symbol === rec.symbol);
                
                for(let owner of owners) {
                    // Only send a push notification if the AI wants them to take ACTION (BUY/SELL).
                    // Do not spam them every 15 minutes with "HOLD" messages.
                    if (rec.action !== 'HOLD') {
                        const alertKey = `${owner._id}_AI_${rec.action}`;
                        if (!sentAlertsMemory.has(alertKey)) {
                            const alertMsg = `🚨 **AI TRADING ALERT** 🚨\n\n` +
                                             `📈 **Stock:** ${rec.symbol}\n` +
                                             `💰 **Your Buy Price:** ₹${owner.buyPrice}\n` +
                                             `📊 **Current Price:** ₹${currentPrices[rec.symbol] || 'N/A'}\n` +
                                             `🟢 **Action:** ${rec.action}\n\n` +
                                             `🧠 **AI Thoughts:** ${rec.reasoning}`;
                            
                            if (owner.chatId !== 'UI_USER') {
                                bot.sendMessage(owner.chatId, alertMsg, {parse_mode: 'Markdown'});
                            } else {
                                // Bridge Dashboard stocks to actual Telegram users
                                const allUsers = await Portfolio.distinct('chatId');
                                const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
                                for (let tId of telegramUsers) {
                                    bot.sendMessage(tId, alertMsg, {parse_mode: 'Markdown'});
                                }
                            }
                            sentAlertsMemory.add(alertKey);
                        }
                    }
                }
            }
        }
        
        
    } catch(err) {
        console.error('Error in CRON job:', err);
    }
};

// Internal Cron Job (Will run every 15 minutes for near-instant AI analysis)
cron.schedule('*/15 * * * *', runDailyAnalysis, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});


// MATHEMATICAL STOP-LOSS, TAKE-PROFIT, AND NEWS ALERT CRON JOB (Runs every 15 minutes)
cron.schedule('*/15 * * * *', async () => {
    console.log('Running Auto-Alert Check...');
    if(!bot) return;

    try {
        const holdings = await Portfolio.find({ status: 'HOLDING' });
        const { getLatestNews } = require('./services/newsService');
        const news = await getLatestNews();

        for(let item of holdings) {
            const currentPrice = await getStockPrice(item.symbol);
            if(currentPrice) {
                const profitPercentage = ((currentPrice - item.buyPrice) / item.buyPrice) * 100;
                
                // 1. Take-Profit Alert (+5%)
                if (profitPercentage >= 5) {
                    const tpKey = `${item._id}_TP`;
                    if (!sentAlertsMemory.has(tpKey)) {
                        const alertMsg = `🎯 **TAKE PROFIT ALERT** 🎯\n\n` +
                                         `🚀 **Stock:** ${item.symbol}\n` +
                                         `💰 **Buy Price:** ₹${item.buyPrice}\n` +
                                         `🤑 **Current Price:** ₹${currentPrice} (Up +${profitPercentage.toFixed(2)}%)\n\n` +
                                         `You have reached your +5% target! Sell now to lock in profits!`;
                        
                        if (item.chatId !== 'UI_USER') {
                            bot.sendMessage(item.chatId, alertMsg, {parse_mode: 'Markdown'});
                        } else {
                            const allUsers = await Portfolio.distinct('chatId');
                            const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) bot.sendMessage(tId, alertMsg, {parse_mode: 'Markdown'});
                        }
                        sentAlertsMemory.add(tpKey);
                    }
                }
                
                // 2. Stop-Loss Alert (-5%)
                if(profitPercentage <= -5) {
                    const slKey = `${item._id}_SL`;
                    if (!sentAlertsMemory.has(slKey)) {
                        const alertMsg = `⚠️ **EMERGENCY STOP-LOSS TRIGGERED** ⚠️\n\n` +
                                         `📉 **Stock:** ${item.symbol}\n` +
                                         `💰 **Buy Price:** ₹${item.buyPrice}\n` +
                                         `🚨 **Current Price:** ₹${currentPrice} (Dropped ${profitPercentage.toFixed(2)}%)\n\n` +
                                         `Mathematical Safety Net activated. Consider cutting your losses!`;
                        
                        if (item.chatId !== 'UI_USER') {
                            bot.sendMessage(item.chatId, alertMsg, {parse_mode: 'Markdown'});
                        } else {
                            const allUsers = await Portfolio.distinct('chatId');
                            const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) bot.sendMessage(tId, alertMsg, {parse_mode: 'Markdown'});
                        }
                        sentAlertsMemory.add(slKey);
                    }
                }

                // 3. Bad Breaking News Alert
                const badNews = news.find(n => 
                    (n.title.includes(item.symbol.replace('.NS', '')) || n.description.includes(item.symbol.replace('.NS', ''))) &&
                    /(crash|fall|drop|warning|fraud|loss|sell|downgrade)/i.test(n.title + n.description)
                );

                if (badNews) {
                    const newsKey = `${item._id}_NEWS_${badNews.title.substring(0,20)}`;
                    if (!sentAlertsMemory.has(newsKey)) {
                        const newsMsg = `📰 **BREAKING BAD NEWS ALERT** 📰\n\n` +
                                        `🚨 **Stock:** ${item.symbol}\n` +
                                        `⚠️ **Headline:** ${badNews.title}\n\n` +
                                        `This negative news might impact your holdings. Consider selling immediately!`;
                        
                        if (item.chatId !== 'UI_USER') {
                            bot.sendMessage(item.chatId, newsMsg, {parse_mode: 'Markdown'});
                        } else {
                            const allUsers = await Portfolio.distinct('chatId');
                            const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) bot.sendMessage(tId, newsMsg, {parse_mode: 'Markdown'});
                        }
                        sentAlertsMemory.add(newsKey);
                    }
                }
            }
        }
    } catch(err) {
        console.error('Error in Auto-Alert CRON:', err);
    }
});

// PROACTIVE AI TIP BROADCASTER (Runs every 2 hours to send instant new opportunities)
cron.schedule('0 */2 * * *', async () => {
    if (!bot) return;
    try {
        console.log('Scanning for new Proactive AI Tips...');
        const { getLatestNews } = require('./services/newsService');
        const { getMarketMovers } = require('./services/stockService');
        const { getGlobalTop5TradingTips } = require('./services/aiService');
        
        const news = await getLatestNews();
        const movers = await getMarketMovers();
        const top5 = await getGlobalTop5TradingTips(news, movers, null, null);
        
        if (top5 && top5.length > 0) {
            const bestTip = top5[0]; // Take the absolute highest conviction tip
            
            // Get all unique chatIds from users who have used the bot
            const allUsers = await Portfolio.distinct('chatId');
            
            for (let chatId of allUsers) {
                if (chatId !== 'UI_USER') {
                    const proactiveKey = `${chatId}_PROACTIVE_${bestTip.symbol}`;
                    if (!sentAlertsMemory.has(proactiveKey)) {
                        const tipMsg = `🌟 **PROACTIVE AI OPPORTUNITY** 🌟\n\n` +
                                       `I just found a massive new setup based on breaking market data!\n\n` +
                                       `📈 **Stock:** ${bestTip.symbol} (${bestTip.companyName})\n` +
                                       `💰 **Current Price:** ${bestTip.currentPrice || 'N/A'}\n` +
                                       `🟢 **Action:** ${bestTip.action}\n` +
                                       `🎯 **Target:** ${bestTip.target} | 🛡️ **SL:** ${bestTip.stopLoss}\n\n` +
                                       `🧠 **Why?** ${bestTip.rationale}\n\n` +
                                       `*(Type \`/bought ${bestTip.symbol} <PRICE>\` to track it!)*`;
                        
                        bot.sendMessage(chatId, tipMsg, {parse_mode: 'Markdown'});
                        sentAlertsMemory.add(proactiveKey);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error broadcasting tip:', err);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
