'use strict';

const { bindRepository } = require('./owner-repository');

const BUSINESS_OWNERS = new Set(['procurement', 'libra', 'arca', 'perception', 'people']);
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

class UnitOfWorkBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UnitOfWorkBoundaryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new UnitOfWorkBoundaryError(code, message, details);
}

function validateParticipants(participants) {
  if (!Array.isArray(participants) || participants.length === 0) fail('P3_UOW_EMPTY_PARTICIPANTS', 'Unit of Work requires declared participants.');
  const participantIds = new Set();
  const owners = new Set();
  const boundBusinessOwners = new Set();
  for (const participant of participants) {
    if (!participant || !IDENTIFIER.test(participant.participantId || '') || typeof participant.owner !== 'string' ||
        !Array.isArray(participant.repositories) || participant.repositories.length === 0 || typeof participant.execute !== 'function') {
      fail('P3_UOW_INVALID_PARTICIPANT', 'Participant ID, Owner, repositories, and execute callback are required.');
    }
    if (participantIds.has(participant.participantId)) fail('P3_UOW_DUPLICATE_PARTICIPANT', 'Participant IDs must be unique.', { participantId: participant.participantId });
    participantIds.add(participant.participantId);
    owners.add(participant.owner);
    if (participant.boundBusinessOwner !== undefined) {
      if (!BUSINESS_OWNERS.has(participant.boundBusinessOwner)) fail('P3_UOW_INVALID_BOUND_OWNER', 'Participant bound Business Owner is invalid.');
      boundBusinessOwners.add(participant.boundBusinessOwner);
    }
    const repositoryIds = new Set();
    for (const repository of participant.repositories) {
      if (!repository || repository.owner !== participant.owner) fail('P3_UOW_REPOSITORY_OWNER_MISMATCH', 'Participant cannot obtain another Owner Repository.', {
        participantId: participant.participantId, owner: participant.owner, repositoryOwner: repository && repository.owner
      });
      if (repositoryIds.has(repository.repositoryId)) fail('P3_UOW_DUPLICATE_REPOSITORY', 'Participant Repository IDs must be unique.', {
        participantId: participant.participantId, repositoryId: repository.repositoryId
      });
      repositoryIds.add(repository.repositoryId);
    }
  }
  const businessOwners = [...owners].filter((owner) => BUSINESS_OWNERS.has(owner));
  if (businessOwners.length > 1) fail('P3_UOW_CROSS_DOMAIN_WRITE', 'One transaction cannot hold two Business Domain Repositories.', { businessOwners });
  if (boundBusinessOwners.size > 0 && (businessOwners.length !== 1 || [...boundBusinessOwners].some((owner) => owner !== businessOwners[0]))) {
    fail('P3_UOW_BOUND_OWNER_MISMATCH', 'Foundation participant is not bound to the transaction Business Owner.', {
      businessOwners, boundBusinessOwners: [...boundBusinessOwners]
    });
  }
  if (owners.has('platform-settings') && owners.size > 1) {
    const platformParticipants = participants.filter((participant) => participant.owner === 'platform-settings');
    const platformReadsAreBound = businessOwners.length === 1 && platformParticipants.every((participant) =>
      participant.boundBusinessOwner === businessOwners[0] && participant.repositories.every((repository) => repository.readOnly === true));
    if (!platformReadsAreBound) fail('P3_UOW_PLATFORM_OWNER_MIX',
      'Only read-only Platform repositories bound to the transaction Business Owner may join a Domain unit of work.');
  }
}

function createSqliteUnitOfWork(options) {
  if (!options || !options.kernel || typeof options.kernel.runPrimitive !== 'function') {
    fail('P3_UOW_INVALID_KERNEL', 'A clean SQLite Kernel is required.');
  }
  return Object.freeze({
    execute(participants) {
      validateParticipants(participants);
      return options.kernel.runPrimitive((transaction) => {
        const results = Object.create(null);
        for (const participant of participants) {
          let active = true;
          const repositories = new Map(participant.repositories.map((definition) => [
            definition.repositoryId, bindRepository(definition, transaction, () => active)
          ]));
          const context = Object.freeze({
            owner: participant.owner,
            commitTimeMs: transaction.commitTimeMs,
            repository(repositoryId) {
              if (!active) fail('P3_UOW_CONTEXT_EXPIRED', 'Participant context cannot escape its callback.');
              const repository = repositories.get(repositoryId);
              if (!repository) fail('P3_UOW_UNDECLARED_REPOSITORY', 'Participant requested an undeclared Repository.', {
                participantId: participant.participantId, repositoryId
              });
              return repository;
            }
          });
          try {
            const result = participant.execute(context);
            if (result && typeof result.then === 'function') fail('P3_UOW_ASYNC_PARTICIPANT', 'SQLite participants must complete synchronously.');
            results[participant.participantId] = result;
          } finally {
            active = false;
          }
        }
        return Object.freeze(results);
      });
    }
  });
}

module.exports = Object.freeze({ UnitOfWorkBoundaryError, createSqliteUnitOfWork });
