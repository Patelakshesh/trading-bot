import React from 'react';

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = "Confirm", cancelText = "Cancel", isDanger = false, isAlert = false }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal-content animate-fade-in" style={{ margin: 'auto', maxWidth: '350px', padding: '24px', textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '1.3rem', color: isDanger ? 'var(--danger)' : (isAlert ? 'var(--success)' : 'var(--text-primary)') }}>
          {title}
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.5' }}>
          {message}
        </p>
        
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          {!isAlert && (
            <button 
              className="btn" 
              style={{ 
                flex: 1, 
                background: 'transparent', 
                border: '1px solid var(--glass-border)', 
                color: 'var(--text-primary)' 
              }} 
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          
          <button 
            className="btn" 
            style={{ 
              flex: 1, 
              background: isDanger ? 'var(--danger)' : 'var(--accent-blue)', 
              border: 'none', 
              color: '#fff' 
            }} 
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
