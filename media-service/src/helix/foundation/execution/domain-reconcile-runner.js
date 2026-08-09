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
    let processed=0,nextCursor=head.cursor;
    for(const item of page){
      if(processed>0&&options.now()-started>=budgetMs)break;
      await registration.reconcile(item.scope);nextCursor=item.cursor;processed+=1;
    }
    if(page.length<pageLimit&&processed===page.length)nextCursor=null;
    const advanced=options.cursorStore.advance({ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,
      expectedRevision:head.revision,cursor:nextCursor});
    return Object.freeze({ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,processed,cursor:advanced.cursor});
  }
  async function runOnce(){
    if(running)return running;
    running=(async()=>{const results=[];for(const registration of options.registrations)results.push(await runRegistration(registration));
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
