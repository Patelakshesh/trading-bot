const { runBacktest } = require('../services/technicalService');

const symbols = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 
    'ICICIBANK.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS'
];

async function generateReport() {
    console.log("Running 3-Month (90 Days) AI Backtest Analysis...");
    console.log("--------------------------------------------------");
    
    let totalTrades = 0;
    let winningTrades = 0;
    let totalProfitPercent = 0;
    
    console.log(`| Symbol       | Trades | Win Rate | Profit % |`);
    console.log(`|--------------|--------|----------|----------|`);
    
    for (const sym of symbols) {
        const result = await runBacktest(sym, 90);
        if (result && !result.error) {
            let symbolWins = 0;
            let lastBuyPrice = null;
            
            for (const t of result.trades) {
                if (t.type === 'BUY') lastBuyPrice = t.price;
                if (t.type === 'SELL' && lastBuyPrice) {
                    if (t.price > lastBuyPrice) {
                        symbolWins++;
                        winningTrades++;
                    }
                }
            }
            
            const totalSellTrades = result.trades.filter(t => t.type === 'SELL').length;
            const winRate = totalSellTrades > 0 ? ((symbolWins / totalSellTrades) * 100).toFixed(1) : 0;
            const profit = parseFloat(result.profitPercent);
            
            totalTrades += totalSellTrades;
            totalProfitPercent += profit;
            
            console.log(`| ${sym.padEnd(12)} | ${totalSellTrades.toString().padEnd(6)} | ${winRate.toString().padStart(6)}% | ${profit.toFixed(2).padStart(7)}% |`);
        }
    }
    
    const overallWinRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : 0;
    const avgProfit = (totalProfitPercent / symbols.length).toFixed(2);
    
    console.log(`|--------------|--------|----------|----------|`);
    console.log(`| OVERALL AVG  | ${totalTrades.toString().padEnd(6)} | ${overallWinRate.toString().padStart(6)}% | ${avgProfit.padStart(7)}% |`);
    console.log("--------------------------------------------------");
}

generateReport();
