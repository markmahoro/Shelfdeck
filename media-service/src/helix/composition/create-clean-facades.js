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
      normalSupplyAllowed: true,
    },
  });
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
    if (options.peopleAvatarQuery) {
      facades.PeopleAdminFacade.get_people_personid_avatar = async (input) => {
        const value = await options.peopleAvatarQuery.get(input.params.personId);
        return { body: value.bytes, contentType: value.contentType };
      };
    }
    facades.PeopleAdminFacade.get_people_registration_candidates = async () => ({
      body: options.peopleAdminQuery.registrationCandidates(),
    });
    facades.PeopleAdminFacade.get_people_merge_candidates = async () => ({
      body: options.peopleAdminQuery.mergeCandidates(),
    });
    if (options.peopleAdmin) {
      facades.PeopleAdminFacade.post_people_actions_register = async (input) => ({
        status: 201,
        body: { person: options.peopleAdmin.register(input.body, input.actor) },
      });
      facades.PeopleAdminFacade.post_people = async (input) => ({
        status: 200,
        body: { person: options.peopleAdmin.accept(input.body, input.actor) },
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
  if (options.libraRunAdmin) {
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
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_admit_with_defects = async (input) => ({
      body: options.libraRunAdmin.admitWithDefects(input.params.libraRunId, input.body),
    });
  }
  if (options.productIdentitySelection) {
    facades.LibraFormationFacade.post_formation_runs_librarunid_actions_choose_product_identity = async (input) => ({
      status: 202,
      body: options.productIdentitySelection.choose(input.params.libraRunId, input.body),
    });
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
    facades.PerceptionAdminFacade.post_perception_actions_sync = async (input) => ({ status:202, body:options.perceptionAdmin.requestAcquisition(input.body) });
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
      const value=options.arcaCollectionQuery.getPoster(input.params.shelfEntryId);
      if(!value){const error=new Error('Shelf Entry poster was not found.');error.code='ARCA_SHELF_ENTRY_POSTER_NOT_FOUND';throw error;}
      return {body:value.bytes,contentType:value.contentType};
    };
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
    facades.ArcaOffdeckFacade.get_offdeck_candidates=async()=>({body:app.candidates()});
    facades.ArcaOffdeckFacade.post_offdeck_actions_evaluate=async()=>({status:202,body:app.evaluate()});
    facades.ArcaOffdeckFacade.post_offdeck_actions_detect_duplicates=async()=>({status:202,body:app.detectDuplicates()});
    facades.ArcaOffdeckFacade.post_offdeck_candidates_candidateid_actions_suppress=async(input)=>({body:app.suppress(input.params.candidateId,input.body)});
    facades.ArcaOffdeckFacade.post_offdeck_duplicate_groups_groupid_actions_whitelist=async(input)=>({body:app.whitelist(input.params.groupId,input.body)});
    facades.ArcaOffdeckFacade.delete_offdeck_suppressions_suppressionid=async(input)=>({body:app.revokeSuppression(input.params.suppressionId)});
    facades.ArcaOffdeckFacade.delete_offdeck_duplicate_whitelists_whitelistid=async(input)=>({body:app.revokeWhitelist(input.params.whitelistId)});
    facades.ArcaOffdeckFacade.post_offdeck_reviews=async(input)=>({status:201,body:app.createReview(input.body)});
    facades.ArcaOffdeckFacade.get_offdeck_reviews_reviewid=async(input)=>({body:app.review(input.params.reviewId)});
    facades.ArcaOffdeckFacade.delete_offdeck_reviews_reviewid=async(input)=>({body:app.cancelReview(input.params.reviewId)});
    facades.ArcaOffdeckFacade.post_offdeck_reviews_reviewid_actions_confirm_selection=async(input)=>({body:app.confirmSelection(input.params.reviewId,input.body)});
    facades.ArcaOffdeckFacade.post_offdeck_reviews_reviewid_actions_confirm_high_volume=async(input)=>({body:app.confirmHighVolume(input.params.reviewId,input.body)});
    facades.ArcaOffdeckFacade.post_offdeck_authorizations=async(input)=>({status:202,body:app.authorize(input.body)});
    facades.ArcaOffdeckFacade.get_offdeck_cases=async()=>({body:app.cases()});
    facades.ArcaOffdeckFacade.get_offdeck_cases_caseid=async(input)=>({body:app.caseDetail(input.params.caseId)});
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(facades).map(([name, methods]) => [name, Object.freeze(methods)]),
  ));
}

module.exports = Object.freeze({ createCleanFacades });
