import { fireEvent, render, screen, cleanup } from '@testing-library/react';
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
    vi.spyOn(helixAdminApi, 'getRuntimeStatus').mockRejectedValue(new AdminApiError(401, 'ADMIN_SESSION_INVALID', 'ADMIN_SESSION_INVALID'));
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

describe('Shared session across all product routes',()=>{
  afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
  it.each(['/','/collection','/formation','/offdeck','/people','/material-fields','/shelves','/settings'])
    ('shows exactly one shared sign-in screen after %s expires',async route=>{
      const fetch=vi.fn(async(..._args:Parameters<typeof globalThis.fetch>)=>new Response(JSON.stringify({error:{code:'ADMIN_SESSION_EXPIRED',message:'Session expired'}}),
        {status:401,headers:{'content-type':'application/json'}}));
      vi.stubGlobal('fetch',fetch);
      render(<MemoryRouter initialEntries={[route]}><App/></MemoryRouter>);
      expect(await screen.findByRole('heading',{name:'进入管理台'})).toBeInTheDocument();
      expect(screen.getAllByLabelText('管理凭据')).toHaveLength(1);
      expect(screen.getAllByRole('button',{name:'进入管理台'})).toHaveLength(1);
      expect(screen.queryByText(/ADMIN_SESSION_EXPIRED/)).not.toBeInTheDocument();
      expect(fetch.mock.calls.some(call=>String(call[0]).includes('/session'))).toBe(false);
      expect(document.querySelectorAll('.auth-card')).toHaveLength(1);
    });
});
