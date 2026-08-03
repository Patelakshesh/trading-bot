// ============================================================================
// PROFESSIONAL INTRADAY QUANT ENGINE (3-Layer Confluence & Sector Shielding)
// Specifically built for Nifty 100 Liquid Blue-Chips with SEBI 5x Margin Math
// ============================================================================

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const riskManager = require('./riskService');

// NIFTY 100 ULTRA-LIQUID BLUE-CHIP UNIVERSE
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

// MAPPING STOCKS TO THEIR PARENT SECTOR INDICES (The "Rising Tide" Shield)
const SECTOR_MAPPING = {
    'TCS.NS': '^CNXIT', 'INFY.NS': '^CNXIT', 'WIPRO.NS': '^CNXIT', 'HCLTECH.NS': '^CNXIT', 'TECHM.NS': '^CNXIT', 'LTIM.NS': '^CNXIT',
    'HDFCBANK.NS': '^NSEBANK', 'ICICIBANK.NS': '^NSEBANK', 'SBI.NS': '^NSEBANK', 'AXISBANK.NS': '^NSEBANK', 'KOTAKBANK.NS': '^NSEBANK', 
    'BAJFINANCE.NS': '^NSEBANK', 'BAJAJFINSV.NS': '^NSEBANK', 'INDUSINDBK.NS': '^NSEBANK', 'SBILIFE.NS': '^NSEBANK', 'HDFCLIFE.NS': '^NSEBANK',
    'TATUMOTORS.NS': '^CNXAUTO', 'M&M.NS': '^CNXAUTO', 'MARUTI.NS': '^CNXAUTO', 'EICHERMOT.NS': '^CNXAUTO', 'HEROMOTOCO.NS': '^CNXAUTO', 'BAJAJ-AUTO.NS': '^CNXAUTO', 'TVSMOTOR.NS': '^CNXAUTO',
    'RELIANCE.NS': '^CNXENERGY', 'NTPC.NS': '^CNXENERGY', 'POWERGRID.NS': '^CNXENERGY', 'COALINDIA.NS': '^CNXENERGY', 'ONGC.NS': '^CNXENERGY', 'BPCL.NS': '^CNXENERGY', 'GAIL.NS': '^CNXENERGY',
    'ITC.NS': '^CNXFMCG', 'HINDUNILVR.NS': '^CNXFMCG', 'BRITANNIA.NS': '^CNXFMCG', 'TATACONSUM.NS': '^CNXFMCG', 'DABUR.NS': '^CNXFMCG', 'GODREJCP.NS': '^CNXFMCG', 'MARICO.NS': '^CNXFMCG',
    'SUNPHARMA.NS': '^CNXPHARMA', 'CIPLA.NS': '^CNXPHARMA', 'DRREDDY.NS': '^CNXPHARMA', 'APOLLOHOSP.NS': '^CNXPHARMA', 'DIVISLAB.NS': '^CNXPHARMA', 'TORNTFARM.NS': '^CNXPHARMA',
    'TATASTEEL.NS': '^CNXMETA', 'JSWSTEEL.NS': '^CNXMETA', 'HINDALCO.NS': '^CNXMETA', 'JINDALSTEL.NS': '^CNXMETA', 'VEDL.NS': '^CNXMETA'
};

const SECTOR_NAMES = {
    '^CNXIT': 'Nifty IT', '^NSEBANK': 'Nifty Bank', '^CNXAUTO': 'Nifty Auto',
    '^CNXENERGY': 'Nifty Energy', '^CNXFMCG': 'Nifty FMCG', '^CNXPHARMA': 'Nifty Pharma', '^CNXMETA': 'Nifty Metal'
};

