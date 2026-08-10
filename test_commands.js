const { getCombinedMasterSetups } = require('./backend/services/intradayService');
const { getFNOTrade } = require('./backend/services/fnoService');
const { getPredictionSetups } = require('./backend/services/predictionService');

async function runTests() {
    console.log("Testing /fno...");
    try {
        const fnoResult = await getFNOTrade('crude');
        console.log("FNO Result:", fnoResult);
    } catch(e) {
        console.error("FNO Error:", e);
    }

    console.log("\nTesting /best...");
    try {
        const bestResult = await getCombinedMasterSetups(20000);
        console.log("Best Result:", bestResult.status);
    } catch(e) {
        console.error("Best Error:", e);
    }

    console.log("\nTesting /predict...");
    try {
        const predictResult = await getPredictionSetups();
        console.log("Predict Result:", predictResult ? predictResult.status : "null");
    } catch(e) {
        console.error("Predict Error:", e);
    }
    
    process.exit(0);
}

runTests();
