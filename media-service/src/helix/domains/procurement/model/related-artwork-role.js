'use strict';

// Association and directory ownership must be checked before assigning a role.
function relatedArtworkRole(baseName, primaryStems) {
  const lower = baseName.toLowerCase();
  const match = lower.match(/^(.*)\.(jpg|jpeg|png|webp)$/);
  if (!match) return null;
  const stem = match[1];
  const roleFor = (name) => name === 'poster' ? 'poster'
    : ['fanart', 'background', 'backdrop'].includes(name) ? 'fanart' : null;
  const genericRole = roleFor(stem);
  if (genericRole) return genericRole;
  for (const primaryStem of primaryStems) {
    const prefix = primaryStem.toLowerCase();
    if (!prefix || !stem.startsWith(prefix) || !['-', '.', '_'].includes(stem[prefix.length])) continue;
    const role = roleFor(stem.slice(prefix.length + 1));
    if (role) return role;
  }
  return null;
}

module.exports = Object.freeze({ relatedArtworkRole });
