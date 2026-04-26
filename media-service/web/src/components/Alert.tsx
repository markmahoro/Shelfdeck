import { useEffect, useState } from 'react';

interface AlertProps {
  type: 'success' | 'error';
  message: string;
  onClose?: () => void;
  autoCloseMs?: number;
}

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
  error: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
};

export default function Alert({ type, message, onClose, autoCloseMs }: AlertProps) {
  const [visible, setVisible] = useState(true);
  const c = COLORS[type];

  useEffect(() => {
    if (autoCloseMs && autoCloseMs > 0) {
      const t = setTimeout(() => { setVisible(false); onClose?.(); }, autoCloseMs);
      return () => clearTimeout(t);
    }
  }, [autoCloseMs, onClose]);

  if (!visible) return null;

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        padding: '10px 16px',
        borderRadius: 8,
        marginBottom: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 14,
      }}
    >
      <span>{message}</span>
      <button
        onClick={() => { setVisible(false); onClose?.(); }}
        style={{ background: 'none', border: 'none', color: c.text, cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}
