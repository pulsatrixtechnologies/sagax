// Reading the OS-encrypted credential store (credentials.bin via safeStorage).
//
// The whole point of this module is one distinction main.mjs used to lose:
//
//   empty        the store was read, and the user has saved nothing
//   ok           the store was read, here is what is in it
//   unavailable  the store could NOT be read — we know nothing
//
// Those first two are facts. The third is ignorance, and it must not be
// spelled the same way as "empty": a caller that cannot tell them apart
// starts the app as though the user had never connected anything, and — far
// worse — registers a fresh installation over the top of the real one.
//
// macOS says "temporarily unavailable. Please try again." for a keychain that
// is merely busy at that instant, which is exactly what happens when the app
// asks a few hundred milliseconds too early. So we try again, briefly, before
// admitting ignorance.
export const CREDENTIAL_READ_DELAYS_MS = [100, 200, 400, 800];

const message = (error) => (error instanceof Error ? error.message : String(error));

export async function readSecureCredentials({
  exists,
  isAvailable,
  readFile,
  decrypt,
  sleep,
  delays = CREDENTIAL_READ_DELAYS_MS,
}) {
  if (!exists()) return { status: "empty", credentials: {} };

  let lastError = "the operating-system credential store is unavailable";
  // delays.length retries AFTER the first attempt
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      if (!(await isAvailable())) {
        lastError = "the operating-system credential store is unavailable";
        continue;
      }
      const decrypted = await decrypt(readFile());
      const text = typeof decrypted === "string" ? decrypted : decrypted?.result;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
        }
        return { status: "ok", credentials: parsed };
      } catch {
        // Corruption is not a timing problem; retrying only delays the
        // report. It is still ignorance, never emptiness.
        return { status: "unavailable", credentials: {}, error: "the credential store is not readable" };
      }
    } catch (error) {
      lastError = message(error);
    }
  }
  return { status: "unavailable", credentials: {}, error: lastError };
}

/** "Reset saved keys" for a store that cannot be read: the file is moved aside (kept, never deleted, so the person can
 * put it back) and the app restarts with an empty store it can write again. The person's click is the decision: no
 * second question. A store that was read is never touched, and nothing moves once the app has begun to quit, since no
 * restart would follow. Only a file that is really gone (ENOENT) counts as moved; any other error is returned. */
export async function resetUnreadableCredentials({ unreadable, quitting, moveAside, log = () => {}, restart }) {
  if (!unreadable) return { status: "readable" };
  if (quitting()) return { status: "quitting" };
  try {
    moveAside();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      log(`saved keys reset failed: ${message(error)}`);
      return { status: "failed", error: message(error) };
    }
  }
  log("saved keys reset by the person: unreadable credential store moved aside, restarting");
  restart();
  return { status: "reset" };
}

/** The page's two calls for this store, this app's own page only. `unreadable` is a function because the launch read
 * finishes after this is installed. */
export function installCredentialStoreIpc({ ipcMain, localOnly, unreadable, quitting, moveAside, log, relaunch }) {
  ipcMain.handle("credential-store:unreadable", localOnly("credential-store:unreadable", () => unreadable() === true));
  ipcMain.handle("credential-store:reset", localOnly("credential-store:reset", () => resetUnreadableCredentials({
    unreadable: unreadable() === true,
    quitting,
    moveAside,
    log,
    restart: relaunch,
  })));
}

const MOVED_ASIDE = /^credentials\.bin\.unreadable-([1-9][0-9]{0,15})$/;

/** The time of the last "Reset saved keys" (the newest credentials.bin.unreadable-<ms> beside the store), or null. The
 * server child gets it as SAGAX_VAULT_KEY_RESET and moves aside, once per data folder, the stores sealed with the key
 * that file held (server/vault/vault-key-reset.ts): the new key cannot open them, and they refuse to overwrite what
 * they cannot read. A file put back as credentials.bin is no longer counted. */
export function lastCredentialReset(names) {
  let latest = null;
  for (const name of names) {
    const stamp = MOVED_ASIDE.exec(name)?.[1];
    if (stamp && (latest === null || BigInt(stamp) > BigInt(latest))) latest = stamp;
  }
  return latest;
}
