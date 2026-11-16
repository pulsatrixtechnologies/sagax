// #4435 on the real organization server: two people each add an account
// beside a provider's first one, with no administrator. Neither sees,
// renames, removes or signs in to the other's; removing one's own takes its
// entry and its sign-in folder away.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startOrgServer } from "../testing/org-server-harness.ts";
import type { FakeOidcUser } from "../testing/fake-oidc-provider.ts";

const person = (id: string, role = "employee"): FakeOidcUser => ({ sub: `01JADDEDACCOUNT${id.padEnd(11, "0")}`, email: `${id}@example.test`, preferred_username: id, name: id, role });

type Listed = { instanceId: string; displayName?: string };

describe.skipIf(process.platform === "win32")("added provider accounts belong to the person who adds them", () => {
  it("each person adds, sees, renames and removes only their own account", async () => {
    const alexUser = person("alex"), samUser = person("sam");
    const org = await startOrgServer({ user: alexUser, prefix: "sagax-added-accounts-" });
    try {
      const alex = await org.signIn(alexUser), sam = await org.signIn(samUser);
      const add = async (auth: typeof alex, name: string) => {
        const added = await org.api("POST", "/api/instances/claude-accounts", auth, { displayName: name });
        expect(added.status, JSON.stringify(added.body)).toBe(201);
        return added.body.instanceId as string;
      };
      // no administrator: a member adds their own account
      const alexId = await add(alex, "Alex work"), samId = await add(sam, "Sam work");
      const plan = await org.api("POST", "/api/instances/chatgpt-accounts", sam, { displayName: "Sam plan" });
      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
      const samPlan = plan.body.instanceId as string;
      // a member does not pick a folder of the server's own
      expect((await org.api("POST", "/api/instances/claude-accounts", alex, { displayName: "Elsewhere", configDir: "/tmp/elsewhere" })).status).toBe(403);

      const listed = async (auth: typeof alex) => {
        const instances = (await org.api("GET", "/api/instances", auth)).body.instances as Listed[];
        const engines = (await org.api("GET", "/api/me/engines", auth)).body.engines as Listed[];
        return { instances: instances.map((entry) => entry.instanceId), engines: engines.map((entry) => entry.instanceId) };
      };
      const seenByAlex = await listed(alex), seenBySam = await listed(sam);
      expect(seenByAlex.instances).toContain(alexId);
      expect(seenByAlex.engines).toContain(alexId);
      for (const other of [samId, samPlan]) {
        expect(seenByAlex.instances).not.toContain(other);
        expect(seenByAlex.engines).not.toContain(other);
      }
      expect(seenBySam.instances).toEqual(expect.arrayContaining([samId, samPlan]));
      expect(seenBySam.instances).not.toContain(alexId);
      expect(seenBySam.engines).not.toContain(alexId);
      // the organization's own engines stay everyone's
      expect(seenByAlex.instances).toContain("grok");
      expect(seenBySam.instances).toContain("grok");

      // nobody renames, signs in to, or removes the other's account
      expect((await org.api("PUT", `/api/me/engines/${samId}/name`, alex, { name: "Mine now" })).status).toBe(404);
      expect((await org.api("DELETE", `/api/me/engines/${samId}`, alex)).status).toBe(404);
      expect((await org.api("POST", `/api/me/engines/${samId}/login/start`, alex, {})).status).toBe(404);
      // an administrator neither: the account is Sam's alone
      const admin = await org.signIn(person("ada", "admin"));
      expect((await listed(admin)).instances).not.toContain(samId);
      expect((await org.api("PATCH", `/api/instances/${samId}`, admin, { displayName: "Mine now" })).status).toBe(404);
      expect((await org.api("POST", `/api/instances/${samId}/auth/start`, admin, {})).status).toBe(404);
      expect((await org.api("DELETE", `/api/instances/${samId}`, admin)).status).toBe(404);
      // nor in the administrator's console: its Connections list the
      // organization's engines, never an account a person added
      const consoleCall = (method: string, sub: string, body?: unknown) => fetch(`${org.base}/api/org/admin/${sub}`, {
        method,
        headers: {
          authorization: `Bearer ${org.idp.consoleAssertion({ sub: person("ada", "admin").sub, aud: org.base, role: "admin", teams: [] })}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const connections = await consoleCall("GET", "connections");
      const view = await connections.json() as { engines: Array<{ id: string; name: string }>; people: Array<{ engines: Array<{ id: string }> }> };
      expect(connections.status, JSON.stringify(view)).toBe(200);
      const consoleIds = [...view.engines.map((engine) => engine.id), ...view.people.flatMap((entry) => entry.engines.map((engine) => engine.id))];
      expect(consoleIds).toContain("grok");
      for (const owned of [alexId, samId, samPlan]) expect(consoleIds).not.toContain(owned);
      expect(JSON.stringify(view)).not.toContain("Sam work");
      expect((await (await consoleCall("POST", "connections/test", { kind: "engine", id: samId })).json())).toMatchObject({ ok: false, reason: "engine_not_installed" });
      const settings = await (await consoleCall("GET", "settings")).json() as { policies: { engineModels: Record<string, unknown> } };
      expect(Object.keys(settings.policies.engineModels)).toContain("grok");
      for (const owned of [alexId, samId, samPlan]) expect(Object.keys(settings.policies.engineModels)).not.toContain(owned);
      // and a bot of Alex cannot be set on it
      const created = await org.api("POST", "/api/bots", alex, { name: "Alex helper" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const botId = created.body.bot.id as string;
      // Alex's own account is fine for Alex's bot
      expect((await org.api("PATCH", `/api/bots/${botId}`, alex, { modelSelection: { instanceId: alexId, model: "default" } })).status).toBe(200);
      const moved = await org.api("PATCH", `/api/bots/${botId}`, alex, { modelSelection: { instanceId: samId, model: "default" } });
      expect(moved.status).not.toBe(200);
      // automatic recovery: the owner backs their bot up with their own
      // added account, never with the account another person added
      const offered = ((await org.api("GET", "/api/instances", alex)).body.instances as Array<Listed & { models?: { default?: string } }>)
        .find((entry) => entry.instanceId === alexId)?.models?.default;
      expect(offered, "the added account offers a model").toBeTruthy();
      const backup = (instanceId: string) => ({ automaticRecovery: { enabled: true, backup: { instanceId, model: offered } } });
      const ownBackup = await org.api("PATCH", `/api/bots/${botId}/runtime-settings`, alex, backup(alexId));
      expect(ownBackup.status, JSON.stringify(ownBackup.body)).toBe(200);
      expect(ownBackup.body.settings.automaticRecovery.backup.instanceId).toBe(alexId);
      const samBot = await org.api("POST", "/api/bots", sam, { name: "Sam helper" });
      expect(samBot.status, JSON.stringify(samBot.body)).toBe(201);
      const otherBackup = await org.api("PATCH", `/api/bots/${samBot.body.bot.id}/runtime-settings`, sam, backup(alexId));
      expect(otherBackup.status).toBe(400);
      expect(String(otherBackup.body.error)).toContain("unavailable");

      // each renames their own
      expect((await org.api("PUT", `/api/me/engines/${alexId}/name`, alex, { name: "Alex main" })).status).toBe(200);

      // removing one's own: the entry and its sign-in folder go
      const folder = join(org.home, ".sagax", "principals");
      const config = () => JSON.parse(readFileSync(join(org.home, ".sagax", "config.json"), "utf8")) as { instances: Record<string, { ownerPrincipalId?: string }> };
      expect(config().instances[samId]?.ownerPrincipalId).toBeTruthy();
      expect(config().instances[samId]?.ownerPrincipalId).not.toBe(config().instances[alexId]?.ownerPrincipalId);
      const samFolder = join(folder, config().instances[samId]!.ownerPrincipalId!, "accounts", samId);
      mkdirSync(join(samFolder, "claude"), { recursive: true });
      writeFileSync(join(samFolder, "claude", "settings.json"), "{}");
      const removed = await org.api("DELETE", `/api/me/engines/${samId}`, sam);
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(config().instances[samId]).toBeUndefined();
      expect(existsSync(samFolder)).toBe(false);
      expect((await listed(sam)).instances).not.toContain(samId);
      // Alex's account is untouched
      expect(config().instances[alexId]).toBeDefined();
      expect((await listed(alex)).instances).toContain(alexId);
    } finally { await org.close(); }
  }, 120_000);
});
