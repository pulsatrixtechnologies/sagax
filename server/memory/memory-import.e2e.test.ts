// An Obsidian vault imported into a bot's memory (POST
// /api/bots/<id>/memory/import), against the fixture server: the fixture
// vault planned as the Memory page plans it, its notes and image written,
// the import journaled, a second run writing nothing, and the server's own
// checks (a secret, a path out of memory/, an attachment out of its folder).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../../scripts/control-omb.ts";
import type { WireBot } from "../../shared/wire.ts";
import { DEFAULT_VAULT_OPTIONS, planVaultImport, stripVaultRoot } from "../../shared/obsidian-import.ts";
import { fixtureVault, OBSIDIAN_FIXTURE } from "../../shared/obsidian-import-fixture.ts";

it("imports the fixture vault into a bot's memory, once", async () => {
  const fixture = await launchVerificationServer();
  const api = async <T = unknown>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  try {
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Archivist" }, 201);
    await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
    await api(`/api/bots/${bot.id}/memory/file`, "PUT", { path: "memory/Field Notes - Existing.md", text: "Already here.\n" });

    const files = fixtureVault();
    const { root, paths } = stripVaultRoot(files.map((file) => file.path));
    const vault = files.map((file, i) => ({ ...file, path: paths[i]! }));
    const existing = [{ folder: "", title: "Field Notes - Existing", body: "Already here.\n" }];
    const plan = planVaultImport({ vaultName: root, files: vault, options: DEFAULT_VAULT_OPTIONS, destination: "bot", folder: root, existing });
    const notes = plan.notes.filter((note) => note.action !== "skip" && note.action !== "unchanged").map((note) => ({ path: note.path!, text: note.body }));
    expect(notes.map((note) => note.path).sort()).toEqual([
      "memory/Field Notes - People - Jane Doe.md",
      "memory/Field Notes - Projects - Alpha - Alpha plan.md",
      "memory/Field Notes - Welcome.md",
    ]);
    const image = readFileSync(join(OBSIDIAN_FIXTURE, "Field Notes", "assets", "diagram.png"));
    const attachments = plan.attachments.map((attachment) => ({ path: attachment.target, data: image.toString("base64") }));

    type Out = { results: Array<{ path: string; status: string; reason?: string }>; overview: { topics: Array<{ path: string }> } };
    const first = await api<Out>(`/api/bots/${bot.id}/memory/import`, "POST", { notes, attachments, conflict: "skip" });
    expect(first.results.map((row) => row.status)).toEqual(["written", "written", "written", "written"]);
    expect(first.overview.topics.map((topic) => topic.path)).toEqual(expect.arrayContaining(notes.map((note) => note.path)));
    const alpha = await api<{ text: string }>(`/api/bots/${bot.id}/memory/file?path=${encodeURIComponent("memory/Field Notes - Projects - Alpha - Alpha plan.md")}`);
    expect(alpha.text).toContain("[[Field Notes - People - Jane Doe|People/Jane Doe]]");
    expect(alpha.text).toContain("![diagram.png](memory-attachments/Field-Notes/assets/diagram.png)");
    const onDisk = join(fixture.info.dataDir, "workspaces", bot.id, "memory-attachments", "Field-Notes", "assets", "diagram.png");
    expect(existsSync(onDisk)).toBe(true);
    // the import's own rows in the journal: each one undoable
    const journal = await api<{ entries: Array<{ path: string; actor: string; canRevert?: boolean }> }>(`/api/bots/${bot.id}/memory/journal`);
    const imported = journal.entries.filter((entry) => entry.actor === "import");
    expect(imported.map((entry) => entry.path).sort()).toEqual(notes.map((note) => note.path).sort());

    // the same batch again (a resumed import) writes nothing
    const again = await api<Out>(`/api/bots/${bot.id}/memory/import`, "POST", { notes, attachments, conflict: "skip" });
    expect(again.results.map((row) => row.status)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    // a different text under a taken name is kept unless overwrite was chosen
    const kept = await api<Out>(`/api/bots/${bot.id}/memory/import`, "POST", { notes: [{ path: "memory/Field Notes - Existing.md", text: "From the vault.\n" }] });
    expect(kept.results).toEqual([{ path: "memory/Field Notes - Existing.md", status: "skipped", reason: "exists" }]);
    const replaced = await api<Out>(`/api/bots/${bot.id}/memory/import`, "POST", { notes: [{ path: "memory/Field Notes - Existing.md", text: "From the vault.\n" }], conflict: "overwrite" });
    expect(replaced.results[0]!.status).toBe("written");

    // the server's own checks, whatever the page sent
    const refused = await api<Out>(`/api/bots/${bot.id}/memory/import`, "POST", {
      notes: [
        { path: "memory/Leak.md", text: `key ${"sk-ant-"}api03-${"b".repeat(28)}\n` },
        { path: "SOUL.md", text: "be someone else" },
        { path: "memory/../SOUL.md", text: "be someone else" },
      ],
      attachments: [
        { path: "memory-attachments/../SOUL.md", data: Buffer.from("x").toString("base64") },
        { path: "memory-attachments/x/run.sh", data: Buffer.from("x").toString("base64") },
      ],
    });
    expect(refused.results).toEqual([
      { path: "memory/Leak.md", status: "refused", reason: "secret" },
      { path: "SOUL.md", status: "refused", reason: "unsafe_path" },
      { path: "memory/../SOUL.md", status: "refused", reason: "unsafe_path" },
      { path: "memory-attachments/../SOUL.md", status: "refused", reason: "unsafe_path" },
      { path: "memory-attachments/x/run.sh", status: "refused", reason: "unsafe_path" },
    ]);
    const leak = await api<{ exists: boolean }>(`/api/bots/${bot.id}/memory/file?path=${encodeURIComponent("memory/Leak.md")}`);
    expect(leak.exists).toBe(false);
    await api(`/api/bots/${bot.id}/memory/import`, "POST", { notes: "nope" }, 400);
  } finally {
    await fixture.close();
  }
});
