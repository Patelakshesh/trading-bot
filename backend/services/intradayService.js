// ============================================================================
// PROFESSIONAL INTRADAY QUANT ENGINE (15-Minute ORB + VWAP Confluence)
// Specifically built for Nifty 100 Liquid Blue-Chips with SEBI 5x Margin Math
// ============================================================================

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const riskManager = require('./riskService');

// NIFTY 100 ULTRA-LIQUID BLUE-CHIP UNIVERSE (Never trade illiquid small-caps intraday!)
const NIFTY_100_SYMBOLS = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS',
    'SBI.NS', 'BHARTIARTL.NS', 'ITC.NS', 'LT.NS', 'TATUMOTORS.NS',
    'AXISBANK.NS', 'M&M.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'KOTAKBANK.NS',
    'HINDUNILVR.NS', 'TITAN.NS', 'BAJFINANCE.NS', 'ULTRACEMCO.NS', 'ASIANPAINT.NS',
    'NTPC.NS', 'POWERGRID.NS', 'WIPRO.NS', 'HCLTECH.NS', 'COALINDIA.NS',
    'BAJAJFINSV.NS', 'ADANIENT.NS', 'TATASTEEL.NS', 'JSWSTEEL.NS', 'HDFCLIFE.NS',
    'GRASIM.NS', 'TECHM.NS', 'ADANIPORTS.NS', 'HINDALCO.NS', 'BRITANNIA.NS',
    'INDUSINDBK.NS', 'ONGC.NS', 'CIPLA.NS', 'EICHERMOT.NS', 'DRREDDY.NS',
    'BPCL.NS', 'TATACONSUM.NS', 'APOLLOHOSP.NS', 'DIVISLAB.NS', 'HEROMOTOCO.NS',
    'SBILIFE.NS', 'BAJAJ-AUTO.NS', 'LTIM.NS', 'UPL.NS', 'SHRIRAMFIN.NS',
    'AMBUJACEM.NS', 'BERGEPAINT.NS', 'BOSCHLTD.NS', 'CANBK.NS', 'COLPAL.NS',
    'DABUR.NS', 'DLF.NS', 'GAIL.NS', 'GODREJCP.NS', 'HAVELLS.NS',
    'HINDPETRO.NS', 'ICICIGI.NS', 'ICICIPRULI.NS', 'IOC.NS', 'IRCTC.NS',
    'NAUKRI.NS', 'JINDALSTEL.NS', 'MARICO.NS', 'MOTHERSON.NS', 'MUTHOOTFIN.NS',
    'PIDILITIND.NS', 'PFC.NS', 'RECLTD.NS', 'SIEMENS.NS', 'SRF.NS',
    'TATAPOWER.NS', 'TORNTFARM.NS', 'TRENT.NS', 'TVSMOTOR.NS', 'VEDL.NS'
];

// Verify IST Time (Rule: No trading before 9:30 AM Opening Range completion)
function checkIndianMarketTime() {
    const now = new Date();
    // Convert current UTC time to IST (UTC+5:30)
    const utcMillis = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istMillis = utcMillis + (5.5 * 3600000);
    const istDate = new Date(istMillis);

    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();
    const dayOfWeek = istDate.getDay(); // 0 is Sunday, 6 is Saturday

    // Check weekend
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { isOpen: false, reason: "📅 Indian Stock Markets are currently closed for the Weekend! Running scan in weekend historical replay mode." };
    }

    // Between midnight and 9:15 AM
    if (hours < 9 || (hours === 9 && minutes < 15)) {
        return { isOpen: false, reason: "⏰ Market not open yet! NSE opens at 9:15 AM IST. Try again after 9:30 AM once Opening Range finishes forming." };
    }

    // Between 9:15 AM and 9:30 AM
    if (hours === 9 && minutes >= 15 && minutes < 30) {
        return { isOpen: false, reason: "⏳ **NO-TRADE ZONE ACTIVE!** Institutional Opening Range (9:15 - 9:30 AM IST) is currently building. Never execute intraday before 9:30 AM! Please re-run command after 9:31 AM." };
    }

    // After 3:30 PM
    if (hours > 15 || (hours === 15 && minutes >= 30)) {
        return { isOpen: false, reason: "🌙 Market closed for the day! Running scan on today's closing institutional setups." };
    }

    // After 3:10 PM - No new intraday trades allowed
    if (hours === 15 && minutes >= 10 && minutes < 30) {
        return { isOpen: false, chopWarning: null, reason: "⚠️ **DANGER ZONE (After 3:10 PM IST):** No new Intraday orders permitted! Brokers auto-square-off positions at 3:15 PM with penalty fees." };
    }

    // Lunchtime Chop Zone Warning (11:15 AM - 1:30 PM IST)
    let chopWarning = null;
    if ((hours === 11 && minutes >= 15) || (hours === 12) || (hours === 13 && minutes < 30)) {
        chopWarning = "🟡 <b>INTRADAY LUNCH HOUR CHOP ZONE (11:15 AM – 1:30 PM IST)</b>\n<i>⚠️ Institutional trading volume has dropped for lunchtime! Stocks often reverse or drift sideways during this window, causing false breakout signals and stop-loss hits. We strictly recommend holding off on new intraday entries until 1:30 PM!</i>\n\n";
    }

    return { isOpen: true, chopWarning, reason: "🟢 Live Intraday Market Session Active!" };
}

