const fs = require('fs');
const symbols = JSON.parse(fs.readFileSync('nifty2000.json', 'utf8'));
const arr = symbols.map(s => `{ symbol: '${s}.NS', name: '${s}' }`);
let code = fs.readFileSync('services/stockService.js', 'utf8');

const startIndex = code.indexOf('const fallbackData = [');
const endIndex = code.indexOf('];', startIndex) + 2;

if (startIndex !== -1 && endIndex !== -1) {
    const newCode = code.substring(0, startIndex) + 'const fallbackData = [\n' + arr.join(',\n') + '\n];' + code.substring(endIndex);
    fs.writeFileSync('services/stockService.js', newCode);
    console.log('Replaced array with 2386 stocks successfully');
} else {
    console.log('Could not find boundaries');
}
