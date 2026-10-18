'use strict';

const {createPeopleReferenceCommitPort,COMMIT}=require('../capabilities/people-reference-commit-port');
const { createPeopleStore } = require('../persistence/people-store');
const { createPeopleProfileUpdate } = require('../capabilities/people-profile-update');
const { createDirectPersonRegistrationFromPersistence } = require('../capabilities/people-registration-lifecycle');
const { createPeopleImageOperationCoordinator } = require('../application/people-image-operation-coordinator');
const { createPeopleImagePreparationPorts, IMPORT, EMBED } = require('../capabilities/people-image-preparation-ports');
const { createPeopleImagePreparationPlanner, createPeopleImageProjections } = require('../planning/people-image-preparation-planner');

function createPeopleImageExecutionRegistration(options) {
  const peopleStore = createPeopleStore(options);
  const registrationCommand = createDirectPersonRegistrationFromPersistence(peopleStore, options);
  const imageOperations = createPeopleImageOperationCoordinator({ ...options, peopleStore, registrationCommand,
    imagePort: options.peopleImagePort || { stageUpload() { throw new Error('People image ingress is unavailable.'); } },
    readSelectedImage: options.readSelectedPersonImage || (async () => { throw new Error('People image source is unavailable.'); }) });
  const preparationPorts = createPeopleImagePreparationPorts({ ...options, operationContext: imageOperations.context,
    preparation: options.peopleReferencePreparation || { importImage() { throw new Error('People image import is unavailable.'); },
      computeEmbedding() { throw new Error('People reference compute is unavailable.'); } } });
  const ports={...preparationPorts,[COMMIT]:createPeopleReferenceCommitPort({...options,peopleStore,referenceDecision:imageOperations.referenceDecision})};
  return Object.freeze({ peopleStore, imageOperations, profileUpdate:createPeopleProfileUpdate({...options,peopleStore}),
    createRegistrations(manifests) {
      return [IMPORT, EMBED,COMMIT].map(capabilityRef => ({ manifest: manifests[capabilityRef], executor: { version: 1, execute: context => ports[capabilityRef].execute(context) },
        semanticValidator: { ref: manifests[capabilityRef].semanticValidatorRef,
          validateInputs: context => ports[capabilityRef].validateInputs(context), validateResult: (context, outcome) => ports[capabilityRef].validateResult(context, outcome) } }));
    },
    createPlanningRegistration(planning) {
      const planner = createPeopleImagePreparationPlanner({ ...planning, context: imageOperations.context });
      return { planners: [{ ownerDomain: 'people', workKind: 'people_image_preparation', plannerContractRef: planner.plannerContractRef, plannerVersion: 1, planner }],
        bindingProjections: createPeopleImageProjections({ context: imageOperations.context,referenceDecision:imageOperations.referenceDecision }) };
    },
  });
}

module.exports = Object.freeze({ createPeopleImageExecutionRegistration });
