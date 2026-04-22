import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../api/client';

export function useAuth() {
  const navigate = useNavigate();

  const login = useCallback(
    async (pin: string): Promise<void> => {
      const res = await auth.verifyPin(pin);
      if (res.ok && res.session) {
        sessionStorage.setItem('admin_session', res.session);
        navigate('/admin/', { replace: true });
      } else {
        throw new Error(res.message || 'PIN 错误');
      }
    },
    [navigate],
  );

  const setupPin = useCallback(
    async (pin: string): Promise<void> => {
      await auth.setPin(pin);
      navigate('/admin/login', { replace: true });
    },
    [navigate],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem('admin_session');
    navigate('/admin/login', { replace: true });
  }, [navigate]);

  const hasSession = useCallback((): boolean => {
    return !!sessionStorage.getItem('admin_session');
  }, []);

  return { login, setupPin, logout, hasSession };
}
