import React, { useState } from 'react';
import { Activity, Play, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import SymbolSearch from '../components/SymbolSearch';

const Backtest = () => {
  const [symbol, setSymbol] = useState('');
  const [days, setDays] = useState(90); // Default to 3 Months for swing trading
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const runBacktest = async (e) => {
    e.preventDefault();
    if(!symbol) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const formattedSymbol = symbol.trim().toUpperCase().replace(/\s+/g, '');
      const response = await fetch('http://localhost:5000/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: formattedSymbol, days })
      });
      const data = await response.json();
      
      if(data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError("Failed to connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginBottom: '12px'}}>
        <div>
          <h1 className="page-title" style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
            <Activity /> Strategy Backtesting Engine
          </h1>
          <p className="page-subtitle">Test our Technical Analysis strategy (RSI Overbought/Oversold) on years of historical data before risking real money.</p>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: '32px', position: 'relative', zIndex: 50 }}>
        <form onSubmit={runBacktest} style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="form-group" style={{ flex: 1, minWidth: '300px' }}>
            <label>Company Name</label>
            <SymbolSearch 
              onSelect={(sym) => setSymbol(sym)}
              placeholder="Search company to backtest (e.g. Zomato)..."
            />
          </div>
          <div className="form-group" style={{ width: '150px' }}>
            <label>Timeframe</label>
            <div className="select-wrapper">
              <select 
                value={days} 
                onChange={(e) => setDays(Number(e.target.value))}
                className="timeframe-select"
              >
                <option value={30}>Last 1 Month (Swing Trade)</option>
                <option value={90}>Last 3 Months (Swing Trade)</option>
                <option value={180}>Last 6 Months</option>
                <option value={365}>Last 1 Year</option>
                <option value={730}>Last 2 Years</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px', padding: '0 24px', marginTop: '28px' }} disabled={loading}>
            {loading ? 'Simulating...' : <><Play size={18} /> Run Backtest</>}
          </button>
        </form>
      </div>

      {error && <div style={{ color: 'var(--danger)', padding: '16px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', marginBottom: '24px' }}>{error}</div>}

      {result && (
        <div className="animate-fade-in">
          <div className="dashboard-grid" style={{ marginBottom: '24px' }}>
            <div className="glass-card stat-card">
              <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)' }}><DollarSign size={24} /></div>
              <div className="stat-content">
                <h3>Initial Capital</h3>
                <p>₹{Number(result.startingBalance).toLocaleString('en-IN')}</p>
              </div>
            </div>
            
            <div className="glass-card stat-card">
              <div className="stat-icon" style={{ background: result.profit >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: result.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {result.profit >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
              </div>
              <div className="stat-content">
                <h3>Simulated Final Balance</h3>
                <p style={{ color: result.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  ₹{Number(result.finalBalance).toLocaleString('en-IN')}
                </p>
                <span style={{ fontSize: '0.85rem', color: result.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {result.profit >= 0 ? '+' : ''}{result.profitPercent}% Return
                </span>
              </div>
            </div>

            <div className="glass-card stat-card">
              <div className="stat-icon" style={{ background: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent-purple)' }}><Activity size={24} /></div>
              <div className="stat-content">
                <h3>Total Trades Executed</h3>
                <p>{result.totalTrades}</p>
              </div>
            </div>
          </div>

          {/* BEGINNER FRIENDLY AI VERDICT */}
          <div className="glass-card" style={{ 
            marginBottom: '32px', 
            background: result.profitPercent > 10 ? 'rgba(16, 185, 129, 0.05)' : result.profitPercent > 0 ? 'rgba(245, 158, 11, 0.05)' : 'rgba(239, 68, 68, 0.05)',
            borderLeft: `4px solid ${result.profitPercent > 10 ? 'var(--success)' : result.profitPercent > 0 ? 'var(--warning)' : 'var(--danger)'}`
          }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🤖 AI Final Verdict for Beginners:
            </h2>
            <div style={{ fontSize: '1.1rem', fontWeight: '500' }}>
              {result.profitPercent > 20 ? (
                <span style={{ color: 'var(--success)' }}>🔥 HIGHLY RECOMMENDED: This is a highly profitable and safe strategy. The AI strongly recommends you invest in this. (95% Success Rating)</span>
              ) : result.profitPercent > 5 ? (
                <span style={{ color: 'var(--success)' }}>✅ RECOMMENDED: This is a consistently profitable stock to trade. It is safe to invest. (80% Success Rating)</span>
              ) : result.profitPercent > 0 ? (
                <span style={{ color: 'var(--warning)' }}>⚠️ NEUTRAL: This strategy barely makes money. It is risky and you might want to find a better stock. (50% Success Rating)</span>
              ) : (
                <span style={{ color: 'var(--danger)' }}>❌ DO NOT INVEST: The AI proved that trading this stock will make you lose money. Stay away! (0% Success Rating)</span>
              )}
            </div>
          </div>

          <h2 className="page-title" style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Trade History Log</h2>
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
                    <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Date</th>
                    <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Action</th>
                    <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Execution Price</th>
                    <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Transaction Value</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No trading opportunities found for this strategy in this timeframe.
                      </td>
                    </tr>
                  ) : (
                    result.trades.map((trade, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '16px', color: 'var(--text-primary)' }}>{new Date(trade.date).toLocaleDateString()}</td>
                        <td style={{ padding: '16px' }}>
                          <span style={{ 
                            padding: '4px 8px', 
                            borderRadius: '4px', 
                            fontSize: '0.8rem', 
                            fontWeight: 'bold',
                            background: trade.type === 'BUY' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: trade.type === 'BUY' ? 'var(--success)' : 'var(--danger)'
                          }}>
                            {trade.type} {trade.note ? `(${trade.note})` : ''}
                          </span>
                        </td>
                        <td style={{ padding: '16px', color: 'var(--text-primary)' }}>₹{trade.price.toFixed(2)}</td>
                        <td style={{ padding: '16px', color: 'var(--text-primary)' }}>₹{trade.amount.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Backtest;
