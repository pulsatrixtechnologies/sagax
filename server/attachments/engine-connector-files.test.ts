// engine-connector-files.ts (#5140, M-20261120-008): a file a connector the
// engine holds itself saved into the engine's own folder goes into the
// person's place, leaves that folder, and the result names the person's
// path. Only the engine's own blob files are ever read. Neutral data only.
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { zipArchive } from "../testing/archive-fixtures.mjs";
import type { PersonPlace } from "./connector-files.ts";
import { clearRelayedPictures, engineBlobPaths, placeEngineFiles, projectBlobFolder, readEngineFile, sessionBlobFolder } from "./engine-connector-files.ts";

const ROOT = mkdtempSync(join(tmpdir(), "sagax-engine-files-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const SHEET = zipArchive([
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "xl/workbook.xml", data: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", data: "<worksheet><row><c>Heron</c></row></worksheet>" },
]);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SESSION = "0f1e2d3c-4b5a-4968-8776-655443322110";
let counter = 0;

/** One engine config folder with one session, as Claude Code lays it out. */
function engine() {
  const config = join(ROOT, `config-${++counter}`);
  const project = join(config, "projects", "-workspace-bots-wren");
  const results = join(project, SESSION, "tool-results");
  mkdirSync(results, { recursive: true });
  const transcript = join(project, `${SESSION}.jsonl`);
  writeFileSync(transcript, "");
  const folder = sessionBlobFolder(transcript, SESSION)!;
  const blob = (name: string, bytes: Buffer = SHEET) => { const path = join(results, name); writeFileSync(path, bytes); return path; };
  return { config, project, results, transcript, folder, blob };
}

/** What Claude Code hands the model for a binary MCP result it saved. */
const said = (path: string, uri = "docs://files/42", mime = XLSX) => [{ type: "text", text: `[Resource from claude_ai_Docs_Hub at ${uri}] Binary content (${mime}, 1.2KB) saved to ${path}` }];

function computer(files = new Map<string, Buffer>()): PersonPlace & { files: Map<string, Buffer> } {
  return {
    kind: "computer",
    files,
    save: async (name, bytes) => {
      const path = `C:\\Users\\wren\\AppData\\Local\\Temp\\Sagax\\attachments\\${name}`;
      files.set(path, Buffer.from(bytes));
      return path;
    },
  };
}

describe("sessionBlobFolder", () => {
  it("is the session's own folder from the hook's transcript path and session id", () => {
    const { project, transcript } = engine();
    expect(sessionBlobFolder(transcript, SESSION)).toEqual({ root: project, session: SESSION });
  });

  it("names nothing for another shape", () => {
    const { transcript } = engine();
    expect(sessionBlobFolder(transcript, "other-session-id")).toBeNull();
    expect(sessionBlobFolder("relative/projects/x/a.jsonl", "a")).toBeNull();
    expect(sessionBlobFolder("/tmp/notprojects/x/" + `${SESSION}.jsonl`, SESSION)).toBeNull();
    expect(sessionBlobFolder(undefined, SESSION)).toBeNull();
  });
});

describe("engineBlobPaths", () => {
  it("finds the engine's own blob paths of this session only", () => {
    const { results, folder, project } = engine();
    const mine = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000000-ab12cd.xlsx");
    const other = join(project, "11111111-2222-4333-8444-555555555555", "tool-results", "mcp-claude_ai_Docs_Hub-blob-1-x.pdf");
    const text = `saved to ${mine}; earlier ${other}; and /etc/passwd`;
    expect(engineBlobPaths(text, folder)).toEqual([mine]);
    // the hub's one-call process: any session of its own project folder
    expect(engineBlobPaths(text, { root: project, session: null })).toEqual([mine, other]);
  });

  it("reads a folder with a space in it", () => {
    const folder = projectBlobFolder("/srv/Sagax Data/claude", "/tmp/sagax-claude-connector-Ab12");
    expect(folder.root).toBe("/srv/Sagax Data/claude/projects/-tmp-sagax-claude-connector-Ab12");
    const path = `${folder.root}/${SESSION}/tool-results/mcp-claude_ai_X-blob-9-zz.pdf`;
    expect(engineBlobPaths(`Binary content saved to ${path}`, folder)).toEqual([path]);
  });
});

