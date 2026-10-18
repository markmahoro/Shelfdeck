'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {SOURCE,sourceWork,equalScope}=require('../model/us-adult-actor-refresh-execution');
const {assertSourcePrepared}=require('../../../contracts/us-adult-inventory-analysis');
const {assertReadHandle}=require('../../../contracts/us-adult-inventory-read-handle');
const BASE='helix://contracts/capabilities/arca.us_adult.source.prepare/v1/';
function createUsAdultActorSourcePort(options){
  const now=options.now||Date.now,source=options.actorRefreshSource;
  function validate(context){
    const input=context.namedInputs,scope=input?.usAdultActorRefreshScope;
    if(context.ownerScope?.domain!=='arca'||context.ownerScope.processType!=='arca_shelf_entry'||context.capabilityRef!==SOURCE||!scope)
      throw new TypeError('Actor source Capability requires its exact Arca Entry and Scope.');
    const current=source.read(context.ownerScope.processId,scope.aftercareCaseId);
    equalScope(scope,current.scope);
    if(context.workId!==sourceWork(current.intent,scope.aftercareCaseId).workId||canonicalJson(input.usAdultActorRefreshIntent)!==canonicalJson(current.intent)||
        !source.assertAuthority(current.scope))throw Object.assign(new Error('Actor source Work, Intent or current Material Control changed.'),{code:'ARCA_US_ADULT_REFRESH_EXECUTION_STALE'});
    assertReadHandle({intent:current.intent,aftercareCaseId:scope.aftercareCaseId,handle:input.physicalMaterialReadHandle,atMs:now()});
    return current;
  }
  return Object.freeze({validateInputs:validate,
    async execute(context){
      const current=validate(context),scope=current.scope;
      if(typeof options.createUsAdultInventoryAnalysisPort!=='function')throw new TypeError('Actor source execution requires its controlled Root analysis adapter.');
      const store=options.aftercareContextReader.store,
        port=options.createUsAdultInventoryAnalysisPort({context,intent:current.intent,aftercareCaseId:scope.aftercareCaseId,contractValidator:options.contractValidator,
          workspaceRegistry:{rootSnapshot:store.aftercareWorkspaceRootSnapshot,ensureWorkspace:id=>store.ensureAftercareWorkspace(id),
            registerMaterial:handle=>store.registerAftercareWorkspaceMaterial(handle),listHandles:id=>store.listAftercareWorkspaceHandles(id)},
          assertAuthority:()=>source.assertAuthority(current.scope)}),
        result=await port.prepare({intent:current.intent,aftercareCaseId:scope.aftercareCaseId,sourceHandle:context.namedInputs.physicalMaterialReadHandle,
          recoveryDecision:context.recoveryDecision}),at=result.observedAtMs,digest=canonicalDigest(result),id=canonicalDigest({eventId:context.eventId,digest});
      validate(context);assertSourcePrepared({intent:current.intent,aftercareCaseId:scope.aftercareCaseId,result,validator:options.contractValidator});
      return Object.freeze({kind:'succeeded',resultSchemaRef:BASE+'result',result,evidenceSchemaRef:BASE+'evidence',
        evidence:{evidenceId:'arca-us-source-evidence-'+id,evidenceKind:'arca_us_adult_source',producerRef:SOURCE,basisDigest:current.intent.intentDigest,payloadDigest:digest,observedAtMs:at},
        effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:'arca-us-source-receipt-'+id,
          effectId:canonicalDigest(['workspace_write',context.idempotencyKey]),effectClass:'workspace_write',idempotencyKey:context.idempotencyKey,
          commitMarker:'arca-us-source-marker-'+id,externalReceiptRef:null,outputDigest:digest,verificationEvidenceDigest:digest,committedAtMs:at}});
    },
    validateResult(context,outcome){const current=validate(context);assertSourcePrepared({intent:current.intent,aftercareCaseId:current.scope.aftercareCaseId,
      result:outcome.result,validator:options.contractValidator});},
  });
}
module.exports=Object.freeze({createUsAdultActorSourcePort});
