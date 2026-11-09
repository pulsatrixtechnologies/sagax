import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createUiSnapshotStore, UI_SNAPSHOT_MAX_BYTES } from "./ui-snapshot.mjs";

const sealing = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decryptString: (buffer) => {
    const value = buffer.toString();
    if (!value.startsWith("sealed:")) throw new Error("not ours");
    return Buffer.from(value.slice(7), "base64").toString();
  },
});

test("keeps one encrypted snapshot per local data folder", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ui-snapshot-"));
  try {
    let folder = "/Users/someone/.sagax";
    const store = createUiSnapshotStore({ dir, dataDir: () => folder, safeStorage: sealing() });
    assert.equal(store.read(), null);
    assert.equal(store.write('{"bots":[]}'), true);
    assert.equal(store.read(), '{"bots":[]}');
    const [file] = readdirSync(dir);
    assert.ok(!readFileSync(path.join(dir, file), "utf8").includes("bots"), "never in clear on disk");
    // another environment never reads it
    folder = "/Volumes/Work/sagax-env";
    assert.equal(store.read(), null);
    folder = "/Users/someone/.sagax";
    store.clear();
    assert.equal(store.read(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writes and reads nothing without encryption, without a local folder, or past the size cap", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ui-snapshot-"));
  try {
    const clear = createUiSnapshotStore({ dir, dataDir: () => "/x", safeStorage: sealing(false) });
    assert.equal(clear.write("{}"), false);
    assert.equal(clear.read(), null);
    const serverMode = createUiSnapshotStore({ dir, dataDir: () => null, safeStorage: sealing() });
    assert.equal(serverMode.write("{}"), false);
    const store = createUiSnapshotStore({ dir, dataDir: () => "/x", safeStorage: sealing() });
    assert.equal(store.write("x".repeat(UI_SNAPSHOT_MAX_BYTES + 1)), false);
    assert.equal(store.write(123), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that does not decrypt is not drawn", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ui-snapshot-"));
  try {
    const store = createUiSnapshotStore({ dir, dataDir: () => "/x", safeStorage: sealing() });
    store.write("{}");
    const other = createUiSnapshotStore({ dir, dataDir: () => "/x", safeStorage: { ...sealing(), decryptString: () => { throw new Error("other key"); } } });
    assert.equal(other.read(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
