import React, { useEffect, useState } from 'react';

const Logs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = () => {
    fetch('http://localhost:5000/api/logs')
      .then(res => res.json())
      .then(data => {
        if(Array.isArray(data)) {
          setLogs(data);
        } else {
          console.error("API returned error:", data);
          setLogs([]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching logs:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLogs();
    const intervalId = setInterval(fetchLogs, 120000);
    return () => clearInterval(intervalId);
  }, []);

  if (loading) return <div className="loader-container"><div className="loader"></div></div>;

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">AI Decision History</h1>
      <p className="page-subtitle">A complete log of every recommendation the AI has ever made.</p>

      {logs.length === 0 ? (
        <div className="glass-card" style={{textAlign: 'center', padding: '40px'}}>
          <h3 style={{color: 'var(--text-secondary)'}}>No AI logs yet.</h3>
          <p style={{marginTop: '12px'}}>The AI runs at 9:30 AM every day to generate decisions.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '24px' }}>
          {logs.map((log) => (
            <div key={log._id} className="glass-card" style={{borderLeft: `4px solid ${log.action === 'BUY' ? 'var(--success)' : log.action === 'SELL' ? 'var(--danger)' : 'var(--warning)'}`}}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0 }}>{log.symbol}</h3>
                <span className={`badge ${log.action.toLowerCase()}`}>{log.action}</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>{log.reasoning}</p>
              <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Analyzed on: {new Date(log.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Logs;
