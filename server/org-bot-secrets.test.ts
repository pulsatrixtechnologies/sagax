import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { OrgBotSecrets, parseOrgBotSecretChange } from "./org-bot-secrets.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";

const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 3) };
const SECRET = "fake-team-secret-value-0001";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-team-secrets-"));
  dirs.push(dir);
  return { dir, secrets: new OrgBotSecrets(dir, () => KEY) };
}

const team = (id: string) => id === "payroll-bot";

describe("org team secrets", () => {
  it("stores a secret an admin assigns, and never lists the value", () => {
    const { dir, secrets } = store();
    const change = parseOrgBotSecretChange({
      op: "add", kind: "secret", label: "Shop token", value: SECRET,
      injection: { via: "env", name: "SHOP_TOKEN" }, botIds: ["payroll-bot"],
    }, team);
    const listed = secrets.change(change);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: "secret", label: "Shop token", injection: { via: "env", name: "SHOP_TOKEN" }, botIds: ["payroll-bot"] });
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    const raw = readFileSync(join(dir, "org-bot-secrets.enc"), "utf8");
    expect(raw).not.toContain(SECRET);
    expect(secrets.connectorEnv("payroll-bot")).toEqual({ SHOP_TOKEN: SECRET });
    expect(secrets.connectorEnv("other-bot")).toEqual({});
    expect(secrets.shellEnv("payroll-bot")).toEqual({});
  });

  it("refuses a member's bot and a label that repeats the secret", () => {
    expect(() => parseOrgBotSecretChange({
      op: "add", kind: "secret", label: "Shop", value: SECRET,
      injection: { via: "env", name: "SHOP_TOKEN" }, botIds: ["private-bot"],
    }, team)).toThrow(/team bot/);
    expect(() => parseOrgBotSecretChange({
      op: "add", kind: "secret", label: SECRET, value: SECRET,
      injection: { via: "env", name: "SHOP_TOKEN" }, botIds: ["payroll-bot"],
    }, team)).toThrow(/label/);
  });

  it("keeps a service account login visible to the admin and the secret write-only", () => {
    const { secrets } = store();
    const listed = secrets.change(parseOrgBotSecretChange({
      op: "add", kind: "serviceAccount", label: "Billing", login: "billing-bot", value: SECRET,
      injection: { via: "plugin", plugin: "billing", key: "token" }, botIds: ["payroll-bot"],
    }, team));
    expect(listed[0]).toMatchObject({ kind: "serviceAccount", login: "billing-bot" });
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(secrets.pluginSettings("payroll-bot", "billing")).toEqual({ token: SECRET });
    expect(secrets.pluginSettings("payroll-bot", "other")).toEqual({});
    const replaced = secrets.change({ op: "replace", id: listed[0]!.id, value: "fake-team-secret-value-0002" });
    expect(JSON.stringify(replaced)).not.toContain("fake-team-secret-value-0002");
    expect(secrets.pluginSettings("payroll-bot", "billing").token).toBe("fake-team-secret-value-0002");
  });
});
