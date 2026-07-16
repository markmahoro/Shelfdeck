'use strict';
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { EFFECT_CLASSES } = require('./runtime-contracts');
class StartupRecoveryError extends Error { constructor(code,message,details={}){super(message);this.name='StartupRecoveryError';this.code=code;this.details=details;} }
function fail(code,message,details){throw new StartupRecoveryError(code,message,details);}
function definitions(schemaManifest){return Object.freeze({
  events:createRepositoryDefinition({repositoryId:'startup_events',owner:'execution-foundation',schemaManifest,statements:{list:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','plan_id','node_id','owner_domain','capability_ref','state'],keyColumns:[]}}}),
  nodes:createRepositoryDefinition({repositoryId:'startup_nodes',owner:'execution-foundation',schemaManifest,statements:{list:{kind:'select-all',tableId:'fx_plan_nodes',columns:['plan_id','node_id','effect_class','retry_policy_ref','timeout_policy_ref'],keyColumns:[]}}}),
  attempts:createRepositoryDefinition({repositoryId:'startup_attempts',owner:'execution-foundation',schemaManifest,statements:{list:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','event_id','state','outcome_kind'],keyColumns:[]}}}),
  effects:createRepositoryDefinition({repositoryId:'startup_effects',owner:'execution-foundation',schemaManifest,statements:{list:{kind:'select-all',tableId:'fx_effect_journal',columns:['effect_id','event_attempt_id','effect_class','state','external_receipt_ref','output_digest'],keyColumns:[]}}}),
  defers:createRepositoryDefinition({repositoryId:'startup_defers',owner:'execution-foundation',schemaManifest,statements:{list:{kind:'select-all',tableId:'fx_resource_defer',columns:['event_id','resource_key','state','retry_at_ms'],keyColumns:[]}}}),
  circuits:createRepositoryDefinition({repositoryId:'startup_circuits',owner:'execution-foundation',schemaManifest,statements:{list:{kind:'select-all',tableId:'fx_circuit_states',columns:['circuit_key','state','reason_code','evidence_digest'],keyColumns:[]}}})
});}
function createStartupRecovery(options){
  if(!options||!options.schemaManifest||!options.unitOfWork||!options.registry||!options.policyRegistry||
    !options.effectReconciler||typeof options.effectReconciler.reconcile!=='function'||
    !options.integrityVerifier||typeof options.integrityVerifier.verify!=='function') fail('P4_STARTUP_DEPENDENCIES_REQUIRED','Startup Recovery requires exact stores, registries, reconciler, and integrity verifier.');
  const repositories=definitions(options.schemaManifest); let readiness=Object.freeze({state:'bootstrapping',normalSupplyAllowed:false,findings:[]});
  function snapshot(){return options.unitOfWork.execute([{participantId:'startup_snapshot',owner:'execution-foundation',repositories:Object.values(repositories),execute(context){
    return Object.freeze(Object.fromEntries(Object.keys(repositories).map(key=>[key,context.repository('startup_'+key).invoke('list')])));
  }}]).startup_snapshot;}
  return Object.freeze({readiness(){return readiness;},async recover(){
    const integrity=options.integrityVerifier.verify(); if(!integrity||integrity.ok!==true){readiness=Object.freeze({state:'faulted',normalSupplyAllowed:false,findings:['INTEGRITY_FAILED']});return readiness;}
    const facts=snapshot(); const findings=[]; const actions=[];
    const nodes=new Map(facts.nodes.map(x=>[x.plan_id+'\0'+x.node_id,x])); const attemptsByEvent=new Map();
    for(const attempt of facts.attempts){if(!attemptsByEvent.has(attempt.event_id))attemptsByEvent.set(attempt.event_id,[]);attemptsByEvent.get(attempt.event_id).push(attempt);}
    const effectByAttempt=new Map(facts.effects.map(x=>[x.event_attempt_id,x]));
    for(const event of facts.events.filter(x=>['executing','waiting_for_external','waiting_for_resource'].includes(x.state))){
      const node=nodes.get(event.plan_id+'\0'+event.node_id); if(!node||!EFFECT_CLASSES.includes(node.effect_class)){findings.push('UNKNOWN_EVENT_EFFECT:'+event.event_id);continue;}
      try{options.registry.resolve(event.capability_ref,event.owner_domain);options.policyRegistry.bindingFor(event.capability_ref,node.effect_class);}catch(error){findings.push('UNKNOWN_EVENT_CONTRACT:'+event.event_id);continue;}
      const active=(attemptsByEvent.get(event.event_id)||[]).filter(x=>x.state==='executing');
      if(event.state==='executing'&&active.length!==1){findings.push('EXECUTING_ATTEMPT_CARDINALITY:'+event.event_id);continue;}
      if(event.state==='executing'){
        const attempt=active[0]; const effect=effectByAttempt.get(attempt.event_attempt_id);
        if(node.effect_class==='pure_observation'){if(effect)findings.push('PURE_EFFECT_JOURNAL_FORBIDDEN:'+event.event_id);else actions.push({eventId:event.event_id,decision:'safe_retry'});}
        else if(!effect) actions.push({eventId:event.event_id,decision:'safe_retry_before_intent'});
        else if(effect.effect_class!==node.effect_class) findings.push('EFFECT_CLASS_DRIFT:'+event.event_id);
        else try{actions.push({eventId:event.event_id,...await options.effectReconciler.reconcile(node.effect_class,{effect:Object.freeze(effect)})});}
        catch(error){findings.push('RECONCILER_UNAVAILABLE:'+event.event_id);}
      }
    }
    for(const effect of facts.effects)if(!facts.attempts.some(x=>x.event_attempt_id===effect.event_attempt_id))findings.push('ORPHAN_EFFECT:'+effect.effect_id);
    const activeCircuits=facts.circuits.filter(x=>x.state!=='closed'); const globalCircuit=activeCircuits.some(x=>x.circuit_key.startsWith('foundation/'));
    if(globalCircuit)findings.push('GLOBAL_CIRCUIT_OPEN');
    const state=findings.length?(globalCircuit?'faulted':'recovering'):(activeCircuits.length?'degraded':'ready');
    readiness=Object.freeze({state,normalSupplyAllowed:state==='ready',findings:Object.freeze(findings),actions:Object.freeze(actions),
      durableDefers:facts.defers.filter(x=>x.state==='waiting').length,recoveredInMemoryLeases:0,recoveredInMemoryPermits:0,recoveredInMemoryWaiters:0});
    return readiness;
  }});
}
module.exports=Object.freeze({StartupRecoveryError,createStartupRecovery});
