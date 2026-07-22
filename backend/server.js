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

// ─── INDIAN MARKET HOURS HELPER ──────────────────────────────────────────────
// NSE/BSE: Monday–Friday, 9:15 AM – 3:30 PM IST
function isMarketOpen() {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + IST_OFFSET);
    const day = ist.getUTCDay(); // 0=Sun, 6=Sat
    const h = ist.getUTCHours();
    const m = ist.getUTCMinutes();
    const totalMin = h * 60 + m;
    // Mon–Fri only, 9:15 AM (555 min) to 3:30 PM (930 min)
    return day >= 1 && day <= 5 && totalMin >= 555 && totalMin <= 930;
}

function nextMarketOpenStr() {
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + IST_OFFSET);
    const day = ist.getUTCDay();
    const h = ist.getUTCHours();
    const m = ist.getUTCMinutes();
    const totalMin = h * 60 + m;
    if (day >= 1 && day <= 5 && totalMin < 555) return 'today at 9:15 AM IST';
    if (day === 5 && totalMin > 930) return 'Monday at 9:15 AM IST';
    if (day === 6) return 'Monday at 9:15 AM IST';
    if (day === 0) return 'Monday at 9:15 AM IST';
    return 'tomorrow at 9:15 AM IST';
}
// ─────────────────────────────────────────────────────────────────────────────

