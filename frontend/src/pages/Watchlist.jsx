import React, { useEffect, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal';
import SymbolSearch from '../components/SymbolSearch';

const Watchlist = () => {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ symbol: '' });
  
  // State for TradingView Chart Modal
  const [activeChartSymbol, setActiveChartSymbol] = useState(null);

  // State for Confirm Delete Modal
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, id: null });

  const fetchWatchlist = () => {
    fetch('http://localhost:5000/api/watchlist')
      .then(res => res.json())
      .then(data => {
        if(Array.isArray(data)) {
          setWatchlist(data);
        } else {
          setWatchlist([]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching watchlist:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchWatchlist();
    const intervalId = setInterval(fetchWatchlist, 30000); // 30s live update
    return () => clearInterval(intervalId);
  }, []);

  const handleAddWatchlist = async (e) => {
    e.preventDefault();
    try {
      await fetch('http://localhost:5000/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: formData.symbol })
      });
      setIsModalOpen(false);
      setFormData({ symbol: '' });
      fetchWatchlist(); 
    } catch (err) {
      console.error("Error adding to watchlist", err);
    }
  };

  const triggerDelete = (e, id) => {
    e.stopPropagation(); 
    setConfirmConfig({ isOpen: true, id });
  };

  const confirmDelete = async () => {
    try {
      await fetch(`http://localhost:5000/api/watchlist/${confirmConfig.id}`, {
        method: 'DELETE'
      });
      fetchWatchlist();
    } catch (err) {
      console.error("Error deleting from watchlist", err);
    }
    setConfirmConfig({ isOpen: false, id: null });
  };

  // Note: NSE restricts third-party iframe embedding on TradingView. 
  // We map .NS to BSE: to bypass this restriction, as BSE data is free to embed.
  const getTradingViewSymbol = (sym) => {
    if(!sym) return 'AAPL';
    if(sym.endsWith('.NS')) return 'BSE:' + sym.replace('.NS', '');
    if(sym.endsWith('.BO')) return 'BSE:' + sym.replace('.BO', '');
    return sym; 
  };

  if (loading) return <div className="loader-container"><div className="loader"></div></div>;

  return (
    <>
      <div className="animate-fade-in">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginBottom: '20px'}}>
          <div>
            <h1 className="page-title" style={{display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap'}}>
              AI Watchlist
              <span style={{fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500'}}>
                <div style={{width: '6px', height: '6px', background: 'var(--success)', borderRadius: '50%', boxShadow: '0 0 8px var(--success)'}}></div>
                Live Target Monitoring
              </span>
            </h1>
            <p className="page-subtitle">Stocks you don't own yet, but the AI is actively monitoring for buy signals based on breaking news.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>+ Add to Watchlist</button>
        </div>

        {watchlist.length === 0 ? (
          <div className="glass-card" style={{textAlign: 'center', padding: '40px'}}>
            <h3 style={{color: 'var(--text-secondary)'}}>No stocks in Watchlist.</h3>
            <p style={{marginTop: '12px'}}>Add stocks here to force the AI to monitor them closely.</p>
          </div>
        ) : (
          <div className="dashboard-grid">
            {watchlist.map((item) => {
              const currentPrice = item.currentPrice;

              return (
                <div 
                  key={item._id} 
                  className="glass-card clickable-card" 
                  onClick={() => setActiveChartSymbol(item.symbol)}
                  title="Click to view 5-Year Chart"
                >
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px'}}>
                    <div>
                      <h2 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-purple)'}}>
                        {item.symbol}
                        <button 
                          onClick={(e) => triggerDelete(e, item._id)} 
                          style={{background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: '4px'}}
                          title="Remove from Watchlist"
                        >
                          🗑️
                        </button>
                      </h2>
                    </div>
                  </div>
                  
                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between'}}>
                      <span style={{color: 'var(--text-secondary)'}}>Live Market Price</span>
                      <strong style={{fontSize: '1.2rem'}}>
                        {currentPrice ? `₹${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}` : 'Loading...'}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{margin: '60px auto'}}>
            <button className="btn-close" onClick={() => setIsModalOpen(false)}>×</button>
            <h2>Monitor Stock</h2>
            <form onSubmit={handleAddWatchlist}>
              <div className="form-group">
                <label>Company Name</label>
                <SymbolSearch 
                  onSelect={(symbol) => setFormData({...formData, symbol})} 
                  placeholder="Search company (e.g., Apple, Tata)..."
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{width: '100%', marginTop: '16px'}}>Add to Watchlist</button>
            </form>
          </div>
        </div>
      )}

      {/* Chart Modal */}
      {activeChartSymbol && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '1000px', width: '95%', height: '80vh', display: 'flex', flexDirection: 'column', padding: '16px', margin: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, color: 'var(--accent-purple)' }}>{activeChartSymbol} Chart</h2>
              <button className="btn-close" style={{position: 'static'}} onClick={() => setActiveChartSymbol(null)}>×</button>
            </div>
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

      {/* Reusable Confirm Delete Modal */}
      <ConfirmModal 
        isOpen={confirmConfig.isOpen}
        title="Remove from Watchlist"
        message="Are you sure you want to stop tracking this stock?"
        confirmText="Remove"
        isDanger={true}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmConfig({ isOpen: false, id: null })}
      />
    </>
  );
};

export default Watchlist;
