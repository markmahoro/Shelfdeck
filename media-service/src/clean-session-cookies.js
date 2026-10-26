'use strict';

const SESSION_COOKIE = 'shelfdeck_admin_session';
function cookieValue(header, name = SESSION_COOKIE) {
  for (const item of String(header || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return undefined;
}
function sessionCookie(token) {
  return SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800';
}
function clearSessionCookie() { return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'; }
module.exports = Object.freeze({ SESSION_COOKIE, cookieValue, sessionCookie, clearSessionCookie });
