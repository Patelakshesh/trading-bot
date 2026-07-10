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

const searchSymbol = async (query) => {
    try {
        // Automatically append .NS if they just typed a raw symbol to speed up search
        const searchQuery = query.includes('.') ? query : `${query} India`;
        
        const results = await yahooFinance.search(searchQuery);
        if (results.quotes && results.quotes.length > 0) {
            // Prioritize Indian stock exchanges (.NS or .BO)
            const indianStock = results.quotes.find(q => q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO'));
            if (indianStock) return indianStock.symbol;
            
            // Fallback to the top result if it's not an Indian stock (e.g. AAPL)
            return results.quotes[0].symbol;
        }
        
        // If search completely fails, fallback to formatting it manually
        let sym = query.trim().toUpperCase().replace(/\s+/g, '');
        if (!sym.endsWith('.NS') && !sym.endsWith('.BO')) sym += '.NS';
        return sym;
    } catch (error) {
        console.error(`Search failed for ${query}:`, error);
        // Fallback manually
        let sym = query.trim().toUpperCase().replace(/\s+/g, '');
        if (!sym.endsWith('.NS') && !sym.endsWith('.BO')) sym += '.NS';
        return sym;
    }
};

module.exports = { getStockPrice, searchSymbol };
