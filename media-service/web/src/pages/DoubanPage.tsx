import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { douban } from '../api/client';
import type { DoubanSession, DoubanRatingsCache } from '../types';

const PAGE_TITLE: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  marginBottom: '24px',
};

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px',
  marginBottom: '16px',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  marginBottom: '16px',
};

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: '#444',
  marginBottom: '6px',
};

const TEXTAREA: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
  resize: 'vertical',
  fontFamily: 'monospace',
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

export default function DoubanPage() {
  const [cookie, setCookie] = useState('');
  const qc = useQueryClient();

  const { data: session } = useQuery<DoubanSession>({
    queryKey: ['douban', 'session'],
    queryFn: douban.getSession,
  });

  const { data: ratings = {} } = useQuery<DoubanRatingsCache>({
    queryKey: ['douban', 'ratings'],
    queryFn: douban.getRatingsCache,
  });

  const saveSessionMutation = useMutation({
    mutationFn: () => douban.saveSession({ cookie }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['douban', 'session'] }),
  });

  const ratedCount = Object.keys(ratings).length;
  const ratingEntries = Object.entries(ratings).slice(0, 50);

  return (
    <div>
      <h2 style={PAGE_TITLE}>豆瓣集成</h2>

      <div style={CARD}>
        <h3 style={SECTION_TITLE}>Session 管理</h3>
        <div style={{ marginBottom: '16px' }}>
          <label style={LABEL}>Douban Cookie</label>
          <textarea
            style={{ ...TEXTAREA, height: '80px' }}
            value={cookie || session?.cookie || ''}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="Paste Douban cookie here..."
          />
        </div>
        <button
          style={BTN_PRIMARY}
          onClick={() => saveSessionMutation.mutate()}
          disabled={saveSessionMutation.isPending}
        >
          {saveSessionMutation.isPending ? '保存中...' : '保存 Session'}
        </button>
      </div>

      <div style={CARD}>
        <h3 style={SECTION_TITLE}>评分缓存</h3>
        <div
          style={{
            fontSize: '14px',
            color: '#666',
            marginBottom: '12px',
          }}
        >
          共 {ratedCount} 条豆瓣评分已缓存
        </div>
        {ratingEntries.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            {ratingEntries.map(([itemId, { rating }]) => (
              <div
                key={itemId}
                style={{
                  padding: '8px',
                  background: '#f9fafb',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 600 }}>{itemId}</div>
                <div style={{ color: '#f39c12' }}>★ {rating}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#888', fontSize: '14px' }}>暂无缓存评分</div>
        )}
      </div>
    </div>
  );
}
