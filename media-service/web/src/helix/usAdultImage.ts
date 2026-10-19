import {helixAdminApi,type PeopleProjection} from './api';

type Person=PeopleProjection['items'][number];
export const actorImageKey=(person:Person)=>helixAdminApi.personAvatarUrl(person.personId,person.currentReferenceRevision);
export const actorSnapshotKey=(person:Person)=>JSON.stringify([person.personId,person.currentRevision,person.currentReferenceRevision,actorImageKey(person)]);
