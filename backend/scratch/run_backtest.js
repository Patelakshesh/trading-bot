const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const { EMA, RSI, ADX, BollingerBands } = require('technicalindicators');

async function runBacktest() {
    try {
        const p1 = Math.floor(Date.now() / 1000) - (59 * 24 * 60 * 60); // 59 days back
        const result = await yahooFinance.chart('CL=F', { period1: p1, interval: '5m' });
        const quotes = result.quotes.filter(q => q.close !== null && q.volume !== null);
        
        const closes = quotes.map(q => q.close);
        const highs = quotes.map(q => q.high);
        const lows = quotes.map(q => q.low);
        
        const ema5Arr = EMA.calculate({ period: 5, values: closes });
        const ema20Arr = EMA.calculate({ period: 20, values: closes });
        
        let wins = 0;
        let losses = 0;
        let totalProfitPoints = 0;
        
        let inTrade = false;
        let entryPrice = 0;
        let tradeType = "";
        
        for (let i = 50; i < quotes.length - 1; i++) {
            const currentQ = quotes[i];
            
            if (inTrade) {
                if (tradeType === 'BUY') {
                    if (currentQ.high >= entryPrice + 0.50) { wins++; totalProfitPoints += 50; inTrade = false; }
                    else if (currentQ.low <= entryPrice - 0.25) { losses++; totalProfitPoints -= 25; inTrade = false; }
                } else if (tradeType === 'SELL') {
                    if (currentQ.low <= entryPrice - 0.50) { wins++; totalProfitPoints += 50; inTrade = false; }
                    else if (currentQ.high >= entryPrice + 0.25) { losses++; totalProfitPoints -= 25; inTrade = false; }
                }
                
                const date = new Date(currentQ.date);
                if (date.getUTCHours() >= 23 && date.getUTCMinutes() >= 30) { inTrade = false; }
                continue;
            }

            const ema5Idx = i - 4;
            const ema20Idx = i - 19;
            const currentPrice = currentQ.close;
            const ema5 = ema5Arr[ema5Idx];
            const ema20 = ema20Arr[ema20Idx];
            const candleGain = (currentQ.close - currentQ.open) / currentQ.open;
            
            // STRICTLY US VOLUME BREAKOUTS ONLY
            const recentVols = quotes.slice(i - 20, i).map(q => q.volume || 0);
            const avgVolume = recentVols.reduce((a, b) => a + b, 0) / recentVols.length || 1;
            const volumeMultiplier = (currentQ.volume || 0) / avgVolume;
            
            const date = new Date(currentQ.date);
            const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
            const hoursIST = istDate.getUTCHours();
            const isUSSession = hoursIST >= 19 && hoursIST <= 23;
            
            const isUSVolumeBreakout = isUSSession && volumeMultiplier >= 2.5 && currentQ.volume > 3000;
            
            const usVolumeCall = isUSVolumeBreakout && ema5 > ema20 && candleGain > 0;
            const usVolumePut = isUSVolumeBreakout && ema5 < ema20 && candleGain < 0;
            
            if (usVolumeCall) {
                inTrade = true;
                entryPrice = currentPrice;
                tradeType = 'BUY';
            } else if (usVolumePut) {
                inTrade = true;
                entryPrice = currentPrice;
                tradeType = 'SELL';
            }
        }
        
        console.log(`\n=== STRICT US-VOLUME BREAKOUT BACKTEST (60 DAYS) ===`);
        console.log(`Total Wins: ${wins}`);
        console.log(`Total Losses: ${losses}`);
        console.log(`Total Trades: ${wins + losses}`);
        console.log(`Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
        console.log(`Total Points Captured: ${totalProfitPoints}`);
        console.log(`Gross Profit (1 Lot @ ₹10/pt): ₹${totalProfitPoints * 10}`);
        
    } catch(e) {
        console.error(e);
    }
}

runBacktest();
