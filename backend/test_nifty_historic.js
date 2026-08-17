require('dotenv').config();
const angleOneService = require('./services/angleOneService');

(async () => {
    try {
        await angleOneService.login();
        console.log("Fetching Nifty Historic...");
        const a1Data = await angleOneService.getHistoricData('NSE', '26000', "FIVE_MINUTE", 5);
        if (a1Data && a1Data.length > 0) {
            console.log(`Success! Fetched ${a1Data.length} candles.`);
            console.log("Last candle:", a1Data[a1Data.length - 1]);
        } else {
            console.log("Failed: Returned empty array or null.");
        }
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
})();
