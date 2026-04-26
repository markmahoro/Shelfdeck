/**
 * [CONNECTION] 连接门禁组件。
 * service 不可达时覆盖内容区，显示引导界面。
 */

import { useState, useEffect, type ReactNode } from 'react';
import { checkHealth } from './health';

type ConnectionGateProps = {
  children: ReactNode;
  onSettingsOpen: () => void;
};

const OVERLAY: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 40,
};

export default function ConnectionGate({ children, onSettingsOpen }: ConnectionGateProps) {
  const [healthy, setHealthy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const ok = await checkHealth();
      if (!active) return;
      setHealthy(ok);
      setChecking(false);
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (checking) {
    return (
      <div style={OVERLAY}>
        <p style={{ color: '#888', fontSize: 14 }}>正在连接媒体管理服务...</p>
      </div>
    );
  }

  if (!healthy) {
    return (
      <div style={OVERLAY}>
        <h2 style={{ margin: 0, color: '#333', fontSize: 18 }}>媒体管理服务未连接</h2>
        <p style={{ margin: 0, color: '#888', fontSize: 14, maxWidth: 400, textAlign: 'center' }}>
          无法连接媒体管理服务。请确认服务已启动，或手动配置服务地址。
        </p>
        <button
          type="button"
          onClick={onSettingsOpen}
          style={{
            padding: '8px 24px',
            background: '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          打开设置
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
