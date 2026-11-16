// #3619: every turn of every bot on an organization server waited 2.5 to
// 3.9 s re-checking plugins that did not change: each plugin's folder read
// and hashed on the main thread, then one command per plugin in the
// person's environment. Here a counting environment and counting file reads.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { PluginFolderDigests } from "../sandbox/sandbox-plugin-digests.ts";
import { PLUGIN_PRESENCE_RECONFIRM_MS, PluginCopyFailures, SANDBOX_PLUGINS_DIR, SandboxPluginPresence, sandboxPluginPresence, syncPluginsToSandbox } from "../sandbox/sandbox-plugins.ts";
import { SANDBOX_STARTING_CODE, SANDBOX_STARTING_RETRY_MS, SandboxClusterWaker } from "../sandbox/sandbox-k8s-wake.ts";
import { readFolderSliced } from "../sandbox/sandbox-workspace-copy.ts";
import { UserSandboxManager } from "../sandbox/user-sandbox-manager.ts";
import type { SandboxdClient } from "../sandbox/user-sandbox-client.ts";
import { createSyncPluginFoldersForTurn } from "./syncPluginFoldersForTurn.ts";
import { createSyncPluginsForTurn, PLUGIN_COPY_TURN_WAIT_MS, pluginCopyForTurnStart } from "./syncPluginsForTurn.ts";

const root = mkdtempSync(join(tmpdir(), "sagax-plugin-turn-"));
afterAll(() => removeTempDir(root));

let folders = 0;
function plugin(name: string, files = 3): { name: string; dir: string; scope: string } {
  const dir = join(root, `${++folders}`, name);
  mkdirSync(join(dir, "skills"), { recursive: true });
  for (let index = 0; index < files; index += 1) writeFileSync(join(dir, "skills", `f${index}.md`), `${name} ${index}\n`);
  return { name, dir, scope: "org" };
}

