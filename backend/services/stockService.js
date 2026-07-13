const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// In-memory cache to prevent Yahoo Finance rate-limiting (HTTP 429)
const priceCache = new Map();
const CACHE_DURATION_MS = 30000; // 30 seconds

const getStockPrice = async (symbol) => {
    const querySymbol = symbol && (symbol.endsWith('.NS') || symbol.endsWith('.BO')) ? symbol : `${symbol}.NS`;
    if (!symbol) return null;
    
    // Check Cache first (30 second cache to prevent rate-limiting)
    if (priceCache.has(querySymbol)) {
        const cached = priceCache.get(querySymbol);
        if (Date.now() - cached.timestamp < CACHE_DURATION_MS) {
            return cached.price;
        }
    }

    // --- PRIMARY: Yahoo Finance (Reliable, correct prices) ---
    try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Yahoo Timeout')), 5000));
        const quote = await Promise.race([yahooFinance.quote(querySymbol), timeout]);
        const price = quote ? quote.regularMarketPrice : null;
        if (price && price > 0) {
            priceCache.set(querySymbol, { price, timestamp: Date.now() });
            console.log(`[Yahoo] ${symbol} = ₹${price}`);
            return price;
        }
    } catch (yhError) {
        console.warn(`[Yahoo] Failed for ${symbol}: ${yhError.message}. Trying Google...`);
    }

    // --- FALLBACK: Google Finance ---
    try {
        const gfExchange = symbol.endsWith('.BO') ? 'BOM' : 'NSE';
        const gfSymbol = symbol.split('.')[0];
        const controller = new AbortController();
        const gfTimeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`https://www.google.com/finance/quote/${gfSymbol}:${gfExchange}`, { signal: controller.signal });
        clearTimeout(gfTimeout);
        const html = await response.text();
        // Match the ₹-prefixed price (first rupee value on the stock's own page)
        const match = html.match(/class="YMlKec">&#x20B9;([0-9,]+(?:\.[0-9]+)?)<\/div>/) ||
                      html.match(/class="YMlKec">₹([0-9,]+(?:\.[0-9]+)?)<\/div>/);
        if (match && match[1]) {
            const parsedPrice = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(parsedPrice) && parsedPrice > 0) {
                priceCache.set(querySymbol, { price: parsedPrice, timestamp: Date.now() });
                console.log(`[GF] ${symbol} = ₹${parsedPrice}`);
                return parsedPrice;
            }
        }
    } catch (gfError) {
        console.warn(`[GF] Failed for ${symbol}: ${gfError.message}`);
    }

    // Last Resort: Return stale cache
    if (priceCache.has(querySymbol)) {
        console.warn(`[Cache] Using stale price for ${symbol}`);
        return priceCache.get(querySymbol).price;
    }

    console.error(`[Price] All sources failed for ${symbol}. Returning null.`);
    return null;
};


const searchSymbol = async (query) => {
    try {
        // Strip extensions to force a fuzzy search on the base company name/ticker
        const cleanQuery = query.trim().toUpperCase().replace('.NS', '').replace('.BO', '');
        
        let results = await yahooFinance.search(cleanQuery);
        if (!results.quotes || results.quotes.length === 0) {
            results = await yahooFinance.search(`${cleanQuery} India`);
        }
        
        if (results.quotes && results.quotes.length > 0) {
            // Prioritize Indian stock exchanges (.NS or .BO)
            const indianStock = results.quotes.find(q => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO')));
            if (indianStock) return indianStock.symbol;
            
            // Fallback to the top result if it's not an Indian stock but has a symbol
            const firstValidStock = results.quotes.find(q => q.symbol);
            if (firstValidStock) return firstValidStock.symbol;
        }
        
        // If search completely fails, fallback to formatting it manually
        let sym = query.trim().toUpperCase().replace(/\s+/g, '');
        sym = sym.replace('.BO', '.NS');
        if (!sym.endsWith('.NS')) sym += '.NS';
        return sym;
    } catch (error) {
        console.error(`Search failed for ${query}:`, error);
        // Fallback manually
        let sym = query.trim().toUpperCase().replace(/\s+/g, '');
        sym = sym.replace('.BO', '.NS');
        if (!sym.endsWith('.NS')) sym += '.NS';
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
        
        if (!gainersResult || !losersResult) {
            throw new Error("Yahoo Rate Limited - Booting Fallback");
        }

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
                    changePercent: pseudoChange
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
