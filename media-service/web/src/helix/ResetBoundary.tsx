import {useEffect,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {helixAdminApi} from './api';
import {isUnauthorized,useSession} from './session';
import RuntimeControls from './RuntimeControls';
import {LoadingState} from './chrome';

export default function ResetBoundary({children}:{children:ReactNode}){
  const {expire}=useSession();
  const runtime=useQuery({queryKey:['runtime-operations'],queryFn:()=>helixAdminApi.getRuntimeStatus(),
    refetchInterval:query=>query.state.data?.resetStage?1000:5000});
  useEffect(()=>{if(isUnauthorized(runtime.error))expire();},[expire,runtime.error]);
  if(runtime.isPending)return <main id="main" className="helix-main"><h1>ShelfDeck</h1><LoadingState>正在读取运行状态…</LoadingState></main>;
  if(runtime.error||!runtime.data)return <main id="main" className="helix-main"><h1>运行控制</h1><RuntimeControls/></main>;
  if(!runtime.data?.resetStage)return <>{children}</>;
  return <main id="main" className="helix-main"><h1>整理工作台重置</h1><RuntimeControls/></main>;
}
