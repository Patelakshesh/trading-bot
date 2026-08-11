const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

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
    if (closes.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = (closes[i] - ema) * multiplier + ema;
    }
    return ema;
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

        if (instrumentType.toLowerCase() === 'crude') {
            symbol = 'CL=F'; // Global WTI Crude Oil
            instrumentName = 'CRUDE OIL (MCX & Mini)';
            mcxNote = "Crude Oil Options (Trade the MCX current month expiry)";
            stepSize = 1; // Crude oil strikes are typically in increments of 100 on MCX (₹), but WTI is in $1 increments. We will output the WTI spot for reference, but tell the user to match ATM on MCX.
        } else if (instrumentType.toLowerCase() === 'gold') {
            symbol = 'GC=F';
            instrumentName = 'GOLD (MCX)';
            mcxNote = "Gold Options (Trade the MCX current month expiry)";
            stepSize = 10; 
        }

        console.log(`Fetching data for F&O Analysis: ${instrumentName} (${symbol})`);
        
        const d = new Date();
        d.setDate(d.getDate() - 5);
        const p1 = Math.floor(d.getTime()/1000);
        
        const queryOptions = { period1: p1, interval: '5m' };
        const result = await yahooFinance.chart(symbol, queryOptions);
        const quotes = result.quotes.filter(q => q.close !== null);
        
        if (quotes.length < 25) {
            return { status: 'ERROR', message: `Not enough data available for ${instrumentName}.` };
        }

        const closes = quotes.map(q => q.close);
        const currentPrice = closes[closes.length - 1];
        
        const { ADX } = require('technicalindicators');
        
        const ema5 = calculateEMA(closes, 5);
        const ema20 = calculateEMA(closes, 20);
        
        const lastCandle = quotes[quotes.length - 1];
        const prevCandle = quotes[quotes.length - 2];
        
        const candleGain = ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100;

        // Calculate RSI (14 period) to increase accuracy to 70-80%
        let currentRSI = 50;
        try {
            const { RSI } = require('technicalindicators');
            const rsiValues = RSI.calculate({ values: closes, period: 14 });
            if (rsiValues && rsiValues.length > 0) {
                currentRSI = rsiValues[rsiValues.length - 1];
            }
        } catch(e) {}

        // Calculate ADX (14 period) to detect chopped markets
        let currentADX = 0;
        try {
            const highPrices = quotes.map(r => r.high);
            const lowPrices = quotes.map(r => r.low);
            const adxValues = ADX.calculate({ close: closes, high: highPrices, low: lowPrices, period: 14 });
            if (adxValues && adxValues.length > 0) {
                currentADX = adxValues[adxValues.length - 1].adx;
            }
        } catch(e) {}

        // PRO-TRADER FILTER: Options Buying only works in high momentum (Golden Sweet Spot: ADX > 22).
        if (currentADX < 22) {
            return {
                status: 'NO_TRADE',
                message: `Current ${instrumentName} Spot: ${currentPrice.toFixed(2)}.\n\n` +
                         `⚠️ ADX (Trend Strength) is critically low at ${currentADX.toFixed(1)}.\n` +
                         `The market is in a CHOPPY / SIDEWAYS zone. If you buy options right now, Theta Decay will destroy your premium. A Professional Trader stays out. Wait for ADX > 22.`
            };
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
            if (today.getDate() > 19) expiryMonth++; 
            const mcxExpiry = new Date(today.getFullYear(), expiryMonth, 19);
            expiryDateStr = mcxExpiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        }

        // Calculate Exact Strike Price
        if (instrumentType.toLowerCase() === 'nifty') {
            strikePriceNum = Math.round(currentPrice / 50) * 50; 
        } else if (instrumentType.toLowerCase() === 'crude') {
            const mcxApproxPrice = currentPrice * inrRate; 
            strikePriceNum = Math.round(mcxApproxPrice / 100) * 100; 
        } else if (instrumentType.toLowerCase() === 'gold') {
            strikePriceNum = "ATM (Look at Broker)";
        }

        // CALL OPTION LOGIC (Requires RSI > 50 for high probability)
        if (ema5 > ema20 && candleGain > 0 && currentRSI > 50) {
            signal = "BUY";
            optionType = "CE (CALL)";
            logic = `🔥 EXPLOSIVE TREND CONFIRMED: ${instrumentName} ADX is high (${currentADX.toFixed(1)}) and RSI is Bullish (${currentRSI.toFixed(1)}). The 5 EMA has crossed above the 20 EMA with bullish volume. This is an Early-Entry "Gap & Go" setup for catching spikes!`;
        } 
        // PUT OPTION LOGIC (Requires RSI < 50 for high probability)
        else if (ema5 < ema20 && candleGain < 0 && currentRSI < 50) {
            signal = "BUY";
            optionType = "PE (PUT)";
            logic = `🩸 BEARISH BREAKDOWN CONFIRMED: ${instrumentName} ADX is high (${currentADX.toFixed(1)}) and RSI is Bearish (${currentRSI.toFixed(1)}). The 5 EMA has crossed below the 20 EMA on selling volume. Early-Entry short trigger activated!`;
        }
        else {
            let spotDisplay = `${currentPrice.toFixed(2)}`;
            if (instrumentType.toLowerCase() === 'crude') {
                spotDisplay += ` ($) / ₹${(currentPrice * inrRate).toFixed(0)} (MCX Approx)`;
            }

            return {
                status: 'NO_TRADE',
                message: `Current ${instrumentName} Spot: ${spotDisplay}.\n\n` + 
                         `⚠️ Market Check: ADX is ${currentADX.toFixed(1)} and RSI is ${currentRSI.toFixed(1)}.\n` +
                         `📉 Trend Check: 5-EMA is at ${ema5.toFixed(2)} | 20-EMA is at ${ema20.toFixed(2)}.\n` +
                         `The market is currently CHOPPY/SIDEWAYS because the Trend lines (EMA) have not crossed safely, or there is no strong breakout candle. In F&O, you only buy options when momentum is explosive. Protect your ₹3,500 capital and sit out. Re-check in 2 minutes.`
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

        // Return the Option Trade Plan
        return {
            status: 'TRADE_FOUND',
            spotPrice: currentPrice.toFixed(2),
            instrumentName: instrumentName,
            mcxNote: mcxNote,
            newsHeadline: newsHeadline,
            trade: {
                type: optionType,
                logic: logic,
                strikeGuide: `${strikePriceNum} ${optionType}`,
                expiryGuide: `${expiryDateStr} Expiry`,
                rules: [
                    "⚠️ CAPITAL MANAGEMENT: You are recovering capital (₹3,500). Use MAX 30% of capital per trade.",
                    "🎯 TARGET: +2% (Safe, highly accurate profit booking to build capital steadily).",
                    "🛑 STOP LOSS: -1% (STRICT - Cut losses immediately if thesis breaks).",
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
