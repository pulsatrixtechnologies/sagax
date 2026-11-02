// Command variables: present only when the person turned them on for a key
// and allowed the bot (CredentialVault.commandVariables), carried to the
// server environment's shell without ever being on the command line
// (withCommandVariables).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseCommandVariable, parseVaultInjection } from "../../shared/credential-vault.ts";
import { commandVariablesDigest, commandVariablesScript, engineCommandVariables, withCommandVariables, withStdinCommandVariables } from "./credential-command-env.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "../mcp-oauth.ts";

// Every value below is fake test data.
const FAKE_KEY = "fake-api-key-for-command-tests";
const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function vault() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-vault-cmd-"));
  dirs.push(dir);
  return { dir, vault: new CredentialVault(dir, () => KEY) };
}

describe("command variables in the vault", () => {
  it("are present only when the person turns them on and allows the bot", () => {
    const { vault: v } = vault();
    const item = v.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "Example API", apiKey: FAKE_KEY, domains: ["api.example.com"] });
    v.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    // allowed, but not exposed: nothing
    expect(v.commandVariables(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toEqual({});
    v.update(LOCAL_VAULT_PRINCIPAL, item.id, { commandVariable: "EXAMPLE_API_KEY" });
    expect(v.commandVariables(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toEqual({ EXAMPLE_API_KEY: FAKE_KEY });
    // another bot, never
    expect(v.commandVariables(LOCAL_VAULT_PRINCIPAL, "bot-b", "t1")).toEqual({});
    // revoked, gone at the next read
    v.revoke(LOCAL_VAULT_PRINCIPAL, item.id, "bot-a");
    expect(v.commandVariables(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toEqual({});
    // turned off by the person
    v.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    v.update(LOCAL_VAULT_PRINCIPAL, item.id, { commandVariable: "" });
    expect(v.commandVariables(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toEqual({});
  });

  it("lists the name, never the value, and never writes it in clear", () => {
    const { dir, vault: v } = vault();
    const item = v.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "Example API", apiKey: FAKE_KEY, domains: ["api.example.com"], injection: { mode: "header", header: "X-Api-Key" }, commandVariable: "EXAMPLE_API_KEY" });
    expect(item).toMatchObject({ commandVariable: "EXAMPLE_API_KEY", injection: { mode: "header", header: "X-Api-Key" }, hasApiKey: true });
    expect(JSON.stringify(v.list(LOCAL_VAULT_PRINCIPAL))).not.toContain(FAKE_KEY);
    expect(readFileSync(join(dir, "credential-vault.enc"), "utf8")).not.toContain(FAKE_KEY);
  });

  it("refuses names the shell or the engine needs, and bad injections", () => {
    for (const name of ["PATH", "HOME", "LD_PRELOAD", "SAGAX_X", "ANTHROPIC_API_KEY", "lower", "1ABC", "A-B"]) {
      expect(parseCommandVariable(name), name).toMatchObject({ error: expect.any(String) });
    }
    expect(parseCommandVariable("EXAMPLE_API_KEY")).toBe("EXAMPLE_API_KEY");
    expect(typeof parseVaultInjection({ mode: "header", header: "Host" })).toBe("string");
    expect(typeof parseVaultInjection({ mode: "query" })).toBe("string");
    expect(typeof parseVaultInjection({ mode: "bearer", basePath: "/v1/../x" })).toBe("string");
    expect(parseVaultInjection({ mode: "bearer", basePath: "/v1/" })).toEqual({ mode: "bearer", basePath: "/v1" });
    const { vault: v } = vault();
    expect(() => v.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "No site", apiKey: FAKE_KEY, injection: { mode: "bearer" } })).toThrow(/at least one site/);
  });

  it("knows when a bot may send a key (the tool is listed)", () => {
    const { vault: v } = vault();
    const item = v.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "Example API", apiKey: FAKE_KEY, domains: ["api.example.com"], injection: { mode: "bearer" } });
    expect(v.injectable(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toBe(false);
    v.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1" });
    expect(v.injectable(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toBe(true);
    expect(v.injectable(LOCAL_VAULT_PRINCIPAL, "bot-a", "t2")).toBe(false);
  });
});

describe("withCommandVariables (server environment)", () => {
  it("exports the variable in the shell, never on the command line", () => {
    const input = { argv: ["bash", "-lc", 'printf %s "$EXAMPLE_API_KEY"; printf "|%s" "${SAGAX_CMDVAR_0:-gone}"'], timeoutSec: 30 };
    const out = withCommandVariables(input, { EXAMPLE_API_KEY: FAKE_KEY });
    expect(out.argv.join(" ")).not.toContain(FAKE_KEY);
    expect(out.env).toEqual({ SAGAX_CMDVAR_0: FAKE_KEY });
    expect(out.timeoutSec).toBe(30);
    // the same argv and env in a real bash (-c here: a login shell would read this machine's profile)
    const result = execFileSync("bash", ["-c", out.argv[2]!], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...out.env }, encoding: "utf8" });
    expect(result).toBe(`${FAKE_KEY}|gone`);
  });

  it("leaves a command alone when the person exposed nothing, and other execs always", () => {
    const input = { argv: ["bash", "-lc", "ls"] };
    expect(withCommandVariables(input, {})).toBe(input);
    const read = { argv: ["python3", "-I", "-c", "print(1)"] };
    expect(withCommandVariables(read, { EXAMPLE_API_KEY: FAKE_KEY })).toBe(read);
    // a name the vault would refuse never reaches a prelude
    expect(withCommandVariables(input, { "A;rm -rf": FAKE_KEY })).toBe(input);
  });

  it("digests the variables for a process contract, never their value", () => {
    const digest = commandVariablesDigest({ EXAMPLE_API_KEY: FAKE_KEY });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(FAKE_KEY);
    expect(commandVariablesDigest({})).toBeNull();
    expect(commandVariablesDigest({ EXAMPLE_API_KEY: "other-fake" })).not.toBe(digest);
  });
});

describe("command variables for the engines and the Local VM", () => {
  it("never hand an engine a name it reads as its own sign-in", () => {
    expect(engineCommandVariables({ EXAMPLE_API_KEY: FAKE_KEY, OPENAI_API_KEY: FAKE_KEY, XAI_API_KEY: FAKE_KEY, OWN_ENGINE_KEY: FAKE_KEY }, ["OWN_ENGINE_KEY"]))
      .toEqual([["EXAMPLE_API_KEY", FAKE_KEY]]);
    expect(engineCommandVariables(undefined)).toEqual([]);
  });

  it("export from a stdin script in a real shell, with quotes, dollars and new lines intact", () => {
    const value = `fake'key "with" $HOME and\nlines`;
    const script = commandVariablesScript({ EXAMPLE_API_KEY: value, lower: "dropped" })!;
    expect(script).not.toContain("lower");
    const command = withStdinCommandVariables('printf %s "$EXAMPLE_API_KEY"');
    expect(command).not.toContain("fake");
    expect(execFileSync("sh", ["-lc", command], { input: script, encoding: "utf8" })).toBe(value);
    expect(commandVariablesScript({})).toBeNull();
  });
});
