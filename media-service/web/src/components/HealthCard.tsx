interface HealthCardProps {
  status: 'green' | 'yellow' | 'red';
  checks?: Record<string, { status: string; message?: string }>;
}

const COLORS: Record<string, string> = {
  green: '#27ae60',
  yellow: '#f39c12',
  red: '#e74c3c',
};

const LABELS: Record<string, string> = {
  green: '正常',
  yellow: '降级',
  red: '异常',
};

export default function HealthCard({ status, checks }: HealthCardProps) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 10,
        padding: 20,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        borderLeft: `4px solid ${COLORS[status]}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: checks ? 16 : 0 }}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: COLORS[status],
          }}
        />
        <span style={{ fontSize: 16, fontWeight: 600 }}>服务状态：{LABELS[status]}</span>
      </div>
      {checks && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {Object.entries(checks).map(([key, item]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: '#f9fafb',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: COLORS[item.status] || '#999',
                }}
              />
              <span style={{ fontWeight: 500 }}>{key}</span>
              {item.message && <span style={{ color: '#888' }}>{item.message}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
