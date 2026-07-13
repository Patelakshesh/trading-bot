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

        const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const response = await model.generateContent(prompt);

        let aiText = response.response.text();
        
        // Bulletproof JSON parsing
        const jsonStart = aiText.indexOf('[');
        const jsonEnd = aiText.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            aiText = aiText.substring(jsonStart, jsonEnd + 1);
        } else {
            aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        }

        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error generating AI analysis:', error.message);
        return [];
    }
};

const getStockAnalysis = async (symbol, news, technicals, currentPrice) => {
    try {
        const advancedMetrics = await advancedDataService.getAdvancedMetrics(symbol);

        const prompt = `
You are an elite quantitative hedge fund AI advisor.
Analyze the following multi-dimensional data for stock symbol: ${symbol}

[0] LIVE MARKET PRICE:
- Current Real-Time Price: ₹${currentPrice || 'Unknown'}

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
6. The user is a standard cash investor. If you recommend BUY, calculate EXACT mathematical price values in Rupees (e.g. "₹105.50") for a short-term 'target' and 'stopLoss' based strictly on the Current Real-Time Price (₹${currentPrice || 'Unknown'}). DO NOT just output percentages.

Return your response in STRICT JSON format:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-100>,
  "rationale": "<your combined explanation>",
  "target": "₹XXX.XX" (or null if not buying),
  "stopLoss": "₹XXX.XX" (or null if not buying)
}
`;
        const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const response = await model.generateContent(prompt);
        let aiText = response.response.text();
        
        // Bulletproof JSON parsing for Object
        const jsonStart = aiText.indexOf('{');
        const jsonEnd = aiText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            aiText = aiText.substring(jsonStart, jsonEnd + 1);
        } else {
            aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        }
        
        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error in getStockAnalysis:', error.message);
        return null;
    }
};

const getGlobalTop5TradingTips = async (news, movers, budget = null, priceRange = null) => {
    try {
        let budgetPrompt = "";
        let jsonFields = "";
        if (budget) {
            budgetPrompt = `The user has a total investment budget of ₹${budget}. You MUST strategically allocate this budget across the 5 chosen stocks. Calculate EXACTLY how many shares the user should buy for each stock, and how much of the budget is allocated to it. Ensure the total allocated funds equal approximately ₹${budget}.`;
            jsonFields = `\n    "allocatedFunds": "₹XX,XXX",\n    "sharesToBuy": 150`;
        }
        
        let rangePrompt = "";
        if (priceRange) {
            rangePrompt = `CRITICAL: The user has specifically requested stocks priced strictly between ₹${priceRange.min} and ₹${priceRange.max}. You MUST ONLY recommend stocks that currently trade within this exact price range. If the provided movers do not fit this range, you must use your elite quantitative knowledge to recommend 5 other highly explosive stocks (e.g., penny stocks or mid-caps) that fit this price bracket. You must estimate and provide their current price in the JSON.`;
        }
        
        // Always require the AI to provide its estimated current price for the UI
        jsonFields += `,\n    "currentPrice": "₹XXX.XX"`;

        const prompt = `
You are an elite quantitative hedge fund manager with a verified 98% success rate in short-term swing trading.
I am providing you with the latest breaking market news and today's top market gainers and losers.

LATEST NEWS:
${news.slice(0, 5).map(n => `- ${n.title}`).join('\n')}

TOP GAINERS TODAY (Includes Live Prices):
${movers.gainers.map(g => `- ${g.symbol} (${g.name}): ₹${g.price} (+${g.changePercent}%)`).join('\n')}

TOP LOSERS TODAY (Includes Live Prices):
${movers.losers.map(l => `- ${l.symbol} (${l.name}): ₹${l.price} (${l.changePercent}%)`).join('\n')}

CRITICAL INSTRUCTIONS:
1. Analyze the news and movers to pick the ABSOLUTE BEST TOP 5 STOCKS to trade right now.
2. For each stock, you MUST provide a strict short-term trading plan (e.g., "Hold for 1 Day", "Hold for 3 Days").
3. You must provide clear entry and exit targets.
4. Guarantee maximum high-conviction logic.
5. The user is a standard cash investor. You MUST ONLY recommend "BUY" setups. NEVER recommend "SELL SHORT". If a stock is a Top Loser today but you expect a strong reversal bounce, recommend it as a "BUY".
6. For target and stopLoss, provide EXACT mathematical price values in Rupees (e.g., "₹105.50"). Calculate this based on the stock's current price. DO NOT just output percentages.
${budgetPrompt}
${rangePrompt}

Return ONLY a JSON array of exactly 5 objects. Do NOT use markdown code blocks like \`\`\`json.
[
  {
    "symbol": "TICKER.NS",
    "companyName": "Full Company Name Ltd",
    "action": "BUY",
    "duration": "1 Day" | "2 Days" | "3 Days",
    "rationale": "Short highly persuasive 1-sentence reason",
    "target": "₹XXX.XX",
    "stopLoss": "₹XXX.XX"${jsonFields}
  }
]
`;
        const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const response = await model.generateContent(prompt);
        let aiText = response.response.text();
        
        const jsonStart = aiText.indexOf('[');
        const jsonEnd = aiText.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            aiText = aiText.substring(jsonStart, jsonEnd + 1);
        } else {
            aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        }
        
        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error in getGlobalTop5TradingTips:', error.message);
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

        const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const response = await model.generateContent(prompt);

        let aiText = response.response.text();
        
        // Bulletproof JSON parsing for Array
        const jsonStart = aiText.indexOf('[');
        const jsonEnd = aiText.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            aiText = aiText.substring(jsonStart, jsonEnd + 1);
        } else {
            aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        }
        
        return JSON.parse(aiText);
    } catch (error) {
        console.error('Error generating AI top 10:', error.message);
        return [];
    }
};

const getBacktestAISuggestion = async (symbol, days, profitPercent, totalTrades) => {
    try {
        const prompt = `You are a friendly, encouraging AI Trading Mentor for a beginner trader.
The user just ran a Technical Analysis Backtest (simulated trading) for the stock ${symbol} over the last ${days} days.
The strategy executed ${totalTrades} trades and resulted in a total return of ${profitPercent}%.

Analyze this result specifically for a beginner. 
- If the timeframe (${days} days) is very short (like 1, 3, or 7 days) and there are 0 trades, explain to the beginner that technical indicators (like RSI) need at least 14 days of data to even start generating signals, so short timeframes often result in 0 trades.
- If it's a longer timeframe and made profit, congratulate them and explain why this is a good sign.
- If it lost money, warn them clearly.

Provide a 2-3 sentence beginner-friendly suggestion.
Respond with plain text only, no JSON.`;

        const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const response = await model.generateContent(prompt);
        return response.response.text().trim();
    } catch (error) {
        console.error('Error generating AI backtest suggestion:', error.message);
        return null;
    }
};

module.exports = { 
    analyzePortfolio, 
    getStockAnalysis, 
    getTop10Recommendations, 
    getBacktestAISuggestion,
    getGlobalTop5TradingTips
};
