'use strict';

const SETTLEMENT_EXPECTATIONS = new Set(['replace_or_move', 'remove_after_place']);

function requiresInputSettlement(member) {
  return Boolean(member) && SETTLEMENT_EXPECTATIONS.has(member.settlementExpectation);
}

module.exports = Object.freeze({ requiresInputSettlement });
