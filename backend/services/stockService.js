const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// In-memory cache to prevent Yahoo Finance rate-limiting (HTTP 429)
const priceCache = new Map();
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes — prevents Yahoo Finance 429 rate-limit block

const getStockPrice = async (symbol) => {
    if (!symbol) return null;
    const querySymbol = symbol; // Trust the symbol exactly as passed
    
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
        console.warn(`[Yahoo] Failed for ${symbol}: ${yhError.message}. Trying Groww...`);
    }

    // --- FALLBACK 1: Groww API (Highly reliable for NSE stocks) ---
    try {
        const cleanSymbol = symbol.split('.')[0];
        const growwUrl = `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${cleanSymbol}/latest`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(growwUrl, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (response.ok) {
            const data = await response.json();
            const price = data.ltp || data.close;
            if (price && price > 0) {
                priceCache.set(querySymbol, { price, timestamp: Date.now() });
                console.log(`[Groww] ${symbol} = ₹${price}`);
                return price;
            }
        }
    } catch (growwError) {
        console.warn(`[Groww] Failed for ${symbol}: ${growwError.message}. Trying Google...`);
    }

    // --- FALLBACK 2: Google Finance HTML ---
    try {
        let gfExchange = 'NSE';
        if (symbol.endsWith('.BO')) gfExchange = 'BOM';
        else if (!symbol.endsWith('.NS') && !symbol.endsWith('.BO')) gfExchange = 'NASDAQ';
        
        const gfSymbol = symbol.split('.')[0];
        const controller = new AbortController();
        const gfTimeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`https://www.google.com/search?q=${gfSymbol}+share+price`, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: controller.signal 
        });
        clearTimeout(gfTimeout);
        const html = await response.text();
        
        // Match Google Search price classes
        const match = html.match(/IsqQVc NprOob w8qArf[^>]*>([0-9,]+(?:\.[0-9]+)?)/) || html.match(/BNeawe iBp4i AP7Wnd[^>]*>([0-9,]+(?:\.[0-9]+)?)/);
        if (match && match[1]) {
            const parsedPrice = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(parsedPrice) && parsedPrice > 0) {
                priceCache.set(querySymbol, { price: parsedPrice, timestamp: Date.now() });
                console.log(`[GoogleSearch] ${symbol} = ₹${parsedPrice}`);
                return parsedPrice;
            }
        }
    } catch (gfError) {
        console.warn(`[GoogleSearch] Failed for ${symbol}: ${gfError.message}`);
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
        const fetchScreener = yahooFinance.screener({ scrIds: 'day_gainers', count: 10, region: 'IN' }).catch(e => null);
        const fetchLosers = yahooFinance.screener({ scrIds: 'day_losers', count: 10, region: 'IN' }).catch(e => null);
        
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        
        const gainersResult = await Promise.race([fetchScreener, timeout]);
        const losersResult = await Promise.race([fetchLosers, timeout]);
        
        if (!gainersResult || !losersResult || !gainersResult.quotes[0]?.symbol.endsWith('.NS')) {
            throw new Error("Yahoo Rate Limited or Non-IN Stocks - Booting Fallback");
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
        // Bypassing Yahoo Block: Massive pool of 100 High-Beta/Volatile Indian stocks (Strategy B)
        const fallbackData = [
            { symbol: 'RELIANCE.NS', name: 'Reliance Industries' }, { symbol: 'TCS.NS', name: 'TCS' }, 
            { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' }, { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' }, 
            { symbol: 'INFY.NS', name: 'Infosys' }, { symbol: 'ITC.NS', name: 'ITC' }, 
            { symbol: 'SBIN.NS', name: 'SBI' }, { symbol: 'LT.NS', name: 'Larsen & Toubro' }, 
            { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance' }, { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel' }, 
            { symbol: 'KOTAKBANK.NS', name: 'Kotak Bank' }, { symbol: 'AXISBANK.NS', name: 'Axis Bank' }, 
            { symbol: 'ASIANPAINT.NS', name: 'Asian Paints' }, { symbol: 'HCLTECH.NS', name: 'HCL Tech' }, 
            { symbol: 'MARUTI.NS', name: 'Maruti Suzuki' }, { symbol: 'SUNPHARMA.NS', name: 'Sun Pharma' }, 
            { symbol: 'TITAN.NS', name: 'Titan' }, { symbol: 'WIPRO.NS', name: 'Wipro' }, 
            { symbol: 'ULTRACEMCO.NS', name: 'UltraTech Cement' }, { symbol: 'ONGC.NS', name: 'ONGC' }, 
            { symbol: 'NTPC.NS', name: 'NTPC' }, { symbol: 'POWERGRID.NS', name: 'Power Grid' }, 
            { symbol: 'TATASTEEL.NS', name: 'Tata Steel' }, { symbol: 'M&M.NS', name: 'M&M' }, 
            { symbol: 'TATAMOTORS.NS', name: 'Tata Motors' }, { symbol: 'COALINDIA.NS', name: 'Coal India' }, 
            { symbol: 'HINDALCO.NS', name: 'Hindalco' }, { symbol: 'TECHM.NS', name: 'Tech Mahindra' }, 
            { symbol: 'BAJAJFINSV.NS', name: 'Bajaj Finserv' }, { symbol: 'GRASIM.NS', name: 'Grasim' }, 
            { symbol: 'ADANIENT.NS', name: 'Adani Ent' }, { symbol: 'ADANIPORTS.NS', name: 'Adani Ports' }, 
            { symbol: 'APOLLOHOSP.NS', name: 'Apollo Hospitals' }, { symbol: 'BRITANNIA.NS', name: 'Britannia' }, 
            { symbol: 'CIPLA.NS', name: 'Cipla' }, { symbol: 'DIVISLAB.NS', name: 'Divis Labs' }, 
            { symbol: 'DRREDDY.NS', name: 'Dr Reddys' }, { symbol: 'EICHERMOT.NS', name: 'Eicher Motors' }, 
            { symbol: 'HEROMOTOCO.NS', name: 'Hero MotoCorp' }, { symbol: 'HINDUNILVR.NS', name: 'HUL' }, 
            { symbol: 'INDUSINDBK.NS', name: 'IndusInd Bank' }, { symbol: 'JSWSTEEL.NS', name: 'JSW Steel' }, 
            { symbol: 'NESTLEIND.NS', name: 'Nestle India' }, { symbol: 'SBILIFE.NS', name: 'SBI Life' }, 
            { symbol: 'TATACONSUM.NS', name: 'Tata Consumer' }, { symbol: 'UPL.NS', name: 'UPL' }, 
            { symbol: 'BPCL.NS', name: 'BPCL' }, { symbol: 'SHREECEM.NS', name: 'Shree Cement' }, 
            { symbol: 'SUZLON.NS', name: 'Suzlon Energy' }, { symbol: 'IRFC.NS', name: 'IRFC' }, 
            { symbol: 'RVNL.NS', name: 'RVNL' }, { symbol: 'IREDA.NS', name: 'IREDA' }, 
            { symbol: 'NHPC.NS', name: 'NHPC' }, { symbol: 'YESBANK.NS', name: 'Yes Bank' }, 
            { symbol: 'JIOFIN.NS', name: 'Jio Financial' }, { symbol: 'IDEA.NS', name: 'Vodafone Idea' }, 
            { symbol: 'GMRINFRA.NS', name: 'GMR Infra' }, { symbol: 'PNB.NS', name: 'PNB' }, 
            { symbol: 'BHEL.NS', name: 'BHEL' }, { symbol: 'MAZDOCK.NS', name: 'Mazagon Dock' }, 
            { symbol: 'HAL.NS', name: 'HAL' }, { symbol: 'BEL.NS', name: 'BEL' }, 
            { symbol: 'RECLTD.NS', name: 'REC' }, { symbol: 'PFC.NS', name: 'PFC' }, 
            { symbol: 'HUDCO.NS', name: 'HUDCO' }, { symbol: 'NBCC.NS', name: 'NBCC' }, 
            { symbol: 'SJVN.NS', name: 'SJVN' }, { symbol: 'ZOMATO.NS', name: 'Zomato' }, 
            { symbol: 'OLECTRA.NS', name: 'Olectra' }, { symbol: 'ADANIPOWER.NS', name: 'Adani Power' }, 
            { symbol: 'TATAPOWER.NS', name: 'Tata Power' }, { symbol: 'VBL.NS', name: 'Varun Beverages' }, 
            { symbol: 'DIXON.NS', name: 'Dixon' }, { symbol: 'CDSL.NS', name: 'CDSL' }, 
            { symbol: 'BSE.NS', name: 'BSE' }, { symbol: 'ANGELONE.NS', name: 'Angel One' }, 
            { symbol: 'KPITTECH.NS', name: 'KPIT Tech' }, { symbol: 'TATAELXSI.NS', name: 'Tata Elxsi' }, 
            { symbol: 'PERSISTENT.NS', name: 'Persistent' }, { symbol: 'COFORGE.NS', name: 'Coforge' }, 
            { symbol: 'LTTS.NS', name: 'LTTS' }, { symbol: 'LTIM.NS', name: 'LTIMindtree' }, 
            { symbol: 'SONACOMS.NS', name: 'Sona Comstar' }, { symbol: 'MOTHERSON.NS', name: 'Motherson' }, 
            { symbol: 'CAMS.NS', name: 'CAMS' }, { symbol: 'AUBANK.NS', name: 'AU Small Fin' }, 
            { symbol: 'FEDERALBNK.NS', name: 'Federal Bank' }, { symbol: 'IDFCFIRSTB.NS', name: 'IDFC First' }, 
            { symbol: 'CHOLAFIN.NS', name: 'Chola Fin' }, { symbol: 'M&MFIN.NS', name: 'M&M Fin' }, 
            { symbol: 'MANAPPURAM.NS', name: 'Manappuram' }, { symbol: 'MUTHOOTFIN.NS', name: 'Muthoot Fin' }, 
            { symbol: 'TVSMOTOR.NS', name: 'TVS Motor' }, { symbol: 'ASHOKLEY.NS', name: 'Ashok Leyland' }, 
            { symbol: 'ESCORTS.NS', name: 'Escorts' }, { symbol: 'AMBUJACEM.NS', name: 'Ambuja Cement' }, 
            { symbol: 'ACC.NS', name: 'ACC' }, { symbol: 'JINDALSTEL.NS', name: 'Jindal Steel' }, 
            { symbol: 'NMDC.NS', name: 'NMDC' }
        ];

        // Randomly shuffle the massive array
        for (let i = fallbackData.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [fallbackData[i], fallbackData[j]] = [fallbackData[j], fallbackData[i]];
        }

        // Take 40 random stocks to process so the AI always gets a fresh, unique menu
        const randomMenu = fallbackData.slice(0, 40);
        
        const pricePromises = randomMenu.map(async (item) => {
            try {
                // Fetch REAL quote data to get accurate price AND change percent
                const quote = await yahooFinance.quote(item.symbol);
                if (quote && quote.regularMarketPrice) {
                    return {
                        symbol: item.symbol,
                        name: item.name,
                        price: quote.regularMarketPrice,
                        changePercent: quote.regularMarketChangePercent || 0
                    };
                }
            } catch(e) {
                // If quote fails entirely, fall back to just price with 0 change
                const price = await getStockPrice(item.symbol);
                if (price) return { symbol: item.symbol, name: item.name, price, changePercent: 0 };
            }
            return null;
        });
        
        const results = await Promise.all(pricePromises);
        let simulatedMovers = results.filter(r => r !== null);
        
        simulatedMovers.sort((a,b) => b.changePercent - a.changePercent);
        
        return { 
            gainers: simulatedMovers.slice(0, 15), 
            losers: simulatedMovers.slice(simulatedMovers.length - 15).reverse() 
        };
    }
};

module.exports = { getStockPrice, searchSymbol, getMarketMovers };
