// Vitest setup — every test file gets a throwaway home directory so
// DATA_DIR (~/.sagax) never touches the real one. os.homedir()
// reads HOME (POSIX) / USERPROFILE (Windows) at call time, and this file
// runs before any test module imports server/config.ts.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach } from "vitest";

import { flushOwnedFilesSync } from "../atomic.ts";
import { removeTempDir } from "./cleanup.ts";
// Old names in the developer's shell (OMB_DATA_DIR) become SAGAX_* first, so
// the deletes below catch them too.
import "../../electron/legacy-env-boot.mjs";

const home = mkdtempSync(join(tmpdir(), "omb-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
// SAGAX_DATA_DIR is an intentional production override, but tests must never
// let it escape the throwaway home they are about to delete.
delete process.env.SAGAX_DATA_DIR;
// Do not let a developer's Hermes global config path leak into per-test homes.
delete process.env.HERMES_HOME;
// The companion keeps its paired devices in its own directory, and resolves
// it from homedir() the same way — so the redirect above already covers it.
// Named explicitly all the same: the device tests delete this directory
// wholesale, and "it is safe because of a line in another file" is not the
// footing that delete should stand on.
process.env.SAGAX_COMPANION_DIR = join(home, ".openmausbot-companion");
// Local VM containers made by tests carry the run's namespace, never the
// real name (server/testing/global-setup.ts sets it; this is the fallback
// for a file run some other way).
process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ||= `t${process.pid.toString(36)}-solo`;

// Product code follows navigator.language, which makes English assertions
// depend on the developer or CI host locale. Keep the shared default stable;
// dedicated i18n tests explicitly select every translated pack they exercise.
Object.defineProperty(globalThis.navigator, "language", { value: "en", configurable: true });

// Content encryption at rest (docs/content-encryption.md) is on by default
// for a real server. The suite's servers read their message database raw in
// places, so it stays off there unless a run asks for it; its own tests
// (server/content-encryption.test.ts) turn it on explicitly.
process.env.SAGAX_CONTENT_ENCRYPTION ??= "off";

// SQLite keeps the database file open for the lifetime of its handle.
// Windows will not remove a directory containing an open database, so close
// the per-test handle before the next test resets its throwaway data dir.
// A DOM environment (happy-dom) never opens it, and Vite cannot bundle
// node:sqlite for one, so those files skip the import.
const { closeMessageDb } = !("window" in globalThis)
  ? await import("../messages/message-db.ts")
  : { closeMessageDb: () => {} };
afterEach(closeMessageDb);
// A test's deferred saves (server/atomic.ts) land before the next test resets
// the data directory, never inside the next test's fresh one.
afterEach(flushOwnedFilesSync);

// Windows holds a directory that is a live process's cwd, and a just-killed
// CLI lets go a beat after the kill call returns — see removeTempDir.
afterAll(async () => {
  closeMessageDb();
  await removeTempDir(home);
});
