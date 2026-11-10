// Session 8F2NZU (owner, 2026-10-22): a Mac shown as "Windows", every fact n/a
// and "The screen is not available". These cover what the card now does: it
// asks the OS and never assumes Windows, reads the computer again until it
// answers, says why when it cannot, and runs the bot's commands through the
// tunnel.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Message, Store } from "../store.ts";
import { TerminalResourceRegistry } from "../terminal-resources/registry.ts";
import { createRemoteSessionService, INVENTORY_RETRY_MS, type PublishRemoteSession } from "./remote-sessions.ts";
import {
  decodeWindowsScript,
  inventoryCommand,
  OS_PROBE_UNIX,
  OS_PROBE_WINDOWS,
  SCREEN_PERMISSION,
  screenshotPlan,
  snapshotCommand,
  stopCommand,
  transferDirCommand,
  type CommandResult,
  type RunCommand,
} from "./remote-session-probe.ts";
import type { RemoteSessionActionEvent } from "./remote-session-actions-audit.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "8f2a0c1d2e3f";
const PERSON = "person-1";
const BOT = "bot-1";
const THREAD = "thread-1";

const MAC_INVENTORY = [
  "hostname=MacBook de Lucie",
  "user=lucie",
  "model=MacBook Air",
  "serial=C02XYZ",
  "cpu=Apple M2",
  "os=macOS 15.1",
  "admin=false",
  "gui=true",
  "ramBytes=17179869184",
  "diskFreeKb=125829120",
  "diskTotalKb=499122176",
].join("\n");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });

function harness(answer: (command: string, argv: string[], signal?: AbortSignal) => CommandResult | Promise<CommandResult>, options: { tunnel?: boolean; ssh?: boolean; audit?: RemoteSessionActionEvent[]; tunnelWaitMaxMs?: number } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "sagax-inv-"));
  const home = mkdtempSync(path.join(tmpdir(), "sagax-inv-flow-"));
  roots.push(dataDir, home);
  const placeTunnel = () => {
    const dir = path.join(home, "tailcat", ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "address"), `${ADDRESS}\n`, { mode: 0o600 });
    writeFileSync(path.join(dir, "client.private.json"), "{}\n", { mode: 0o600 });
  };
  if (options.tunnel !== false) placeTunnel();
  const commands: string[] = [];
  const messages: Message[] = [];
  let clock = Date.parse("2026-10-22T15:00:00.000Z");
  const run: RunCommand = async (argv, _timeoutMs, extra) => {
    const command = argv.at(-1) ?? "";
    commands.push(command);
    return answer(command, argv, extra?.signal);
  };
  const store = {
    bot: () => ({ id: BOT, name: "Wren", color: "#336699" }),
    appendMessage: (_thread: string, partial: Partial<Message>) => {
      const message = { id: `m${messages.length}`, at: 1, role: "bot", kind: "text", ...partial } as Message;
      messages.push(message);
      return message;
    },
    patchMessage: (_thread: string, id: string, patch: Partial<Message>) => {
      const row = messages.find((message) => message.id === id);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
  } as unknown as Store;
  const service = createRemoteSessionService({
    dataDir,
    store,
    registry: new TerminalResourceRegistry(),
    sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
    access: () => ({ organization: true, admin: false, ownsBot: true }),
    owner: () => PERSON,
    run,
    home: () => home,
    now: () => clock,
    systemSsh: () => (options.ssh === false ? null : "/usr/bin/ssh"),
    ...(options.tunnelWaitMaxMs ? { tunnelWaitMaxMs: options.tunnelWaitMaxMs } : {}),
    ...(options.audit ? { actionsAudit: { write: (event: RemoteSessionActionEvent) => { options.audit!.push(event); } } as never } : {}),
  });
  return { service, commands, messages, placeTunnel, tick: (ms: number) => { clock += ms; } };
}

// The OS was not named: the support page detected it (remote_support_open).
const open: PublishRemoteSession = {
  id: ID,
  botId: BOT,
  threadId: THREAD,
  principalId: PERSON,
  code: "8F2NZU",
  elevated: false,
  endAt: "2026-10-22T17:00:00.000Z",
};

