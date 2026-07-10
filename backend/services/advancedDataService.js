const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * FEATURE 1: Institutional Smart Money Tracker (Options Put/Call Ratio)
 * Gets the options chain for the stock and calculates if whales are betting on it going up (Calls) or down (Puts).
 */
const getOptionsSentiment = async (symbol) => {
    try {
        // Many Indian stocks don't have Yahoo options data, so we wrap in try-catch and return Neutral if missing
        const options = await yahooFinance.options(symbol);
        if (!options || !options.options || options.options.length === 0) {
            return { putCallRatio: 1, sentiment: "NEUTRAL (No Options Data)" };
        }

        const latestExpiration = options.options[0];
        let totalCallVolume = 0;
        let totalPutVolume = 0;

        latestExpiration.calls.forEach(call => totalCallVolume += (call.volume || 0));
        latestExpiration.puts.forEach(put => totalPutVolume += (put.volume || 0));

        // Avoid division by zero
        if (totalCallVolume === 0) totalCallVolume = 1; 

        const putCallRatio = totalPutVolume / totalCallVolume;
        
        let sentiment = "NEUTRAL";
        if (putCallRatio < 0.7) sentiment = "BULLISH (Whales are buying Calls)";
        if (putCallRatio > 1.0) sentiment = "BEARISH (Whales are buying Puts)";

        return {
            putCallRatio: putCallRatio.toFixed(2),
            totalCallVolume,
            totalPutVolume,
            sentiment
        };
    } catch (err) {
        console.error(`Options fetch failed for ${symbol}:`, err.message);
        return { putCallRatio: null, sentiment: "NEUTRAL (Data Unavailable)" };
    }
};

/**
 * FEATURE 2: Social Media Viral Scanner (Reddit)
 * Scrapes Reddit for recent posts about this stock ticker to gauge retail hype.
 */
const getSocialSentiment = async (symbol) => {
    try {
        const cleanSymbol = symbol.replace('.NS', '').replace('.BO', '');
        // We use native fetch to hit Reddit's free JSON API
        const response = await fetch(`https://www.reddit.com/search.json?q=${cleanSymbol}+stock&sort=new&limit=5`);
        if (!response.ok) return { hypeLevel: "Unknown", posts: [] };
        
        const data = await response.json();
        const posts = data.data.children.map(child => child.data.title);
        
        let hypeLevel = "LOW";
        if (posts.length >= 5) hypeLevel = "HIGH (Going Viral on Reddit)";
        else if (posts.length > 2) hypeLevel = "MODERATE";

        return {
            hypeLevel,
            recentPosts: posts
        };
    } catch (err) {
        console.error(`Social fetch failed for ${symbol}:`, err.message);
        return { hypeLevel: "Unknown", posts: [] };
    }
};

/**
 * FEATURE 3: Financial Earnings & Fundamentals
 * Gets the latest revenue growth, profit margins, and earnings data.
 */
const getEarningsData = async (symbol) => {
    try {
        const result = await yahooFinance.quoteSummary(symbol, { modules: ['financialData', 'defaultKeyStatistics'] });
        const financials = result.financialData || {};
        const stats = result.defaultKeyStatistics || {};

        return {
            currentPrice: financials.currentPrice || 'N/A',
            revenueGrowth: financials.revenueGrowth ? (financials.revenueGrowth * 100).toFixed(2) + '%' : 'N/A',
            profitMargin: financials.profitMargins ? (financials.profitMargins * 100).toFixed(2) + '%' : 'N/A',
            heldByInstitutions: stats.heldPercentInstitutions ? (stats.heldPercentInstitutions * 100).toFixed(2) + '%' : 'N/A',
            recommendationKey: financials.recommendationKey || 'N/A' // e.g. "strong_buy"
        };
    } catch (err) {
        console.error(`Earnings fetch failed for ${symbol}:`, err.message);
        return { error: "Earnings data unavailable" };
    }
};

/**
 * Aggregates all Advanced Data into one payload
 */
const getAdvancedMetrics = async (symbol) => {
    console.log(`[ADVANCED MODULE] Fetching Options, Social, and Earnings data for ${symbol}...`);
    
    const [options, social, earnings] = await Promise.all([
        getOptionsSentiment(symbol),
        getSocialSentiment(symbol),
        getEarningsData(symbol)
    ]);

    return {
        optionsData: options,
        socialSentiment: social,
        earningsData: earnings
    };
};

module.exports = {
    getAdvancedMetrics
};
