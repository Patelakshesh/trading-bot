// Removed calculateEMA import
const { ADX, RSI } = require('technicalindicators');
const axios = require('axios');

async function verifyTradeLogic() {
    console.log("==================================================");
    console.log("🕵️‍♂️ TRADE FORENSICS: 6:04 PM to 6:20 PM ANALYSIS");
    console.log("==================================================");
    console.log("Analyzing the mathematical conditions that led to the PUT signal...");

    try {
        // Since AngleOne needs API keys, we will use TradingView public data for MCX Crude Oil
        const TradingView = require('@mathieuc/tradingview');
        const client = new TradingView.Client();
        const chart = new client.Session.Chart();
        
        console.log("Fetching 5-minute historical data for TVC:USOIL ...");
        chart.setMarket('TVC:USOIL', { timeframe: '5' });

        const quotes = await new Promise((resolve, reject) => {
            chart.onUpdate(() => {
                const q = chart.periods.map(p => ({
                    time: new Date(p.time * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
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

        if (!quotes || quotes.length < 25) {
            console.log("Not enough data to calculate indicators.");
            return;
        }

        // We will scan the last 10 candles (which covers 6:00 PM to 6:50 PM approx)
        console.log("\n--- TIMELINE OF SIGNALS ---");
        
        for (let i = quotes.length - 10; i < quotes.length; i++) {
            const currentSlice = quotes.slice(0, i + 1);
            const closes = currentSlice.map(q => q.close);
            
            // Calculate EMAs
            const ema5 = calcEMA(closes, 5).current;
            const ema20 = calcEMA(closes, 20).current;
            
            // Calculate Candle Gain
            const lastCandle = currentSlice[currentSlice.length - 1];
            const candleGain = lastCandle.close - lastCandle.open;
            const candleType = candleGain < 0 ? '🔴 RED' : '🟢 GREEN';
            
            // Calculate ADX
            const adxResult = ADX.calculate({
                high: currentSlice.map(q => q.high),
                low: currentSlice.map(q => q.low),
                close: currentSlice.map(q => q.close),
                period: 14
            });
            const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;

            // Calculate Signal Logic
            let signal = "NO_TRADE";
            if (ema5 < ema20 && candleGain < 0 && currentADX > 22) {
                signal = "PUT SIGNAL FIRED";
            } else if (ema5 > ema20 && candleGain > 0 && currentADX > 22) {
                signal = "CALL SIGNAL FIRED";
            }

            console.log(`\n🕒 Time: ${lastCandle.time}`);
            console.log(`Price: ₹${lastCandle.close} | Candle: ${candleType} | 5-EMA: ${ema5.toFixed(2)} | 20-EMA: ${ema20.toFixed(2)}`);
            console.log(`ADX Momentum: ${currentADX.toFixed(1)}`);
            console.log(`Verdict: ${signal}`);
        }

    } catch (err) {
        console.error("Failed to fetch historical data for forensics.", err.message);
    }
    process.exit(0);
}

// Inline EMA function if not exported
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

verifyTradeLogic();
