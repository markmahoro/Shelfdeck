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
  const pendingWakeups=new Set();let wakeScheduled=null,runningKind=null,fullSweepPending=false;
  const registrationKey=registration=>registration.ownerDomain+':'+registration.reconcilerKey;
  function finishRun(){running=null;runningKind=null;if(state==='ready'&&fullSweepPending){fullSweepPending=false;void runOnce().catch(error=>options.onError?.(error));}else scheduleWakeups();}
  function scheduleWakeups(){
    if(state!=='ready'||running||wakeScheduled||pendingWakeups.size===0)return;
    wakeScheduled=setImmediate(()=>{wakeScheduled=null;if(state!=='ready'||running||pendingWakeups.size===0)return;
      const keys=[...pendingWakeups];pendingWakeups.clear();
      runningKind='scoped';
      running=(async()=>{for(const key of keys){if(state!=='ready')break;const registration=options.registrations.find(item=>registrationKey(item)===key);
        try{await runRegistration(registration);}catch(error){const status=statusFor(registration);Object.assign(status,{state:'attention',lastCompletedAtMs:options.now(),processed:0,pendingCount:1,errorCode:errorCodeOf(error),lastResultKind:'failed',nextDueAtMs:null});options.onError?.(error);}
        await new Promise(resolve=>setImmediate(resolve));
      }})().finally(finishRun);
    });
  }
  const registrationStatus=new Map(options.registrations.map((registration)=>[
    registration.ownerDomain + ':' + registration.reconcilerKey,
    {ownerDomain:registration.ownerDomain,reconcilerKey:registration.reconcilerKey,state:'waiting_first_check',
      lastStartedAtMs:null,lastCompletedAtMs:null,processed:0,pendingCount:0,errorCode:null,
      lastResultKind:null,nextDueAtMs:null},
  ]));
  function statusFor(registration){return registrationStatus.get(registration.ownerDomain + ':' + registration.reconcilerKey);}
  function errorCodeOf(error){return typeof error?.code==='string'?error.code:'DOMAIN_RECONCILE_FAILED';}
  function eligible(registration) {
    if (!options.reconcileEligibilityProvider) return true;
    const value = options.reconcileEligibilityProvider.check(Object.freeze({ ownerDomain: registration.ownerDomain, reconcilerKey: registration.reconcilerKey }));
    if (typeof value !== 'boolean') fail('P4_RECONCILE_ELIGIBILITY_INVALID', 'Reconciler eligibility must return a boolean.');
    return value;
  }
  async function runRegistration(registration){
    if (!eligible(registration)) return Object.freeze({ ownerDomain: registration.ownerDomain, reconcilerKey: registration.reconcilerKey, processed: 0, kind: 'supply_disabled' });
    const status=statusFor(registration);const started=options.now();
    Object.assign(status,{state:'running',lastStartedAtMs:started,errorCode:null});
    const head=options.cursorStore.read(registration);
    const page=await registration.listPage(Object.freeze({cursor:head.cursor,limit:pageLimit}));
    if(!Array.isArray(page)||page.length>pageLimit||page.some((item)=>!item||typeof item.cursor!=='string'||!item.scope)){
      fail('P4_DOMAIN_RECONCILE_PAGE_INVALID','Owner returned an invalid bounded reconcile page.');
    }
    let processed=0,nextCursor=head.cursor,error=null,cursorFrozen=false;
    for(const item of page){
      if(['stopping','stopped'].includes(state))break;
      if (!eligible(registration)) break;
      if(processed>0&&options.now()-started>=budgetMs)break;
      const finishScope = options.onReconcileScopeStarted?.(Object.freeze({ ownerDomain: registration.ownerDomain, reconcilerKey: registration.reconcilerKey }));
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
      } finally { finishScope?.(); }
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
    if(['stopping','stopped'].includes(state))return Object.freeze({kind:'inactive',results:Object.freeze([])});
    if(running){if(runningKind==='scoped')fullSweepPending=true;return running;}
    runningKind='full';
    running=(async()=>{lastStartedAtMs=options.now();const results=[];for(const registration of options.registrations){
      if(['stopping','stopped'].includes(state))break;
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
      return Object.freeze({kind:'completed',results:Object.freeze(results)});})().finally(finishRun);
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
    async start(){if(!['created','stopped'].includes(state))fail('P4_DOMAIN_RECONCILE_RUNNER_LIFECYCLE','Domain Reconcile Runner must be inactive before starting.');
      state='ready';timer=setInterval(()=>runOnce().catch((error)=>options.onError?.(error)),cadenceMs);timer.unref?.();
      return runOnce();},
    runOnce,
    wake(request){const key=registrationKey(request||{});if(!options.registrations.some(item=>registrationKey(item)===key))fail('P4_DOMAIN_RECONCILE_WAKE_UNKNOWN','Scoped wake requires a registered Owner reconciler.');
      if(['stopping','stopped'].includes(state))return Object.freeze({kind:'inactive'});pendingWakeups.add(key);scheduleWakeups();return Object.freeze({kind:'accepted',ownerDomain:request.ownerDomain,reconcilerKey:request.reconcilerKey});},
    async stop(){state='stopping';if(timer)clearInterval(timer);timer=null;if(wakeScheduled)clearImmediate(wakeScheduled);wakeScheduled=null;pendingWakeups.clear();fullSweepPending=false;if(running)await running;state='stopped';return Object.freeze({state});},
    readiness(){return Object.freeze({state,running:running!==null,cadenceMs,pageLimit,budgetMs});},
    snapshot
  });
}

module.exports=Object.freeze({DomainReconcileRunnerError,createDomainReconcileRunner});
