import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`btn btn-${variant} ${className}`.trim()} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <header className="page-header">
    <div>
      <h1>{title}</h1>
      {description && <p className="page-lede">{description}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function LoadingState({ children, skeleton }: { children: ReactNode; skeleton?: 'rows' | 'posters' }) {
  return <div className={`source-page-loading${skeleton ? ' quiet-loading' : ''}`} role="status" aria-live="polite">
    <span>{children}</span>
    {skeleton && <div className={`quiet-loading-${skeleton}`} aria-hidden="true">
      {Array.from({length:skeleton === 'posters' ? 8 : 3},(_,index)=><div className="quiet-loading-placeholder" key={index}><i/><i/></div>)}
    </div>}
  </div>;
}

export function ReadProgress({ active }: { active: boolean }) {
  return <div className="quiet-read-track" aria-hidden="true">{active && <span/>}</div>;
}
