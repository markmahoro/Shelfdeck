import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config } from '../api/client';
import type { ServiceConfig } from '../types';

const PAGE_TITLE: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  marginBottom: '24px',
};

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px',
};

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '14px',
  color: '#444',
  marginBottom: '6px',
};

const INPUT: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
  width: '100%',
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '8px 20px',
  background: '#4a90d9',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
};

export default function PathMappingPage() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useQuery<ServiceConfig>({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const [pathMapFrom, setPathMapFrom] = useState(cfg?.pathMapFrom || '');
  const [pathMapTo, setPathMapTo] = useState(cfg?.pathMapTo || '');

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<ServiceConfig>) => config.patch(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  if (isLoading) return <div style={{ padding: 24 }}>加载中...</div>;

  return (
    <div>
      <h2 style={PAGE_TITLE}>路径映射</h2>
      <div style={CARD}>
        <p
          style={{
            fontSize: '13px',
            color: '#666',
            marginBottom: '16px',
          }}
        >
          当 media-service 与桌面运行在不同机器时，配置路径映射使转码输出能正确回写。
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr',
            gap: '12px',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <label style={LABEL}>映射源路径（桌面）</label>
          <input
            style={INPUT}
            value={pathMapFrom}
            onChange={(e) => setPathMapFrom(e.target.value)}
            placeholder="D:\\media"
          />
          <label style={LABEL}>映射目标路径（服务端）</label>
          <input
            style={INPUT}
            value={pathMapTo}
            onChange={(e) => setPathMapTo(e.target.value)}
            placeholder="\\\\NAS\\media"
          />
        </div>
        <button
          style={BTN_PRIMARY}
          onClick={() => saveMutation.mutate({ pathMapFrom, pathMapTo })}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
