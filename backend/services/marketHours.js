/**
 * Market Hours & Session State Utility for Indian Financial Markets (IST - UTC+5:30)
 * Handles NSE (Equities & Indices) and MCX (Commodities) trading sessions.
 */

function getISTDate() {
    return new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
}

/**
 * Checks if current IST time is a Saturday (6) or Sunday (0)
 */
function isWeekend() {
    const ist = getISTDate();
    const day = ist.getUTCDay();
    return day === 0 || day === 6;
}

/**
 * Returns detailed Market Session Status for an asset
 * @param {string} asset - 'crude', 'gold', 'silver', 'nifty', 'banknifty', 'stock'
 */
function getMarketStatus(asset = 'crude') {
    const ist = getISTDate();
    const day = ist.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const hour = ist.getUTCHours();
    const minute = ist.getUTCMinutes();
    const currentMins = (hour * 60) + minute;

    const isCommodity = ['crude', 'crudeoil', 'crudeoilm', 'gold', 'silver', 'mcx'].some(c => asset.toLowerCase().includes(c));

    // 1. Weekend Check (Saturday or Sunday)
    if (day === 0 || day === 6) {
        const dayName = day === 0 ? 'Sunday' : 'Saturday';
        return {
            isOpen: false,
            isWeekend: true,
            statusLabel: `🔴 MARKET CLOSED (${dayName.toUpperCase()})`,
            reason: `Indian Exchanges (NSE & MCX) are closed on weekends.`,
            nextOpen: isCommodity ? 'Monday at 9:00 AM IST (MCX)' : 'Monday at 9:15 AM IST (NSE)',
            sessionType: 'WEEKEND_CLOSED'
        };
    }

    // 2. Weekday Market Hours Check (Monday to Friday)
    if (isCommodity) {
        // MCX Commodity Market Hours: 9:00 AM IST (540 mins) to 11:30 PM IST (1410 mins)
        const openMins = 9 * 60; // 9:00 AM
        const closeMins = (23 * 60) + 30; // 11:30 PM

        if (currentMins >= openMins && currentMins < closeMins) {
            return {
                isOpen: true,
                isWeekend: false,
                statusLabel: '🟢 MCX MARKET LIVE OPEN',
                reason: 'MCX Commodity session is currently active.',
                nextOpen: 'Currently Live',
                sessionType: 'MCX_LIVE'
            };
        } else {
            return {
                isOpen: false,
                isWeekend: false,
                statusLabel: '🔴 MCX MARKET CLOSED (AFTER-HOURS)',
                reason: 'MCX trading session is closed for the night.',
                nextOpen: 'Today/Tomorrow at 9:00 AM IST (MCX)',
                sessionType: 'AFTER_HOURS_CLOSED'
            };
        }
    } else {
        // NSE Equity & Index Market Hours: 9:15 AM IST (555 mins) to 3:30 PM IST (930 mins)
        const openMins = (9 * 60) + 15; // 9:15 AM
        const closeMins = (15 * 60) + 30; // 3:30 PM

        if (currentMins >= openMins && currentMins < closeMins) {
            return {
                isOpen: true,
                isWeekend: false,
                statusLabel: '🟢 NSE MARKET LIVE OPEN',
                reason: 'NSE session is currently active.',
                nextOpen: 'Currently Live',
                sessionType: 'NSE_LIVE'
            };
        } else {
            return {
                isOpen: false,
                isWeekend: false,
                statusLabel: '🔴 NSE MARKET CLOSED (AFTER-HOURS)',
                reason: 'NSE regular market hours are closed.',
                nextOpen: 'Today/Tomorrow at 9:15 AM IST (NSE)',
                sessionType: 'AFTER_HOURS_CLOSED'
            };
        }
    }
}

module.exports = {
    getISTDate,
    isWeekend,
    getMarketStatus
};
