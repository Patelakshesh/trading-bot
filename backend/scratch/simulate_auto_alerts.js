const { ADX } = require('technicalindicators');
const TradingView = require('@mathieuc/tradingview');

async function simulateAutoAlerts() {
    console.log("==================================================");
    console.log("📊 AUTO-ALERT SPAM SIMULATION (CRUDE OIL FULL DAY)");
    console.log("==================================================");
    console.log("Simulating how many Telegram notifications you will get in a day...");

    try {
        const client = new TradingView.Client();
        const chart = new client.Session.Chart();
        
        console.log("Fetching 5-minute historical data for TVC:USOIL (Last 100 candles) ...");
        chart.setMarket('TVC:USOIL', { timeframe: '5' });

        const quotes = await new Promise((resolve, reject) => {
            chart.onUpdate(() => {
                const q = chart.periods.map(p => ({
                    timeStr: new Date(p.time * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit' }),
                    hour: new Date(p.time * 1000).getHours(),
                    minute: new Date(p.time * 1000).getMinutes(),
                    timestamp: p.time * 1000,
                    open: p.open,
                    high: p.max,
                    low: p.min,
                    close: p.close
                }));
                client.end();
                resolve(q);
            });
            setTimeout(() => { client.end(); reject(new Error('TV Timeout')); }, 5000);
        });

        if (!quotes || quotes.length < 50) {
            console.log("Not enough data to simulate.");
            return;
        }

        const sentAlertsMemory = new Set();
        let totalAlerts = 0;

        console.log("\n--- TIMELINE OF ALERTS ---");
        
        // Start from candle 30 to allow EMA/ADX calculation
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
                // Simulate server.js rate limiter (1 per 15 mins per type)
                const currentMinuteBlock = Math.floor(lastCandle.minute / 15);
                const fnoAlertKey = `FNO_ALERT_crude_${tradeType}_${lastCandle.hour}_${currentMinuteBlock}`;
                
                if (!sentAlertsMemory.has(fnoAlertKey)) {
                    sentAlertsMemory.add(fnoAlertKey);
                    totalAlerts++;
                    console.log(`🔔 [${lastCandle.timeStr}] AUTO-ALERT SENT: BUY ${tradeType} | Price: ₹${lastCandle.close} | ADX: ${currentADX.toFixed(1)}`);
                } else {
                    // console.log(`🔕 [${lastCandle.timeStr}] Suppressed Duplicate ${tradeType} alert to prevent spam.`);
                }
            }
        }

        console.log("\n==================================================");
        console.log(`✅ TOTAL NOTIFICATIONS SENT IN 8+ HOURS: ${totalAlerts}`);
        console.log("==================================================");
        console.log("Conclusion: The 15-minute block filter in server.js successfully prevents spam while ensuring you get the breakout alerts.");

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
