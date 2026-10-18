import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import NetworkSettings from '../src/helix/NetworkSettings';
import {helixAdminApi,type IntegrationState} from '../src/helix/api';
const initial={kind:'network',configured:false,configRevision:0,settings:{proxyServer:''}} as IntegrationState;
it('offers the old TMDB proxy as an unsaved global draft and saves one policy without another credential',async()=>{
  vi.spyOn(helixAdminApi,'getIntegration').mockImplementation(async kind=>kind==='network'?initial:{...initial,kind:'tmdb',configured:true,settings:{proxyServer:'http://proxy.test:7890'}});
  const save=vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue({...initial,configured:true,configRevision:1,settings:{proxyServer:'http://proxy.test:7890'}});
  render(<NetworkSettings onUnauthorized={vi.fn()}/>);
  expect(await screen.findByLabelText('代理服务器')).toHaveValue('http://proxy.test:7890');expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'保存网络设置'}));
  await screen.findByText('全站网络设置已保存。');expect(save).toHaveBeenCalledWith('network',expect.objectContaining({kind:'network',expectedConfigRevision:0,settings:{proxyServer:'http://proxy.test:7890'}}));
  expect(save.mock.calls[0][1]).not.toHaveProperty('credential');expect(screen.getByText('全站使用代理')).toBeVisible();
});
it('rejects invalid proxies, retains failed drafts and can explicitly save direct mode',async()=>{
  vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue(initial);
  const save=vi.spyOn(helixAdminApi,'configureIntegration').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({...initial,configured:true,configRevision:1});
  render(<NetworkSettings onUnauthorized={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'保存网络设置'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('网络方式'),{target:{value:'http_proxy'}});
  const input=screen.getByLabelText('代理服务器');
  fireEvent.change(input,{target:{value:'http://user:password@proxy.test:7890'}});expect(input).toHaveAttribute('aria-invalid','true');expect(screen.getByRole('button',{name:'保存网络设置'})).toBeDisabled();
  fireEvent.change(input,{target:{value:'http://proxy.test:7890'}});fireEvent.click(screen.getByRole('button',{name:'保存网络设置'}));
  await screen.findByRole('alert');expect(input).toHaveValue('http://proxy.test:7890');expect(screen.queryByText('全站网络设置已保存。')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('网络方式'),{target:{value:'direct'}});fireEvent.click(screen.getByRole('button',{name:'保存网络设置'}));
  await screen.findByText('全站直连');expect(save.mock.calls[1][1]).toMatchObject({settings:{proxyServer:''}});
});
it('shows unknown state after a failed read and restores real state on retry',async()=>{
  const read=vi.spyOn(helixAdminApi,'getIntegration').mockRejectedValue(new Error('offline'));
  render(<NetworkSettings onUnauthorized={vi.fn()}/>);
  await screen.findByRole('alert');expect(screen.getByText('读取失败',{exact:true})).toBeVisible();
  expect(screen.queryByText('未配置',{exact:true})).not.toBeInTheDocument();expect(screen.queryByText('全站直连')).not.toBeInTheDocument();
  read.mockResolvedValue(initial);fireEvent.click(screen.getByRole('button',{name:'重新读取'}));
  await screen.findByText('未配置',{exact:true});expect(screen.getByRole('button',{name:'保存网络设置'})).toBeEnabled();
});

it('uses a saved global policy even when TMDB cannot be read',async()=>{
  const saved={...initial,configured:true,configRevision:3,settings:{proxyServer:'http://global.test:7890'}};
  const read=vi.spyOn(helixAdminApi,'getIntegration').mockImplementation(async kind=>{if(kind==='network')return saved;throw new Error('TMDB unavailable');});
  render(<NetworkSettings onUnauthorized={vi.fn()}/>);await screen.findByText('全站使用代理');
  expect(screen.getByRole('button',{name:'保存网络设置'})).toBeEnabled();expect(screen.getByLabelText('代理服务器')).toHaveValue('http://global.test:7890');
  expect(read).not.toHaveBeenCalledWith('tmdb');expect(screen.queryByText('读取失败',{exact:true})).not.toBeInTheDocument();
});
it('does not block first-time global settings when the optional TMDB draft fails',async()=>{
  vi.spyOn(helixAdminApi,'getIntegration').mockImplementation(async kind=>{if(kind==='network')return initial;throw new Error('TMDB unavailable');});
  const save=vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue({...initial,configured:true,configRevision:1});
  render(<NetworkSettings onUnauthorized={vi.fn()}/>);await screen.findByText('旧 TMDB 代理读取失败，可手动填写。');
  expect(screen.getByText('未配置',{exact:true})).toBeVisible();expect(screen.getByRole('button',{name:'保存网络设置'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'保存网络设置'}));await screen.findByText('全站网络设置已保存。');expect(save).toHaveBeenCalledTimes(1);
});
it('a late optional TMDB draft cannot replace a user edit',async()=>{
  let resolveDraft!:(value:IntegrationState)=>void;
  vi.spyOn(helixAdminApi,'getIntegration').mockImplementation(kind=>kind==='network'?Promise.resolve(initial):new Promise<IntegrationState>(resolve=>{resolveDraft=resolve;}));
  render(<NetworkSettings onUnauthorized={vi.fn()}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'保存网络设置'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('网络方式'),{target:{value:'http_proxy'}});fireEvent.change(screen.getByLabelText('代理服务器'),{target:{value:'http://edited.test:7890'}});
  await act(async()=>resolveDraft({...initial,settings:{proxyServer:'http://old.test:7890'}}));expect(screen.getByLabelText('代理服务器')).toHaveValue('http://edited.test:7890');
});
