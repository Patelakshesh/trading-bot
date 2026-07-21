const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const { RSI, MACD, SMA, BollingerBands } = require('technicalindicators');

const getTechnicalIndicators = async (symbol) => {
    try {
        // Calculate date 300 days ago (to ensure we have at least 200 trading days)
        const period1 = new Date();
        period1.setDate(period1.getDate() - 300);
        const period2 = new Date();

        const historical = await yahooFinance.historical(symbol, {
            period1: period1.toISOString().split('T')[0],
            period2: period2.toISOString().split('T')[0],
            interval: '1d'
        });

        if (!historical || historical.length < 30) {
            return null; // Not enough data
        }

        const closePrices = historical.map(row => row.close);
        const volumes = historical.map(row => row.volume);

        // Calculate RSI (7 period - Faster for Short Term Swing Trading)
        const rsiInput = { values: closePrices, period: 7 };
        const rsiValues = RSI.calculate(rsiInput);
        const currentRSI = rsiValues[rsiValues.length - 1];

        // Calculate MACD
        const macdInput = {
            values: closePrices,
            fastPeriod: 8,
            slowPeriod: 17,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        };
        const macdValues = MACD.calculate(macdInput);
        const currentMACD = macdValues[macdValues.length - 1];

        // === VOLUME ANALYSIS (Institutional buying detection) ===
        const avgVolume10d = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const todayVolume = volumes[volumes.length - 1];
        const volumeRatio = todayVolume / avgVolume10d;
        const volumeSignal = volumeRatio >= 1.5 ? 'HIGH (Strong institutional buying)'
                          : volumeRatio >= 1.2 ? 'ABOVE AVERAGE (Confirming move)'
                          : volumeRatio >= 0.8 ? 'NORMAL'
                          : 'LOW (Weak move - be cautious)';

        // === SUPPORT LEVEL DETECTION (Near support = safer entry) ===
        const last20Lows = historical.slice(-20).map(r => r.low);
        const supportLevel = Math.min(...last20Lows);
        const currentClose = closePrices[closePrices.length - 1];
        const distFromSupport = ((currentClose - supportLevel) / supportLevel * 100).toFixed(2);
        const nearSupport = parseFloat(distFromSupport) <= 3;

        // === TREND ANALYSIS (Moving Averages) ===
        // A stock below its 200-SMA is in a long-term downtrend (avoid buying)
        let sma50 = null, sma200 = null, trendSignal = 'NEUTRAL';
        if (closePrices.length >= 200) {
            const sma200Values = SMA.calculate({ period: 200, values: closePrices });
            sma200 = sma200Values[sma200Values.length - 1];
            
            const sma50Values = SMA.calculate({ period: 50, values: closePrices });
            sma50 = sma50Values[sma50Values.length - 1];

            if (currentClose > sma50 && currentClose > sma200) trendSignal = 'STRONG UPTREND (Above 50 & 200 SMA)';
            else if (currentClose < sma200) trendSignal = 'DOWNTREND (Below 200 SMA - HIGH RISK)';
            else trendSignal = 'SIDEWAYS / RECOVERING';
        }

        // === BOLLINGER BANDS (Explosive Breakout Detection) ===
        const bbInput = { period: 20, values: closePrices, stdDev: 2 };
        const bbValues = BollingerBands.calculate(bbInput);
        const currentBB = bbValues[bbValues.length - 1];
        
        // Calculate Bandwidth to detect a "Squeeze" (when bands are extremely tight, a massive move is coming)
        let isSqueeze = false;
        let bbStatus = 'NORMAL';
        if (currentBB && currentBB.upper && currentBB.lower && currentBB.middle) {
            const bandwidth = (currentBB.upper - currentBB.lower) / currentBB.middle;
            isSqueeze = bandwidth < 0.05; // 5% bandwidth is very tight
            
            if (isSqueeze) bbStatus = 'SQUEEZE (Massive explosion imminent)';
            else if (currentClose > currentBB.upper) bbStatus = 'BREAKOUT (Above Upper Band)';
            else if (currentClose < currentBB.lower) bbStatus = 'OVERSOLD (Below Lower Band)';
        }

        return {
            RSI: currentRSI,
            MACD: currentMACD,
            volume: todayVolume,
            avgVolume: Math.round(avgVolume10d),
            volumeRatio: volumeRatio.toFixed(2),
            volumeSignal,
            supportLevel: supportLevel.toFixed(2),
            distFromSupport: `${distFromSupport}%`,
            nearSupport,
            sma50: sma50 ? sma50.toFixed(2) : 'N/A',
            sma200: sma200 ? sma200.toFixed(2) : 'N/A',
            trendSignal,
            bbStatus,
            isSqueeze,
            status: currentRSI > 65 ? 'OVERBOUGHT (Risk of crash)' : currentRSI < 35 ? 'OVERSOLD (Potential bounce)' : 'NEUTRAL'
        };
    } catch (err) {
        console.error(`Error calculating technicals for ${symbol}:`, err.message);
        return null;
    }
};

