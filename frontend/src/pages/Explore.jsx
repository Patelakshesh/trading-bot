import React, { useState, useEffect } from 'react';
import ConfirmModal from '../components/ConfirmModal';

const Explore = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeChartSymbol, setActiveChartSymbol] = useState(null);
  
  const [aiPicks, setAiPicks] = useState([]);
  const [loadingAi, setLoadingAi] = useState(true);
  
  const [historyPeriod, setHistoryPeriod] = useState('7d');
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  useEffect(() => {
    if (!activeChartSymbol) {
      setHistoryData(null);
      return;
    }
    setHistoryLoading(true);
    fetch(`http://localhost:5000/api/stock/history?symbol=${encodeURIComponent(activeChartSymbol)}&period=${historyPeriod}`)
      .then(res => res.json())
      .then(data => {
        setHistoryData(data);
        setHistoryLoading(false);
      })
      .catch(err => {
        console.error(err);
        setHistoryLoading(false);
      });
  }, [activeChartSymbol, historyPeriod]);

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
                Click card to view detailed historical prices (Open/Close/High/Low) and table data.
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

      {/* Advanced Historical Data Modal (Replaced Chart) */}
      {activeChartSymbol && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '900px', width: '95%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '24px', margin: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '1.8rem' }}>{activeChartSymbol} - Detailed Analysis</h2>
              <button className="btn-close" style={{position: 'static'}} onClick={() => setActiveChartSymbol(null)}>×</button>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <button className={`btn ${historyPeriod === '7d' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setHistoryPeriod('7d')}>Last 7 Days</button>
              <button className={`btn ${historyPeriod === '1mo' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setHistoryPeriod('1mo')}>1 Month</button>
              <button className={`btn ${historyPeriod === '3mo' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setHistoryPeriod('3mo')}>3 Months</button>
            </div>

            {historyLoading || !historyData ? (
              <div style={{textAlign: 'center', padding: '40px', color: 'var(--text-secondary)'}}>
                <div className="loader" style={{margin: '0 auto 16px'}}></div>
                Fetching historical data and today's metrics...
              </div>
            ) : (
              <>
                <div className="dashboard-grid" style={{ marginBottom: '24px' }}>
                  <div className="glass-card" style={{ textAlign: 'center', padding: '16px' }}>
                    <h4 style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}>Current Price</h4>
                    <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fff', margin: 0 }}>₹{historyData.quote?.price?.toFixed(2) || 'N/A'}</p>
                    {historyData.quote?.change !== undefined && (
                      <span style={{ color: historyData.quote.change >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: '0.9rem' }}>
                        {historyData.quote.change >= 0 ? '+' : ''}{historyData.quote.change.toFixed(2)} ({historyData.quote.changePercent?.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                  <div className="glass-card" style={{ textAlign: 'center', padding: '16px' }}>
                    <h4 style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}>Today's High</h4>
                    <p style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--success)', margin: 0 }}>₹{historyData.quote?.high?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div className="glass-card" style={{ textAlign: 'center', padding: '16px' }}>
                    <h4 style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}>Today's Low</h4>
                    <p style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--danger)', margin: 0 }}>₹{historyData.quote?.low?.toFixed(2) || 'N/A'}</p>
                  </div>
                </div>

                <div className="glass-card" style={{ overflowX: 'auto', padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)' }}>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>Date</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>Open</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>Close</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>High</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>Low</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.history && historyData.history.length > 0 ? historyData.history.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '12px 16px' }}>{new Date(row.date).toLocaleDateString()}</td>
                          <td style={{ padding: '12px 16px' }}>₹{row.open?.toFixed(2)}</td>
                          <td style={{ padding: '12px 16px' }}>₹{row.close?.toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--success)' }}>₹{row.high?.toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--danger)' }}>₹{row.low?.toFixed(2)}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{row.volume?.toLocaleString()}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>No historical data available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
