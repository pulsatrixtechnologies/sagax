import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startOrgServer } from "../testing/org-server-harness.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { FakeOidcUser } from "../testing/fake-oidc-provider.ts";

const member = (id: string): FakeOidcUser => ({ sub: `01JPERSONALPROVIDER${id.padEnd(8, "0")}`, email: `${id}@example.test`, preferred_username: id, name: id, role: "employee" });

describe.skipIf(process.platform === "win32")("personal provider catalogs on the real organization server", () => {
  it("lets members create their own endpoints and keeps both catalogs and mutations isolated", async () => {
    const linkDir = mkdtempSync(join(tmpdir(), "sagax-provider-link-"));
    const link = join(linkDir, "pulsabot.json");
    const a = member("alex"), b = member("sam");
    const org = await startOrgServer({ user: a, prefix: "sagax-personal-providers-", env: { SAGAX_PERSPICAX_LINK_FILE: link } });
    try {
      await org.kill("SIGTERM");
      org.idp.directoryPeople = [a, b].map((user) => org.idp.personOf(user));
      writeFileSync(link, JSON.stringify({ version: 1, issuer: org.idp.issuer, client_id: "pulsa-bot", server_id: org.idp.serverId, origin: org.base, link_token: org.idp.linkToken }), { mode: 0o600 });
      mkdirSync(join(org.home, ".sagax"), { recursive: true });
      writeFileSync(join(org.home, ".sagax", "config.json"), JSON.stringify({ organization: { ownAccountsOutsideList: true } }));
      await org.start();
      const alex = await org.signIn(a), sam = await org.signIn(b);
      const profile = (name: string) => ({ instanceId: "lab", name, url: "http://127.0.0.1:8080/v1", protocol: "openai", models: [{ id: "vendor/model", label: "Private model" }] });
      for (const [auth, name] of [[alex, "Alex lab"], [sam, "Sam lab"]] as const) {
        const saved = await org.api("PUT", "/api/me/providers/servers/lab", auth, profile(name));
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      }
      const mine = async (auth: typeof alex) => {
        const catalog = await org.api("GET", "/api/instances", auth);
        expect(catalog.status).toBe(200);
        return (catalog.body.instances as Array<{ instanceId: string; providerAccount?: { serverId: string }; displayName: string }>).filter((instance) => instance.providerAccount?.serverId === "lab");
      };
      const alexInstances = await mine(alex), samInstances = await mine(sam);
      expect(alexInstances.map((entry) => entry.displayName)).toEqual(["Alex lab"]);
      expect(samInstances.map((entry) => entry.displayName)).toEqual(["Sam lab"]);
      const alexId = alexInstances[0]!.instanceId, samId = samInstances[0]!.instanceId;
      expect(alexId).not.toBe(samId);
      for (const [auth, own, other] of [[alex, alexId, samId], [sam, samId, alexId]] as const) {
        const engines = await org.api("GET", "/api/me/engines", auth);
        expect(engines.status).toBe(200);
        expect(engines.body.engines.some((entry: { instanceId: string }) => entry.instanceId === other)).toBe(false);
        // A local or compatible server with no authentication still works for its owner.
        expect(engines.body.engines.find((entry: { instanceId: string }) => entry.instanceId === own).myTurns).toBe("key");
      }
      for (const [auth, ending] of [[alex, "alex"], [sam, "sams"]] as const) {
        const saved = await org.api("PUT", "/api/me/providers/keys/compat%3Alab", auth, { key: `fixture-personal-${ending}` });
        expect(saved.status).toBe(200);
        expect(saved.body.keys).toEqual([{ provider: "compat:lab", last4: ending }]);
        expect(JSON.stringify(saved.body)).not.toContain("fixture-personal-");
      }
      expect(org.idp.resolveRequests).toEqual(expect.arrayContaining([{ sub: a.sub, provider: "compat:lab" }, { sub: b.sub, provider: "compat:lab" }]));
      expect((await org.api("DELETE", "/api/me/providers/servers/lab", alex)).status).toBe(200);
      expect(await mine(alex)).toEqual([]);
      expect((await mine(sam)).map((entry) => entry.instanceId)).toEqual([samId]);
      expect((await org.api("GET", "/api/me/providers", sam)).body.servers.map((server: { name: string }) => server.name)).toEqual(["Sam lab"]);
    } finally { await org.close(); await removeTempDir(linkDir); }
  }, 90_000);
});
