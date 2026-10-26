import {vi} from 'vitest';
import {helixAdminApi,type RuntimeStatus} from '../../src/helix/api';

// Page fixtures explicitly admit the ordinary application shell. Cold Reset,
// authentication and unknown Runtime tests supply their own state instead.
export function mockRunningRuntime(){
  const state:RuntimeStatus={mode:'running',desiredMode:'running',revision:0,normalSupplyAllowed:true,
    maintenance:{maintenanceActive:false,phase:null,currentTask:null,windowEndAtMs:null},
    activity:{inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0},operation:null,error:null,recoveryBackup:null};
  return vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(state);
}
