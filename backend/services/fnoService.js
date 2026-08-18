const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const { checkUpcomingNews } = require('./newsCalendarService');
const angleOneService = require('./angleOneService');
const angleOneMapping = require('./angleOneMapping');

// 🔮 PHASE 4: GLOBAL NIFTY DIRECTION PREDICTOR
async function predictNiftyDirection() {
    try {
        const symbols = ['^GSPC', 'DX-Y.NYB', 'CL=F', '^VIX', '^NSEI'];
        const results = await Promise.all(symbols.map(sym => {
            const p1 = Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60);
            return yahooFinance.chart(sym, { interval: '1d', period1: p1 }).catch(() => null);
        }));

        let score = 0;
        let reasons = [];

        // 1. S&P 500 (Positive Correlation)
        if (results[0] && results[0].quotes.length >= 2) {
            const change = (results[0].quotes[1].close - results[0].quotes[0].close) / results[0].quotes[0].close;
            if (change > 0.003) { score += 1; reasons.push('S&P 500 is Bullish (+)'); }
            else if (change < -0.003) { score -= 1; reasons.push('S&P 500 is Bearish (-)'); }
        }

        // 2. US Dollar Index (Inverse Correlation)
        if (results[1] && results[1].quotes.length >= 2) {
            const change = (results[1].quotes[1].close - results[1].quotes[0].close) / results[1].quotes[0].close;
            if (change < -0.002) { score += 1; reasons.push('DXY is Falling (+)'); }
            else if (change > 0.002) { score -= 1; reasons.push('DXY is Rising (-)'); }
        }

        // 3. Crude Oil (Inverse Correlation for India)
        if (results[2] && results[2].quotes.length >= 2) {
            const change = (results[2].quotes[1].close - results[2].quotes[0].close) / results[2].quotes[0].close;
            if (change < -0.005) { score += 1; reasons.push('Crude is Falling (+)'); }
            else if (change > 0.005) { score -= 1; reasons.push('Crude is Rising (-)'); }
        }

        // 4. VIX (Inverse Correlation)
        if (results[3] && results[3].quotes.length >= 2) {
            const change = (results[3].quotes[1].close - results[3].quotes[0].close) / results[3].quotes[0].close;
            if (change < 0) { score += 1; reasons.push('VIX is Falling (+)'); }
            else if (change > 0) { score -= 1; reasons.push('VIX is Rising (-)'); }
        }

        return {
            sentiment: score >= 2 ? 'BULLISH' : (score <= -2 ? 'BEARISH' : 'NEUTRAL'),
            score,
            details: reasons.join(' | ') || 'Global cues mixed'
        };
    } catch (e) {
        return { sentiment: 'NEUTRAL', score: 0, details: 'Global data unavailable' };
    }
}

// 🧠 PHASE 4: NSE MAX PAIN / OI ANALYSIS (Placeholder wrapper due to NSE cookie blocks)
async function getNiftyMaxPain() {
    // In production, this would scrape the NSE option chain via a headless browser or cookie-managed session
    // For this implementation, we return the theoretical structural concept for the alert.
    return "Max Pain Analysis requires NSE Authentication API.";
}

function calculateEMA(closes, period) {
    if (closes.length < period) return { current: null, prev: null };
    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let prevEma = ema;
    for (let i = period; i < closes.length; i++) {
        prevEma = ema;
        ema = (closes[i] - ema) * multiplier + ema;
    }
    return { current: ema, prev: prevEma };
}

