'use strict';

// Composition remembers only the public scope of process-local waiters. Owner
// projections decide priority; the Governor retains resource arbitration.
function createLibraResourcePriorityBridge({governor,readProjection,wake}) {
 const scopes=new Map(),waiters=new Map();
 const wrapped=Object.freeze({...governor,
  acquire(request){
   const result=governor.acquire(request),scope=scopes.get(request.eventId);
   if(scope&&['waiting','deferred'].includes(result.kind))waiters.set(request.eventId,{scope,priorityRevision:request.priorityRevision});
   else {waiters.delete(request.eventId);scopes.delete(request.eventId);}
   return result;
  },
  abandon(eventId){const result=governor.abandon(eventId);waiters.delete(eventId);scopes.delete(eventId);return result;},
  abandonWaiters(){const result=governor.abandonWaiters();waiters.clear();scopes.clear();return result;},
 });
 return Object.freeze({governor:wrapped,
  recordScope(eventId,scope){if(scope.ownerDomain==='libra'&&scope.processType==='libra_run')scopes.set(eventId,Object.freeze({...scope}));},
  observeWait(eventId,scope,priorityRevision){
   if(!waiters.has(eventId))waiters.set(eventId,{scope:Object.freeze({...scope}),priorityRevision:priorityRevision||0});
  },
  refresh(){
   for(const [eventId,waiter] of waiters){
    const projection=readProjection(waiter.scope);
    if(projection.priorityRevision<=waiter.priorityRevision)continue;
    try { governor.updateWaiterPriority({eventId,queueClass:projection.priorityClass,
     localPriority:projection.localPriority,priorityRevision:projection.priorityRevision}); }
    catch(error){
     // A cancellation can finish a previously observed wait before this refresh.
     // Foundation rejects the write; retire only the composition observation.
     if(error.code!=='P4_RESOURCE_WAITER_NOT_FOUND')throw error;
     waiters.delete(eventId);scopes.delete(eventId);continue;
    }
    waiter.priorityRevision=projection.priorityRevision;
   }
   wake?.();
  },
 });
}
module.exports=Object.freeze({createLibraResourcePriorityBridge});
