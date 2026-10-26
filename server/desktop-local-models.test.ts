import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { desktopModelApiKey, withDesktopModelPerson } from "./desktop-model-grant.ts";
import { DESKTOP_MODEL_NO_ANTHROPIC, DESKTOP_MODEL_REFUSED, DESKTOP_MODEL_TOO_LARGE, DESKTOP_MODEL_UNAVAILABLE, DESKTOP_MODEL_WRONG_ENGINE, DesktopLocalModels, injectHostId } from "./desktop-local-models.ts";
import type { DesktopBridgeOperation } from "./desktop-bridge.ts";
import {
  applyClaudeInject,
  applyOpenAIInject,
  clearDesktopInjectHosts,
  decodeInjectId,
  encodeInjectId,
  localHost,
  mergeLocalInject,
  setDesktopInjectModels,
  upsertDesktopInjectHost,
} from "./drivers/local-inject.ts";

const dirs: string[] = [];
const services: DesktopLocalModels[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  clearDesktopInjectHosts();
  setDesktopInjectModels(() => []);
});

function grant(person: string): string {
  let token = "";
  withDesktopModelPerson(person, () => { token = desktopModelApiKey(); });
  return token;
}

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-desktop-models-"));
  dirs.push(dir);
  const calls: { person: string | null; operation: DesktopBridgeOperation }[] = [];
  const online = new Set<string>();
  const bridge = {
    calls,
    online,
    connected(person: string | null) { return Boolean(person && online.has(person)); },
    current(person: string | null) { return person && online.has(person) ? { name: "Mac" } : null; },
    async request(person: string | null, operation: DesktopBridgeOperation) {
      calls.push({ person, operation });
      return { localModel: { status: 200, contentType: "application/json", body: "{\"ok\":true}" } };
    },
  };
  const service = new DesktopLocalModels(dir, bridge);
  services.push(service);
  await service.listen();
  return { service, bridge };
}

