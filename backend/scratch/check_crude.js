const { getFNOTrade } = require('../services/fnoService');

async function checkLiveCrude() {
    try {
        console.log("Fetching Live Crude Oil Metrics...");
        const result = await getFNOTrade('crude');
        console.log(JSON.stringify(result, null, 2));
    } catch(err) {
        console.error(err);
    }
    process.exit(0);
}

checkLiveCrude();
