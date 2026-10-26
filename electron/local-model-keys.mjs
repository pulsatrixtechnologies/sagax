// Per-loopback-server API keys for the models that run on this person's own
// computer (Settings > Computer > Local models). Some local servers answer
// anonymously (Ollama, LM Studio); others (oMLX/Ornith at 127.0.0.1:8000)
// require an API key and refuse the anonymous "local" bearer with 401.
//
// The key the person types here NEVER leaves this computer:
//   - it is kept encrypted by the OS (safeStorage) in the app's data,
//     exactly like the proxy passwords (electron/proxy-credentials.mjs);
//   - it is NEVER sent to the organization server, NEVER written to the
//     publish/probe payload, NEVER logged, NEVER put in a model prompt;
//   - it is only ever read back by the desktop bridge, on this computer, to
//     set the Authorization header of a request to 127.0.0.1.
//
// The store is keyed by the normalized loopback base URL, so an endpoint that
// is re-added (and gets a fresh id) keeps its key, and a key never depends on
// an id that could collide.
import { normalizeLoopbackBase } from "./local-models.mjs";

const MAX_KEY_LENGTH = 4096;

/** A key safe to carry in an HTTP Authorization header: a non-empty string,
 * bounded, with no control characters (newlines would be header injection). */
export function normalizeApiKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  // oxlint-disable-next-line no-control-regex -- reject control characters, header injection
  if (/[\u0000-\u001f\u007f]/.test(key)) return null;
  return key;
}

/** A small encrypted file of { "<normalized base>": "<api key>" }. Without OS
 * encryption the keys are held in memory for this launch only, never written
 * in the clear. Mirrors createProxyCredentialStore. */
export function createLocalModelKeyStore({ file, encryption, fs, log = () => {} }) {
  let entries = null;
  const load = async () => {
    if (entries) return entries;
    entries = {};
    try {
      if (!fs.existsSync(file) || !(await encryption.available())) return entries;
      // safeStorage.decryptStringAsync answers { result } in recent Electron.
      const decrypted = await encryption.decrypt(fs.readFileSync(file));
      const parsed = JSON.parse(typeof decrypted === "string" ? decrypted : decrypted?.result);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [base, key] of Object.entries(parsed)) {
          const normalized = normalizeLoopbackBase(base);
          const safe = normalizeApiKey(key);
          if (normalized && safe) entries[normalized] = safe;
        }
      }
    } catch (error) { log(`local model keys unreadable: ${error?.message ?? error}`); }
    return entries;
  };
  const save = async () => {
    try {
      if (!(await encryption.available())) return;
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, await encryption.encrypt(JSON.stringify(entries)), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) { log(`local model keys not saved: ${error?.message ?? error}`); }
  };
  return {
    /** The key for one loopback base, for the bridge on this computer only. */
    async get(base) {
      const normalized = normalizeLoopbackBase(base);
      if (!normalized) return null;
      return (await load())[normalized] ?? null;
    },
    /** True once the key is kept. A base that is not a loopback /v1 URL, or an
     * empty/invalid key, is refused. */
    async set(base, key) {
      const normalized = normalizeLoopbackBase(base);
      const safe = normalizeApiKey(key);
      if (!normalized || !safe) return false;
      (await load())[normalized] = safe;
      await save();
      return true;
    },
    async clear(base) {
      const normalized = normalizeLoopbackBase(base);
      if (!normalized) return;
      const all = await load();
      if (normalized in all) { delete all[normalized]; await save(); }
    },
    async has(base) {
      const normalized = normalizeLoopbackBase(base);
      if (!normalized) return false;
      return Boolean((await load())[normalized]);
    },
    /** The loopback bases that have a key, for the Settings panel. The key
     * values are NEVER returned over this boundary. */
    async bases() {
      return Object.keys(await load());
    },
  };
}
