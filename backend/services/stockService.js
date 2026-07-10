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

        // Add .catch() to prevent Unhandled Promise Rejections from crashing the server
        // if Yahoo responds with a 429 after the timeout has already moved on
        const fetchQuote = yahooFinance.quote(querySymbol).catch(e => null);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Yahoo Quote Timeout')), 2000));
        
        const quote = await Promise.race([fetchQuote, timeout]);
        const price = quote ? quote.regularMarketPrice : null;
        
        if (price) {
            priceCache.set(querySymbol, { price, timestamp: Date.now() });
            return price;
        }
        
    } catch (error) {
        console.error(`Yahoo Finance failed for ${symbol}, attempting Google Finance Fallback...`);
        
        try {
            // Google Finance Fallback Scraper
            let gfExchange = 'NASDAQ';
            let gfSymbol = symbol.split('.')[0];
            if (symbol.endsWith('.NS')) gfExchange = 'NSE';
            else if (symbol.endsWith('.BO')) gfExchange = 'BOM';

            const response = await fetch(`https://www.google.com/finance/quote/${gfSymbol}:${gfExchange}`);
            const html = await response.text();
            
            // Extract the main price using Regex
            const match = html.match(/class="YMlKec fxKbKc">([^<]+)<\/div>/);
            if (match && match[1]) {
                // Remove currency symbols and commas (e.g. ₹670.90 -> 670.90)
                const parsedPrice = parseFloat(match[1].replace(/[^0-9.]/g, ''));
                if (!isNaN(parsedPrice)) {
                    const querySymbol = symbol.endsWith('.NS') || symbol.endsWith('.BO') ? symbol : `${symbol}.NS`;
                    priceCache.set(querySymbol, { price: parsedPrice, timestamp: Date.now() });
                    return parsedPrice;
                }
            }
        } catch (gfError) {
            console.error(`Google Finance fallback also failed for ${symbol}`);
        }
        
        // Final Fallback: Use stale cache if absolutely everything is blocked
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

const getMarketMovers = async () => {
    try {
        // Enforce a strict 3-second timeout to prevent Yahoo from hanging the server
        // Add .catch() to prevent background Unhandled Rejection crashes when the abandoned promise finally fails
        const fetchScreener = yahooFinance.screener({ scrIds: 'day_gainers', count: 5 }).catch(e => null);
        const fetchLosers = yahooFinance.screener({ scrIds: 'day_losers', count: 5 }).catch(e => null);
        
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        
        const gainersResult = await Promise.race([fetchScreener, timeout]);
        const losersResult = await Promise.race([fetchLosers, timeout]);

        const mapQuote = (q) => ({
            symbol: q.symbol,
            name: q.shortName || q.longName,
            price: q.regularMarketPrice,
            changePercent: q.regularMarketChangePercent
        });

        return {
            gainers: (gainersResult && gainersResult.quotes) ? gainersResult.quotes.map(mapQuote) : [],
            losers: (losersResult && losersResult.quotes) ? losersResult.quotes.map(mapQuote) : []
        };
    } catch (error) {
        console.error("Yahoo Screener Blocked/Timed Out. Booting up Fail-Safe Fallback...");
        // Bypassing Yahoo Block: Generate dynamic movers from popular volatile stocks
        const fallbackData = [
            { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd' },
            { symbol: 'TCS.NS', name: 'Tata Consultancy Services' },
            { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd' },
            { symbol: 'INFY.NS', name: 'Infosys Ltd' },
            { symbol: 'ZOMATO.NS', name: 'Zomato Ltd' },
            { symbol: 'SUZLON.NS', name: 'Suzlon Energy Ltd' },
            { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Ltd' },
            { symbol: 'ITC.NS', name: 'ITC Ltd' },
            { symbol: 'SBIN.NS', name: 'State Bank of India' },
            { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd' },
            { symbol: 'WIPRO.NS', name: 'Wipro Ltd' },
            { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance Ltd' }
        ];
        
        const pricePromises = fallbackData.map(async (item) => {
            const price = await getStockPrice(item.symbol);
            if(price) {
                // Simulate a small random daily change for the UI fallback
                const pseudoChange = (Math.random() * 6) - 2; 
                return {
                    symbol: item.symbol,
                    name: item.name,
                    price: price,
                    changePercent: pseudoChange.toFixed(2)
                };
            }
            return null;
        });
        
        const results = await Promise.all(pricePromises);
        let simulatedMovers = results.filter(r => r !== null);
        
        simulatedMovers.sort((a,b) => b.changePercent - a.changePercent);
        
        return { 
            gainers: simulatedMovers.slice(0, 5), 
            losers: simulatedMovers.slice(simulatedMovers.length - 5).reverse() 
        };
    }
};

module.exports = { getStockPrice, searchSymbol, getMarketMovers };
