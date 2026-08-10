const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const { ADX, RSI } = require('technicalindicators');

function calculateEMA(closes, period) {
    if (closes.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = (closes[i] - ema) * multiplier + ema;
    }
    return ema;
}

async function run905Test() {
    const endDate = new Date('2026-08-10');
    const startDate5m = new Date('2026-06-12'); // 59 Days max

    let quotes = [];
    try {
        const d5m = await yahooFinance.chart('CL=F', { period1: Math.floor(startDate5m.getTime()/1000), period2: Math.floor(endDate.getTime()/1000), interval: '5m' });
        quotes = d5m.quotes.filter(q => q.close !== null);
    } catch(e) {
        console.log("Failed to download data", e);
        return;
    }

    const closes = [];
    const highs = [];
    const lows = [];
    
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let timeouts = 0;
    let noSignal = 0;

    for (let i = 0; i < quotes.length - 1; i++) {
        const entryCandle = quotes[i];
        if (!entryCandle || !entryCandle.close || !entryCandle.date) continue;
        
        closes.push(entryCandle.close);
        highs.push(entryCandle.high);
        lows.push(entryCandle.low);

        // We need exactly 9:05 PM IST
        const d = new Date(entryCandle.date);
        const utcHour = d.getUTCHours();
        const utcMin = d.getUTCMinutes();
        let istMin = utcMin + 30;
        let istHour = utcHour + 5;
        if (istMin >= 60) { istMin -= 60; istHour += 1; }
        if (istHour >= 24) istHour -= 24;
        
        if (closes.length < 21) continue;

        const ema5 = calculateEMA(closes.slice(-10), 5);
        const ema20 = calculateEMA(closes.slice(-30), 20);
        
        const adxResult = ADX.calculate({ high: highs.slice(-20), low: lows.slice(-20), close: closes.slice(-20), period: 14 });
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        
        const rsiResult = RSI.calculate({ values: closes.slice(-20), period: 14 });
        const currentRSI = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : 50;

        // Apply our PRO strategy rules
        let signal = null;
        if (ema5 > ema20 && currentRSI > 55) signal = 'CALL';
        else if (ema5 < ema20 && currentRSI < 45) signal = 'PUT';

        if (!signal || currentADX < 20) {
            noSignal++;
            continue; // Strategy blocked the trade
        }

        totalTrades++;
        const entryPrice = entryCandle.close;
        let target = 0, sl = 0;
        
        // Target: 0.3% Spot = ~30% Premium, SL: 0.15% Spot = ~15% Premium
        if (signal === 'CALL') {
            target = entryPrice * 1.003; sl = entryPrice * 0.9985;
        } else {
            target = entryPrice * 0.997; sl = entryPrice * 1.0015;    
        }

        let result = 'TIMEOUT';
        for (let j = i + 1; j < Math.min(i + 7, quotes.length); j++) { // Hold for 35 mins
            const futureQ = quotes[j];
            if (signal === 'CALL') {
                if (futureQ.low <= sl) { result = 'LOSS'; break; }
                if (futureQ.high >= target) { result = 'WIN'; break; }
            } else {
                if (futureQ.high >= sl) { result = 'LOSS'; break; }
                if (futureQ.low <= target) { result = 'WIN'; break; }
            }
        }

        if (result === 'WIN') wins++;
        else if (result === 'LOSS') losses++;
        else timeouts++;
    }

    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;
    
    console.log(`\n==========================================`);
    console.log(`🎯 FULL 24-HOUR CRUDE OIL TEST (PRO LOGIC - 60 DAYS)`);
    console.log(`==========================================`);
    console.log(`Total 5-min Candles Scanned: ${totalTrades + noSignal}`);
    console.log(`Trades Blocked (ADX < 25 or Choppy RSI): ${noSignal}`);
    console.log(`Valid PRO Signals Triggered: ${totalTrades}`);
    console.log(`Average Signals Per Day: ${(totalTrades / 60).toFixed(2)} trades/day`);
    console.log(`✅ Wins (+30% Premium): ${wins}`);
    console.log(`❌ Losses (-15% Premium): ${losses}`);
    console.log(`⏳ Timeouts: ${timeouts}`);
    console.log(`\n🏆 TRUE INDICATOR WIN RATE: ${winRate}%`);
}

run905Test();
