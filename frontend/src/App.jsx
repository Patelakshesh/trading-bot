import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { Activity, LayoutDashboard, Newspaper, History, LogOut } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import News from './pages/News';
import Logs from './pages/Logs';
import Watchlist from './pages/Watchlist';
import Explore from './pages/Explore';
import Backtest from './pages/Backtest';
import Login from './pages/Login';
import './index.css';

// Global Fetch Interceptor for Authentication
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  if (url.toString().startsWith('http://localhost:5000/api/') && !url.toString().includes('/login')) {
    const token = localStorage.getItem('adminToken');
    options.headers = {
      ...options.headers,
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }
  const response = await originalFetch(url, options);
  if (response.status === 401 && !url.toString().includes('/login')) {
    localStorage.removeItem('adminToken');
    window.location.href = '/';
  }
  return response;
};

const Navbar = () => {
  return (
    <nav className="sidebar">
      <div className="logo-container">
        <Activity color="#3b82f6" size={28} />
        <span className="logo-text">AI Guardian</span>
      </div>
      <div className="nav-links">
        <NavLink to="/" className={({isActive}) => isActive ? "nav-link active" : "nav-link"} end><LayoutDashboard size={18}/> Portfolio</NavLink>
        <NavLink to="/explore" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}><Activity size={18}/> Market Explorer</NavLink>
        <NavLink to="/watchlist" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}><Activity size={18}/> Watchlist</NavLink>
        <NavLink to="/backtest" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}><Activity size={18}/> Strategy Backtester</NavLink>
        <NavLink to="/news" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}><Newspaper size={18}/> Trending News</NavLink>
        <NavLink to="/logs" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}><History size={18}/> AI Logs</NavLink>
        <button 
          onClick={() => { localStorage.removeItem('adminToken'); window.location.href = '/'; }}
          className="nav-link" 
          style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', marginTop: 'auto', color: 'var(--danger)' }}
        >
          <LogOut size={18} /> Secure Logout
        </button>
      </div>
    </nav>
  );
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('adminToken'));

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <Router>
      <div className="app-container">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/news" element={<News />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
