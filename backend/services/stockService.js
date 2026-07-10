const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// In-memory cache to prevent Yahoo Finance rate-limiting (HTTP 429)
const priceCache = new Map();
const CACHE_DURATION_MS = 30000; // 30 seconds

const getStockPrice = async (symbol) => {
    try {
        const querySymbol = symbol.endsWith('.NS') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`;
        
        // Check Cache first
        if (priceCache.has(querySymbol)) {
            const cached = priceCache.get(querySymbol);
            if (Date.now() - cached.timestamp < CACHE_DURATION_MS) {
                return cached.price;
            }
        }

        const quote = await yahooFinance.quote(querySymbol);
        const price = quote ? quote.regularMarketPrice : null;
        
        if (price) {
            priceCache.set(querySymbol, { price, timestamp: Date.now() });
        }
        
        return price;
    } catch (error) {
        console.error(`Error fetching price for ${symbol}:`, error.message);
        
        // Fallback to stale cache if available when rate-limited
        const querySymbol = symbol.endsWith('.NS') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`;
        if (priceCache.has(querySymbol)) {
            return priceCache.get(querySymbol).price;
        }
        
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
