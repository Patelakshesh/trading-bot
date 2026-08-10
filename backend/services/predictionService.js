const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const { RSI, MACD, EMA, BollingerBands } = require('technicalindicators');

const { INTRADAY_UNIVERSE } = require('./intradayService');

async function calculatePredictionScore(symbol) {
    try {
        const daily = await yahooFinance.chart(symbol, { interval: '1d', range: '3mo' }).catch(() => null);
        if (!daily || !daily.quotes || daily.quotes.length < 50) return null;

        const quotes = daily.quotes.filter(q => q.close !== null);
        const closes = quotes.map(q => q.close);
        const volumes = quotes.map(q => q.volume);
        
        let score = 0;
        let reasons = [];

        // 1. RSI(7) Bounce Check (+25 points)
        const rsiVals = RSI.calculate({ period: 7, values: closes });
        if (rsiVals.length >= 2) {
            const currentRsi = rsiVals[rsiVals.length - 1];
            const prevRsi = rsiVals[rsiVals.length - 2];
            if (prevRsi < 30 && currentRsi >= 30) {
                score += 25;
                reasons.push('RSI Oversold Bounce');
            } else if (currentRsi > 55 && currentRsi < 70 && currentRsi > prevRsi) {
                score += 10;
                reasons.push('RSI Bullish Momentum');
            }
        }

        // 2. MACD Histogram turning positive (+20 points)
        const macdVals = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        if (macdVals.length >= 2) {
            const currentMacd = macdVals[macdVals.length - 1];
            const prevMacd = macdVals[macdVals.length - 2];
            if (prevMacd.histogram < 0 && currentMacd.histogram > 0) {
                score += 20;
                reasons.push('MACD Bullish Crossover');
            }
        }

        // 3. Volume > 2x Average (+20 points)
        const recentVols = volumes.slice(-11, -1);
        const avgVol10d = recentVols.reduce((a, b) => a + b, 0) / 10;
        const currentVol = volumes[volumes.length - 1];
        if (currentVol > avgVol10d * 2) {
            score += 20;
            reasons.push('2x Institutional Volume Spike');
        }

        // 4. 50-EMA Support Bounce (+15 points)
        const ema50 = EMA.calculate({ period: 50, values: closes });
        if (ema50.length > 0) {
            const currentEma50 = ema50[ema50.length - 1];
            const currentClose = closes[closes.length - 1];
            const currentLow = quotes[quotes.length - 1].low;
            
            // If the low touched/went below 50 EMA but close is comfortably above it
            if (currentLow <= currentEma50 && currentClose > currentEma50 * 1.005) {
                score += 15;
                reasons.push('50-EMA Support Bounce');
            }
        }

        // 5. Bollinger Band Squeeze (+15 points)
        const bbVals = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
        if (bbVals.length >= 2) {
            const currentBb = bbVals[bbVals.length - 1];
            const prevBb = bbVals[bbVals.length - 2];
            
            const currentWidth = (currentBb.upper - currentBb.lower) / currentBb.middle;
            const prevWidth = (prevBb.upper - prevBb.lower) / prevBb.middle;
            
            // Width is very tight (< 5%) and expanding slightly today
            if (prevWidth < 0.05 && currentWidth > prevWidth) {
                score += 15;
                reasons.push('Bollinger Band Squeeze Breakout');
            }
        }

        if (score === 0) return null;

        return {
            symbol,
            close: closes[closes.length - 1].toFixed(2),
            score,
            reasons: reasons.join(' + ')
        };

    } catch (err) {
        return null;
    }
}

async function generateTomorrowPredictions() {
    console.log(`🔮 [PREDICTION ENGINE] Scanning ${INTRADAY_UNIVERSE.length} stocks for tomorrow's momentum...`);
    const predictions = [];

    // Process in small batches to avoid Yahoo Finance rate limits
    const batchSize = 10;
    for (let i = 0; i < INTRADAY_UNIVERSE.length; i += batchSize) {
        const batch = INTRADAY_UNIVERSE.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(sym => calculatePredictionScore(sym)));
        
        for (const res of results) {
            if (res && res.score >= 35) { // Minimum threshold to be considered a strong prediction
                predictions.push(res);
            }
        }
    }

    // Sort by highest score
    predictions.sort((a, b) => b.score - a.score);
    return predictions.slice(0, 5); // Return Top 5
}

module.exports = {
    generateTomorrowPredictions
};
