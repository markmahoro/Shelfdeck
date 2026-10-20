'use strict';

const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const load = relative => require(path.join(root, relative));
const { canonicalDigest } = load('src/helix/contracts/canonical-json');
const { createSqliteUnitOfWork } = load('src/helix/foundation/persistence/sqlite-unit-of-work');
const { createCatalogPlanProofReader } = load('src/helix/foundation/execution/catalog-plan-proof-reader');
const { createFrozenCatalogHistory } = load('src/helix/foundation/execution/frozen-catalog-history');
const { createWorkResultReader } = load('src/helix/foundation/execution/work-result-reader');
const { createProductDeliveryReader } = load('src/helix/domains/libra/persistence/product-delivery-reader');
const { createTerminalEffectHistoryObserver } = load('src/helix/domains/arca/application/terminal-effect-history-observer');
const { createReadonlyProofProjectionRegistry } = require('./readonly-history-projections');
const SETTLEMENT = 'arca.ondeck.input_settlement.delete@1';

// UAT-261 defines a derived proof, not a Journal state transition. The Operator
// reuses exactly the Host's frozen catalog and Owner proof in its source snapshot.
// Nothing in this adapter can issue an executor, projection, file IO or SQL write.
function proveReleaseEffectHistory(database, schemaManifest) {
  if (!database.inTransaction) throw new Error('Release history proof requires the source read snapshot.');
  const rows = database.prepare(`SELECT * FROM fx_effect_journal
    WHERE state IS NULL OR state NOT IN ('committed','failed') ORDER BY effect_id LIMIT 101`).all();
  if (!rows.length) return { provenEffectIds:[], observations:[], proofDigest:canonicalDigest([]) };
  if (rows.length > 100) return { provenEffectIds:[], observations:[], reasonCode:'history_scope_bound_exceeded' };
  const kernel = { runPrimitive(operation) {
    return operation({ commitTimeMs:0, prepare(sql) {
      if (!/^SELECT\b/i.test(sql)) throw new Error('Release history proof cannot write.');
      return database.prepare(sql);
    } });
  } };
  const options = { schemaManifest, unitOfWork:createSqliteUnitOfWork({ kernel }) };
  options.workResultReader = createWorkResultReader(options);
  options.productDeliveryPort = createProductDeliveryReader(options);
  const proofReader = createCatalogPlanProofReader(options);
  options.readTechnicalWork = workId => proofReader.verify(reader => reader.workPlanIds(workId).map(id => reader.read(id)));
  const owner = createTerminalEffectHistoryObserver(options), observed = new Map();
  const history = createFrozenCatalogHistory({
    archive:load('src/helix/composition/catalog-transitions/movie-terminal-contracts-20260930.json'),
    archiveDigest:'369f45ccf6fab87332162e90685a5cb87ceda248edfad0973df24c64fa8a0f8e',
    priorArchive:load('src/helix/composition/catalog-transitions/secondary-acceptance-history-20260928.json'),
    priorArchiveDigest:'1914bf6e798867be56b85bb541be0957cdc89cd0e173a48545d459f78dcca2b6',
    witness:load('src/helix/composition/catalog-transitions/intake-control-20260912.json'),
    additionalArchives:[{ archive:load('src/helix/composition/catalog-transitions/published-terminal-contracts-20261015.json'),
      archiveDigest:'4547689c5e393cd4b3256ca98d55f45e8e18129db240308d2406217d828ece0d' },
      { archive:load('src/helix/composition/catalog-transitions/published-terminal-contracts-20261018.json'),
        archiveDigest:'02c61b170e4209eb07f6abb1172eece6e598ed06ab9ad9fa227a5fea32803a6c' }],
    bindingProjectionRegistry:createReadonlyProofProjectionRegistry(load).registry,
    proofReader,
    terminalEffectObserver:{ observe(facts) {
      // Stage history requires a separate physical observation. It is never an
      // exemption in this offline, settlement-only release qualification.
      if (facts.events.some(event => event.capability_ref === 'arca.inventory.product.stage@1' && event.state === 'failed'))
        throw new Error('Release qualification cannot observe a historical stage slot.');
      const values = owner.observe(facts);
      if (values.some(value => value.schemaRef !== 'arca.terminal-effect-history-proof@1' || value.disposition !== 'fulfilled_by_successor'))
        throw new Error('Unsupported release responsibility proof.');
      for (const value of values) observed.set(value.effectId, value);
      return values;
    } },
  });
  const provenEffectIds = [], observations = [], verifiedPlans = new Map();
  for (const row of rows) {
    if (row.state !== 'reconcile_required' || row.effect_class !== 'destructive_commit') continue;
    const event = database.prepare(`SELECT e.plan_id,e.capability_ref FROM fx_event_attempts a
      JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE a.event_attempt_id=?`).get(row.event_attempt_id);
    if (!event || event.capability_ref !== SETTLEMENT) continue;
    let verified = verifiedPlans.get(event.plan_id);
    if (verified === undefined) {
      const facts = proofReader.verify(reader => reader.read(event.plan_id));
      verified = !!facts && history.supports(facts.plan.catalog_digest) && history.verify(facts);
      verifiedPlans.set(event.plan_id, verified);
    }
    const observation = observed.get(row.effect_id);
    if (!verified || !observation) continue;
    provenEffectIds.push(row.effect_id);
    observations.push({ journalDigest:canonicalDigest(row), ...observation });
  }
  return { provenEffectIds, observations, proofDigest:canonicalDigest(observations) };
}

module.exports = { proveReleaseEffectHistory };
