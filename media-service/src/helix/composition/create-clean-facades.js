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
  if (options.procurementAdmin) {
    facades.ProcurementAdminFacade.get_material_fields = async () => ({
      body: options.procurementAdmin.listMaterialFields(),
    });
    facades.ProcurementAdminFacade.get_material_fields_fieldid = async (input) => ({
      body: options.procurementAdmin.getMaterialField(input.params.fieldId),
    });
    facades.ProcurementAdminFacade.post_material_fields = async (input) => ({
      status: 201,
      body: options.procurementAdmin.registerMaterialField(input.body),
    });
    facades.ProcurementAdminFacade.get_material_fields_fieldid_extraction_policy = async (input) => ({
      body: options.procurementAdmin.getExtractionPolicy(input.params.fieldId),
    });
    facades.ProcurementAdminFacade.patch_material_fields_fieldid = async (input) => ({
      body: options.procurementAdmin.reviseMaterialFieldAccess(input.params.fieldId, input.body),
    });
    facades.ProcurementAdminFacade.patch_material_fields_fieldid_extraction_policy = async (input) => ({
      body: options.procurementAdmin.publishExtractionPolicy(input.params.fieldId, input.body),
    });
    facades.ProcurementAdminFacade.post_material_fields_fieldid_actions_deregister = async (input) => ({
      body: options.procurementAdmin.deregisterMaterialField(input.params.fieldId, input.body),
    });
  }
  if (options.arcaShelfAdmin) {
    facades.ArcaShelfAdminFacade.get_shelves = async () => ({ body: options.arcaShelfAdmin.listShelves() });
    facades.ArcaShelfAdminFacade.post_shelves = async (input) => ({ status: 201, body: options.arcaShelfAdmin.createShelf(input.body) });
    facades.ArcaShelfAdminFacade.get_shelves_shelfid = async (input) => ({ body: options.arcaShelfAdmin.getShelf(input.params.shelfId) });
    facades.ArcaShelfAdminFacade.patch_shelves_shelfid = async (input) => ({ body: options.arcaShelfAdmin.renameShelf(input.params.shelfId, input.body) });
    facades.ArcaShelfAdminFacade.get_shelves_shelfid_standard = async (input) => ({ body: options.arcaShelfAdmin.getStandard(input.params.shelfId) });
    facades.ArcaShelfAdminFacade.post_shelves_shelfid_actions_bind_template = async (input) => ({ body: options.arcaShelfAdmin.reviseStandard(input.params.shelfId, input.body) });
    facades.ArcaShelfAdminFacade.get_shelves_shelfid_placement = async (input) => ({ body: options.arcaShelfAdmin.getPlacement(input.params.shelfId) });
    facades.ArcaShelfAdminFacade.patch_shelves_shelfid_placement = async (input) => ({ body: options.arcaShelfAdmin.revisePlacement(input.params.shelfId, input.body) });
    facades.ArcaShelfAdminFacade.post_shelves_shelfid_placement_actions_preview = async (input) => ({ body: options.arcaShelfAdmin.previewPlacement(input.params.shelfId, input.body) });
  }
  if (options.libraRoutingAdmin) {
    facades.LibraFormationFacade.get_routing_material_fields_fieldid = async (input) => ({ body: options.libraRoutingAdmin.get(input.params.fieldId) });
    facades.LibraFormationFacade.post_routing_material_fields_fieldid_actions_preview = async (input) => ({ body: options.libraRoutingAdmin.preview(input.params.fieldId, input.body) });
    facades.LibraFormationFacade.patch_routing_material_fields_fieldid = async (input) => ({ body: options.libraRoutingAdmin.publish(input.params.fieldId, input.body) });
    facades.LibraFormationFacade.get_routing_material_fields_fieldid_revisions = async (input) => ({ body: options.libraRoutingAdmin.history(input.params.fieldId) });
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(facades).map(([name, methods]) => [name, Object.freeze(methods)]),
  ));
}

module.exports = Object.freeze({ createCleanFacades });
