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
  let state='created',timer=null,running=null,lastStartedAtMs=null,lastCompletedAtMs=null;
  const registrationStatus=new Map(options.registrations.map((registration)=>[
    `${registration.ownerDomain}:${registration.reconcilerKey}`,
    {ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,state:'waiting_first_check',
      lastStartedAtMs:null,lastCompletedAtMs:null,processed:0,pendingCount:0,errorCode:null,
      lastResultKind:null,nextDueAtMs:null},
  ]));
  function statusFor(registration){return registrationStatus.get(`${registration.ownerDomain}:${registration.reconcilerKey}`);}
  function errorCodeOf(error){return typeof error?.code==='string'?error.code:'DOMAIN_RECONCILE_FAILED';}
  async function runRegistration(registration){
    const status=statusFor(registration);const started=options.now();
    Object.assign(status,{state:'running',lastStartedAtMs:started,errorCode:null});
    const head=options.cursorStore.read(registration);
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
    const completedAtMs=options.now();
    const nextDueAtMs=typeof registration.nextDueAtMs==='function'
      ? registration.nextDueAtMs() : null;
    const waitingForBusinessTime=Number.isSafeInteger(nextDueAtMs)&&nextDueAtMs>completedAtMs;
    Object.assign(status,{state:error?'attention':waitingForBusinessTime?'waiting_business_time':'normal',
      lastCompletedAtMs:completedAtMs,processed,pendingCount:Math.max(error?1:0,page.length-processed),
      errorCode:error?errorCodeOf(error):null,lastResultKind:error?'failed':waitingForBusinessTime?'not_due':
        page.length===0?'no_pending':'processed',nextDueAtMs:waitingForBusinessTime?nextDueAtMs:null});
    return Object.freeze({ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,processed,cursor:advanced.cursor,
      ...(error?{errorCode:errorCodeOf(error)}:{})});
  }
  async function runOnce(){
    if(running)return running;
    running=(async()=>{lastStartedAtMs=options.now();const results=[];for(const registration of options.registrations){
      try { results.push(await runRegistration(registration)); }
      catch(error){
        const status=statusFor(registration);const errorCode=errorCodeOf(error);
        Object.assign(status,{state:'attention',lastCompletedAtMs:options.now(),processed:0,pendingCount:1,errorCode,
          lastResultKind:'failed',nextDueAtMs:null});
        options.onError?.(error);
        results.push(Object.freeze({ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,
          processed:0,cursor:null,errorCode}));
      }
      await new Promise((resolve)=>setImmediate(resolve));}
      lastCompletedAtMs=options.now();
      return Object.freeze({kind:'completed',results:Object.freeze(results)});})().finally(()=>{running=null;});
    return running;
  }
  function snapshot(){
    const registrations=Object.freeze([...registrationStatus.values()].map((item)=>Object.freeze({...item})));
    const attention=registrations.some((item)=>item.state==='attention');
    const pendingCount=registrations.reduce((sum,item)=>sum+item.pendingCount,0);
    return Object.freeze({state:running?'running':state==='stopped'?'stopped':attention?'attention':
      lastCompletedAtMs===null?'waiting_first_check':'normal',cadenceMs,lastStartedAtMs,lastCompletedAtMs,pendingCount,registrations});
  }
  return Object.freeze({
    async start(){if(state!=='created')fail('P4_DOMAIN_RECONCILE_RUNNER_LIFECYCLE','Domain Reconcile Runner starts exactly once.');
      state='ready';timer=setInterval(()=>runOnce().catch((error)=>options.onError?.(error)),cadenceMs);timer.unref?.();
      return runOnce();},
    runOnce,
    async stop(){state='stopping';if(timer)clearInterval(timer);timer=null;if(running)await running;state='stopped';return Object.freeze({state});},
    readiness(){return Object.freeze({state,running:running!==null,cadenceMs,pageLimit,budgetMs});},
    snapshot
  });
}

module.exports=Object.freeze({DomainReconcileRunnerError,createDomainReconcileRunner});
