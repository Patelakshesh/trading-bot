const { ADX } = require('technicalindicators');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

async function simulateAutoAlerts() {
    console.log("==================================================");
    console.log("📊 AUTO-ALERT SIMULATION: YESTERDAY's TRADES");
    console.log("==================================================");
    console.log("Simulating the fixed bot logic on yesterday's exact market data...");

    try {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(12, 0, 0, 0); // Start from 12:00 PM yesterday
        
        const period1 = Math.floor(yesterday.getTime() / 1000);
        
        const result = await yahooFinance.chart('CL=F', { interval: '5m', period1: period1 });
        const rawQuotes = result.quotes.filter(q => q.close !== null);
        
        const quotes = rawQuotes.map(q => {
            const d = new Date(q.date);
            return {
                timeStr: d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit' }),
                hour: d.getHours(),
                minute: d.getMinutes(),
                timestamp: d.getTime(),
                open: q.open,
                high: q.high,
                low: q.low,
                close: q.close
            };
        });

        if (!quotes || quotes.length < 50) {
            console.log("Not enough data to simulate.");
            return;
        }

        const sentAlertsMemory = new Set();
        let totalAlerts = 0;

        console.log("\n--- TIMELINE OF ALERTS ---");
        
        for (let i = 30; i < quotes.length; i++) {
            const currentSlice = quotes.slice(0, i + 1);
            const closes = currentSlice.map(q => q.close);
            
            // EMAs
            const ema5 = calcEMA(closes, 5).current;
            const ema20 = calcEMA(closes, 20).current;
            
            // Candle Gain
            const lastCandle = currentSlice[currentSlice.length - 1];
            const candleGain = lastCandle.close - lastCandle.open;
            
            // ADX
            const adxResult = ADX.calculate({
                high: currentSlice.map(q => q.high),
                low: currentSlice.map(q => q.low),
                close: currentSlice.map(q => q.close),
                period: 14
            });
            const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;

            // Signal Logic
            let tradeType = "NO_TRADE";
            if (ema5 < ema20 && candleGain < 0 && currentADX > 22) {
                tradeType = "PUT";
            } else if (ema5 > ema20 && candleGain > 0 && currentADX > 22) {
                tradeType = "CALL";
            }

            if (tradeType !== "NO_TRADE") {
                const currentMinuteBlock = Math.floor(lastCandle.minute / 15);
                const fnoAlertKey = `FNO_ALERT_crude_${tradeType}_${lastCandle.hour}_${currentMinuteBlock}`;
                
                if (!sentAlertsMemory.has(fnoAlertKey)) {
                    sentAlertsMemory.add(fnoAlertKey);
                    totalAlerts++;
                    console.log(`🔔 [${lastCandle.timeStr}] AUTO-ALERT: BUY ${tradeType} | Spot: $${lastCandle.close.toFixed(2)} | ADX: ${currentADX.toFixed(1)}`);
                }
            }
        }

        console.log("\n==================================================");
        console.log(`✅ TOTAL ALERTS SENT IN YESTERDAY'S SESSION: ${totalAlerts}`);
        console.log("==================================================");

    } catch (err) {
        console.error("Failed to fetch historical data for simulation.", err.message);
    }
    process.exit(0);
}

function calcEMA(closes, period) {
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

simulateAutoAlerts();
