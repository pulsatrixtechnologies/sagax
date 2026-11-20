// personPlaces.ts (#5138, M-20261120-008): where a connector's file goes in
// a turn (the person's computer first, else their server environment), the
// one chunked copy into it, and attach_file's read back. The desktop app and
// the server environment are played by fakes that keep real bytes.
import { describe, expect, it } from "vitest";

import { bufferChunks, createPersonPlaces } from "./personPlaces.ts";

const DESKTOP = "sagax-desktop";
const ATTACHMENTS = "C:\\Users\\wren\\AppData\\Local\\Temp\\Sagax\\attachments";

/** Bytes that do not repeat, so a misplaced chunk shows. */
const big = (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 7 + (index >> 8)) & 0xff));

/** A desktop app: stage_file writes in order into its attachments folder,
 * read_file answers base64 slices with the "more bytes" trailer. */
function fakeDesktop() {
  const files = new Map<string, Buffer>();
  const calls: string[] = [];
  return {
    files,
    calls,
    current: (person: string) => (person === "alice" ? { id: "d-1", attachmentsDir: ATTACHMENTS, platform: "win32" } : null),
    request: async (person: string, operation: Record<string, unknown>) => {
      if (person !== "alice") throw Object.assign(new Error("not connected"), { status: 409 });
      calls.push(String(operation.action));
      if (operation.action === "stage_file") {
        const path = `${ATTACHMENTS}\\${operation.name}`;
        const data = Buffer.from(String(operation.content), "base64");
        const before = files.get(path) ?? Buffer.alloc(0);
        if (Number(operation.offset) !== (operation.offset === 0 ? 0 : before.length)) throw new Error("Attachment chunks out of order");
        files.set(path, operation.offset === 0 ? data : Buffer.concat([before, data]));
        return { content: [{ type: "text", text: operation.final ? `saved ${path}` : "ok" }] };
      }
      if (operation.action === "read_file") {
        const file = files.get(String(operation.path));
        if (!file) return { content: [{ type: "text", text: `ENOENT: no such file or directory, open '${operation.path}'` }], isError: true };
        const offset = Number(operation.offset ?? 0);
        const slice = file.subarray(offset, offset + Number(operation.max_bytes));
        const rest = file.length - offset - slice.length;
        return { content: [{ type: "text", text: `${slice.toString("base64")}${rest > 0 ? `\n[${rest} more bytes; read again with offset ${offset + slice.length}]` : ""}` }] };
      }
      throw new Error("Unsupported operation");
    },
  };
}

/** Each person's server environment: the copy and read commands of
 * personPlaces.ts, run on an in-memory /workspace of that person. */
function fakeEnvironment() {
  const byPerson = new Map<string, Map<string, Buffer>>();
  const of = (person: string) => byPerson.get(person) ?? byPerson.set(person, new Map()).get(person)!;
  const execs: Array<{ person: string; script: string }> = [];
  return {
    of,
    execs,
    exec: async (person: string, input: { argv: string[]; env: Record<string, string>; maxOutputBytes?: number }) => {
      const files = of(person);
      const script = input.argv[2]!;
      const env = input.env;
      execs.push({ person, script });
      const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "", truncated: false, timedOut: false });
      if (script.includes("base64 -d")) {
        const pieces = Object.keys(env).filter((key) => key.startsWith("SAGAX_CONTENT_B64_")).sort((a, b) => Number(a.split("_").at(-1)) - Number(b.split("_").at(-1)));
        const data = Buffer.concat(pieces.map((key) => Buffer.from(env[key]!, "base64")));
        const before = script.includes(">>") ? files.get(env.SAGAX_PATH!) ?? Buffer.alloc(0) : Buffer.alloc(0);
        files.set(env.SAGAX_PATH!, Buffer.concat([before, data]));
        return ok("");
      }
      if (script.includes("realpath")) {
        const file = files.get(env.SAGAX_PATH!);
        if (!file) return { ...ok(""), exitCode: 3 };
        if (!env.SAGAX_PATH!.startsWith("/workspace/")) return { ...ok(""), exitCode: 4 };
        return ok(`${file.length}\n${env.SAGAX_PATH}`);
      }
      if (script.includes("tail -c")) {
        const file = files.get(env.SAGAX_PATH!)!;
        const from = Number(env.SAGAX_FROM) - 1;
        const out = file.subarray(from, from + Number(env.SAGAX_COUNT)).toString("base64");
        expect(out.length).toBeLessThanOrEqual(input.maxOutputBytes!);
        return ok(out);
      }
      throw new Error(`unexpected command: ${script}`);
    },
  };
}

