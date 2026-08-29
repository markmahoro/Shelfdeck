'use strict';

// Arca Target Commit Slot directory names. Hidden form is the current
// published containment; the legacy sibling form remains readable so an
// in-flight On-deck Run can finish after the naming change.
const SLOT_NAME = /(?:^|\.)shelfdeck-stage-[0-9a-f]{16}$/;

function isArcaTargetCommitSlotName(name) {
  return SLOT_NAME.test(String(name || ''));
}

module.exports = Object.freeze({
  isArcaTargetCommitSlotName,
});
