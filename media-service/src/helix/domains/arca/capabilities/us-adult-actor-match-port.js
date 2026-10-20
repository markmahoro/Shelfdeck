'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {MATCH,pageMatch,assertPageMatch}=require('../../../contracts/us-adult-inventory-matching');
const {equalScope}=require('../model/us-adult-actor-refresh-execution');
const BASE='helix://contracts/capabilities/arca.us_adult.references.match/v1/';
function createUsAdultActorMatchPort(options){
  const now=options.now||Date.now;
  function validate(context){
    const input=context.namedInputs,scope=input?.usAdultActorRefreshScope,definition=options.workResultReader.readDefinition(context.workId)?.definition,
      pageOrdinal=Number(definition?.dependencyRefs.find(item=>item.objectType==='us_adult_reference_page')?.objectId);
    if(context.ownerScope?.domain!=='arca'||context.ownerScope.processType!=='arca_shelf_entry'||context.capabilityRef!==MATCH||!scope)
      throw new TypeError('Reference matching requires its exact Arca Entry and Case.');
    const current=options.actorMatchQuery.read(context.ownerScope.processId,scope.aftercareCaseId,pageOrdinal);
    equalScope(scope,current.scope);
    if(context.workId!==current.work.workId||!definition||canonicalJson(definition)!==canonicalJson(current.work)||
        canonicalJson(input.usAdultActorRefreshIntent)!==canonicalJson(current.intent)||canonicalJson(input.arcaUsAdultSourcePrepared)!==canonicalJson(current.sourceRecord.result)||
        canonicalJson(input.peopleReferenceLibraryPage)!==canonicalJson(current.page)||!options.actorRefreshSource.assertAuthority(current.scope))
      throw Object.assign(new Error('Matching Work, source Result or frozen reference page changed.'),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});
    return current;
  }
  return Object.freeze({validateInputs:validate,async execute(context){
    const current=validate(context),store=options.aftercareContextReader.store,
      port=options.createUsAdultInventoryAnalysisPort({context,intent:current.intent,aftercareCaseId:current.scope.aftercareCaseId,contractValidator:options.contractValidator,
        workspaceRegistry:{rootSnapshot:store.aftercareWorkspaceRootSnapshot,ensureWorkspace:id=>store.ensureAftercareWorkspace(id),
          registerMaterial:handle=>store.registerAftercareWorkspaceMaterial(handle),listHandles:id=>store.listAftercareWorkspaceHandles(id)},
        assertAuthority:()=>options.actorRefreshSource.assertAuthority(current.scope)}),
      matched=await port.matchPage({intent:current.intent,aftercareCaseId:current.scope.aftercareCaseId,sourceResult:current.sourceRecord.result,page:current.page}),
      result=pageMatch({intent:current.intent,aftercareCaseId:current.scope.aftercareCaseId,pageOrdinal:current.pageOrdinal,page:current.page,
        sourceResult:current.sourceRecord.result,matches:matched.matches,atMs:now()}),digest=canonicalDigest(result);
    validate(context);assertPageMatch({intent:current.intent,aftercareCaseId:current.scope.aftercareCaseId,pageOrdinal:current.pageOrdinal,page:current.page,
      sourceResult:current.sourceRecord.result,result,validator:options.contractValidator});
    return Object.freeze({kind:'succeeded',resultSchemaRef:BASE+'result',result,evidenceSchemaRef:BASE+'evidence',evidence:{
      evidenceId:'arca-us-page-match-'+digest,evidenceKind:'arca_us_adult_reference_match',producerRef:MATCH,basisDigest:current.intent.intentDigest,payloadDigest:digest,observedAtMs:now()}});
  },validateResult(context,outcome){const current=validate(context);assertPageMatch({intent:current.intent,aftercareCaseId:current.scope.aftercareCaseId,
    pageOrdinal:current.pageOrdinal,page:current.page,sourceResult:current.sourceRecord.result,result:outcome.result,validator:options.contractValidator});}});
}
module.exports=Object.freeze({createUsAdultActorMatchPort});