function host(mounted: string[], over: { desktop?: ReturnType<typeof fakeDesktop>; environment?: ReturnType<typeof fakeEnvironment> } = {}) {
  const desktop = over.desktop ?? fakeDesktop();
  const environment = over.environment ?? fakeEnvironment();
  const audit: Array<{ ok: boolean; target: string }> = [];
  const workplaces = new Map([
    ["t-a", { generation: "g-1", botId: "bot-a", decision: { principal: "alice" } }],
    ["t-b", { generation: "g-2", botId: "bot-a", decision: { principal: "bob" } }],
  ]);
  const value = {
    DESKTOP_BRIDGE_MCP_NAME: DESKTOP,
    turnWorkplaces: workplaces,
    store: { bot: (id: string) => (id === "bot-a" ? { id } : null) },
    ownAttachmentRoots: (_bot: unknown, threadId: string) => {
      const roots: Array<{ server: string; path: string; platform: string }> = [];
      if (mounted.includes(DESKTOP) && threadId === "t-a") roots.push({ server: DESKTOP, path: ATTACHMENTS, platform: "win32" });
      if (mounted.includes("sagax-environment")) roots.push({ server: "sagax-environment", path: "/workspace/attachments", platform: "linux" });
      return roots;
    },
    desktopBridges: { current: desktop.current, request: desktop.request },
    activeInternalGenerationByThread: new Map([["t-a", "g-1"], ["t-b", "g-2"]]),
    userSandbox: { exec: environment.exec },
    bridgeAudit: { record: (row: { ok: boolean; target: string }) => audit.push(row) },
  };
  return { places: createPersonPlaces(() => value), desktop, environment, audit };
}

const ALICE = { botId: "bot-a", threadId: "t-a", generation: "g-1" };
const BOB = { botId: "bot-a", threadId: "t-b", generation: "g-2" };

describe("bufferChunks", () => {
  it("covers every byte once, in order, the last one final", async () => {
    const bytes = big(1000);
    const chunks = [];
    for await (const chunk of bufferChunks(bytes, 300)) chunks.push(chunk);
    expect(chunks.map((chunk) => [chunk.offset, chunk.data.length, chunk.final])).toEqual([[0, 300, false], [300, 300, false], [600, 300, false], [900, 100, true]]);
    const empty = [];
    for await (const chunk of bufferChunks(Buffer.alloc(0), 300)) empty.push(chunk);
    expect(empty).toEqual([{ data: Buffer.alloc(0), offset: 0, final: true }]);
  });
});

describe("the person's places of a turn", () => {
  it("puts the computer first, then the server environment, and only for the live turn", () => {
    const { places } = host([DESKTOP, "sagax-environment"]);
    expect(places.placesForTurn(ALICE).map((place: { kind: string }) => place.kind)).toEqual(["computer", "environment"]);
    expect(places.placesForTurn({ ...ALICE, generation: "old" })).toEqual([]);
    expect(places.placesForTurn({ ...ALICE, botId: "bot-other" })).toEqual([]);
  });

  it("copies a file of several chunks onto the person's computer and reads it back whole", async () => {
    const { places, desktop, audit } = host([DESKTOP]);
    const bytes = big(1_300_000);
    const [computer] = places.placesForTurn(ALICE);
    const path = await computer.save("0a1b2c3d-download.xlsx", bytes);
    expect(path).toBe(`${ATTACHMENTS}\\0a1b2c3d-download.xlsx`);
    expect(desktop.files.get(path)!.equals(bytes)).toBe(true);
    expect(desktop.calls.filter((call) => call === "stage_file")).toHaveLength(3);
    expect(audit).toEqual([expect.objectContaining({ ok: true, target: "user-desktop" })]);

    const read = await places.readFromPersonPlace(ALICE, path, () => 10_000_000);
    expect(read.name).toBe("0a1b2c3d-download.xlsx");
    expect(read.bytes.equals(bytes)).toBe(true);
    await expect(places.readFromPersonPlace(ALICE, path, () => 1000)).rejects.toMatchObject({ status: 413 });
    expect(await places.readFromPersonPlace(ALICE, `${ATTACHMENTS}\\missing.xlsx`, () => 10_000_000)).toBeNull();
  });

  it("copies into the server environment in groups of chunks and reads it back in slices", async () => {
    const { places, environment } = host(["sagax-environment"]);
    const bytes = big(900_000);
    const [place] = places.placesForTurn(ALICE);
    expect(place.kind).toBe("environment");
    const path = await place.save("0a1b2c3d-download.pdf", bytes);
    expect(path).toBe("/workspace/attachments/0a1b2c3d-download.pdf");
    expect(environment.of("alice").get(path)!.equals(bytes)).toBe(true);
    expect(environment.execs.every((exec) => exec.person === "alice")).toBe(true);

    const read = await places.readFromPersonPlace(ALICE, path, () => 10_000_000);
    expect(read.bytes.equals(bytes)).toBe(true);
    expect(environment.execs.filter((exec) => exec.script.includes("tail -c"))).toHaveLength(2);
  });

  it("never reads another person's place", async () => {
    const environment = fakeEnvironment();
    const { places } = host(["sagax-environment"], { environment });
    const path = await places.placesForTurn(ALICE)[0].save("0a1b2c3d-download.xlsx", big(10));
    // Bob's turn reaches his own environment only, where Alice's file is not
    expect(await places.readFromPersonPlace(BOB, path, () => 10_000_000)).toBeNull();
    expect(environment.of("bob").size).toBe(0);
    expect((await places.readFromPersonPlace(ALICE, path, () => 10_000_000)).bytes.equals(big(10))).toBe(true);
  });
});
