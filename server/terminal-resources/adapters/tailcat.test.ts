import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ argv: [] as string[][] }));

vi.mock("../../../electron/script-pty.mjs", () => ({
  spawnScriptPty: (argv: string[]) => {
    captured.argv.push(argv);
    return { input: null, output: null, resize: () => undefined, close: () => undefined };
  },
}));

import { createTailcatAdapter } from "./tailcat.ts";
import { readTunnel } from "../../remote-session-probe.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "0123456789ab";
const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

describe("tailcat terminal adapter", () => {
  const roots: string[] = [];
  const saved = {
    PATH: process.env.PATH,
    SAGAX_RESOURCES_PATH: process.env.SAGAX_RESOURCES_PATH,
    SAGAX_TAILCAT_PATH: process.env.SAGAX_TAILCAT_PATH,
    SAGAX_DATA_DIR: process.env.SAGAX_DATA_DIR,
  };

  afterEach(() => {
    captured.argv.length = 0;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("opens the shell with the shipped binary and does not return the address", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sagax-tailcat-pty-"));
    roots.push(root);
    const home = path.join(root, "flow");
    const bundled = path.join(root, "resources", "tailcat", "tailcat");
    mkdirSync(path.dirname(bundled), { recursive: true });
    writeFileSync(bundled, "fixture");
    const tunnel = path.join(home, "tailcat", ID);
    mkdirSync(tunnel, { recursive: true });
    writeFileSync(path.join(tunnel, "address"), `${ADDRESS}\n`);
    writeFileSync(path.join(tunnel, "client.private.json"), "{}\n");
    process.env.PATH = GUI_PATH;
    process.env.SAGAX_RESOURCES_PATH = path.join(root, "resources");
    delete process.env.SAGAX_TAILCAT_PATH;
    delete process.env.SAGAX_DATA_DIR;

    const asked: string[] = [];
    const adapter = createTailcatAdapter({
      targets: () => [{ id: ID, hostLabel: "POSTE-01", label: "Session à distance" }],
      tunnel: (principalId, botId, id) => {
        asked.push(`${principalId}/${botId}/${id}`);
        return readTunnel(home, { id });
      },
    });
    const opened = await adapter.open(ID, {
      auth: { principalId: "person-1" } as never,
      principalId: "person-1",
      botId: "bot-1",
      sessionId: "term-1",
      cols: 80,
      rows: 24,
    });
    expect(captured.argv).toHaveLength(1);
    const argv = captured.argv[0] ?? [];
    expect(argv[0]).toBe(bundled);
    expect(argv[0]).not.toBe("tailcat");
    expect(argv[1]).toBe("ssh");
    expect(argv[2]).toBe("--key");
    expect(JSON.stringify(opened)).not.toContain(ADDRESS);
    expect(JSON.stringify(opened)).not.toContain("nodekey:");
    // the tunnel is asked for this person's session on this bot
    expect(asked).toEqual([`person-1/bot-1/${ID}`]);

    await expect(adapter.open("ffffffffffff", {
      auth: { principalId: "person-1" } as never,
      principalId: "person-1",
      botId: "bot-1",
      sessionId: "term-2",
      cols: 80,
      rows: 24,
    })).rejects.toThrow("This remote computer is not connected from here.");
  });
  it("says the server has no ssh client instead of opening a shell nobody can type in", async () => {
    const adapter = createTailcatAdapter({
      targets: () => [{ id: ID, hostLabel: "POSTE-01", label: "Session à distance" }],
      tunnel: () => ({ keyPath: "/k/client.private.json", address: ADDRESS }),
      systemSsh: () => null,
    });
    await expect(adapter.open(ID, {
      auth: { principalId: "person-1" } as never,
      principalId: "person-1",
      botId: "bot-1",
      sessionId: "term-3",
      cols: 80,
      rows: 24,
    })).rejects.toThrow("This Sagax server has no ssh client, so the remote shell cannot open. Install openssh-client on the server.");
    expect(captured.argv).toHaveLength(0);
  });
});
