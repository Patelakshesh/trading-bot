import React, { useEffect, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal';
import SymbolSearch from '../components/SymbolSearch';

const Dashboard = () => {
  const [portfolio, setPortfolio] = useState([]);
  const [history, setHistory] = useState([]);
  const [movers, setMovers] = useState({ gainers: [], losers: [] });
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [formData, setFormData] = useState({ symbol: '', buyPrice: '', quantity: '' });
  const [sellData, setSellData] = useState({ id: '', symbol: '', sellPrice: '', quantity: '', maxQty: 1 });
  
  // State for TradingView Chart Modal
  const [activeChartSymbol, setActiveChartSymbol] = useState(null);
  
  // State for Confirm Delete Modal
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, id: null });

  // State for Alert Modal
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, title: '', message: '' });

  const fetchPortfolio = () => {
    fetch('http://localhost:5000/api/portfolio')
      .then(res => res.json())
      .then(data => {
        if(Array.isArray(data)) setPortfolio(data);
        else setPortfolio([]);
      })
      .catch(err => console.error("Error fetching portfolio:", err))
      .finally(() => setLoading(false));
      
    fetch('http://localhost:5000/api/portfolio/history')
      .then(res => res.json())
      .then(data => {
        if(Array.isArray(data)) setHistory(data);
        else setHistory([]);
      })
      .catch(err => console.error("Error fetching history:", err));
  };

  const fetchMovers = () => {
    fetch('http://localhost:5000/api/market/movers')
      .then(res => res.json())
      .then(data => {
        if(data.gainers) setMovers(data);
      })
      .catch(err => console.error("Error fetching movers:", err));
  };

  useEffect(() => {
    fetchPortfolio();
    fetchMovers();
    const intervalId = setInterval(() => {
      fetchPortfolio();
      fetchMovers();
    }, 30000); // Auto-refresh every 30 seconds
    return () => clearInterval(intervalId);
  }, []);

  // ... (keep handler functions) ...

  const handleAddTrade = async (e) => {
    e.preventDefault();
    try {
      await fetch('http://localhost:5000/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: formData.symbol,
          buyPrice: Number(formData.buyPrice),
          quantity: Number(formData.quantity) || 1
        })
      });
      setIsModalOpen(false);
      setFormData({ symbol: '', buyPrice: '', quantity: '' });
      fetchPortfolio(); 
    } catch (err) {
      console.error("Error adding trade", err);
    }
  };

  const openSellModal = (e, item) => {
    e.stopPropagation();
    setSellData({ id: item._id, symbol: item.symbol, sellPrice: item.currentPrice || item.buyPrice, quantity: item.quantity, maxQty: item.quantity });
    setIsSellModalOpen(true);
  };

  const handleSellTrade = async (e) => {
    e.preventDefault();
    try {
      await fetch(`http://localhost:5000/api/portfolio/${sellData.id}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellPrice: Number(sellData.sellPrice),
          quantity: Number(sellData.quantity) || sellData.maxQty
        })
      });
      setIsSellModalOpen(false);
      fetchPortfolio(); 
    } catch (err) {
      console.error("Error selling trade", err);
    }
  };

  const triggerDelete = (e, id) => {
    e.stopPropagation(); 
    setConfirmConfig({ isOpen: true, id });
  };

  const confirmDelete = async () => {
    try {
      await fetch(`http://localhost:5000/api/portfolio/${confirmConfig.id}`, {
        method: 'DELETE'
      });
      fetchPortfolio();
    } catch (err) {
      console.error("Error deleting trade", err);
    }
    setConfirmConfig({ isOpen: false, id: null });
  };

  const addToWatchlist = async (e, symbol) => {
    e.stopPropagation();
    try {
      await fetch('http://localhost:5000/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      setAlertConfig({ isOpen: true, title: 'Success', message: `Added ${symbol} to Watchlist!` });
    } catch (err) {
      console.error("Error adding to watchlist", err);
      setAlertConfig({ isOpen: true, title: 'Error', message: 'Failed to add to Watchlist.' });
    }
  };

  const getTradingViewSymbol = (sym) => {
    if(!sym) return 'AAPL';
    // Let TradingView auto-resolve the best exchange instead of forcing BSE
    return sym.replace('.NS', '').replace('.BO', '');
  };

  // Calculate Total Portfolio Stats
  let totalInvested = 0;
  let totalCurrentValue = 0;
  portfolio.forEach(item => {
    const currentPrice = item.currentPrice || item.buyPrice;
    totalInvested += (item.buyPrice * item.quantity);
    totalCurrentValue += (currentPrice * item.quantity);
  });
  
  let totalRealizedProfit = 0;
  history.forEach(item => {
    totalRealizedProfit += item.realizedProfit;
  });
  
  const totalUnrealizedProfitLoss = totalCurrentValue - totalInvested;
  const totalIsProfit = totalUnrealizedProfitLoss >= 0;
  const totalPLPercentage = totalInvested > 0 ? ((totalUnrealizedProfitLoss / totalInvested) * 100).toFixed(2) : 0;

  const totalNetGains = totalUnrealizedProfitLoss + totalRealizedProfit;

  if (loading) return <div className="loader-container"><div className="loader"></div></div>;

  return (
    <>
      <div className="animate-fade-in">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginBottom: '20px'}}>
          <div>
            <h1 className="page-title" style={{display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap'}}>
              Portfolio Overview
              <span style={{fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500'}}>
                <div style={{width: '6px', height: '6px', background: 'var(--success)', borderRadius: '50%', boxShadow: '0 0 8px var(--success)'}}></div>
                Live Updates
              </span>
            </h1>
            <p className="page-subtitle">Your actively monitored AI trading assets.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>+ Add Trade</button>
        </div>

        {/* Global Portfolio Summary */}
        <div className="glass-card" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Active Invested</p>
            <h2 style={{ margin: 0 }}>₹{totalInvested.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h2>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Live Value (Unrealized)</p>
            <h2 style={{ margin: 0, color: totalIsProfit ? 'var(--success)' : 'var(--danger)' }}>
              ₹{totalCurrentValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </h2>
            <span style={{ color: totalIsProfit ? 'var(--success)' : 'var(--danger)', fontSize: '0.9rem', fontWeight: 'bold' }}>
              {totalIsProfit ? '+' : ''}₹{totalUnrealizedProfitLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ({totalIsProfit ? '+' : ''}{totalPLPercentage}%)
            </span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Banked History (Realized)</p>
            <h2 style={{ margin: 0, color: totalRealizedProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {totalRealizedProfit >= 0 ? '+' : ''}₹{totalRealizedProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </h2>
            <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 'bold' }}>
              Net Gains: <span style={{ color: totalNetGains >= 0 ? 'var(--success)' : 'var(--danger)' }}>{totalNetGains >= 0 ? '+' : ''}₹{totalNetGains.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            </span>
          </div>
        </div>

        {portfolio.length === 0 ? (
          <div className="glass-card" style={{textAlign: 'center', padding: '40px'}}>
            <h3 style={{color: 'var(--text-secondary)'}}>No stocks in portfolio.</h3>
            <p style={{marginTop: '12px'}}>Click "Add Trade" or send a message to your Telegram bot.</p>
          </div>
        ) : (
          <div className="dashboard-grid">
            {portfolio.map((item) => {
              const hasLivePrice = item.currentPrice !== null && item.currentPrice !== undefined;
              const currentPrice = hasLivePrice ? item.currentPrice : item.buyPrice;
              const profitLoss = (currentPrice - item.buyPrice) * item.quantity;
              const isProfit = profitLoss >= 0;
              const plPercentage = ((currentPrice - item.buyPrice) / item.buyPrice) * 100;

              return (
                <div 
                  key={item._id} 
                  className="glass-card clickable-card" 
                  onClick={() => setActiveChartSymbol(item.symbol)}
                  title="Click to view 5-Year Chart"
                >
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px'}}>
                    <div>
                      <h2 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '8px'}}>
                        {item.symbol}
                        <button 
                          onClick={(e) => openSellModal(e, item)} 
                          style={{background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', color: 'var(--success)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px', fontWeight: '600'}}
                          title="Sell Stock"
                        >
                          Sell
                        </button>
                        <button 
                          onClick={(e) => triggerDelete(e, item._id)} 
                          style={{background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: '4px'}}
                          title="Remove Stock Without Selling"
                        >
                          🗑️
                        </button>
                      </h2>
                      <span style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>Qty: {item.quantity}</span>
                      <div style={{marginTop: '6px', fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '6px 8px', borderRadius: '6px', display: 'inline-block'}}>
                        <div style={{color: 'var(--text-secondary)'}}>🛒 Bought: <strong>{new Date(item.createdAt).toLocaleDateString()}</strong></div>
                        {(() => {
                           const daysHeld = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                           const daysLeft = 5 - daysHeld;
                           return (
                             <div style={{marginTop: '4px', color: daysLeft <= 1 ? 'var(--danger)' : 'var(--warning)', fontWeight: daysLeft <= 1 ? 'bold' : 'normal'}}>
                               ⏳ Time-Stop: {daysLeft > 0 ? `${daysLeft} days remaining` : '⚠️ EXPIRED (SELL NOW)'}
                             </div>
                           );
                        })()}
                      </div>
                    </div>
                    <span className={`badge ${!hasLivePrice ? 'hold' : isProfit ? 'buy' : 'sell'}`}>
                      {!hasLivePrice ? 'API Blocked' : `${isProfit ? '+' : ''}${plPercentage.toFixed(2)}%`}
                    </span>
                  </div>
                  
                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between'}}>
                      <span style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>Buy Price (Avg)</span>
                      <strong style={{fontSize: '0.9rem'}}>₹{item.buyPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'space-between'}}>
                      <span style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>Current Price</span>
                      <strong style={{fontSize: '0.9rem', color: !hasLivePrice ? 'var(--text-secondary)' : isProfit ? 'var(--success)' : 'var(--danger)'}}>
                        {!hasLivePrice ? 'Unavailable' : `₹${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
                      </strong>
                    </div>
                    <hr style={{border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0'}} />
                    <div style={{display: 'flex', justifyContent: 'space-between'}}>
                      <span style={{color: 'var(--text-secondary)'}}>Invested Value</span>
                      <strong>₹{(item.buyPrice * item.quantity).toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'space-between'}}>
                      <span style={{color: 'var(--text-secondary)'}}>Current Value</span>
                      <strong style={{color: !hasLivePrice ? 'var(--text-secondary)' : isProfit ? 'var(--success)' : 'var(--danger)'}}>
                        {!hasLivePrice ? 'Unavailable' : `₹${(currentPrice * item.quantity).toLocaleString(undefined, {minimumFractionDigits: 2})}`}
                      </strong>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginTop: '4px'}}>
                      <span style={{color: 'var(--text-secondary)'}}>Total Return</span>
                      <strong style={{color: !hasLivePrice ? 'var(--text-secondary)' : isProfit ? 'var(--success)' : 'var(--danger)'}}>
                        {!hasLivePrice ? 'Unavailable' : `${isProfit ? '+' : '-'}₹${Math.abs(profitLoss).toLocaleString(undefined, {minimumFractionDigits: 2})}`}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Market Movers Section */}
        {(movers.gainers.length > 0 || movers.losers.length > 0) && (
          <div style={{ marginTop: '40px' }}>
            <h2 className="page-title" style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Today's Market Movers</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
              
              {/* Top Gainers */}
              <div className="glass-card" style={{ background: 'rgba(16, 185, 129, 0.02)', borderColor: 'rgba(16, 185, 129, 0.1)' }}>
                <h3 style={{ color: 'var(--success)', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📈 Top Gainers
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {movers.gainers.map((g, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{cursor: 'pointer'}} onClick={() => setActiveChartSymbol(g.symbol)}>
                        <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{g.symbol}</strong>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{g.name?.substring(0, 20)}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ color: 'var(--success)', display: 'block' }}>+{g.changePercent?.toFixed(2)}%</strong>
                        <button className="btn" style={{ background: 'transparent', color: 'var(--accent-blue)', padding: '0', fontSize: '0.8rem' }} onClick={(e) => addToWatchlist(e, g.symbol)}>+ Watchlist</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Losers */}
              <div className="glass-card" style={{ background: 'rgba(239, 68, 68, 0.02)', borderColor: 'rgba(239, 68, 68, 0.1)' }}>
                <h3 style={{ color: 'var(--danger)', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📉 Top Losers
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {movers.losers.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{cursor: 'pointer'}} onClick={() => setActiveChartSymbol(l.symbol)}>
                        <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{l.symbol}</strong>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{l.name?.substring(0, 20)}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ color: 'var(--danger)', display: 'block' }}>{l.changePercent?.toFixed(2)}%</strong>
                        <button className="btn" style={{ background: 'transparent', color: 'var(--accent-blue)', padding: '0', fontSize: '0.8rem' }} onClick={(e) => addToWatchlist(e, l.symbol)}>+ Watchlist</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Add Trade Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in">
            <button className="btn-close" onClick={() => setIsModalOpen(false)}>×</button>
            <h2>Add Trade</h2>
            <form onSubmit={handleAddTrade} style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <div className="form-group">
                <label>Company Name</label>
                <SymbolSearch 
                  onSelect={(symbol) => setFormData({...formData, symbol})} 
                  placeholder="Search company (e.g., Zomato)..."
                />
              </div>
              <div className="form-group">
                <label>Buy Price (₹) - <span style={{color: 'var(--accent-blue)'}}>Leave blank for Auto Live Price</span></label>
                <input type="number" step="0.01" value={formData.buyPrice} onChange={(e) => setFormData({...formData, buyPrice: e.target.value})} placeholder="Auto-fetch live price..." />
              </div>
              <div className="form-group">
                <label>Quantity</label>
                <input type="number" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: e.target.value})} placeholder="1" />
              </div>
              <button type="submit" className="btn btn-primary" style={{width: '100%', marginTop: '16px'}}>Save Trade</button>
            </form>
          </div>
        </div>
      )}

      {/* Advanced TradingView Chart Modal */}
      {activeChartSymbol && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '1000px', width: '95%', height: '80vh', display: 'flex', flexDirection: 'column', padding: '16px', margin: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, color: 'var(--accent-blue)' }}>{activeChartSymbol} Chart</h2>
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

      {/* Reusable Confirm Delete Modal */}
      <ConfirmModal 
        isOpen={confirmConfig.isOpen}
        title="Remove Stock"
        message="Are you sure you want to remove this stock from your portfolio?"
        confirmText="Remove"
        isDanger={true}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmConfig({ isOpen: false, id: null })}
      />

      {/* Reusable Alert Modal */}
      <ConfirmModal 
        isOpen={alertConfig.isOpen}
        title={alertConfig.title}
        message={alertConfig.message}
        confirmText="OK"
        isAlert={true}
        onConfirm={() => setAlertConfig({ isOpen: false, title: '', message: '' })}
      />
      {isSellModalOpen && (
        <div className="modal-overlay animate-fade-in" onClick={() => setIsSellModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
              <h2 style={{margin: 0}}>Log Sale: {sellData.symbol}</h2>
              <button style={{background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '1.2rem'}} onClick={() => setIsSellModalOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSellTrade} style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <div className="form-group">
                <label>Sell Price (₹)</label>
                <input 
                  type="number" 
                  step="0.01"
                  required 
                  className="form-input" 
                  value={sellData.sellPrice}
                  onChange={e => setSellData({...sellData, sellPrice: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Quantity to Sell (Max: {sellData.maxQty})</label>
                <input 
                  type="number" 
                  min="1"
                  max={sellData.maxQty}
                  required 
                  className="form-input" 
                  value={sellData.quantity}
                  onChange={e => setSellData({...sellData, quantity: e.target.value})}
                />
              </div>
              <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px'}}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsSellModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{background: 'var(--danger)', borderColor: 'var(--danger)'}}>Confirm Sell</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default Dashboard;
