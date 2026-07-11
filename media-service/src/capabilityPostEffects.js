'use strict';

const workflowStore = require('./workflowStore');
const kairoxStore = require('./kairoxStore');
const kairoxSignalBus = require('./kairoxSignalBus');

function apply({ capability, task, event, output }) {
  const type = capability.outputContract && capability.outputContract.type;
  if (type === 'MediaReplacementEvidence') {
    kairoxStore.markBasedataStale({ subjectId: task.subjectId, reason: 'post_optimize_replace', taskId: task.id });
    return { kind: 'basedata_invalidated', reason: 'post_optimize_replace' };
  }
  if (type === 'SourceMutationEffect') {
    const mutation = output && output.sourceMutationResult;
    if (!mutation || !mutation.mutationId) throw Object.assign(new Error('Source mutation capability returned no durable mutation identity'), { code: 'SOURCE_MUTATION_RESULT_MISSING' });
    workflowStore.recordMutation(mutation);
    kairoxStore.markBasedataStale({ subjectId: task.subjectId, reason: 'source_mutation_pending_rebind', taskId: task.id });
    kairoxSignalBus.publish({ kind: 'source_mutation', subjectId: task.subjectId, mutationId: mutation.mutationId });
    return { kind: 'source_mutation_recorded', mutationId: mutation.mutationId };
  }
  return null;
}

module.exports = { apply };