// Initialize Telegram Bot
let bot;
if(TELEGRAM_TOKEN && TELEGRAM_TOKEN !== 'your_telegram_bot_token_here') {
    bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});
    
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, 'Welcome to AI Portfolio Guardian! 📈\n\n**Commands:**\n`/bought <SYMBOL> <INVESTED_VALUE>` - Track a stock automatically\n`/price <SYMBOL>` - Check live price\n`/tip <SYMBOL>` - Get an instant AI swing-trade recommendation\n`/profit` - View total portfolio profit', {parse_mode: 'Markdown'});
    });

    // 1. Upgraded /bought command to automatically fetch live price if omitted
    bot.onText(/\/bought ([^\s]+)(?:\s+([\d.]+))?(?:\s+(\d+))?(?:\s+(\d+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const rawSymbol = match[1];
        bot.sendMessage(chatId, `🔍 Finding correct ticker for "${rawSymbol}"...`);
        const symbol = await searchSymbol(rawSymbol);
        
        let arg1 = match[2] ? parseFloat(match[2]) : null;
        let arg2 = match[3] ? parseInt(match[3]) : null;
        let arg3 = match[4] ? parseInt(match[4]) : null;
        
        try {
            const livePrice = await getStockPrice(symbol);
            if (!livePrice) {
                bot.sendMessage(chatId, `❌ Could not automatically fetch the live price for ${symbol}. Please try again later.`, {parse_mode: 'Markdown'});
                return;
            }

            let price = livePrice;
            let quantity = 1;
            let timeLimit = 5;

            // SMART DETECTION:
            if (arg1 !== null && arg2 !== null && arg3 !== null) {
                // User provided Price, Quantity, AND TimeLimit: /bought ZOMATO 240 100 3
                price = arg1;
                quantity = arg2;
                timeLimit = arg3;
            } else if (arg1 !== null && arg2 !== null) {
                // User provided both Price and Quantity, OR Invested Value and TimeLimit
                // E.g. /bought ZOMATO 240 100  --> Price=240, Qty=100
                // E.g. /bought ZOMATO 10000 3  --> Invested=10000, TimeLimit=3
                if (arg1 > livePrice * 1.5) {
                    quantity = Math.floor(arg1 / livePrice);
                    if (quantity < 1) quantity = 1;
                    timeLimit = arg2; // The second argument is actually the time limit!
                } else {
                    price = arg1;
                    quantity = arg2;
                }
            } else if (arg1 !== null) {
                // User provided only ONE number. Is it the Price, or the Invested Value?
                // If the number is vastly larger than the current live price (e.g. > 50% larger), 
                // it is safe to assume they entered a total INVESTED VALUE.
                if (arg1 > livePrice * 1.5) {
                    quantity = Math.floor(arg1 / livePrice);
                    if (quantity < 1) quantity = 1;
                } else {
                    // Otherwise, it's just the manual PRICE they bought it at, and qty defaults to 1.
                    price = arg1;
                    quantity = 1;
                }
            }

            await Portfolio.create({
                chatId: chatId.toString(),
                symbol: symbol,
                buyPrice: price,
                quantity: quantity,
                timeLimit: timeLimit
            });
            
            const totalInvested = price * quantity;
            const liveValue = livePrice * quantity;
            
            bot.sendMessage(chatId, `✅ **Saved to Portfolio!**\n\n📈 **Stock:** ${symbol}\n💰 **Invested:** ₹${totalInvested.toFixed(2)}\n📦 **Shares Bought:** ${quantity} (at ₹${price.toFixed(2)}/share)\n⏳ **Time-Stop Limit:** ${timeLimit} Days\n📊 **Live Market Price:** ₹${livePrice.toFixed(2)}\n\nI will now monitor this 24/7 and alert you when to sell!`, {parse_mode: 'Markdown'});
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

    // 2. /price command — shows live price + AI target and SL
    bot.onText(/\/price (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const rawSymbol = match[1];
        const symbol = await searchSymbol(rawSymbol);
        bot.sendMessage(chatId, `🔍 Fetching data for ${symbol}...`);
        
        const livePrice = await getStockPrice(symbol);
        if (livePrice) {
            const target = (livePrice * 1.05).toFixed(2);
            const sl = (livePrice * 0.97).toFixed(2);
            bot.sendMessage(chatId,
                `📊 <b>${symbol} — Live Price</b>\n\n` +
                `💰 <b>Current Price:</b> ₹${livePrice}\n` +
                `🎯 <b>Target (+5%):</b> ₹${target}\n` +
                `🛡️ <b>Stop-Loss (-3%):</b> ₹${sl}\n\n` +
                `<i>Run /tip ${rawSymbol.trim()} for a full AI BUY/SELL/HOLD analysis!</i>`,
                {parse_mode: 'HTML'}
            );
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
                
                const currentPrice = await getStockPrice(symbol);
                const priceText = currentPrice ? `₹${currentPrice}` : 'N/A';

                // Run backtest to prove system reliability to the user
                const { runBacktest } = require('./services/technicalService');
                const backtest = await runBacktest(symbol, 365);
                let backtestMsg = '';
                if (backtest && backtest.trades && backtest.trades.length > 0) {
                    let winningTrades = 0;
                    let lastBuyPrice = 0;
                    for (const t of backtest.trades) {
                        if (t.type === 'BUY') lastBuyPrice = t.price;
                        if (t.type === 'SELL') {
                            if (t.price > lastBuyPrice) winningTrades++;
                        }
                    }
                    const totalSellTrades = backtest.trades.filter(t => t.type === 'SELL').length;
                    const winRate = totalSellTrades > 0 ? Math.round((winningTrades / totalSellTrades) * 100) : 0;
                    backtestMsg = `\n📜 <b>AI 1-Year Backtest Proof:</b>\n` +
                                  `└ Win Rate: <b>${winRate}%</b> | Profit: <b>+${backtest.profitPercent}%</b>\n`;
                }

                // Fetch user holding info to provide personalized AI advice
                const holding = await Portfolio.findOne({ symbol, status: 'HOLDING', chatId: chatId.toString() });

                const { getStockAnalysis } = require('./services/aiService');
                const analysis = await getStockAnalysis(symbol, news, technicals, currentPrice, holding);
                
                if (analysis && analysis.action) {
                    const actionIcon = analysis.action === 'BUY' ? '🟢' : analysis.action === 'SELL' ? '🔴' : '🟡';
                    
                    const livePrice = currentPrice || 0;
                    let aiTarget = analysis.target;
                    if (!aiTarget || String(aiTarget).includes('N/A') || String(aiTarget).includes('None')) {
                        aiTarget = `₹${(livePrice * 1.05).toFixed(2)}`;
                    }
                    let aiSL = analysis.stopLoss;
                    if (!aiSL || String(aiSL).includes('N/A') || String(aiSL).includes('None')) {
                        aiSL = `₹${(livePrice * 0.95).toFixed(2)}`; // Widened to -5% to avoid false stop-loss on volatile stocks
                    }

                    let priceBlock = `💰 <b>Live Market Price:</b> ${priceText}\n`;
                    if (analysis.action === 'BUY') {
                        priceBlock += `🎯 <b>Target (Sell At):</b> ${aiTarget}\n`;
                        priceBlock += `🛡️ <b>Stop-Loss (Exit if drops to):</b> ${aiSL}\n`;
                        priceBlock += backtestMsg;
                    } else if (analysis.action === 'SELL') {
                        priceBlock += `🔴 <b>Exit now at market price:</b> ${priceText}\n`;
                    } else {
                        // HOLD — show next possible target if momentum recovers
                        priceBlock += `🎯 <b>Next Target (if momentum picks up):</b> ${aiTarget}\n`;
                        priceBlock += `🛡️ <b>Stop-Loss:</b> ${aiSL}\n`;
                    }

                    const brokerSymbol = symbol.replace('.NS', '').replace('.BO', '');

                    // ===== VERDICT LOGIC =====
                    // If user ALREADY HOLDS this stock → Show personalized HOLD/SELL advice
                    // Never show a confusing 'BUY' or 'SKIP' verdict for an existing holder
                    let verdictBlock = '';
                    let holdingStatusText = '';

                    if (holding) {
                        const currentProfit = currentPrice ? (((currentPrice - holding.buyPrice) / holding.buyPrice) * 100).toFixed(2) : 0;
                        const profitVal = parseFloat(currentProfit);
                        const profitEmoji = profitVal >= 0 ? '📈' : '📉';
                        const daysHeld = Math.floor((new Date() - new Date(holding.createdAt)) / (1000 * 60 * 60 * 24));
                        const targetPrice = (holding.buyPrice * 1.07).toFixed(2); // +7% target
                        const slPrice = (holding.buyPrice * 0.95).toFixed(2);  // -5% SL (wider, avoids false triggers)

                        holdingStatusText =
                            `🎒 <b>YOU OWN THIS STOCK</b>\n` +
                            `💵 Bought: ₹${holding.buyPrice} | Now: ₹${currentPrice || '?'}\n` +
                            `${profitEmoji} <b>Current P&L: ${currentProfit}%</b>\n` +
                            `📅 Days Held: <b>${daysHeld} day${daysHeld !== 1 ? 's' : ''}</b>\n` +
                            `🎯 Your Target: ₹${targetPrice} | 🛡️ Stop-Loss: ₹${slPrice}\n` +
                            `${'─'.repeat(28)}\n\n`;

                        // Smart verdict based on the situation
                        if (profitVal >= 5) {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `🏆 <b>VERDICT: TAKE PROFIT NOW</b>\n` +
                                `You are up ${currentProfit}%! You have hit your target. SELL NOW and lock in your profit. Don’t be greedy.`;
                        } else if (profitVal <= -5) {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `🔴 <b>VERDICT: STOP-LOSS HIT — SELL NOW</b>\n` +
                                `You are down ${currentProfit}%. Stop-Loss triggered. SELL to protect your remaining capital. Do not hold and hope.`;
                        } else if (daysHeld >= 3 && profitVal < 2) {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `⏱️ <b>VERDICT: TIME-STOP — SELL TODAY</b>\n` +
                                `You have held for ${daysHeld} days and momentum is weak. Sell today (even at ${currentProfit}%) and free up your capital for tomorrow's tip. Do not let your money sit idle.`;
                        } else if (analysis.action === 'SELL') {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `🔴 <b>VERDICT: SELL NOW</b>\n` +
                                `Technical signals are now BEARISH. Exit your position now at ₹${currentPrice} to protect your capital.`;
                        } else {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `🟡 <b>VERDICT: HOLD — Wait for Target</b>\n` +
                                `You have held for ${daysHeld} day${daysHeld !== 1 ? 's' : ''}. Target is ₹${targetPrice}. Keep holding. If it doesn't hit the target by Day 3, sell it.`;
                        }

                    } else {
                        // === NOT HOLDING → Show fresh BUY / SKIP verdict ===
                        if (analysis.action === 'BUY' && conf >= 75) {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `✅ <b>VERDICT: BUY NOW</b>\n` +
                                `Confidence is HIGH. Good trade to enter at ₹${currentPrice}.\n` +
                                `After buying, type: <code>/bought ${brokerSymbol} ${currentPrice} QUANTITY</code>`;
                        } else if (analysis.action === 'BUY' && conf < 75) {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `⚠️ <b>VERDICT: WAIT — Signal is Weak</b>\n` +
                                `Confidence is only ${conf}%. Signals are not strong enough. DO NOT buy right now. Wait for a stronger setup.`;
                        } else if (analysis.action === 'HOLD') {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `🚫 <b>VERDICT: DO NOT BUY NOW</b>\n` +
                                `Signals are mixed. This is NOT a good time to enter. Skip and wait for a clearer setup.`;
                        } else if (analysis.action === 'SELL') {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `🚫 <b>VERDICT: DO NOT BUY</b>\n` +
                                `AI signals are bearish. Do not enter this trade right now.`;
                        }
                    }

                    const conf = analysis.confidence || 0;
                    const confBar = conf >= 85 ? '🟢🟢🟢🟢🟢 VERY STRONG'
                                  : conf >= 75 ? '🟢🟢🟢🟢⬛ STRONG'
                                  : conf >= 65 ? '🟢🟢🟢⬛⬛ MODERATE'
                                  : '🟢🟢⬛⬛⬛ WEAK';
                    const riskEmoji = analysis.riskLevel === 'LOW' ? '✅ LOW'
                                    : analysis.riskLevel === 'HIGH' ? '🔴 HIGH'
                                    : '🟡 MEDIUM';

                    const finalMsg =
                        `🧠 <b>AI ANALYSIS: ${symbol}</b>\n` +
                        `${'─'.repeat(28)}\n\n` +
                        holdingStatusText +
                        `🔍 <b>Search in Groww/Zerodha:</b> <code>${brokerSymbol}</code>\n\n` +
                        priceBlock +
                        `\n<b>📊 Signal Confidence:</b> ${confBar}\n` +
                        `<b>⚠️ Risk Level:</b> ${riskEmoji}\n\n` +
                        `<b>🧠 Expert Analysis:</b>\n<i>${analysis.rationale}</i>` +
                        verdictBlock;

                    await bot.editMessageText(finalMsg, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
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
                const { getMarketMovers, getStockPrice } = require('./services/stockService');
                const { getGlobalTop5TradingTips } = require('./services/aiService');
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩⬛⬛⬛⬛⬛⬛] 25% - Scraping Breaking News...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                const news = await getLatestNews();
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩⬛⬛⬛⬛] 50% - Fetching Market Movers...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                const movers = await getMarketMovers();
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩🟩🟩⬛⬛] 75% - Checking Nifty 50 Market Direction...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                
                // === PROFESSIONAL CHECK: NIFTY 50 MARKET DIRECTION ===
                let niftyBanner = '';
                let niftyChange = null;
                try {
                    const niftyPrice = await getStockPrice('^NSEI'); // Nifty 50 index
                    const niftyQuote = require('yahoo-finance2').default;
                    const yf = new niftyQuote({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
                    const niftyData = await yf.quote('^NSEI');
                    niftyChange = niftyData ? niftyData.regularMarketChangePercent : null;
                    
                    if (niftyChange !== null) {
                        if (niftyChange <= -0.5) {
                            niftyBanner = `🔴 <b>MARKET DOWN: Nifty 50 is -${Math.abs(niftyChange).toFixed(2)}% today — DIP BUYING MODE</b>\n` +
                                          `💡 Strategy: AI is finding quality stocks that fell cheap due to market weakness and will bounce in 1-3 days.\n` +
                                          `────────────────────────────\n\n`;
                        } else if (niftyChange >= 0.3) {
                            niftyBanner = `🟢 <b>MARKET UP: Nifty 50 is +${niftyChange.toFixed(2)}% today — MOMENTUM MODE</b>\n` +
                                          `💡 Strategy: AI is finding stocks breaking out with strong upward momentum.\n` +
                                          `────────────────────────────\n\n`;
                        } else {
                            niftyBanner = `🟡 <b>MARKET FLAT: Nifty 50 is ${niftyChange >= 0 ? '+' : ''}${niftyChange.toFixed(2)}% today — SELECTIVE MODE</b>\n` +
                                          `💡 Strategy: Market is sideways. AI will only show HIGH confidence trades.\n` +
                                          `────────────────────────────\n\n`;
                        }
                    }
                } catch(e) { console.warn('Nifty check failed:', e.message); }

                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩🟩🟩🟩⬛] 85% - Quant AI crunching algorithms...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                const top5 = await getGlobalTop5TradingTips(news, movers, budget, priceRange, niftyChange);
                
                if (top5 && top5.error && top5.reason === 'RATE_LIMIT') {
                    await bot.editMessageText(`⚠️ <b>Google AI Rate Limit Exceeded!</b>\n\nYou are requesting too many tips too quickly, and the free Google AI quota is exhausted for this minute. Please wait 1-2 minutes and try again.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                } else if (top5 && top5.length > 0) {
                    await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩🟩🟩🟩🟩] 100% - Trades Generated!`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                    
                    // Fetch real prices to fix AI hallucinations, but keep AI's Risk/Reward ratio
                    for (let t of top5) {
                        try {
                            const realPrice = await getStockPrice(t.symbol);
                            if (realPrice && !isNaN(realPrice)) {
                                // Calculate AI's intended percentage gain/loss based on its hallucinated price
                                let targetMultiplier = 1.05;
                                let slMultiplier = 0.97;
                                
                                if (t.currentPrice && t.target && t.stopLoss) {
                                    const aiEntry = parseFloat(t.currentPrice.toString().replace(/[^0-9.]/g, ''));
                                    const aiTarget = parseFloat(t.target.toString().replace(/[^0-9.]/g, ''));
                                    const aiSL = parseFloat(t.stopLoss.toString().replace(/[^0-9.]/g, ''));
                                    
                                    if (aiEntry > 0 && aiTarget > 0) targetMultiplier = aiTarget / aiEntry;
                                    if (aiEntry > 0 && aiSL > 0) slMultiplier = aiSL / aiEntry;
                                }

                                t.currentPrice = realPrice;
                                if (t.action === 'BUY') {
                                    t.target = realPrice * targetMultiplier;
                                    t.stopLoss = realPrice * slMultiplier;
                                }
                            }
                        } catch(e) { console.error("Failed to fetch real price for", t.symbol); }
                    }

                    let msgText = `🎯 <b>TOP 5 AI SWING TRADES</b>\n<i>Professional multi-gate analysis</i>\n\n` + niftyBanner;
                    top5.forEach((t, i) => {
                        const companyStr = t.companyName ? ` — ${t.companyName}` : '';
                        const formatPrice = (p) => (p && typeof p === 'number') ? `₹${p.toFixed(2)}` : (p && !p.toString().includes('₹') ? `₹${p}` : p);
                        const confBar = t.confidence >= 85 ? '🟢🟢🟢🟢🟢' : t.confidence >= 75 ? '🟢🟢🟢🟢⬛' : '🟢🟢🟢⬛⬛';
                        
                        const brokerSymbol = t.symbol.replace('.NS', '').replace('.BO', '');
                        
                        msgText += `${i+1}\ufe0f\u20e3 <b>${t.symbol}</b>${companyStr}\n`;
                        msgText += `   \ud83d\udd0d <b>Search in Groww/Zerodha:</b> <code>${brokerSymbol}</code>\n`;
                        msgText += `   \ud83d\udfe2 <b>${t.action}</b> | \u23f3 Hold: <b>${t.duration}</b>\n`;
                        if (t.currentPrice) msgText += `   \ud83d\udcb0 <b>Buy At:</b> ${formatPrice(t.currentPrice)}\n`;
                        if (t.allocatedFunds && t.sharesToBuy) msgText += `   \ud83d\udcb5 Invest: <b>${t.allocatedFunds}</b> \u2192 <b>${t.sharesToBuy} shares</b>\n`;
                        msgText += `   \ud83c\udfaf <b>Target:</b> ${formatPrice(t.target) || 'N/A'} | \ud83d\udee1\ufe0f <b>SL:</b> ${formatPrice(t.stopLoss) || 'N/A'}\n`;
                        if (t.confidence) msgText += `   \ud83d\udcca <b>Confidence:</b> ${confBar} ${t.confidence}%\n`;
                        if (t.gatesPassed) msgText += `   \u2705 <b>Gates:</b> <i>${t.gatesPassed}</i>\n`;
                        msgText += `   \ud83e\udde0 <i>${t.rationale}</i>\n\n`;
                    });
                    
                    // Replace the progress bar with the final result!
                    await bot.editMessageText(msgText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                } else {
                    await bot.editMessageText(`⚠️ AI returned no results. Data format was invalid or completely rejected. Retrying with a different model automatically next time. Please type /tip again.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                }
            } catch (err) {
                console.error("TELEGRAM GLOBAL TIP ERROR:", err.message);
                try {
                    await bot.editMessageText(`⚠️ <b>AI temporarily unavailable.</b>\n\nAll AI models were tried. Please type <code>/tip</code> again in 30 seconds.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                } catch {
                    await bot.sendMessage(chatId, `⚠️ AI temporarily unavailable. Please try /tip again in 30 seconds.`);
                }
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
                
                const daysHeld = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                const timeLimit = item.timeLimit || 5;
                const daysLeft = timeLimit - daysHeld;
                const timeStatus = daysLeft <= 0 ? '⚠️ EXPIRED' : `${daysLeft}d left`;
                
                // Dynamic target: 5% if bullish momentum, 3% for conservative/neutral
                const target = (item.buyPrice * 1.05).toFixed(2);
                const stopLoss = (item.buyPrice * 0.97).toFixed(2);
                const profitStr = currentPrice ? ((currentPrice - item.buyPrice) / item.buyPrice * 100).toFixed(2) : '0';
                const profitEmoji = parseFloat(profitStr) >= 0 ? '📈' : '📉';
                holdingsList += `🔹 <b>${item.symbol}</b> [${timeStatus}]\n` +
                                `   💰 Buy: ₹${item.buyPrice} → Now: ₹${currentPrice || '?'} (${profitEmoji}${profitStr}%)\n` +
                                `   🎯 Target: ₹${target} | 🛡️ SL: ₹${stopLoss}\n`;
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

            bot.sendMessage(chatId, `🏆 <b>PORTFOLIO SUMMARY</b> 🏆\n\n` +
                                    `💰 <b>Active Invested:</b> ₹${totalInvested.toFixed(2)}\n` +
                                    `📈 <b>Live Value:</b> ₹${totalCurrentValue.toFixed(2)}\n` +
                                    `${unrealizedEmoji} <b>Unrealized Profit:</b> ${unrealizedSign}₹${totalUnrealizedProfit.toFixed(2)} (${unrealizedSign}${totalProfitPercent}%)\n\n` +
                                    `🏦 <b>BANKED HISTORY</b>\n` +
                                    `${realizedEmoji} <b>Realized Profit (SOLD):</b> ${realizedSign}₹${totalRealizedProfit.toFixed(2)}\n\n` +
                                    `💎 <b>NET GAINS:</b> ${totalUnrealizedProfit + totalRealizedProfit >= 0 ? '+' : ''}₹${(totalUnrealizedProfit + totalRealizedProfit).toFixed(2)}\n` +
                                    holdingsList, {parse_mode: 'HTML'});
        } catch (error) {
            console.error('Error calculating profit:', error);
            bot.sendMessage(chatId, `❌ Error calculating portfolio profit.`);
        }
    });

    // 5. /help — Full command list
    bot.onText(/\/(start|help)/, (msg) => {
        const chatId = msg.chat.id;
        const welcomeMsg =
            `🤖 <b>AI Portfolio Guardian — Command List</b> 🤖\n\n` +
            `<b>🛎️ TRACK A STOCK (after you buy it):</b>\n` +
            `<code>/bought ZOMATO 240 100</code>  — Price ₹240, Qty 100\n` +
            `<code>/bought ZOMATO 10000</code>    — Invested ₹10,000 (auto-calculates qty)\n` +
            `<code>/bought ZOMATO 240 100 3</code> — Same + 3-day time-stop limit\n\n` +
            `<b>💰 GET A PRICE:</b>\n` +
            `<code>/price WIPRO</code>  — Live price + Target &amp; Stop-Loss\n\n` +
            `<b>🧠 GET AI TIP:</b>\n` +
            `<code>/tip RELIANCE</code>  — BUY/SELL/HOLD with exact entry, target &amp; SL prices\n` +
            `<code>/tip</code>           — Top 5 best trades right now\n` +
            `<code>/tip 10000</code>     — Top 5 trades for ₹10,000 budget\n` +
            `<code>/tip 100-500</code>   — Top 5 trades priced ₹100-₹500\n\n` +
            `<b>📈 MARKET DATA:</b>\n` +
            `<code>/movers</code>   — Today's top gainers &amp; losers with targets\n\n` +
            `<b>🏆 PORTFOLIO:</b>\n` +
            `<code>/profit</code>   — Full P&amp;L summary with buy/target/SL per stock\n` +
            `<code>/sold ZOMATO 260 100</code> — Log a sell and bank your profit\n\n` +
            `<i>🔔 I monitor your portfolio 24/7 and alert you automatically when to BUY, SELL, or if breaking news hits your stocks!</i>`;
                           
        bot.sendMessage(chatId, welcomeMsg, {parse_mode: 'HTML'});
    });

    // 6. /movers — Top Market Gainers & Losers with Target+SL on gainers
    bot.onText(/\/movers/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🚀 Scanning markets for top movers...`);
        try {
            const { getMarketMovers } = require('./services/stockService');
            const movers = await getMarketMovers();
            let moverMsg = `📈 <b>TOP 5 GAINERS (Potential BUY):</b>\n`;
            movers.gainers.slice(0, 5).forEach(g => {
                const target = g.price ? `₹${(g.price * 1.05).toFixed(2)}` : 'N/A';
                const sl = g.price ? `₹${(g.price * 0.97).toFixed(2)}` : 'N/A';
                moverMsg += `🟢 <b>${g.symbol}</b> (${g.name}): ₹${g.price} (+${g.changePercent}%)\n`;
                moverMsg += `   🎯 Target: <b>${target}</b> | 🛡️ SL: <b>${sl}</b>\n`;
            });
            moverMsg += `\n📉 <b>TOP 5 LOSERS (Caution):</b>\n`;
            movers.losers.slice(0, 5).forEach(l => {
                moverMsg += `🔴 <b>${l.symbol}</b> (${l.name}): ₹${l.price} (${l.changePercent}%)\n`;
            });
            moverMsg += `\n<i>Run /tip SYMBOL for a full AI analysis on any of these!</i>`;
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
        // Fetch prices with a delay between each stock to avoid Yahoo Finance rate-limiting (HTTP 429 / 2-min block)
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        for(let item of holdings) {
            if(!currentPrices[item.symbol]) {
                currentPrices[item.symbol] = await getStockPrice(item.symbol);
                technicalData[item.symbol] = await getTechnicalIndicators(item.symbol);
                advancedData[item.symbol] = await getAdvancedMetrics(item.symbol);
                await sleep(600); // 600ms gap prevents rate-limit block
            }
        }
        for(let item of watchlist) {
            if(!currentPrices[item.symbol]) {
                currentPrices[item.symbol] = await getStockPrice(item.symbol);
                technicalData[item.symbol] = await getTechnicalIndicators(item.symbol);
                advancedData[item.symbol] = await getAdvancedMetrics(item.symbol);
                await sleep(600); // 600ms gap prevents rate-limit block
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
                            const currentPrice = currentPrices[rec.symbol];
                            const profitPercent = currentPrice ? ((currentPrice - owner.buyPrice) / owner.buyPrice * 100).toFixed(2) : null;
                            const profitEmoji = profitPercent >= 0 ? '📈' : '📉';
                            const profitText = profitPercent !== null ? `${profitEmoji} P&L: ${profitPercent >= 0 ? '+' : ''}${profitPercent}%` : '';
                            
                            const actionIcon = rec.action === 'SELL' ? '🔴' : rec.action === 'BUY' ? '🟢' : '🟡';
                            let actionLabel = rec.action;
                            if (rec.action === 'SELL' && profitPercent >= 3) actionLabel = '✅ SELL (Profit Target Hit!)';
                            else if (rec.action === 'SELL' && profitPercent <= -5) actionLabel = '🛑 SELL (Stop-Loss Hit — Cut Loss Now)';
                            else if (rec.action === 'SELL') actionLabel = '⏰ SELL (Time Limit Reached)';
                            else if (rec.action === 'HOLD') actionLabel = '⏳ HOLD (Wait for Recovery)';

                            const marketOpen = isMarketOpen();
                            const timingNote = marketOpen
                                ? `⏰ <b>Market is OPEN</b> — You can execute this trade RIGHT NOW.`
                                : `🔒 <b>Market is CLOSED.</b> Execute this trade when market opens <b>${nextMarketOpenStr()}</b>.`;

                            const priceLabel = marketOpen ? 'Live Price Now' : 'Last Closing Price';

                            const alertMsg = `${actionIcon} <b>AI ALERT: ${rec.symbol}</b>\n\n` +
                                             `💰 <b>You Bought At:</b> ₹${owner.buyPrice}\n` +
                                             `📊 <b>${priceLabel}:</b> ₹${currentPrice || 'N/A'}\n` +
                                             `${profitText}\n\n` +
                                             `<b>Action: ${actionLabel}</b>\n` +
                                             `${timingNote}\n\n` +
                                             `🧠 <b>Why:</b> ${rec.reasoning}`;
                            
                            if (owner.chatId !== 'UI_USER') {
                                bot.sendMessage(owner.chatId, alertMsg, {parse_mode: 'HTML'});
                            } else {
                                const allUsers = await Portfolio.distinct('chatId');
                                const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
                                for (let tId of telegramUsers) {
                                    bot.sendMessage(tId, alertMsg, {parse_mode: 'HTML'});
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
        const marketOpen = isMarketOpen();

        for(let item of holdings) {
            const currentPrice = await getStockPrice(item.symbol);
            if(currentPrice) {
                const profitPercentage = ((currentPrice - item.buyPrice) / item.buyPrice) * 100;
                const priceLabel = marketOpen ? 'Live Price' : 'Last Closing Price';
                const timingLine = marketOpen
                    ? `⏰ Market is <b>OPEN</b> — Execute this trade <b>RIGHT NOW</b>.`
                    : `🔒 Market is <b>CLOSED</b>. Act when market opens <b>${nextMarketOpenStr()}</b>.`;

                // 1. Take-Profit Alert (+5%) — only fire during market hours OR store for morning
                if (profitPercentage >= 5) {
                    const tpKey = `${item._id}_TP`;
                    if (!sentAlertsMemory.has(tpKey)) {
                        const alertMsg = `🎯 <b>TAKE PROFIT ALERT: ${item.symbol}</b>\n\n` +
                                         `💰 <b>Buy Price:</b> ₹${item.buyPrice}\n` +
                                         `🤑 <b>${priceLabel}:</b> ₹${currentPrice} (+${profitPercentage.toFixed(2)}%)\n\n` +
                                         `✅ You have reached your +5% profit target!\n` +
                                         `${timingLine}`;
                        const sendFn = (cId) => bot.sendMessage(cId, alertMsg, {parse_mode: 'HTML'});
                        if (item.chatId !== 'UI_USER') { sendFn(item.chatId); } else {
                            const telegramUsers = (await Portfolio.distinct('chatId')).filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) sendFn(tId);
                        }
                        sentAlertsMemory.add(tpKey);
                    }
                }
                
                // 2. Stop-Loss Alert (-5%)
                if(profitPercentage <= -5) {
                    const slKey = `${item._id}_SL`;
                    if (!sentAlertsMemory.has(slKey)) {
                        const alertMsg = `🛑 <b>STOP-LOSS ALERT: ${item.symbol}</b>\n\n` +
                                         `💰 <b>Buy Price:</b> ₹${item.buyPrice}\n` +
                                         `🚨 <b>${priceLabel}:</b> ₹${currentPrice} (${profitPercentage.toFixed(2)}%)\n\n` +
                                         `⚠️ Your stock has dropped -5%. Cut your loss now to protect your capital.\n` +
                                         `${timingLine}`;
                        const sendFn = (cId) => bot.sendMessage(cId, alertMsg, {parse_mode: 'HTML'});
                        if (item.chatId !== 'UI_USER') { sendFn(item.chatId); } else {
                            const telegramUsers = (await Portfolio.distinct('chatId')).filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) sendFn(tId);
                        }
                        sentAlertsMemory.add(slKey);
                    }
                }

                // 3. Bad Breaking News Alert (fires any time — market is not needed for news)
                const badNews = news.find(n => 
                    (n.title.includes(item.symbol.replace('.NS', '')) || n.description.includes(item.symbol.replace('.NS', ''))) &&
                    /(crash|fall|drop|warning|fraud|loss|sell|downgrade)/i.test(n.title + n.description)
                );
                if (badNews) {
                    const newsKey = `${item._id}_NEWS_${badNews.title.substring(0,20)}`;
                    if (!sentAlertsMemory.has(newsKey)) {
                        const newsMsg = `📰 <b>BAD NEWS ALERT: ${item.symbol}</b>\n\n` +
                                        `⚠️ <b>Headline:</b> ${badNews.title}\n\n` +
                                        `This negative news might hurt your stock.\n` +
                                        `${timingLine}`;
                        const sendFn = (cId) => bot.sendMessage(cId, newsMsg, {parse_mode: 'HTML'});
                        if (item.chatId !== 'UI_USER') { sendFn(item.chatId); } else {
                            const telegramUsers = (await Portfolio.distinct('chatId')).filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) sendFn(tId);
                        }
                        sentAlertsMemory.add(newsKey);
                    }
                }

                // 4. Good Breaking News Alert
                const goodNews = news.find(n => 
                    (n.title.includes(item.symbol.replace('.NS', '')) || n.description.includes(item.symbol.replace('.NS', ''))) &&
                    /(surge|jump|rise|profit|growth|buy|upgrade|record|win|success|deal)/i.test(n.title + n.description)
                );
                if (goodNews && !badNews) {
                    const goodNewsKey = `${item._id}_GOODNEWS_${goodNews.title.substring(0,20)}`;
                    if (!sentAlertsMemory.has(goodNewsKey)) {
                        const newsMsg = `🚀 <b>BULLISH NEWS ALERT: ${item.symbol}</b>\n\n` +
                                        `📰 <b>Headline:</b> ${goodNews.title}\n\n` +
                                        `Great news dropped! Your stock may surge.\n` +
                                        `${timingLine}`;
                        const sendFn = (cId) => bot.sendMessage(cId, newsMsg, {parse_mode: 'HTML'});
                        if (item.chatId !== 'UI_USER') { sendFn(item.chatId); } else {
                            const telegramUsers = (await Portfolio.distinct('chatId')).filter(id => id !== 'UI_USER');
                            for (let tId of telegramUsers) sendFn(tId);
                        }
                        sentAlertsMemory.add(goodNewsKey);
                    }
                }
            }
        }
    } catch(err) {
        console.error('Error in Auto-Alert CRON:', err);
    }
});

// PROACTIVE AI TIP BROADCASTER (Runs every 2 hours, ONLY during market hours)
cron.schedule('0 */2 * * *', async () => {
    if (!bot) return;
    // Skip proactive tips outside market hours — prices are stale
    if (!isMarketOpen()) {
        console.log('Proactive Tip: Market closed, skipping broadcast.');
        return;
    }
    try {
        console.log('Scanning for new Proactive AI Tips...');
        const { getLatestNews } = require('./services/newsService');
        const { getMarketMovers } = require('./services/stockService');
        const { getGlobalTop5TradingTips } = require('./services/aiService');
        
        const news = await getLatestNews();
        const movers = await getMarketMovers();
        const top5 = await getGlobalTop5TradingTips(news, movers, null, null);
        
        if (top5 && top5.length > 0) {
            // Fix AI hallucinated price BEFORE sending notification
            for (let t of top5) {
                try {
                    const realPrice = await getStockPrice(t.symbol);
                    if (realPrice && !isNaN(realPrice)) {
                        let targetMultiplier = 1.05;
                        let slMultiplier = 0.97;
                        if (t.currentPrice && t.target && t.stopLoss) {
                            const aiEntry = parseFloat(t.currentPrice.toString().replace(/[^0-9.]/g, ''));
                            const aiTarget = parseFloat(t.target.toString().replace(/[^0-9.]/g, ''));
                            const aiSL = parseFloat(t.stopLoss.toString().replace(/[^0-9.]/g, ''));
                            if (aiEntry > 0 && aiTarget > 0) targetMultiplier = aiTarget / aiEntry;
                            if (aiEntry > 0 && aiSL > 0) slMultiplier = aiSL / aiEntry;
                        }
                        t.currentPrice = realPrice;
                        t.target = `₹${(realPrice * targetMultiplier).toFixed(2)}`;
                        t.stopLoss = `₹${(realPrice * slMultiplier).toFixed(2)}`;
                    }
                } catch(e) {}
            }

            const bestTip = top5[0];
            const allUsers = await Portfolio.distinct('chatId');
            
            for (let chatId of allUsers) {
                if (chatId !== 'UI_USER') {
                    const proactiveKey = `${chatId}_PROACTIVE_${bestTip.symbol}`;
                    if (!sentAlertsMemory.has(proactiveKey)) {
                        const liveEntryPrice = typeof bestTip.currentPrice === 'number'
                            ? `₹${bestTip.currentPrice.toFixed(2)}`
                            : bestTip.currentPrice || 'N/A';
                        const tipMsg = `🌟 <b>NEW AI OPPORTUNITY FOUND!</b>\n\n` +
                                       `Based on live market data right now:\n\n` +
                                       `📈 <b>${bestTip.symbol}</b> — ${bestTip.companyName || ''}\n` +
                                       `💰 <b>Buy At (LIVE Entry):</b> ${liveEntryPrice}\n` +
                                       `🟢 <b>Action:</b> ${bestTip.action}\n` +
                                       `🎯 <b>Target:</b> ${bestTip.target} | 🛡️ <b>SL:</b> ${bestTip.stopLoss}\n\n` +
                                       `🧠 <b>Why?</b> ${bestTip.rationale}\n\n` +
                                       `⏰ Market is <b>OPEN</b> — Act NOW!\n` +
                                       `<i>Use /bought ${bestTip.symbol} to start tracking.</i>`;
                        
                        bot.sendMessage(chatId, tipMsg, {parse_mode: 'HTML'});
                        sentAlertsMemory.add(proactiveKey);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error broadcasting tip:', err);
    }
});

// ─── MORNING MARKET OPEN BELL (9:15 AM IST, Mon–Fri) ─────────────────────────
// Resets the spam-guard and sends a morning portfolio summary with what to do today
cron.schedule('15 3 * * 1-5', async () => {
    // 9:15 AM IST = 3:15 AM UTC
    if (!bot) return;
    // Reset sentAlertsMemory so today's fresh alerts can fire
    sentAlertsMemory.clear();
    console.log('[Morning Bell] sentAlertsMemory reset. Market is now OPEN.');

    try {
        const holdings = await Portfolio.find({ status: 'HOLDING' });
        if (!holdings || holdings.length === 0) return;

        // Build a morning portfolio snapshot
        const allUsers = await Portfolio.distinct('chatId');
        const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
        if (telegramUsers.length === 0) return;

        let summaryLines = [];
        for (let item of holdings) {
            const currentPrice = await getStockPrice(item.symbol);
            if (currentPrice) {
                const pct = ((currentPrice - item.buyPrice) / item.buyPrice * 100).toFixed(2);
                const pctEmoji = pct >= 0 ? '📈' : '📉';
                const daysHeld = Math.floor((Date.now() - new Date(item.createdAt)) / 86400000);
                summaryLines.push(`• <b>${item.symbol}</b>: Open ₹${currentPrice} | P&L ${pct >= 0 ? '+' : ''}${pct}% ${pctEmoji} | Day ${daysHeld}/${item.timeLimit || 5}`);
            }
        }

        if (summaryLines.length > 0) {
            const bellMsg = `🔔 <b>MARKET OPEN — 9:15 AM IST</b> 🔔\n\n` +
                            `Good morning! Here is your portfolio snapshot for today:\n\n` +
                            summaryLines.join('\n') +
                            `\n\n💡 The AI will monitor your stocks during market hours and alert you if anything needs action.\n` +
                            `📊 Type /profit to see your full portfolio details.`;
            for (let chatId of telegramUsers) {
                bot.sendMessage(chatId, bellMsg, {parse_mode: 'HTML'});
            }
        }
    } catch (err) {
        console.error('[Morning Bell] Error:', err);
    }
}, { timezone: 'UTC' });
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