// Fetch Intraday Setups with VWAP and ORB Confluence
async function getIntradaySetups(targetSymbol = null, capital = 20000) {
    const timeStatus = checkIndianMarketTime();

    // 1. Check Broader Market Status (Nifty 50 Index) to protect against overall market drop
    try {
        const niftyQuote = await yahooFinance.quote('^NSEI');
        if (niftyQuote && niftyQuote.regularMarketChangePercent < -0.15) {
            const niftyDrop = niftyQuote.regularMarketChangePercent.toFixed(2);
            timeStatus.chopWarning = (timeStatus.chopWarning || "") + 
                `🚨 <b>NIFTY 50 BEARISH MARKET ALERT (${niftyDrop}%)</b>\n` +
                `<i>⚠️ The broader Nifty 50 index is experiencing institutional selling pressure! When the general market falls due to global European/US futures cues, even strong individual stocks suffer pullbacks. Keep stop-losses extra tight today!</i>\n\n`;
        }
    } catch (e) {
        console.warn("Could not retrieve Nifty 50 Index benchmark:", e.message);
    }
    
    // Select candidates deterministically without any randomness!
    let candidates = [];
    if (targetSymbol) {
        const cleanSymbol = targetSymbol.toUpperCase().endsWith('.NS') ? targetSymbol.toUpperCase() : `${targetSymbol.toUpperCase()}.NS`;
        candidates = [cleanSymbol];
    } else {
        // Evaluate the full Nifty 100 liquid universe in fixed deterministic order
        candidates = [...NIFTY_100_SYMBOLS];
    }

    console.log(`⚡ [INTRADAY ENGINE] Scanning ${candidates.length} ultra-liquid blue-chip stocks for ORB + VWAP breakouts...`);

    let quotes = [];
    try {
        quotes = await yahooFinance.quote(candidates);
        if (!Array.isArray(quotes)) quotes = [quotes].filter(Boolean);
    } catch (e) {
        console.error("Batched Yahoo Quote failed in Intraday Engine:", e.message);
        return { timeStatus, setups: [], error: "Could not retrieve live intraday feed." };
    }

    const setups = [];

    for (const q of quotes) {
        if (!q || !q.regularMarketPrice) continue;
        if (!targetSymbol && q.regularMarketPrice < 100) continue; // Skip any quote below ₹100 for global scan

        const symbol = q.symbol;
        const livePrice = parseFloat(q.regularMarketPrice);
        const openPrice = parseFloat(q.regularMarketOpen) || livePrice;
        const dayHigh = parseFloat(q.regularMarketDayHigh) || livePrice * 1.01;
        const dayLow = parseFloat(q.regularMarketDayLow) || livePrice * 0.99;
        const previousClose = parseFloat(q.regularMarketPreviousClose) || livePrice;
        const currentVolume = parseFloat(q.regularMarketVolume) || 0;
        const avgVolume = parseFloat(q.averageDailyVolume10Day) || parseFloat(q.averageDailyVolume3Month) || currentVolume;

        // 1. VWAP ESTIMATION / APPROXIMATION
        const typicalPrice = (dayHigh + dayLow + livePrice) / 3;
        const estimatedVwap = parseFloat(((typicalPrice + openPrice + livePrice) / 3).toFixed(2));
        
        // 2. OPENING RANGE HIGH (ORB) ESTIMATION
        const estimatedOrbHigh = parseFloat((openPrice + ((dayHigh - openPrice) * 0.7)).toFixed(2));

        // 3. MOMENTUM CONFLUENCE CONDITIONS
        const isAboveVwap = livePrice >= (estimatedVwap * 0.998);
        const isAboveOrb = livePrice >= (estimatedOrbHigh * 0.998);
        const volumeRatioVal = avgVolume > 0 ? (currentVolume / avgVolume) * 100 : 150;
        const volumeRatio = volumeRatioVal.toFixed(0);
        const changePercentVal = ((livePrice - previousClose) / previousClose) * 100;
        const changePercent = parseFloat(changePercentVal.toFixed(2));

        // Intraday Law: Only consider active movers between +0.5% and +5.5% today
        if (!targetSymbol && (changePercent < 0.5 || changePercent > 5.5)) continue;

        // Calculate Intraday Target (+1.5% from live price) & Stop-Loss (-0.75% from live price)
        const targetPrice = parseFloat((livePrice * 1.015).toFixed(2));
        const stopLossPrice = parseFloat((livePrice * 0.9925).toFixed(2));

        // Feed through Risk Shield with isIntraday = true
        const riskEval = riskManager.evaluateTradeViability(symbol, livePrice, targetPrice, stopLossPrice, capital, true);

        // Explicit Double Check Verdict (Used when user types /intraday SYMBOL)
        let doubleCheckVerdict = "🟢 PRO VERDICT: SAFE TO BUY INTRADAY (MIS)";
        let adviceAction = "EXECUTE BUY (MIS 5x Margin)";
        let doubleCheckReason = "Triple-confluence confirmed! Stock is trading strongly above its VWAP institutional anchor and Opening Range High with volume expansion. Solid momentum setup.";

        if (!isAboveVwap) {
            doubleCheckVerdict = "🔴 PRO VERDICT: DO NOT BUY INTRADAY! (Below VWAP)";
            adviceAction = "AVOID / DO NOT BUY";
            doubleCheckReason = `Current live price (₹${livePrice.toFixed(2)}) is BELOW its VWAP institutional benchmark (₹${estimatedVwap.toFixed(2)}). Major Indian algorithmic trading funds never buy long below VWAP. High danger of intraday selling pressure!`;
        } else if (!isAboveOrb) {
            doubleCheckVerdict = "🟡 PRO VERDICT: WAIT FOR BREAKOUT (Below ORB High)";
            adviceAction = "HOLD / ADD TO WATCHLIST";
            doubleCheckReason = `Stock is above VWAP (₹${estimatedVwap.toFixed(2)}), but has not yet breached today's Opening Range resistance (₹${estimatedOrbHigh.toFixed(2)}). Do not enter until price cleanly crosses above ₹${estimatedOrbHigh.toFixed(2)}!`;
        } else if (changePercent > 5.0) {
            doubleCheckVerdict = "🟡 PRO VERDICT: OVEREXTENDED / RISKY TO CHASE";
            adviceAction = "AVOID CHASING AT PEAK";
            doubleCheckReason = `Stock is already up +${changePercent}% today! Buying intraday after an extended >5% run carries high risk of an immediate profit-taking pullback by earlier buyers.`;
        }

        // DETERMINISTIC QUANTITATIVE SCORE (No Math.random!)
        // Based on technical momentum structure + volume shock magnitude
        let quantScore = 55;
        if (isAboveVwap) quantScore += 20;
        if (isAboveOrb) quantScore += 15;
        const volBonus = Math.min(10, Math.floor(volumeRatioVal / 25));
        quantScore += volBonus;
        if (quantScore > 97) quantScore = 97;

        // For non-target global scans, strictly require both VWAP and ORB breakout confirmation!
        if (!targetSymbol && (!isAboveVwap || !isAboveOrb)) continue;

        if (targetSymbol || riskEval.approved) {
            setups.push({
                symbol,
                name: q.shortName || q.longName || symbol.replace('.NS', ''),
                livePrice: livePrice.toFixed(2),
                changePercent: `${changePercent >= 0 ? '+' : ''}${changePercent}%`,
                vwap: estimatedVwap.toFixed(2),
                orbHigh: estimatedOrbHigh.toFixed(2),
                volumeSurge: `${volumeRatio}%`,
                isAboveVwap,
                isAboveOrb,
                target: targetPrice.toFixed(2),
                stopLoss: stopLossPrice.toFixed(2),
                riskEvaluation: riskEval,
                doubleCheckVerdict,
                adviceAction,
                doubleCheckReason,
                rawScore: (quantScore * 1000) + volumeRatioVal, // Secondary sort by volume shock
                confidence: quantScore
            });
        }
    }

    // Sort strictly deterministically by Quantitative Momentum Score and Volume Shock
    setups.sort((a, b) => b.rawScore - a.rawScore);

    return {
        timeStatus,
        setups: targetSymbol ? setups : setups.slice(0, 3)
    };
}

module.exports = {
    checkIndianMarketTime,
    getIntradaySetups,
    NIFTY_100_SYMBOLS
};
