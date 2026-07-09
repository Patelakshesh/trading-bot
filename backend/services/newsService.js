const Parser = require('rss-parser');
const parser = new Parser();

const getLatestNews = async () => {
    try {
        // Using highly active Google News feeds for real-time updates (faster than Yahoo)
        const rssFeeds = [
            'https://news.google.com/rss/search?q=finance+OR+stock+market+when:1d&hl=en-US&gl=US&ceid=US:en', // Finance
            'https://news.google.com/rss/search?q=geopolitics+OR+war+OR+economy+when:1d&hl=en-US&gl=US&ceid=US:en', // Global Events
            'https://news.google.com/rss/search?q=indian+stock+market+when:1d&hl=en-IN&gl=IN&ceid=IN:en' // Indian Market
        ];

        let allNews = [];

        for (let url of rssFeeds) {
            try {
                const feed = await parser.parseURL(url);
                // Fetch up to 20 articles per feed to ensure we capture the absolute newest, 
                // instead of just the 5 most 'relevant' which could be an hour old.
                const items = feed.items.slice(0, 20).map(item => {
                    let content = item.contentSnippet || item.content || '';
                    // Clean up Google News weird HTML or generic text
                    if(content.includes('Read full article')) content = ''; 
                    
                    let cleanTitle = item.title;
                    let actualSource = feed.title || 'Global News';
                    
                    // Google News appends the publisher to the end of the title after a dash
                    const lastDashIndex = cleanTitle.lastIndexOf(' - ');
                    if (lastDashIndex !== -1) {
                        actualSource = cleanTitle.substring(lastDashIndex + 3).trim();
                        cleanTitle = cleanTitle.substring(0, lastDashIndex).trim();
                    }

                    // If content is just a repeat of the title (common in Google RSS), hide it
                    if (content.includes(cleanTitle)) content = '';
                    
                    return {
                        title: cleanTitle,
                        source: actualSource,
                        content: content,
                        date: item.pubDate,
                        link: item.link
                    };
                });
                allNews = allNews.concat(items);
            } catch (feedError) {
                console.error(`Error fetching feed:`, feedError.message);
            }
        }

        // CRITICAL FIX: Sort all news by Date (Newest exactly at the top)
        allNews.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Return the absolute freshest 15 articles across all feeds
        return allNews.slice(0, 15);
    } catch (error) {
        console.error('Error fetching global news:', error);
        return [];
    }
};

module.exports = { getLatestNews };
