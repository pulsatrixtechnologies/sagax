import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_VAULT_OPTIONS, planVaultImport } from "../../shared/obsidian-import";
import { readVaultZip, runVaultImport, type ImportWriters, type VaultSource } from "./memory-import";
import { readZipEntries, ZipReadError } from "./zip-read";

/** A zip as an archiver writes one: each entry deflated (or stored), then the central directory. */
function zip(files: Array<{ name: string; data: Buffer; store?: boolean; flags?: number }>): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const body = file.store ? file.data : deflateRawSync(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.flags ?? 0, 6);
    local.writeUInt16LE(file.store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.flags ?? 0, 8);
    central.writeUInt16LE(file.store ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, dir, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
}

describe("a vault's .zip", () => {
  it("reads its notes and keeps an image for later", async () => {
    const buffer = zip([
      { name: "My Vault/", data: Buffer.alloc(0), store: true },
      { name: "My Vault/Home.md", data: Buffer.from("Hello [[Other]] #tag\n") },
      { name: "My Vault/Other.md", data: Buffer.from("Other note\n") },
      { name: "My Vault/img.png", data: Buffer.from("png-bytes"), store: true },
      { name: "My Vault/.env", data: Buffer.from("TOKEN=x") },
    ]);
    const source = await readVaultZip({ name: "My Vault.zip", arrayBuffer: async () => buffer });
    expect(source.name).toBe("My Vault");
    expect(source.files.map((file) => [file.path, file.text])).toEqual([
      ["Home.md", "Hello [[Other]] #tag\n"],
      ["Other.md", "Other note\n"],
      ["img.png", undefined],
      // a secret-looking file is never opened
      [".env", undefined],
    ]);
    expect(new TextDecoder().decode(await source.bytes("img.png"))).toBe("png-bytes");
    await expect(source.bytes(".env")).rejects.toThrow();
  });

  it("refuses an encrypted zip and one with too many files", () => {
    expect(() => readZipEntries(zip([{ name: "a.md", data: Buffer.from("x"), flags: 1 }]), { maxEntries: 10, maxEntryBytes: 100 })).toThrow(ZipReadError);
    expect(() => readZipEntries(zip([{ name: "a.md", data: Buffer.from("x") }, { name: "b.md", data: Buffer.from("y") }]), { maxEntries: 1, maxEntryBytes: 100 })).toThrow(/more than 1 files/);
    expect(() => readZipEntries(new ArrayBuffer(10), { maxEntries: 1, maxEntryBytes: 1 })).toThrow(/not a zip/);
  });
});

function source(files: Record<string, string>): VaultSource {
  return { name: "Vault", files: Object.entries(files).map(([path, text]) => ({ path, size: text.length, text })), bytes: async () => new Uint8Array([1, 2, 3]) };
}

describe("runVaultImport", () => {
  const writers = (): ImportWriters & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      bot: vi.fn(async (_botId, body) => {
        calls.push(`bot:${body.notes.length}+${body.attachments.length}`);
        return { results: [...body.notes, ...body.attachments].map((item) => ({ path: item.path, status: "written" as const })) };
      }),
      pxCreate: vi.fn(async (note) => { calls.push(`create:${note.topic}/${note.title}`); if (note.title === "Bad") throw new Error("refused: secret"); }),
      pxUpdate: vi.fn(async (note) => { calls.push(`update:${note.id}`); }),
    };
  };

  it("writes a Perspicax tier note by note, and stops when asked", async () => {
    const vault = source({ "A.md": "a", "B.md": "b", "Bad.md": "c", "Old.md": "new text" });
    const plan = planVaultImport({ vaultName: "Vault", files: vault.files, options: { ...DEFAULT_VAULT_OPTIONS, conflict: "overwrite" }, destination: "perspicax", folder: "Vault", existing: [{ folder: "vault", title: "Old", id: "o1", body: "old" }] });
    const w = writers();
    const done = await runVaultImport(plan, vault, { kind: "perspicax", scope: "me" }, "overwrite", w);
    expect(w.calls).toEqual(["create:vault/A", "create:vault/B", "create:vault/Bad", "update:o1"]);
    expect(done.outcomes).toContainEqual({ title: "Bad", status: "refused", reason: "refused: secret" });
    expect(done.done).toBe(4);
    const controller = new AbortController();
    const w2 = writers();
    const stopped = await runVaultImport(plan, vault, { kind: "perspicax", scope: "me" }, "overwrite", w2, {
      signal: controller.signal,
      onProgress: (progress) => { if (progress.done === 1) controller.abort(); },
    });
    expect(stopped.cancelled).toBe(true);
    expect(w2.calls).toHaveLength(1);
  });

  it("sends a bot's notes in batches, then its attachments", async () => {
    const vault: VaultSource = { ...source({ "A.md": "a ![[pic.png]]", "B.md": "b" }), files: [...source({ "A.md": "a ![[pic.png]]", "B.md": "b" }).files, { path: "pic.png", size: 3 }] };
    const plan = planVaultImport({ vaultName: "Vault", files: vault.files, options: DEFAULT_VAULT_OPTIONS, destination: "bot", folder: "Vault", existing: [] });
    const w = writers();
    const done = await runVaultImport(plan, vault, { kind: "bot", botId: "atlas" }, "skip", w);
    expect(w.calls).toEqual(["bot:2+0", "bot:0+1"]);
    expect((w.bot as ReturnType<typeof vi.fn>).mock.calls[1]![1].attachments[0]).toEqual({ path: "memory-attachments/Vault/pic.png", data: "AQID" });
    expect(done.outcomes.filter((outcome) => outcome.status === "written")).toHaveLength(3);
  });
});
