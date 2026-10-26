// The one place updates come from: Sagax's own GitHub releases
// (pulsatrixtechnologies/sagax, tags pulsa-vX.Y.Z). The feed is pinned in
// code with setFeedURL, so an app-update.yml or dev-app-update.yml pointing
// anywhere else is never read. Channel stays "latest"; pre-releases are an
// opt-in kept in this computer's userData (update-preferences.json).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const UPDATE_FEED = Object.freeze({
  provider: "github",
  owner: "pulsatrixtechnologies",
  repo: "sagax",
});

const RELEASES_PREFIX = `https://github.com/${UPDATE_FEED.owner}/${UPDATE_FEED.repo}/releases`;
// The repository was renamed from pulsa-bot to sagax; GitHub redirects the old
// path, which apps up to 0.4.0 still request.
const LEGACY_RELEASES_PREFIX = `https://github.com/${UPDATE_FEED.owner}/pulsa-bot/releases`;
// Release assets redirect from github.com to GitHub's object storage.
const ASSET_HOSTS = new Set(["objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

/** True for a URL the updater may fetch: our releases or their asset storage. */
export function isOurReleaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (ASSET_HOSTS.has(parsed.hostname)) return true;
  const plain = `${parsed.origin}${parsed.pathname}`;
  return [RELEASES_PREFIX, LEGACY_RELEASES_PREFIX].some((prefix) => plain === prefix || plain.startsWith(`${prefix}/`) || plain === `${prefix}.atom`);
}

const PREFS_FILE = "update-preferences.json";

export function readUpdatePrefs(directory) {
  try {
    const parsed = JSON.parse(readFileSync(join(directory, PREFS_FILE), "utf8"));
    return { allowPrerelease: parsed?.allowPrerelease === true, autoInstallWhenAway: parsed?.autoInstallWhenAway === true };
  } catch {
    return { allowPrerelease: false, autoInstallWhenAway: false };
  }
}

/** The named update channel: Stable, or Nightly (pre-releases). */
export function updateChannel(prefs) {
  return prefs?.allowPrerelease === true ? "nightly" : "stable";
}

export function writeUpdatePrefs(directory, prefs) {
  const next = { allowPrerelease: prefs?.allowPrerelease === true, autoInstallWhenAway: prefs?.autoInstallWhenAway === true };
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, PREFS_FILE), `${JSON.stringify(next)}\n`, { mode: 0o600 });
  return next;
}

/** Pin the updater to our releases. Never downgrades; pre-releases only when
 * the person opted in. */
export function configureUpdateFeed(updater, { allowPrerelease = false } = {}) {
  updater.setFeedURL({ ...UPDATE_FEED });
  updater.allowPrerelease = allowPrerelease === true;
  updater.allowDowngrade = false;
  return updater;
}

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RELEASE_NOTES_MAX = 64 * 1024;

/** GitHub's public API URL for the release of `version` (tag pulsa-vX.Y.Z)
 * in our repository, or null for anything that is not a version. */
export function releaseApiUrl(version) {
  const value = typeof version === "string" ? version.trim() : "";
  if (!RELEASE_VERSION.test(value)) return null;
  return `https://api.github.com/repos/${UPDATE_FEED.owner}/${UPDATE_FEED.repo}/releases/tags/pulsa-v${value}`;
}

/**
 * The markdown body of our GitHub release for `version`, read from the
 * public API (no token). The update feed should carry the notes itself
 * (latest*.yml releaseNotes, written at release time); this is the fallback
 * when it does not, so the person always sees what the update brings.
 * Resolves null on any failure: notes never block or fail an update.
 */
export async function fetchReleaseNotes(version, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const url = releaseApiUrl(version);
  if (!url || typeof fetchImpl !== "function") return null;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) return null;
    const release = await response.json();
    if (!release || release.draft === true) return null;
    if (release.tag_name !== `pulsa-v${version.trim()}`) return null;
    const body = typeof release.body === "string" ? release.body.trim() : "";
    return body ? body.slice(0, RELEASE_NOTES_MAX) : null;
  } catch {
    return null;
  }
}
