import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import type { ProviderAccountsView } from "../../shared/provider-accounts.ts";

describe("provider accounts on the real isolated server", () => {
  it("runs a personal Anthropic endpoint on its own key, then without auth, and removes only that endpoint", async () => {
    const sent: Array<{ key: string | undefined; body: { model: string } }> = [];
    const upstream = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/messages") {
        sent.push({ key: req.headers["x-api-key"] as string | undefined, body: JSON.parse(raw) });
        return res.end(JSON.stringify({ content: [{ type: "text", text: "Personal endpoint answered." }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 3 } }));
      }
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const fixture = await launchVerificationServer(process.env);
    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
      const result: unknown = await response.json(); expect(response.ok, JSON.stringify(result)).toBe(true); return result as T;
    };
    const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
    try {
      const server = { instanceId: "lab", name: "My lab", url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`, protocol: "anthropic", models: [{ id: "vendor/model", label: "My model" }] };
      await api("PUT", "/api/me/providers/servers/lab", server);
      const saved = await api<ProviderAccountsView>("PUT", "/api/me/providers/keys/compat%3Alab", { key: "test-personal-api-key" });
      expect(JSON.stringify(saved)).not.toContain("test-personal-api-key");
      expect(saved.keys).toContainEqual({ provider: "compat:lab", last4: "-key" });
      const { instances } = await api<{ instances: Array<{ instanceId: string; providerAccount?: { serverId: string }; models: { options: Array<{ id: string; label: string }> } }> }>("GET", "/api/instances");
      const personal = instances.find((instance) => instance.providerAccount?.serverId === "lab")!;
      expect(personal.models.options).toEqual([{ id: "vendor/model", label: "My model" }]);
      const { bot } = await control(["new-bot", "--name", "Personal provider fixture"]);
      await control(["set-model", "--bot", bot.id, "--instance", personal.instanceId, "--model", "vendor/model"]);
      for (const anonymous of [false, true]) {
        if (anonymous) await api("DELETE", "/api/me/providers/keys/compat%3Alab");
        await control(["send", "--bot", bot.id, "--text", "Say hello"]);
        const waited = await control(["wait", "--bot", bot.id, "--timeout", "20"]);
        expect(waited.status).toBe("settled");
      }
      expect(sent).toHaveLength(2);
      expect(sent.map((request) => request.key)).toEqual(["test-personal-api-key", undefined]);
      expect(sent.map((request) => request.body.model)).toEqual(["vendor/model", "vendor/model"]);
      const removed = await api<ProviderAccountsView>("DELETE", "/api/me/providers/servers/lab");
      expect(removed.servers).toEqual([]);
      const after = await api<{ instances: Array<{ instanceId: string }> }>("GET", "/api/instances");
      expect(after.instances.some((instance) => instance.instanceId === personal.instanceId)).toBe(false);
      expect(after.instances.some((instance) => instance.instanceId === "claude")).toBe(true);
    } finally {
      await fixture.close(); upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 60_000);
});
