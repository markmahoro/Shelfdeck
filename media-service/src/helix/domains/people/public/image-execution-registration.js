'use strict';

const {createPeopleReferenceCommitPort,COMMIT}=require('../capabilities/people-reference-commit-port');
const {createPersonReferenceQuery}=require('../capabilities/people-reference-lifecycle');
const { createPeopleStore } = require('../persistence/people-store');
const { createPeopleProfileUpdate } = require('../capabilities/people-profile-update');
const { createDirectPersonRegistrationFromPersistence } = require('../capabilities/people-registration-lifecycle');
const { createPeopleImageOperationCoordinator } = require('../application/people-image-operation-coordinator');
const {createPeopleProcessServices}=require('../application/people-process-services');
const { createPeopleImagePreparationPorts, IMPORT, EMBED } = require('../capabilities/people-image-preparation-ports');
const { createPeopleImagePreparationPlanner, createPeopleImageProjections } = require('../planning/people-image-preparation-planner');
const {createSystemRegistrationQuery}=require('../application/system-registration-query');
const {createSystemRegistrationCoordinator}=require('../application/system-registration-coordinator');
const {createSystemRegistrationPorts}=require('../capabilities/system-registration-ports');
const {createSystemRegistrationPlanning}=require('../planning/system-registration-planner');

function createPeopleImageExecutionRegistration(options) {
  const peopleStore = createPeopleStore(options);
  let sources=null;
  const systemRegistrationQuery=createSystemRegistrationQuery({...options,readSource:input=>{
    if(!sources)throw new TypeError('System Registration requires its Arca public Evidence sources.');
    return (input.sourceKind==='nfo'?sources.nfo:sources.cast).read(input);
  }}),systemRegistration=createSystemRegistrationCoordinator({...options,peopleStore}),
    systemPorts=createSystemRegistrationPorts({...options,peopleStore,systemRegistrationQuery});
  const registrationCommand = createDirectPersonRegistrationFromPersistence(peopleStore, options);
  const imageOperations = createPeopleImageOperationCoordinator({ ...options, peopleStore, registrationCommand,
    imagePort: options.peopleImagePort || { stageUpload() { throw new Error('People image ingress is unavailable.'); } },
    readSelectedImage: options.readSelectedPersonImage || (async () => { throw new Error('People image source is unavailable.'); }) });
  const preparationPorts = createPeopleImagePreparationPorts({ ...options, operationContext: imageOperations.context,
    preparation: options.peopleReferencePreparation || { importImage() { throw new Error('People image import is unavailable.'); },
      computeEmbedding() { throw new Error('People reference compute is unavailable.'); } } });
  const ports={...preparationPorts,...systemPorts,[COMMIT]:createPeopleReferenceCommitPort({...options,peopleStore,referenceDecision:imageOperations.referenceDecision})};
  const profileUpdate=createPeopleProfileUpdate({...options,peopleStore});
  return Object.freeze({
    createProcessServices(processOptions){sources={cast:processOptions.onDeckPersonEvidenceProjection,nfo:processOptions.onDeckNfoPersonEvidence};
      return createPeopleProcessServices({...options,...processOptions,peopleStore,imageOperations,profileUpdate,systemRegistration});},
    createReferenceQuery:()=>createPersonReferenceQuery(peopleStore),
    createRegistrations(manifests) {
      return [IMPORT, EMBED,COMMIT,...Object.keys(systemPorts)].map(capabilityRef => ({ manifest: manifests[capabilityRef], executor: { version: 1, execute: context => ports[capabilityRef].execute(context) },
        semanticValidator: { ref: manifests[capabilityRef].semanticValidatorRef,
          validateInputs: context => ports[capabilityRef].validateInputs(context), validateResult: (context, outcome) => ports[capabilityRef].validateResult(context, outcome) } }));
    },
    createPlanningRegistration(planning) {
      const planner = createPeopleImagePreparationPlanner({ ...planning, context: imageOperations.context });
      const system=createSystemRegistrationPlanning({...planning,systemRegistrationQuery});
      return { planners: [{ ownerDomain: 'people', workKind: 'people_image_preparation', plannerContractRef: planner.plannerContractRef, plannerVersion: 1, planner },...system.planners],
        bindingProjections: [...createPeopleImageProjections({ context: imageOperations.context,referenceDecision:imageOperations.referenceDecision }),...system.bindingProjections] };
    },
  });
}

module.exports = Object.freeze({ createPeopleImageExecutionRegistration });