describe("placeEngineFiles", () => {
  it("moves the file into the person's place, leaves none in the engine's folder, and names the person's path", async () => {
    const { results, folder, blob } = engine();
    const path = blob("mcp-claude_ai_Docs_Hub-blob-1763600000000-ab12cd.xlsx");
    const place = computer();
    const { output, moved } = await placeEngineFiles(said(path), folder, [place]);

    expect(moved).toBe(1);
    expect(readdirSync(results)).toEqual([]);
    const [onComputer, bytes] = [...place.files][0]!;
    expect(bytes.equals(SHEET)).toBe(true);
    expect(onComputer).toMatch(/\\[0-9a-f]{8}-download\.xlsx$/);
    const text = (output as Array<{ text: string }>)[0]!.text;
    expect(text).not.toContain(path);
    expect(text).toContain(onComputer);
    expect(text).toContain("not on the Sagax server");
    expect(text).toContain("attach_file");
  });

  it("keeps the picture the model sees and moves its saved copy", async () => {
    const { results, folder, blob } = engine();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const path = blob("mcp-claude_ai_Docs_Hub-blob-1763600000001-cd34ef.png", png);
    const picture = { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } };
    const place = computer();
    const { output } = await placeEngineFiles([picture, { type: "text", text: `[Image source: ${path}]` }], folder, [place]);

    expect((output as unknown[])[0]).toEqual(picture);
    expect(readdirSync(results)).toEqual([]);
    const onComputer = [...place.files.keys()][0]!;
    expect(onComputer).toMatch(/\.png$/);
    expect((output as Array<{ text?: string }>)[1]!.text).toContain(`[Image source: ${onComputer}]`);
    expect((output as Array<{ text?: string }>)[1]!.text).toContain("image/png");
  });

  it("drops the file when the person has no place in this turn: nothing stays on the server", async () => {
    const { results, folder, blob } = engine();
    const path = blob("mcp-claude_ai_Docs_Hub-blob-1763600000002-ef56ab.xlsx");
    const { output, moved } = await placeEngineFiles(said(path), folder, []);
    expect(moved).toBe(1);
    expect(readdirSync(results)).toEqual([]);
    expect((output as Array<{ text: string }>)[0]!.text).toMatch(/\(not kept\)[\s\S]*was not kept: the person has no computer connected/);
  });

  it("returns a result that names no file as it is", async () => {
    const { folder } = engine();
    const output = [{ type: "text", text: "{\"tickets\":[]}" }];
    expect(await placeEngineFiles(output, folder, [computer()])).toEqual({ output, moved: 0 });
  });

  it("never reads a path the output names outside the engine's own folder", async () => {
    const { folder, project, results } = engine();
    const elsewhere = join(ROOT, "server-secret.json");
    writeFileSync(elsewhere, "{\"key\":\"x\"}");
    // a blob-named file of another session: not this call's folder
    const otherDir = join(project, "11111111-2222-4333-8444-555555555555", "tool-results");
    mkdirSync(otherDir, { recursive: true });
    const other = join(otherDir, "mcp-claude_ai_Docs_Hub-blob-1-aa.xlsx");
    writeFileSync(other, SHEET);
    const place = computer();
    const output = [{ type: "text", text: `saved to ${elsewhere} and ${other} and ${results}/../../etc` }];
    expect(await placeEngineFiles(output, folder, [place])).toEqual({ output, moved: 0 });
    expect(place.files.size).toBe(0);
    expect(readFileSync(elsewhere, "utf8")).toBe("{\"key\":\"x\"}");
    expect(existsSync(other)).toBe(true);
  });

  it("follows no link and reads no second name of a credential file (the sensitive-path guard of #5138)", async () => {
    const { config, folder, results } = engine();
    const credentials = join(config, ".credentials.json");
    writeFileSync(credentials, "{\"token\":\"x\"}");
    const linked = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000003-aa11bb.json");
    symlinkSync(credentials, linked);
    const hard = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000004-cc22dd.json");
    linkSync(credentials, hard);
    const place = computer();
    const output = [{ type: "text", text: `saved to ${linked}\nsaved to ${hard}` }];
    expect(await placeEngineFiles(output, folder, [place])).toEqual({ output, moved: 0 });
    expect(place.files.size).toBe(0);
    expect(readFileSync(credentials, "utf8")).toBe("{\"token\":\"x\"}");
  });

  it("moves a resource the engine read (ReadMcpResource) and names the person's path in each field", async () => {
    const { results, folder, blob } = engine();
    const path = blob("mcp-resource-1763600000006-0-gh44ij.xlsx");
    const place = computer();
    const output = { contents: [{ uri: "docs://files/43", mimeType: XLSX, blobSavedTo: path, text: `[Resource from claude_ai_Docs_Hub at docs://files/43] Binary content (${XLSX}, 1.2KB) saved to ${path}` }] };
    const { output: placed, moved } = await placeEngineFiles(output, folder, [place]);
    expect(moved).toBe(1);
    expect(readdirSync(results)).toEqual([]);
    const onComputer = [...place.files.keys()][0]!;
    const entry = (placed as typeof output).contents[0]!;
    expect(entry.blobSavedTo).toBe(onComputer);
    expect(entry.text).toContain(onComputer);
    expect(entry.text).toContain("attach_file");
    expect(entry.uri).toBe("docs://files/43");
  });

  it("answers in time when the copy to the person's place is slow, and keeps nothing on the server", async () => {
    const { results, folder, blob } = engine();
    const path = blob("mcp-claude_ai_Docs_Hub-blob-1763600000007-kk55ll.xlsx");
    let release: () => void = () => {};
    const slow: PersonPlace = { kind: "computer", save: () => new Promise((resolve) => { release = () => resolve("C:\\late.xlsx"); }) };
    const { output } = await placeEngineFiles(said(path), folder, [slow], undefined, 50);
    release();
    expect(readdirSync(results)).toEqual([]);
    expect((output as Array<{ text: string }>)[0]!.text).toMatch(/was not kept: the copy to the person's place did not finish in time/);
  });

  it("reads through no link, even one swapped in after the check", () => {
    const { config, results } = engine();
    const credentials = join(config, ".credentials.json");
    writeFileSync(credentials, "{\"token\":\"x\"}");
    const swapped = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000008-mm66nn.json");
    symlinkSync(credentials, swapped);
    expect(() => readEngineFile(swapped)).toThrow();
  });

  it("removes a forged name attach_file would refuse unread (the CLI never writes one), and says it was not kept", async () => {
    const { results, folder, blob } = engine();
    const path = blob("mcp-claude_ai_Docs_Hub-blob-1763600000005-ee33ff.pem", Buffer.from("-----BEGIN CERTIFICATE-----"));
    const place = computer();
    const { output } = await placeEngineFiles(said(path, "docs://files/cert", "application/x-pem-file"), folder, [place]);
    expect(place.files.size).toBe(0);
    expect(readdirSync(results)).toEqual([]);
    expect((output as Array<{ text: string }>)[0]!.text).toMatch(/was not kept: it is a hidden or credential file/);
  });
});

