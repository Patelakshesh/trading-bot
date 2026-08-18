require('dotenv').config();
const { getFNOTrade } = require('../services/fnoService');

async function checkAll() {
    console.log("==========================================");
    console.log("Checking CRUDE OIL...");
    try {
        const result = await getFNOTrade('crude');
        console.log(JSON.stringify(result, null, 2));
    } catch(e) { console.error(e); }
    
    console.log("==========================================");
    console.log("Checking NIFTY 50...");
    try {
        const result = await getFNOTrade('nifty');
        console.log(JSON.stringify(result, null, 2));
    } catch(e) { console.error(e); }
    
    process.exit(0);
}
checkAll();
