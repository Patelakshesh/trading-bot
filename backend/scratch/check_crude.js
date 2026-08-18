const { getFNOTrade } = require('../services/fnoService');

async function testFnO() {
    console.log("Testing getFNOTrade('crude')...");
    try {
        const result = await getFNOTrade('crude');
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Error running getFNOTrade:", e);
    }
    process.exit(0);
}

testFnO();
