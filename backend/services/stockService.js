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
            { symbol: 'RELIANCE.NS', name: 'RELIANCE' },             { symbol: 'TCS.NS', name: 'TCS' },             { symbol: 'HDFCBANK.NS', name: 'HDFCBANK' },
            { symbol: 'ICICIBANK.NS', name: 'ICICIBANK' },             { symbol: 'INFY.NS', name: 'INFY' },             { symbol: 'ITC.NS', name: 'ITC' },
            { symbol: 'SBIN.NS', name: 'SBIN' },             { symbol: 'LT.NS', name: 'LT' },             { symbol: 'BAJFINANCE.NS', name: 'BAJFINANCE' },
            { symbol: 'BHARTIARTL.NS', name: 'BHARTIARTL' },             { symbol: 'KOTAKBANK.NS', name: 'KOTAKBANK' },             { symbol: 'AXISBANK.NS', name: 'AXISBANK' },
            { symbol: 'ASIANPAINT.NS', name: 'ASIANPAINT' },             { symbol: 'HCLTECH.NS', name: 'HCLTECH' },             { symbol: 'MARUTI.NS', name: 'MARUTI' },
            { symbol: 'SUNPHARMA.NS', name: 'SUNPHARMA' },             { symbol: 'TITAN.NS', name: 'TITAN' },             { symbol: 'WIPRO.NS', name: 'WIPRO' },
            { symbol: 'ULTRACEMCO.NS', name: 'ULTRACEMCO' },             { symbol: 'ONGC.NS', name: 'ONGC' },             { symbol: 'NTPC.NS', name: 'NTPC' },
            { symbol: 'POWERGRID.NS', name: 'POWERGRID' },             { symbol: 'TATASTEEL.NS', name: 'TATASTEEL' },             { symbol: 'M&M.NS', name: 'M&M' },
            { symbol: 'TATAMOTORS.NS', name: 'TATAMOTORS' },             { symbol: 'COALINDIA.NS', name: 'COALINDIA' },             { symbol: 'HINDALCO.NS', name: 'HINDALCO' },
            { symbol: 'TECHM.NS', name: 'TECHM' },             { symbol: 'BAJAJFINSV.NS', name: 'BAJAJFINSV' },             { symbol: 'GRASIM.NS', name: 'GRASIM' },
            { symbol: 'ADANIENT.NS', name: 'ADANIENT' },             { symbol: 'ADANIPORTS.NS', name: 'ADANIPORTS' },             { symbol: 'APOLLOHOSP.NS', name: 'APOLLOHOSP' },
            { symbol: 'BRITANNIA.NS', name: 'BRITANNIA' },             { symbol: 'CIPLA.NS', name: 'CIPLA' },             { symbol: 'DIVISLAB.NS', name: 'DIVISLAB' },
            { symbol: 'DRREDDY.NS', name: 'DRREDDY' },             { symbol: 'EICHERMOT.NS', name: 'EICHERMOT' },             { symbol: 'HEROMOTOCO.NS', name: 'HEROMOTOCO' },
            { symbol: 'HINDUNILVR.NS', name: 'HINDUNILVR' },             { symbol: 'INDUSINDBK.NS', name: 'INDUSINDBK' },             { symbol: 'JSWSTEEL.NS', name: 'JSWSTEEL' },
            { symbol: 'NESTLEIND.NS', name: 'NESTLEIND' },             { symbol: 'SBILIFE.NS', name: 'SBILIFE' },             { symbol: 'TATACONSUM.NS', name: 'TATACONSUM' },
            { symbol: 'UPL.NS', name: 'UPL' },             { symbol: 'BPCL.NS', name: 'BPCL' },             { symbol: 'SHREECEM.NS', name: 'SHREECEM' },
            { symbol: 'SUZLON.NS', name: 'SUZLON' },             { symbol: 'IRFC.NS', name: 'IRFC' },             { symbol: 'RVNL.NS', name: 'RVNL' },
            { symbol: 'IREDA.NS', name: 'IREDA' },             { symbol: 'NHPC.NS', name: 'NHPC' },             { symbol: 'YESBANK.NS', name: 'YESBANK' },
            { symbol: 'JIOFIN.NS', name: 'JIOFIN' },             { symbol: 'IDEA.NS', name: 'IDEA' },             { symbol: 'GMRINFRA.NS', name: 'GMRINFRA' },
            { symbol: 'PNB.NS', name: 'PNB' },             { symbol: 'BHEL.NS', name: 'BHEL' },             { symbol: 'MAZDOCK.NS', name: 'MAZDOCK' },
            { symbol: 'HAL.NS', name: 'HAL' },             { symbol: 'BEL.NS', name: 'BEL' },             { symbol: 'RECLTD.NS', name: 'RECLTD' },
            { symbol: 'PFC.NS', name: 'PFC' },             { symbol: 'HUDCO.NS', name: 'HUDCO' },             { symbol: 'NBCC.NS', name: 'NBCC' },
            { symbol: 'SJVN.NS', name: 'SJVN' },             { symbol: 'ZOMATO.NS', name: 'ZOMATO' },             { symbol: 'OLECTRA.NS', name: 'OLECTRA' },
            { symbol: 'ADANIPOWER.NS', name: 'ADANIPOWER' },             { symbol: 'TATAPOWER.NS', name: 'TATAPOWER' },             { symbol: 'VBL.NS', name: 'VBL' },
            { symbol: 'DIXON.NS', name: 'DIXON' },             { symbol: 'CDSL.NS', name: 'CDSL' },             { symbol: 'BSE.NS', name: 'BSE' },
            { symbol: 'ANGELONE.NS', name: 'ANGELONE' },             { symbol: 'KPITTECH.NS', name: 'KPITTECH' },             { symbol: 'TATAELXSI.NS', name: 'TATAELXSI' },
            { symbol: 'PERSISTENT.NS', name: 'PERSISTENT' },             { symbol: 'COFORGE.NS', name: 'COFORGE' },             { symbol: 'LTTS.NS', name: 'LTTS' },
            { symbol: 'LTIM.NS', name: 'LTIM' },             { symbol: 'SONACOMS.NS', name: 'SONACOMS' },             { symbol: 'MOTHERSON.NS', name: 'MOTHERSON' },
            { symbol: 'CAMS.NS', name: 'CAMS' },             { symbol: 'AUBANK.NS', name: 'AUBANK' },             { symbol: 'FEDERALBNK.NS', name: 'FEDERALBNK' },
            { symbol: 'IDFCFIRSTB.NS', name: 'IDFCFIRSTB' },             { symbol: 'CHOLAFIN.NS', name: 'CHOLAFIN' },             { symbol: 'M&MFIN.NS', name: 'M&MFIN' },
            { symbol: 'MANAPPURAM.NS', name: 'MANAPPURAM' },             { symbol: 'MUTHOOTFIN.NS', name: 'MUTHOOTFIN' },             { symbol: 'TVSMOTOR.NS', name: 'TVSMOTOR' },
            { symbol: 'ASHOKLEY.NS', name: 'ASHOKLEY' },             { symbol: 'ESCORTS.NS', name: 'ESCORTS' },             { symbol: 'AMBUJACEM.NS', name: 'AMBUJACEM' },
            { symbol: 'ACC.NS', name: 'ACC' },             { symbol: 'JINDALSTEL.NS', name: 'JINDALSTEL' },             { symbol: 'NMDC.NS', name: 'NMDC' },
            { symbol: 'COCHINSHIP.NS', name: 'COCHINSHIP' },             { symbol: 'GRSE.NS', name: 'GRSE' },             { symbol: 'BDL.NS', name: 'BDL' },
            { symbol: 'BEML.NS', name: 'BEML' },             { symbol: 'MIDHANI.NS', name: 'MIDHANI' },             { symbol: 'ASTRA.NS', name: 'ASTRA' },
            { symbol: 'MTARTECH.NS', name: 'MTARTECH' },             { symbol: 'RAILTEL.NS', name: 'RAILTEL' },             { symbol: 'IRCTC.NS', name: 'IRCTC' },
            { symbol: 'CONCOR.NS', name: 'CONCOR' },             { symbol: 'TITAGARH.NS', name: 'TITAGARH' },             { symbol: 'TEXRAIL.NS', name: 'TEXRAIL' },
            { symbol: 'RITES.NS', name: 'RITES' },             { symbol: 'J&KBANK.NS', name: 'J&KBANK' },             { symbol: 'IOB.NS', name: 'IOB' },
            { symbol: 'UCOBANK.NS', name: 'UCOBANK' },             { symbol: 'CENTRALBK.NS', name: 'CENTRALBK' },             { symbol: 'BANKINDIA.NS', name: 'BANKINDIA' },
            { symbol: 'MAHABANK.NS', name: 'MAHABANK' },             { symbol: 'UNIONBANK.NS', name: 'UNIONBANK' },             { symbol: 'CANBK.NS', name: 'CANBK' },
            { symbol: 'INDIANB.NS', name: 'INDIANB' },             { symbol: 'PAYTM.NS', name: 'PAYTM' },             { symbol: 'NYKAA.NS', name: 'NYKAA' },
            { symbol: 'POLICYBKR.NS', name: 'POLICYBKR' },             { symbol: 'CARTRADE.NS', name: 'CARTRADE' },             { symbol: 'DELHIVERY.NS', name: 'DELHIVERY' },
            { symbol: 'EASEMYTRIP.NS', name: 'EASEMYTRIP' },             { symbol: 'HAPPSTMNDS.NS', name: 'HAPPSTMNDS' },             { symbol: 'ROUTE.NS', name: 'ROUTE' },
            { symbol: 'TATACHEM.NS', name: 'TATACHEM' },             { symbol: 'TATACOMM.NS', name: 'TATACOMM' },             { symbol: 'TATAMTRDVR.NS', name: 'TATAMTRDVR' },
            { symbol: 'TRENT.NS', name: 'TRENT' },             { symbol: 'PAGEIND.NS', name: 'PAGEIND' },             { symbol: 'SRF.NS', name: 'SRF' },
            { symbol: 'AARTIIND.NS', name: 'AARTIIND' },             { symbol: 'PIIND.NS', name: 'PIIND' },             { symbol: 'COROMANDEL.NS', name: 'COROMANDEL' },
            { symbol: 'DEEPAKNTR.NS', name: 'DEEPAKNTR' },             { symbol: 'NAVINFLUOR.NS', name: 'NAVINFLUOR' },             { symbol: 'ATUL.NS', name: 'ATUL' },
            { symbol: 'ALKYLAMINE.NS', name: 'ALKYLAMINE' },             { symbol: 'BALAMINES.NS', name: 'BALAMINES' },             { symbol: 'LAURUSLABS.NS', name: 'LAURUSLABS' },
            { symbol: 'GRANULES.NS', name: 'GRANULES' },             { symbol: 'GLENMARK.NS', name: 'GLENMARK' },             { symbol: 'AUROPHARMA.NS', name: 'AUROPHARMA' },
            { symbol: 'LUPIN.NS', name: 'LUPIN' },             { symbol: 'BIOCON.NS', name: 'BIOCON' },             { symbol: 'SYNGENE.NS', name: 'SYNGENE' },
            { symbol: 'TORNTPHARM.NS', name: 'TORNTPHARM' },             { symbol: 'ALKEM.NS', name: 'ALKEM' },             { symbol: 'IPCALAB.NS', name: 'IPCALAB' },
            { symbol: 'JUBILANT.NS', name: 'JUBILANT' },             { symbol: 'APOLLOTYRE.NS', name: 'APOLLOTYRE' },             { symbol: 'MRF.NS', name: 'MRF' },
            { symbol: 'CEATLTD.NS', name: 'CEATLTD' },             { symbol: 'BALKRISIND.NS', name: 'BALKRISIND' },             { symbol: 'BOSCHLTD.NS', name: 'BOSCHLTD' },
            { symbol: 'ENDURANCE.NS', name: 'ENDURANCE' },             { symbol: 'MINDAIND.NS', name: 'MINDAIND' },             { symbol: 'FLUOROCHEM.NS', name: 'FLUOROCHEM' },
            { symbol: 'POLYCAB.NS', name: 'POLYCAB' },             { symbol: 'KEI.NS', name: 'KEI' },             { symbol: 'FINCABLES.NS', name: 'FINCABLES' },
            { symbol: 'HAVELLS.NS', name: 'HAVELLS' },             { symbol: 'CROMPTON.NS', name: 'CROMPTON' },             { symbol: 'VOLTAS.NS', name: 'VOLTAS' },
            { symbol: 'BLUESTARCO.NS', name: 'BLUESTARCO' },             { symbol: 'WHIRLPOOL.NS', name: 'WHIRLPOOL' },             { symbol: 'BATAINDIA.NS', name: 'BATAINDIA' },
            { symbol: 'RELAXO.NS', name: 'RELAXO' },             { symbol: 'METROBRAND.NS', name: 'METROBRAND' },             { symbol: 'VEDL.NS', name: 'VEDL' },
            { symbol: 'HINDZINC.NS', name: 'HINDZINC' },             { symbol: 'NALCO.NS', name: 'NALCO' },             { symbol: 'SAIL.NS', name: 'SAIL' },
            { symbol: 'TATAINVEST.NS', name: 'TATAINVEST' },             { symbol: 'BAJAJHLDNG.NS', name: 'BAJAJHLDNG' },             { symbol: 'HDFCAMC.NS', name: 'HDFCAMC' },
            { symbol: 'UTIAMC.NS', name: 'UTIAMC' },             { symbol: 'MCX.NS', name: 'MCX' },             { symbol: 'IEX.NS', name: 'IEX' },
            { symbol: 'CAMPUS.NS', name: 'CAMPUS' },             { symbol: 'MANYAVAR.NS', name: 'MANYAVAR' },             { symbol: 'KALYANKJIL.NS', name: 'KALYANKJIL' },
            { symbol: 'TTML.NS', name: 'TTML' },             { symbol: 'TRIDENT.NS', name: 'TRIDENT' },             { symbol: 'WELSPUNIND.NS', name: 'WELSPUNIND' },
            { symbol: 'KPRMILL.NS', name: 'KPRMILL' },             { symbol: 'VIPIND.NS', name: 'VIPIND' },             { symbol: 'SYMPHONY.NS', name: 'SYMPHONY' },
            { symbol: 'TTKPRESTIG.NS', name: 'TTKPRESTIG' },             { symbol: 'HAWKINS.NS', name: 'HAWKINS' },             { symbol: 'AWL.NS', name: 'AWL' },
            { symbol: 'ATGL.NS', name: 'ATGL' },             { symbol: 'AMARAJABAT.NS', name: 'AMARAJABAT' },             { symbol: 'EXIDEIND.NS', name: 'EXIDEIND' },
            { symbol: 'LICI.NS', name: 'LICI' },             { symbol: 'GICRE.NS', name: 'GICRE' },             { symbol: 'NIACL.NS', name: 'NIACL' },
            { symbol: 'HDFCLIFE.NS', name: 'HDFCLIFE' },             { symbol: 'ICICIPRULI.NS', name: 'ICICIPRULI' },             { symbol: 'MAXFIN.NS', name: 'MAXFIN' },
            { symbol: 'BANDHANBNK.NS', name: 'BANDHANBNK' },             { symbol: 'INDIGOPNTS.NS', name: 'INDIGOPNTS' },             { symbol: 'KANSAINER.NS', name: 'KANSAINER' },
            { symbol: 'BERGEPAINT.NS', name: 'BERGEPAINT' },             { symbol: 'SUPREMEIND.NS', name: 'SUPREMEIND' },             { symbol: 'ASTRAL.NS', name: 'ASTRAL' },
            { symbol: 'FINPIPE.NS', name: 'FINPIPE' },             { symbol: 'PRINCEPIPE.NS', name: 'PRINCEPIPE' },             { symbol: 'VGUARD.NS', name: 'VGUARD' },
            { symbol: 'SYRMA.NS', name: 'SYRMA' },             { symbol: 'KAYNES.NS', name: 'KAYNES' },             { symbol: 'AVALON.NS', name: 'AVALON' },
            { symbol: 'CYIENT.NS', name: 'CYIENT' },             { symbol: 'ZENSARTECH.NS', name: 'ZENSARTECH' },             { symbol: 'MPHASIS.NS', name: 'MPHASIS' },
            { symbol: 'BSOFT.NS', name: 'BSOFT' },             { symbol: 'SONATA.NS', name: 'SONATA' },             { symbol: 'INTELLECT.NS', name: 'INTELLECT' },
            { symbol: 'TRITURBINE.NS', name: 'TRITURBINE' },             { symbol: 'THERMAX.NS', name: 'THERMAX' },             { symbol: 'CUMMINSIND.NS', name: 'CUMMINSIND' },
            { symbol: 'ABB.NS', name: 'ABB' },             { symbol: 'SIEMENS.NS', name: 'SIEMENS' },             { symbol: 'CGPOWER.NS', name: 'CGPOWER' },
            { symbol: 'KEC.NS', name: 'KEC' },             { symbol: 'KALPATPOWR.NS', name: 'KALPATPOWR' },             { symbol: 'NCC.NS', name: 'NCC' },
            { symbol: 'DILIPBUILD.NS', name: 'DILIPBUILD' },             { symbol: 'PNCINFRA.NS', name: 'PNCINFRA' },             { symbol: 'KNRCON.NS', name: 'KNRCON' },
            { symbol: 'ASHOKA.NS', name: 'ASHOKA' },             { symbol: 'IRB.NS', name: 'IRB' },             { symbol: 'GPPL.NS', name: 'GPPL' },
            { symbol: 'JSWENERGY.NS', name: 'JSWENERGY' },             { symbol: 'TORNTPOWER.NS', name: 'TORNTPOWER' },             { symbol: 'CESC.NS', name: 'CESC' },
            { symbol: 'IGL.NS', name: 'IGL' },             { symbol: 'MGL.NS', name: 'MGL' },             { symbol: 'GUJGASLTD.NS', name: 'GUJGASLTD' },
            { symbol: 'GSPL.NS', name: 'GSPL' },             { symbol: 'PETRONET.NS', name: 'PETRONET' },             { symbol: 'OIL.NS', name: 'OIL' },
            { symbol: 'HINDPETRO.NS', name: 'HINDPETRO' },             { symbol: 'CHENNPETRO.NS', name: 'CHENNPETRO' },             { symbol: 'MRPL.NS', name: 'MRPL' },
            { symbol: 'GAIL.NS', name: 'GAIL' }
        ];

        // Randomly shuffle the massive array
        for (let i = fallbackData.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [fallbackData[i], fallbackData[j]] = [fallbackData[j], fallbackData[i]];
        }

        // Take 40 random stocks to process so the AI always gets a fresh, unique menu
        const randomMenu = fallbackData.slice(0, 40);
        
        const symbolsList = randomMenu.map(item => item.symbol);
        
        let quoteResults = [];
        try {
            // Fetch all 40 quotes in a SINGLE batched request to prevent Yahoo Finance 429 Rate Limiting
            quoteResults = await yahooFinance.quote(symbolsList);
        } catch(e) {
            console.error("Batched Yahoo Quote failed:", e.message);
        }

        const simulatedMovers = [];
        
        for (const item of randomMenu) {
            const quote = quoteResults.find(q => q.symbol === item.symbol);
            if (quote && quote.regularMarketPrice) {
                simulatedMovers.push({
                    symbol: item.symbol,
                    name: item.name,
                    price: quote.regularMarketPrice,
                    changePercent: quote.regularMarketChangePercent || 0
                });
            } else {
                // Final fallback if batch fails for a specific symbol
                const price = await getStockPrice(item.symbol);
                if (price) {
                    simulatedMovers.push({ symbol: item.symbol, name: item.name, price, changePercent: 0 });
                }
            }
        }
        
        simulatedMovers.sort((a,b) => b.changePercent - a.changePercent);
        
        return { 
            gainers: simulatedMovers.slice(0, 15), 
            losers: simulatedMovers.slice(Math.max(simulatedMovers.length - 15, 0)).reverse() 
        };
    }
};

module.exports = { getStockPrice, searchSymbol, getMarketMovers };