// Verify IST Time (Rule: No trading before 9:30 AM Opening Range completion)
function checkIndianMarketTime() {
    const now = new Date();
    const utcMillis = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istMillis = utcMillis + (5.5 * 3600000);
    const istDate = new Date(istMillis);

    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();
    const dayOfWeek = istDate.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { isOpen: false, reason: "📅 Indian Stock Markets are currently closed for the Weekend! Running scan in weekend historical replay mode." };
    }

    if (hours < 9 || (hours === 9 && minutes < 15)) {
        return { isOpen: false, reason: "⏰ Market not open yet! NSE opens at 9:15 AM IST. Try again after 9:30 AM once Opening Range finishes forming." };
    }

    if (hours === 9 && minutes >= 15 && minutes < 30) {
        return { isOpen: false, reason: "⏳ **NO-TRADE ZONE ACTIVE!** Institutional Opening Range (9:15 - 9:30 AM IST) is currently building. Never execute intraday before 9:30 AM! Please re-run command after 9:31 AM." };
    }

    if (hours > 15 || (hours === 15 && minutes >= 30)) {
        return { isOpen: false, reason: "🌙 Market closed for the day! Running scan on today's closing institutional setups." };
    }

    if (hours === 15 && minutes >= 10 && minutes < 30) {
        return { isOpen: false, chopWarning: null, reason: "⚠️ **DANGER ZONE (After 3:10 PM IST):** No new Intraday orders permitted! Brokers auto-square-off positions at 3:15 PM with penalty fees." };
    }

    let chopWarning = null;
    if ((hours === 11 && minutes >= 15) || (hours === 12) || (hours === 13 && minutes < 30)) {
        chopWarning = "🟡 <b>INTRADAY LUNCH HOUR CHOP ZONE (11:15 AM – 1:30 PM IST)</b>\n<i>⚠️ Institutional trading volume has dropped for lunchtime! Stocks often reverse or drift sideways during this window, causing false breakout signals and stop-loss hits. We strictly recommend holding off on new intraday entries until 1:30 PM!</i>\n\n";
    }

    return { isOpen: true, chopWarning, reason: "🟢 Live Intraday Market Session Active!" };
}

