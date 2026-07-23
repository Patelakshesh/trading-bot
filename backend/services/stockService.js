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
        let exchanges = ['NSE'];
        if (symbol.endsWith('.BO')) exchanges = ['BOM'];
        else if (!symbol.endsWith('.NS') && !symbol.endsWith('.BO')) exchanges = ['NYSE', 'NASDAQ'];
        
        const gfSymbol = symbol.split('.')[0];
        
        for (const exchange of exchanges) {
            const controller = new AbortController();
            const gfTimeout = setTimeout(() => controller.abort(), 4000);
            try {
                const response = await fetch(`https://www.google.com/finance/quote/${gfSymbol}:${exchange}`, { 
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    signal: controller.signal 
                });
                clearTimeout(gfTimeout);
                
                if (response.ok) {
                    const html = await response.text();
                    const match = html.match(/class="YMlKec fxKbKc">([^<]+)<\/div>/);
                    if (match && match[1]) {
                        const parsedPrice = parseFloat(match[1].replace(/[^0-9.]/g, ''));
                        if (!isNaN(parsedPrice) && parsedPrice > 0) {
                            priceCache.set(querySymbol, { price: parsedPrice, timestamp: Date.now() });
                            console.log(`[GoogleFinance] ${symbol} = ₹${parsedPrice} (via ${exchange})`);
                            return parsedPrice;
                        }
                    }
                }
            } catch (e) {
                clearTimeout(gfTimeout);
            }
        }
    } catch (gfError) {
        console.warn(`[GoogleFinance] Failed for ${symbol}: ${gfError.message}`);
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
        // Step 1: Explicitly check for the Indian NSE stock first
        const nseQuery = `${cleanQuery}.NS`;
        let results = await yahooFinance.search(nseQuery);
        
        if (results.quotes && results.quotes.length > 0) {
            const exactNseMatch = results.quotes.find(q => q.symbol === nseQuery);
            if (exactNseMatch) return exactNseMatch.symbol;
        }

        // Step 2: Fallback to global search if NSE stock not found
        results = await yahooFinance.search(cleanQuery);
        
        if (results.quotes && results.quotes.length > 0) {
            // Prioritize Indian stock exchanges (.NS or .BO) just in case
            const indianStock = results.quotes.find(q => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO')));
            if (indianStock) return indianStock.symbol;
            
            // Fallback to the top result if it's not an Indian stock
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
{ symbol: '360ONE.NS', name: '360ONE' },
{ symbol: '3MINDIA.NS', name: '3MINDIA' },
{ symbol: 'ABB.NS', name: 'ABB' },
{ symbol: 'ACC.NS', name: 'ACC' },
{ symbol: 'ACMESOLAR.NS', name: 'ACMESOLAR' },
{ symbol: 'AIAENG.NS', name: 'AIAENG' },
{ symbol: 'APLAPOLLO.NS', name: 'APLAPOLLO' },
{ symbol: 'AUBANK.NS', name: 'AUBANK' },
{ symbol: 'AWL.NS', name: 'AWL' },
{ symbol: 'AADHARHFC.NS', name: 'AADHARHFC' },
{ symbol: 'AARTIIND.NS', name: 'AARTIIND' },
{ symbol: 'AAVAS.NS', name: 'AAVAS' },
{ symbol: 'ABBOTINDIA.NS', name: 'ABBOTINDIA' },
{ symbol: 'ACE.NS', name: 'ACE' },
{ symbol: 'ACUTAAS.NS', name: 'ACUTAAS' },
{ symbol: 'ADANIENSOL.NS', name: 'ADANIENSOL' },
{ symbol: 'ADANIENT.NS', name: 'ADANIENT' },
{ symbol: 'ADANIGREEN.NS', name: 'ADANIGREEN' },
{ symbol: 'ADANIPORTS.NS', name: 'ADANIPORTS' },
{ symbol: 'ADANIPOWER.NS', name: 'ADANIPOWER' },
{ symbol: 'ATGL.NS', name: 'ATGL' },
{ symbol: 'ABCAPITAL.NS', name: 'ABCAPITAL' },
{ symbol: 'ABFRL.NS', name: 'ABFRL' },
{ symbol: 'ABLBL.NS', name: 'ABLBL' },
{ symbol: 'ABREL.NS', name: 'ABREL' },
{ symbol: 'ABSLAMC.NS', name: 'ABSLAMC' },
{ symbol: 'CPPLUS.NS', name: 'CPPLUS' },
{ symbol: 'AEGISLOG.NS', name: 'AEGISLOG' },
{ symbol: 'AEGISVOPAK.NS', name: 'AEGISVOPAK' },
{ symbol: 'AFCONS.NS', name: 'AFCONS' },
{ symbol: 'AFFLE.NS', name: 'AFFLE' },
{ symbol: 'AJANTPHARM.NS', name: 'AJANTPHARM' },
{ symbol: 'ALKEM.NS', name: 'ALKEM' },
{ symbol: 'ABDL.NS', name: 'ABDL' },
{ symbol: 'ARE&M.NS', name: 'ARE&M' },
{ symbol: 'AMBER.NS', name: 'AMBER' },
{ symbol: 'AMBUJACEM.NS', name: 'AMBUJACEM' },
{ symbol: 'ANANDRATHI.NS', name: 'ANANDRATHI' },
{ symbol: 'ANANTRAJ.NS', name: 'ANANTRAJ' },
{ symbol: 'ANGELONE.NS', name: 'ANGELONE' },
{ symbol: 'ANTHEM.NS', name: 'ANTHEM' },
{ symbol: 'ANURAS.NS', name: 'ANURAS' },
{ symbol: 'APARINDS.NS', name: 'APARINDS' },
{ symbol: 'APOLLOHOSP.NS', name: 'APOLLOHOSP' },
{ symbol: 'APOLLOTYRE.NS', name: 'APOLLOTYRE' },
{ symbol: 'APTUS.NS', name: 'APTUS' },
{ symbol: 'ASAHIINDIA.NS', name: 'ASAHIINDIA' },
{ symbol: 'ASHOKLEY.NS', name: 'ASHOKLEY' },
{ symbol: 'ASIANPAINT.NS', name: 'ASIANPAINT' },
{ symbol: 'ASTERDM.NS', name: 'ASTERDM' },
{ symbol: 'ASTRAL.NS', name: 'ASTRAL' },
{ symbol: 'ATHERENERG.NS', name: 'ATHERENERG' },
{ symbol: 'ATUL.NS', name: 'ATUL' },
{ symbol: 'AUROPHARMA.NS', name: 'AUROPHARMA' },
{ symbol: 'AIIL.NS', name: 'AIIL' },
{ symbol: 'DMART.NS', name: 'DMART' },
{ symbol: 'AXISBANK.NS', name: 'AXISBANK' },
{ symbol: 'BEML.NS', name: 'BEML' },
{ symbol: 'BLS.NS', name: 'BLS' },
{ symbol: 'BSE.NS', name: 'BSE' },
{ symbol: 'BAJAJ-AUTO.NS', name: 'BAJAJ-AUTO' },
{ symbol: 'BAJFINANCE.NS', name: 'BAJFINANCE' },
{ symbol: 'BAJAJFINSV.NS', name: 'BAJAJFINSV' },
{ symbol: 'BAJAJHLDNG.NS', name: 'BAJAJHLDNG' },
{ symbol: 'BAJAJHFL.NS', name: 'BAJAJHFL' },
{ symbol: 'BALKRISIND.NS', name: 'BALKRISIND' },
{ symbol: 'BALRAMCHIN.NS', name: 'BALRAMCHIN' },
{ symbol: 'BANDHANBNK.NS', name: 'BANDHANBNK' },
{ symbol: 'BANKBARODA.NS', name: 'BANKBARODA' },
{ symbol: 'BANKINDIA.NS', name: 'BANKINDIA' },
{ symbol: 'MAHABANK.NS', name: 'MAHABANK' },
{ symbol: 'BATAINDIA.NS', name: 'BATAINDIA' },
{ symbol: 'BAYERCROP.NS', name: 'BAYERCROP' },
{ symbol: 'BELRISE.NS', name: 'BELRISE' },
{ symbol: 'BERGEPAINT.NS', name: 'BERGEPAINT' },
{ symbol: 'BDL.NS', name: 'BDL' },
{ symbol: 'BEL.NS', name: 'BEL' },
{ symbol: 'BHARATFORG.NS', name: 'BHARATFORG' },
{ symbol: 'BHEL.NS', name: 'BHEL' },
{ symbol: 'BPCL.NS', name: 'BPCL' },
{ symbol: 'BHARTIARTL.NS', name: 'BHARTIARTL' },
{ symbol: 'BHARTIHEXA.NS', name: 'BHARTIHEXA' },
{ symbol: 'BIKAJI.NS', name: 'BIKAJI' },
{ symbol: 'GROWW.NS', name: 'GROWW' },
{ symbol: 'BIOCON.NS', name: 'BIOCON' },
{ symbol: 'BSOFT.NS', name: 'BSOFT' },
{ symbol: 'BLUEDART.NS', name: 'BLUEDART' },
{ symbol: 'BLUEJET.NS', name: 'BLUEJET' },
{ symbol: 'BLUESTARCO.NS', name: 'BLUESTARCO' },
{ symbol: 'BBTC.NS', name: 'BBTC' },
{ symbol: 'BOSCHLTD.NS', name: 'BOSCHLTD' },
{ symbol: 'FIRSTCRY.NS', name: 'FIRSTCRY' },
{ symbol: 'BRIGADE.NS', name: 'BRIGADE' },
{ symbol: 'BRITANNIA.NS', name: 'BRITANNIA' },
{ symbol: 'MAPMYINDIA.NS', name: 'MAPMYINDIA' },
{ symbol: 'CCL.NS', name: 'CCL' },
{ symbol: 'CESC.NS', name: 'CESC' },
{ symbol: 'CGPOWER.NS', name: 'CGPOWER' },
{ symbol: 'CIEINDIA.NS', name: 'CIEINDIA' },
{ symbol: 'CRISIL.NS', name: 'CRISIL' },
{ symbol: 'CANFINHOME.NS', name: 'CANFINHOME' },
{ symbol: 'CANBK.NS', name: 'CANBK' },
{ symbol: 'CANHLIFE.NS', name: 'CANHLIFE' },
{ symbol: 'CAPLIPOINT.NS', name: 'CAPLIPOINT' },
{ symbol: 'CGCL.NS', name: 'CGCL' },
{ symbol: 'CARBORUNIV.NS', name: 'CARBORUNIV' },
{ symbol: 'CARTRADE.NS', name: 'CARTRADE' },
{ symbol: 'CASTROLIND.NS', name: 'CASTROLIND' },
{ symbol: 'CEATLTD.NS', name: 'CEATLTD' },
{ symbol: 'CEMPRO.NS', name: 'CEMPRO' },
{ symbol: 'CENTRALBK.NS', name: 'CENTRALBK' },
{ symbol: 'CDSL.NS', name: 'CDSL' },
{ symbol: 'CHALET.NS', name: 'CHALET' },
{ symbol: 'CHAMBLFERT.NS', name: 'CHAMBLFERT' },
{ symbol: 'CHENNPETRO.NS', name: 'CHENNPETRO' },
{ symbol: 'CHOICEIN.NS', name: 'CHOICEIN' },
{ symbol: 'CHOLAHLDNG.NS', name: 'CHOLAHLDNG' },
{ symbol: 'CHOLAFIN.NS', name: 'CHOLAFIN' },
{ symbol: 'CIPLA.NS', name: 'CIPLA' },
{ symbol: 'CUB.NS', name: 'CUB' },
{ symbol: 'CLEAN.NS', name: 'CLEAN' },
{ symbol: 'COALINDIA.NS', name: 'COALINDIA' },
{ symbol: 'COCHINSHIP.NS', name: 'COCHINSHIP' },
{ symbol: 'COFORGE.NS', name: 'COFORGE' },
{ symbol: 'COHANCE.NS', name: 'COHANCE' },
{ symbol: 'COLPAL.NS', name: 'COLPAL' },
{ symbol: 'CAMS.NS', name: 'CAMS' },
{ symbol: 'CONCORDBIO.NS', name: 'CONCORDBIO' },
{ symbol: 'CONCOR.NS', name: 'CONCOR' },
{ symbol: 'COROMANDEL.NS', name: 'COROMANDEL' },
{ symbol: 'CRAFTSMAN.NS', name: 'CRAFTSMAN' },
{ symbol: 'CREDITACC.NS', name: 'CREDITACC' },
{ symbol: 'CROMPTON.NS', name: 'CROMPTON' },
{ symbol: 'CUMMINSIND.NS', name: 'CUMMINSIND' },
{ symbol: 'CYIENT.NS', name: 'CYIENT' },
{ symbol: 'DCMSHRIRAM.NS', name: 'DCMSHRIRAM' },
{ symbol: 'DLF.NS', name: 'DLF' },
{ symbol: 'DOMS.NS', name: 'DOMS' },
{ symbol: 'DABUR.NS', name: 'DABUR' },
{ symbol: 'DALBHARAT.NS', name: 'DALBHARAT' },
{ symbol: 'DATAPATTNS.NS', name: 'DATAPATTNS' },
{ symbol: 'DEEPAKFERT.NS', name: 'DEEPAKFERT' },
{ symbol: 'DEEPAKNTR.NS', name: 'DEEPAKNTR' },
{ symbol: 'DELHIVERY.NS', name: 'DELHIVERY' },
{ symbol: 'DEVYANI.NS', name: 'DEVYANI' },
{ symbol: 'DIVISLAB.NS', name: 'DIVISLAB' },
{ symbol: 'DIXON.NS', name: 'DIXON' },
{ symbol: 'LALPATHLAB.NS', name: 'LALPATHLAB' },
{ symbol: 'DRREDDY.NS', name: 'DRREDDY' },
{ symbol: 'EIDPARRY.NS', name: 'EIDPARRY' },
{ symbol: 'EIHOTEL.NS', name: 'EIHOTEL' },
{ symbol: 'EICHERMOT.NS', name: 'EICHERMOT' },
{ symbol: 'ELECON.NS', name: 'ELECON' },
{ symbol: 'ELGIEQUIP.NS', name: 'ELGIEQUIP' },
{ symbol: 'EMAMILTD.NS', name: 'EMAMILTD' },
{ symbol: 'EMCURE.NS', name: 'EMCURE' },
{ symbol: 'EMMVEE.NS', name: 'EMMVEE' },
{ symbol: 'ENDURANCE.NS', name: 'ENDURANCE' },
{ symbol: 'ENGINERSIN.NS', name: 'ENGINERSIN' },
{ symbol: 'ERIS.NS', name: 'ERIS' },
{ symbol: 'ESCORTS.NS', name: 'ESCORTS' },
{ symbol: 'ETERNAL.NS', name: 'ETERNAL' },
{ symbol: 'EXIDEIND.NS', name: 'EXIDEIND' },
{ symbol: 'NYKAA.NS', name: 'NYKAA' },
{ symbol: 'FEDERALBNK.NS', name: 'FEDERALBNK' },
{ symbol: 'FACT.NS', name: 'FACT' },
{ symbol: 'FINCABLES.NS', name: 'FINCABLES' },
{ symbol: 'FSL.NS', name: 'FSL' },
{ symbol: 'FIVESTAR.NS', name: 'FIVESTAR' },
{ symbol: 'FORCEMOT.NS', name: 'FORCEMOT' },
{ symbol: 'FORTIS.NS', name: 'FORTIS' },
{ symbol: 'GAIL.NS', name: 'GAIL' },
{ symbol: 'GVT&D.NS', name: 'GVT&D' },
{ symbol: 'GMRAIRPORT.NS', name: 'GMRAIRPORT' },
{ symbol: 'GABRIEL.NS', name: 'GABRIEL' },
{ symbol: 'GALLANTT.NS', name: 'GALLANTT' },
{ symbol: 'GRSE.NS', name: 'GRSE' },
{ symbol: 'GICRE.NS', name: 'GICRE' },
{ symbol: 'GILLETTE.NS', name: 'GILLETTE' },
{ symbol: 'GLAND.NS', name: 'GLAND' },
{ symbol: 'GLAXO.NS', name: 'GLAXO' },
{ symbol: 'GLENMARK.NS', name: 'GLENMARK' },
{ symbol: 'MEDANTA.NS', name: 'MEDANTA' },
{ symbol: 'GODIGIT.NS', name: 'GODIGIT' },
{ symbol: 'GPIL.NS', name: 'GPIL' },
{ symbol: 'GODFRYPHLP.NS', name: 'GODFRYPHLP' },
{ symbol: 'GODREJCP.NS', name: 'GODREJCP' },
{ symbol: 'GODREJIND.NS', name: 'GODREJIND' },
{ symbol: 'GODREJPROP.NS', name: 'GODREJPROP' },
{ symbol: 'GRANULES.NS', name: 'GRANULES' },
{ symbol: 'GRAPHITE.NS', name: 'GRAPHITE' },
{ symbol: 'GRASIM.NS', name: 'GRASIM' },
{ symbol: 'GRAVITA.NS', name: 'GRAVITA' },
{ symbol: 'GESHIP.NS', name: 'GESHIP' },
{ symbol: 'FLUOROCHEM.NS', name: 'FLUOROCHEM' },
{ symbol: 'GMDCLTD.NS', name: 'GMDCLTD' },
{ symbol: 'HEG.NS', name: 'HEG' },
{ symbol: 'HBLENGINE.NS', name: 'HBLENGINE' },
{ symbol: 'HCLTECH.NS', name: 'HCLTECH' },
{ symbol: 'HDBFS.NS', name: 'HDBFS' },
{ symbol: 'HDFCAMC.NS', name: 'HDFCAMC' },
{ symbol: 'HDFCBANK.NS', name: 'HDFCBANK' },
{ symbol: 'HDFCLIFE.NS', name: 'HDFCLIFE' },
{ symbol: 'HFCL.NS', name: 'HFCL' },
{ symbol: 'HAVELLS.NS', name: 'HAVELLS' },
{ symbol: 'HEROMOTOCO.NS', name: 'HEROMOTOCO' },
{ symbol: 'HEXT.NS', name: 'HEXT' },
{ symbol: 'HSCL.NS', name: 'HSCL' },
{ symbol: 'HINDALCO.NS', name: 'HINDALCO' },
{ symbol: 'HAL.NS', name: 'HAL' },
{ symbol: 'HINDCOPPER.NS', name: 'HINDCOPPER' },
{ symbol: 'HINDPETRO.NS', name: 'HINDPETRO' },
{ symbol: 'HINDUNILVR.NS', name: 'HINDUNILVR' },
{ symbol: 'HINDZINC.NS', name: 'HINDZINC' },
{ symbol: 'POWERINDIA.NS', name: 'POWERINDIA' },
{ symbol: 'HOMEFIRST.NS', name: 'HOMEFIRST' },
{ symbol: 'HONASA.NS', name: 'HONASA' },
{ symbol: 'HONAUT.NS', name: 'HONAUT' },
{ symbol: 'HUDCO.NS', name: 'HUDCO' },
{ symbol: 'HYUNDAI.NS', name: 'HYUNDAI' },
{ symbol: 'ICICIBANK.NS', name: 'ICICIBANK' },
{ symbol: 'ICICIGI.NS', name: 'ICICIGI' },
{ symbol: 'ICICIAMC.NS', name: 'ICICIAMC' },
{ symbol: 'ICICIPRULI.NS', name: 'ICICIPRULI' },
{ symbol: 'IDBI.NS', name: 'IDBI' },
{ symbol: 'IDFCFIRSTB.NS', name: 'IDFCFIRSTB' },
{ symbol: 'IFCI.NS', name: 'IFCI' },
{ symbol: 'IIFL.NS', name: 'IIFL' },
{ symbol: 'IRB.NS', name: 'IRB' },
{ symbol: 'IRCON.NS', name: 'IRCON' },
{ symbol: 'ITCHOTELS.NS', name: 'ITCHOTELS' },
{ symbol: 'ITC.NS', name: 'ITC' },
{ symbol: 'ITI.NS', name: 'ITI' },
{ symbol: 'INDGN.NS', name: 'INDGN' },
{ symbol: 'INDIACEM.NS', name: 'INDIACEM' },
{ symbol: 'INDIAMART.NS', name: 'INDIAMART' },
{ symbol: 'INDIANB.NS', name: 'INDIANB' },
{ symbol: 'IEX.NS', name: 'IEX' },
{ symbol: 'INDHOTEL.NS', name: 'INDHOTEL' },
{ symbol: 'IOC.NS', name: 'IOC' },
{ symbol: 'IOB.NS', name: 'IOB' },
{ symbol: 'IRCTC.NS', name: 'IRCTC' },
{ symbol: 'IRFC.NS', name: 'IRFC' },
{ symbol: 'IREDA.NS', name: 'IREDA' },
{ symbol: 'IGL.NS', name: 'IGL' },
{ symbol: 'INDUSTOWER.NS', name: 'INDUSTOWER' },
{ symbol: 'INDUSINDBK.NS', name: 'INDUSINDBK' },
{ symbol: 'NAUKRI.NS', name: 'NAUKRI' },
{ symbol: 'INFY.NS', name: 'INFY' },
{ symbol: 'INOXWIND.NS', name: 'INOXWIND' },
{ symbol: 'INTELLECT.NS', name: 'INTELLECT' },
{ symbol: 'INDIGO.NS', name: 'INDIGO' },
{ symbol: 'IGIL.NS', name: 'IGIL' },
{ symbol: 'IKS.NS', name: 'IKS' },
{ symbol: 'IPCALAB.NS', name: 'IPCALAB' },
{ symbol: 'JKCEMENT.NS', name: 'JKCEMENT' },
{ symbol: 'JBMA.NS', name: 'JBMA' },
{ symbol: 'JKTYRE.NS', name: 'JKTYRE' },
{ symbol: 'JMFINANCIL.NS', name: 'JMFINANCIL' },
{ symbol: 'JSWCEMENT.NS', name: 'JSWCEMENT' },
{ symbol: 'JSWDULUX.NS', name: 'JSWDULUX' },
{ symbol: 'JSWENERGY.NS', name: 'JSWENERGY' },
{ symbol: 'JSWINFRA.NS', name: 'JSWINFRA' },
{ symbol: 'JSWSTEEL.NS', name: 'JSWSTEEL' },
{ symbol: 'JAINREC.NS', name: 'JAINREC' },
{ symbol: 'JPPOWER.NS', name: 'JPPOWER' },
{ symbol: 'J&KBANK.NS', name: 'J&KBANK' },
{ symbol: 'JINDALSAW.NS', name: 'JINDALSAW' },
{ symbol: 'JSL.NS', name: 'JSL' },
{ symbol: 'JINDALSTEL.NS', name: 'JINDALSTEL' },
{ symbol: 'JIOFIN.NS', name: 'JIOFIN' },
{ symbol: 'JUBLFOOD.NS', name: 'JUBLFOOD' },
{ symbol: 'JUBLINGREA.NS', name: 'JUBLINGREA' },
{ symbol: 'JUBLPHARMA.NS', name: 'JUBLPHARMA' },
{ symbol: 'JWL.NS', name: 'JWL' },
{ symbol: 'JYOTICNC.NS', name: 'JYOTICNC' },
{ symbol: 'KPRMILL.NS', name: 'KPRMILL' },
{ symbol: 'KEI.NS', name: 'KEI' },
{ symbol: 'KPITTECH.NS', name: 'KPITTECH' },
{ symbol: 'KAJARIACER.NS', name: 'KAJARIACER' },
{ symbol: 'KPIL.NS', name: 'KPIL' },
{ symbol: 'KALYANKJIL.NS', name: 'KALYANKJIL' },
{ symbol: 'KARURVYSYA.NS', name: 'KARURVYSYA' },
{ symbol: 'KAYNES.NS', name: 'KAYNES' },
{ symbol: 'KEC.NS', name: 'KEC' },
{ symbol: 'KFINTECH.NS', name: 'KFINTECH' },
{ symbol: 'KIRLOSENG.NS', name: 'KIRLOSENG' },
{ symbol: 'KOTAKBANK.NS', name: 'KOTAKBANK' },
{ symbol: 'KIMS.NS', name: 'KIMS' },
{ symbol: 'LTF.NS', name: 'LTF' },
{ symbol: 'LTTS.NS', name: 'LTTS' },
{ symbol: 'LGEINDIA.NS', name: 'LGEINDIA' },
{ symbol: 'LICHSGFIN.NS', name: 'LICHSGFIN' },
{ symbol: 'LTFOODS.NS', name: 'LTFOODS' },
{ symbol: 'LTM.NS', name: 'LTM' },
{ symbol: 'LT.NS', name: 'LT' },
{ symbol: 'LATENTVIEW.NS', name: 'LATENTVIEW' },
{ symbol: 'LAURUSLABS.NS', name: 'LAURUSLABS' },
{ symbol: 'THELEELA.NS', name: 'THELEELA' },
{ symbol: 'LEMONTREE.NS', name: 'LEMONTREE' },
{ symbol: 'LENSKART.NS', name: 'LENSKART' },
{ symbol: 'LICI.NS', name: 'LICI' },
{ symbol: 'LINDEINDIA.NS', name: 'LINDEINDIA' },
{ symbol: 'LLOYDSME.NS', name: 'LLOYDSME' },
{ symbol: 'LODHA.NS', name: 'LODHA' },
{ symbol: 'LUPIN.NS', name: 'LUPIN' },
{ symbol: 'MMTC.NS', name: 'MMTC' },
{ symbol: 'MRF.NS', name: 'MRF' },
{ symbol: 'MGL.NS', name: 'MGL' },
{ symbol: 'M&MFIN.NS', name: 'M&MFIN' },
{ symbol: 'M&M.NS', name: 'M&M' },
{ symbol: 'MANAPPURAM.NS', name: 'MANAPPURAM' },
{ symbol: 'MRPL.NS', name: 'MRPL' },
{ symbol: 'MANKIND.NS', name: 'MANKIND' },
{ symbol: 'MARICO.NS', name: 'MARICO' },
{ symbol: 'MARUTI.NS', name: 'MARUTI' },
{ symbol: 'MFSL.NS', name: 'MFSL' },
{ symbol: 'MAXHEALTH.NS', name: 'MAXHEALTH' },
{ symbol: 'MAZDOCK.NS', name: 'MAZDOCK' },
{ symbol: 'MEESHO.NS', name: 'MEESHO' },
{ symbol: 'MINDACORP.NS', name: 'MINDACORP' },
{ symbol: 'MSUMI.NS', name: 'MSUMI' },
{ symbol: 'MOTILALOFS.NS', name: 'MOTILALOFS' },
{ symbol: 'MPHASIS.NS', name: 'MPHASIS' },
{ symbol: 'MCX.NS', name: 'MCX' },
{ symbol: 'MUTHOOTFIN.NS', name: 'MUTHOOTFIN' },
{ symbol: 'NATCOPHARM.NS', name: 'NATCOPHARM' },
{ symbol: 'NBCC.NS', name: 'NBCC' },
{ symbol: 'NCC.NS', name: 'NCC' },
{ symbol: 'NHPC.NS', name: 'NHPC' },
{ symbol: 'NLCINDIA.NS', name: 'NLCINDIA' },
{ symbol: 'NMDC.NS', name: 'NMDC' },
{ symbol: 'NSLNISP.NS', name: 'NSLNISP' },
{ symbol: 'NTPCGREEN.NS', name: 'NTPCGREEN' },
{ symbol: 'NTPC.NS', name: 'NTPC' },
{ symbol: 'NH.NS', name: 'NH' },
{ symbol: 'NATIONALUM.NS', name: 'NATIONALUM' },
{ symbol: 'NAVA.NS', name: 'NAVA' },
{ symbol: 'NAVINFLUOR.NS', name: 'NAVINFLUOR' },
{ symbol: 'NESTLEIND.NS', name: 'NESTLEIND' },
{ symbol: 'NETWEB.NS', name: 'NETWEB' },
{ symbol: 'NEULANDLAB.NS', name: 'NEULANDLAB' },
{ symbol: 'NEWGEN.NS', name: 'NEWGEN' },
{ symbol: 'NAM-INDIA.NS', name: 'NAM-INDIA' },
{ symbol: 'NIVABUPA.NS', name: 'NIVABUPA' },
{ symbol: 'NUVAMA.NS', name: 'NUVAMA' },
{ symbol: 'NUVOCO.NS', name: 'NUVOCO' },
{ symbol: 'OBEROIRLTY.NS', name: 'OBEROIRLTY' },
{ symbol: 'ONGC.NS', name: 'ONGC' },
{ symbol: 'OIL.NS', name: 'OIL' },
{ symbol: 'OLAELEC.NS', name: 'OLAELEC' },
{ symbol: 'OLECTRA.NS', name: 'OLECTRA' },
{ symbol: 'PAYTM.NS', name: 'PAYTM' },
{ symbol: 'ONESOURCE.NS', name: 'ONESOURCE' },
{ symbol: 'OFSS.NS', name: 'OFSS' },
{ symbol: 'POLICYBZR.NS', name: 'POLICYBZR' },
{ symbol: 'PCBL.NS', name: 'PCBL' },
{ symbol: 'PGEL.NS', name: 'PGEL' },
{ symbol: 'PIIND.NS', name: 'PIIND' },
{ symbol: 'PNBHOUSING.NS', name: 'PNBHOUSING' },
{ symbol: 'PTCIL.NS', name: 'PTCIL' },
{ symbol: 'PVRINOX.NS', name: 'PVRINOX' },
{ symbol: 'PAGEIND.NS', name: 'PAGEIND' },
{ symbol: 'PARADEEP.NS', name: 'PARADEEP' },
{ symbol: 'PATANJALI.NS', name: 'PATANJALI' },
{ symbol: 'PERSISTENT.NS', name: 'PERSISTENT' },
{ symbol: 'PETRONET.NS', name: 'PETRONET' },
{ symbol: 'PFIZER.NS', name: 'PFIZER' },
{ symbol: 'PHOENIXLTD.NS', name: 'PHOENIXLTD' },
{ symbol: 'PWL.NS', name: 'PWL' },
{ symbol: 'PIDILITIND.NS', name: 'PIDILITIND' },
{ symbol: 'PINELABS.NS', name: 'PINELABS' },
{ symbol: 'PIRAMALFIN.NS', name: 'PIRAMALFIN' },
{ symbol: 'PPLPHARMA.NS', name: 'PPLPHARMA' },
{ symbol: 'POLYMED.NS', name: 'POLYMED' },
{ symbol: 'POLYCAB.NS', name: 'POLYCAB' },
{ symbol: 'POONAWALLA.NS', name: 'POONAWALLA' },
{ symbol: 'PFC.NS', name: 'PFC' },
{ symbol: 'POWERGRID.NS', name: 'POWERGRID' },
{ symbol: 'PREMIERENE.NS', name: 'PREMIERENE' },
{ symbol: 'PRESTIGE.NS', name: 'PRESTIGE' },
{ symbol: 'PFOCUS.NS', name: 'PFOCUS' },
{ symbol: 'PNB.NS', name: 'PNB' },
{ symbol: 'RRKABEL.NS', name: 'RRKABEL' },
{ symbol: 'RBLBANK.NS', name: 'RBLBANK' },
{ symbol: 'RECLTD.NS', name: 'RECLTD' },
{ symbol: 'RHIM.NS', name: 'RHIM' },
{ symbol: 'RITES.NS', name: 'RITES' },
{ symbol: 'RADICO.NS', name: 'RADICO' },
{ symbol: 'RVNL.NS', name: 'RVNL' },
{ symbol: 'RAILTEL.NS', name: 'RAILTEL' },
{ symbol: 'RAINBOW.NS', name: 'RAINBOW' },
{ symbol: 'RKFORGE.NS', name: 'RKFORGE' },
{ symbol: 'REDINGTON.NS', name: 'REDINGTON' },
{ symbol: 'RELIANCE.NS', name: 'RELIANCE' },
{ symbol: 'RPOWER.NS', name: 'RPOWER' },
{ symbol: 'SBFC.NS', name: 'SBFC' },
{ symbol: 'SBICARD.NS', name: 'SBICARD' },
{ symbol: 'SBILIFE.NS', name: 'SBILIFE' },
{ symbol: 'SJVN.NS', name: 'SJVN' },
{ symbol: 'SRF.NS', name: 'SRF' },
{ symbol: 'SAGILITY.NS', name: 'SAGILITY' },
{ symbol: 'SAILIFE.NS', name: 'SAILIFE' },
{ symbol: 'SAMMAANCAP.NS', name: 'SAMMAANCAP' },
{ symbol: 'MOTHERSON.NS', name: 'MOTHERSON' },
{ symbol: 'SAPPHIRE.NS', name: 'SAPPHIRE' },
{ symbol: 'SARDAEN.NS', name: 'SARDAEN' },
{ symbol: 'SAREGAMA.NS', name: 'SAREGAMA' },
{ symbol: 'SCHAEFFLER.NS', name: 'SCHAEFFLER' },
{ symbol: 'SCHNEIDER.NS', name: 'SCHNEIDER' },
{ symbol: 'SCI.NS', name: 'SCI' },
{ symbol: 'SHREECEM.NS', name: 'SHREECEM' },
{ symbol: 'SHRIRAMFIN.NS', name: 'SHRIRAMFIN' },
{ symbol: 'SHYAMMETL.NS', name: 'SHYAMMETL' },
{ symbol: 'ENRIN.NS', name: 'ENRIN' },
{ symbol: 'SIEMENS.NS', name: 'SIEMENS' },
{ symbol: 'SIGNATURE.NS', name: 'SIGNATURE' },
{ symbol: 'SOBHA.NS', name: 'SOBHA' },
{ symbol: 'SOLARINDS.NS', name: 'SOLARINDS' },
{ symbol: 'SONACOMS.NS', name: 'SONACOMS' },
{ symbol: 'SONATSOFTW.NS', name: 'SONATSOFTW' },
{ symbol: 'STARHEALTH.NS', name: 'STARHEALTH' },
{ symbol: 'SBIN.NS', name: 'SBIN' },
{ symbol: 'SAIL.NS', name: 'SAIL' },
{ symbol: 'SUMICHEM.NS', name: 'SUMICHEM' },
{ symbol: 'SUNPHARMA.NS', name: 'SUNPHARMA' },
{ symbol: 'SUNTV.NS', name: 'SUNTV' },
{ symbol: 'SUNDARMFIN.NS', name: 'SUNDARMFIN' },
{ symbol: 'SUPREMEIND.NS', name: 'SUPREMEIND' },
{ symbol: 'SPLPETRO.NS', name: 'SPLPETRO' },
{ symbol: 'SUZLON.NS', name: 'SUZLON' },
{ symbol: 'SWANCORP.NS', name: 'SWANCORP' },
{ symbol: 'SWIGGY.NS', name: 'SWIGGY' },
{ symbol: 'SYNGENE.NS', name: 'SYNGENE' },
{ symbol: 'SYRMA.NS', name: 'SYRMA' },
{ symbol: 'TBOTEK.NS', name: 'TBOTEK' },
{ symbol: 'TVSMOTOR.NS', name: 'TVSMOTOR' },
{ symbol: 'TATACAP.NS', name: 'TATACAP' },
{ symbol: 'TATACHEM.NS', name: 'TATACHEM' },
{ symbol: 'TATACOMM.NS', name: 'TATACOMM' },
{ symbol: 'TCS.NS', name: 'TCS' },
{ symbol: 'TATACONSUM.NS', name: 'TATACONSUM' },
{ symbol: 'TATAELXSI.NS', name: 'TATAELXSI' },
{ symbol: 'TATAINVEST.NS', name: 'TATAINVEST' },
{ symbol: 'TMCV.NS', name: 'TMCV' },
{ symbol: 'TMPV.NS', name: 'TMPV' },
{ symbol: 'TATAPOWER.NS', name: 'TATAPOWER' },
{ symbol: 'TATASTEEL.NS', name: 'TATASTEEL' },
{ symbol: 'TATATECH.NS', name: 'TATATECH' },
{ symbol: 'TTML.NS', name: 'TTML' },
{ symbol: 'TECHM.NS', name: 'TECHM' },
{ symbol: 'TECHNOE.NS', name: 'TECHNOE' },
{ symbol: 'TEGA.NS', name: 'TEGA' },
{ symbol: 'TEJASNET.NS', name: 'TEJASNET' },
{ symbol: 'TENNIND.NS', name: 'TENNIND' },
{ symbol: 'NIACL.NS', name: 'NIACL' },
{ symbol: 'RAMCOCEM.NS', name: 'RAMCOCEM' },
{ symbol: 'THERMAX.NS', name: 'THERMAX' },
{ symbol: 'TIMKEN.NS', name: 'TIMKEN' },
{ symbol: 'TITAGARH.NS', name: 'TITAGARH' },
{ symbol: 'TITAN.NS', name: 'TITAN' },
{ symbol: 'TORNTPHARM.NS', name: 'TORNTPHARM' },
{ symbol: 'TORNTPOWER.NS', name: 'TORNTPOWER' },
{ symbol: 'TARIL.NS', name: 'TARIL' },
{ symbol: 'TRAVELFOOD.NS', name: 'TRAVELFOOD' },
{ symbol: 'TRENT.NS', name: 'TRENT' },
{ symbol: 'TRIDENT.NS', name: 'TRIDENT' },
{ symbol: 'TRITURBINE.NS', name: 'TRITURBINE' },
{ symbol: 'TIINDIA.NS', name: 'TIINDIA' },
{ symbol: 'UCOBANK.NS', name: 'UCOBANK' },
{ symbol: 'UNOMINDA.NS', name: 'UNOMINDA' },
{ symbol: 'UPL.NS', name: 'UPL' },
{ symbol: 'UTIAMC.NS', name: 'UTIAMC' },
{ symbol: 'ULTRACEMCO.NS', name: 'ULTRACEMCO' },
{ symbol: 'UNIONBANK.NS', name: 'UNIONBANK' },
{ symbol: 'UBL.NS', name: 'UBL' },
{ symbol: 'UNITDSPR.NS', name: 'UNITDSPR' },
{ symbol: 'URBANCO.NS', name: 'URBANCO' },
{ symbol: 'USHAMART.NS', name: 'USHAMART' },
{ symbol: 'VTL.NS', name: 'VTL' },
{ symbol: 'VBL.NS', name: 'VBL' },
{ symbol: 'VEDL.NS', name: 'VEDL' },
{ symbol: 'VIJAYA.NS', name: 'VIJAYA' },
{ symbol: 'VMM.NS', name: 'VMM' },
{ symbol: 'IDEA.NS', name: 'IDEA' },
{ symbol: 'VOLTAS.NS', name: 'VOLTAS' },
{ symbol: 'WAAREEENER.NS', name: 'WAAREEENER' },
{ symbol: 'WELCORP.NS', name: 'WELCORP' },
{ symbol: 'WELSPUNLIV.NS', name: 'WELSPUNLIV' },
{ symbol: 'WHIRLPOOL.NS', name: 'WHIRLPOOL' },
{ symbol: 'WIPRO.NS', name: 'WIPRO' },
{ symbol: 'WOCKPHARMA.NS', name: 'WOCKPHARMA' },
{ symbol: 'YESBANK.NS', name: 'YESBANK' },
{ symbol: 'ZFCVINDIA.NS', name: 'ZFCVINDIA' },
{ symbol: 'ZEEL.NS', name: 'ZEEL' },
{ symbol: 'ZENTEC.NS', name: 'ZENTEC' },
{ symbol: 'ZENSARTECH.NS', name: 'ZENSARTECH' },
{ symbol: 'ZYDUSLIFE.NS', name: 'ZYDUSLIFE' },
{ symbol: 'ZYDUSWELL.NS', name: 'ZYDUSWELL' },
{ symbol: 'ECLERX.NS', name: 'ECLERX' }
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
