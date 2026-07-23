const express = require('express');
const router = express.Router();
const Portfolio = require('../models/Portfolio');
const AnalysisLog = require('../models/AnalysisLog');
const Watchlist = require('../models/Watchlist');
const { getLatestNews } = require('../services/newsService');
const { getStockPrice } = require('../services/stockService');
const { getTop10Recommendations } = require('../services/aiService');
const { runBacktest } = require('../services/technicalService');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const authMiddleware = require('../middleware/auth');

// Admin Login Route
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '1d' });
        res.json({ success: true, token });
    } catch (err) {
        console.error("Login error", err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Apply auth middleware to all routes below this line
router.use(authMiddleware);

// Get all portfolio holdings
router.get('/portfolio', async (req, res) => {
    try {
        const holdings = await Portfolio.find({ status: 'HOLDING' }).sort({ createdAt: -1 });
        
        // AUTO-HEAL DATABASE: Fix any malformed symbols instantly
        for (const item of holdings) {
            if (!item.symbol.endsWith('.NS') && !item.symbol.endsWith('.BO')) {
                item.symbol = item.symbol + '.NS';
                await item.save();
                console.log(`[Auto-Heal] Fixed malformed symbol to ${item.symbol}`);
            }
        }
        
        // Fetch current live prices for the dashboard
        const portfolioWithPrices = await Promise.all(holdings.map(async (item) => {
            const currentPrice = await getStockPrice(item.symbol);
            return {
                ...item.toObject(),
                currentPrice
            };
        }));

        res.json(portfolioWithPrices);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching portfolio' });
    }
});

// Get portfolio history (realized gains/losses)
router.get('/portfolio/history', async (req, res) => {
    try {
        const history = await Portfolio.find({ status: 'SOLD' }).sort({ createdAt: -1 });
        
        // AUTO-HEAL DATABASE: Fix any malformed symbols instantly
        for (const item of history) {
            if (!item.symbol.endsWith('.NS') && !item.symbol.endsWith('.BO')) {
                item.symbol = item.symbol + '.NS';
                await item.save();
            }
        }
        
        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching history' });
    }
});

// Get Latest Trending News
router.get('/news', async (req, res) => {
    try {
        const news = await getLatestNews();
        res.json(news);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching news' });
    }
});

// Add new stock to portfolio via UI
router.post('/portfolio', async (req, res) => {
    try {
        const { symbol, buyPrice, quantity } = req.body;
        const { searchSymbol } = require('../services/stockService');
        const rawSymbol = symbol.trim().toUpperCase().replace(/\s+/g, '');
        const cleanSymbol = await searchSymbol(rawSymbol);
        
        let finalPrice = buyPrice;
        if (!finalPrice) {
            const { getStockPrice } = require('../services/stockService');
            const livePrice = await getStockPrice(cleanSymbol);
            if (livePrice) {
                finalPrice = livePrice;
            } else {
                return res.status(400).json({ error: 'Could not fetch live price automatically. Please enter a manual price.' });
            }
        }

        const newStock = await Portfolio.create({
            chatId: 'UI_USER', 
            symbol: cleanSymbol,
            buyPrice: finalPrice,
            quantity: quantity || 1
        });
        res.json(newStock);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error adding stock' });
    }
});

// Delete a stock from portfolio
router.delete('/portfolio/:id', async (req, res) => {
    try {
        await Portfolio.findByIdAndDelete(req.params.id);
        res.json({ message: 'Stock deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error deleting stock' });
    }
});

// Sell a stock
router.post('/portfolio/:id/sell', async (req, res) => {
    try {
        const { sellPrice, quantity } = req.body;
        const position = await Portfolio.findById(req.params.id);
        
        if (!position || position.status !== 'HOLDING') {
            return res.status(404).json({ error: 'Position not found or already sold' });
        }
        
        const sellQty = quantity ? parseInt(quantity) : position.quantity;
        
        if (sellQty < position.quantity) {
            position.quantity -= sellQty;
            await position.save();
            
            const realizedProfit = (sellPrice - position.buyPrice) * sellQty;
            await Portfolio.create({
                chatId: position.chatId,
                symbol: position.symbol,
                buyPrice: position.buyPrice,
                quantity: sellQty,
                status: 'SOLD',
                sellPrice: sellPrice,
                realizedProfit: realizedProfit
            });
            res.json({ message: 'Partial sale logged successfully' });
        } else {
            const realizedProfit = (sellPrice - position.buyPrice) * position.quantity;
            position.status = 'SOLD';
            position.sellPrice = sellPrice;
            position.realizedProfit = realizedProfit;
            await position.save();
            res.json({ message: 'Full position sold successfully' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error selling stock' });
    }
});

// Get AI Analysis Logs History
router.get('/logs', async (req, res) => {
    try {
        const logs = await AnalysisLog.find().sort({ createdAt: -1 }).limit(50);
        res.json(logs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching logs' });
    }
});

// --- WATCHLIST ROUTES ---

// Get Watchlist with Live Prices
router.get('/watchlist', async (req, res) => {
    try {
        const watchlist = await Watchlist.find().sort({ createdAt: -1 });
        
        // AUTO-HEAL DATABASE: Fix any malformed symbols instantly
        for (const item of watchlist) {
            if (!item.symbol.endsWith('.NS') && !item.symbol.endsWith('.BO')) {
                item.symbol = item.symbol + '.NS';
                await item.save();
            }
        }
        
        const watchlistWithPrices = await Promise.all(watchlist.map(async (item) => {
            const currentPrice = await getStockPrice(item.symbol);
            return {
                ...item.toObject(),
                currentPrice
            };
        }));
        res.json(watchlistWithPrices);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching watchlist' });
    }
});

// Add to Watchlist
router.post('/watchlist', async (req, res) => {
    try {
        const { symbol } = req.body;
        const newWatchlistItem = await Watchlist.create({
            chatId: 'UI_USER', 
            symbol: symbol.trim().toUpperCase().replace(/\s+/g, '')
        });
        res.json(newWatchlistItem);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error adding to watchlist' });
    }
});

// Delete from Watchlist
router.delete('/watchlist/:id', async (req, res) => {
    try {
        await Watchlist.findByIdAndDelete(req.params.id);
        res.json({ message: 'Watchlist item deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error deleting from watchlist' });
    }
});

// --- MARKET EXPLORER (SEARCH) ---
router.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json([]);
        
        // Use Yahoo Finance to search by company name
        const result = await yahooFinance.search(query, { newsCount: 0 });
        
        // Filter to only equities/ETFs and map useful data
        const stocks = result.quotes
            .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
            .slice(0, 10)
            .map(q => ({
                symbol: q.symbol,
                shortname: q.shortname || q.longname,
                exchange: q.exchange,
                score: q.score
            }));
            
        res.json(stocks);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error searching stocks' });
    }
});

// --- MARKET MOVERS (GAINERS/LOSERS) ---
router.get('/market/movers', async (req, res) => {
    try {
        const { getMarketMovers } = require('../services/stockService');
        const movers = await getMarketMovers();
        res.json(movers);
    } catch (error) {
        console.error("Error in /market/movers route:", error.message);
        res.json({ gainers: [], losers: [] });
    }
});

// --- AI TOP 10 RECOMMENDATIONS ---
let aiRecommendationsCache = { data: null, lastFetch: 0 };

router.get('/ai/recommendations', async (req, res) => {
    try {
        // Cache for 2 hours (7200000 ms) to save Gemini API costs
        if (aiRecommendationsCache.data && (Date.now() - aiRecommendationsCache.lastFetch < 7200000)) {
            return res.json(aiRecommendationsCache.data);
        }

        const news = await getLatestNews();
        const top10 = await getTop10Recommendations(news);
        
        if (top10 && top10.length > 0) {
            // Post-process to fix AI price hallucinations (Same as Telegram Bot logic)
            const { getStockPrice } = require('../services/stockService');
            for (let t of top10) {
                try {
                    const realPrice = await getStockPrice(t.symbol);
                    if (realPrice && !isNaN(realPrice)) {
                        let targetMultiplier = 1.05;
                        let slMultiplier = 0.97;
                        
                        if (t.currentPrice && t.target && t.stopLoss) {
                            const aiEntry = parseFloat(t.currentPrice.toString().replace(/[^0-9.]/g, ''));
                            const aiTarget = parseFloat(t.target.toString().replace(/[^0-9.]/g, ''));
                            const aiSL = parseFloat(t.stopLoss.toString().replace(/[^0-9.]/g, ''));
                            
                            if (aiEntry > 0 && aiTarget > 0) targetMultiplier = aiTarget / aiEntry;
                            if (aiEntry > 0 && aiSL > 0) slMultiplier = aiSL / aiEntry;
                        }

                        t.currentPrice = realPrice;
                        if (t.action === 'BUY') {
                            t.target = (realPrice * targetMultiplier).toFixed(2);
                            t.stopLoss = (realPrice * slMultiplier).toFixed(2);
                        }
                    }
                } catch (e) {
                    console.error("Error fixing AI price for UI:", e.message);
                }
            }

            aiRecommendationsCache = { data: top10, lastFetch: Date.now() };
            res.json(top10);
        } else {
            res.status(500).json({ error: 'Failed to generate AI recommendations' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching AI recommendations' });
    }
});

// --- BACKTEST ENGINE ---
router.post('/backtest', async (req, res) => {
    try {
        const { symbol, days } = req.body;
        if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
        
        const result = await runBacktest(symbol, days || 365);
        if (result.error) {
            return res.status(400).json(result);
        }
        
        // Generate Beginner AI Suggestion based on the result
        const { getBacktestAISuggestion } = require('../services/aiService');
        const { getTechnicalIndicators } = require('../services/technicalService');
        const Portfolio = require('../models/Portfolio');
        
        const holding = await Portfolio.findOne({ symbol, status: 'HOLDING' });
        let holdingStatus = `⚪ You DO NOT own this stock.`;
        if (holding) {
            const daysHeld = Math.floor((Date.now() - new Date(holding.createdAt).getTime()) / (1000 * 60 * 60 * 24));
            holdingStatus = `🟢 You OWN this stock! (Bought at: ₹${holding.buyPrice}, Days Held: ${daysHeld})`;
        }
        
        let technicals = null;
        try { technicals = await getTechnicalIndicators(symbol); } catch(e) {}
        
        const aiSuggestion = await getBacktestAISuggestion(symbol, days || 365, result.profitPercent, result.totalTrades, holdingStatus, technicals);
        result.aiSuggestion = aiSuggestion;
        
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error running backtest' });
    }
});

// --- HISTORICAL DATA (NO CHARTS) ---
router.get('/stock/history', async (req, res) => {
    try {
        const { symbol, period } = req.query; // '7d', '1mo', '3mo'
        const endDate = new Date();
        const startDate = new Date();
        
        if (period === '1d') startDate.setDate(startDate.getDate() - 1);
        else if (period === '3d') startDate.setDate(startDate.getDate() - 3);
        else if (period === '7d') startDate.setDate(startDate.getDate() - 7);
        else if (period === '1mo') startDate.setMonth(startDate.getMonth() - 1);
        else if (period === '3mo') startDate.setMonth(startDate.getMonth() - 3);
        else startDate.setDate(startDate.getDate() - 7);
        
        const history = await yahooFinance.historical(symbol, {
            period1: startDate,
            period2: endDate,
            interval: '1d'
        });
        
        const quote = await yahooFinance.quote(symbol);
        
        res.json({
            quote: {
                price: quote.regularMarketPrice,
                open: quote.regularMarketOpen,
                high: quote.regularMarketDayHigh,
                low: quote.regularMarketDayLow,
                close: quote.regularMarketPreviousClose,
                change: quote.regularMarketChange,
                changePercent: quote.regularMarketChangePercent
            },
            history: history.reverse()
        });
    } catch (error) {
        console.error(error);
        // Google Finance Fallback for the live Quote (if Yahoo fails)
        let fallbackQuote = {};
        try {
            const price = await getStockPrice(symbol);
            if (price) fallbackQuote.price = price;
        } catch(e) {}
        res.json({
            quote: {
                price: fallbackQuote.price || null,
                open: null,
                high: null,
                low: null,
                close: null,
                change: null,
                changePercent: null
            },
            history: []
        });
    }
});

module.exports = router;
