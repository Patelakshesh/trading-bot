const fs = require('fs');
const symbols = JSON.parse(fs.readFileSync('nifty500.json', 'utf8'));
const arr = symbols.map(s => `{ symbol: '${s}.NS', name: '${s}' }`);
fs.writeFileSync('nifty500_code.txt', 'const fallbackData = [\n' + arr.join(',\n') + '\n];');
console.log('Done');
