import { useState, FormEvent } from 'react';
import { auth } from '../api/client';

export default function SetupPage() {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (pin !== confirm) {
      setError('两次输入的 PIN 不一致');
      return;
    }
    if (pin.length < 4) {
      setError('PIN 至少 4 位');
      return;
    }
    setLoading(true);
    try {
      await auth.setPin(pin);
      window.location.href = '/admin/login';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>🖥️</div>
        <h1 style={titleStyle}>设置管理员 PIN</h1>
        <p style={subtitleStyle}>
          首次使用请设置管理员 PIN（至少 4 位）
        </p>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>输入 PIN</label>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={inputStyle}
            placeholder="请输入 PIN"
            required
            minLength={4}
          />
          <label style={labelStyle}>确认 PIN</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={inputStyle}
            placeholder="请再次输入 PIN"
            required
            minLength={4}
          />
          {error && <div style={errorStyle}>{error}</div>}
          <button type="submit" style={btnStyle} disabled={loading}>
            {loading ? '设置中...' : '设置 PIN'}
          </button>
        </form>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  background: '#f0f2f5',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '12px',
  padding: '40px',
  width: '360px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
};

const logoStyle: React.CSSProperties = {
  fontSize: '32px',
  textAlign: 'center',
  marginBottom: '8px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  textAlign: 'center',
  marginBottom: '8px',
  color: '#1a1a2e',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  marginBottom: '24px',
  textAlign: 'center',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: '#444',
  marginBottom: '6px',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #ddd',
  borderRadius: '8px',
  fontSize: '16px',
  marginBottom: '16px',
  outline: 'none',
};

const errorStyle: React.CSSProperties = {
  color: '#e53',
  fontSize: '13px',
  marginBottom: '12px',
  textAlign: 'center',
};

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  background: '#4a90d9',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};
