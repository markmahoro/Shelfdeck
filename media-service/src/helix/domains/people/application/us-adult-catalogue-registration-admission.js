'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildCatalogueRegistration}=require('../model/us-adult-catalogue-registration');

/**
 * People-owned Host admission for Libra settlement's registerCataloguePerson port.
 * Settlement passes {input,inputDigest,resolution,candidate}; People returns
 * {kind:'registered',registration,personSnapshot,referenceAssetId} or waiting_registration.
 */
function createUsAdultCatalogueRegistrationAdmission(options){
  if(!options?.peopleStore||typeof options.peopleStore.readUsAdultPersonSnapshot!=='function'||
    typeof options.register!=='function'||typeof options.assembleEvidence!=='function')
    throw new TypeError('Catalogue registration admission requires People store, register and evidence assembly.');
  return Object.freeze({
    registerCataloguePerson({input,inputDigest,resolution,candidate}){
      if(!input||!inputDigest||!resolution||resolution.kind!=='not_found')
        return Object.freeze({kind:'waiting_registration',phase:'us_adult_catalogue_registration',
          reasonCode:'us_adult_catalogue_registration_required',inputDigest:inputDigest||null,
          winnerName:input?.winner?.name||null});
      let evidence;
      try{evidence=options.assembleEvidence({input,inputDigest,resolution,candidate});}
      catch(error){
        if(error?.code==='PEOPLE_CATALOGUE_REGISTRATION_PENDING')
          return Object.freeze({kind:'waiting_registration',phase:'us_adult_catalogue_registration',
            reasonCode:'us_adult_catalogue_registration_required',inputDigest,winnerName:input.winner.name,
            pendingCode:error.pendingCode||null});
        throw error;
      }
      if(!evidence||evidence.kind==='waiting')
        return Object.freeze({kind:'waiting_registration',phase:'us_adult_catalogue_registration',
          reasonCode:'us_adult_catalogue_registration_required',inputDigest,winnerName:input.winner.name,
          pendingCode:evidence?.pendingCode||null});
      const decision=buildCatalogueRegistration(evidence);
      options.register(evidence);
      const registration=Object.freeze({decisionId:decision.decisionId,decisionDigest:decision.decisionDigest,
        personId:decision.newPersonId,catalogueDecisionInputDigest:inputDigest,
        nameResolutionDigest:resolution.resolutionDigest});
      const personSnapshot=options.peopleStore.readUsAdultPersonSnapshot({personId:decision.newPersonId,
        expectedPersonRevision:1,expectedReferenceRevision:1});
      return Object.freeze({kind:'registered',registration,personSnapshot,
        referenceAssetId:decision.initialReference.referenceAssetId});
    },
  });
}

function pending(code,message){
  throw Object.assign(new Error(message||'Catalogue registration evidence is not ready.'),{
    code:'PEOPLE_CATALOGUE_REGISTRATION_PENDING',pendingCode:code});
}

module.exports=Object.freeze({createUsAdultCatalogueRegistrationAdmission,pending,canonicalDigest,canonicalJson});
