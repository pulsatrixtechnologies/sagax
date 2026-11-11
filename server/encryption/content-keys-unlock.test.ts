// The keyring's start (#3524): unlock() unwraps every stored key ahead of
// the first read. A local provider unwraps synchronously, so its promises
// resolve as microtasks and never give the event loop back: the pass must
// yield in batches, or a server with many owners and confidential threads
// stops its loop for seconds at start. The keys it opens stay the same.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { ContentKeyring, ensureContentKeySchema, localKekProvider } from "./content-keys.ts";

const OWNERS = 96;

const vaultKey = Buffer.alloc(32, 7);

function filledDatabase(owners: number, threadsPerOwner: number): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  ensureContentKeySchema(database);
  const writer = new ContentKeyring(() => database, localKekProvider(() => ({ kind: "key", key: vaultKey })));
  for (let owner = 0; owner < owners; owner++) {
    writer.ownerKey(`owner-${owner}`);
    for (let thread = 0; thread < threadsPerOwner; thread++) writer.threadKey(`owner-${owner}`, `thread-${owner}-${thread}`);
  }
  return database;
}

describe("content keyring start (#3524)", () => {
  it("gives the event loop back while it unwraps many keys, and opens the same keys", async () => {
    const database = filledDatabase(OWNERS, 1);
    const ring = new ContentKeyring(() => database, localKekProvider(() => ({ kind: "key", key: vaultKey })));
    let turns = 0;
    let running = true;
    const spin = () => { if (!running) return; turns++; setImmediate(spin); };
    setImmediate(spin);
    const result = await ring.unlock();
    running = false;
    expect(result).toEqual({ unlocked: OWNERS, failed: 0, rewrapped: 0 });
    // one synchronous pass would let no turn of the loop run before it resolves
    expect(turns, "unlock() unwrapped every key in one synchronous pass").toBeGreaterThanOrEqual(2);
    // every owner and thread key opens, to the same bytes a fresh ring reads on demand
    const fresh = new ContentKeyring(() => database, localKekProvider(() => ({ kind: "key", key: vaultKey })));
    const ids = (database.prepare("SELECT key_id FROM content_keys").all() as Array<{ key_id: string }>).map((row) => row.key_id);
    expect(ids).toHaveLength(OWNERS * 2);
    for (const id of ids) {
      const opened = ring.key(id);
      const again = fresh.key(id);
      expect(opened && opened !== "destroyed" && again && again !== "destroyed" && opened.raw.equals(again.raw)).toBe(true);
    }
    database.close();
  });
});