/** The person's environment, answering the copy's commands from memory. */
function environment(delayMs = 0) {
  const markers = new Map<string, string>();
  const env = {
    markers,
    commands: 0,
    kinds: [] as string[],
    exec: async (_principal: string, input: { argv: string[]; env?: Record<string, string> }) => {
      env.commands += 1;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const script = input.argv[2] ?? "";
      const vars = input.env ?? {};
      if (script.includes('for d in "$@"')) {
        env.kinds.push("markers");
        return { exitCode: 0, stdout: input.argv.slice(4).map((dest) => `${dest}\t${markers.get(dest) ?? ""}\n`).join(""), stderr: "" };
      }
      if (vars.SAGAX_DIGEST) {
        env.kinds.push("unpack");
        markers.set(vars.SAGAX_DEST!, vars.SAGAX_DIGEST);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (Object.keys(vars).some((key) => key.startsWith("SAGAX_CONTENT_B64_"))) { env.kinds.push("part"); return { exitCode: 0, stdout: "", stderr: "" }; }
      if (vars.SAGAX_DEST) { env.kinds.push("marker"); return { exitCode: 0, stdout: markers.get(vars.SAGAX_DEST) ?? "", stderr: "" }; }
      env.kinds.push("other");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return env;
}

function countingDigests() {
  const counter = { reads: 0 };
  const digests = new PluginFolderDigests({ compute: async (dir) => { counter.reads += 1; return readFolderSliced(dir); } });
  return { counter, digests };
}

function turnCopy(options: {
  env: ReturnType<typeof environment>;
  plugins: ReturnType<typeof plugin>[];
  digests: PluginFolderDigests;
  presence?: SandboxPluginPresence;
}) {
  const bots: Record<string, { id: string; owner: string }> = {};
  const host = {
    userSandbox: { exec: options.env.exec, environmentOf: (person: string) => `${person}\ndocker` },
    store: { bot: (id: string) => (bots[id] ??= { id, owner: id.split(":")[0]! }) },
    scopedPluginFolders: () => options.plugins,
    samePerson: (a: string, b: string) => a === b,
    effectiveBotOwner: (bot: { owner: string }) => bot.owner,
    skillsLibraryEnabled: () => false,
    cfg: {},
    personalSkills: { enabled: () => [] },
    ...(options.presence ? { sandboxPluginPresence: options.presence } : {}),
    pluginFolderDigests: options.digests,
  };
  const sync = createSyncPluginFoldersForTurn(() => host);
  // a bot id `<person>:<name>`, owned by that person
  return (person: string, bot: string) => sync(person, `${person}:${bot}`);
}

describe("the turn's plugin copy (#3619)", () => {
  it("a second turn with unchanged plugins sends no command and reads no plugin file", async () => {
    const env = environment();
    const { counter, digests } = countingDigests();
    const plugins = Array.from({ length: 8 }, (_, index) => plugin(`p${index}`));
    const turn = turnCopy({ env, plugins, digests, presence: new SandboxPluginPresence() });
    await turn("alice", "bot-a");
    // the first turn: one command for all eight markers, then the copies
    expect(env.kinds.filter((kind) => kind === "markers")).toHaveLength(1);
    expect(env.kinds.filter((kind) => kind === "marker")).toHaveLength(0);
    expect(env.markers.size).toBe(8);
    expect(counter.reads).toBe(8);

    const commands = env.commands;
    await turn("alice", "bot-a");
    expect(env.commands).toBe(commands);
    expect(counter.reads).toBe(8);
  });

  it("a changed plugin is copied before the turn goes on, and only that one", async () => {
    const env = environment();
    const { counter, digests } = countingDigests();
    const plugins = ["one", "two", "three"].map((name) => plugin(name));
    const turn = turnCopy({ env, plugins, digests, presence: new SandboxPluginPresence() });
    await turn("alice", "bot-a");
    const before = env.kinds.length;
    const old = env.markers.get(`${SANDBOX_PLUGINS_DIR}/two`);
    writeFileSync(join(plugins[1]!.dir, "skills", "new.md"), "v2\n");
    await turn("alice", "bot-a");
    // copied and in place when the turn's await returns; its old content
    // was confirmed there, so not even its marker is read again
    expect(env.markers.get(`${SANDBOX_PLUGINS_DIR}/two`)).not.toBe(old);
    expect(env.kinds.slice(before)).toEqual(["part", "unpack"]);
    expect(counter.reads).toBe(4);
  });

  it("two bots of one person share what was confirmed; two people never do", async () => {
    const env = environment();
    const { digests } = countingDigests();
    const plugins = [plugin("flow")];
    const turn = turnCopy({ env, plugins, digests, presence: new SandboxPluginPresence() });
    await turn("alice", "bot-a");
    const commands = env.commands;
    await turn("alice", "bot-b");
    expect(env.commands).toBe(commands);
    // another person's environment is checked on its own (this fake one
    // answers every person from one disk, so the copy is found there)
    await turn("bob", "bot-c");
    expect(env.commands).toBe(commands + 1);
    expect(env.kinds.at(-1)).toBe("markers");
  });

  it("an environment that was reset is checked again at its next turn", async () => {
    const env = environment();
    const { digests } = countingDigests();
    const plugins = [plugin("flow")];
    const person = "reset-person";
    // the server's one memory, forgotten by the manager's reset
    const turn = turnCopy({ env, plugins, digests });
    await turn(person, "bot-a");
    const commands = env.commands;
    await turn(person, "bot-a");
    expect(env.commands).toBe(commands);

    const dir = mkdtempSync(join(root, "manager-"));
    const status = { key: "k", state: "running", lastUsedAt: null, workspaceBytes: null, overQuota: false, busy: 0, limits: { memoryMb: 1, cpus: 1, pids: 1, diskMb: 1, tmpMb: 1 } };
    const client = new Proxy({}, { get: () => async () => status }) as unknown as SandboxdClient;
    const manager = new UserSandboxManager({ client, instance: "default", stateFile: join(dir, "deletions.json") });
    await manager.reset(person);
    env.markers.clear();
    await turn(person, "bot-a");
    expect(env.kinds.slice(-3)).toEqual(["markers", "part", "unpack"]);
    expect(env.markers.size).toBe(1);
    // the same after an account deletion
    await turn(person, "bot-a");
    const after = env.commands;
    await manager.removeNow(person);
    await turn(person, "bot-a");
    expect(env.commands).toBe(after + 1);
    expect(sandboxPluginPresence.confirmed(`${person}\ndocker`, SANDBOX_PLUGINS_DIR, "flow")).toBeDefined();
  });

  it("a bot's command that names a plugin folder, or time, has the markers read again in one command", async () => {
    let now = 1_000_000;
    const presence = new SandboxPluginPresence(() => now);
    const env = environment();
    const { digests } = countingDigests();
    const plugins = [plugin("a"), plugin("b")];
    const turn = turnCopy({ env, plugins, digests, presence });
    await turn("alice", "bot-a");
    presence.noteCommand("alice", "ls /workspace/bots/x");
    let commands = env.commands;
    await turn("alice", "bot-a");
    expect(env.commands).toBe(commands);

    presence.noteCommand("alice", "rm -rf /workspace/sagax-plugins/a");
    commands = env.commands;
    await turn("alice", "bot-a");
    expect(env.commands).toBe(commands + 1);
    expect(env.kinds.at(-1)).toBe("markers");

    now += PLUGIN_PRESENCE_RECONFIRM_MS;
    commands = env.commands;
    await turn("alice", "bot-a");
    expect(env.commands).toBe(commands + 1);
    expect(env.kinds.at(-1)).toBe("markers");
  });

  it("a turn cancelled during the check leaves nothing remembered that was not confirmed", async () => {
    const presence = new SandboxPluginPresence();
    const { digests } = countingDigests();
    const env = environment();
    const plugins = [plugin("a"), plugin("b")];
    const options = { presence, environment: "carol\ndocker", digests };
    const cut = { exec: async () => { throw new Error("the turn was stopped"); } };
    const first = await syncPluginsToSandbox(plugins, cut, SANDBOX_PLUGINS_DIR, options);
    expect(first.skipped.map((row) => row.name)).toEqual(["a", "b"]);
    expect(presence.confirmed("carol\ndocker", SANDBOX_PLUGINS_DIR, "a")).toBeUndefined();
    // the environment forgotten while a check ran: what it read is not kept
    const reading = syncPluginsToSandbox(plugins, { exec: (input) => env.exec("carol", input) }, SANDBOX_PLUGINS_DIR, options);
    presence.forgetPerson("carol");
    await reading;
    expect(presence.confirmed("carol\ndocker", SANDBOX_PLUGINS_DIR, "a")).toBeUndefined();
    await syncPluginsToSandbox(plugins, { exec: (input) => env.exec("carol", input) }, SANDBOX_PLUGINS_DIR, options);
    expect(presence.confirmed("carol\ndocker", SANDBOX_PLUGINS_DIR, "a")).toBeDefined();
  });
});

// #4394: a turn waited 5 min 20 s on its plugin copy into an environment
// still starting (queueBy plugins:310873), and the copy failed anyway
// ("not copied to the server environment: ... still starting"). The whole
// path here, through the environment manager and its wake: the turn's
// bounded wait, the copy cut by the starting environment, and the copy
// waiting for it on its own and copying again once it is up, with no other
// call of the person in the environment.
describe("a plugin copy into an environment that takes minutes to start (#4394)", () => {
  it("starts the turn at once, and the plugins arrive once the environment is up", async () => {
    const env = environment();
    const { digests } = countingDigests();
    const plugins = [plugin("flow"), plugin("notes")];
    // the environment's own clock: each wait between two tries passes its
    // time at once (minutes here take milliseconds)
    let clock = 1_800_000_000_000;
    const sleep = async (ms: number) => { clock += ms; await new Promise((resolve) => setTimeout(resolve, 25)); };
    // the environment finishes starting on its own, while the copy waits for it
    const pod = { up: false, ensureTriesBeforeUp: 3 };
    const calls: string[] = [];
    const starting = () => Object.assign(new Error("starting"), { status: 503, code: SANDBOX_STARTING_CODE });
    const gate = async <T>(method: string, answer: () => T | Promise<T>): Promise<T> => {
      calls.push(method);
      if (method === "ensure" && calls.filter((call) => call === "ensure").length > pod.ensureTriesBeforeUp) pod.up = true;
      if (!pod.up) throw starting();
      return answer();
    };
    const running = { state: "running" };
    const kubernetes = new Proxy({}, {
      get: (_target, method: string) => method === "exec"
        ? (_key: string, input: { argv: string[]; env?: Record<string, string> }) => gate("exec", () => env.exec("alice", input))
        : () => gate(method, () => running),
    }) as unknown as SandboxdClient;
    const waker = new SandboxClusterWaker({
      settings: { url: new URL("https://wake.example.invalid/hook"), timeoutMs: 10 * 60_000 },
      health: async () => true,
      fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch,
      now: () => clock,
      sleep,
      log: () => {},
    });
    const dir = mkdtempSync(join(root, "starting-"));
    const manager = new UserSandboxManager({
      client: kubernetes,
      kubernetes,
      kubernetesWaker: waker,
      backendFor: () => "kubernetes",
      instance: "default",
      stateFile: join(dir, "deletions.json"),
      now: () => clock,
      sleep,
    });
    const failures = new PluginCopyFailures();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host: Record<string, any> = {
      userSandbox: manager,
      store: { bot: (id: string) => ({ id, owner: "alice" }) },
      scopedPluginFolders: () => plugins,
      samePerson: (a: string, b: string) => a === b,
      effectiveBotOwner: (bot: { owner: string }) => bot.owner,
      skillsLibraryEnabled: () => false,
      cfg: {},
      personalSkills: { enabled: () => [] },
      sandboxPluginPresence: new SandboxPluginPresence(),
      pluginFolderDigests: digests,
      pluginCopyFailures: failures,
      pluginSyncedGenerations: new Map(),
      pluginSyncInFlight: new Map(),
      pluginSyncSlots: new Map(),
      reportBackgroundError: () => undefined,
    };
    host.syncPluginFoldersForTurn = createSyncPluginFoldersForTurn(() => host);
    const syncPluginsForTurn = createSyncPluginsForTurn(() => host);
    try {
      const startedAt = Date.now();
      let copied = false;
      const copy = syncPluginsForTurn("alice", "turn-1", "alice:bot-a").then(() => { copied = true; });
      await pluginCopyForTurnStart(copy);
      // the turn goes on after its bounded wait, the environment still starting
      const waited = Date.now() - startedAt;
      expect(waited).toBeGreaterThanOrEqual(PLUGIN_COPY_TURN_WAIT_MS - 50);
      expect(waited).toBeLessThan(PLUGIN_COPY_TURN_WAIT_MS + 1_500);
      expect(copied).toBe(false);
      expect(env.markers.size).toBe(0);

      // the copy's command is cut by the start (5 min of tries), then the
      // copy itself waits for the environment: nothing else of this person
      // calls the environment
      await vi.waitFor(() => expect(manager.startingCuts("alice")).toBe(1), { timeout: 10_000 });
      expect(clock - 1_800_000_000_000).toBeGreaterThanOrEqual(SANDBOX_STARTING_RETRY_MS);
      expect(env.markers.size).toBe(0);

      // the environment finishes starting on its own: the plugins arrive,
      // without the failed copy's pause and without another turn
      await copy;
      expect(calls.filter((call) => call === "ensure")).toHaveLength(pod.ensureTriesBeforeUp + 1);
      expect([...env.markers.keys()].sort()).toEqual([`${SANDBOX_PLUGINS_DIR}/flow`, `${SANDBOX_PLUGINS_DIR}/notes`]);
      expect(host.pluginSyncInFlight.size).toBe(0);
    } finally {
      warn.mockRestore();
    }
  }, 20_000);
});
