import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandSkillCommandTurnText } from "./skills.ts";
import { PersonCapabilities } from "../people/person-connections.ts";
import { PersonalSkills, createPersonalSkillRoutes } from "./personal-skills.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const text = (body = "Check each item.") => `---\nname: packing-list\ndescription: Verify packing\n---\n${body}\n`;

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "sagax-personal-skills-"));
  roots.push(root);
  const capabilities = new PersonCapabilities(root, () => ({ kind: "key", key: Buffer.alloc(32, 17) }));
  const skills = new PersonalSkills(root, capabilities);
  const route = createPersonalSkillRoutes({ skills, enabled: () => true,
    person: (auth) => auth.kind === "session" ? auth.session.principalId ?? null : null,
    bots: () => [{ id: "first", name: "First" }, { id: "second", name: "Second" }],
  });
  const server = createServer(async (req, res) => {
    const person = req.headers["x-test-person"] as string | undefined;
    const auth: RequestAuth = person ? { kind: "session", via: "cookie", scopes: ["client"], session: { principalId: person } as never } : { kind: "none" } as never;
    const url = new URL(req.url!, "http://localhost");
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method!, auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (person: string, method: string, path = "", body?: unknown) => {
    const response = await fetch(`${origin}/api/me/skills-library${path}`, { method,
      headers: { "content-type": "application/json", ...(person ? { "x-test-person": person } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  return { root, capabilities, skills, api };
}

describe("Me skills, one source referenced by all of the person's bots", () => {
  it("lets a member create and update their skill, never another person's", async () => {
    const { root, capabilities, skills, api } = await boot();
    expect(await api("alice", "POST", "?person=bob", { text: text(), principalId: "bob" })).toMatchObject({ status: 201 });
    expect(capabilities.assignedSkills("alice")).toEqual(["packing-list"]);
    expect(skills.enabled("bob")).toEqual([]);
    expect((await api("bob", "GET", "/packing-list")).status).toBe(404);
    expect((await api("", "GET")).status).toBe(403);
    const listing = await api("alice", "GET");
    expect(listing.body.skills[0]).toMatchObject({ enabled: true, assignedBots: [{ id: "first", name: "First" }, { id: "second", name: "Second" }] });
    expect(skills.prompt("alice", true)).toContain("/workspace/sagax-capability-skills/me/skills/packing-list/SKILL.md");
    const command = expandSkillCommandTurnText("first", "/packing-list shipping", undefined, { inline: true, overrides: skills.commands("alice") });
    expect(command).toContain("Check each item.");
    expect(command).toContain("Request: shipping");
    expect(expandSkillCommandTurnText("second", "/packing-list", undefined, { overrides: skills.commands("alice") })).toContain(skills.root("alice"));
    expect(skills.commands("bob")).toEqual([]);
    expect(skills.commands("alice", new Set(["packing-list"]))).toEqual([]);
    expect(readFileSync(join(root, "principals", "alice", "capabilities.enc"), "utf8")).not.toContain("packing-list");
    expect((await api("alice", "PUT", "/packing-list", { name: "shipping-list", description: "Verify shipping", instructions: "Check the destination too." })).status).toBe(200);
    expect(capabilities.assignedSkills("alice")).toEqual(["shipping-list"]);
    expect(skills.prompt("alice", false)).toContain("shipping-list/SKILL.md");
    expect((await api("alice", "GET", "/shipping-list")).body.text).toContain("Check the destination too.");
    expect((await api("alice", "GET", "/packing-list")).status).toBe(404);
  });

  it("revokes disabled or changed bytes and lets the person repair or remove them", async () => {
    const { capabilities, skills, api } = await boot();
    await api("alice", "POST", "", { text: text() });
    await api("alice", "PATCH", "/packing-list", { enabled: false });
    expect(skills.prompt("alice", true)).toBe("");
    await api("alice", "PATCH", "/packing-list", { enabled: true });
    writeFileSync(join(skills.root("alice"), "skills", "packing-list", "SKILL.md"), text("Changed outside the app."));
    expect(skills.prompt("alice", true)).toBe("");
    expect(skills.commands("alice")).toEqual([]);
    // The person can inspect changed bytes in the editor (ad1bf11c0),
    // while prompt/command delivery remains revoked until they review.
    expect(await api("alice", "GET", "/packing-list")).toMatchObject({ status: 200, body: {
      text: text("Changed outside the app."), changedAfterReview: true,
      reviewedText: text(), enabled: false, editable: true, origin: "me",
    } });
    expect((await api("bob", "GET", "/packing-list")).status).toBe(404);
    expect(skills.prompt("alice", true)).toBe("");
    expect(skills.commands("alice")).toEqual([]);
    expect((await api("alice", "PUT", "/packing-list", { name: "packing-list", description: "Verify packing", instructions: "Reviewed replacement." })).status).toBe(200);
    expect(skills.prompt("alice", true)).toContain("packing-list");
    expect(skills.commands("alice")[0]?.text).toContain("Reviewed replacement.");
    expect(skills.commands("alice")[0]?.text).not.toContain("Changed outside the app.");
    expect((await api("alice", "DELETE", "/packing-list")).status).toBe(200);
    expect(capabilities.assignedSkills("alice")).toEqual([]);
    expect(skills.prompt("alice", true)).toBe("");
  });
});
