import React, { useState, useEffect } from 'react';
import ConfirmModal from '../components/ConfirmModal';

const Explore = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeChartSymbol, setActiveChartSymbol] = useState(null);
  
  const [aiPicks, setAiPicks] = useState([]);
  const [loadingAi, setLoadingAi] = useState(true);

  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: '' });

  // Debounce search
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      setLoading(true);
      fetch(`http://localhost:5000/api/search?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
          setResults(data);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLoading(false);
        });
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Fetch AI Recommendations on load
  useEffect(() => {
    fetch('http://localhost:5000/api/ai/recommendations')
      .then(res => res.json())
      .then(data => {
        if(Array.isArray(data)) setAiPicks(data);
      })
      .catch(err => console.error(err))
      .finally(() => setLoadingAi(false));
  }, []);

  const addToWatchlist = async (e, symbol) => {
    e.stopPropagation();
    try {
      await fetch('http://localhost:5000/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      setAlertConfig({ isOpen: true, title: 'Success', message: `Added ${symbol} to your Watchlist!` });
    } catch (err) {
      console.error(err);
      setAlertConfig({ isOpen: true, title: 'Error', message: 'Failed to add to watchlist.' });
    }
  };

  // Note: NSE restricts third-party iframe embedding on TradingView. 
  // We map .NS to BSE: to bypass this restriction, as BSE data is free to embed.
  const getTradingViewSymbol = (sym) => {
    if(!sym) return 'AAPL';
    if(sym.endsWith('.NS')) return 'BSE:' + sym.replace('.NS', '');
    if(sym.endsWith('.BO')) return 'BSE:' + sym.replace('.BO', '');
    return sym; 
  };

  return (
    <>
      <div className="animate-fade-in">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginBottom: '12px'}}>
          <div>
            <h1 className="page-title">Market Explorer</h1>
            <p className="page-subtitle">Search for any company name worldwide to find its exact stock symbol and view its 5-year interactive chart.</p>
          </div>
        </div>

        <div style={{ marginBottom: '32px' }}>
          <input 
            type="text" 
            placeholder="Type a company name (e.g. Zomato, Tata Motors, Apple)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '16px 20px',
              fontSize: '1.1rem',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--glass-border)',
              borderRadius: '12px',
              color: '#fff',
              outline: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          />
        </div>

        {loading && <div style={{textAlign: 'center', color: 'var(--text-secondary)'}}>Searching markets...</div>}

        <div className="dashboard-grid">
          {results.map((stock, i) => (
            <div 
              key={i} 
              className="glass-card clickable-card"
              onClick={() => setActiveChartSymbol(stock.symbol)}
              title="Click to view full chart & live price"
            >
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                <div>
                  <h2 style={{margin: 0, color: 'var(--accent-blue)', fontSize: '1.4rem'}}>{stock.symbol}</h2>
                  <p style={{color: 'var(--text-primary)', fontWeight: 'bold', margin: '4px 0'}}>{stock.shortname}</p>
                  <span style={{color: 'var(--text-secondary)', fontSize: '0.8rem'}}>Exchange: {stock.exchange}</span>
                </div>
                <button 
                  className="btn btn-primary" 
                  style={{padding: '6px 12px', fontSize: '0.9rem'}}
                  onClick={(e) => addToWatchlist(e, stock.symbol)}
                >
                  + Watchlist
                </button>
              </div>
              <div style={{marginTop: '16px', color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic'}}>
                Click card to view live market price, today's change, and 5-year graph.
              </div>
            </div>
          ))}
        </div>
        
        {query && !loading && results.length === 0 && (
          <div style={{textAlign: 'center', color: 'var(--text-secondary)'}}>No companies found matching "{query}"</div>
        )}

        {/* AI Recommendations Section */}
        {!query && (
          <div style={{ marginTop: '40px' }}>
            <h2 className="page-title" style={{ fontSize: '1.5rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              🤖 AI Top 10 Watchlist Targets
            </h2>
            <p className="page-subtitle" style={{ marginBottom: '24px' }}>
              Gemini AI analyzed today's breaking news and suggests you monitor these stocks for massive breakouts or crashes.
            </p>

            {loadingAi ? (
              <div style={{textAlign: 'center', color: 'var(--text-secondary)'}}>🤖 AI is reading global news and generating targets...</div>
            ) : (
              <div className="dashboard-grid">
                {aiPicks.map((pick, i) => (
                  <div 
                    key={i} 
                    className="glass-card clickable-card"
                    style={{ background: 'rgba(59, 130, 246, 0.03)', borderColor: 'rgba(59, 130, 246, 0.15)' }}
                    onClick={() => setActiveChartSymbol(pick.symbol)}
                  >
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px'}}>
                      <div>
                        <h2 style={{margin: 0, color: 'var(--accent-blue)', fontSize: '1.3rem'}}>{pick.symbol}</h2>
                        <span style={{color: 'var(--text-primary)', fontWeight: '500', fontSize: '0.9rem'}}>{pick.name}</span>
                      </div>
                      <button 
                        className="btn btn-primary" 
                        style={{padding: '6px 12px', fontSize: '0.8rem'}}
                        onClick={(e) => addToWatchlist(e, pick.symbol)}
                      >
                        + Watchlist
                      </button>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid var(--accent-purple)' }}>
                      <span style={{color: 'var(--accent-purple)', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '4px'}}>🧠 AI Reasoning:</span>
                      <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0, lineHeight: '1.4'}}>
                        "{pick.reason}"
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Advanced TradingView Chart Modal */}
      {activeChartSymbol && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '1000px', width: '95%', height: '80vh', display: 'flex', flexDirection: 'column', padding: '16px', margin: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, color: 'var(--accent-blue)' }}>{activeChartSymbol} Live Market</h2>
              <button className="btn-close" style={{position: 'static'}} onClick={() => setActiveChartSymbol(null)}>×</button>
            </div>
            {/* Embed TradingView Widget via Iframe */}
            <iframe 
              key={activeChartSymbol}
              src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_1&symbol=${encodeURIComponent(getTradingViewSymbol(activeChartSymbol))}&interval=D&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&theme=dark&style=1&timezone=Asia%2FKolkata&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&locale=en&utm_source=localhost&utm_medium=widget&utm_campaign=chart&utm_term=${encodeURIComponent(getTradingViewSymbol(activeChartSymbol))}`}
              style={{ width: '100%', flex: 1, border: 'none', borderRadius: '8px' }}
              title="TradingView Chart"
              allowFullScreen
            ></iframe>
          </div>
        </div>
      )}

      {/* Reusable Alert Modal */}
      <ConfirmModal 
        isOpen={alertConfig.isOpen}
        title={alertConfig.title}
        message={alertConfig.message}
        confirmText="OK"
        isAlert={true}
        onConfirm={() => setAlertConfig({ isOpen: false, message: '', title: '' })}
      />
    </>
  );
};

export default Explore;
