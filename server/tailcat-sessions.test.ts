import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Message, Store } from "./store.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { createRemoteSessionService, type RemoteSessionService } from "./remote-sessions.ts";
import { decodeWindowsScript, type RunCommand } from "./remote-session-probe.ts";
import { parsePublishBody } from "./routes/remote-sessions.ts";
import { resolveTailcatBinary } from "./tailcat-bin.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "0123456789ab";
const PERSON = "person-1";
const OTHER = "person-2";
const BOT = "bot-1";
const THREAD = "thread-1";

describe("publish body", () => {
  const now = Date.parse("2026-10-21T15:00:00.000Z");

  it("keeps the code and drops a tunnel token, and refuses an address field", () => {
    const parsed = parsePublishBody({
      flow_session_id: ID,
      code: "ud6-hfh",
      os: "windows",
      rights: "elevated",
      end_at: "2026-10-21T21:15:00.000Z",
      hostname: `POSTE-02 ${ADDRESS}`,
      user: "exemple\\technicien",
    }, now);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.value.code).toBe("UD6HFH");
    expect(parsed.value.facts?.hostname).toBe("POSTE-02");
    expect(JSON.stringify(parsed.value)).not.toContain(ADDRESS);
    expect("error" in parsePublishBody({
      flow_session_id: ID, code: "UD6HFH", os: "windows", rights: "standard", end_at: "2026-10-21T21:15:00.000Z",
      address: ADDRESS,
    }, now)).toBe(true);
    expect("error" in parsePublishBody({
      flow_session_id: ID, code: "UD6HF0", os: "windows", rights: "standard", end_at: "2026-10-21T21:15:00.000Z",
    }, now)).toBe(true);
  });
});

