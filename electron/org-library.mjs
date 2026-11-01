import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { parseOrgLibraryCatalog as parseSharedOrgLibraryCatalog } from "../shared/org-library-catalog.ts";

// The organization library channel in Electron main (contract 60 §5). Admin
// advertises capabilities.library; the session carries a small pointer; the
// catalog and each release's bytes come from fixed routes with their own caps.
// Main verifies, caches and relays them. The local runtime (server/org-library.ts)
// installs, and reports back what it holds. Nothing here asks anyone anything:
// what an organization offers is decided in Admin, adding it is a person's click.

export const LIBRARY_CATALOG_MAX_BYTES = 256 * 1024;
export const LIBRARY_BLOB_MAX_BYTES = 4 * 1024 * 1024;
export const LIBRARY_REPORT_MAX_BYTES = 64 * 1024;
/** The newest package document version this desktop reads (shared/package-format.ts PACKAGE_VERSION). */
export const LIBRARY_FORMAT_SUPPORTED = 2;
const LIBRARY_ROUTE = /^\/api\/desktop\/library(?:\/blobs\/[a-f0-9]{64}|\/report)?$/;
const CATALOG_MAX_RELEASE_BYTES = 64 * 1024 * 1024, REPORT_MAX_ENTRIES = 100;
const REPORT_DEBOUNCE_MS = 5_000, RETRY_BASE_MS = 50_000, CATALOG_RETRY_MAX_MS = 30 * 60_000, BLOB_RETRY_MAX_MS = 60 * 60_000, RATE_LIMIT_PAUSE_MS = 10 * 60_000;
const DAY = 24 * 60 * 60_000, BLOB_KEEP_MS = 7 * DAY;
const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const APP_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const BLOB_NAME = /^([a-f0-9]{64})\.json$/, OWNED_BLOB_FILE = /^[a-f0-9]{64}\.json(?:\.[0-9a-f-]{36}\.tmp)?$/;
const STATES = new Set(["installed", "failed", "removed", "withdrawn"]);
const REASONS = new Set(["blob_unavailable", "invalid_package", "import_failed", "newer_app_required", "connection_refused_by_policy", "removed_locally", "withdrawn_by_publisher"]);
export const LIBRARY_STATE_MESSAGE = "openmausbot:managed-library-state";

const matches = (pattern, value) => typeof value === "string" && pattern.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const record = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const sha256Hex = bytes => createHash("sha256").update(bytes).digest("hex");

/** capabilities.library from GET /api/public/config: an Admin without it never sees a library request. */
export function libraryCapability(config) {
  const value = config?.capabilities?.library;
  return Number.isSafeInteger(value) && value >= 1;
}
/** The session's { version, digest } pointer, or null when missing or malformed (then ignored). */
export function parseLibraryPointer(value) {
  return record(value) && count(value.version) && matches(HEX64, value.digest) ? { version: value.version, digest: value.digest } : null;
}
/** The fixed library routes and their own caps. None of them uses the session's 512 KiB request(). */
export function libraryRouteLimits(route) {
  if (!matches(LIBRARY_ROUTE, route)) return null;
  if (route === "/api/desktop/library") return { method: "GET", maxBytes: LIBRARY_CATALOG_MAX_BYTES, timeoutMs: 20_000 };
  if (route === "/api/desktop/library/report") return { method: "POST", maxBytes: 16 * 1024, timeoutMs: 20_000, bodyMaxBytes: LIBRARY_REPORT_MAX_BYTES };
  return { method: "GET", maxBytes: LIBRARY_BLOB_MAX_BYTES, timeoutMs: 60_000 };
}