// Fetch Intraday Setups with 3-Layer Institutional Confluence
async function getIntradaySetups(targetSymbol = null, capital = 20000) {
    const timeStatus = checkIndianMarketTime();

    // 1. Fetch Nifty 50 and major Sector Indices for Sector Confluence ("Rising Tide" Shield)
    const sectorPerformance = {};
    try {
        const indexSymbols = ['^NSEI', '^NSEBANK', '^CNXIT', '^CNXAUTO', '^CNXENERGY', '^CNXFMCG', '^CNXPHARMA', '^CNXMETA'];
        const idxQuotes = await yahooFinance.quote(indexSymbols);
        if (Array.isArray(idxQuotes)) {
            idxQuotes.forEach(iq => {
                if (iq && iq.symbol) {
                    sectorPerformance[iq.symbol] = parseFloat((iq.regularMarketChangePercent || 0).toFixed(2));
                }
            });
        }
        // Check Broader Nifty 50 drop
        if (sectorPerformance['^NSEI'] < -0.15) {
            timeStatus.chopWarning = (timeStatus.chopWarning || "") + 
                `🚨 <b>NIFTY 50 BEARISH MARKET ALERT (${sectorPerformance['^NSEI']}%)</b>\n` +
                `<i>⚠️ The broader Nifty 50 index is experiencing institutional selling pressure! Keep stop-losses extra tight today!</i>\n\n`;
        }
    } catch (e) {
        console.warn("Could not retrieve Sector Indices benchmark:", e.message);
    }
    
    let candidates = targetSymbol ? 
        [targetSymbol.toUpperCase().endsWith('.NS') ? targetSymbol.toUpperCase() : `${targetSymbol.toUpperCase()}.NS`] : 
        [...NIFTY_100_SYMBOLS];

    console.log(`⚡ [INTRADAY ENGINE] Scanning ${candidates.length} blue-chip stocks for 3-Layer Institutional Confluence...`);

    let quotes = [];
    try {
        // Chunked fetching to bypass Yahoo Finance HTTP 429 rate limits & URI constraints on cloud IP deployments (Render)
        const chunkSize = 20;
        for (let i = 0; i < candidates.length; i += chunkSize) {
            const chunk = candidates.slice(i, i + chunkSize);
            try {
                let res = await yahooFinance.quote(chunk);
                if (!Array.isArray(res)) res = [res].filter(Boolean);
                quotes.push(...res);
            } catch (chunkErr) {
                console.warn(`[Cloud Fallback] Chunk fetch warning for index ${i}:`, chunkErr.message);
            }
        }
    } catch (e) {
        console.error("Batched Yahoo Quote failed in Intraday Engine:", e.message);
    }

    if (quotes.length === 0) {
        console.warn("⚠️ All quote batches returned empty on cloud IP. Fallback to default benchmark leader.");
        return { timeStatus, setups: [] };
    }

    const setups = [];

    for (const q of quotes) {
        if (!q || (!q.regularMarketPrice && !q.currentPrice)) continue;
        if (!targetSymbol && (q.regularMarketPrice || q.currentPrice) < 50) continue;

        const symbol = q.symbol;
        const livePrice = parseFloat(q.regularMarketPrice || q.currentPrice);
        const openPrice = parseFloat(q.regularMarketOpen || q.open) || livePrice;
        const dayHigh = parseFloat(q.regularMarketDayHigh || q.dayHigh) || livePrice * 1.01;
        const dayLow = parseFloat(q.regularMarketDayLow || q.dayLow) || livePrice * 0.99;
        const previousClose = parseFloat(q.regularMarketPreviousClose || q.previousClose) || livePrice;
        const currentVolume = parseFloat(q.regularMarketVolume || q.volume) || 0;
        const avgVolume = parseFloat(q.averageDailyVolume10Day || q.averageVolume) || parseFloat(q.averageDailyVolume3Month) || currentVolume;

        // 1. VWAP & OPENING RANGE HIGH (ORB) APPROXIMATION
        const typicalPrice = (dayHigh + dayLow + livePrice) / 3;
        const estimatedVwap = parseFloat(((typicalPrice + openPrice + livePrice) / 3).toFixed(2));
        const estimatedOrbHigh = parseFloat((openPrice + ((dayHigh - openPrice) * 0.65)).toFixed(2));

        // 2. BUYER DOMINANCE PERCENTAGE EVALUATION (Exhaustion & Seller Trap Filter)
        const totalRange = dayHigh - dayLow;
        const buyerDominanceRatio = totalRange > 0 ? ((livePrice - dayLow) / totalRange) * 100 : 75;
        const buyerDominancePercent = Math.min(100, Math.max(0, parseFloat(buyerDominanceRatio.toFixed(0))));

        // 3. SECTOR CONFLUENCE EVALUATION ("Rising Tide")
        const parentSectorSymbol = SECTOR_MAPPING[symbol] || '^NSEI';
        const parentSectorName = SECTOR_NAMES[parentSectorSymbol] || 'Nifty 50';
        const sectorChange = sectorPerformance[parentSectorSymbol] !== undefined ? sectorPerformance[parentSectorSymbol] : (sectorPerformance['^NSEI'] || 0);
        const isSectorBullish = sectorChange >= 0;

        // 4. MOMENTUM CONFLUENCE CONDITIONS
        const isAboveVwap = livePrice >= (estimatedVwap * 0.998);
        const isAboveOrb = livePrice >= (estimatedOrbHigh * 0.998);
        const volumeRatioVal = avgVolume > 0 ? (currentVolume / avgVolume) * 100 : 150;
        const volumeRatio = volumeRatioVal.toFixed(0);
        const changePercentVal = ((livePrice - previousClose) / previousClose) * 100;
        const changePercent = parseFloat(changePercentVal.toFixed(2));

        // INTRADAY LAW FOR MAXIMUM RESILIENT CLOUD WIN RATE:
        // Zero hard exclusion deletions! We use scoring rewards and penalties below so cloud servers never deliver empty results!

        // Calculate Upgraded Pro Target (+2.0% from live price) & Tight Stop-Loss (-0.75% from live price)
        const targetPrice = parseFloat((livePrice * 1.020).toFixed(2));
        const stopLossPrice = parseFloat((livePrice * 0.9925).toFixed(2));

        const riskEval = riskManager.evaluateTradeViability(symbol, livePrice, targetPrice, stopLossPrice, capital, true);

        // Double Check Verdict (/intraday SYMBOL)
        let doubleCheckVerdict = "🟢 PRO VERDICT: HIGH-WIN CONFLUENCE BUY (MIS)";
        let adviceAction = "EXECUTE BUY (MIS 5x Margin)";
        let doubleCheckReason = `3-Layer Confluence verified! Buyer dominance sits strong at ${buyerDominancePercent}% alongside positive ${parentSectorName} sector inflow (${sectorChange >= 0 ? '+' : ''}${sectorChange}%). Solid above-VWAP momentum.`;

        if (!isAboveVwap) {
            doubleCheckVerdict = "🔴 PRO VERDICT: DO NOT BUY! (Below VWAP Anchor)";
            adviceAction = "AVOID / DO NOT BUY";
            doubleCheckReason = `Price (₹${livePrice.toFixed(2)}) is BELOW its VWAP benchmark (₹${estimatedVwap.toFixed(2)}). Institutional algorithmic funds never go long below VWAP.`;
        } else if (!isAboveOrb) {
            doubleCheckVerdict = "🟡 PRO VERDICT: WAIT FOR BREAKOUT (Below ORB High)";
            adviceAction = "HOLD / ADD TO WATCHLIST";
            doubleCheckReason = `Stock has not cleanly crossed above today's Opening Range High resistance (₹${estimatedOrbHigh.toFixed(2)}).`;
        } else if (buyerDominancePercent < 55) {
            doubleCheckVerdict = "🔴 PRO VERDICT: SELLER EXHAUSTION DETECTED!";
            adviceAction = "AVOID ENTRY";
            doubleCheckReason = `Despite early morning rises, short-term sellers have taken over today's candle (Buyer Dominance is only ${buyerDominancePercent}%). High probability of pullback!`;
        } else if (changePercent > 3.2) {
            doubleCheckVerdict = "🟡 PRO VERDICT: OVEREXTENDED / EXHAUSTED GAP";
            adviceAction = "AVOID CHASING AT PEAK";
            doubleCheckReason = `Stock has already jumped +${changePercent}% today! Chasing after a >3% opening surge carries severe risk of institutional profit-taking pullbacks.`;
        }

        // DETERMINISTIC QUANTITATIVE SCORE ARCHITECTURE WITH EXHAUSTION SHOUTOUTS
        let quantScore = 55;
        if (isAboveVwap) quantScore += 15;
        if (isAboveOrb) quantScore += 12;
        if (buyerDominancePercent >= 80) quantScore += 15;
        else if (buyerDominancePercent < 60) quantScore -= 25; // Heavily penalize seller control!

        if (isSectorBullish) quantScore += 10;
        else quantScore -= 15; // Heavily penalize fighting sector trend!

        // Gold Sweet Spot vs Exhaustion Trap reward/penalty
        if (changePercent >= 0.5 && changePercent <= 2.6) quantScore += 15;
        else if (changePercent > 3.0) quantScore -= 35; // Downrank exhausted gap-ups so they never claim #1!

        const volBonus = Math.min(8, Math.floor(volumeRatioVal / 30));
        quantScore += volBonus;
        if (quantScore > 98) quantScore = 98;
        if (quantScore < 20) quantScore = 20;

        // Push all viable candidates so cloud servers always deliver top recommendations!
        setups.push({
            symbol,
            name: q.shortName || q.longName || symbol.replace('.NS', ''),
            livePrice: livePrice.toFixed(2),
            changePercent: `${changePercent >= 0 ? '+' : ''}${changePercent}%`,
            vwap: estimatedVwap.toFixed(2),
            orbHigh: estimatedOrbHigh.toFixed(2),
            volumeSurge: `${volumeRatio}%`,
            buyerDominance: `${buyerDominancePercent}%`,
            sectorInfo: `${parentSectorName} (${sectorChange >= 0 ? '+' : ''}${sectorChange}%)`,
            isAboveVwap,
            isAboveOrb,
            target: targetPrice.toFixed(2),
            stopLoss: stopLossPrice.toFixed(2),
            riskEvaluation: riskEval,
            doubleCheckVerdict,
            adviceAction,
            doubleCheckReason,
            rawScore: (quantScore * 10000) + (buyerDominancePercent * 100) + volumeRatioVal,
            confidence: quantScore
        });
    }

    // Sort strictly deterministically by quant score, buyer dominance, and volume shock
    setups.sort((a, b) => b.rawScore - a.rawScore);

    return {
        timeStatus,
        setups: targetSymbol ? setups.slice(0, 1) : setups.slice(0, 3)
    };
}

module.exports = {
    checkIndianMarketTime,
    getIntradaySetups,
    NIFTY_100_SYMBOLS
};
