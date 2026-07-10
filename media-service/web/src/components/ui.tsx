import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';
import Icon from './Icon';

export function Page({ children }: PropsWithChildren) { return <div className="page">{children}</div>; }

export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return <header className="page-header"><div><h1 className="page-title">{title}</h1>{meta && <div className="page-meta">{meta}</div>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function Button({ children, variant = 'default', icon, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'quiet'; icon?: string }) {
  return <button className={`btn ${variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'quiet' ? 'btn-quiet' : ''} ${className}`} {...props}>{icon && <Icon name={icon} width={16} height={16} />}{children}</button>;
}

export function Panel({ title, action, children, className = '' }: PropsWithChildren<{ title?: ReactNode; action?: ReactNode; className?: string }>) {
  return <section className={`panel ${className}`}>{(title || action) && <div className="panel-header">{title && <h2 className="panel-title">{title}</h2>}{action}</div>}<div className="panel-body">{children}</div></section>;
}

export function Status({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'success' | 'attention' | 'danger' | 'neutral' }>) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function Metric({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{note && <div className="metric-note">{note}</div>}</div>;
}

export function Field({ label, children }: PropsWithChildren<{ label: ReactNode }>) { return <label className="field"><span className="field-label">{label}</span>{children}</label>; }

export function Tabs({ items, value, onChange }: { items: Array<{ key: string; label: string }>; value: string; onChange: (key: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item) => <button key={item.key} type="button" role="tab" aria-selected={value === item.key} className={`tab ${value === item.key ? 'active' : ''}`} onClick={() => onChange(item.key)}>{item.label}</button>)}</div>;
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) { return <div className="empty"><div><strong>{title}</strong>{action}</div></div>; }
export function Loading() { return <div className="loading"><span className="spinner" aria-label="加载中" /></div>; }

export function Dialog({ open, title, children, actions, onClose }: PropsWithChildren<{ open: boolean; title: string; actions?: ReactNode; onClose: () => void }>) {
  if (!open) return null;
  return <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><div className="dialog-head"><strong>{title}</strong><Button variant="quiet" className="icon-btn" aria-label="关闭" onClick={onClose}><Icon name="close" width={18} /></Button></div><div className="dialog-body">{children}</div>{actions && <div className="dialog-actions">{actions}</div>}</section></div>;
}

export function Drawer({ open, title, children, onClose }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void }>) {
  if (!open) return null;
  return <div className="drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer" role="dialog" aria-modal="true" aria-label={title}><div className="drawer-head"><strong>{title}</strong><Button variant="quiet" className="icon-btn" aria-label="关闭" onClick={onClose}><Icon name="close" width={18} /></Button></div><div className="drawer-body">{children}</div></aside></div>;
}

export function Diagnostic({ value }: { value: unknown }) { return <details className="diagnostic"><summary>诊断信息</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>; }

export function Toast({ message }: { message?: string }) { return message ? <div className="toast" role="status">{message}</div> : null; }

export class ErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[admin-web] render failed', error, info.componentStack); }
  render() {
    if (this.state.failed) return <main className="fatal-state"><EmptyState title="页面暂时无法显示" action={<Button onClick={() => window.location.reload()}>重新加载</Button>} /></main>;
    return this.props.children;
  }
}