/** GET /api/desktop/library (contract §5.3). shared/org-library-catalog.ts. */
export function parseOrgLibraryCatalog(input, options = {}) {
  return parseSharedOrgLibraryCatalog(input, options);
}
/** Install report entries (contract §5.5), each parsed on its own like Admin's: a bad one is dropped. */
export function parseLibraryReportEntries(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set(), entries = [];
  for (const item of value) {
    if (entries.length === REPORT_MAX_ENTRIES) break;
    if (!record(item) || !matches(UUID, item.packageId) || seen.has(item.packageId) || !matches(SEMVER, item.release) || !matches(HEX64, item.sha256) || !STATES.has(item.state) ||
        (item.edited !== undefined && typeof item.edited !== "boolean") || (item.reason !== undefined && !REASONS.has(item.reason))) continue;
    seen.add(item.packageId);
    entries.push({ packageId: item.packageId, release: item.release, sha256: item.sha256, state: item.state,
      ...(item.edited === undefined ? {} : { edited: item.edited }), ...(item.reason === undefined ? {} : { reason: item.reason }) });
  }
  return entries;
}
/** The runtime's unsolicited { type, digest, packages } snapshot. undefined = another message type; null = ours but unusable. */
export function parseLibraryStateMessage(raw) {
  const message = raw?.data ?? raw;
  if (message?.type !== LIBRARY_STATE_MESSAGE) return undefined;
  const packages = parseLibraryReportEntries(message.packages);
  return matches(HEX64, message.digest) && packages ? { digest: message.digest, packages } : null;
}

