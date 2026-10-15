'use strict';

// This Owner rule precedes Routing Decision creation. It does not authorize
// execution, admission, or any change to Material Control.
function routingPreparationReadiness(policyAvailable) {
  if (typeof policyAvailable !== 'boolean') throw new TypeError('Routing policy availability must be boolean.');
  return Object.freeze(policyAvailable
    ? { result: 'ready', reasonCode: null }
    : { result: 'unresolved', reasonCode: 'routing_policy_unavailable' });
}

module.exports = Object.freeze({ routingPreparationReadiness });
