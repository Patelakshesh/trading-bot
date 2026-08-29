const { BollingerBands, RSI, EMA, ATR } = require('technicalindicators');
const angleOneService = require('./angleOneService');
const angleOneMapping = require('./angleOneMapping');
const optionChainService = require('./optionChainService');

class PreSignalDetector {
    constructor() {
        this.activePreSignals = new Map(); // asset -> { timestamp, setupType, expectedDirection, triggerPrice, target, sl }
    }

    /**
     * Scan an asset for early pre-breakout indicators (3-5 minutes before breakout)
     * @param {string} asset - 'nifty', 'banknifty', 'crude', 'gold', 'silver', 'natgas'
     * @param {Array} quotes - Array of 5m or 15m OHLCV candles
     * @param {number} livePrice - 0-second live tick price
     */
    async scanPreSignal(asset, quotes = [], livePrice = 0) {
        if (!quotes || quotes.length < 25) return null;

        const cleanAsset = asset.toLowerCase();
        const closes = quotes.map(q => q.close);
        const highs = quotes.map(q => q.high);
        const lows = quotes.map(q => q.low);
        const volumes = quotes.map(q => q.volume || 1);
        const currentPrice = livePrice > 0 ? livePrice : closes[closes.length - 1];

        // 1. Bollinger Band Squeeze Calculation (Leading Explosion Indicator)
        let isSqueeze = false;
        let bbWidth = 1.0;
        let bbUpper = currentPrice * 1.005;
        let bbLower = currentPrice * 0.995;

        try {
            const bb = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
            if (bb && bb.length >= 2) {
                const latestBB = bb[bb.length - 1];
                bbUpper = latestBB.upper;
                bbLower = latestBB.lower;
                bbWidth = ((latestBB.upper - latestBB.lower) / latestBB.middle) * 100;
                
                // Tight bandwidth (< 0.85% on indices / < 0.60% on commodities) indicates energy coiling
                const threshold = cleanAsset.includes('crude') || cleanAsset.includes('gold') ? 0.60 : 0.85;
                if (bbWidth <= threshold) {
                    isSqueeze = true;
                }
            }
        } catch (e) {}

        // 2. Volume Velocity & Acceleration
        const recentVols = volumes.slice(-6, -1);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
        const latestVol = volumes[volumes.length - 1];
        const volMultiplier = latestVol / (avgVol || 1);
        const isVolumeBuilding = volMultiplier >= 1.4;

        // 3. RSI Momentum & Divergence
        let currentRSI = 50;
        let prevRSI = 50;
        try {
            const rsiVals = RSI.calculate({ period: 14, values: closes });
            if (rsiVals && rsiVals.length >= 2) {
                currentRSI = rsiVals[rsiVals.length - 1];
                prevRSI = rsiVals[rsiVals.length - 2];
            }
        } catch (e) {}

        // 4. Multi-Timeframe EMAs
        let ema5 = currentPrice;
        let ema20 = currentPrice;
        try {
            const e5 = EMA.calculate({ period: 5, values: closes });
            const e20 = EMA.calculate({ period: 20, values: closes });
            if (e5.length) ema5 = e5[e5.length - 1];
            if (e20.length) ema20 = e20[e20.length - 1];
        } catch (e) {}

        // 5. Option Chain Institutional Bias
        const oiAnalysis = await optionChainService.getOptionChainAnalysis(cleanAsset, currentPrice);
        const pcr = oiAnalysis ? oiAnalysis.pcr : 1.0;

        // 6. DETECT HIGH-PROBABILITY EARLY SETUPS (3-5 Min Precursors)
        let detected = false;
        let direction = 'NEUTRAL';
        let setupName = '';
        let triggerPrice = currentPrice;
        let targetPrice = currentPrice;
        let stopLossPrice = currentPrice;
        let rationale = [];

        // Scenario A: Bullish Squeeze + Rising Volume + High PCR
        if ((isSqueeze || (bbWidth < 1.1 && isVolumeBuilding)) && currentRSI >= 48 && currentRSI <= 65 && currentPrice >= ema20) {
            if (pcr >= 1.0 || (ema5 > ema20 * 0.999)) {
                detected = true;
                direction = 'BUY_CE';
                setupName = 'VOLATILITY SQUEEZE COIL (CALL EXPANSION)';
                triggerPrice = parseFloat(bbUpper.toFixed(2));
                
                // ATR dynamic projections
                const step = cleanAsset.includes('crude') ? 35 : (cleanAsset.includes('banknifty') ? 120 : 45);
                targetPrice = parseFloat((currentPrice + step).toFixed(2));
                stopLossPrice = parseFloat((currentPrice - (step * 0.45)).toFixed(2));

                rationale.push(`⚡ Bandwidth compressed to ${bbWidth.toFixed(2)}% (Squeeze in progress)`);
                if (isVolumeBuilding) rationale.push(`📊 Volume acceleration at ${volMultiplier.toFixed(1)}x avg`);
                if (pcr >= 1.1) rationale.push(`🏦 Institutional PCR is Bullish (${pcr})`);
                rationale.push(`🎯 Breakout Trigger: Watch for 5m close above ₹${triggerPrice}`);
            }
        }
        // Scenario B: Bearish Squeeze + Breakdown Coiling + Low PCR
        else if ((isSqueeze || (bbWidth < 1.1 && isVolumeBuilding)) && currentRSI <= 52 && currentRSI >= 35 && currentPrice <= ema20) {
            if (pcr <= 1.0 || (ema5 < ema20 * 1.001)) {
                detected = true;
                direction = 'BUY_PE';
                setupName = 'VOLATILITY SQUEEZE COIL (PUT BREAKDOWN)';
                triggerPrice = parseFloat(bbLower.toFixed(2));
                
                const step = cleanAsset.includes('crude') ? 35 : (cleanAsset.includes('banknifty') ? 120 : 45);
                targetPrice = parseFloat((currentPrice - step).toFixed(2));
                stopLossPrice = parseFloat((currentPrice + (step * 0.45)).toFixed(2));

                rationale.push(`⚡ Bandwidth compressed to ${bbWidth.toFixed(2)}% (Breakdown Coiling)`);
                if (isVolumeBuilding) rationale.push(`📊 Selling Volume acceleration at ${volMultiplier.toFixed(1)}x avg`);
                if (pcr <= 0.85) rationale.push(`🏦 Institutional Call Writing ceiling active (PCR: ${pcr})`);
                rationale.push(`🎯 Breakdown Trigger: Watch for 5m close below ₹${triggerPrice}`);
            }
        }

        if (!detected) return null;

        const confidence = Math.min(95, Math.round(
            (isSqueeze ? 35 : 15) +
            (isVolumeBuilding ? 25 : 10) +
            (pcr >= 1.2 || pcr <= 0.75 ? 25 : 15) +
            (Math.abs(currentRSI - 50) > 5 ? 10 : 5)
        ));

        const preSignalObj = {
            asset: asset.toUpperCase(),
            setupName,
            phase: 'PREPARE',
            direction,
            spotPrice: currentPrice.toFixed(2),
            triggerPrice: triggerPrice.toFixed(2),
            targetPrice: targetPrice.toFixed(2),
            stopLossPrice: stopLossPrice.toFixed(2),
            confidence,
            bbWidth: bbWidth.toFixed(2),
            pcr: pcr.toFixed(2),
            rationale,
            timestamp: Date.now()
        };

        this.activePreSignals.set(cleanAsset, preSignalObj);
        return preSignalObj;
    }

    getActivePreSignal(asset) {
        const item = this.activePreSignals.get(asset.toLowerCase());
        if (!item) return null;
        // Pre-signals expire in 12 minutes if unfulfilled
        if (Date.now() - item.timestamp > 12 * 60 * 1000) {
            this.activePreSignals.delete(asset.toLowerCase());
            return null;
        }
        return item;
    }
}

module.exports = new PreSignalDetector();
