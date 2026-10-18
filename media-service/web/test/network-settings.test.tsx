import {fireEvent,render,screen,waitFor} from '@testing-library/react';
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