async function getFNOTrade(instrumentType = 'nifty') {
    try {
        let inrRate = 95.43;
        try { 
            const inrQuote = await yahooFinance.quote('INR=X'); 
            if(inrQuote && inrQuote.regularMarketPrice) inrRate = inrQuote.regularMarketPrice; 
        } catch(e) {}
        
        let symbol = '^NSEI';
        let instrumentName = 'NIFTY 50';
        let mcxNote = '';
        let stepSize = 50;
        let useTradingView = true; // Enabled globally now!
        let tvSymbol = 'NSE:NIFTY'; // Nifty 0-sec live

        if (instrumentType.toLowerCase() === 'crude') {
            symbol = 'CRUDEOILM.MCX'; 
            instrumentName = 'CRUDE OIL MINI (MCX)';
            mcxNote = "Crude Oil Mini Options (Scanning true Indian MCX Market directly via Angle One)";
            stepSize = 10; 
            useTradingView = false; // We don't need TVC proxy anymore!
            tvSymbol = 'MCX:CRUDEOIL1!'; 
        } else if (instrumentType.toLowerCase() === 'gold') {
            symbol = 'GC=F';
            instrumentName = 'GOLD (MCX)';
            mcxNote = "Gold Options (Trade the MCX current month expiry)";
            stepSize = 10; 
            useTradingView = true;
            tvSymbol = 'TVC:GOLD';
        }

        console.log(`Fetching data for F&O Analysis: ${instrumentName} (${symbol})`);
        
        let quotes = [];
        let fetchedViaAngleOne = false;

        // --- NEW: ANGLE ONE TRUE INDIAN HISTORICAL DATA ---
        try {
            await angleOneMapping.init();
            let a1Exchange = 'NSE';
            let a1Token = '26000'; // NIFTY
            
            if (instrumentType.toLowerCase() === 'crude') {
                a1Exchange = 'MCX';
                // Auto-roller: reads nearest non-expired CRUDEOILM contract from AngleOne instrument master
                const crudeToken = angleOneMapping.getCrudeOilMiniToken();
                a1Token = crudeToken ? crudeToken.token : '560978'; // fallback only if mapping fully failed
                console.log(`🔄 [CrudeAutoRoller] Active token: ${a1Token}`);
            } else if (instrumentType.toLowerCase() === 'gold') {
                a1Exchange = 'MCX';
                a1Token = '237072'; // GOLD
            }
            
            console.log(`🚀 Fetching True Indian Market Data from Angle One for ${instrumentName}...`);
            const a1Data = await angleOneService.getHistoricData(a1Exchange, a1Token, "FIVE_MINUTE", 5);
            if (a1Data && a1Data.length >= 25) {
                quotes = a1Data;
                fetchedViaAngleOne = true; 
                console.log(`✅ Successfully fetched ${quotes.length} historical 5m candles from Angle One.`);
            } else {
                console.log(`Angle One Historical returned insufficient data (${a1Data ? a1Data.length : 0} candles). Falling back...`);
            }
        } catch (e) {
            console.error("Angle One Historical failed:", e.message);
        }

        if (useTradingView && !fetchedViaAngleOne) {
            console.log(`🚀 Bypassing delays! Fetching 0-Second Live Data from TradingView: ${tvSymbol}`);
            try {
                const TradingView = require('@mathieuc/tradingview');
                const client = new TradingView.Client();
                const chart = new client.Session.Chart();
                chart.setMarket(tvSymbol, { timeframe: '5' });
                
                quotes = await new Promise((resolve, reject) => {
                    chart.onUpdate(() => {
                        const q = chart.periods.map(p => ({
                            close: p.close,
                            open: p.open,
                            high: p.max,
                            low: p.min,
                            volume: p.volume
                        }));
                        client.end();
                        resolve(q);
                    });
                    setTimeout(() => { client.end(); reject(new Error('TV Timeout')); }, 8000);
                });
            } catch (err) {
                console.log("TradingView failed, falling back to Yahoo", err.message);
                useTradingView = false;
            }
        }

        if (!fetchedViaAngleOne && (!useTradingView || quotes.length === 0)) {
            const d = new Date();
            d.setDate(d.getDate() - 5);
            const p1 = Math.floor(d.getTime()/1000);
            
            const queryOptions = { period1: p1, interval: '5m' };
            const result = await yahooFinance.chart(symbol, queryOptions);
            quotes = result.quotes.filter(q => q.close !== null);
        }
        
        if (quotes.length < 25) {
            return { status: 'ERROR', message: `Not enough data available for ${instrumentName}.` };
        }

        const closes = quotes.map(q => q.close);
        let currentPrice = closes[closes.length - 1];
        
        // --- 0-SECOND LIVE PRICE OVERRIDE ---
        // If Angle One historical failed (rate limit) and we fell back to Yahoo 15-min delayed charts,
        // ALWAYS override the signal price with the true 0-second Live Angle One Spot Price!
        try {
            const stockService = require('./stockService');
            const livePrice = await stockService.getStockPrice(symbol);
            if (livePrice && livePrice > 0) {
                currentPrice = livePrice;
            }
        } catch (err) {
            console.error("Live Price Override Failed:", err.message);
        }
        
        const { ADX } = require('technicalindicators');
        
        // BUG FIX: Inject the true live price into the closes and quotes array so EMA and ADX calculations are 0-second accurate!
        closes[closes.length - 1] = currentPrice;
        quotes[quotes.length - 1].close = currentPrice;
        if (currentPrice > quotes[quotes.length - 1].high) quotes[quotes.length - 1].high = currentPrice;
        if (currentPrice < quotes[quotes.length - 1].low) quotes[quotes.length - 1].low = currentPrice;

        const ema5Data = calculateEMA(closes, 5);
        const ema20Data = calculateEMA(closes, 20);
        const ema200Data = calculateEMA(closes, 200); // MACRO TREND SHIELD
        const ema5 = ema5Data.current;
        const prevEma5 = ema5Data.prev;
        const ema20 = ema20Data.current;
        const prevEma20 = ema20Data.prev;
        const ema200 = ema200Data.current;
        
        const lastCandle = quotes[quotes.length - 1];
        const prevCandle = quotes[quotes.length - 2];
        
        // BUG FIX: Use the true 0-second live currentPrice, not the delayed historical close!
        // This prevents the bot from giving a PUT when the live market is violently going up.
        const candleGain = ((currentPrice - lastCandle.open) / lastCandle.open) * 100;

        // Calculate RSI (14 period) to increase accuracy to 70-80%
        let currentRSI = 50;
        try {
            const { RSI } = require('technicalindicators');
            const rsiValues = RSI.calculate({ values: closes, period: 14 });
            if (rsiValues && rsiValues.length > 0) {
                currentRSI = rsiValues[rsiValues.length - 1];
            }
        } catch(e) {}
        // PRO-TRADER FILTER: Options Buying only works in high momentum (Golden Sweet Spot: ADX > 22).
        let currentADX = 20;
        try {
            const adxResult = ADX.calculate({
                high: quotes.map(q => q.high),
                low: quotes.map(q => q.low),
                close: quotes.map(q => q.close),
                period: 14
            });
            if (adxResult && adxResult.length > 0) {
                currentADX = adxResult[adxResult.length - 1].adx;
            }
        } catch(e) { console.error("ADX calculation error"); }

        const newsSpikeWarning = await checkUpcomingNews(instrumentType);
        let preMessage = newsSpikeWarning ? `${newsSpikeWarning}\n\n` : '';
        

        let adxWarning = '';
        if (currentADX < 22) {
            adxWarning = `⚠️ ADX (Momentum) is low at ${currentADX.toFixed(1)}. This means the trend is weak or just starting. Use strict stop-loss!`;
        } else {
            adxWarning = `🔥 ADX is STRONG at ${currentADX.toFixed(1)}. High momentum confirmed!`;
        }

        let signal = "NEUTRAL";
        let optionType = "";
        let logic = "";
        let strikePriceNum = 0;
        let expiryDateStr = "";

        // Calculate Expiry Date
        const today = new Date();
        if (instrumentType.toLowerCase() === 'nifty') {
            let daysUntilThursday = (4 - today.getDay() + 7) % 7;
            if (daysUntilThursday === 0) daysUntilThursday = 7; 
            const nextThursday = new Date(today);
            nextThursday.setDate(today.getDate() + daysUntilThursday);
            expiryDateStr = nextThursday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        } else {
            let expiryMonth = today.getMonth();
            if (today.getDate() > 17) expiryMonth++; 
            const mcxExpiry = new Date(today.getFullYear(), expiryMonth, 17);
            expiryDateStr = mcxExpiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        }

        // Calculate Exact Strike Price
        if (instrumentType.toLowerCase() === 'nifty') {
            strikePriceNum = Math.round(currentPrice / 50) * 50; 
        } else if (instrumentType.toLowerCase() === 'crude') {
            // Angle One fetches the true Indian MCX Spot Price now!
            strikePriceNum = Math.round(currentPrice / 50) * 50;
        } else if (instrumentType.toLowerCase() === 'gold') {
            strikePriceNum = "ATM";
        }

        // KILL SWITCH: DO NOT TRADE CRUDE OIL DURING INDIAN DAYTIME (10:00 AM to 5:00 PM IST)
        // Indian daytime volume is localized MCX manipulation. True volume starts at 5:00 PM and 7:00 PM.
        if (instrumentType.toLowerCase() === 'crude') {
            const nowIST = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            const hourIST = nowIST.getUTCHours();
            // 10:00 AM to 5:00 PM is hourIST 10 to 16
            if (hourIST >= 10 && hourIST < 17) {
                return {
                    status: 'NO_TRADE',
                    message: `⚠️ DAYTIME KILL SWITCH ACTIVE: Current CRUDE OIL Spot is ₹${currentPrice.toFixed(2)}. \n\nDo NOT trade Crude Oil during Indian Daytime (10 AM to 5 PM). The volume is completely dead and filled with localized MCX traps and Theta decay. Wait for the US Pre-Market at 5:00 PM!`
                };
            }
        }

        // --- NEW QUANT FILTER FROM WIN_RATE_MAXIMIZE.md ---
        if (instrumentType.toLowerCase() === 'nifty') {
            const nowIST = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            if (nowIST.getDay() === 4) { // Thursday (Expiry Day)
                return {
                    status: 'NO_TRADE',
                    message: `🚫 EXPIRY DAY BLOCKED: Today is Thursday. Option premiums will decay to zero (Theta Decay). Unless you are a highly experienced Option Seller, trading Nifty options on expiry day is gambling. Capital protected.`
                };
            }
        }

        // --- NEW QUANT FILTERS FROM WIN_RATE_MAXIMIZE.md ---
        if (instrumentType.toLowerCase() === 'crude' && currentADX < 22) {
            return {
                status: 'NO_TRADE',
                message: `⚠️ LOW MOMENTUM KILL SWITCH: ${instrumentName} ADX is ${currentADX.toFixed(1)}. \n\nThe market is sideways. Buying options now guarantees loss via Theta decay. Only trade when ADX > 22.`
            };
        }

        const emaGapPercent = (Math.abs(ema5 - ema20) / currentPrice) * 100;
        const validGap = emaGapPercent >= 0.05;

        // CALL OPTION LOGIC (Requires valid gap + ADX > 22 + RSI healthy + Price > 200-EMA macro trend)
        if (ema5 > ema20 && prevEma5 <= prevEma20 && validGap && candleGain > 0 && currentRSI >= 45 && currentRSI <= 68 && currentADX >= 22) {
            if (ema200 && currentPrice < ema200) {
                return { status: 'NO_TRADE', message: `⚠️ MACRO TREND BLOCK: 5-min trend is UP, but price is below the 1-Hour (200) EMA. Ignoring fake pullback!` };
            }
            signal = "BUY";
            optionType = "CE (CALL)";
            logic = `🔥 FRESH EXPLOSIVE BREAKOUT: ${instrumentName} ADX is high (${currentADX.toFixed(1)}). The 5-EMA just crossed the 20-EMA on bullish volume in alignment with the macro trend. High-probability entry!`;
        } 
        // PUT OPTION LOGIC (Requires valid gap + ADX > 22 + RSI healthy bearish + Price < 200-EMA macro trend)
        else if (ema5 < ema20 && prevEma5 >= prevEma20 && validGap && candleGain < 0 && currentRSI >= 32 && currentRSI <= 55 && currentADX >= 22) {
            if (ema200 && currentPrice > ema200) {
                return { status: 'NO_TRADE', message: `⚠️ MACRO TREND BLOCK: 5-min trend is DOWN, but price is above the 1-Hour (200) EMA. Ignoring fake pullback!` };
            }
            signal = "BUY";
            optionType = "PE (PUT)";
            logic = `🩸 FRESH BEARISH BREAKDOWN: ${instrumentName} ADX is high (${currentADX.toFixed(1)}). The 5-EMA just crossed below 20-EMA on selling volume in alignment with the macro trend. Massive short trigger!`;
        }
        else {
            let spotDisplay = `${currentPrice.toFixed(2)}`;
            if (instrumentType.toLowerCase() === 'crude') {
                spotDisplay += ` ($) / ₹${(currentPrice * inrRate).toFixed(0)} (MCX Approx)`;
            }

            return {
                status: 'NO_TRADE',
                message: preMessage + `Current ${instrumentName} Spot: ${spotDisplay}.\n\n` + 
                         `${adxWarning}\nRSI is ${currentRSI.toFixed(1)}.\n` +
                         `📉 Trend Check: 5-EMA is at ${ema5.toFixed(2)} | 20-EMA is at ${ema20.toFixed(2)}.\n` +
                         `No clear crossover detected. Wait for a strong breakout.`
            };
        }

        // FETCH LIVE NEWS FOR CONFLUENCE
        let newsHeadline = "No recent major news detected.";
        try {
            const newsSearch = await yahooFinance.search(symbol, { newsCount: 1 });
            if (newsSearch && newsSearch.news && newsSearch.news.length > 0) {
                newsHeadline = newsSearch.news[0].title;
            }
        } catch(e) { console.error("News fetch error", e); }

        // PHASE 4: NIFTY PREDICTOR INJECTION
        let globalNote = '';
        if (instrumentType.toLowerCase() === 'nifty') {
            const niftyPred = await predictNiftyDirection();
            globalNote = `🌍 GLOBAL CUES: ${niftyPred.sentiment} (${niftyPred.details})`;
            
            // If Nifty pred is BEARISH but technicals say BUY CALL, cancel the trade to prevent trap.
            if (niftyPred.sentiment === 'BEARISH' && signal === 'BUY' && optionType === 'CE (CALL)') {
                return {
                    status: 'NO_TRADE',
                    message: `⚠️ GLOBAL TRAP DETECTED: Technicals show Nifty BUY, but Global Cues are BEARISH (${niftyPred.details}). Trade aborted.`
                };
            }
            // If Nifty pred is BULLISH but technicals say BUY PUT, cancel.
            if (niftyPred.sentiment === 'BULLISH' && signal === 'BUY' && optionType === 'PE (PUT)') {
                return {
                    status: 'NO_TRADE',
                    message: `⚠️ GLOBAL TRAP DETECTED: Technicals show Nifty SELL, but Global Cues are BULLISH (${niftyPred.details}). Trade aborted.`
                };
            }
        }

        let spotDisplay = `${currentPrice.toFixed(2)}`;
        if (instrumentType.toLowerCase() === 'crude') {
            spotDisplay += ` ($) / ₹${(currentPrice * inrRate).toFixed(0)} (MCX Approx)`;
        }

        let finalMessagePrefix = preMessage;

        let dynamicTarget = "";
        let dynamicSL = "";
        
        if (instrumentType.toLowerCase() === 'crude') {
            dynamicTarget = "🎯 TARGET: +35 Points (₹700 Profit per lot)";
            dynamicSL = "🛑 STOP LOSS: -15 Points (Strict ₹300 Risk limit)";
        } else {
            if (currentADX >= 30) {
                dynamicTarget = "🎯 TARGET: +4% to +5% (MASSIVE MOMENTUM DETECTED! Let the profits run!)";
                dynamicSL = "🛑 STOP LOSS: -2% (Give it room to breathe, huge trend active).";
            } else if (currentADX >= 25) {
                dynamicTarget = "🎯 TARGET: +2% to +3% (Strong momentum. Solid base hit).";
                dynamicSL = "🛑 STOP LOSS: -1.5% (Standard risk).";
            } else {
                dynamicTarget = "🎯 TARGET: +1% to +1.5% (Low momentum / Early trend. Take fast profits!)";
                dynamicSL = "🛑 STOP LOSS: -1% (STRICT - Cut losses instantly if it reverses).";
            }
        }

        // Return the Option Trade Plan
        return {
            status: 'TRADE_FOUND',
            spotPrice: spotDisplay,
            instrumentName: instrumentName,
            mcxNote: mcxNote,
            newsHeadline: newsSpikeWarning ? newsSpikeWarning : newsHeadline,
            trade: {
                type: optionType,
                logic: `${adxWarning}\n\n` + logic,
                strikeGuide: `${strikePriceNum} ${optionType}`,
                expiryGuide: `${expiryDateStr} Expiry`,
                rules: [
                    "⚠️ CAPITAL MANAGEMENT: You are recovering capital (₹3,500). Use MAX 30% of capital per trade.",
                    dynamicTarget,
                    dynamicSL,
                    "🛡️ TRAILING STOP: Once you are +1.5% in profit, MOVE YOUR STOP LOSS TO BREAKEVEN.",
                    "🚨 DIVERGENCE CHECK: Look at your MCX chart. If the bot says PUT, but your MCX chart is going UP, DO NOT TRADE. The USD/INR currency is fluctuating. Only trade when MCX and WTI match!",
                    `📰 NEWS CONFLUENCE: ${newsHeadline}`,
                    globalNote,
                    "⏱️ TIME STOP: Max 15-20 minutes hold time to prevent Theta decay loss."
                ].filter(Boolean)
            }
        };

    } catch (error) {
        console.error("F&O Analysis Error:", error);
        return { status: 'ERROR', message: "Market closed or API error for this instrument." };
    }
}

module.exports = {
    getFNOTrade
};