/** Let the background read finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OS detection through the tunnel", () => {
  it("reads a Mac as macOS and uses the macOS commands (8F2NZU)", async () => {
    const { service, commands, messages } = harness((command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin\n");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      return ok("");
    });
    const { view } = await service.publish(open);
    expect(view).toMatchObject({ os: "macos", inventory: "ready", hostname: "MacBook de Lucie", osName: "macOS 15.1", cpu: "Apple M2", model: "MacBook Air" });
    expect(view.osKnown).toBeUndefined();
    expect(commands).toEqual([OS_PROBE_UNIX, inventoryCommand("macos")]);
    // nothing Windows ever went to the Mac
    expect(commands.some((command) => command.includes("powershell"))).toBe(false);
    expect(messages[0]?.remoteSession).toMatchObject({ os: "macos", hostname: "MacBook de Lucie" });
  });

  it("never says Windows when the computer did not answer, and asks again", async () => {
    let answering = false;
    const { service, commands, tick } = harness((command) => {
      if (!answering) return { code: 1, stdout: "", stderr: "kex_exchange_identification: read: Connection reset" };
      if (command === OS_PROBE_UNIX) return ok("Darwin\n");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      return ok("");
    });
    const { view } = await service.publish(open);
    expect(view.osKnown).toBe(false);
    expect(view.inventory).toBe("os-unknown");
    // the old code took any failed uname for Windows and sent it PowerShell
    expect(commands).toEqual([OS_PROBE_UNIX, OS_PROBE_WINDOWS]);
    // no screenshot is attempted with a guessed OS
    expect(await service.screen(PERSON, BOT, ID)).toBeNull();
    expect(commands).toHaveLength(2);
    // inside the retry window nothing is asked again
    service.list(PERSON, BOT);
    await settle();
    expect(commands).toHaveLength(2);
    answering = true;
    tick(INVENTORY_RETRY_MS + 1);
    service.list(PERSON, BOT);
    await settle();
    await settle();
    const [row] = service.list(PERSON, BOT);
    expect(row).toMatchObject({ os: "macos", inventory: "ready", hostname: "MacBook de Lucie" });
  });

  it("calls a tunnel that fails no-answer, not an unknown OS", async () => {
    const { service } = harness(() => ({ code: 255, stdout: "", stderr: "" }));
    const { view } = await service.publish(open);
    expect(view.inventory).toBe("no-answer");
    expect(view.osKnown).toBe(false);
  });

  it("names Windows only when PowerShell itself answers", async () => {
    const { service, commands } = harness((command) => {
      if (command === OS_PROBE_UNIX) return { code: 1, stdout: "", stderr: "uname : The term 'uname' is not recognized" };
      if (command === OS_PROBE_WINDOWS) return ok("Win32NT\r\n");
      if ((decodeWindowsScript(command) ?? "").includes("Win32_ComputerSystem")) return ok("hostname=POSTE-02\ngui=False\nos=Windows Server 2022 Standard");
      return ok("");
    });
    const { view } = await service.publish(open);
    expect(view).toMatchObject({ os: "windows", inventory: "ready", hostname: "POSTE-02", headless: true });
    expect(commands[2]).toMatch(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    // a server without a desktop has no screen to show
    expect(await service.screen(PERSON, BOT, ID)).toBeNull();
    expect(commands).toHaveLength(3);
  });

  it("lets the technician correct the OS, and reads the computer again with it", async () => {
    const { service, commands } = harness((command) => {
      if (command === inventoryCommand("linux")) return ok("hostname=srv-01\ngui=false\nos=Debian GNU/Linux 13");
      return { code: 1, stdout: "", stderr: "" };
    });
    await service.publish(open);
    const corrected = await service.setOs(PERSON, BOT, ID, "linux");
    expect(corrected).toMatchObject({ os: "linux", inventory: "pending" });
    await settle();
    await settle();
    expect(service.list(PERSON, BOT)[0]).toMatchObject({ os: "linux", inventory: "ready", hostname: "srv-01", headless: true });
    expect(commands.at(-1)).toBe(inventoryCommand("linux"));
    expect(await service.setOs("person-2", BOT, ID, "macos")).toBeNull();
  });
});

describe("why a card has no facts", () => {
  it("says the tunnel is not on this server, then reads it once it arrives", async () => {
    const { service, placeTunnel, tick, commands } = harness((command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      return ok("");
    }, { tunnel: false });
    const { view, reachable } = await service.publish(open);
    expect(reachable).toBe(false);
    expect(view.inventory).toBe("no-tunnel");
    expect(commands).toEqual([]);
    placeTunnel();
    tick(INVENTORY_RETRY_MS + 1);
    service.list(PERSON, BOT);
    await settle();
    await settle();
    expect(service.list(PERSON, BOT)[0]).toMatchObject({ inventory: "ready", os: "macos", hostname: "MacBook de Lucie" });
  });

  it("says when this server has no ssh client for tailcat", async () => {
    const { service, commands } = harness(() => ok("Darwin"), { ssh: false });
    const { view } = await service.publish(open);
    expect(view.inventory).toBe("no-client");
    expect(commands).toEqual([]);
    expect(await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, command: "uptime" })).toEqual({ error: expect.stringContaining("no ssh client") });
  });

  it("says Screen Recording is not allowed when macOS refuses the screenshot", async () => {
    const { service, messages } = harness((command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      if (command === screenshotPlan("macos").command) return { code: 3, stdout: SCREEN_PERMISSION, stderr: "" };
      return ok("");
    });
    await service.publish(open);
    expect(await service.screen(PERSON, BOT, ID)).toBeNull();
    expect(service.list(PERSON, BOT)[0]?.screenDenied).toBe(true);
    expect(messages[0]?.remoteSession?.screenDenied).toBe(true);
  });
});

describe("commands for the bot", () => {
  it("runs one command through the tunnel and gives back exit code and output, never the address", async () => {
    const { service, commands } = harness((command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      if (command === "uptime") return ok("10:02  up 3 days, 2 users, load averages: 1.20 1.10 1.00\n");
      if (command === "ls /nope") return { code: 1, stdout: "", stderr: "ls: /nope: No such file or directory\n" };
      if (command === "yes") return ok("y\n".repeat(64 * 1024));
      return ok("");
    });
    await service.publish(open);
    const ran = await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, command: "uptime" });
    expect(ran).toMatchObject({ host: "MacBook de Lucie", os: "macos", exitCode: 0, timedOut: false });
    expect("stdout" in ran && ran.stdout).toContain("load averages");
    expect(JSON.stringify(ran)).not.toContain(ADDRESS);
    expect(await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, command: "ls /nope" })).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("No such file") });
    const big = await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, command: "yes" });
    expect("stdout" in big && big.stdout.length).toBeLessThan(64 * 1024 + 40);
    // by code, and never someone else's session
    expect(await service.exec({ principalId: PERSON, botId: BOT, threadId: "other", id: "8F2-NZU", command: "uptime" })).toMatchObject({ exitCode: 0 });
    expect(await service.exec({ principalId: "person-2", botId: BOT, threadId: THREAD, command: "uptime" })).toEqual({ error: expect.any(String) });
    expect(commands.filter((command) => command === "uptime")).toHaveLength(2);
  });

  it("audits a command under the bot that asked for it, beside the session's own bot (#3393)", async () => {
    const audit: RemoteSessionActionEvent[] = [];
    const { service } = harness((command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      return ok("done\n");
    }, { audit });
    await service.publish(open);
    await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "uptime", actor: "bot-ember" });
    await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "whoami" });
    const execs = audit.filter((event) => event.kind === "exec");
    expect(execs.map((event) => [event.command, event.botId])).toEqual([["uptime", "bot-ember"], ["whoami", BOT]]);
  });

  it("runs the commands of several bots on one session one after the other, so none resets another's tunnel (#3430)", async () => {
    // Every tailcat process is its own WireGuard endpoint with the session's
    // client key. A second one with the same key started while the first
    // still runs makes the host drop the first one's connection: ssh 255.
    const live = new Map<string, number>();
    let most = 0;
    const { service, commands } = harness(async (command, argv) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      const keyPath = argv[argv.indexOf("--key") + 1] ?? "";
      const start = (live.get(keyPath) ?? 0) + 1;
      live.set(keyPath, start);
      most = Math.max(most, start);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const reset = (live.get(keyPath) ?? 0) > 1;
      live.set(keyPath, (live.get(keyPath) ?? 1) - 1);
      return reset ? { code: 255, stdout: "", stderr: "" } : ok(`${command} done\n`);
    });
    await service.publish(open);
    const bots = ["bot-1", "bot-ember", "bot-server", "bot-core"];
    const results = await Promise.all(bots.map((actor, index) =>
      service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: `echo ${index}`, actor })));
    expect(results.map((result) => ("stdout" in result ? result.stdout : result.error))).toEqual(bots.map((_, index) => `echo ${index} done\n`));
    expect(most).toBe(1);
    // each command went out once
    for (const index of bots.keys()) expect(commands.filter((command) => command === `echo ${index}`)).toHaveLength(1);
  });

  // A build that runs until it is stopped (the session closes) or 300 ms pass.
  const holding = (signal?: AbortSignal) => new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => resolve(ok("built\n")), 300);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve({ code: 255, stdout: "", stderr: "" }); }, { once: true });
  });

  it("closing the session refuses the commands still waiting (never sent) and stops the running one at once (#3430)", async () => {
    const { service, commands } = harness(async (command, _argv, signal) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      if (command === "make build") return holding(signal);
      return ok(`${command} done\n`);
    });
    await service.publish(open);
    const build = service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "make build", actor: "bot-a" });
    const waitingB = service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "echo b", actor: "bot-b" });
    const waitingC = service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "echo c", actor: "bot-c" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    await service.close(PERSON, BOT, ID);
    expect(Date.now() - started).toBeLessThan(250);
    for (const waiting of [await waitingB, await waitingC]) {
      expect(waiting).toEqual({ error: expect.stringMatching(/^No remote session is connected any more: .*not sent/) });
    }
    expect(commands).not.toContain("echo b");
    expect(commands).not.toContain("echo c");
    // the running build was cut: it may have run, never a success
    expect(await build).toEqual({ error: expect.stringContaining("did not answer") });
    // the session's stop command still went out, after the build stopped
    expect(commands.at(-1)).toBe(stopCommand(ID, "macos"));
  });

  it("a command whose session passed its end time while it waited is never sent (#3430)", async () => {
    let clockTick: (ms: number) => void = () => undefined;
    const { service, commands, tick } = harness(async (command, _argv, signal) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      if (command === "make build") {
        const out = await holding(signal);
        clockTick(3 * 60 * 60_000);
        return out;
      }
      return ok("late\n");
    });
    clockTick = tick;
    await service.publish(open);
    const build = service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "make build" });
    const late = service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "echo late", actor: "bot-b" });
    expect(await build).toMatchObject({ exitCode: 0 });
    expect(await late).toEqual({ error: expect.stringMatching(/^No remote session is connected any more/) });
    expect(commands).not.toContain("echo late");
  });

  it("a command that waits past the queue limit is refused as busy and never sent (#3430)", async () => {
    const { service, commands } = harness(async (command, _argv, signal) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      if (command === "make build") return holding(signal);
      return ok("quick\n");
    }, { tunnelWaitMaxMs: 50 });
    await service.publish(open);
    const build = service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "make build" });
    const quick = await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "echo quick", actor: "bot-b" });
    expect(quick).toEqual({ error: expect.stringMatching(/busy.*not sent/) });
    expect(commands).not.toContain("echo quick");
    expect(await build).toMatchObject({ exitCode: 0, stdout: "built\n" });
    // the tunnel is free again: the next command runs
    expect(await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "echo quick" })).toMatchObject({ exitCode: 0 });
  });

  it("keeps the queue moving after a command that failed or threw (#3430)", async () => {
    let calls = 0;
    const { service } = harness(async (command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      calls += 1;
      if (command === "boom") throw new Error("spawn failed");
      return ok("fine\n");
    });
    await service.publish(open);
    const [first, second] = await Promise.allSettled([
      service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "boom" }),
      service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, id: ID, command: "uptime" }),
    ]);
    expect(first.status).toBe("rejected");
    expect(second).toMatchObject({ status: "fulfilled", value: { exitCode: 0, stdout: "fine\n" } });
    expect(calls).toBe(2);
  });

  it("runs nothing on a computer whose OS is still not known, and says so", async () => {
    const { service, commands } = harness(() => ({ code: 1, stdout: "", stderr: "" }));
    await service.publish(open);
    const before = commands.length;
    const ran = await service.exec({ principalId: PERSON, botId: BOT, threadId: THREAD, command: "dir" });
    expect(ran).toEqual({ error: expect.stringContaining("not known") });
    expect(commands.slice(before)).not.toContain("dir");
    expect(service.osFor({ principalId: PERSON, botId: BOT, threadId: THREAD })).toEqual({ os: "windows", known: false });
  });

  it("takes a whole snapshot in one call with the session's own OS commands", async () => {
    const { service, commands } = harness((command) => {
      if (command === OS_PROBE_UNIX) return ok("Darwin");
      if (command === inventoryCommand("macos")) return ok(MAC_INVENTORY);
      if (command === snapshotCommand("macos")) return ok("== os\nProductName: macOS\n== top cpu\n  PID  %CPU\n");
      return ok("");
    });
    await service.publish(open);
    const snap = await service.snapshot({ principalId: PERSON, botId: BOT, threadId: THREAD });
    expect(snap).toMatchObject({ os: "macos", exitCode: 0, stdout: expect.stringContaining("== top cpu") });
    expect(commands.at(-1)).toBe(snapshotCommand("macos"));
  });
});

describe("Windows commands survive the PowerShell session shell", () => {
  it("carries every Windows script encoded, with no $ an outer PowerShell could expand", () => {
    for (const command of [inventoryCommand("windows"), screenshotPlan("windows").command, transferDirCommand("windows"), stopCommand(ID, "windows"), snapshotCommand("windows")]) {
      expect(command).toMatch(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
      expect(command).not.toContain("$");
      expect(decodeWindowsScript(command)).toContain("$");
    }
    expect(decodeWindowsScript(inventoryCommand("windows"))).toContain("Win32_ComputerSystem");
    expect(stopCommand(ID, "macos")).toBe(`[ -d /tmp/px-assist-${ID} ] && : > /tmp/px-assist-${ID}/stop`);
  });
});

describe("the tailcat child environment", () => {
  it("keeps the server's ssh agent away from the client's computer", async () => {
    const { tailcatEnv } = await import("./remote-session-probe.ts");
    const env = tailcatEnv({ PATH: "/usr/bin", HOME: "/home/app", SSH_AUTH_SOCK: "/tmp/agent.sock", SSH_AGENT_PID: "42" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/app" });
  });
});
