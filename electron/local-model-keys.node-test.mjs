// Per-loopback-server API keys: kept encrypted on this computer, keyed by the
// normalized loopback base, and never returned other than to the bridge.
import test from "node:test";
import assert from "node:assert/strict";

import { createLocalModelKeyStore, normalizeApiKey } from "./local-model-keys.mjs";

/** A reversible in-memory stand-in for safeStorage, plus an in-memory fs. */
function fakeStore() {
  const files = new Map();
  const fs = {
    existsSync: (file) => files.has(file),
    readFileSync: (file) => files.get(file),
    writeFileSync: (file, data) => { files.set(file, data); },
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  };
  // Stands in for safeStorage: a reversible transform so the stored bytes do
  // not contain the cleartext key (the real store writes only this output).
  const encryption = {
    available: async () => true,
    encrypt: async (value) => Buffer.from(`enc:${Buffer.from(value, "utf8").toString("base64")}`),
    decrypt: async (buffer) => ({ result: Buffer.from(String(buffer).slice("enc:".length), "base64").toString("utf8") }),
  };
  return { fs, encryption, files };
}

test("normalizeApiKey keeps a bounded single-line key and rejects empties and control characters", () => {
  assert.equal(normalizeApiKey("  sk-ornith-123  "), "sk-ornith-123");
  assert.equal(normalizeApiKey(""), null);
  assert.equal(normalizeApiKey("   "), null);
  assert.equal(normalizeApiKey("has\nnewline"), null, "a newline would be header injection");
  assert.equal(normalizeApiKey("tab\ttab"), null);
  assert.equal(normalizeApiKey(123), null);
  assert.equal(normalizeApiKey("x".repeat(4097)), null);
});

test("a per-endpoint key is stored and retrieved desktop-side, keyed by the normalized base", async () => {
  const { fs, encryption, files } = fakeStore();
  const store = createLocalModelKeyStore({ file: "/data/local-model-keys.bin", fs, encryption });

  assert.equal(await store.get("http://127.0.0.1:8000/v1"), null);
  assert.equal(await store.has("http://127.0.0.1:8000/v1"), false);

  // A trailing slash normalizes to the same base; set then read it back.
  assert.equal(await store.set("http://127.0.0.1:8000/v1/", "sk-ornith"), true);
  assert.equal(await store.get("http://127.0.0.1:8000/v1"), "sk-ornith");
  assert.equal(await store.has("http://127.0.0.1:8000/v1"), true);
  assert.deepEqual(await store.bases(), ["http://127.0.0.1:8000/v1"]);

  // The key is written only encrypted: the cleartext is never on disk.
  const onDisk = String(files.get("/data/local-model-keys.bin"));
  assert.equal(onDisk.includes("sk-ornith"), false, "cleartext key must not be on disk");
  assert.ok(onDisk.startsWith("enc:"));

  // A non-loopback base, or an invalid key, is refused.
  assert.equal(await store.set("http://10.0.0.8:8000/v1", "sk-x"), false);
  assert.equal(await store.set("http://127.0.0.1:8000/v1", "bad\nkey"), false);

  await store.clear("http://127.0.0.1:8000/v1");
  assert.equal(await store.get("http://127.0.0.1:8000/v1"), null);
  assert.deepEqual(await store.bases(), []);
});

test("the keys survive a reload from the encrypted file", async () => {
  const { fs, encryption } = fakeStore();
  const file = "/data/local-model-keys.bin";
  const first = createLocalModelKeyStore({ file, fs, encryption });
  await first.set("http://127.0.0.1:8000/v1", "sk-ornith");
  await first.set("http://localhost:1234/v1", "sk-lm");

  const second = createLocalModelKeyStore({ file, fs, encryption });
  assert.equal(await second.get("http://127.0.0.1:8000/v1"), "sk-ornith");
  assert.equal(await second.get("http://localhost:1234/v1"), "sk-lm");
  assert.deepEqual((await second.bases()).sort(), ["http://127.0.0.1:8000/v1", "http://localhost:1234/v1"]);
});

test("without OS encryption the key is held in memory and never written in the clear", async () => {
  const { fs, files } = fakeStore();
  const encryption = { available: async () => false, encrypt: async () => { throw new Error("unavailable"); }, decrypt: async () => { throw new Error("unavailable"); } };
  const store = createLocalModelKeyStore({ file: "/data/local-model-keys.bin", fs, encryption });
  assert.equal(await store.set("http://127.0.0.1:8000/v1", "sk-ornith"), true);
  // In memory for this launch; nothing (least of all the cleartext) hits disk.
  assert.equal(files.has("/data/local-model-keys.bin"), false);
  assert.equal(await store.get("http://127.0.0.1:8000/v1"), "sk-ornith");
});
