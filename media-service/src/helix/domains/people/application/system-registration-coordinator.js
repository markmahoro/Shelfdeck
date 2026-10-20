'use strict';
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {assertItem,workFor}=require('../model/system-registration-work');
const {createMediaCastReferenceQuery}=require('./media-cast-reference-query');
function createSystemRegistrationCoordinator(options){
  const referenceQuery=createMediaCastReferenceQuery(options.peopleStore);
  const admission=createWorkAdmission({...options,limits:{globalOpenWorks:768,ownerOpenWorks:32,openEvents:512},eligibilityProvider:{check:request=>({
    eligible:request.ownerDomain==='people'&&request.processType==='people_system_registration',basisDigest:request.executionBasisDigest,reasonCode:'PEOPLE_SYSTEM_WORK_INVALID'})}});
  return Object.freeze({reconcile(scope){
    if(!scope||scope.skipped)return {kind:'skipped'};
    if(scope.contentProfile==='western_adult')return {kind:'user_owned_library'};
    const item=assertItem(scope.projectionItem,options.contractValidator);
    if(item.libraryKind==='us_adult')return {kind:'user_owned_library'};
    const known=referenceQuery.resolve({libraryKind:item.libraryKind,personId:scope.personId??null,providerIdentities:item.providerIdentities,evidenceDigest:scope.evidenceDigest});
    if(['resolved','unchanged'].includes(known.kind))return {kind:'known',personId:known.personId};
    const work=workFor(item),submitted=admission.replay(work)||admission.submit(work);
    if(submitted.kind==='invalid_contract')throw Object.assign(new Error('System Registration violates Work admission.'),{code:submitted.reasonCode});
    if(submitted.kind==='deferred')return Object.freeze({kind:'evidence_deferred',reasonCode:submitted.reasonCode,evidenceDigest:item.projectionItemDigest});
    const status=options.workResultReader.status(work.workId);
    return Object.freeze({kind:status?.state==='succeeded'?(item.providerIdentities.length?'auto_accepted':'internal_evidence'):
      ['failed','cancelled'].includes(status?.state)?'evidence_unavailable':'evidence_pending',workId:work.workId,evidenceDigest:item.projectionItemDigest});
  }});
}
module.exports=Object.freeze({createSystemRegistrationCoordinator});
