"use strict";

// Must equal server/auth/request-auth.ts DESKTOP_OWNER_HEADER. Lowercase on
// purpose: the upstream rebrand rewrites "Sagax", and a name with a
// space (the old "X-Pulsa Bot-Desktop-Owner") is not a valid HTTP header, so
// Chromium dropped it and every guarded desktop change was refused (403).
const DESKTOP_MUTATION_HEADER = "x-openmausbot-desktop-owner";

/** Add the per-launch owner capability to main-process requests. Chromium's
 * webRequest hook cannot see Node fetch, so both paths use this one header
 * contract rather than relying on where a request happened to originate. */
function desktopServerHeaders(headers, { packaged, token }) {
  const next = { ...headers };
  if (!packaged) return next;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("invalid desktop mutation capability");
  }
  next[DESKTOP_MUTATION_HEADER] = token;
  return next;
}

module.exports = { DESKTOP_MUTATION_HEADER, desktopServerHeaders };
