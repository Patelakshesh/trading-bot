const { GoogleGenerativeAI } = require('@google/generative-ai');
const newsService = require('./newsService');
const technicalService = require('./technicalService');
const advancedDataService = require('./advancedDataService');

// Initialize Gemini using the correct standard SDK
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const analyzePortfolio = async (portfolio, watchlist, news, currentPrices, technicalData, advancedData) => {
    try {
        const prompt = `You are an elite, highly intelligent algorithmic Short-Term Swing Trader. 
You combine Fundamental Analysis (Global News) with Technical Analysis (Fast RSI, MACD) to achieve incredibly high win rates on 1-to-7 day trades.

I own the following stocks in my PORTFOLIO:
${JSON.stringify(portfolio, null, 2)}

I am also monitoring these stocks in my WATCHLIST:
${JSON.stringify(watchlist, null, 2)}

Here are the current market prices for these stocks:
${JSON.stringify(currentPrices, null, 2)}

Here are the Technical Indicators (RSI, MACD) calculated for each stock today:
${JSON.stringify(technicalData, null, 2)}
(Note: RSI > 70 is overbought/sell, RSI < 30 is oversold/buy. MACD positive is bullish).

Here is the Advanced Wall Street Data (Options Put/Call Ratio, Reddit Virality, and Fundamentals) for each stock:
${JSON.stringify(advancedData, null, 2)}

Here is today's combined global breaking news:
${JSON.stringify(news, null, 2)}

CRITICAL INSTRUCTION: You must enforce the "Double-Check Algorithm" for SHORT-TERM TRADING.
1. The global news MUST align with the stock.
2. The Mathematical Technical Indicators (RSI/MACD) MUST also align. 
3. The Advanced Data (Options/Reddit) MUST confirm the move. If Options are heavily Bearish (Put/Call > 1.2), DO NOT BUY.
If the news is great, but the RSI is > 65 (overbought), DO NOT recommend a BUY. Wait for a pullback.
If a stock is going viral on Reddit but Fundamentals (Revenue/Profit) are crashing, warn the user it is a bubble.

STRICT TIME-STOP RULES:
- You MUST calculate how many days we have held the stock based on its purchase date.
- MAX HOLD TIME IS 1 WEEK (5 trading days). If we have held a stock for 5 days or more, you MUST recommend a SELL immediately, regardless of profit or loss, to free up capital.
- QUICK PROFITS: If we have held the stock for only 1 or 2 days and it has reached a +3% to +5% profit, you MUST recommend an instant SELL to lock in the money. Do not be greedy. Cut losses immediately if the setup breaks.

Based on these global events and mathematical indicators, tell me exactly what I should BUY, SELL, or HOLD today for a 1-to-7 day swing trade.
Respond in a strict JSON format exactly like this array:
[
  {
    "symbol": "TATAMOTORS.NS",
    "action": "SELL",
    "reasoning": "News shows chip shortage + RSI is 75 (Overbought), indicating a crash is imminent."
  }
]
Only return valid JSON array without markdown formatting.`;

        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const response = await model.generateContent(prompt);

        let aiText = response.response.text();
        
        // Remove markdown formatting if Gemini adds it
        // Remove markdown formatting robustly
        aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();

        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error generating AI analysis:', error);
        return [];
    }
};

const getStockAnalysis = async (symbol, news, technicals) => {
    try {
        const advancedMetrics = await advancedDataService.getAdvancedMetrics(symbol);

        const prompt = `
You are an elite quantitative hedge fund AI advisor.
Analyze the following multi-dimensional data for stock symbol: ${symbol}

[1] BREAKING NEWS SENTIMENT:
${news.length > 0 ? news.map(n => `- ${n.title}`).join('\n') : "No recent news."}

[2] TECHNICAL ANALYSIS (MATH):
- Current RSI (14-day): ${technicals ? technicals.rsi : 'Unknown'}
- MACD Signal: ${technicals ? technicals.macd : 'Unknown'}

[3] INSTITUTIONAL SMART MONEY (OPTIONS):
- Put/Call Ratio: ${advancedMetrics.optionsData.putCallRatio} (${advancedMetrics.optionsData.sentiment})

[4] SOCIAL MEDIA VIRALITY (REDDIT/X):
- Hype Level: ${advancedMetrics.socialSentiment.hypeLevel}
- Recent Viral Posts: ${advancedMetrics.socialSentiment.recentPosts.length > 0 ? advancedMetrics.socialSentiment.recentPosts.join(' | ') : 'None'}

[5] FUNDAMENTALS & EARNINGS:
- Wall Street Recommendation: ${advancedMetrics.earningsData.recommendationKey}
- Revenue Growth: ${advancedMetrics.earningsData.revenueGrowth}
- Profit Margin: ${advancedMetrics.earningsData.profitMargin}
- Held by Institutions: ${advancedMetrics.earningsData.heldByInstitutions}

CRITICAL INSTRUCTIONS:
1. You must cross-reference ALL 5 dimensions. Do not rely solely on news.
2. If Technical RSI is > 70 (Overbought) AND Options sentiment is Bearish, you MUST NOT issue a BUY signal, even if news is good.
3. If the stock is going viral on Social Media but Fundamentals are terrible (negative profit margin), warn the user it is a "Meme Stock Bubble".
4. Determine if this is a BUY, SELL, or HOLD.
5. Provide a short 2-sentence rationale explaining the alignment of Math, News, and Smart Money.

Return your response in STRICT JSON format:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-100>,
  "rationale": "<your combined explanation>"
}
`;
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const response = await model.generateContent(prompt);
        let aiText = response.response.text();
        aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error in getStockAnalysis:', error);
        return null;
    }
};

const getTop10Recommendations = async (news) => {
    try {
        let prompt = "";
        
        if (news && news.length > 0) {
            prompt = `You are an elite AI Trading Assistant. Based on the following global breaking news:
${JSON.stringify(news, null, 2)}

Identify exactly 10 publicly traded stocks (use valid ticker symbols, prioritize large/mid-cap Indian .NS or global stocks) that are highly likely to be impacted (either positively or negatively) by this news today.
I want to add these to my Watchlist to monitor them.

Respond in a strict JSON format exactly like this array:
[
  {
    "symbol": "ZOMATO.NS",
    "name": "Zomato Ltd",
    "reason": "Short reason linking it to the news."
  }
]
Only return valid JSON array without markdown formatting.`;
        } else {
            prompt = `You are an elite AI Trading Assistant.
Identify exactly 10 publicly traded stocks (use valid ticker symbols, prioritize large/mid-cap Indian .NS stocks) that are currently experiencing high market volatility, strong momentum, or interesting technical setups right now.
I want to add these to my Watchlist to monitor them.

Respond in a strict JSON format exactly like this array:
[
  {
    "symbol": "ZOMATO.NS",
    "name": "Zomato Ltd",
    "reason": "Short reason explaining why this stock is a good technical or momentum watch."
  }
]
Only return valid JSON array without markdown formatting.`;
        }

        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const response = await model.generateContent(prompt);

        let aiText = response.response.text();
        aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error generating AI top 10:', error);
        return [];
    }
};

module.exports = { analyzePortfolio, getStockAnalysis, getTop10Recommendations };