const identityKey = identity => identity ? JSON.stringify([identity.portalOrigin, identity.organizationId, identity.deviceId]) : null;
async function readOwnedFile(file, maxBytes) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Unexpected organization library file.");
    return await handle.readFile();
  } finally { await handle.close(); }
}
/** Temporary file, fsync, rename: a reader sees the old bytes or the new ones. Owner-only. */
async function writeAtomic(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

/**
 * Electron main's half of the library (contract §5.6). `fetchBytes` is the
 * managed-desktop client's fetchLibraryBytes (fixed routes, the device token,
 * its caps); `relay` posts { type: "openmausbot:managed-library", library } to
 * the local runtime and resolves on its ack; `store` is a separate OS-encrypted
 * record (company-library.bin). `dataDir` is <data dir>/org-library, where the
 * runtime keeps its own state.json and presets.json: main owns catalog.json
 * and blobs/ there, nothing else.
 */
export function createOrgLibrary({ dataDir, store, fetchBytes, relay, appVersion, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  const catalogFile = path.join(dataDir, "catalog.json"), blobsDir = path.join(dataDir, "blobs");
  const blobFile = sha => path.join(blobsDir, `${sha}.json`);
  const reportVersion = typeof appVersion === "string" && APP_VERSION.test(appVersion) ? appVersion : undefined;
  let closed = false, epoch = 0;
  // `applied` is the verified catalog for `owner` (fetched, or restored from
  // disk); `relayed` is the digest the current runtime acknowledged.
  // `relayWarned` names the runtime and catalog a refused relay was last logged for.
  let owner = null, applied = null, relayed = null, capable = null, generation, runtimeEpoch = 0, relayWarned = null;
  const versions = new Map(), blobRetry = new Map();
  let blobsPausedUntil = 0, catalogRetry = null, prunedAt = 0;
  // Reports: only the newest snapshot is sent, 5 s after it arrives.
  let latest = null, reportTimer = null, reporting = null, reportAgain = false, startReportDue = true, reportRetryDue = false;

  // One job at a time, in order. A queued job is replaced by a newer one of
  // its kind; a clear never is, and its deletes run after any write already in
  // progress. Each job carries the epoch it was asked in: a sign-out in between voids it.
  const queue = [];
  let draining = null;
  const enqueue = (kind, job) => {
    if (closed) return Promise.resolve();
    if (kind !== "clear") for (let index = queue.length - 1; index >= 0; index--) if (queue[index].kind === kind) queue.splice(index, 1);
    queue.push({ kind, job });
    draining ??= (async () => {
      while (queue.length) {
        const next = queue.shift();
        try { await next.job(); } catch (error) { log(`organization library: ${error?.message ?? error}`); }
      }
      draining = null;
    })();
    return draining;
  };

  const forgetOwner = () => {
    owner = null; applied = null; versions.clear(); blobRetry.clear(); catalogRetry = null; blobsPausedUntil = 0;
    latest = null; startReportDue = true; reportRetryDue = false;
    if (reportTimer) clearTimer(reportTimer); reportTimer = null;
  };
  const adopt = (identity, next) => {
    if (owner && identityKey(owner) !== identityKey(identity)) forgetOwner();
    owner = { portalOrigin: identity.portalOrigin, organizationId: identity.organizationId, deviceId: identity.deviceId };
    applied = next;
  };
  /** Hands the runtime the applied catalog unless it already has it. A refusal or a runtime that is not up yet is retried on the next check or restart. */
  async function deliver(stamp) {
    if (!applied || !owner || relayed === applied.digest || stamp !== epoch) return;
    const { digest, libraryVersion, catalog } = applied, runtime = runtimeEpoch;
    versions.set(digest, libraryVersion);
    while (versions.size > 8) versions.delete(versions.keys().next().value);
    try {
      await relay({ adminOrigin: owner.portalOrigin, organizationId: owner.organizationId, organizationName: catalog.organization.name, digest, catalog: structuredClone(catalog) });
    } catch {
      // Said once per runtime and catalog, not on every sync: a runtime without the handler never acknowledges.
      if (relayWarned !== `${runtime}:${digest}`) { relayWarned = `${runtime}:${digest}`; log("organization library: the local runtime did not take the catalog; it will be sent again"); }
      return;
    }
    if (stamp === epoch && runtime === runtimeEpoch && applied?.digest === digest) relayed = digest;
  }

  const catalogDue = digest => !catalogRetry || catalogRetry.digest !== digest || now() >= catalogRetry.at;
  const catalogFailed = digest => {
    const failures = catalogRetry?.digest === digest ? catalogRetry.failures + 1 : 1;
    catalogRetry = { digest, failures, at: now() + Math.min(RETRY_BASE_MS * 2 ** (failures - 1), CATALOG_RETRY_MAX_MS) };
  };
  /** A cached blob counts when it is a regular file of the catalog's size; after a new catalog it is also re-hashed. */
  async function blobPresent(release, verify) {
    try {
      const stat = await fs.lstat(blobFile(release.sha256));
      if (!stat.isFile() || stat.size !== release.sizeBytes) throw new Error("stale");
      if (verify && sha256Hex(await readOwnedFile(blobFile(release.sha256), LIBRARY_BLOB_MAX_BYTES)) !== release.sha256) throw new Error("stale");
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") await fs.rm(blobFile(release.sha256), { force: true }).catch(() => {});
      return false;
    }
  }
  /** Every entry that is not Off, has a release and a format this app reads,
   * up to 64 MiB in catalog order. One download at a time; a failure leaves
   * that entry unavailable and is retried later with a growing delay. */
  async function fetchBlobs(catalog, stamp, mine, verify) {
    let total = 0;
    for (const { mode, release } of catalog.packages) {
      if (mode === "off" || !release || release.formatVersion > LIBRARY_FORMAT_SUPPORTED || total + release.sizeBytes > CATALOG_MAX_RELEASE_BYTES) continue;
      total += release.sizeBytes;
      if (mine !== epoch) return;
      if (await blobPresent(release, verify)) { blobRetry.delete(release.sha256); continue; }
      const retry = blobRetry.get(release.sha256);
      if (retry && retry.at > now()) continue;
      if (blobsPausedUntil > now() || mine !== epoch) return;
      try {
        const bytes = await fetchBytes(`/api/desktop/library/blobs/${release.sha256}`, release.sizeBytes, { generation: stamp });
        // Never written, never used: bytes that are not exactly the catalog's release.
        if (sha256Hex(bytes) !== release.sha256) throw new Error("A package download did not match its catalog entry.");
        if (mine !== epoch) return;
        await writeAtomic(blobFile(release.sha256), bytes);
        blobRetry.delete(release.sha256);
      } catch (error) {
        if (mine !== epoch) return;
        if (error?.status === 429) { blobsPausedUntil = now() + (Number.isFinite(error.retryAfter) ? Math.min(error.retryAfter * 1000, BLOB_RETRY_MAX_MS) : RATE_LIMIT_PAUSE_MS); return; }
        const failures = (retry?.failures ?? 0) + 1;
        blobRetry.set(release.sha256, { failures, at: now() + Math.min(RETRY_BASE_MS * 2 ** (failures - 1), BLOB_RETRY_MAX_MS) });
        log(`organization library: a package download failed${error?.status ? ` (${error.status})` : ""}; it stays unavailable until a later retry`);
      }
    }
  }
  /** Blobs the catalog no longer names go 7 days after it stopped naming them:
   * named ones are touched here, so their mtime is when they were last named. */
  async function prune(catalog) {
    prunedAt = now();
    const keep = new Set(catalog.packages.flatMap(entry => entry.release ? [entry.release.sha256] : [])), touched = new Date(now());
    let names;
    try { names = await fs.readdir(blobsDir); } catch { return; }
    for (const name of names) {
      if (!OWNED_BLOB_FILE.test(name)) continue;
      const file = path.join(blobsDir, name), sha = BLOB_NAME.exec(name)?.[1];
      let stat;
      try { stat = await fs.lstat(file); } catch { continue; }
      if (!stat.isFile()) continue;
      if (sha && keep.has(sha)) await fs.utimes(file, touched, touched).catch(() => {});
      else if (now() - stat.mtimeMs >= (sha ? BLOB_KEEP_MS : DAY)) await fs.rm(file, { force: true }).catch(() => {});
    }
  }
  async function removeBlobs() {
    let names;
    try { names = await fs.readdir(blobsDir); } catch { return; }
    for (const name of names) if (OWNED_BLOB_FILE.test(name)) await fs.rm(path.join(blobsDir, name), { force: true }).catch(() => {});
  }

  /** After a successful session sync with the capability: fetch the catalog when
   * the pointer moved, the blobs it is missing, persist, relay. */
  async function refresh(identity, pointer, stamp, mine) {
    if (mine !== epoch) return;
    if (owner && identityKey(owner) !== identityKey(identity)) {
      // A catalog from another enrollment never lingers in the runtime.
      const stale = relayed !== null;
      forgetOwner(); relayed = null;
      if (stale) await relay(null).catch(() => {});
      if (mine !== epoch) return;
    }
    if (pointer && pointer.digest !== applied?.digest && catalogDue(pointer.digest)) {
      let bytes = null;
      try { bytes = await fetchBytes("/api/desktop/library", LIBRARY_CATALOG_MAX_BYTES, { generation: stamp }); }
      catch (error) { if (mine === epoch) { catalogFailed(pointer.digest); log(`organization library: the catalog could not be fetched${error?.status ? ` (${error.status})` : ""}; keeping the last one`); } }
      if (mine !== epoch) return;
      const catalog = bytes && parseOrgLibraryCatalog(bytes, { organizationId: identity.organizationId });
      if (bytes && !catalog) { catalogFailed(pointer.digest); log("organization library: the catalog was not usable; keeping the last one"); }
      if (catalog) {
        // The digest of the bytes actually applied, not the pointer's: a
        // rebuild that raced this fetch converges on the next check.
        const digest = sha256Hex(bytes);
        if (digest === pointer.digest) catalogRetry = null; else catalogFailed(pointer.digest);
        if (digest !== applied?.digest) {
          await fetchBlobs(catalog, stamp, mine, true);
          if (mine !== epoch) return;
          try { await writeAtomic(catalogFile, bytes); } catch { log("organization library: the catalog could not be saved; it will be fetched again after a restart"); }
          if (mine !== epoch) return;
          try { await store.write({ portalOrigin: identity.portalOrigin, organizationId: identity.organizationId, deviceId: identity.deviceId, libraryVersion: catalog.libraryVersion, digest }); }
          catch { log("organization library: the catalog record could not be saved; it will be fetched again after a restart"); }
          if (mine !== epoch) return;
          adopt(identity, { digest, libraryVersion: catalog.libraryVersion, catalog });
          await deliver(mine);
          if (mine === epoch) await prune(catalog);
          return;
        }
      }
    }
    if (!applied || mine !== epoch) return;
    await fetchBlobs(applied.catalog, stamp, mine, false);
    await deliver(mine);
    if (mine === epoch && now() - prunedAt >= DAY) await prune(applied.catalog);
  }

  async function restore(identity, mine, posted) {
    let saved;
    try { saved = await store.read(); } catch { return; }
    if (mine !== epoch || !record(saved) || saved.portalOrigin !== identity.portalOrigin || saved.organizationId !== identity.organizationId ||
        saved.deviceId !== identity.deviceId || !(identity.expiresAt > now()) || !matches(HEX64, saved.digest)) return;
    let bytes;
    try { bytes = await readOwnedFile(catalogFile, LIBRARY_CATALOG_MAX_BYTES); } catch { return; }
    // A catalog.json that is not exactly the recorded bytes is ignored; the first sync fetches again.
    if (sha256Hex(bytes) !== saved.digest) { log("organization library: the saved catalog did not match its record; ignoring it"); return; }
    const catalog = parseOrgLibraryCatalog(bytes, { organizationId: identity.organizationId });
    if (!catalog || mine !== epoch || applied) return;
    adopt(identity, { digest: saved.digest, libraryVersion: catalog.libraryVersion, catalog });
    // Posted synchronously by deliver(); the start waits for that, never for the runtime's ack.
    const delivery = deliver(mine);
    posted();
    await delivery;
  }

  const scheduleReport = () => {
    if (reportTimer || closed) return;
    reportTimer = setTimer(() => { reportTimer = null; void postReport(); }, REPORT_DEBOUNCE_MS);
    reportTimer?.unref?.();
  };
  async function postReport() {
    if (reporting) { reportAgain = true; return reporting; }
    const snapshot = latest;
    if (closed || !snapshot || capable !== true || generation === undefined || snapshot.key !== identityKey(owner)) return;
    const operation = (async () => {
      try {
        await fetchBytes("/api/desktop/library/report", 16 * 1024, { generation, body: { libraryVersion: snapshot.libraryVersion, digest: snapshot.digest,
          ...(reportVersion ? { appVersion: reportVersion } : {}), packages: snapshot.packages } });
        startReportDue = false; reportRetryDue = false;
      } catch { reportRetryDue = true; }
    })();
    reporting = operation;
    try { await operation; } finally { reporting = null; }
    if (reportAgain) { reportAgain = false; if (latest !== snapshot || reportRetryDue) scheduleReport(); }
  }

  /** Sign-out, expiry or revocation: the runtime hides the shelf, and this
   * desktop forgets the catalog and its cached release bytes. Installed copies stay. */
  function clear() {
    if (closed) return Promise.resolve();
    epoch++;
    const told = relayed !== null || applied !== null;
    forgetOwner(); relayed = null; capable = null;
    return enqueue("clear", async () => {
      const results = await Promise.allSettled([told ? relay(null) : undefined, store.write(null), fs.rm(catalogFile, { force: true }), removeBlobs()]);
      if (results.some(result => result.status === "rejected")) log("organization library: some of the saved library could not be removed");
    });
  }

  return {
    /** At start, before any network call: the saved catalog for this exact
     * enrollment, if its bytes still match the encrypted record. Resolves once
     * it is handed to the runtime (or found unusable), not on the runtime's ack. */
    restore(identity) {
      const mine = epoch;
      return new Promise(resolve => { void enqueue("restore", () => restore(identity, mine, resolve).finally(resolve)).finally(resolve); });
    },
    /** Every successful session sync. capable: true, false (this Admin has no
     * library) or null (not known yet: keep what the runtime has). */
    synchronized({ identity, capable: isCapable, pointer, generation: stamp }) {
      if (closed) return Promise.resolve();
      generation = stamp;
      if (isCapable === false) {
        const cleared = applied ? clear() : Promise.resolve();
        capable = false;
        return cleared;
      }
      const mine = epoch;
      if (isCapable !== true) return enqueue("relay", () => deliver(mine));
      capable = true;
      const id = { portalOrigin: identity.portalOrigin, organizationId: identity.organizationId, deviceId: identity.deviceId };
      // Once per app start, and until a failed report gets through.
      if ((startReportDue || reportRetryDue) && latest?.key === identityKey(id)) scheduleReport();
      return enqueue("sync", () => refresh(id, parseLibraryPointer(pointer), stamp, mine));
    },
    clear,
    /** A (re)started runtime has no catalog: send the applied one again. */
    runtimeReady() {
      relayed = null; runtimeEpoch++;
      const mine = epoch;
      return enqueue("relay", () => deliver(mine));
    },
    /** The runtime's unsolicited install snapshot. True when the message was this channel's. */
    receive(raw) {
      const parsed = parseLibraryStateMessage(raw);
      if (parsed === undefined) return false;
      if (!parsed || closed || !owner) return true;
      // Only a catalog this main relayed for this enrollment: a snapshot from a stale one never reaches another organization.
      const libraryVersion = versions.get(parsed.digest);
      if (libraryVersion === undefined) return true;
      latest = { key: identityKey(owner), digest: parsed.digest, libraryVersion, packages: parsed.packages };
      scheduleReport();
      return true;
    },
    /** Tests: resolves once queued work and a report in flight have finished. */
    async idle() { while (draining || reporting) await (draining ?? reporting); },
    close() { closed = true; epoch++; queue.length = 0; if (reportTimer) clearTimer(reportTimer); reportTimer = null; },
  };
}
