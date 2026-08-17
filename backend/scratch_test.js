require('dotenv').config();
const axios = require('axios');
const angleOneService = require('./services/angleOneService');

(async () => {
    try {
        console.log("Logging into Angle One...");
        const success = await angleOneService.login();
        if (!success) {
            console.log("Login failed!");
            return;
        }

        console.log("Downloading tokens...");
        const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
        const data = response.data;

        // Find active Crude Oil Mini contracts
        const minis = data.filter(i => i.exch_seg === 'MCX' && i.name === 'CRUDEOILM' && new Date(i.expiry) > new Date());
        minis.sort((a,b) => new Date(a.expiry) - new Date(b.expiry));
        
        console.log("Found Crude Oil Mini Tokens:");
        minis.slice(0,2).forEach(m => console.log(m));

        if (minis.length > 0) {
            const token = minis[0].token;
            console.log(`Testing getQuote for MCX ${token}...`);
            const price = await angleOneService.getQuote('MCX', token);
            console.log(`Live Price for Mini: ₹${price}`);

            console.log(`Testing getHistoricData for MCX ${token}...`);
            const candles = await angleOneService.getHistoricData('MCX', token, 'FIVE_MINUTE', 5);
            console.log(`Fetched ${candles.length} candles. Last candle:`, candles[candles.length - 1]);
        }

    } catch (e) {
        console.error(e.message);
    }
})();
