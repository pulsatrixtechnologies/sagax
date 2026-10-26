// The published npm package. The unscoped names are not this project's: one
// is the upstream author's package, the other an unrelated one, so nothing
// here ever installs or suggests an unscoped name, and nothing installs a
// floating tag such as `latest`: an install names an exact version.
// scripts/build-npm-package.mjs writes the same name (npm-package.test.ts).

export const NPM_PACKAGE = "@pulsatrixtechnologies/sagax";
/** The command the package installs. */
export const NPM_BIN = "sagax";

// SemVer 2.0.0 as npm reads it, without build metadata: a numeric
// prerelease identifier has no leading zero ("1.2.3-01" is refused, as npm
// refuses it), an alphanumeric one may ("1.2.3-0a").
const PRERELEASE_ID = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT_VERSION = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*)?$`);

/** An exact release (X.Y.Z or X.Y.Z-pre.N), never a range, tag, URL or path. */
export function assertPinnedVersion(version: string): string {
  const value = version.trim();
  if (!EXACT_VERSION.test(value)) throw new Error(`"${version}" is not an exact release version (X.Y.Z); ${NPM_PACKAGE} is only installed at a pinned version`);
  return value;
}

/** `@pulsatrixtechnologies/sagax@X.Y.Z`, the only install spec this project produces. */
export function pinnedInstallSpec(version: string): string {
  return `${NPM_PACKAGE}@${assertPinnedVersion(version)}`;
}

/** Where a global install of the package puts its entry, given any entry
 * that already lives in that global node_modules (a scoped or an unscoped
 * package). Null for a checkout or anything else outside node_modules. */
export function globalPackageEntry(script: string): string | null {
  const normalized = script.replace(/\\/g, "/");
  const match = /^(.*\/node_modules)\/(?:@[^/]+\/)?[^/@][^/]*\/cli\.js$/.exec(normalized);
  return match ? `${match[1]}/${NPM_PACKAGE}/cli.js` : null;
}
