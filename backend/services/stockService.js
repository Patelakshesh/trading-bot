const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const getStockPrice = async (symbol) => {
    try {
        // Appending .NS for Indian stocks (NSE) by default for this example.
        // You can remove it or handle it dynamically if you trade US stocks.
        const querySymbol = symbol.endsWith('.NS') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`;
        
        const quote = await yahooFinance.quote(querySymbol);
        return quote ? quote.regularMarketPrice : null;
    } catch (error) {
        console.error(`Error fetching price for ${symbol}:`, error);
        return null;
    }
};

module.exports = { getStockPrice };
