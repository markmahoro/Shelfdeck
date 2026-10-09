'use strict';

function boundSeriesNfoProvenance(schema) {
  return { ...schema, allOf: [{
    if: { required: ['acceptanceRequirementSnapshot'], properties: {
      acceptanceRequirementSnapshot: { required: ['contentProfile'], properties: { contentProfile: { const: 'series' } } }
    } },
    then: { properties: { sourceNfoObservations: { maxItems: 1024 } } },
    else: { properties: { sourceNfoObservations: { maxItems: 16 } } }
  }] };
}

module.exports = { boundSeriesNfoProvenance };
