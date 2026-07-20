const { GoogleGenerativeAI } = require('@google/generative-ai');
const newsService = require('./newsService');
const technicalService = require('./technicalService');
const advancedDataService = require('./advancedDataService');

// Initialize Gemini using the correct standard SDK
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const AI_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-pro-latest'
];

async function generateWithFallback(prompt) {
    let lastError;
    for (let i = 0; i < AI_MODELS.length; i++) {
        const modelName = AI_MODELS[i];
        try {
            const model = ai.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            console.log(`[AI] Success with model: ${modelName}`);
            return result;
        } catch (error) {
            console.warn(`[AI Fallback] Model ${modelName} failed: ${error.message}. Trying next...`);
            lastError = error;
            // Wait 1s before trying next model (helps with rate limits)
            if (i < AI_MODELS.length - 1) await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw new Error(`All AI models failed. Last error: ${lastError.message}`);
}

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

STRICT SELL/HOLD RULES (Very Important — Do NOT blindly say SELL on every stock):
- CHECK 'profitPercent' for each stock before recommending action.
- SELL if: profitPercent is >= +3% (lock in profits immediately, don't be greedy).
- SELL if: profitPercent is <= -5% (stop-loss triggered, cut the loss before it gets worse).
- SELL if: daysHeld >= timeLimit AND profitPercent >= 0 (time is up and we are not losing, so exit cleanly).
- HOLD if: daysHeld < timeLimit AND profitPercent is between -5% and +3% (still within time window, wait for recovery).
- HOLD if: daysHeld >= timeLimit AND profitPercent is between -5% and 0% (time expired but selling now locks in a loss — HOLD and wait 1 more day for slight recovery unless news is very bad).
- NEVER recommend SELL just because the time limit expired if the stock is at a loss. That is bad advice for a beginner.

You must output exactly ONE recommendation per stock in the portfolio, formatting your response strictly as a JSON array of objects:

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

        const response = await generateWithFallback(prompt);

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

        const optionsSentiment = advancedMetrics.optionsData.sentiment || '';
        const optionsNote = optionsSentiment.includes('No Options Data') || optionsSentiment.includes('Unavailable')
            ? 'OPTIONS DATA: Not available for this Indian NSE stock. Treat as NEUTRAL — do NOT penalize for missing data.'
            : `Put/Call Ratio: ${advancedMetrics.optionsData.putCallRatio} (${optionsSentiment})`;

        const hypeLevel = advancedMetrics.socialSentiment.hypeLevel;
        const hypeNote = (hypeLevel === 'Unknown' || hypeLevel === 'LOW')
            ? 'SOCIAL HYPE: Low Reddit activity is NORMAL for Indian stocks. Do NOT treat this as bearish.'
            : `Social Hype Level: ${hypeLevel}`;

        const prompt = `
You are a senior portfolio manager at a top-tier hedge fund in India. You have 20 years of trading experience.
You specialise in INDIAN NSE stocks and understand their market structure.

Stock: ${symbol} | Current Price: ₹${currentPrice || 'Unknown'}
Current time in India: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚠️ IMPORTANT RULE FOR INDIAN STOCKS:
- Many Indian NSE stocks do NOT have options data or Reddit discussion. This is NORMAL.
- Treat any 'N/A' or 'Unavailable' data as NEUTRAL — never as BEARISH.
- Base your decision on the signals that DO have real data.

=== SIGNAL CHECKLIST ===

[SIGNAL 1] PRICE & TREND:
- Current Price: ₹${currentPrice || 'Unknown'}
- Is the price near support (good to BUY) or resistance (risky to BUY)?

[SIGNAL 2] TECHNICAL INDICATORS:
- RSI (14-day): ${technicals ? technicals.rsi : 'Unknown'}
  Rule: RSI < 40 = Oversold = BUY signal. RSI > 68 = Overbought = Caution.
- MACD: ${technicals ? technicals.macd : 'Unknown'}
  Rule: MACD positive/crossing above = Bullish. Negative = Bearish.

[SIGNAL 3] INSTITUTIONAL MONEY:
- ${optionsNote}
  Rule: Only flag BEARISH if data explicitly shows Put/Call > 1.1.

[SIGNAL 4] NEWS SENTIMENT:
${news.length > 0 ? news.slice(0, 5).map(n => `- ${n.title}`).join('\n') : 'No recent news available.'}
  Rule: Positive news + technical confirmation = strong BUY signal.

[SIGNAL 5] FUNDAMENTALS:
- Revenue Growth: ${advancedMetrics.earningsData.revenueGrowth || 'N/A'}
- Profit Margin: ${advancedMetrics.earningsData.profitMargin || 'N/A'}
- Analyst Rating: ${advancedMetrics.earningsData.recommendationKey || 'N/A'}
- Institutional Holding: ${advancedMetrics.earningsData.heldByInstitutions || 'N/A'}
  Rule: If data is N/A, treat as NEUTRAL. Only flag BEARISH if data is explicitly negative.

[SIGNAL 6] SOCIAL HYPE:
- ${hypeNote}

=== DECISION RULES ===
- Count ONLY signals that have REAL data (not N/A or Unavailable).
- BUY if 2 or more AVAILABLE signals are BULLISH. Confidence >= 70.
- HOLD if signals are mixed or mostly neutral.
- SELL if 2 or more AVAILABLE signals are explicitly BEARISH.

For BUY: Calculate EXACT price targets:
- Target: Entry price + 4% to 6%
- Stop-Loss: Entry price - 2.5% to 4%

=== OUTPUT (Strict JSON only, no markdown) ===
{
  "action": "BUY",
  "confidence": 85,
  "bullishSignals": 4,
  "rationale": "<2 sentence expert explanation: what signals aligned, what risk exists>",
  "target": "₹XXX.XX",
  "stopLoss": "₹XXX.XX",
  "riskLevel": "LOW"
}
`;

        const response = await generateWithFallback(prompt);
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

const getGlobalTop5TradingTips = async (news, movers, budget = null, priceRange = null, niftyChange = null) => {
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

        // === MARKET-DIRECTION-AWARE STRATEGY ===
        let marketStrategyPrompt = '';
        if (niftyChange !== null) {
            if (niftyChange <= -0.5) {
                marketStrategyPrompt = `
=== TODAY'S MARKET STRATEGY: DIP BUYING ===
The Nifty 50 is DOWN ${Math.abs(niftyChange).toFixed(2)}% today. This is a DIP BUYING opportunity.
Your PRIMARY job is to find QUALITY stocks that dropped today ONLY because of overall market weakness — NOT because of any company-specific problem.
These stocks are temporarily cheap and historically bounce back 3-7% within 1-3 trading days.
Look specifically in: TOP NSE LOSERS list for stocks with STRONG fundamentals that fell today.
A stock falling -1% to -3% today when its fundamentals are strong = EXCELLENT buy setup.
DO NOT recommend stocks that fell due to bad earnings, scandals, or downgrades — those falls are permanent.`;
            } else if (niftyChange >= 0.3) {
                marketStrategyPrompt = `
=== TODAY'S MARKET STRATEGY: MOMENTUM BUYING ===
The Nifty 50 is UP +${niftyChange.toFixed(2)}% today. This is a MOMENTUM opportunity.
Your PRIMARY job is to find stocks that are breaking out above resistance levels with high volume.
Look specifically in: TOP NSE GAINERS list for stocks with strong momentum that can continue 4-7% more.
Avoid stocks that already jumped 5%+ today — the move may be over. Look for stocks up 1-3% that have more room to run.`;
            } else {
                marketStrategyPrompt = `
=== TODAY'S MARKET STRATEGY: SELECTIVE TRADING ===
The Nifty 50 is flat (${niftyChange >= 0 ? '+' : ''}${niftyChange.toFixed(2)}%) today. Market is sideways.
Be VERY selective. Only recommend stocks with CRYSTAL CLEAR setups (confidence >= 80).
Look for stocks with specific catalysts: earnings, news, sector rotation, or breakouts.`;
            }
        }

        const prompt = `
You are a SENIOR RISK COMMITTEE of 3 expert Indian stock traders at a top Mumbai-based fund.
Your job is to find the BEST 5 INDIAN NSE stocks for short-term swing trading today.
${marketStrategyPrompt}

⚠️ CRITICAL RULE - INDIAN STOCKS ONLY:
- You MUST ONLY recommend stocks listed on the INDIAN NSE exchange.
- Every symbol MUST end with .NS (e.g., RELIANCE.NS, WIPRO.NS, ZOMATO.NS).
- NEVER recommend US stocks, global stocks, or any symbol without .NS
- If a stock in the movers list does NOT have .NS, ignore it completely.
- Valid examples: TATAMOTORS.NS, HDFCBANK.NS, INFY.NS, BAJFINANCE.NS, NIFTY stocks.
- Invalid examples: AAPL, TSLA, NOG, TEAM, VE — these are US stocks, NEVER recommend them.

=== TODAY'S MARKET DATA ===
CURRENT TIME IN INDIA: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
(Ensure your tips and rationale are immediately actionable at THIS exact time. Do not just say 'Buy at 9:15 AM' if it is already the afternoon!)

LATEST INDIAN MARKET NEWS:
${news.slice(0, 8).map(n => `- ${n.title}`).join('\n')}

TOP NSE GAINERS TODAY:
${movers.gainers.slice(0, 6).map(g => `- ${g.symbol} (${g.name}): \u20b9${g.price} (+${g.changePercent}%)`).join('\n')}

TOP NSE LOSERS (Bounce-back candidates):
${movers.losers.slice(0, 6).map(l => `- ${l.symbol} (${l.name}): \u20b9${l.price} (${l.changePercent}%)`).join('\n')}

=== YOUR EXPERT DECISION RULES ===

For each candidate stock, verify ALL 4 gates:
GATE 1 - MOMENTUM: Clear reason for the stock to move today (news, sector strength, earnings)?
GATE 2 - TECHNICAL: RSI not above 68? Price not at resistance? Setup is safe to enter?
GATE 3 - RISK/REWARD: Target is at least 1.5x the stop-loss distance?
GATE 4 - TIMING: Is this the right time to enter right now, at the current time? Or has the move already happened?

ONLY recommend if it passes ALL 4 GATES. Skip and find a better one if it fails.

Pricing rules:
- Target = current price + 4% to 7%
- Stop-Loss = current price - 2.5% to 4%
- All prices in Indian Rupees (\u20b9)
${budgetPrompt}
${rangePrompt}

Return ONLY a valid JSON array of exactly 5 INDIAN NSE stocks. No markdown, no explanation.
[
  {
    "symbol": "TICKER.NS",
    "companyName": "Full Indian Company Name",
    "action": "BUY",
    "currentPrice": "\u20b9100.50",
    "duration": "2 Days",
    "target": "\u20b9106.00",
    "stopLoss": "\u20b996.00",
    "confidence": 85,
    "rationale": "2 sentences: Why this Indian stock now? What is the risk?",
    "gatesPassed": "Momentum \u2713 | Technical \u2713 | Risk/Reward \u2713 | Timing \u2713"${jsonFields}
  }
]
`;

        // Try to get a valid JSON response — retry with a simpler prompt if parsing fails
        let parsedResult = null;
        let lastRawText = '';
        let lastApiError = null;
        
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const usePrompt = attempt === 0 ? prompt : 
                    `Give exactly 5 Indian NSE stocks to BUY today as short-term swing trades. Return ONLY a valid JSON array. No markdown. Format EXACTLY like this:\n[{"symbol": "RELIANCE.NS", "companyName": "Reliance", "action": "BUY", "currentPrice": "₹2500.00", "duration": "2 Days", "target": "₹2600.00", "stopLoss": "₹2400.00", "confidence": 85, "rationale": "Strong breakout.", "gatesPassed": "Fallback ✓"}]`;
                
                const response = await generateWithFallback(usePrompt);
                let aiText = response.response.text();
                lastRawText = aiText;
                
                // Strip markdown code fences
                aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                const jsonStart = aiText.indexOf('[');
                const jsonEnd = aiText.lastIndexOf(']');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    aiText = aiText.substring(jsonStart, jsonEnd + 1);
                }
                
                parsedResult = JSON.parse(aiText);
                if (Array.isArray(parsedResult) && parsedResult.length > 0) break;
            } catch (parseErr) {
                console.warn(`[AI Top5] Attempt ${attempt + 1} failed: ${parseErr.message}. Raw: ${lastRawText.substring(0, 200)}`);
                if (parseErr.message.includes('All AI models failed')) {
                    lastApiError = parseErr.message;
                }
            }
        }
        
        if (!parsedResult || parsedResult.length === 0) {
            if (lastApiError) {
                throw new Error(`API_LIMIT_HIT: ${lastApiError}`);
            }
            throw new Error('AI returned invalid data after 2 attempts');
        }

        // — SAFETY FILTER: Remove any non-Indian (US) stocks the AI might have slipped in —
        const FALLBACK_INDIAN_STOCKS = [
            { symbol: 'RELIANCE.NS', companyName: 'Reliance Industries', action: 'BUY', currentPrice: '\u20b9N/A', duration: '2 Days', target: '\u20b9N/A', stopLoss: '\u20b9N/A', confidence: 70, rationale: 'Large-cap Indian stock used as safe fallback.', gatesPassed: 'Fallback' },
            { symbol: 'HDFCBANK.NS', companyName: 'HDFC Bank', action: 'BUY', currentPrice: '\u20b9N/A', duration: '2 Days', target: '\u20b9N/A', stopLoss: '\u20b9N/A', confidence: 70, rationale: 'Large-cap Indian bank used as safe fallback.', gatesPassed: 'Fallback' }
        ];
        let fallbackIndex = 0;
        parsedResult = parsedResult.map(stock => {
            const sym = (stock.symbol || '').toUpperCase();
            // Reject if symbol doesn't end with .NS or .BO (means it's a US/unknown stock)
            if (!sym.endsWith('.NS') && !sym.endsWith('.BO')) {
                console.warn(`[AI Filter] Rejected non-Indian stock: ${stock.symbol}. Replacing with fallback.`);
                const replacement = FALLBACK_INDIAN_STOCKS[fallbackIndex % FALLBACK_INDIAN_STOCKS.length];
                fallbackIndex++;
                return replacement;
            }
            return stock;
        });

        return parsedResult;
    } catch (error) {
        console.error('Error in getGlobalTop5TradingTips:', error.message);
        if (error.message.includes('API_LIMIT_HIT')) {
            return { error: true, reason: 'RATE_LIMIT', message: error.message };
        }
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

        const response = await generateWithFallback(prompt);

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

const getBacktestAISuggestion = async (symbol, days, profitPercent, totalTrades, holdingStatus, technicals) => {
    try {
        let techMsg = "";
        if (technicals && technicals.RSI && technicals.MACD) {
            const macdValue = technicals.MACD.MACD || 0;
            techMsg = `Right now, the real-time technical indicators for this stock are: RSI=${technicals.RSI.toFixed(2)}, MACD=${macdValue.toFixed(2)} (Bullish if > 0, Bearish if < 0).`;
        } else {
            techMsg = `Current real-time technical indicators are temporarily unavailable.`;
        }

        const prompt = `You are a strict, ultra-clear AI Trading Mentor for a beginner trader.
The user just ran a Technical Analysis Backtest for ${symbol}. The strategy returned ${profitPercent}% from ${totalTrades} trades.

PORTFOLIO STATUS: ${holdingStatus}
REAL-TIME TECHNICALS: ${techMsg}

You MUST respond using EXACTLY this structured format, nothing else (no introductory paragraphs):

**Backtest Result:** [1 brief sentence evaluating the ${profitPercent}% return]
**Portfolio Status:** ${holdingStatus.split(' (')[0]} [If they own it, mention the Days Held in parentheses]
**Current Action:** [BUY NOW, SELL NOW, or HOLD]
**Reason:** [1 very simple beginner-friendly sentence explaining the RSI/MACD reason and Time-Stop if days held >= 5]`;

        const response = await generateWithFallback(prompt);
        return response.response.text().trim();
    } catch (error) {
        console.error('Error generating AI backtest suggestion:', error.message);
        return "Keep experimenting with different timeframes and stocks to find the best strategy!";
    }
};

module.exports = { 
    analyzePortfolio, 
    getStockAnalysis, 
    getTop10Recommendations, 
    getBacktestAISuggestion,
    getGlobalTop5TradingTips
};
