'use strict';

const {createPeopleReferenceCommitPort,COMMIT}=require('../capabilities/people-reference-commit-port');
const {createPersonReferenceQuery}=require('../capabilities/people-reference-lifecycle');
const { createPeopleStore } = require('../persistence/people-store');
const { createPeopleProfileUpdate } = require('../capabilities/people-profile-update');
const { createDirectPersonRegistrationFromPersistence } = require('../capabilities/people-registration-lifecycle');
const { createPeopleImageOperationCoordinator } = require('../application/people-image-operation-coordinator');
const {createPeopleProcessServices}=require('../application/people-process-services');
const {createPeopleCatalogueRegistrationCommand}=require('../application/us-adult-catalogue-registration-command');
const {createUsAdultCatalogueRegistrationAdmission,pending}=require('../application/us-adult-catalogue-registration-admission');
const {createPeopleImageOperationStore}=require('../persistence/people-image-operation-store');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const { createPeopleImagePreparationPorts, IMPORT, EMBED } = require('../capabilities/people-image-preparation-ports');
const { createPeopleImagePreparationPlanner, createPeopleImageProjections } = require('../planning/people-image-preparation-planner');
const {createSystemRegistrationQuery}=require('../application/system-registration-query');
const {createSystemRegistrationCoordinator}=require('../application/system-registration-coordinator');
const {createSystemRegistrationPorts}=require('../capabilities/system-registration-ports');
const {createSystemRegistrationPlanning}=require('../planning/system-registration-planner');
const {createSystemMerge}=require('../application/system-merge');
const mergeModel=require('../model/system-merge-work');
const {createPeopleArtifactReclamation}=require('../application/reference-artifact-reclamation');
const {createReferenceArtifactReclamationPlanning}=require('../planning/reference-artifact-reclamation-planner');

