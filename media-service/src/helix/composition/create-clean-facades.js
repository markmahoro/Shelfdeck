'use strict';

const routeRegistry = require('./admin-route-registry');
const { MAX_SESSION_TTL_MS } = require('../platform/public/session-token-service');

function unavailable(route) {
  const workerUnavailable = route.facade === 'PlatformAdminFacade' &&
    route.facadeMethod.includes('workers');
  const code = workerUnavailable
    ? 'REMOTE_WORKER_NOT_AVAILABLE_IN_BETA'
    : 'CLEAN_FACADE_NOT_IMPLEMENTED';
  const message = workerUnavailable
    ? 'ShelfDeck Service Beta不包含Remote Worker。'
    : '该Clean Facade尚未完成Product实现。';
  return async () => ({
    status: workerUnavailable ? 404 : 503,
    body: {
      error: {
        code,
        message,
        details: { routeId: route.routeId },
      },
    },
  });
}

function createCleanFacades(options) {
  if (!options || !options.sessionTokens || !options.readiness) {
    throw new TypeError('Session token and readiness dependencies are required.');
  }
  const facades = {};
  for (const route of routeRegistry.entries) {
    facades[route.facade] ||= {};
    facades[route.facade][route.facadeMethod] ||= unavailable(route);
  }

  facades.HealthFacade.read_health = async () => ({
    body: {
      status: 'ok',
      generation: options.readiness.generation,
      normalSupplyAllowed: options.runtimeOperations?options.runtimeOperations.snapshot().normalSupplyAllowed:true,
    },
  });
  if(options.runtimeOperations){
    const runtime=options.runtimeOperations;
    facades.PlatformAdminFacade.get_runtime=async()=>({body:runtime.snapshot()});
    facades.PlatformAdminFacade.post_runtime_stop=async input=>({status:202,body:runtime.stop(input.body,input.actor)});
    facades.PlatformAdminFacade.post_runtime_resume=async input=>({status:202,body:runtime.resume(input.body,input.actor)});
    facades.PlatformAdminFacade.get_runtime_reset_preview=async()=>({body:await runtime.previewReset()});
    facades.PlatformAdminFacade.post_runtime_reset=async input=>({status:202,body:await runtime.reset(input.body,input.actor)});
  }
  if(options.maintenanceWindow){
    facades.PlatformAdminFacade.get_runtime_maintenance=async()=>({body:options.maintenanceWindow.configuration()});
    facades.PlatformAdminFacade.patch_runtime_maintenance=async input=>({body:options.maintenanceWindow.configure(input.body,input.actor.actorId)});
  }
  facades.PlatformAdminFacade.post_session = async (input) => {
    const ttlMs = input.body?.ttlMs ?? MAX_SESSION_TTL_MS;
    const token = options.sessionTokens.issueAuthenticated({
      credentialRevision: input.actor.credentialRevision,
      nowMs: input.nowMs,
      ttlMs,
      nonce: options.nonce(),
    });
    return {
      status: 204,
      body: null,
      sessionToken: token,
    };
  };
  facades.PlatformAdminFacade.delete_session = async () => ({
    status: 204,
    body: null,
    clearSession: true,
  });
  facades.PlatformAdminFacade.get_settings_security = async () => {
    const metadata = options.credentialMetadata();
    return {
      body: {
        credentialConfigured: true,
        credentialRevision: metadata.revision,
        createdAtMs: metadata.createdAtMs,
        lastUsedAtMs: metadata.lastUsedAtMs,
      },
    };
  };
  if (options.overviewQuery) {
    facades.OverviewQueryFacade.get_overview = async () => ({
      body: options.overviewQuery.get(),
    });
  }
  if (options.setupReadinessQuery) {
    facades.OverviewQueryFacade.get_setup_readiness = async () => ({
      body: options.setupReadinessQuery.get(),
    });
  }
  if (options.peopleAdminQuery) {
    facades.PeopleAdminFacade.get_people = async (input) => ({
      body: options.peopleAdminQuery.list(input.query || {}),
    });
    facades.PeopleAdminFacade.get_people_personid = async (input) => ({
      body: options.peopleAdminQuery.get(input.params.personId),
    });
    if(typeof options.arcaCollectionQuery?.relatedWorks==='function')facades.ArcaCollectionFacade.get_people_personid_collection=async input=>{
      const scope=options.peopleAdminQuery.relatedWorksScope(input.params.personId);
      if(!scope)throw Object.assign(new Error('Person was not found.'),{code:'PEOPLE_PERSON_NOT_FOUND'});
      return {body:options.arcaCollectionQuery.relatedWorks({...scope,
        cursor:input.query?.cursor,limit:input.query?.limit})};
    };
    if (options.peopleAvatarQuery) {
      facades.PeopleAdminFacade.get_people_personid_avatar = async (input) => {
        const value = await options.peopleAvatarQuery.get(input.params.personId,input.query||{});
        return { body: value.bytes, contentType: value.contentType,headers:{'Cache-Control':'private, no-store'} };
      };
    }
    facades.PeopleAdminFacade.get_people_registration_candidates = async () => ({
      body: options.peopleAdminQuery.registrationCandidates(),
    });
    facades.PeopleAdminFacade.get_people_merge_candidates = async () => ({
      body: options.peopleAdminQuery.mergeCandidates(),
    });
    if (options.peopleAdmin) {
      facades.PeopleAdminFacade.patch_people_personid = async input => ({body:options.peopleAdmin.updateProfile(input.params.personId,input.body,input.actor)});
      facades.PeopleAdminFacade.post_people_personid_reference_assets = async input=>({status:202,body:await options.peopleAdmin.addReference(input.params.personId,input.body,input.actor)});
      facades.PeopleAdminFacade.delete_people_personid_reference_assets_assetid=async input=>({status:202,body:options.peopleAdmin.releaseReference(input.params.personId,input.params.assetId,input.body,input.actor)});
      facades.PeopleAdminFacade.get_people_operations_operationid = async input => ({ body: options.peopleAdmin.imageOperation(input.params.operationId) });
      facades.PeopleAdminFacade.get_people_recommendations = async()=>({body:options.peopleAdmin.recommendations()});
      facades.PeopleAdminFacade.post_people_recommendations_recommendationid_actions_claim = async input=>({status:202,
        body:await options.peopleAdmin.claimRecommendation(input.params.recommendationId,input.body,input.actor)});
      facades.PeopleAdminFacade.get_people_recommendation_claims_claimid = async input=>({body:options.peopleAdmin.recommendationClaim(input.params.claimId)});
      facades.PeopleAdminFacade.get_people_recommendations_recommendationid_image = async input=>{
        const image=await options.peopleAdmin.recommendationImage(input.params.recommendationId);
        return {body:image.bytes,contentType:image.mediaType,headers:{'Cache-Control':'private, no-store'}};
      };
      facades.PeopleAdminFacade.get_people_image_search = async input => ({ body: await options.peopleAdmin.searchImages(input.query.name) });
      facades.PeopleAdminFacade.get_people_image_search_preview = async input => {
        const image = await options.peopleAdmin.previewImage(input.query.selectionToken);
        return { body: image.bytes, contentType: image.mediaType, headers: { 'Cache-Control': 'private, no-store' } };
      };
      facades.PeopleAdminFacade.post_people_actions_register = async (input) => ({
        status: 200,
        body: { person: options.peopleAdmin.accept(input.body, input.actor) },
      });
      facades.PeopleAdminFacade.post_people = async (input) => ({
        status: 202,
        body: await options.peopleAdmin.register(input.body, input.actor),
      });
      facades.PeopleAdminFacade.post_people_actions_dismiss_candidate = async (input) => ({
        status: 200,
        body: { candidate: options.peopleAdmin.dismiss(input.body, input.actor) },
      });
    }
  }
  if (options.platformIntegrationAdmin) {
    facades.PlatformAdminFacade.get_settings_integrations_kind =
      async (input) => ({
        body: options.platformIntegrationAdmin.get(input.params.kind),
      });
    facades.PlatformAdminFacade.patch_settings_integrations_kind =
      async (input) => ({
        body: await options.platformIntegrationAdmin.configure(
          input.params.kind,
          input.body,
        ),
      });
    facades.PlatformAdminFacade.post_settings_integrations_kind_actions_test =
      async (input) => ({
        body: await options.platformIntegrationAdmin.test(
          input.params.kind,
          input.body,
        ),
      });
    facades.PlatformAdminFacade.post_settings_integrations_kind_actions_disconnect =
      async (input) => ({
        body: options.platformIntegrationAdmin.disconnect(
          input.params.kind,
          input.body,
        ),
      });
  }
  if(options.workspaceRootAdmin){
    facades.PlatformAdminFacade.get_settings_workspaces=async()=>({body:options.workspaceRootAdmin.get()});
    facades.PlatformAdminFacade.patch_settings_workspaces=async(input)=>({body:options.workspaceRootAdmin.configure(input.body)});
    facades.PlatformAdminFacade.post_settings_workspaces_actions_probe=async(input)=>({body:options.workspaceRootAdmin.probe(input.body)});
  }
  if (options.procurementAdmin) {
    facades.ProcurementAdminFacade.get_material_fields = async () => ({
      body: options.procurementAdmin.listMaterialFields(),
    });
    facades.ProcurementAdminFacade.get_material_fields_fieldid = async (input) => ({
      body: options.procurementAdmin.getMaterialField(input.params.fieldId),
    });
    facades.ProcurementAdminFacade.post_material_fields = async (input) => ({
      status: 201,
      body: options.procurementAdmin.registerMaterialField(input.body, input.actor),
    });
    facades.ProcurementAdminFacade.get_material_fields_fieldid_extraction_policy = async (input) => ({
      body: options.procurementAdmin.getExtractionPolicy(input.params.fieldId),
    });
    facades.ProcurementAdminFacade.patch_material_fields_fieldid = async (input) => ({
      body: options.procurementAdmin.reviseMaterialFieldAccess(
        input.params.fieldId,
        input.body,
        input.actor,
      ),
    });
    facades.ProcurementAdminFacade.patch_material_fields_fieldid_extraction_policy = async (input) => ({
      body: options.procurementAdmin.publishExtractionPolicy(input.params.fieldId, input.body),
    });
    facades.ProcurementAdminFacade.post_material_fields_fieldid_actions_deregister = async (input) => ({
      body: options.procurementAdmin.deregisterMaterialField(input.params.fieldId, input.body),
    });
    facades.ProcurementAdminFacade.post_material_fields_fieldid_actions_observe = async (input) => ({
      status: 202,
      body: await options.procurementAdmin.requestFieldObservation(input.params.fieldId, input.body),
    });
    facades.ProcurementAdminFacade.post_material_fields_fieldid_actions_retry_failed_preparation = async (input) => ({
      body: options.procurementAdmin.retryFailedPreparation(
        input.params.fieldId,
        input.body,
        input.actor,
      ),
    });
  }
  if (options.arcaShelfAdmin) {
    facades.ArcaShelfAdminFacade.get_shelves = async () => ({ body: options.arcaShelfAdmin.listShelves() });
    facades.ArcaShelfAdminFacade.post_shelves = async (input) => ({ status: 201, body: options.arcaShelfAdmin.createShelf(input.body) });
    facades.ArcaShelfAdminFacade.get_shelves_shelfid = async (input) => ({ body: options.arcaShelfAdmin.getShelf(input.params.shelfId) });
    facades.ArcaShelfAdminFacade.patch_shelves_shelfid = async (input) => ({ body: options.arcaShelfAdmin.renameShelf(input.params.shelfId, input.body) });
    facades.ArcaShelfAdminFacade.get_shelves_shelfid_standard = async (input) => ({ body: options.arcaShelfAdmin.getStandard(input.params.shelfId) });
    facades.ArcaShelfAdminFacade.get_shelves_shelfid_placement = async (input) => ({ body: options.arcaShelfAdmin.getPlacement(input.params.shelfId) });
    facades.ArcaShelfAdminFacade.patch_shelves_shelfid_placement = async (input) => {const body=options.arcaShelfAdmin.revisePlacement(input.params.shelfId, input.body);options.arcaCare?.shelfBasisChanged(input.params.shelfId);return {body};};
    facades.ArcaShelfAdminFacade.post_shelves_shelfid_placement_actions_preview = async (input) => ({ body: options.arcaShelfAdmin.previewPlacement(input.params.shelfId, input.body) });
    facades.ArcaShelfAdminFacade.post_shelves_shelfid_actions_deregister = async (input) => ({ status:202,body: options.arcaShelfAdmin.deregisterShelf(input.params.shelfId, input.body) });
    facades.ArcaShelfAdminFacade.get_settings_automatic_operation = async () => ({
      body: options.arcaShelfAdmin.getAutomaticOperation(),
    });
    facades.ArcaShelfAdminFacade.post_settings_automatic_operation_actions_enable_full = async (input) => ({
      body: options.arcaShelfAdmin.enableFullAutomaticOperation(input.body, input.actor),
    });
    facades.ArcaShelfAdminFacade.post_settings_automatic_operation_actions_require_settlement_confirmation = async (input) => ({
      body: options.arcaShelfAdmin.requireSettlementConfirmation(input.body, input.actor),
    });
  }
  if (options.arcaRuleTemplateAdmin) {
    facades.ArcaShelfAdminFacade.post_shelves_shelfid_actions_bind_template = async (input) => {const body=options.arcaRuleTemplateAdmin.bindShelf(input.params.shelfId, input.body);options.arcaCare?.shelfBasisChanged(input.params.shelfId);return {body};};
    facades.ArcaShelfAdminFacade.get_rule_templates = async () => ({
      body: options.arcaRuleTemplateAdmin.listTemplates(),
    });
    facades.ArcaShelfAdminFacade.get_rule_templates_templateid = async (input) => ({
      body: options.arcaRuleTemplateAdmin.getTemplate(input.params.templateId),
    });
    facades.ArcaShelfAdminFacade.post_rule_templates_templateid_actions_copy = async (input) => ({
      status: 201,
      body: options.arcaRuleTemplateAdmin.copyTemplate(input.params.templateId, input.body),
    });
    facades.ArcaShelfAdminFacade.get_rule_templates_templateid_draft = async (input) => ({
      body: options.arcaRuleTemplateAdmin.getDraft(input.params.templateId),
    });
    facades.ArcaShelfAdminFacade.patch_rule_templates_templateid_draft = async (input) => ({
      body: options.arcaRuleTemplateAdmin.reviseDraft(input.params.templateId, input.body),
    });
    facades.ArcaShelfAdminFacade.post_rule_templates_templateid_actions_preview = async (input) => ({
      body: options.arcaRuleTemplateAdmin.previewTemplate(input.params.templateId, input.body),
    });
    facades.ArcaShelfAdminFacade.post_rule_templates_templateid_actions_publish = async (input) => ({
      body: options.arcaRuleTemplateAdmin.publishTemplate(input.params.templateId, input.body),
    });
    facades.ArcaShelfAdminFacade.post_rule_templates_templateid_actions_archive = async (input) => ({
      body: options.arcaRuleTemplateAdmin.archiveTemplate(input.params.templateId, input.body),
    });
    facades.ArcaShelfAdminFacade.get_rule_templates_templateid_revisions = async (input) => ({
      body: options.arcaRuleTemplateAdmin.history(input.params.templateId),
    });
  }
  if (options.libraFieldIntakeAdmissionAdmin) {
    facades.LibraAdminFacade.get_libra_workshops_secondary = async () => ({
      body: options.libraFieldIntakeAdmissionAdmin.getSecondaryWorkshop(),
    });
    facades.LibraAdminFacade.patch_libra_workshops_secondary = async (input) => ({
      body: options.libraFieldIntakeAdmissionAdmin.reviseSecondaryWorkshop(input.body),
    });
    facades.LibraAdminFacade.get_libra_material_fields_fieldid_intake_admission = async (input) => ({
      body: options.libraFieldIntakeAdmissionAdmin.getFieldIntakeAdmission(input.params.fieldId),
    });
    facades.LibraAdminFacade.patch_libra_material_fields_fieldid_intake_admission = async (input) => ({
      body: options.libraFieldIntakeAdmissionAdmin.reviseFieldIntakeAdmission(input.params.fieldId, input.body),
    });
  }
  if (options.libraRoutingAdmin) {
    facades.LibraFormationFacade.get_routing_material_fields_fieldid = async (input) => ({ body: options.libraRoutingAdmin.get(input.params.fieldId) });
    facades.LibraFormationFacade.post_routing_material_fields_fieldid_actions_preview = async (input) => ({ body: options.libraRoutingAdmin.preview(input.params.fieldId, input.body) });
    facades.LibraFormationFacade.patch_routing_material_fields_fieldid = async (input) => ({ body: options.libraRoutingAdmin.publish(input.params.fieldId, input.body) });
    facades.LibraFormationFacade.get_routing_material_fields_fieldid_revisions = async (input) => ({ body: options.libraRoutingAdmin.history(input.params.fieldId) });
  }
  if (options.formationQuery) {
    facades.PlatformAdminFacade.get_formation = async (input) => ({ body: options.formationQuery.list(input.query || {}) });
    facades.LibraFormationFacade.get_formation_formationviewid = async (input) => ({
      body: options.formationQuery.get(input.params.formationViewId),
    });
  }
  if (options.routingManualSelection) {
    facades.LibraFormationFacade.post_formation_subjects_subjectid_actions_choose_shelf = async (input) => ({
      body: options.routingManualSelection.choose(input.params.subjectId, input.body),
    });
  }
  if(options.libraPreparationRecovery){
    facades.LibraFormationFacade.get_formation_preparation_failures=async input=>({body:options.libraPreparationRecovery.list(input.query)});
    facades.LibraFormationFacade.post_formation_preparation_failures_workid_actions_retry=async input=>({status:202,
      body:options.libraPreparationRecovery.retry(input.params.workId)});
  }
  if (options.libraRunAdmin) {
    facades.LibraFormationFacade.post_formation_subjects_subjectid_actions_abandon = async input => ({
      body:options.libraRunAdmin.abandonSubject(input.params.subjectId,input.body),
    });
    facades.LibraFormationFacade.get_formation_defect_authorization = async () => ({
      body:{authorization:options.libraRunAdmin.readAutomaticAuthorization()},
    });
    facades.LibraFormationFacade.patch_formation_defect_authorization = async input => ({
      body:options.libraRunAdmin.setAutomaticAuthorization(input.body),
    });
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_expedite = async (input) => ({
      body: options.libraRunAdmin.expedite(input.params.libraRunId, input.body),
    });
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_cancel_expedite = async (input) => ({
      body: options.libraRunAdmin.cancelExpedite(input.params.libraRunId, input.body),
    });
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_discard = async (input) => ({
      body: options.libraRunAdmin.discard(input.params.libraRunId, input.body),
    });
    facades.LibraFormationFacade.get_formation_runs_librarunid_defect_admission_candidate = async (input) => ({
      body: options.libraRunAdmin.previewDefects(input.params.libraRunId),
    });
    facades.LibraFormationFacade.get_formation_runs_librarunid_outcome=async input=>({
      body:{outcome:options.libraRunAdmin.readOutcome(input.params.libraRunId)},
    });
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_reprocess=async input=>{
      const fields=options.libraRunAdmin.reprocessSourceFieldIds(input.params.libraRunId);
      const intent=options.libraRunAdmin.requestReprocess(input.params.libraRunId,input.body);
      const observations=[];
      for(const field of fields)observations.push(await options.procurementAdmin.requestReprocessObservation(field,intent.intentId));
      return {status:202,body:{...intent,observations}};
    };
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_admit_with_defects = async (input) => ({
      body: options.libraRunAdmin.admitWithDefects(input.params.libraRunId, input.body),
    });
  }
  if (options.productIdentitySelection) {
    facades.LibraFormationFacade.get_formation_runs_librarunid_product_identity_preview = async (input) => ({
      body: await options.productIdentitySelection.preview(input.params.libraRunId, input.query),
    });
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_choose_product_identity = async (input) => ({
      status: 202,
      body: options.productIdentitySelection.choose(input.params.libraRunId, input.body, input.actor),
    });
  }
  if(options.usAdultActorChoice){
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_choose_us_adult_actor=async input=>({status:202,
      body:options.usAdultActorChoice.choose(input.params.libraRunId,input.body,input.actor.actorId)});
  }
  if(options.usAdultActorSelectionQuery){
    facades.LibraFormationFacade.get_formation_runs_librarunid_actor_selection=async input=>({
      body:options.usAdultActorSelectionQuery.read(input.params.libraRunId)});
  }
  if (options.arcaAcceptanceRecovery) {
    facades.ArcaShelfAdminFacade.post_formation_acceptance_offerid_actions_retry = async (input) => ({
      status:202, body:options.arcaAcceptanceRecovery.retry(input.params.offerId),
    });
  }
  if (options.perceptionAdmin) {
    facades.PerceptionAdminFacade.post_perception_records = async (input) => ({ status:202, body:options.perceptionAdmin.createRecord(input.body) });
    facades.PerceptionAdminFacade.get_perception_records = async (input) => ({ body:options.perceptionAdmin.listRecords(input.query || {}) });
    facades.PerceptionAdminFacade.get_perception_acquisitions = async () => ({ body:{ items:options.perceptionAdmin.listAcquisitions() } });
    facades.PerceptionAdminFacade.post_perception_actions_sync = async (input) => ({ status:202, body:options.perceptionAdmin.requestAcquisition(input.body,input.actor) });
    facades.PerceptionAdminFacade.get_perception_sync_state = async () => ({ body:options.perceptionAdmin.syncState() });
  }
  if (options.arcaCollectionQuery) {
    facades.ArcaCollectionFacade.get_collection = async (input) => ({ body:options.arcaCollectionQuery.list(input.query || {}) });
    facades.ArcaCollectionFacade.get_collection_shelfentryid = async (input) => {
      const item=options.arcaCollectionQuery.get(input.params.shelfEntryId);
      if(!item){const error=new Error('Shelf Entry was not found.');error.code='ARCA_SHELF_ENTRY_NOT_FOUND';throw error;}
      return {body:item};
    };
    facades.ArcaCollectionFacade.get_collection_shelfentryid_poster = async (input) => {
      const value=await options.arcaCollectionQuery.getPoster(input.params.shelfEntryId,input.query || {});
      if(!value){const error=new Error('Shelf Entry poster was not found.');error.code='ARCA_SHELF_ENTRY_POSTER_NOT_FOUND';throw error;}
      return {body:value.bytes,contentType:value.contentType,headers:value.headers};
    };
  }
  if(options.arcaUsAdultActorRefresh){
    const app=options.arcaUsAdultActorRefresh;
    facades.ArcaCollectionFacade.get_collection_shelfentryid_actor_refresh=async input=>({body:app.read(input.params.shelfEntryId)});
    facades.ArcaCollectionFacade.post_collection_shelfentryid_actions_refresh_us_adult_actor=async input=>({status:202,
      body:app.request(input.params.shelfEntryId,input.body,input.actor.actorId)});
  }
  if(options.arcaJavCorrectionAdmin){const app=options.arcaJavCorrectionAdmin;
    facades.ArcaCollectionFacade.get_collection_jav_corrections=async input=>({body:app.list(input.query||{})});
    facades.ArcaCollectionFacade.get_collection_shelfentryid_actions_preview_jav_correction=async input=>({body:await app.preview(input.params.shelfEntryId,{...input.query})});
    facades.ArcaCollectionFacade.post_collection_shelfentryid_actions_confirm_jav_correction=async input=>({status:202,body:app.confirm(input.params.shelfEntryId,input.body,input.actor.actorId)});
    facades.ArcaCollectionFacade.get_collection_shelfentryid_jav_corrections_correctionid=async input=>({body:app.status(input.params.shelfEntryId,input.params.correctionId)});
    facades.ArcaCollectionFacade.post_collection_shelfentryid_jav_corrections_correctionid_actions_cancel=async input=>({body:app.cancel(input.params.shelfEntryId,input.params.correctionId,input.body,input.actor.actorId)});
    facades.ArcaCollectionFacade.post_collection_shelfentryid_jav_corrections_correctionid_actions_recover=async input=>({status:202,body:await app.recover(input.params.shelfEntryId,input.params.correctionId,input.body,input.actor.actorId)});
    facades.ArcaCollectionFacade.get_collection_shelfentryid_jav_correction=async input=>({body:app.latest(input.params.shelfEntryId)});
  }
  if(options.arcaRecycle){
    const app=options.arcaRecycle;
    facades.ArcaCareFacade.get_care_recycle=async(input)=>({body:app.list(input.query||{})});
    facades.ArcaCareFacade.get_care_recycle_shelfentryid_preview=async(input)=>({body:await app.preview(input.params.shelfEntryId,input.query?.sourceLocation)});
    facades.ArcaCareFacade.post_care_recycle_shelfentryid_actions_archive=async(input)=>({status:202,body:await app.archive(input.params.shelfEntryId,input.body)});
    facades.ArcaCareFacade.post_care_recycle_recycleentryid_actions_restore=async(input)=>({status:202,body:await app.restore(input.params.recycleEntryId)});
  }
  if(options.arcaDefectAdmission) {
    const app=options.arcaDefectAdmission;
    facades.ArcaCareFacade.get_care_shelfentryid_defect_admission_candidate=async input=>({body:app.preview(input.params.shelfEntryId)});
    facades.ArcaCareFacade.post_care_shelfentryid_actions_accept_defects=async input=>({body:app.accept(input.params.shelfEntryId,input.body,'admin')});
    facades.ArcaCareFacade.post_care_shelfentryid_actions_repair_accepted_defects=async input=>({status:202,body:app.repair(input.params.shelfEntryId,input.body,'admin')});
  }
  if (options.arcaCare) {
    facades.ArcaCareFacade.get_care = async (input) => ({ body:options.arcaCare.list(input.query || {}) });
    facades.ArcaCareFacade.get_care_shelfentryid = async (input) => {
      const value=options.arcaCare.detail(input.params.shelfEntryId);if(!value){const error=new Error('Shelf Entry was not found.');error.code='ARCA_SHELF_ENTRY_NOT_FOUND';throw error;}return {body:value};
    };
    facades.ArcaCareFacade.post_care_shelfentryid_actions_check = async (input) => {
      const value=options.arcaCare.check(input.params.shelfEntryId,input.body?.idempotencyKey);if(!value){const error=new Error('Shelf Entry was not found.');error.code='ARCA_SHELF_ENTRY_NOT_FOUND';throw error;}return {status:202,body:value};
    };
  }
  if(options.arcaOffdeck){
    const app=options.arcaOffdeck;
    facades.ArcaOffdeckFacade.get_offdeck_policies=async()=>({body:app.policy()});
    facades.ArcaOffdeckFacade.patch_offdeck_policies=async(input)=>({body:app.publishPolicy(input.body)});
    facades.ArcaOffdeckFacade.get_offdeck_candidates=async(input)=>({body:app.candidates(input.query||{})});
    facades.ArcaOffdeckFacade.post_offdeck_actions_evaluate=async()=>({status:202,body:app.evaluate()});
    facades.ArcaOffdeckFacade.post_offdeck_actions_detect_duplicates=async()=>({status:202,body:app.detectDuplicates()});
    facades.ArcaOffdeckFacade.post_offdeck_candidates_candidateid_actions_suppress=async(input)=>({body:app.suppress(input.params.candidateId,input.body)});
    facades.ArcaOffdeckFacade.post_offdeck_duplicate_groups_groupid_actions_whitelist=async(input)=>({body:app.whitelist(input.params.groupId,input.body)});
    facades.ArcaOffdeckFacade.delete_offdeck_suppressions_suppressionid=async(input)=>({body:app.revokeSuppression(input.params.suppressionId)});
    facades.ArcaOffdeckFacade.delete_offdeck_duplicate_whitelists_whitelistid=async(input)=>({body:app.revokeWhitelist(input.params.whitelistId)});
    facades.ArcaOffdeckFacade.post_offdeck_reviews=async(input)=>({status:201,body:app.createReview(input.body)});
    facades.ArcaOffdeckFacade.get_offdeck_reviews_reviewid=async(input)=>({body:app.review(input.params.reviewId,input.query||{})});
    facades.ArcaOffdeckFacade.delete_offdeck_reviews_reviewid=async(input)=>({body:app.cancelReview(input.params.reviewId)});
    facades.ArcaOffdeckFacade.post_offdeck_reviews_reviewid_actions_confirm_selection=async(input)=>({body:app.confirmSelection(input.params.reviewId,input.body)});
    facades.ArcaOffdeckFacade.post_offdeck_reviews_reviewid_actions_confirm_high_volume=async(input)=>({body:app.confirmHighVolume(input.params.reviewId,input.body)});
    facades.ArcaOffdeckFacade.post_offdeck_authorizations=async(input)=>({status:202,body:app.authorize(input.body)});
    facades.ArcaOffdeckFacade.get_offdeck_cases=async(input)=>({body:app.cases(input.query||{})});
    facades.ArcaOffdeckFacade.get_offdeck_cases_caseid=async(input)=>({body:app.caseDetail(input.params.caseId)});
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(facades).map(([name, methods]) => [name, Object.freeze(methods)]),
  ));
}

module.exports = Object.freeze({ createCleanFacades });
