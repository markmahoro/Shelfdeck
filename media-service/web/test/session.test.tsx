import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AdminApiError, adminAuthErrorCopy, helixAdminApi } from '../src/helix/api';

describe('Admin auth copy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps session and credential codes to Chinese without exposing the code', () => {
    expect(adminAuthErrorCopy('ADMIN_CREDENTIAL_INVALID')).toBe('管理凭据验证失败。');
    expect(adminAuthErrorCopy('ADMIN_SESSION_INVALID')).toBe('管理会话已失效，请重新登录。');
    expect(adminAuthErrorCopy('ADMIN_SESSION_EXPIRED')).toBe('管理会话已过期，请重新登录。');
    expect(adminAuthErrorCopy('ADMIN_CREDENTIAL_INVALID', 'ADMIN_CREDENTIAL_INVALID')).toBe('管理凭据验证失败。');
    expect(adminAuthErrorCopy('HTTP_500', '请求未完成。')).toBe('请求未完成。');
  });

  it('shows Chinese login copy instead of ADMIN_CREDENTIAL_INVALID', async () => {
    vi.spyOn(helixAdminApi, 'getOverview').mockRejectedValue(
      new AdminApiError(401, 'ADMIN_SESSION_INVALID', 'ADMIN_SESSION_INVALID'),
    );
    vi.spyOn(helixAdminApi, 'createSession').mockRejectedValue(
      new AdminApiError(401, 'ADMIN_CREDENTIAL_INVALID', 'ADMIN_CREDENTIAL_INVALID'),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '进入管理台' })).toBeInTheDocument();
    expect(screen.queryByText('ADMIN_SESSION_INVALID')).not.toBeInTheDocument();
    expect(screen.queryByText('ADMIN_CREDENTIAL_INVALID')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('管理凭据'), { target: { value: 'wrong-admin-key' } });
    fireEvent.click(screen.getByRole('button', { name: '进入管理台' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('管理凭据验证失败。');
    expect(screen.queryByText('ADMIN_CREDENTIAL_INVALID')).not.toBeInTheDocument();
  });
});
