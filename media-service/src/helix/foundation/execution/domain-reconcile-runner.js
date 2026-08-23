'use strict';

class DomainReconcileRunnerError extends Error {
  constructor(code,message,details={}){super(message);this.name='DomainReconcileRunnerError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new DomainReconcileRunnerError(code,message,details);}

function createDomainReconcileRunner(options){
  if(!options?.cursorStore||!Array.isArray(options.registrations)||options.registrations.length<1||typeof options.now!=='function'){
    fail('P4_DOMAIN_RECONCILE_RUNNER_DEPENDENCIES','Domain Reconcile Runner requires registrations, cursor store, and clock.');
  }
  const pageLimit=options.pageLimit===undefined?100:options.pageLimit;
  const budgetMs=options.budgetMs===undefined?5000:options.budgetMs;
  const cadenceMs=options.cadenceMs===undefined?30000:options.cadenceMs;
  if(!Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>100||!Number.isSafeInteger(budgetMs)||budgetMs<1||
      !Number.isSafeInteger(cadenceMs)||cadenceMs<1000)fail('P4_DOMAIN_RECONCILE_RUNNER_LIMITS_INVALID','Domain reconcile limits are invalid.');
  let state='created',timer=null,running=null;
  async function runRegistration(registration){
    const head=options.cursorStore.read(registration);const started=options.now();
    const page=await registration.listPage(Object.freeze({cursor:head.cursor,limit:pageLimit}));
    if(!Array.isArray(page)||page.length>pageLimit||page.some((item)=>!item||typeof item.cursor!=='string'||!item.scope)){
      fail('P4_DOMAIN_RECONCILE_PAGE_INVALID','Owner returned an invalid bounded reconcile page.');
    }
    let processed=0,nextCursor=head.cursor,error=null,cursorFrozen=false;
    for(const item of page){
      if(processed>0&&options.now()-started>=budgetMs)break;
      try {
        await registration.reconcile(item.scope);
        if(!cursorFrozen)nextCursor=item.cursor;
        processed+=1;
      } catch (caught) {
        // One Owner scope is not a process-wide startup invariant. Keep the
        // durable cursor before the first failed scope so the bounded cadence
        // can retry it, but continue the page so one bad scope cannot starve
        // its independent siblings.
        if(!error)error=caught;
        cursorFrozen=true;
        options.onError?.(caught);
      }
      // Owner reconciliation is commonly synchronous even though the runner
      // accepts async registrations. Yield after every bounded scope so a
      // periodic sweep cannot concatenate many owners into one HTTP blackout.
      await new Promise((resolve)=>setImmediate(resolve));
    }
    if(!error&&page.length<pageLimit&&processed===page.length)nextCursor=null;
    const advanced=options.cursorStore.advance({ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,
      expectedRevision:head.revision,cursor:nextCursor});
    return Object.freeze({ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,processed,cursor:advanced.cursor,
      ...(error?{errorCode:typeof error.code==='string'?error.code:'DOMAIN_RECONCILE_FAILED'}:{})});
  }
  async function runOnce(){
    if(running)return running;
    running=(async()=>{const results=[];for(const registration of options.registrations){results.push(await runRegistration(registration));
      await new Promise((resolve)=>setImmediate(resolve));}
      return Object.freeze({kind:'completed',results:Object.freeze(results)});})().finally(()=>{running=null;});
    return running;
  }
  return Object.freeze({
    async start(){if(state!=='created')fail('P4_DOMAIN_RECONCILE_RUNNER_LIFECYCLE','Domain Reconcile Runner starts exactly once.');
      state='ready';timer=setInterval(()=>runOnce().catch((error)=>options.onError?.(error)),cadenceMs);timer.unref?.();
      return runOnce();},
    runOnce,
    async stop(){state='stopping';if(timer)clearInterval(timer);timer=null;if(running)await running;state='stopped';return Object.freeze({state});},
    readiness(){return Object.freeze({state,running:running!==null,cadenceMs,pageLimit,budgetMs});}
  });
}

module.exports=Object.freeze({DomainReconcileRunnerError,createDomainReconcileRunner});
