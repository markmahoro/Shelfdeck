import { createContext, FormEvent, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { AdminApiError, helixAdminApi } from './api';

type SessionStatus = 'ready' | 'required';

type SessionContextValue = {
  status: SessionStatus;
  expire: () => void;
  signIn: (apiKey: string) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function isUnauthorized(cause: unknown) {
  return cause instanceof AdminApiError && cause.status === 401;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('ready');
  const expire = useCallback(() => setStatus('required'), []);
  const signIn = useCallback(async (apiKey: string) => {
    await helixAdminApi.createSession(apiKey);
    setStatus('ready');
  }, []);
  const value = useMemo(() => ({ status, expire, signIn }), [status, expire, signIn]);
  return <SessionContext.Provider value={value}>{status === 'required' ? <AuthScreen /> : children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider is required.');
  return value;
}

function AuthScreen() {
  const { signIn } = useSession();
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(apiKey.trim());
      setApiKey('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '管理凭据验证失败。');
    } finally {
      setLoading(false);
    }
  }
  return <section className="auth-stage">
    <div className="auth-card">
      <h1>进入管理台</h1>
      <p>输入本机管理凭据。凭据只用于换取当前会话，不会保存在浏览器中。</p>
      <form onSubmit={submit} className="auth-form">
        <label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="current-password" required /></label>
        <button className="btn btn-primary" type="submit" disabled={loading || !apiKey.trim()}>{loading ? '正在验证…' : '进入管理台'}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </section>;
}