function createPeopleImageExecutionRegistration(options) {
  const peopleStore = createPeopleStore(options);
  let sources=null;
  const systemRegistrationQuery=createSystemRegistrationQuery({...options,readSource:input=>{
    if(!sources)throw new TypeError('System Registration requires its Arca public Evidence sources.');
    return (input.sourceKind==='nfo'?sources.nfo:sources.cast).read(input);
  }}),systemRegistration=createSystemRegistrationCoordinator({...options,peopleStore}),
    systemPorts=createSystemRegistrationPorts({...options,peopleStore,systemRegistrationQuery});
  const systemMerge=createSystemMerge({...options,peopleStore}),mergeOptions={...options,peopleStore,systemRegistrationQuery:systemMerge.query,systemModel:mergeModel,
    systemProcessType:'people_system_merge',systemSourcePort:'personIdentitiesAliasesReferences',systemAlwaysCommit:true,
    systemWorkKind:'system_person_merge',systemPlannerRef:'helix://people/planners/SystemMerge/v1',systemProjectionPrefix:'helix://people/projections/system-merge/',
    systemEvidence:(workId,at)=>systemMerge.query.evidence(workId,at),systemMessage:(phase,payload)=>phase==='candidate'?{
      messageKind:'people.merge-candidate.opened',aggregateType:'people-candidate',aggregateId:payload.draftId,aggregateRevision:1,
      payloadSchemaRef:'helix://contracts/signals/people-candidate-opened/v1',payload:{candidateId:payload.draftId,candidateRevision:1,candidatePayloadDigest:payload.candidatePayloadDigest}}:{
      messageKind:'people.person.merged',aggregateType:'person',aggregateId:payload.targetPersonId,aggregateRevision:payload.expectedTargetPersonRevision+1,
      payloadSchemaRef:'helix://contracts/signals/people-person-merged/v1',payload:{sourcePersonId:payload.sourcePersonId,sourcePersonRevision:payload.expectedSourcePersonRevision+1,
        targetPersonId:payload.targetPersonId,targetPersonRevision:payload.expectedTargetPersonRevision+1,candidateId:payload.candidateId}}},
    mergePorts=createSystemRegistrationPorts(mergeOptions);
  const registrationCommand = createDirectPersonRegistrationFromPersistence(peopleStore, options);
  const catalogueCompletion = { run: null };
  const imageOperations = createPeopleImageOperationCoordinator({ ...options, peopleStore, registrationCommand,
    completeCatalogueRegistration(operation) { catalogueCompletion.run?.(operation); },
    imagePort: options.peopleImagePort || { stageUpload() { throw new Error('People image ingress is unavailable.'); } },
    readSelectedImage: options.readSelectedPersonImage || (async () => { throw new Error('People image source is unavailable.'); }) });
  function catalogueCommandReady(admissionOptions) {
    const artifactRepository = admissionOptions.artifactRepository || options.artifactRepository;
    const peopleImagePort = admissionOptions.peopleImagePort || options.peopleImagePort;
    const catalogueInputReader = admissionOptions.catalogueInputReader || options.catalogueInputReader;
    return typeof artifactRepository?.get === 'function' && typeof peopleImagePort?.readArtifact === 'function' &&
      typeof catalogueInputReader?.compile === 'function';
  }
  function catalogueRegistrationCommand(admissionOptions, catalogueInputReader) {
    const operationStore = admissionOptions.operationStore || options.operationStore ||
      createPeopleImageOperationStore({ ...options, ...admissionOptions });
    return createPeopleCatalogueRegistrationCommand({
      ...options, ...admissionOptions, peopleStore, operationStore,
      commandCoordinator: admissionOptions.commandCoordinator || options.commandCoordinator || createCommandCommitCoordinator(options),
      catalogueInputReader,
      artifactRepository: admissionOptions.artifactRepository || options.artifactRepository,
      peopleImagePort: admissionOptions.peopleImagePort || options.peopleImagePort,
      workResultReader: admissionOptions.workResultReader || options.workResultReader,
      contractValidator: admissionOptions.contractValidator || options.contractValidator,
      unitOfWork: admissionOptions.unitOfWork || options.unitOfWork,
    });
  }
  function bindCatalogueCompletion(readEvidence, admissionOptions = {}) {
    if (typeof readEvidence !== 'function' || !catalogueCommandReady(admissionOptions)) return;
    catalogueCompletion.run = (operation) => {
      const initialReference = imageOperations.referenceDecision(operation.operationId);
      const built = readEvidence({ operation, initialReference });
      if (!built || built.kind === 'waiting') return;
      catalogueRegistrationCommand(admissionOptions, admissionOptions.catalogueInputReader || options.catalogueInputReader)
        .register({ ...built, initialReference });
    };
  }
  bindCatalogueCompletion(options.readCatalogueRegistrationEvidence, {});
  const preparationPorts = createPeopleImagePreparationPorts({ ...options, operationContext: imageOperations.context,
    preparation: options.peopleReferencePreparation || { importImage() { throw new Error('People image import is unavailable.'); },
      computeEmbedding() { throw new Error('People reference compute is unavailable.'); } } });
  const sharedPorts=Object.fromEntries([mergeModel.CANDIDATE,mergeModel.PERSON].map(capability=>[capability,Object.fromEntries(['execute','validateInputs','validateResult'].map(method=>
    [method,(context,...args)=>(context.ownerScope?.processType==='people_system_merge'?mergePorts:systemPorts)[capability][method](context,...args)]))]));
  const artifactReclamation=createPeopleArtifactReclamation(options);
  const ports={...artifactReclamation.ports,...preparationPorts,...systemPorts,...sharedPorts,[mergeModel.OBSERVE]:mergePorts[mergeModel.OBSERVE],
    [COMMIT]:createPeopleReferenceCommitPort({...options,peopleStore,referenceDecision:imageOperations.referenceDecision})};
  const profileUpdate=createPeopleProfileUpdate({...options,peopleStore});
  function createCatalogueRegistrationAdmission(admissionOptions={}){
    if (typeof admissionOptions.readCatalogueRegistrationEvidence === 'function')
      bindCatalogueCompletion(admissionOptions.readCatalogueRegistrationEvidence, admissionOptions);
    const assembleEvidence=admissionOptions.assembleEvidence||options.assembleCatalogueRegistrationEvidence||(({input,inputDigest})=>{
      pending('PEOPLE_CATALOGUE_EVIDENCE_PENDING',
        'Host catalogue registration evidence (provider/frame proof and image prep) is not ready for '+String(input?.winner?.name||inputDigest||'actor')+'.');
    });
    return createUsAdultCatalogueRegistrationAdmission({
      peopleStore,
      assembleEvidence,
      register(evidence){
        const catalogueInputReader=admissionOptions.catalogueInputReader||options.catalogueInputReader||{
          compile({libraRunId}){
            if(evidence.input.libraRunId!==libraRunId)pending('PEOPLE_CATALOGUE_INPUT_STALE','Catalogue decision input Run changed.');
            return {kind:'qualified',input:evidence.input,inputDigest:evidence.inputDigest};
          }};
        return catalogueRegistrationCommand(admissionOptions,catalogueInputReader).register(evidence);
      },
    });
  }
  return Object.freeze({
    peopleStore,
    createCatalogueRegistrationAdmission,
    createProcessServices(processOptions){sources={cast:processOptions.onDeckPersonEvidenceProjection,nfo:processOptions.onDeckNfoPersonEvidence};
      return createPeopleProcessServices({...options,...processOptions,peopleStore,imageOperations,profileUpdate,systemRegistration,systemMerge,artifactReclamation});},
    artifactReclamation,
    createReferenceQuery:()=>createPersonReferenceQuery(peopleStore),
    createRegistrations(manifests) {
      return [IMPORT, EMBED,COMMIT,...Object.keys(systemPorts),mergeModel.OBSERVE,...Object.keys(artifactReclamation.ports)].map(capabilityRef => ({ manifest: manifests[capabilityRef], executor: { version: 1, execute: context => ports[capabilityRef].execute(context) },
        semanticValidator: { ref: manifests[capabilityRef].semanticValidatorRef,
          validateInputs: context => ports[capabilityRef].validateInputs(context), validateResult: (context, outcome) => ports[capabilityRef].validateResult(context, outcome) } }));
    },
    createPlanningRegistration(planning) {
      const planner = createPeopleImagePreparationPlanner({ ...planning, context: imageOperations.context });
      const system=createSystemRegistrationPlanning({...planning,systemRegistrationQuery});
      const merge=createSystemRegistrationPlanning({...mergeOptions,...planning}),reclamation=createReferenceArtifactReclamationPlanning({...planning,artifactReclamation});
      return { planners: [{ ownerDomain: 'people', workKind: 'people_image_preparation', plannerContractRef: planner.plannerContractRef, plannerVersion: 1, planner },...system.planners,...merge.planners,...reclamation.planners],
        bindingProjections: [...createPeopleImageProjections({ context: imageOperations.context,referenceDecision:imageOperations.referenceDecision }),...system.bindingProjections,...merge.bindingProjections,...reclamation.bindingProjections] };
    },
  });
}

module.exports = Object.freeze({ createPeopleImageExecutionRegistration });
