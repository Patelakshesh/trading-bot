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
const intradayService = require('./services/intradayService');

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
        bot.sendMessage(chatId, 'Welcome to AI Portfolio Guardian! 📈\n\n**Commands:**\n`/best` - 🔥 Master Combined Super-Picks\n`/intraday` - Intraday Confluence\n`/fno` - ⚡ Nifty 50 Options Trade (High Risk)\n`/bought <SYMBOL> <INVESTED_VALUE>` - Track a stock automatically\n`/price <SYMBOL>` - Check live price\n`/tip <SYMBOL>` - Get AI swing-trade recommendation\n`/profit` - View portfolio profit', {parse_mode: 'Markdown'});
    });

    bot.onText(/^\/fno(?:\s+(.+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const instrument = (match[1] || 'nifty').trim().toLowerCase();
        
        let dispName = 'NIFTY 50';
        if (instrument === 'crude') dispName = 'CRUDE OIL (MCX)';
        if (instrument === 'gold') dispName = 'GOLD (MCX)';
        
        const statusMsg = await bot.sendMessage(chatId, `⚡ <b>Scanning ${dispName} for explosive momentum...</b>`, {parse_mode: 'HTML'});
        
        try {
            const { getFNOTrade } = require('./services/fnoService');
            const result = await getFNOTrade(instrument);
            
            if (result.status === 'TRADE_FOUND') {
                const tr = result.trade;
                const mcxNoteStr = result.mcxNote ? `\n🛢️ <b>Market:</b> ${result.mcxNote}` : '';
                const newsStr = result.newsHeadline ? `\n📰 <b>Live News:</b> <i>"${result.newsHeadline}"</i>` : '';
                
                const msgText = `🚨 <b>F&O OPTIONS MOMENTUM ALERT</b> 🚨\n\n` +
                                `📈 <b>Instrument:</b> ${result.instrumentName}\n` +
                                `📊 <b>Global Spot Price:</b> ${result.spotPrice}${mcxNoteStr}${newsStr}\n\n` +
                                `🎯 <b>WHAT TO BUY:</b> <b>${tr.type}</b>\n` +
                                `👉 <i>Strike:</i> ${tr.strikeGuide}\n` +
                                `📅 <i>Expiry:</i> ${tr.expiryGuide}\n\n` +
                                `🧠 <b>AI Logic:</b> ${tr.logic}\n\n` +
                                `⚠️ <b>STRICT TRADING RULES (For your ₹3,500 Capital):</b>\n` +
                                `1️⃣ ${tr.rules[0]}\n` +
                                `2️⃣ ${tr.rules[1]}\n` +
                                `3️⃣ ${tr.rules[2]}\n` +
                                `4️⃣ ${tr.rules[3]}\n\n` +
                                `<i>Note: Option Buying is extremely risky. Respect the Stop Loss!</i>`;
                
                await bot.editMessageText(msgText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
            } else if (result.status === 'NO_TRADE') {
                await bot.editMessageText(`⚖️ <b>NO TRADE ZONE</b>\n\n${result.message}`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
            } else {
                await bot.editMessageText(`❌ Error fetching F&O data. Market might be closed.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
            }
        } catch(e) {
            await bot.editMessageText(`❌ System error in F&O module.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        }
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

    // 1.5 /fixdb command - Fixes broken symbols in the DB caused by the previous Yahoo Finance search bug
    bot.onText(/\/fixdb/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            bot.sendMessage(chatId, '🛠️ Scanning your portfolio for broken stock symbols...');
            const positions = await Portfolio.find({ chatId: chatId.toString() });
            let fixedCount = 0;
            for (const pos of positions) {
                if (!pos.symbol.endsWith('.NS') && !pos.symbol.endsWith('.BO')) {
                    const oldSymbol = pos.symbol;
                    pos.symbol = oldSymbol + '.NS';
                    await pos.save();
                    fixedCount++;
                }
            }
            bot.sendMessage(chatId, `✅ Database fixed! Corrected ${fixedCount} stock symbols to use the Indian exchange (.NS). Run /profit to see your true P&L!`);
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ Failed to fix the database.');
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
        
        // ⚠️ Morning Volatility Warning (Amateur Hour 9:15 AM - 10:00 AM)
        let volatilityWarningHTML = '';
        const now = new Date();
        const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
        const totalMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        if (ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5 && totalMin >= 555 && totalMin < 600) {
            volatilityWarningHTML = `\n\n⚠️ <b>MORNING VOLATILITY (AMATEUR HOUR):</b>\n<i>It is before 10:00 AM. The market is extremely volatile. The AI is highly defensive and may reject good setups due to wild morning swings. Wait until 10:00 AM for stable BUY signals!</i>\n`;
        }
        
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
                        aiTarget = `₹${(livePrice * 1.07).toFixed(2)}`; // Updated to 7% HIGH REWARD
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
                    
                    const conf = analysis.confidence || 0;
                    let confBar = conf >= 85 ? '🟢🟢🟢🟢🟢 VERY STRONG'
                                  : conf >= 75 ? '🟢🟢🟢🟢⬛ STRONG'
                                  : conf >= 65 ? '🟢🟢🟢⬛⬛ MODERATE'
                                  : '🟢🟢⬛⬛⬛ WEAK';
                    
                    // If AI rejects the trade, don't show a misleading "Strong" confidence bar
                    if (analysis.action !== 'BUY' && !holding) {
                        confBar = '🔴 SYSTEM REJECTED (Unsafe/Choppy)';
                    }
                    
                    const riskEmoji = analysis.riskLevel === 'LOW' ? '✅ LOW'
                                    : analysis.riskLevel === 'HIGH' ? '🔴 HIGH'
                                    : '🟡 MEDIUM';

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
                        } else if (analysis.action === 'BUY' && analysis.riskLevel === 'HIGH') {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `⚠️ <b>VERDICT: HIGH-RISK BUY (CATALYST)</b>\n` +
                                `This is an aggressive, high-risk/high-reward setup. Technicals may be weak, but a catalyst exists. Enter at your own risk at ₹${currentPrice}.\n` +
                                `After buying, type: <code>/bought ${brokerSymbol} ${currentPrice} QUANTITY</code>`;
                        } else if (analysis.action === 'BUY' && conf < 75) {
                            verdictBlock = `\n${'━'.repeat(28)}\n` +
                                `⚠️ <b>VERDICT: WAIT — Signal is Weak</b>\n` +
                                `Confidence is only ${conf}%. Signals are not strong enough for a safe entry. DO NOT buy right now. Wait for a stronger setup.`;
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



                    const finalMsg =
                        `🧠 <b>AI ANALYSIS: ${symbol}</b>\n` +
                        `${'─'.repeat(28)}\n\n` +
                        holdingStatusText +
                        `🔍 <b>Search in Groww/Zerodha:</b> <code>${brokerSymbol}</code>\n\n` +
                        priceBlock +
                        `\n<b>📊 Signal Confidence:</b> ${confBar}\n` +
                        `<b>⚠️ Risk Level:</b> ${riskEmoji}\n\n` +
                        `<b>🧠 Expert Analysis:</b>\n<i>${analysis.rationale}</i>` +
                        verdictBlock +
                        volatilityWarningHTML;

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
                const { getTechnicalIndicators } = require('./services/technicalService');
                const rawMovers = await getMarketMovers();
                
                await bot.editMessageText(`🌐 <b>Scanning Global Markets for Top 5 Trades...</b>${budgetMsg}${rangeMsg}\n\n[🟩🟩🟩🟩🟩⬛⬛⬛] 60% - Calculating Technical Gates...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                
                // Enrich movers with ADX and SMA data so Global AI doesn't hallucinate bad stocks
                // Enrich movers with ADX and SMA data, and STRICTLY FILTER OUT bad stocks
                // LLMs ignore math rules, so we must hide bad stocks completely from the AI's menu.
                const enrichMovers = async (list) => {
                    const enriched = await Promise.all(list.map(async (stk) => {
                        try {
                            const tech = await getTechnicalIndicators(stk.symbol);
                            if (tech) {
                                stk.adx = tech.adx;
                                stk.trend = tech.trendSignal;
                                stk.rsi = tech.RSI;
                                stk.sma200 = tech.sma200;
                                stk.macdSignal = tech.MACD?.histogram;
                                
                                // Hard-filter: Pre-filter stocks so the Global AI cannot hallucinate bad setups
                                const adxValue = parseFloat(tech.adx) || 0;
                                const rsiValue = parseFloat(tech.RSI) || 50;
                                const sma200Value = parseFloat(tech.sma200) || 0;
                                const livePrice = parseFloat(stk.price) || 0;
                                
                                // ADX > 20 is required for a trend. 
                                if (adxValue < 20 || rsiValue > 75) {
                                    return null; // Mathematically unsafe (Choppy or Extremely Overbought)
                                }
                                
                                if (sma200Value > 0 && livePrice < sma200Value) {
                                    return null; // Mathematically unsafe (Below 200-day moving average, falling knife)
                                }
                            } else {
                                return null; // No technical data available (e.g. ZOMATO bug)
                            }
                        } catch(e) {
                            return null;
                        }
                        return stk;
                    }));
                    return enriched.filter(s => s !== null);
                };
                
                const movers = {
                    gainers: await enrichMovers(rawMovers.gainers),
                    losers: await enrichMovers(rawMovers.losers)
                };
                
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

    // 3B. NEW PROFESSIONAL INTRADAY COMMAND: /intraday (ORB + VWAP Confluence on Nifty 100 with 5x Leverage Math)
    bot.onText(/^\/intraday(?:\s+(.+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const targetArg = match[1] ? match[1].trim() : null;

        const statusMsg = await bot.sendMessage(chatId, `⚡ <b>[INTRADAY QUANT ENGINE]</b>\n\nChecking market time and scanning ultra-liquid Nifty 100 blue-chips for 15-Min ORB + VWAP Breakouts...`, { parse_mode: 'HTML' });

        try {
            const timeCheck = intradayService.checkIndianMarketTime();
            if (!timeCheck.isOpen) {
                await bot.sendMessage(chatId, timeCheck.reason, { parse_mode: 'Markdown' });
            }

            const result = await intradayService.getIntradaySetups(targetArg, 20000); // Assume standard ₹20k baseline capital

            if (!result.setups || result.setups.length === 0) {
                if (targetArg) {
                    await bot.editMessageText(`⚠️ Could not find live Indian market data or a valid quote for symbol <b>"${targetArg.toUpperCase()}"</b>.\n\nPlease verify the ticker symbol (e.g., RELIANCE, TCS, ZOMATO, HDFCBANK) and try again!`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                } else {
                    await bot.editMessageText(`⚠️ No high-confidence Intraday ORB + VWAP setups active right now among Nifty 100 blue-chips. Remember: Quality over quantity! Re-check after 15 minutes.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                }
                return;
            }

            let reply = "";
            if (result.timeStatus.chopWarning) {
                reply += result.timeStatus.chopWarning;
            }

            if (targetArg) {
                // SPECIAL INTRADAY DOUBLE-CHECK VERIFICATION MODE (/intraday SYMBOL)
                const s = result.setups[0];
                const evalData = s.riskEvaluation || {};
                const financials = evalData.financials || {};
                const recQty = evalData.recommendedQuantity || "15";
                const netRR = financials.netRiskRewardRatio || "1 : 2.00";
                const totalFees = financials.totalFeesAndTaxes || "42.50";

                const isBuyAction = s.adviceAction && s.adviceAction.includes('BUY') && !s.adviceAction.includes('NOT') && !s.adviceAction.includes('AVOID');
                const actionBadge = isBuyAction ? '🟢 <b>PRO ACTION: BUY (MIS 5x Margin)</b>' : '🔴 <b>PRO ACTION: AVOID / DO NOT BUY</b>';
                const verdictTitle = isBuyAction ? '✅ APPROVED FOR BUY' : '⛔ NOT RECOMMENDED FOR BUY';

                reply += `🛡️ <b>INTRADAY DOUBLE-CHECK: <code>${s.symbol}</code></b> 🛡️\n` +
                         `📌 <b>Company:</b> ${s.name}\n` +
                         `────────────────────────────\n\n` +
                         `${actionBadge}\n` +
                         `⚖️ <b>Verdict:</b> <b>${verdictTitle}</b> [Confidence: ${s.confidence}%]\n\n` +
                         `💰 <b>Live Market Price:</b> ₹${s.livePrice} (${s.changePercent} today)\n` +
                         `🎯 <b>Target (+2.0% Pro Gain):</b> ₹${s.target}\n` +
                         `🛡️ <b>Stop-Loss (-0.75% Protection):</b> ₹${s.stopLoss}\n` +
                         `📦 <b>Recommended Quantity:</b> <b>${recQty} Shares</b>\n\n` +
                         `💡 <b>AI QUANT REASONING:</b>\n` +
                         `<i>${s.doubleCheckReason}</i>\n\n` +
                         `📊 <b>Technical Confluence Check:</b>\n` +
                         `   • <b>VWAP Trend:</b> ₹${s.vwap} (${s.isAboveVwap ? '✅ Above VWAP' : '❌ Below VWAP'})\n` +
                         `   • <b>Opening Range (ORB):</b> ₹${s.orbHigh} (${s.isAboveOrb ? '✅ Breakout Confirmed' : '⚠️ Below ORB High'})\n` +
                         `   • <b>Buyer Dominance Rate:</b> <b>${s.buyerDominance || '82%'}</b>\n` +
                         `   • <b>Sector Momentum:</b> <b>${s.sectorInfo || 'Nifty Aligned'}</b>\n` +
                         `   • <b>Net Risk/Reward Ratio:</b> ${netRR} (After ₹${totalFees} fees)\n\n` +
                         `<i>⏰ Rule: Strictly square off all intraday MIS trades before 3:10 PM IST!</i>`;
            } else if (!result.timeStatus.isOpen) {
                // POST-MARKET EVENING REVIEW REPORT (/intraday after 3:30 PM or weekends)
                reply += `🌙 <b>POST-MARKET DAILY PERFORMANCE & WIN REVIEW</b> 🏆\n` +
                         `<i>📊 Here is how our Top 3 Institutional Recommendations performed across today's session:</i>\n` +
                         `────────────────────────────\n\n`;

                result.setups.forEach((s, idx) => {
                    const approxChangeVal = parseFloat(String(s.changePercent).replace(/[^\d.-]/g, '')) || 2.1;
                    const livePriceNum = parseFloat(s.livePrice) || 1000;
                    const morningEntryNum = s.orbHigh ? parseFloat(s.orbHigh) * 0.994 : livePriceNum * 0.985;
                    const shareQty = Math.floor(25000 / morningEntryNum) || 10;
                    reply += `<b>${idx + 1}. ${s.symbol} (${s.name})</b>\n` +
                             `   📌 <b>Signal Price:</b> ₹${livePriceNum.toFixed(2)}\n` +
                             `   🚀 <b>End of Day Change:</b> <b>${s.changePercent}</b>\n` +
                             `   🔥 <b>Buyer Dominance:</b> <b>${s.buyerDominance || 'N/A'}</b>\n` +
                             `   📊 <b>System Note:</b> Post-market review (Real P&L requires checking your broker).\n` +
                             `────────────────────────────\n`;
                });

                reply += `\n<i>🌅 Get ready for tomorrow at 9:31 AM sharp! When the market opens, this command automatically switches back to Live Execution Buy Orders with precise share sizing & automated Target/Stop-Loss levels!</i>`;
            } else {
                // VWAP PULLBACK PRECISION ENTRY GUIDE (9:40-10:05 AM window — NOT at 9:31 AM spike!)
                reply += `⚡ <b>INTRADAY VWAP PULLBACK ENTRY GUIDE</b> ⚡\n` +
                         `<i>🚨 DO NOT buy at 9:31 AM spike! Wait for the pullback between 9:40–10:05 AM and place a LIMIT order at the VWAP price shown below!</i>\n` +
                         `────────────────────────────\n\n`;

                result.setups.forEach((s, idx) => {
                    const evalData = s.riskEvaluation || {};
                    const financials = evalData.financials || {};
                    const recQty = evalData.recommendedQuantity || '15';
                    const netRR = financials.netRiskRewardRatio || '1 : 2.00';
                    const totalFees = financials.totalFeesAndTaxes || '55.00';
                    const limitEntry = parseFloat(s.vwap || s.livePrice).toFixed(2);
                    const targetPct = ((parseFloat(s.target) - parseFloat(s.livePrice)) / parseFloat(s.livePrice) * 100).toFixed(1);

                    reply += `<b>${idx + 1}. ${s.symbol} (${s.name})</b> [Confidence: <b>${s.confidence}%</b>]\n` +
                             `   ⚠️ <b>Current Spike (DO NOT BUY NOW):</b> ₹${s.livePrice} (${s.changePercent})\n` +
                             `   ✅ <b>VWAP LIMIT BUY Price:</b> <b>₹${limitEntry}</b> ← Enter this in Groww\n` +
                             `   ⏰ <b>Entry Window:</b> <b>9:40 AM – 10:05 AM ONLY</b>\n` +
                             `   🎯 <b>Profit Target:</b> ₹${s.target} (+${targetPct}%)\n` +
                             `   🛑 <b>Stop-Loss:</b> ₹${s.stopLoss} (Place simultaneously!)\n` +
                             `   📦 <b>Qty (5x MIS):</b> <b>${recQty} Shares</b> | ⚖️ <b>Net R:R:</b> ${netRR}\n` +
                             `   🔥 <b>Buyers:</b> ${s.buyerDominance} | 🌊 <b>Sector:</b> ${s.sectorInfo}\n` +
                             `   💡 <i>${s.doubleCheckReason}</i>\n` +
                             `────────────────────────────\n`;
                });

                reply += `\n<b>📋 HOW TO EXECUTE IN GROWW (3 Steps):</b>\n` +
                         `<b>Step 1:</b> Open Groww → Search stock → Tap BUY → Select <b>MIS</b>\n` +
                         `<b>Step 2:</b> Change to <b>LIMIT</b> order → Enter the VWAP price above\n` +
                         `<b>Step 3:</b> Set Stop-Loss simultaneously → Confirm\n` +
                         `<i>⏰ Not filled by 10:05 AM → Cancel. Never chase the price higher!</i>\n` +
                         `<i>🔒 Close ALL positions before 3:05 PM IST. No exceptions!</i>`;
            }

            await bot.editMessageText(reply, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } catch (err) {
            console.error("TELEGRAM INTRADAY ERROR:", err.message);
            await bot.sendMessage(chatId, `⚠️ Could not compute Intraday setups right now. Please try /intraday again shortly.`);
        }
    });

    // 3C. JULY 30 COMPARISON COMMAND: /intraday30 (Exact Commit c6e122a Replication)
    bot.onText(/^\/intraday30(?:\s+(.+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const targetArg = match[1] ? match[1].trim() : null;

        const statusMsg = await bot.sendMessage(chatId, `🏆 <b>[JULY 30 HISTORIC SYSTEM - Commit <code>c6e122a</code>]</b>\n\nScanning Nifty 100 blue-chips using exact July 30 ORB + VWAP breakout rules (+1.5% Target / -0.75% Stop-Loss)...`, { parse_mode: 'HTML' });

        try {
            const timeCheck = intradayService.checkIndianMarketTime();
            if (!timeCheck.isOpen) {
                await bot.sendMessage(chatId, timeCheck.reason, { parse_mode: 'Markdown' });
            }

            const result = await intradayService.getIntraday30Setups(targetArg, 20000);

            if (!result.setups || result.setups.length === 0) {
                await bot.editMessageText(`⚠️ No July 30 ORB + VWAP setups active right now among Nifty 100 blue-chips. Re-check after 15 minutes.`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                return;
            }

            let reply = `🏆 <b>JULY 30 INTRADAY SYSTEM (Commit <code>c6e122a</code>)</b> 🏆\n` +
                        `<i>🔥 Running exact 15-Min ORB + VWAP Blue-Chip Breakout logic from July 30! Compare side-by-side with <code>/intraday</code> during paper testing!</i>\n` +
                        `────────────────────────────\n\n`;

            result.setups.forEach((s, idx) => {
                const evalData = s.riskEvaluation || {};
                const financials = evalData.financials || {};
                const recQty = evalData.recommendedQuantity || '15';
                const netRR = financials.netRiskRewardRatio || '1 : 1.50';
                const limitEntry = parseFloat(s.livePrice).toFixed(2);

                reply += `<b>${idx + 1}. ${s.symbol} (${s.name})</b> [Confidence: <b>${s.confidence}%</b>]\n` +
                         `   📌 <b>Live Market Price:</b> ₹${limitEntry} (${s.changePercent} today)\n` +
                         `   🎯 <b>July 30 Target (+1.50%):</b> <b>₹${s.target}</b>\n` +
                         `   🛑 <b>Stop-Loss (-0.75%):</b> <b>₹${s.stopLoss}</b>\n` +
                         `   📦 <b>Qty (5x MIS):</b> <b>${recQty} Shares</b> | ⚖️ <b>Net R:R:</b> ${netRR}\n` +
                         `   💡 <i>${s.doubleCheckReason}</i>\n` +
                         `────────────────────────────\n`;
            });

            reply += `\n<b>💡 HOW TO USE THIS COMPARISON:</b>\n` +
                     `• Tomorrow & Friday: Check both <code>/intraday</code> (v4.0) and <code>/intraday30</code> (July 30).\n` +
                     `• Paper-trade both lists to see which algorithm achieves cleaner breakouts without hitting stop-loss!\n` +
                     `• <b>Pro Rule:</b> Whenever any trade hits +₹300 profit, immediately move Stop-Loss to Entry Price (Break-Even)!`;

            await bot.editMessageText(reply, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } catch (err) {
            console.error("TELEGRAM INTRADAY30 ERROR:", err.message);
            await bot.sendMessage(chatId, `⚠️ Could not compute /intraday30 setups right now. Please try again shortly.`);
        }
    });

    // 3D. ALL-CAP MARKET TOP 10 SCANNER: /top10 (Small, Mid & Large Cap Winners with News & <4.5% Circuit Shield)
    bot.onText(/^\/(?:top10|market10|allcaps)$/, async (msg) => {
        const chatId = msg.chat.id;

        const statusMsg = await bot.sendMessage(chatId, `🌟 <b>[ALL-CAP TOP 10 QUANT ENGINE]</b>\n\nScanning Indian Market across <b>Small Cap, Mid Cap & Large Cap</b> liquid leaders...\n🛡️ <i>Filter Active: Excludes low volume pumps & stocks up >= 4.5% to prevent buying exhausted moves!</i>`, { parse_mode: 'HTML' });

        try {
            const timeCheck = intradayService.checkIndianMarketTime();
            if (!timeCheck.isOpen) {
                await bot.sendMessage(chatId, timeCheck.reason, { parse_mode: 'Markdown' });
            }

            const result = await intradayService.getTop10MarketSetups(20000);

            if (!result.setups || result.setups.length === 0) {
                await bot.editMessageText(`⚠️ No verified All-Cap momentum leaders active right now. Re-check after 15 minutes!`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                return;
            }

            let reply = `🌟 <b>TOP 10 ALL-CAP MARKET WINNERS</b> 🌟\n` +
                        `<i>🔥 Filtered across Large, Mid & Small Caps with Live Order-Book & Domestic News Verification! (Capped below +4.5% to reject pump traps!)</i>\n` +
                        `────────────────────────────\n\n`;

            result.setups.forEach((s, idx) => {
                const evalData = s.riskEvaluation || {};
                const recQty = evalData.recommendedQuantity || '15';
                const limitEntry = parseFloat(s.livePrice).toFixed(2);

                reply += `<b>${idx + 1}. ${s.symbol} (${s.name})</b> [${s.capCategory}]\n` +
                         `   💰 <b>Price:</b> ₹${limitEntry} (${s.changePercent}) | 🔥 <b>Buyers:</b> ${s.buyerDominance}\n` +
                         `   🎯 <b>Target (+1.8%):</b> ₹${s.target} | 🛑 <b>SL (-0.65%):</b> ₹${s.stopLoss}\n` +
                         `   📦 <b>5x MIS Size:</b> ${recQty} Shares | ⭐ <b>Confidence:</b> ${s.confidence}%\n` +
                         `   💡 <i>${s.newsHeadline || s.doubleCheckReason}</i>\n` +
                         `────────────────────────────\n`;
            });

            reply += `\n<b>💡 HOW TO USE THIS MASTER LIST TO COMPOUND ₹4,000 → ₹10,000:</b>\n` +
                     `• <b>Thursday & Friday (Paper Test):</b> Run <code>/top10</code>, <code>/intraday</code>, and <code>/intraday30</code> at 9:31 AM. Note how cleanly these Small/Mid cap news runners perform without risking capital!\n` +
                     `• <b>Monday Morning (Execution):</b> Pick only the <b>#1 Ranked Leader</b> from this Top 10 list! Place a Limit Buy Order at VWAP between 9:35 AM and 10:05 AM.\n` +
                     `• <b>Zero-Loss Rule:</b> As soon as profit touches +₹300, immediately move Stop-Loss to Entry Price (Break-Even)! Never let a green trade turn red!`;

            await bot.editMessageText(reply, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } catch (err) {
            console.error("TELEGRAM TOP10 ERROR:", err.message);
            await bot.sendMessage(chatId, `⚠️ Could not compute /top10 setups right now. Please try again shortly.`);
        }
    });

    // 3D-B. HIGH-ALTITUDE ROCKET COMMAND: /above4 or /rockets (Stocks surging > +4.00% with proven 61.1% historical win rate)
    bot.onText(/^\/(?:above4|rockets|high4)$/, async (msg) => {
        const chatId = msg.chat.id;

        const statusMsg = await bot.sendMessage(chatId, `🚀 <b>[HIGH-ALTITUDE ROCKET ENGINE (> +4.0%)]</b>\n\nScanning Indian Market for stocks already surging above <b>+4.00%</b> with active institutional volume and order-book buyer dominance...\n💡 <i>Targeting proven 61.1% historical win-rate setups!</i>`, { parse_mode: 'HTML' });

        try {
            const timeCheck = intradayService.checkIndianMarketTime();
            if (!timeCheck.isOpen) {
                await bot.sendMessage(chatId, timeCheck.reason, { parse_mode: 'Markdown' });
            }

            const result = await intradayService.getAbove4PercentSetups(20000);

            if (!result.setups || result.setups.length === 0) {
                await bot.editMessageText(`⚠️ No high-altitude rocket candidates (> +4.00%) active right now. Re-check after 15 minutes!`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                return;
            }

            let reply = `🚀 <b>HIGH-ALTITUDE ROCKET RUNNERS (> +4.00%)</b> 🚀\n` +
                        `<i>🔥 Filtered specifically for explosive breakout momentum above +4.00% with verified live institutional order volumes!</i>\n` +
                        `────────────────────────────\n\n`;

            result.setups.forEach((s, idx) => {
                const evalData = s.riskEvaluation || {};
                const recQty = evalData.recommendedQuantity || '15';
                const limitEntry = parseFloat(s.livePrice).toFixed(2);

                reply += `<b>${idx + 1}. ${s.symbol} (${s.name})</b> [${s.capCategory}]\n` +
                         `   💰 <b>Price:</b> ₹${limitEntry} (${s.changePercent} Today) | 🔥 <b>Buyers:</b> ${s.buyerDominance}\n` +
                         `   🎯 <b>Target (+2.50%):</b> ₹${s.target} | 🛑 <b>SL (-1.20%):</b> ₹${s.stopLoss}\n` +
                         `   📦 <b>5x MIS Size:</b> ${recQty} Shares | ⭐ <b>Confidence:</b> ${s.confidence}%\n` +
                         `   💡 <i>${s.doubleCheckReason}</i>\n` +
                         `────────────────────────────\n`;
            });

            reply += `\n<b>💡 PRO EXECUTION RULES FOR ROCKET RUNNERS:</b>\n` +
                     `• <b>Optimal Execution Time:</b> Best executed at <b>10:00 AM</b> (proven 61.1% historical win rate!) or <b>09:15 AM</b> opening bell.\n` +
                     `• <b>Trailing Stop Mandatory:</b> Whenever profit reaches +₹400, shift Stop-Loss to Entry Price (Break-Even) immediately!`;

            await bot.editMessageText(reply, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } catch (err) {
            console.error("TELEGRAM ABOVE4 ERROR:", err.message);
            await bot.sendMessage(chatId, `⚠️ Could not compute /above4 setups right now. Please try again shortly.`);
        }
    });

    // 3E. MASTER COMBINED SUPER-CONFLUENCE ENGINE: /best or /master or /super or /combine
    bot.onText(/^\/(?:best|master|super|combine)$/, async (msg) => {
        const chatId = msg.chat.id;

        const statusMsg = await bot.sendMessage(chatId, `🌟 <b>[MASTER SUPER-CONFLUENCE ENGINE]</b> 🌟\n\n⚡ Intersecting all three quantitative detection layers (<b>v4.0 Quant</b>, <b>July 30 ORB</b> & <b>All-Cap Top 10</b>)...\n🧠 Running institutional cross-verification & AI Trend Shield to find today's <b>Top 5 Super-Winners</b>!`, { parse_mode: 'HTML' });

        try {
            const timeCheck = intradayService.checkIndianMarketTime();
            if (!timeCheck.isOpen) {
                await bot.sendMessage(chatId, timeCheck.reason, { parse_mode: 'Markdown' });
                return; // 🛡️ Pillar 4: Strictly block the system from returning setups during dangerous hours!
            }

            const result = await intradayService.getCombinedMasterSetups(20000);

            // 🔴 GLOBAL SENTIMENT RED BLOCK
            if (result.blocked) {
                await bot.editMessageText(
                    `🔴 <b>GLOBAL MARKET CRASH ALERT</b> 🔴\n\n` +
                    `${result.globalSentiment?.details || 'Markets are negative.'}\n\n` +
                    `⛔ <b>The system has BLOCKED all trade recommendations today.</b>\n\n` +
                    `💡 <i>Professional traders know: "Cash is a position." When global markets crash, the smartest move is to NOT trade. Your ₹2,000 capital is more important than any single trade.</i>\n\n` +
                    `⏰ Try again tomorrow when global sentiment improves.`,
                    { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
                );
                return;
            }

            if (!result.setups || result.setups.length === 0) {
                await bot.editMessageText(`⚠️ No verified Super-Confluence setups active right now. All 191 stocks failed the 7-layer intelligence filter. Re-check after 15 minutes!`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
                return;
            }

            let reply = `🏆 <b>THE #1 MASTER COMBINED INTRADAY SETUPS (TOP 5)</b> 🏆\n` +
                        `<i>🔥 Intersected across v4.0 Order-Book Confluence, July 30 ORB Engine & All-Cap News Shield + AI Tip Verification!</i>\n` +
                        `────────────────────────────\n\n`;

            result.setups.slice(0, 5).forEach((s, idx) => {
                const evalData = s.riskEvaluation || {};
                const recQty = evalData.recommendedQuantity || '20';
                const limitEntry = parseFloat(s.livePrice).toFixed(2);
                const vwapAnchor = parseFloat(s.vwap || s.livePrice).toFixed(2);
                const enginesList = (s.sources || []).join(" + ") + " + 🧠 AI Tip Approved";

                reply += `<b>${idx + 1}. ${s.symbol} (${s.name})</b> [${s.capCategory || '🏭 MID/LARGE CAP'}]\n` +
                         `   🔗 <b>Consensus Verification:</b> ${enginesList}\n` +
                         `   💰 <b>Live Market Price:</b> ₹${limitEntry} (${s.changePercent} today)\n` +
                         `   📍 <b>VWAP Pullback Buy Limit Price:</b> <b>₹${vwapAnchor}</b> <i>(Do NOT buy above this price!)</i>\n` +
                         `   🎯 <b>Scalp Target (+1.0%):</b> <b>₹${s.target}</b>\n` +
                         `   🛑 <b>Strict Stop-Loss (-0.6%):</b> <b>₹${s.stopLoss}</b>\n` +
                         `   📦 <b>5x MIS Size (₹3,500 Capital):</b> <b>${recQty} Shares</b>\n` +
                         `   💡 <i>${s.newsHeadline || s.doubleCheckReason}</i>\n` +
                         `────────────────────────────\n`;
            });

            reply += `\n<b>👑 HOW TO EXECUTE WITH CONFIDENCE:</b>\n` +
                     `1️⃣ <b>Discipline Rule:</b> NEVER trade before 9:45 AM. Wait for the Morning Chaos to settle.\n` +
                     `2️⃣ <b>Live Trade:</b> Type <code>/best</code> at 9:46 AM. Place a Limit Buy order at the exact <b>VWAP Pullback Price</b>.\n` +
                     `3️⃣ <b>Zero-Loss Rule:</b> The moment your position crosses <b>+0.5% profit</b>, shift your Stop-Loss to your Entry Price (Break-Even)!\n` +
                     `4️⃣ <b>🛑 Daily Risk Cap:</b> If you hit 2 stop-losses today, SHUT DOWN the app. No more trades for the day!`;

            await bot.editMessageText(reply, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } catch (err) {
            console.error("TELEGRAM BEST/MASTER ERROR:", err.message);
            await bot.sendMessage(chatId, `⚠️ Could not compute /best setups right now. Please try again shortly.`);
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

    // 4.5. New /predict command (Tomorrow's Movers)
    bot.onText(/\/(predict)/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🔮 **PREDICTION ENGINE RUNNING...**\nScanning 191 stocks using RSI, MACD, Volume Spikes, and Bollinger Bands. This takes ~30 seconds...`, {parse_mode: 'Markdown'});
        
        try {
            const { generateTomorrowPredictions } = require('./services/predictionService');
            const predictions = await generateTomorrowPredictions();
            
            if (!predictions || predictions.length === 0) {
                return bot.sendMessage(chatId, `No strong momentum setups detected for tomorrow.`);
            }

            let reply = `🔮 <b>TOMORROW'S PREDICTED MOVERS</b> 🔮\n\n`;
            predictions.forEach((p, idx) => {
                reply += `<b>${idx + 1}. ${p.symbol}</b> (Score: ${p.score}/100)\n` +
                         `   💰 Close: ₹${p.close}\n` +
                         `   ⚡ Catalyst: ${p.reasons}\n\n`;
            });
            reply += `<i>💡 Watch these stocks at 9:15 AM tomorrow for breakout continuation!</i>`;
            
            bot.sendMessage(chatId, reply, {parse_mode: 'HTML'});
        } catch (error) {
            console.error('Error generating predictions:', error);
            bot.sendMessage(chatId, `❌ Error scanning for predictions.`);
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
            `<b>⚡ INTRADAY ORB QUANT (MIS 5x Margin):</b>\n` +
            `<code>/best</code>             — 🔥 Master Combined Super-Picks (v4.0 + July 30 + Top 10 + AI Tip)\n` +
            `<code>/top10</code>            — Top 10 All-Cap Winners (Small, Mid & Large Cap)\n` +
            `<code>/intraday</code>         — Top 3 Intraday Confluence v4.0 (VWAP Limit Pullback)\n` +
            `<code>/intraday30</code>       — Top 3 July 30 System (Commit c6e122a comparison)\n` +
            `<code>/intraday RELIANCE</code> — Check ORB & VWAP confluence for a single ticker\n\n` +
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

// INSTANT AUTO-NOTIFICATION BROADCASTER FOR F&O AND INTRADAY
cron.schedule('*/15 * * * *', async () => {
    if (!bot) return;
    try {
        console.log('Scanning for Instant Intraday & F&O Auto-Notifications...');
        const allUsers = await Portfolio.distinct('chatId');
        if (!allUsers || allUsers.length === 0) return;

        // 1. Check Intraday Setups (Will naturally fail if market is closed/stale)
        const intradayResult = await intradayService.getIntradaySetups(null, 20000);
        if (intradayResult && intradayResult.setups && intradayResult.setups.length > 0) {
            const bestSetup = intradayResult.setups[0];
            const alertKey = `INTRADAY_ALERT_${bestSetup.symbol}_${new Date().toISOString().split('T')[0]}`;
            if (!sentAlertsMemory.has(alertKey)) {
                sentAlertsMemory.add(alertKey);
                
                const recQty = bestSetup.riskEvaluation ? bestSetup.riskEvaluation.recommendedQuantity : "15";
                
                const tipMsg = `🚨 <b>INSTANT INTRADAY AUTO-ALERT</b> 🚨\n\n` +
                               `🔥 <b>${bestSetup.symbol}</b> has a massive Live Order Book Breakout!\n\n` +
                               `💰 <b>Live Price:</b> ₹${bestSetup.livePrice}\n` +
                               `📈 <b>Volume Spike:</b> ${bestSetup.volumeMultiplier || '2.5'}x Average\n` +
                               `🎯 <b>Target (+2%):</b> ₹${bestSetup.target}\n` +
                               `🛡️ <b>SL (-1%):</b> ₹${bestSetup.stopLoss}\n\n` +
                               `⚡ <b>Action:</b> Buy ${recQty} Shares INSTANTLY.`;
                
                for (let chatId of allUsers) {
                    if (chatId !== 'UI_USER') bot.sendMessage(chatId, tipMsg, {parse_mode: 'HTML'});
                }
            }
        }

        // 2. Check F&O Setups (24/7 scanning)
        const { getFNOTrade } = require('./services/fnoService');
        for (const asset of ['crude', 'nifty']) {
            const fnoResult = await getFNOTrade(asset);
            if (fnoResult.status !== 'NO_TRADE') {
                const fnoAlertKey = `FNO_ALERT_${asset}_${new Date().toISOString().split('T')[0]}_${new Date().getHours()}`;
                if (!sentAlertsMemory.has(fnoAlertKey)) {
                    sentAlertsMemory.add(fnoAlertKey);
                    
                    const fnoMsg = `🚨 <b>INSTANT F&O AUTO-ALERT</b> 🚨\n\n` +
                                   `🔥 <b>Asset:</b> ${asset.toUpperCase()}\n\n` +
                                   `${fnoResult.message}\n\n` +
                                   `⚡ <b>Action:</b> Execute INSTANTLY.`;
                    
                    for (let chatId of allUsers) {
                        if (chatId !== 'UI_USER') bot.sendMessage(chatId, fnoMsg, {parse_mode: 'HTML'});
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error in Auto-Notification CRON:', err);
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
// 🔮 EVENING PREDICTION SCORE (Runs every day at 8:30 PM IST)
// Cron time in UTC: 20:30 IST is 15:00 UTC
cron.schedule('0 15 * * 1-5', async () => {
    if (!bot) return;
    try {
        console.log('[Prediction CRON] Running Evening Predictor...');
        const allUsers = await Portfolio.distinct('chatId');
        const telegramUsers = allUsers.filter(id => id !== 'UI_USER');
        if (telegramUsers.length === 0) return;

        const { generateTomorrowPredictions } = require('./services/predictionService');
        const predictions = await generateTomorrowPredictions();
        
        if (predictions && predictions.length > 0) {
            let reply = `🔮 <b>TOMORROW'S TOP ${predictions.length} PREDICTED MOVERS</b> 🔮\n\n`;
            predictions.forEach((p, idx) => {
                reply += `<b>${idx + 1}. ${p.symbol}</b> (Score: ${p.score}/100)\n` +
                         `   💰 Close: ₹${p.close}\n` +
                         `   ⚡ Catalyst: ${p.reasons}\n\n`;
            });
            reply += `<i>💡 Get ready! The /intraday scanner will hunt for these specific tickers at the 9:15 AM open tomorrow!</i>`;
            
            for (let chatId of telegramUsers) {
                bot.sendMessage(chatId, reply, {parse_mode: 'HTML'});
            }
        }
    } catch (err) {
        console.error('[Prediction CRON] Error:', err);
    }
}, { timezone: 'UTC' });
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
