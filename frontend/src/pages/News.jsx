import React, { useEffect, useState } from 'react';

const News = () => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchNews = () => {
    fetch('http://localhost:5000/api/news')
      .then(res => res.json())
      .then(data => {
        setNews(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching news:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchNews(); // Initial fetch
    
    // Auto-refresh every 30 seconds (30,000 milliseconds)
    const intervalId = setInterval(fetchNews, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  if (loading) return <div className="loader-container"><div className="loader"></div></div>;

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Market Intelligence</h1>
      <p className="page-subtitle">Latest news that the AI is using to analyze your portfolio.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '24px' }}>
        {news.map((item, index) => (
          <div 
            key={index} 
            className="glass-card" 
            onClick={() => item.link ? window.open(item.link, '_blank') : null}
            style={{ cursor: item.link ? 'pointer' : 'default', transition: 'transform 0.2s', border: '1px solid rgba(255,255,255,0.05)' }}
            onMouseOver={(e) => { if(item.link) e.currentTarget.style.border = '1px solid var(--accent-blue)'; }}
            onMouseOut={(e) => { if(item.link) e.currentTarget.style.border = '1px solid rgba(255,255,255,0.05)'; }}
          >
            <h3 style={{ marginBottom: '12px', color: 'var(--accent-blue)' }}>{item.title}</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>{item.content || `Read full article on ${item.source || 'News Source'}.`}</p>
            <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span style={{color: 'var(--accent-purple)', fontWeight: 'bold', marginRight: '10px'}}>{item.source}</span> | 
              <span style={{marginLeft: '10px'}}>Published: {new Date(item.date).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default News;
