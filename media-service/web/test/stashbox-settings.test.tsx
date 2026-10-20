import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {helixAdminApi,type IntegrationState} from '../src/helix/api';
import StashBoxSettings from '../src/helix/StashBoxSettings';
import {SessionProvider} from '../src/helix/session';
afterEach(()=>vi.restoreAllMocks());
it('uses the fixed ThePornDB endpoint, saves only a validated proof and clears the key',async()=>{
  const initial={kind:'stashbox',configRevision:0,configured:false,endpoint:null} as unknown as IntegrationState;
  vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue(initial);
  vi.spyOn(helixAdminApi,'testIntegration').mockResolvedValue({connectionProofId:'stash-proof'} as Awaited<ReturnType<typeof helixAdminApi.testIntegration>>);
  vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue({...initial,configured:true,configRevision:1,endpoint:'https://api.theporndb.net/graphql'});
  render(<SessionProvider><StashBoxSettings/></SessionProvider>);
  await screen.findByText('ThePornDB 未启用');
  expect(screen.queryByLabelText(/GraphQL 地址/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('ThePornDB API Key'),{target:{value:'test-credential'}});
  fireEvent.click(screen.getByRole('button',{name:'测试并启用 ThePornDB'}));
  await screen.findByText('ThePornDB 已验证并启用。');
  expect(helixAdminApi.testIntegration).toHaveBeenCalledWith('stashbox',expect.objectContaining({endpoint:'https://api.theporndb.net/graphql',credential:{kind:'api_key',value:'test-credential'}}));
  expect(helixAdminApi.configureIntegration).toHaveBeenCalledWith('stashbox',expect.objectContaining({expectedConfigRevision:0,connectionProofId:'stash-proof'}));
  expect(JSON.stringify(vi.mocked(helixAdminApi.configureIntegration).mock.calls)).not.toContain('test-credential');
  await waitFor(()=>expect(screen.getByLabelText('ThePornDB API Key')).toHaveValue(''));
});

it('scrolls to the requested StashBox card after async configuration has rendered',async()=>{
  const old=window.location.href,scroll=vi.fn();window.history.replaceState(null,'','/settings#stashbox');
  const prior=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{value:scroll,configurable:true});
  try{
    vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue({kind:'stashbox',configRevision:0,configured:false,endpoint:null} as unknown as IntegrationState);
    render(<SessionProvider><StashBoxSettings/></SessionProvider>);await screen.findByText('ThePornDB 未启用');
    await waitFor(()=>expect(scroll).toHaveBeenCalledWith({block:'start'}));expect(scroll.mock.instances[0]).toHaveAttribute('id','stashbox');
    expect(screen.queryByText(/Wikimedia Commons 可直接搜索/)).not.toBeInTheDocument();
  }finally{window.history.replaceState(null,'',old);if(prior)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',prior);else delete (HTMLElement.prototype as unknown as {scrollIntoView?:unknown}).scrollIntoView;}
});
