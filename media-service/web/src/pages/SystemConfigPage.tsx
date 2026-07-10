import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subLibraries } from '../api/client';
import type { SubLibrary } from '../types';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

type Mode = 'auto' | 'manual';

export default function SystemConfigPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['helix-automation-libraries'], queryFn: subLibraries.list });
  const update = useMutation({
    mutationFn: ({ library, patch }: { library: SubLibrary; patch: Partial<SubLibrary> }) => subLibraries.update(library.uuid, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['helix-automation-libraries'] }),
  });
  if (query.isLoading) return <LoadingSpinner text="加载两层自动化配置..." />;
  return <div style={{ padding: 24 }}>
    <h2 style={{ margin: '0 0 8px' }}>Helix 两层自动化</h2>
    <p style={{ color: '#64748b', lineHeight: 1.6 }}>
      Library Automation 负责观察与 onboarding；Maintenance Automation 只处理已 admission 条目的 Basedata、Metadata 和 Optimize。审批与破坏性授权不受“全自动”预设影响。
    </p>
    {query.error && <Alert type="error" message={(query.error as Error).message} />}
    {update.error && <Alert type="error" message={(update.error as Error).message} />}
    <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
      {(query.data?.subLibraries || []).map((library) => <section key={library.uuid} style={card}>
        <div><strong>{library.name}</strong><div style={muted}>{library.source} · {library.mediaType || 'media'}</div></div>
        <ModeControl label="Library Automation" value={library.libraryAutomationMode || 'manual'} disabled={update.isPending}
          onChange={(mode) => update.mutate({ library, patch: { libraryAutomationMode: mode } })} />
        <ModeControl label="Maintenance Automation" value={library.maintenanceAutomationMode || 'manual'} disabled={update.isPending}
          onChange={(mode) => update.mutate({ library, patch: { maintenanceAutomationMode: mode } })} />
        <button style={preset} disabled={update.isPending} onClick={() => update.mutate({ library, patch: { libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto' } })}>
          设为全自动
        </button>
      </section>)}
      {(query.data?.subLibraries || []).length === 0 && <div style={empty}>尚未创建媒体库。</div>}
    </div>
  </div>;
}

function ModeControl({ label, value, disabled, onChange }: { label: string; value: Mode; disabled: boolean; onChange: (mode: Mode) => void }) {
  return <div><div style={labelStyle}>{label}</div><div style={{ display: 'flex', gap: 6 }}>
    {(['auto', 'manual'] as Mode[]).map((mode) => <button key={mode} disabled={disabled} onClick={() => onChange(mode)}
      style={mode === value ? activeMode : modeButton}>{mode === 'auto' ? '自动' : '手动'}</button>)}
  </div></div>;
}

const card = { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(190px,1fr) minmax(210px,1fr) auto', alignItems: 'center', gap: 16, padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 };
const muted = { marginTop: 5, color: '#64748b', fontSize: 12 };
const labelStyle = { marginBottom: 7, color: '#475569', fontSize: 12, fontWeight: 700 };
const modeButton = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#334155' };
const activeMode = { ...modeButton, background: '#1e293b', borderColor: '#1e293b', color: '#fff' };
const preset = { padding: '9px 13px', border: 0, borderRadius: 6, background: '#2563eb', color: '#fff', fontWeight: 700 };
const empty = { padding: 24, textAlign: 'center' as const, color: '#64748b', background: '#fff', borderRadius: 8 };
