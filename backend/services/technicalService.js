const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { RSI, MACD } = require('technicalindicators');

const getTechnicalIndicators = async (symbol) => {
    try {
        // Calculate date 90 days ago
        const period1 = new Date();
        period1.setDate(period1.getDate() - 90);
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

        // Calculate RSI (7 period - Faster for Short Term Swing Trading)
        const rsiInput = { values: closePrices, period: 7 };
        const rsiValues = RSI.calculate(rsiInput);
        const currentRSI = rsiValues[rsiValues.length - 1];

        // Calculate MACD (12, 26, 9)
        const macdInput = {
            values: closePrices,
            fastPeriod: 8, // Faster MACD
            slowPeriod: 17,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        };
        const macdValues = MACD.calculate(macdInput);
        const currentMACD = macdValues[macdValues.length - 1];

        return {
            RSI: currentRSI,
            MACD: currentMACD,
            status: currentRSI > 65 ? 'OVERBOUGHT (Risk of crash)' : currentRSI < 35 ? 'OVERSOLD (Potential bounce)' : 'NEUTRAL'
        };
    } catch (err) {
        console.error(`Error calculating technicals for ${symbol}:`, err.message);
        return null;
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

        // Use a faster 7-period RSI for Swing Trading
        const rsiValues = RSI.calculate({ values: closePrices, period: 7 });
        
        // Pad the beginning of RSI array with nulls to match the dates array length
        const rsiPadded = new Array(7).fill(null).concat(rsiValues);

        let balance = 100000; // Start with 1,00,000 capital
        let position = 0; // Number of shares owned
        let buyPriceTarget = 0;
        let daysHeld = 0;
        const trades = [];

        for (let i = 8; i < closePrices.length; i++) {
            const price = closePrices[i];
            const rsi = rsiPadded[i];
            const date = dates[i];

            if (position > 0) {
                daysHeld++;
            }

            // BUY SIGNAL: RSI deeply oversold (< 35 on the fast 7-day scale)
            if (rsi < 35 && position === 0) {
                const sharesToBuy = Math.floor(balance / price);
                if (sharesToBuy > 0) {
                    position = sharesToBuy;
                    balance -= sharesToBuy * price;
                    buyPriceTarget = price;
                    daysHeld = 0;
                    trades.push({ type: 'BUY', date, price, amount: sharesToBuy * price });
                }
            }
            // SELL SIGNAL: RSI overbought (> 65), OR we hit a quick 4% profit, OR Time-Stop (max hold 5 days)
            else if (position > 0 && (rsi > 65 || (price >= buyPriceTarget * 1.04) || daysHeld >= 5)) {
                const sellAmount = position * price;
                balance += sellAmount;
                trades.push({ type: 'SELL', date, price, amount: sellAmount, reason: rsi > 65 ? 'RSI' : (daysHeld >= 5 ? 'Time Stop' : 'Take Profit') });
                position = 0;
                daysHeld = 0;
            }
        }

        // Close any open position at the very end to calculate final profit
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

module.exports = { getTechnicalIndicators, runBacktest };
