require('dotenv').config();
const angleOneService = require('./services/angleOneService');

(async () => {
    try {
        await angleOneService.login();
        
        // Fetch NIFTY Spot Price (Token: 26000, Exchange: NSE)
        const niftyPrice = await angleOneService.getQuote('NSE', '26000');
        console.log(`NIFTY LIVE: ₹${niftyPrice}`);

        // Fetch CRUDEOILM Price (Token: 560978, Exchange: MCX)
        const crudePrice = await angleOneService.getQuote('MCX', '560978');
        console.log(`CRUDE MINI LIVE: ₹${crudePrice}`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
