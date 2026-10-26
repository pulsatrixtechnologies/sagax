import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResourceUsageView } from "../../shared/resource-usage.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createResourceSamplers, type ResourceSamplers, type SampleSource } from "../resource-usage/sampler.ts";
import type { ResolvedResourceTarget, ResourceTargetRefusal, ResourceTargetRequest } from "../resource-usage/targets.ts";
import { createResourceUsageInternalRoutes, createResourceUsageRoutes, resourceSummary } from "./resource-usage.ts";
import { PASS } from "./table.ts";

const linux = readFileSync(new URL("../resource-usage/fixtures/linux.txt", import.meta.url), "utf8");
const blocks = linux.split(/(?=@@begin)/);

/** Emits the two fixture blocks 20 ms apart, then waits to be stopped. */
const fixtureSource = (): SampleSource => ({
  start(_iterations, onText) {
    const timers = blocks.map((block, index) => setTimeout(() => onText(block), 20 * (index + 1)));
    return { stop: () => timers.forEach(clearTimeout) };
  },
});

let server: Server;
let base = "";
let samplers: ResourceSamplers;
let person: string | undefined = "pr_a";
let personText: string | undefined = "montre-moi la consommation de srv01";
let resolution: ResolvedResourceTarget | ResourceTargetRefusal;
let posted: Array<{ botId: string; threadId: string; view: ResourceUsageView }> = [];
let requested: ResourceTargetRequest[] = [];

beforeEach(async () => {
  samplers = createResourceSamplers();
  person = "pr_a";
  personText = "montre-moi la consommation de srv01";
  posted = [];
  requested = [];
  resolution = { view: { target: "host", label: "Serveur web", hostLabel: "srv01" }, open: async () => fixtureSource() };
  const routes = createResourceUsageRoutes({ samplers, principalId: () => person });
  const internal = createResourceUsageInternalRoutes({
    samplers,
    ownsThread: (botId) => botId === "b1",
    principal: () => person,
    personText: () => personText,
    resolve: async (request) => { requested.push(request); return resolution; },
    post: (input) => posted.push(input),
    firstFrameMs: 2_000,
  });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname.startsWith("/api/internal/")) {
      const botId = String(req.headers["x-bot"] ?? "b1");
      void internal({ res, path: url.pathname, method: req.method ?? "GET", json, capability: { botId, threadId: "t1", generation: "g" }, readBody: () => readBody(req) })
        .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
      return;
    }
    void routes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "local" } as unknown as RequestAuth, json, readBody })
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  samplers.close();
  await new Promise((resolve) => server.close(resolve));
});

const start = (body: unknown, bot = "b1") => fetch(`${base}/api/internal/resource-usage/start`, { method: "POST", headers: { "content-type": "application/json", "x-bot": bot }, body: JSON.stringify(body) });

describe("resource_usage (bot route)", () => {
  it("posts the card and answers with the first full sample", async () => {
    const res = await start({ target: "host", host: "srv01" });
    const body = await res.json() as { ok: boolean; summary: string; hostLabel: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.summary).toContain("srv01 (Ubuntu 24.04.1 LTS");
    expect(body.summary).toContain("CPU 25%");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.view).toMatchObject({ target: "host", label: "Serveur web", hostLabel: "srv01" });
    expect(posted[0]!.view.samplerId).toMatch(/^ru_[a-f0-9]{18}$/);
    expect(requested[0]).toEqual({ principalId: "pr_a", botId: "b1", threadId: "t1", target: "host", host: "srv01" });
  });

  it("shows nothing when the person did not ask (#876)", async () => {
    personText = "ferme le billet 1234";
    expect((await start({ target: "this_computer" })).status).toBe(409);
    // asking for a view of something else is not asking for usage
    personText = "montre-moi un graphique des billets ouverts";
    expect((await start({ target: "this_computer" })).status).toBe(409);
    expect(posted).toHaveLength(0);
  });

  it("refuses a turn with no direct message from a person (routine, webhook, continuation)", async () => {
    personText = undefined;
    const res = await start({ target: "host", host: "srv01" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("direct");
    expect(posted).toHaveLength(0);
  });

  it("refuses another bot's conversation, a turn with no person, a bad body and a refused target", async () => {
    expect((await start({ target: "host" }, "b2")).status).toBe(403);
    person = undefined;
    expect((await start({ target: "host" })).status).toBe(403);
    person = "pr_a";
    expect((await start({ target: "everything" })).status).toBe(400);
    expect((await start({ target: "host", address: "10.0.0.1" })).status).toBe(400);
    resolution = { code: "forbidden", error: "This person may not reach the organization's server hosts." };
    expect((await start({ target: "host", host: "srv01" })).status).toBe(403);
    expect(posted).toHaveLength(0);
  });
});

describe("resource usage (person routes)", () => {
  async function cardId() {
    await start({ target: "host", host: "srv01" });
    return posted[0]!.view.samplerId;
  }

  it("streams the card's frames to the person who asked", async () => {
    const id = await cardId();
    const abort = new AbortController();
    const res = await fetch(`${base}/api/resource-usage/${id}/live`, { signal: abort.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("\"kind\":\"snapshot\"")) text += new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    const snapshot = JSON.parse(/data: (.*)\n/.exec(text)![1]!).snapshot;
    expect(snapshot.host.hostname).toBe("srv01");
    expect(snapshot.frames.length).toBeGreaterThanOrEqual(1);
    // nothing but labels and numbers: no address, no key
    expect(text).not.toMatch(/key|address|tc_/i);
  });

  it("is someone else's card: 404, and an empty stream", async () => {
    const id = await cardId();
    person = "pr_b";
    expect((await fetch(`${base}/api/resource-usage/${id}`)).status).toBe(404);
    const live = await (await fetch(`${base}/api/resource-usage/${id}/live`)).text();
    expect(live).toContain("\"error\":\"gone\"");
    expect(live).not.toContain("srv01");
    expect((await fetch(`${base}/api/resource-usage/${id}/resume`, { method: "POST" })).status).toBe(404);
    person = undefined;
    expect((await fetch(`${base}/api/resource-usage/${id}`)).status).toBe(401);
  });

  it("pauses and resumes", async () => {
    const id = await cardId();
    const paused = await (await fetch(`${base}/api/resource-usage/${id}/pause`, { method: "POST" })).json() as { snapshot: { state: string; reason: string } };
    expect(paused.snapshot).toMatchObject({ state: "paused", reason: "person" });
    const resumed = await (await fetch(`${base}/api/resource-usage/${id}/resume`, { method: "POST" })).json() as { snapshot: { state: string } };
    expect(resumed.snapshot.state).toBe("starting");
    resolution = { code: "forbidden", error: "no" };
  });

  it("reports a Reprendre the target now refuses", async () => {
    let allowed = true;
    resolution = { view: { target: "host", label: "Serveur web", hostLabel: "srv01" }, open: async () => (allowed ? fixtureSource() : { error: "forbidden" }) };
    const id = await cardId();
    await fetch(`${base}/api/resource-usage/${id}/pause`, { method: "POST" });
    allowed = false;
    const res = await fetch(`${base}/api/resource-usage/${id}/resume`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

describe("resourceSummary", () => {
  it("says the card is coming when no sample arrived", () => {
    expect(resourceSummary({}, null, "POSTE-01")).toContain("first sample has not arrived");
  });
});
