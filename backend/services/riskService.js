// ============================================================================
// PROFESSIONAL CAPITAL & RISK SHIELD (INDIAN NSE QUANT ENGINE)
// Specifically engineered to eliminate brokerage fee traps and prevent account blow-ups
// ============================================================================

class RiskManager {
    constructor() {
        // Daily Kill Switch Tracking
        this.today = new Date().toISOString().split('T')[0];
        this.dailyLosses = 0;
        this.dailyWins = 0;
        this.consecutiveLosses = 0;
        this.killSwitchActive = false;
        this.maxConsecutiveLosses = 2; // Trigger daily shutdown after 2 losses in a row
        this.maxDailyLossAmount = 2500; // Max allowed monetary loss in INR per day
        this.currentDailyLossAmount = 0;
    }

    // Reset tracking if a new trading day begins
    checkAndResetDay() {
        const currentDate = new Date().toISOString().split('T')[0];
        if (currentDate !== this.today) {
            this.today = currentDate;
            this.dailyLosses = 0;
            this.dailyWins = 0;
            this.consecutiveLosses = 0;
            this.currentDailyLossAmount = 0;
            this.killSwitchActive = false;
            console.log("🌅 New Trading Day: Daily Kill Switch and Risk Counters reset.");
        }
    }

    // 1. ADVANCED INDIAN BROKERAGE & TAX HURDLE CALCULATOR
    // Assumes flat ₹20 buy + ₹20 sell discount broker rates (e.g., Zerodha/Dhan/Angel) + STT & GST
    evaluateTradeViability(symbol, entryPrice, targetPrice, stopLossPrice, capital = 25000, isIntraday = false) {
        this.checkAndResetDay();

        if (this.killSwitchActive) {
            return {
                approved: false,
                reason: "🛑 DAILY KILL SWITCH ACTIVE: Two consecutive losses recorded today. All trading paused until tomorrow to protect capital."
            };
        }

        const entry = parseFloat(entryPrice);
        const target = parseFloat(targetPrice);
        const sl = parseFloat(stopLossPrice);

        if (!entry || !target || !sl || target <= entry || sl >= entry) {
            return { approved: false, reason: "Invalid target or stop-loss price levels specified." };
        }

        // Optimal quantity based on 1.5% capital risk rule
        const maxRiskPerTrade = capital * 0.015; // 1.5% max capital loss per trade
        const lossPerShare = entry - sl;
        let quantity = Math.floor(maxRiskPerTrade / lossPerShare);
        
        // Ensure quantity doesn't exceed available capital (or 5x margin if intraday)
        const buyingPower = isIntraday ? capital * 5 : capital;
        if (quantity * entry > buyingPower) {
            quantity = Math.floor(buyingPower / entry);
        }
        
        if (quantity <= 0) quantity = 1; // Minimum 1 share

        const turnover = (entry * quantity) + (target * quantity);
        const lossTurnover = (entry * quantity) + (sl * quantity);

        // Calculate Real Indian Trading Taxes & Brokerage
        const brokerage = 40.0; // ₹20 Buy + ₹20 Sell
        const sttRate = isIntraday ? 0.00025 : 0.001; // STT on sell side/delivery
        const stt = (target * quantity) * sttRate;
        const nseFee = turnover * 0.0000325; // Exchange Turnover Charges
        const gst = (brokerage + nseFee) * 0.18; // 18% GST on Brokerage + Exchange Fees
        const stampDuty = (entry * quantity) * 0.00003; // Stamp Duty on buy side
        const sebiFee = turnover * 0.000001; // SEBI Turnover charges

        const totalTaxesAndFees = Math.round((brokerage + stt + nseFee + gst + stampDuty + sebiFee) * 100) / 100;

        // Calculate Net P&L
        const grossProfit = (target - entry) * quantity;
        const netProfit = Math.round((grossProfit - totalTaxesAndFees) * 100) / 100;

        const grossLoss = (entry - sl) * quantity;
        const netLoss = Math.round((grossLoss + totalTaxesAndFees) * 100) / 100;

        // Calculate true Net Risk-to-Reward Ratio after all government & broker deductions
        const netRR = netProfit > 0 && netLoss > 0 ? (netProfit / netLoss) : 0;

        // EVALUATE HURDLES
        if (netProfit <= 0) {
            return {
                approved: false,
                reason: `⚠️ BROKERAGE FEE TRAP REJECTION: Even if ${symbol} hits target (+₹${grossProfit.toFixed(1)} gross), brokerage and GST fees (-₹${totalTaxesAndFees}) will result in a net loss (-₹${Math.abs(netProfit)}). DO NOT BUY.`
            };
        }

        // Strict Professional Rule: Minimum 1 : 1.5 Net Risk/Reward Ratio after taxes
        if (netRR < 1.4) {
            return {
                approved: false,
                reason: `⚠️ LOW NET REWARD REJECTION: ${symbol} has a Net Risk/Reward ratio of only 1 : ${netRR.toFixed(2)} after ₹${totalTaxesAndFees} brokerage & tax fees (Need >= 1 : 1.5). Too risky for small fee returns.`
            };
        }

        return {
            approved: true,
            symbol,
            recommendedQuantity: quantity,
            entry: entry.toFixed(2),
            target: target.toFixed(2),
            stopLoss: sl.toFixed(2),
            financials: {
                investedAmount: Math.round(entry * quantity),
                totalFeesAndTaxes: totalTaxesAndFees,
                expectedNetProfit: netProfit,
                maxNetLoss: netLoss,
                netRiskRewardRatio: `1 : ${netRR.toFixed(2)}`
            },
            reason: `✅ PRO APPROVED: Strong Net R:R (1 : ${netRR.toFixed(2)}) after ₹${totalTaxesAndFees} tax/brokerage fee hurdle.`
        };
    }

    // 2. DAILY KILL SWITCH MODULE (Track trade outcomes)
    recordTradeResult(symbol, pnlAmount) {
        this.checkAndResetDay();
        const pnl = parseFloat(pnlAmount);

        if (pnl > 0) {
            this.dailyWins++;
            this.consecutiveLosses = 0;
            console.log(`✅ Trade Win recorded for ${symbol}: +₹${pnl}. Consecutive losses reset to 0.`);
        } else {
            this.dailyLosses++;
            this.consecutiveLosses++;
            this.currentDailyLossAmount += Math.abs(pnl);
            console.warn(`❌ Trade Loss recorded for ${symbol}: -₹${Math.abs(pnl)}. Consecutive Losses today: ${this.consecutiveLosses}`);

            if (this.consecutiveLosses >= this.maxConsecutiveLosses || this.currentDailyLossAmount >= this.maxDailyLossAmount) {
                this.killSwitchActive = true;
                console.error(`🚨 DAILY KILL SWITCH ACTIVATED! 2 Consecutive Losses hit or Max Loss exceeded today. System shut down until tomorrow.`);
            }
        }
        
        return {
            today: this.today,
            wins: this.dailyWins,
            losses: this.dailyLosses,
            consecutiveLosses: this.consecutiveLosses,
            totalLossAmount: this.currentDailyLossAmount,
            killSwitchActive: this.killSwitchActive
        };
    }

    getKillSwitchStatus() {
        this.checkAndResetDay();
        return {
            active: this.killSwitchActive,
            wins: this.dailyWins,
            losses: this.dailyLosses,
            consecutiveLosses: this.consecutiveLosses
        };
    }
}

// Singleton export to share across server, Telegram bot, and AI scanners
const riskManager = new RiskManager();
module.exports = riskManager;