describe("remote session service", () => {
  let dataDir = "";
  let homeDir = "";
  let messages: Message[];
  let calls: string[][];

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  function tunnel() {
    const dir = path.join(homeDir, "tailcat", ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "address"), `${ADDRESS}\n`, { mode: 0o600 });
    writeFileSync(path.join(dir, "client.private.json"), "{}\n", { mode: 0o600 });
  }

  function setup(): RemoteSessionService {
    dataDir = mkdtempSync(path.join(tmpdir(), "sagax-remote-"));
    homeDir = mkdtempSync(path.join(tmpdir(), "sagax-flow-"));
    messages = [];
    calls = [];
    const registry = new TerminalResourceRegistry();
    const run: RunCommand = async (argv) => {
      calls.push(argv);
      const raw = argv.at(-1) ?? "";
      const command = decodeWindowsScript(raw) ?? raw;
      if (command.includes("Win32_ComputerSystem")) {
        return {
          code: 0,
          stdout: [
            "hostname=POSTE-02",
            "user=exemple\\technicien",
            "model=OptiPlex",
            "serial=SN1",
            "cpu=Intel Core i5",
            "os=Windows 11 Professionnel",
            "admin=false",
            "ramBytes=17179869184",
            `diskFreeKb=125829120`,
            "diskTotalKb=499122176",
            `address=${ADDRESS}`,
          ].join("\n"),
          stderr: "",
        };
      }
      if (command.includes("sagax-transfer")) return { code: 0, stdout: "C:/Temp/sagax-transfer\n", stderr: "" };
      // the "is a file already there" check before an upload (#959): nothing is
      if (raw.includes("-EncodedCommand") && command.includes("Test-Path")) return { code: 0, stdout: "no", stderr: "" };
      if (command.includes("px-sagax-shot.png") && argv[1] === "ssh") return { code: 0, stdout: "C:/Temp/px-sagax-shot.png\n", stderr: "" };
      if (argv[1] === "cp") {
        const dest = argv.at(-1) ?? "";
        if (!dest.startsWith("tc")) writeFileSync(dest, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const store = {
      bot: () => ({ id: BOT, name: "Melonie", color: "#336699" }),
      appendMessage: (_thread: string, partial: Partial<Message>) => {
        const message = { id: `m${messages.length}`, at: 1, role: "bot", kind: "text", ...partial } as Message;
        messages.push(message);
        return message;
      },
      patchMessage: (_thread: string, id: string, patch: Partial<Message>) => {
        const row = messages.find((message) => message.id === id);
        if (!row) return null;
        Object.assign(row, patch);
        return row;
      },
    } as unknown as Store;
    return createRemoteSessionService({
      dataDir,
      store,
      registry,
      sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
      access: () => ({ organization: true, admin: false, ownsBot: true }),
      owner: () => PERSON,
      run,
      home: () => homeDir,
    });
  }

  const input = {
    id: ID,
    botId: BOT,
    threadId: THREAD,
    principalId: PERSON,
    code: "UD6HFH",
    os: "windows" as const,
    elevated: true,
    endAt: "2026-10-21T21:15:00.000Z",
    facts: { hostname: "pending" },
  };

  it("posts a card from the probe and never stores the tunnel address", async () => {
    const service = setup();
    tunnel();
    const published = await service.publish(input);
    expect(published.reachable).toBe(true);
    expect(published.view.hostname).toBe("POSTE-02");
    expect(published.view.user).toBe("exemple\\technicien");
    expect(published.view.serial).toBe("SN1");
    expect(published.view.disk).toContain("libres sur");
    expect(published.view.elevated).toBe(true);
    expect(published.view.suggestions.map((hint) => hint.id)).toEqual(["disk-low", "cpu", "errors", "startup"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.remoteSession?.hostname).toBe("POSTE-02");
    const again = await service.publish({ ...input, facts: { cpu: "kept until probe" } });
    expect(messages).toHaveLength(1);
    expect(again.view.hostname).toBe("POSTE-02");
    const saved = readFileSync(path.join(dataDir, "remote-sessions.json"), "utf8");
    expect(saved).not.toContain(ADDRESS);
    expect(JSON.stringify(messages)).not.toContain(ADDRESS);
    expect(service.list(OTHER, BOT)).toEqual([]);
    expect(await service.close(OTHER, BOT, ID)).toBeNull();
    const closed = await service.close(PERSON, BOT, ID);
    expect(closed?.state).toBe("ended");
    expect(closed?.suggestions).toEqual([]);
    // a Windows session gets the PowerShell stop file, encoded (its shell is PowerShell)
    expect(calls.some((argv) => (decodeWindowsScript(argv.at(-1) ?? "") ?? "").includes(`'px-assist-${ID}'`))).toBe(true);
  });

  it("still posts the card when this host has no tunnel", async () => {
    const service = setup();
    const published = await service.publish(input);
    expect(published.reachable).toBe(false);
    expect(published.view.hostname).toBe("pending");
    expect(calls).toEqual([]);
    const shell = await service.openShell({ principalId: PERSON, botId: BOT, threadId: THREAD });
    expect(shell).toEqual({ error: "The tunnel for this remote computer is not on this server yet." });
    expect(await service.upload(PERSON, BOT, ID, "notes.txt", Buffer.from("hello"))).toEqual({ error: "The tunnel for this remote computer is not on this server yet." });
    expect(await service.download(PERSON, BOT, ID, "C:/Temp/notes.txt")).toEqual({ error: "The tunnel for this remote computer is not on this server yet." });
    const closed = await service.close(PERSON, BOT, ID);
    expect(closed?.state).toBe("ended");
    expect(await service.upload(PERSON, BOT, ID, "notes.txt", Buffer.from("hello"))).toEqual({ error: "That remote session is not open." });
  });

  it("copies files with the tailcat shipped beside the app when PATH is only the system directories", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sagax-tailcat-bin-"));
    const bundled = path.join(root, "tailcat", "tailcat");
    mkdirSync(path.dirname(bundled));
    writeFileSync(bundled, "fixture");
    const saved = {
      PATH: process.env.PATH,
      SAGAX_RESOURCES_PATH: process.env.SAGAX_RESOURCES_PATH,
      SAGAX_TAILCAT_PATH: process.env.SAGAX_TAILCAT_PATH,
      SAGAX_DATA_DIR: process.env.SAGAX_DATA_DIR,
    };
    process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
    process.env.SAGAX_RESOURCES_PATH = root;
    delete process.env.SAGAX_TAILCAT_PATH;
    delete process.env.SAGAX_DATA_DIR;
    try {
      const found = resolveTailcatBinary();
      expect(found).toBe(bundled);
      const service = setup();
      tunnel();
      await service.publish(input);
      const probe = calls.find((argv) => argv[1] === "ssh");
      expect(probe?.[0]).toBe(bundled);
      expect(probe?.[0]).not.toBe("tailcat");
      const sent = await service.upload(PERSON, BOT, ID, "notes.txt", Buffer.from("hello"));
      expect(sent).toEqual({ name: "notes.txt" });
      const copied = calls.find((argv) => argv[1] === "cp");
      expect(copied?.[0]).toBe(bundled);
      expect(JSON.stringify(sent)).not.toContain(ADDRESS);
      expect(found).toBe(bundled);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("opens a shell and moves a file without returning the address", async () => {
    const service = setup();
    tunnel();
    await service.publish(input);
    const opened = await service.openShell({ principalId: PERSON, botId: BOT, threadId: THREAD });
    expect(opened).toMatchObject({ hostLabel: "POSTE-02" });
    expect(messages.some((message) => message.terminalEmbed?.provider === "tailcat" && message.terminalEmbed.hostLabel === "POSTE-02")).toBe(true);
    expect(JSON.stringify(messages)).not.toContain(ADDRESS);
    expect(await service.openShell({ principalId: OTHER, botId: BOT, threadId: THREAD })).toBeNull();
    const sent = await service.upload(PERSON, BOT, ID, "notes.txt", Buffer.from("hello"));
    expect(sent).toEqual({ name: "notes.txt" });
    expect(calls.some((argv) => argv[1] === "cp" && argv.at(-1)?.endsWith("notes.txt"))).toBe(true);
    const pulled = await service.download(PERSON, BOT, ID, "C:/Users/usager/Desktop/notes.txt");
    expect("bytes" in pulled && pulled.name).toBe("notes.txt");
    expect(await service.download(PERSON, BOT, ID, "C:/Users/../secret.txt")).toEqual({ error: "That path cannot be downloaded." });
    expect(await service.download(PERSON, BOT, ID, ADDRESS)).toEqual({ error: "That path cannot be downloaded." });
    const shot = await service.screen(PERSON, BOT, ID);
    expect(shot?.[0]).toBe(0x89);
    const leaked = JSON.stringify({ sent, pulled: "error" in pulled ? pulled : { name: pulled.name }, calls: calls.map((argv) => argv.filter((part) => !part.includes(ADDRESS))) });
    expect(leaked).not.toContain(ADDRESS);
  });
});
