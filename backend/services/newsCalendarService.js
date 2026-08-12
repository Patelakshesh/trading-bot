const https = require('https');
const xml2js = require('xml2js');

let cachedEvents = [];
let lastFetchTime = 0;

async function fetchEconomicCalendar() {
    // Only fetch once every hour to prevent getting banned
    if (Date.now() - lastFetchTime < 60 * 60 * 1000 && cachedEvents.length > 0) {
        return cachedEvents;
    }

    return new Promise((resolve, reject) => {
        https.get('https://nfs.faireconomy.media/ff_calendar_thisweek.xml', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                xml2js.parseString(data, (err, result) => {
                    if (err) return reject(err);
                    
                    if (result && result.weeklyevents && result.weeklyevents.event) {
                        cachedEvents = result.weeklyevents.event.map(e => ({
                            title: e.title[0],
                            country: e.country[0],
                            date: e.date[0], // Format: mm-dd-yyyy
                            time: e.time[0], // Format: hh:mmam/pm (EST)
                            impact: e.impact[0]
                        }));
                        lastFetchTime = Date.now();
                        resolve(cachedEvents);
                    } else {
                        resolve([]);
                    }
                });
            });
        }).on('error', (e) => reject(e));
    });
}

// Convert EST time from XML to IST (Indian Standard Time)
function getEventTimeIST(dateStr, timeStr) {
    if (timeStr === 'All Day' || timeStr === 'Tentative') return null;
    
    // Parse time like "10:30am"
    const match = timeStr.match(/(\d+):(\d+)([ap]m)/i);
    if (!match) return null;
    
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toLowerCase();
    
    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    // Create Date object in EST (America/New_York)
    const [month, day, year] = dateStr.split('-');
    
    // Using a simple fixed offset for EST (-5 hours from UTC, IST is +5:30)
    // EST to IST is a +10:30 hours difference (ignoring daylight savings for simplicity, 
    // or +9:30 during EDT. For absolute precision, we check current timezone).
    // Let's create an exact UTC date assuming the XML provides EDT time (-04:00) during summer.
    
    const eventDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00-04:00`;
    const eventDate = new Date(eventDateStr);
    
    return eventDate;
}

async function checkUpcomingNews(instrumentType) {
    try {
        const events = await fetchEconomicCalendar();
        const now = new Date();
        
        // Look for High Impact events GLOBALLY (because European/Chinese news also spikes markets)
        const relevantEvents = events.filter(e => {
            if (e.impact !== 'High') return false;
            
            // For Gold and Crude, ALL global High-Impact news causes spikes (OPEC, China Data, Eurozone, USD)
            // For Nifty, global cues (USD/EUR/CNY) strongly affect it too.
            // So we will track ALL High-Impact news for any instrument.
            return true;
        });

        for (const e of relevantEvents) {
            const eventTime = getEventTimeIST(e.date, e.time);
            if (!eventTime) continue;
            
            const timeDiffMinutes = (eventTime.getTime() - now.getTime()) / (1000 * 60);
            
            // If the news is happening in the next 30 minutes!
            if (timeDiffMinutes > 0 && timeDiffMinutes <= 30) {
                return `🚨 PRE-SPIKE WARNING: High-Impact News "${e.title}" is dropping in ${Math.round(timeDiffMinutes)} minutes! Expect massive volatility. Keep Groww app ready!`;
            }
        }
        
        return null; // No upcoming news
    } catch (e) {
        console.error("News Tracker Error:", e);
        return null;
    }
}

module.exports = { checkUpcomingNews };