async function post(port: number, hostId: string, token: string, path = "/chat/completions") {
  return fetch(`http://127.0.0.1:${port}/d/${hostId}/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "qwen3" }),
  });
}

describe("desktop local models", () => {
  it("lets the person's own bots use their computer by default and keeps sharing off", async () => {
    const { service, bridge } = await start();
    const view = service.read("pr_owner");
    expect(view.expose).toBe(true);
    expect(view.share).toBe(false);
    // Never toggled: the desktop's first publish is enough for the owner only.
    bridge.online.add("pr_owner");
    expect(service.publish("pr_owner", { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] }).ok).toBe(true);
    expect(service.modelsFor("pr_owner").map((row) => row.label)).toEqual(["DwarfStar: qwen3"]);
    expect(service.modelsFor("pr_other")).toEqual([]);
    expect(service.modelsFor(null)).toEqual([]);
    expect(view.endpoints.map((row) => row.id)).toEqual(expect.arrayContaining(["desk8002", "desk9337", "desk9338", "desk11434"]));
    const refused = service.update("pr_owner", { endpoints: [{ label: "nope", baseUrl: "http://10.1.2.3:8002/v1" }] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).not.toContain("10.1.2.3");
  });

  it("never accepts or stores a per-endpoint API key: the key stays desktop-side only", async () => {
    const { service, bridge } = await start();
    bridge.online.add("pr_owner");
    // The API key lives on the owner's desktop (electron/local-model-keys.mjs).
    // The organization store refuses any `key` field, on the settings body...
    expect(service.update("pr_owner", { expose: true, key: "sk-ornith" } as never).ok).toBe(false);
    // ...on an endpoint...
    expect(service.update("pr_owner", { endpoints: [{ id: "desk8000", label: "oMLX", baseUrl: "http://127.0.0.1:8000/v1", key: "sk-ornith" }] } as never).ok).toBe(false);
    // ...and on a published catalog row.
    expect(service.publish("pr_owner", { endpoints: [{ id: "desk8000", label: "oMLX", models: ["ornith"], key: "sk-ornith" }] } as never).ok).toBe(false);
    // A clean publish still works, and no key is anywhere in the stored view.
    expect(service.publish("pr_owner", { endpoints: [{ id: "desk8000", label: "oMLX", models: ["ornith"] }] }).ok).toBe(true);
    expect(JSON.stringify(service.read("pr_owner"))).not.toContain("sk-ornith");
  });

  it("rejects another person when sharing is off and allows them when sharing is on", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    const other = "pr_other";
    bridge.online.add(owner);
    expect(service.update(owner, { expose: true, share: false }).ok).toBe(true);
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"], baseUrl: "http://127.0.0.1:8002/v1" }] }).ok).toBe(false);
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] }).ok).toBe(true);
    const hostId = injectHostId(owner, "desk8002");
    const denied = await post(service.portNumber(), hostId, grant(other));
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe(DESKTOP_MODEL_UNAVAILABLE);
    expect(bridge.calls).toHaveLength(0);
    expect(service.modelsFor(other)).toEqual([]);
    const ownerCall = await post(service.portNumber(), hostId, grant(owner));
    expect(ownerCall.status).toBe(200);
    expect(service.update(owner, { share: true }).ok).toBe(true);
    bridge.calls.length = 0;
    const allowed = await post(service.portNumber(), hostId, grant(other));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true });
    expect(bridge.calls[0]?.person).toBe(owner);
    expect(bridge.calls[0]?.operation).toMatchObject({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/chat/completions" });
    expect(bridge.calls[0]?.operation.url).toBeUndefined();
    expect(JSON.stringify(bridge.calls[0]?.operation)).not.toContain("8002/v1");
    expect(service.modelsFor(other)[0]?.label).toBe("DwarfStar (Mac): qwen3");
    expect(injectHostId(owner, "desk8002")).not.toBe(injectHostId(other, "desk8002"));
  });

  it("round-trips a desktop inject id onto the server proxy, not the Mac address", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    bridge.online.add(owner);
    service.update(owner, { expose: true });
    service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] });
    const hostId = injectHostId(owner, "desk8002");
    const modelId = encodeInjectId(hostId, "qwen3");
    expect(decodeInjectId(modelId)).toEqual({ host: hostId, model: "qwen3" });
    const host = localHost(hostId);
    expect(host).toBeTruthy();
    expect(host!.baseUrl).toBe(`http://127.0.0.1:${service.portNumber()}/d/${hostId}/v1`);
    expect(host!.baseUrl).not.toBe("http://127.0.0.1:8002/v1");
    const env: Record<string, string | undefined> = {};
    expect(applyOpenAIInject(env, modelId)).toEqual({ model: "qwen3", injected: true });
    expect(env.OPENAI_BASE_URL).toBe(host!.baseUrl);
    expect(() => upsertDesktopInjectHost({ id: "deskabc123", label: "x", baseUrl: "http://10.0.0.2:9/d/deskabc123/v1" })).toThrow(/refused/);
    expect(() => upsertDesktopInjectHost({ id: "deskabc123", label: "x", baseUrl: "http://127.0.0.1:8002/v1" })).toThrow(/refused/);
    setDesktopInjectModels(() => service.modelsFor(owner));
    const catalog = await mergeLocalInject({ default: "cloud", options: [{ id: "cloud", label: "Cloud" }] });
    expect(catalog.options.some((row) => row.id === modelId && row.custom === true)).toBe(true);
    // /messages is refused for an endpoint the desktop did not publish as speaking the Anthropic protocol.
    const messages = await post(service.portNumber(), hostId, grant(owner), "/messages");
    expect(messages.status).toBe(404);
    expect(await messages.text()).toBe(DESKTOP_MODEL_NO_ANTHROPIC);
    expect(bridge.calls).toHaveLength(0);
    // Other paths and a non-desk host id stay refused.
    expect((await post(service.portNumber(), hostId, grant(owner), "/embeddings")).status).toBe(404);
    expect((await post(service.portNumber(), "deskzzzzzz", grant(owner), "/messages")).status).toBe(403);
    expect(bridge.calls).toHaveLength(0);
  });

  it("forwards /v1/messages for an endpoint the desktop probed, to the owner's bots only", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    const other = "pr_other";
    bridge.online.add(owner);
    service.publish(owner, { endpoints: [
      { id: "desk8002", label: "DwarfStar", models: ["qwen3"], anthropic: true },
      { id: "desk9337", label: "llama-server", models: ["gguf"] },
    ] });
    const hostId = injectHostId(owner, "desk8002");
    const ok = await post(service.portNumber(), hostId, grant(owner), "/messages");
    expect(ok.status).toBe(200);
    expect(bridge.calls[0]?.person).toBe(owner);
    expect(bridge.calls[0]?.operation).toMatchObject({ action: "local_model", endpoint: "desk8002", http_method: "POST", http_path: "/messages", timeout_seconds: 240 });
    expect(bridge.calls[0]?.operation.url).toBeUndefined();
    expect(JSON.stringify(bridge.calls[0]?.operation)).not.toContain("8002/v1");
    // A probed-no endpoint on the same computer is refused without reaching the desktop.
    bridge.calls.length = 0;
    const no = await post(service.portNumber(), injectHostId(owner, "desk9337"), grant(owner), "/messages");
    expect(no.status).toBe(404);
    // GET is not a way in.
    const get = await fetch(`http://127.0.0.1:${service.portNumber()}/d/${hostId}/v1/messages`, { headers: { authorization: `Bearer ${grant(owner)}` } });
    expect(get.status).toBe(405);
    // Another person is refused while sharing is off (the default), allowed once the owner turns it on.
    const denied = await post(service.portNumber(), hostId, grant(other), "/messages");
    expect(denied.status).toBe(403);
    expect(bridge.calls).toHaveLength(0);
    // The body cap still applies.
    const big = await fetch(`http://127.0.0.1:${service.portNumber()}/d/${hostId}/v1/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${grant(owner)}`, "content-type": "application/json" },
      body: "x".repeat(1_000_001),
    }).catch(() => null);
    if (big) {
      expect(big.status).toBe(413);
      expect(await big.text()).toBe(DESKTOP_MODEL_TOO_LARGE);
    }
    expect(bridge.calls).toHaveLength(0);
    // A re-publish that no longer reports the protocol closes the path again.
    service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"], anthropic: false }] });
    expect((await post(service.portNumber(), hostId, grant(owner), "/messages")).status).toBe(404);
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"], anthropic: "yes" }] }).ok).toBe(false);
  });

  it("runs Claude Code on an organization server against the person's local model", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    bridge.online.add(owner);
    service.publish(owner, { endpoints: [
      { id: "desk8002", label: "DwarfStar", models: ["qwen3"], anthropic: true },
      { id: "desk9337", label: "llama-server", models: ["gguf"] },
    ] });
    const hostId = injectHostId(owner, "desk8002");
    const modelId = encodeInjectId(hostId, "qwen3");
    // The picker row says the server speaks the protocol; the other does not.
    const [instance] = service.overlay([{ models: { default: "cloud", options: [{ id: "cloud", label: "Cloud" }] as { id: string; label: string; custom?: boolean; local?: boolean; anthropic?: boolean }[] } }], owner);
    const rows = instance!.models.options.filter((option) => option.local);
    expect(rows.find((row) => row.id === modelId)?.anthropic).toBe(true);
    expect(rows.find((row) => row.id === encodeInjectId(injectHostId(owner, "desk9337"), "gguf"))?.anthropic).toBeUndefined();
    // The turn guard passes the probed row on Claude Code and refuses the other with the protocol line.
    expect(() => service.assertAvailable(owner, modelId, "claudeAgent")).not.toThrow();
    expect(() => service.assertAvailable(owner, encodeInjectId(injectHostId(owner, "desk9337"), "gguf"), "claudeAgent")).toThrow(DESKTOP_MODEL_NO_ANTHROPIC);
    expect(() => service.assertAvailable(owner, modelId, "geminiAgent")).toThrow(DESKTOP_MODEL_WRONG_ENGINE);
    expect(() => service.assertAvailable("pr_other", modelId, "claudeAgent")).toThrow(DESKTOP_MODEL_UNAVAILABLE);
    // The driver points Claude at this server's loopback proxy with the desktop grant, never the Mac address or a real key.
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: "sk-ant-real" };
    withDesktopModelPerson(owner, () => {
      expect(applyClaudeInject(env, modelId)).toEqual({ model: "qwen3", injected: true });
    });
    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:${service.portNumber()}/d/${hostId}`);
    expect(env.ANTHROPIC_MODEL).toBe("qwen3");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(env.ANTHROPIC_API_KEY);
    expect(env.ANTHROPIC_API_KEY).not.toBe("sk-ant-real");
    expect(env.ANTHROPIC_AUTH_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(env)).not.toContain("127.0.0.1:8002");
    // What Claude Code really sends: the Anthropic SDK beta client posts to
    // base + /v1/messages?beta=true (Claude Code 2.1.x, seen on the wire).
    const body = JSON.stringify({ model: "qwen3", max_tokens: 1, stream: true, system: "s".repeat(80_000), tools: [{ name: "Bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] });
    const sent = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/messages?beta=true`, {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "anthropic-beta": "claude-code-20250219", "content-type": "application/json" },
      body,
    });
    expect(sent.status).toBe(200);
    expect(bridge.calls.at(-1)?.operation).toMatchObject({ http_path: "/messages", endpoint: "desk8002", json: body });
    // The query is dropped, never forwarded to the desktop.
    expect(JSON.stringify(bridge.calls.at(-1)?.operation)).not.toContain("beta=true");
    const before = bridge.calls.length;
    // Only that exact query, only on /messages.
    for (const path of ["/messages?beta=false", "/messages?beta=true&x=1", "/messages?url=http://10.0.0.8", "/chat/completions?beta=true", "/models?beta=true"]) {
      const refused = await fetch(`${env.ANTHROPIC_BASE_URL}/v1${path}`, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "content-type": "application/json" },
        body: "{}",
      });
      expect(refused.status, path).toBe(400);
      // Claude Code prints the body as is: it says what to do, not a bare refusal.
      expect(await refused.text(), path).toBe(DESKTOP_MODEL_REFUSED);
    }
    // A path the proxy does not carry is "not here" whatever its query, so the
    // SDK's side calls (count_tokens?beta=true) fall back instead of failing the turn.
    for (const path of ["/messages/count_tokens?beta=true", "/models/qwen3?beta=true"]) {
      const missing = await fetch(`${env.ANTHROPIC_BASE_URL}/v1${path}`, {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "content-type": "application/json" },
        body: "{}",
      });
      expect(missing.status, path).toBe(404);
    }
    expect(bridge.calls.length).toBe(before);
  });

  it("labels the DwarfStar catalog by name and keeps its context window", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    bridge.online.add(owner);
    const models = ["qwen3.8-flash-next", "qwen3.8-flash-next-chat", "qwen3.8-flash-next-reasoner", "solo-name"];
    const details = [
      ...models.slice(0, 3).map((id) => ({ id, name: "Qwen3.8 Flash Next", contextLength: 262144 })),
      { id: "solo-name", name: "Solo Model" },
    ];
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models, details }] }).ok).toBe(true);
    const rows = service.modelsFor(owner);
    expect(rows.map((row) => row.label)).toEqual([
      "DwarfStar: Qwen3.8 Flash Next",
      "DwarfStar: Qwen3.8 Flash Next Chat",
      "DwarfStar: Qwen3.8 Flash Next Reasoner",
      "DwarfStar: Solo Model",
    ]);
    expect(rows[0]?.contextWindow).toBe(262144);
    expect(rows[3]?.contextWindow).toBeUndefined();
    const [instance] = service.overlay([{ models: { default: "cloud", options: [{ id: "cloud", label: "Cloud" }] as { id: string; label: string; custom?: boolean; local?: boolean }[] } }], owner);
    const local = instance!.models.options.filter((option) => option.local);
    expect(local).toHaveLength(4);
    expect(local.every((option) => option.custom === true)).toBe(true);
    // An unknown detail field refuses the catalog; a plain id list (an older desktop) still works.
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models, details: [{ id: models[0], url: "http://127.0.0.1:8002/v1" }] }] }).ok).toBe(false);
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] }).ok).toBe(true);
    expect(service.modelsFor(owner).map((row) => row.label)).toEqual(["DwarfStar: qwen3"]);
  });

  it("refuses a desktop model on an engine that cannot reach it, before the turn starts", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    bridge.online.add(owner);
    service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] });
    const modelId = encodeInjectId(injectHostId(owner, "desk8002"), "qwen3");
    // This server was not probed as speaking the Anthropic protocol.
    expect(() => service.assertAvailable(owner, modelId, "claudeAgent")).toThrow(DESKTOP_MODEL_NO_ANTHROPIC);
    expect(() => service.assertAvailable(owner, modelId, "geminiAgent")).toThrow(DESKTOP_MODEL_WRONG_ENGINE);
    for (const kind of ["piAgent", "codex", "grokAgent", "kimiAgent", "opencodeGo"]) {
      expect(() => service.assertAvailable(owner, modelId, kind)).not.toThrow();
    }
    expect(() => service.assertAvailable(owner, "claude-sonnet-5", "claudeAgent")).not.toThrow();
  });

  it("surfaces per-endpoint probe status for the panel, without adding a non-answering server to the picker", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    bridge.online.add(owner);
    expect(service.update(owner, { expose: true, endpoints: [
      { id: "desk8002", label: "DwarfStar", baseUrl: "http://127.0.0.1:8002/v1" },
      { id: "desk8000", label: "oMLX", baseUrl: "http://127.0.0.1:8000/v1" },
      { id: "desk9337", label: "llama-server", baseUrl: "http://127.0.0.1:9337/v1" },
    ] }).ok).toBe(true);
    expect(service.publish(owner, {
      endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }],
      probes: [
        { id: "desk8002", status: "answered" },
        { id: "desk8000", status: "needs_key" },
        { id: "desk9337", status: "offline" },
      ],
    }).ok).toBe(true);
    const view = service.read(owner);
    expect(view.probes).toEqual([
      { id: "desk8002", status: "answered" },
      { id: "desk8000", status: "needs_key" },
      { id: "desk9337", status: "offline" },
    ]);
    // Only the server that answered with models reaches the picker.
    expect(service.modelsFor(owner).map((row) => row.label)).toEqual(["DwarfStar: qwen3"]);
    // An unknown status, or an id for an endpoint the person removed, is refused or dropped.
    expect(service.publish(owner, { endpoints: [], probes: [{ id: "desk8002", status: "maybe" }] }).ok).toBe(false);
    expect(service.publish(owner, { endpoints: [], probes: [{ id: "deskgone", status: "offline" }] }).ok).toBe(true);
    expect(service.read(owner).probes).toEqual([]);
    // An older desktop that publishes no probes leaves the picker row standing.
    expect(service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] }).ok).toBe(true);
    expect(service.modelsFor(owner).map((row) => row.label)).toEqual(["DwarfStar: qwen3"]);
    // Turning expose off clears the probes with the catalog.
    service.update(owner, { expose: false });
    expect(service.read(owner).probes).toEqual([]);
  });

  it("hides an offline desktop and fails the turn as unavailable", async () => {
    const { service, bridge } = await start();
    const owner = "pr_owner";
    bridge.online.add(owner);
    service.update(owner, { expose: true, share: true });
    service.publish(owner, { endpoints: [{ id: "desk8002", label: "DwarfStar", models: ["qwen3"] }] });
    const hostId = injectHostId(owner, "desk8002");
    const modelId = encodeInjectId(hostId, "qwen3");
    bridge.online.delete(owner);
    expect(service.modelsFor(owner)).toEqual([]);
    expect(service.modelsFor("pr_other")).toEqual([]);
    expect(localHost(hostId)?.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(() => service.assertAvailable(owner, modelId)).toThrow(DESKTOP_MODEL_UNAVAILABLE);
    const response = await post(service.portNumber(), hostId, grant(owner));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(DESKTOP_MODEL_UNAVAILABLE);
    expect(bridge.calls).toHaveLength(0);
    service.update(owner, { expose: false });
    expect(localHost(hostId)).toBeUndefined();
    expect(() => service.assertAvailable(owner, modelId)).toThrow(DESKTOP_MODEL_UNAVAILABLE);
    expect(() => service.assertAvailable(owner, "claude-sonnet-5")).not.toThrow();
  });
});
