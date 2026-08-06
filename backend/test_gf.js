async function test() {
    const response = await fetch('https://www.google.com/finance/quote/XOM:NYSE');
    const html = await response.text();
    const match = html.match(/class=\"YMlKec fxKbKc\">([^<]+)<\/div>/);
    if (match) console.log('XOM NYSE:', match[1]);
    
    const res2 = await fetch('https://www.google.com/finance/quote/AAPL:NASDAQ');
    const html2 = await res2.text();
    const match2 = html2.match(/class=\"YMlKec fxKbKc\">([^<]+)<\/div>/);
    if (match2) console.log('AAPL NASDAQ:', match2[1]);
}
test();
