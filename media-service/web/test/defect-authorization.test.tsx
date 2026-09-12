import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import DefectAuthorization from '../src/helix/DefectAuthorization';
import {helixAdminApi,type DefectAuthorization as Authorization} from '../src/helix/api';
vi.mock('../src/helix/session',()=>({useSession:()=>({expire}),isUnauthorized:()=>false}));
const expire=()=>{};
const state=(enabled:boolean,revision:number):{authorization:Authorization}=>({authorization:{authorizationId:'authorization',revision,state:enabled?'enabled':'revoked',authorizationDigest:'a'.repeat(64)}});
beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>vi.restoreAllMocks());
describe('UAT-251 automatic defect authorization',()=>{
  it('requires confirmation, persists the exact revision and refreshes formal status',async()=>{
    vi.spyOn(helixAdminApi,'getDefectAuthorization').mockResolvedValueOnce({authorization:null}).mockResolvedValue(state(true,1));
    const publish=vi.spyOn(helixAdminApi,'setDefectAuthorization').mockResolvedValue({...state(true,1),replayed:false});
    render(<DefectAuthorization/>);
    const trigger=await screen.findByRole('button',{name:'自动授权瑕疵上架 · 未授权'});
    fireEvent.click(trigger);
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('身份、完整性');
    fireEvent.click(screen.getByRole('button',{name:'取消'}));
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button',{name:'授权自动瑕疵上架'}));
    await waitFor(()=>expect(publish).toHaveBeenCalledWith(true,0,expect.any(String)));
    expect(await screen.findByRole('button',{name:'自动授权瑕疵上架 · 已授权'})).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('separates read failure from missing authorization and permits read-only recovery',async()=>{
    vi.spyOn(helixAdminApi,'getDefectAuthorization').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(state(true,4));
    const publish=vi.spyOn(helixAdminApi,'setDefectAuthorization');
    render(<DefectAuthorization/>);
    fireEvent.click(await screen.findByRole('button',{name:'自动授权瑕疵上架 · 读取失败'}));
    expect(screen.queryByRole('button',{name:'授权自动瑕疵上架'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'重新读取'}));
    expect(await screen.findByRole('button',{name:'撤销授权'})).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();
  });
  it('keeps a failed revocation visible until state is reread',async()=>{
    vi.spyOn(helixAdminApi,'getDefectAuthorization').mockResolvedValue(state(true,8));
    const publish=vi.spyOn(helixAdminApi,'setDefectAuthorization').mockRejectedValue(new Error('conflict'));
    render(<DefectAuthorization/>);
    fireEvent.click(await screen.findByRole('button',{name:'自动授权瑕疵上架 · 已授权'}));
    fireEvent.click(screen.getByRole('button',{name:'撤销授权'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('重新读取');
    expect(publish).toHaveBeenCalledWith(false,8,expect.any(String));
    expect(screen.getByRole('button',{name:'撤销授权'})).toBeDisabled();
  });
});
