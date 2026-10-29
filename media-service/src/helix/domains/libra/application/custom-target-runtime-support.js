'use strict';

const {createCustomTargetStore}=require('../persistence/custom-target-store');
const {createCustomSpecPublicationStore}=require('../persistence/custom-spec-publication-store');
const {createCurrentRunTargetReader}=require('./current-run-target-reader');
const {createCustomTargetReplacementReadiness}=require('./custom-target-replacement-readiness');
const {createCustomTargetBaselineReader}=require('./custom-target-baseline-reader');
const {createLibraHandoffResponsibilityReader}=require('./handoff-responsibility-reader');
const {createLibraRunInputControlReader}=require('./run-input-control-reader');
const {createLibraCustomTargetDispatchGuard}=require('./custom-target-dispatch-guard');
const {createCustomTargetContinuation}=require('./custom-target-continuation');

// All business decisions remain inside Libra; Arca and Foundation enter only
// through their public read/cancellation ports. No new scheduling loop is made.
function createLibraCustomTargetRuntimeSupport(options){
  if(typeof options?.acceptanceSpecContextReader?.read!=='function'||typeof options.readArcaOfferResponsibility!=='function'||
      typeof options.readArcaFormationStatus!=='function'||typeof options.cancelProcessWorks!=='function')
    throw new TypeError('Custom target runtime requires exact Owner projection and cancellation ports.');
  const customTargetStore=createCustomTargetStore(options),
    responsibility=createLibraHandoffResponsibilityReader(options),
    baseline=createCustomTargetBaselineReader({...options,readHandoffResponsibility:(request,view)=>responsibility.read(request,view)}),
    readCurrentCustomTargetBaseline=(request,view)=>baseline.read(request,view),
    publisher=createCustomSpecPublicationStore({...options,customTargetStore,readCurrentCustomTargetBaseline}),
    targetReader=createCurrentRunTargetReader(options),
    replacementReadiness=createCustomTargetReplacementReadiness({...options,customTargetStore}),
    inputControlReader=createLibraRunInputControlReader(options),
    guard=createLibraCustomTargetDispatchGuard({targetReader,replacementReadiness,customTargetStore,inputControlReader,
      readCurrentCustomTargetBaseline});
  return Object.freeze({guard,customTargetStore,currentRunTargetReader:targetReader,
    readHandoffResponsibility:(request,view)=>responsibility.read(request,view),readCurrentCustomTargetBaseline,
    createContinuation(libraRunCreator){return createCustomTargetContinuation({...options,customTargetStore,
      customSpecPublicationStore:publisher,libraRunCreator});}});
}

module.exports=Object.freeze({createLibraCustomTargetRuntimeSupport});
