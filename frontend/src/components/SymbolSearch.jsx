import React, { useState, useEffect, useRef } from 'react';

const SymbolSearch = ({ onSelect, placeholder = "Type company name (e.g., Zomato, Tata Motors)..." }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const dropdownRef = useRef(null);

  // Debounce search
  useEffect(() => {
    if (!query) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      // Don't search if the query perfectly matches an already selected result
      // to prevent spamming search after selection
      if(query.includes('(') && query.includes(')')) return;

      setLoading(true);
      try {
        const response = await fetch(`http://localhost:5000/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        setResults(data);
        setShowDropdown(true);
      } catch (err) {
        console.error("Search error", err);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (stock) => {
    setQuery(`${stock.shortname} (${stock.symbol})`);
    setShowDropdown(false);
    if (onSelect) {
      onSelect(stock.symbol);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={dropdownRef}>
      <input 
        type="text" 
        placeholder={placeholder}
        value={query} 
        onChange={(e) => {
          setQuery(e.target.value);
          // If user starts typing again, clear the parent symbol so they have to pick a real one
          if(onSelect) onSelect('');
        }}
        onFocus={() => { if(results.length > 0) setShowDropdown(true); }}
        required
        style={{ width: '100%' }}
      />
      
      {showDropdown && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'rgba(11, 15, 25, 0.95)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--glass-border)',
          borderRadius: '8px',
          marginTop: '4px',
          maxHeight: '250px',
          overflowY: 'auto',
          zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
        }}>
          {loading ? (
            <div style={{ padding: '12px', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.9rem' }}>Searching...</div>
          ) : results.length > 0 ? (
            results.map((stock, idx) => (
              <div 
                key={idx}
                onClick={() => handleSelect(stock)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: '500', marginBottom: '2px' }}>{stock.shortname}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{stock.exchange}</div>
                </div>
                <div style={{ color: 'var(--accent-blue)', fontWeight: 'bold', fontSize: '0.9rem' }}>{stock.symbol}</div>
              </div>
            ))
          ) : (
            <div style={{ padding: '12px', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.9rem' }}>No companies found.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default SymbolSearch;
