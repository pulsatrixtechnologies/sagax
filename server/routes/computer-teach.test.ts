// Teach by demonstration on the bot's whole computer (parity R7, system 11):
// the person's clicks and keys while they hold control become screen steps;
// typed characters never reach the server.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { ComputerTeachRecordings } from "../computer-teach.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type { ControlState } from "./computer-input.ts";
import { createComputerTeachRoutes } from "./computer-teach.ts";
import { dispatchRoutes } from "./table.ts";

type Bot = { id: string };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

async function serve(options: { control?: ControlState; hasComputer?: boolean; mayDrive?: boolean; window?: string; windowFails?: boolean } = {}) {
  const state = { control: options.control ?? "held" as ControlState };
  const scripts: string[] = [];
  const recordings = new ComputerTeachRecordings();
  const routes = [createComputerTeachRoutes<Bot>({
    bot: (id) => (id === "scout" ? { id } : undefined),
    mayDrive: () => options.mayDrive ?? true,
    control: () => state.control,
    shell: () => options.hasComputer === false ? null : {
      kind: "vm", maxScript: 15_000,
      run: async (script) => {
        scripts.push(script);
        if (options.windowFails) throw new Error("boom");
        return { ok: true, stdout: `${options.window ?? "Invoices - LibreOffice Calc"}\n` };
      },
    },
    recordings,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: OWNER, json, readBody })) json(res, 404, { from: "inline" });
    } catch (error) { json(res, 500, { error: String(error) }); }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (body: unknown) => {
    const res = await fetch(`${base}/api/bots/scout/computer/teach`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { base, post, scripts, recordings, state };
}

describe("computer teach route", () => {
  it("is admin scope, like the rest of driving a bot's computer", () => {
    expect(requiredScope("POST", "/api/bots/scout/computer/teach")).toBe("admin");
  });

  it("records clicks with the window, keys, and typing without its characters", async () => {
    const { post, scripts } = await serve();
    expect((await post({ action: "start" })).body).toMatchObject({ recording: true });
    await post({ action: "event", event: { kind: "click", x: 0.25, y: 0.5 } });
    await post({ action: "event", event: { kind: "typing" } });
    await post({ action: "event", event: { kind: "typing" } });
    await post({ action: "event", event: { kind: "key", key: "Enter" } });
    const stopped = await post({ action: "stop" });
    expect(stopped.status).toBe(200);
    const steps = stopped.body.steps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["click", "type", "press"]);
    expect(steps[0]).toMatchObject({ screen: true, point: { x: 0.25, y: 0.5 }, window: "Invoices - LibreOffice Calc" });
    expect(steps[1]).toMatchObject({ screen: true, secret: true, window: "Invoices - LibreOffice Calc" });
    expect(steps[1]).not.toHaveProperty("text");
    expect(steps[2]).toMatchObject({ key: "Enter" });
    // one fixed, read-only command asks the focused window's title
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/^sleep 0\.2; xdotool getwindowfocus getwindowname/);
    // stopped once: the recording is gone
    expect((await post({ action: "stop" })).body).toMatchObject({ expired: true });
  });

  it("refuses characters, unknown keys and points off the screen", async () => {
    const { post } = await serve();
    await post({ action: "start" });
    expect((await post({ action: "event", event: { kind: "typing", text: "hunter2" } })).status).toBe(400);
    expect((await post({ action: "event", event: { kind: "key", key: "a" } })).status).toBe(400);
    expect((await post({ action: "event", event: { kind: "click", x: 2, y: 0 } })).status).toBe(400);
  });

  it("keeps a click when the window cannot be asked, and drops a title that reads as a secret", async () => {
    const failing = await serve({ windowFails: true });
    await failing.post({ action: "start" });
    await failing.post({ action: "event", event: { kind: "click", x: 0.1, y: 0.1 } });
    const steps = (await failing.post({ action: "stop" })).body.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(steps[0]).not.toHaveProperty("window");

    const secret = await serve({ window: `reset ${"aB3".repeat(15)}` });
    await secret.post({ action: "start" });
    await secret.post({ action: "event", event: { kind: "click", x: 0.1, y: 0.1 } });
    expect(((await secret.post({ action: "stop" })).body.steps as Array<Record<string, unknown>>)[0]).not.toHaveProperty("window");
  });

  it("starts only while the person holds control of a computer the bot has", async () => {
    expect((await (await serve({ control: "free" })).post({ action: "start" })).body).toMatchObject({ code: "no_control" });
    expect((await (await serve({ hasComputer: false })).post({ action: "start" })).body).toMatchObject({ code: "no_computer" });
    expect((await (await serve({ mayDrive: false })).post({ action: "start" })).status).toBe(403);
    const { post } = await serve();
    expect((await post({ action: "event", event: { kind: "typing" } })).body).toMatchObject({ code: "not_recording" });
  });

  it("discards on request, and says whether one runs", async () => {
    const { base, post } = await serve();
    await post({ action: "start" });
    expect(await (await fetch(`${base}/api/bots/scout/computer/teach`)).json()).toMatchObject({ recording: true });
    await post({ action: "discard" });
    expect(await (await fetch(`${base}/api/bots/scout/computer/teach`)).json()).toMatchObject({ recording: false });
  });
});

describe("computer teach limits (parity R7 review)", () => {
  it("asks the window title at most twice a second, and never once the recording is full", async () => {
    const { post, scripts, recordings } = await serve();
    await post({ action: "start" });
    await post({ action: "event", event: { kind: "click", x: 0.1, y: 0.1 } });
    await post({ action: "event", event: { kind: "click", x: 0.2, y: 0.2 } });
    expect(scripts).toHaveLength(1);
    const recorder = recordings.get("local-owner", "scout")!;
    while (!recorder.full) recorder.click({ x: 0.5, y: 0.5 }, "", Date.now() + 10_000);
    const before = scripts.length;
    const full = await post({ action: "event", event: { kind: "click", x: 0.3, y: 0.3 } });
    expect(full.body).toMatchObject({ full: true });
    expect(scripts).toHaveLength(before);
  });

  it("refuses a flood of events", async () => {
    const { post } = await serve();
    await post({ action: "start" });
    const answers = await Promise.all(Array.from({ length: 40 }, () => post({ action: "event", event: { kind: "key", key: "Tab" } })));
    expect(answers.some((answer) => answer.status === 429 && answer.body.code === "teach_rate")).toBe(true);
  });

  it("ends the recording when control goes back to the bot", async () => {
    const { base, post, state } = await serve();
    await post({ action: "start" });
    state.control = "free";
    expect(await (await fetch(`${base}/api/bots/scout/computer/teach`)).json()).toMatchObject({ recording: false, ended: "control_lost" });
    state.control = "held";
    await post({ action: "start" });
    state.control = "other";
    const lost = await post({ action: "event", event: { kind: "typing" } });
    expect(lost.status).toBe(409);
    expect(lost.body).toMatchObject({ code: "control_lost" });
    expect((await post({ action: "stop" })).body).toMatchObject({ expired: true });
  });
});

describe("ComputerTeachRecordings", () => {
  it("drops a recording left idle", () => {
    const recordings = new ComputerTeachRecordings();
    recordings.start("me", "scout", 0);
    expect(recordings.get("me", "scout", 1_000)).toBeDefined();
    expect(recordings.get("me", "scout", 31 * 60_000)).toBeUndefined();
  });
});