describe("clearRelayedPictures (#5155)", () => {
  it("after the turn, a relayed picture is gone and a document in the same folder stays", () => {
    const { project, results, blob } = engine();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7]);
    blob("mcp-perspicax-blob-1763600000000-aa11bb.png", png);
    blob("mcp-sagax_desktop-blob-1763600000001-cc22dd.jpg", jpg);
    blob("mcp-perspicax-blob-1763600000003-ff44aa.bin", png);
    blob("mcp-perspicax-blob-1763600000002-ee33ff.pdf");
    writeFileSync(join(results, "notes.txt"), "keep");
    const linked = join(results, "mcp-perspicax-blob-1763600000004-ab12cd.png");
    symlinkSync(join(results, "notes.txt"), linked);
    const other = join(project, "11111111-2222-4333-8444-555555555555", "tool-results");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "mcp-perspicax-blob-1-zz.png"), png);

    expect(clearRelayedPictures(project, SESSION)).toBe(3);

    expect(readdirSync(results).sort()).toEqual([
      "mcp-perspicax-blob-1763600000002-ee33ff.pdf",
      "mcp-perspicax-blob-1763600000004-ab12cd.png",
      "notes.txt",
    ]);
    const kept = readdirSync(results).map((name) => readFileSync(join(results, name)));
    expect(kept.some((bytes) => bytes.equals(png) || bytes.equals(jpg))).toBe(false);
    expect(readFileSync(join(other, "mcp-perspicax-blob-1-zz.png")).equals(png)).toBe(true);
    expect(clearRelayedPictures(project, "nope")).toBe(0);
  });
});