// === EARNINGS RISK CHECK (Avoid buying before earnings - highest cause of crashes) ===
const hasEarningsRisk = async (symbol) => {
    try {
        const summary = await yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents'] });
        const earningsDate = summary?.calendarEvents?.earnings?.earningsDate?.[0];
        if (!earningsDate) return { hasRisk: false, reason: 'No upcoming earnings found' };
        
        const daysToEarnings = Math.floor((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysToEarnings >= 0 && daysToEarnings <= 5) {
            return { hasRisk: true, reason: `⚠️ Earnings in ${daysToEarnings} days! HIGH RISK.`, daysToEarnings };
        }
        return { hasRisk: false, reason: `Earnings in ${daysToEarnings} days (safe)`, daysToEarnings };
    } catch(e) {
        return { hasRisk: false, reason: 'Earnings data unavailable' };
    }
};

const runBacktest = async (symbol, days = 365) => {
    try {
        const period1 = new Date();
        period1.setDate(period1.getDate() - days);
        const period2 = new Date();

        const historical = await yahooFinance.historical(symbol, {
            period1: period1.toISOString().split('T')[0],
            period2: period2.toISOString().split('T')[0],
            interval: '1d'
        });

        if (!historical || historical.length < 35) return { error: "Not enough data to backtest" };

        const closePrices = historical.map(row => row.close);
        const dates = historical.map(row => row.date);

        const rsiValues = RSI.calculate({ values: closePrices, period: 7 });
        const rsiPadded = new Array(7).fill(null).concat(rsiValues);

        let balance = 100000;
        let position = 0;
        let buyPriceTarget = 0;
        let daysHeld = 0;
        const trades = [];

        for (let i = 8; i < closePrices.length; i++) {
            const price = closePrices[i];
            const rsi = rsiPadded[i];
            const date = dates[i];

            if (position > 0) daysHeld++;

            if (rsi < 35 && position === 0) {
                const sharesToBuy = Math.floor(balance / price);
                if (sharesToBuy > 0) {
                    position = sharesToBuy;
                    balance -= sharesToBuy * price;
                    buyPriceTarget = price;
                    daysHeld = 0;
                    trades.push({ type: 'BUY', date, price, amount: sharesToBuy * price });
                }
            } else if (position > 0 && (rsi > 65 || (price >= buyPriceTarget * 1.04) || daysHeld >= 5)) {
                const sellAmount = position * price;
                balance += sellAmount;
                trades.push({ type: 'SELL', date, price, amount: sellAmount, reason: rsi > 65 ? 'RSI' : (daysHeld >= 5 ? 'Time Stop' : 'Take Profit') });
                position = 0;
                daysHeld = 0;
            }
        }

        if (position > 0) {
            const finalPrice = closePrices[closePrices.length - 1];
            balance += position * finalPrice;
            trades.push({ type: 'SELL', date: dates[dates.length - 1], price: finalPrice, amount: position * finalPrice, note: "End of Backtest" });
        }

        const profit = balance - 100000;
        const profitPercent = ((profit / 100000) * 100).toFixed(2);

        return {
            symbol,
            days,
            startingBalance: 100000,
            finalBalance: balance.toFixed(2),
            profit: profit.toFixed(2),
            profitPercent,
            totalTrades: trades.length,
            trades
        };

    } catch (err) {
        console.error("Backtest error:", err);
        return { error: "Failed to run backtest" };
    }
};

module.exports = { getTechnicalIndicators, runBacktest, hasEarningsRisk };
