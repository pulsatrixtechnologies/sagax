import { describe, expect, it } from "vitest";
import { confidentialDataScopePath, ephemeralWorkspaceTokenPath, excludedWorkspaceAuthPath, liveDataEnginePath, portableWorkspaceConfig, redownloadedOrgLibraryPath, restoredWorkspaceConfig } from "./workspace-backup-policy.ts";

describe("workspace backup data boundary", () => {
  it("exports ordinary settings only and retains destination connection sections unchanged", () => {
    const connections = {
      xai: { key: "xai-secret", url: "https://source.example" },
      anthropic: { key: "claude-secret", url: "https://claude.example" },
      openaiCompat: { key: "api-secret", url: "https://api.example", model: "model", provider: "provider" },
      composio: { apiKey: "composio-secret", userId: "source-account", sessionId: "source-session" },
      box: { token: "boat-secret" }, opencodeGo: { apiKey: "go-secret" },
      tts: { key: "voice-secret", fishKey: "fish-secret", voice: "source-voice", provider: "fish" },
      imageGen: { key: "image-secret", customApiKey: "custom-secret", customUrl: "https://images.example/v1", provider: "custom" },
      instances: { source: { driver: "claudeAgent", environment: { ORDINARY_NAME: "env-secret" }, config: { unknown: "driver-secret" } } },
      mcpServers: { source: { command: "mcp", args: ["arg-secret"], env: { ORDINARY: "env-secret" }, headers: { Authorization: "Bearer header-secret" } } },
      futureConnection: { unrecognizedField: "future-secret" }, apiKey: "legacy-secret",
      defaultModelSelection: { instanceId: "source", model: "source" },
      signIn: { admins: ["source@example.com"] }, customDomain: "source.example", vps: { sshAlias: "source" },
      cliStartup: { access: "public-url", publicUrl: "https://source.example" },
    };
    const portable = portableWorkspaceConfig({ ...connections, language: "ja", features: { browser: true }, profile: { name: "Example" } });
    expect(portable).toEqual({ profile: { name: "Example" }, language: "ja", features: { browser: true } });
    const restored = restoredWorkspaceConfig(portable, { ...connections, language: "en", budgets: { monthlyUsd: 12 } });
    expect(restored).toEqual({ ...connections, ...portable });
    expect(restored.instances).toBe(connections.instances);
  });

  it("keeps the destination's own computer-sharing switch, whatever the backup says", () => {
    const portable = portableWorkspaceConfig({ features: { browser: true, sharedComputers: true } });
    expect(restoredWorkspaceConfig(portable, { features: { sharedComputers: false } }).features).toEqual({ browser: true, sharedComputers: false });
    expect(restoredWorkspaceConfig(portable, {}).features).toEqual({ browser: true });
    expect(restoredWorkspaceConfig(portableWorkspaceConfig({ features: { sharedComputers: true } }), {})).not.toHaveProperty("features");
    expect(restoredWorkspaceConfig({}, { features: { sharedComputers: true, browser: true } }).features).toEqual({ sharedComputers: true });
  });

  it.each([
    "providers/account/.credentials.json", "providers/antigravity/profile/antigravity-acp/acp_token.json",
    "workspace-credentials.json", "browser-engine-key", "caddy/data/certificates/private.key",
    "external-runtimes.json", "external-runtimes.json.123.tmp",
    "command-allowlist.json", "command-allowlist.json.123.05a7b3e0-1234.tmp",
    "chrome-profile/Default/Cookies", ".agent-browser/auth/site.json",
    "vm-home/.browser-profiles/chrome/Cookies", "vm-homes/abc123/.browser-profiles/chromium/Local State",
    "config.json.123.tmp", "config.json.123.05a7b3e0-1234.tmp", "sessions.json.456.tmp",
    "webhooks.json.123.05a7b3e0-1234.tmp", "browser-engine-key.12.05a7b3e0-1234.tmp",
  ])("excludes known owned authentication path %s", (path) => {
    expect(excludedWorkspaceAuthPath(path)).toBe(true);
  });

  it("never exports or restores saved website logins or their key", () => {
    for (const path of ["logins.json.enc", "logins-key", "logins.json.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp", "logins-key.12.05a7b3e0-1234.tmp"]) {
      expect(excludedWorkspaceAuthPath(path)).toBe(true);
    }
    for (const path of ["logins.json", "logins.md", "workspaces/bot/logins.json.enc", "attachments/logins-key"]) expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });

  it("never exports or restores MCP sign-in tokens", () => {
    for (const path of ["mcp-oauth.json", "mcp-oauth.json.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp"]) expect(excludedWorkspaceAuthPath(path)).toBe(true);
    for (const path of ["mcp-oauth.json.md", "workspaces/bot/mcp-oauth.json"]) expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });

  it("never exports or restores the encrypted MCP sign-in vault or its key", () => {
    for (const path of [
      "mcp-oauth.enc", "mcp-oauth.key",
      "mcp-oauth.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp", "mcp-oauth.key.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp",
    ]) expect(excludedWorkspaceAuthPath(path)).toBe(true);
    for (const path of ["mcp-oauth.enc.md", "workspaces/bot/mcp-oauth.key", "notes/mcp-oauth.enc"]) expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });

  it("never exports a provider access key or a Hermes dotenv", () => {
    for (const path of [
      "engine-api-keys.enc", "engine-api-keys.json",
      "engine-api-keys.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp",
      "principals/pr_ada/engine-api-keys.enc",
      ".hermes/.env", "people/ada/.hermes/.env",
      "engine-policies/hermes-solo/.env", "engine-policies/hermes-org/.env",
    ]) expect(excludedWorkspaceAuthPath(path)).toBe(true);
    for (const path of [
      "engine-api-keys.json.md", "workspaces/bot/engine-api-keys.json",
      "notes/engine-api-keys.enc", ".hermes/config.yaml", "engine-policies/hermes-solo/config.yaml",
    ]) expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });

  it("never exports or restores the organization GitHub access tokens", () => {
    for (const path of [
      "org-github-tokens.enc",
      "org-github-tokens.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp",
    ]) expect(excludedWorkspaceAuthPath(path)).toBe(true);
    for (const path of ["org-github-tokens.enc.md", "workspaces/bot/org-github-tokens.enc", "notes/org-github-tokens.enc"]) {
      expect(excludedWorkspaceAuthPath(path)).toBe(false);
    }
  });

  it("never exports the per-turn hook token directory, and only that directory", () => {
    for (const path of ["hook-tokens", "hook-tokens/0123456789abcdef01234567.token", "sessions.json.open"]) expect(ephemeralWorkspaceTokenPath(path)).toBe(true);
    for (const path of ["hook-tokens.md", "workspaces/bot/hook-tokens/notes.md", "attachments/api.token", "sessions.json.opened", "workspaces/bot/sessions.json.open"]) expect(ephemeralWorkspaceTokenPath(path)).toBe(false);
  });

  it("leaves out only the Organization library files Electron main downloads again", () => {
    for (const path of ["org-library/catalog.json", "org-library/catalog.json.05a7b3e0-1234-4abc-8def-0123456789ab.tmp", "org-library/blobs",
      `org-library/blobs/${"a".repeat(64)}.json`, `org-library/blobs/${"a".repeat(64)}.json.05a7b3e0-1234-4abc-8def-0123456789ab.tmp`]) {
      expect(redownloadedOrgLibraryPath(path)).toBe(true);
    }
    for (const path of ["org-library", "org-library/state.json", "org-library/presets.json", "org-library/catalog.json.bak", "org-library/blobs.md",
      "workspaces/bot/org-library/catalog.json", "attachments/org-library/blobs/x.json", "catalog.json", "blobs/x.json"]) {
      expect(redownloadedOrgLibraryPath(path)).toBe(false);
    }
  });

  it("leaves out a bot's live DuckDB database, WAL and spill directory, and nothing else in its folder", () => {
    for (const path of ["bots/b1/data.duckdb", "bots/b1/data.duckdb.wal", "bots/b1/data-tmp", "bots/b1/data-tmp/duckdb_temp_storage-0.tmp",
      "bots/b1/data-downloads/x.csv", "data-scopes/b1/p-0123456789abcdef/data.duckdb", "data-scopes/b1/t-0123456789abcdef/data-tmp/x.tmp",
      "data-scopes/b1/p-0123456789abcdef/data-downloads/x.csv"]) {
      expect(liveDataEnginePath(path)).toBe(true);
    }
    for (const path of ["bots/b1/SOUL.md", "bots/b1/sheet.json", "bots/b1/data.duckdb.bak", "bots/b1/data-tmp.zip", "bots/data.duckdb", "data.duckdb",
      "workspaces/bot/data.duckdb", "bots/b1/exports/data.duckdb", "attachments/data-tmp/x", "data-scopes/b1/p-0123456789abcdef/sheet.json", "data-scopes/b1/data.duckdb"]) {
      expect(liveDataEnginePath(path)).toBe(false);
    }
  });

  it("leaves out a confidential thread's whole Data folder (its sheet too), and only that", () => {
    for (const path of ["data-scopes/b1/t-0123456789abcdef", "data-scopes/b1/t-0123456789abcdef/sheet.json",
      "data-scopes/b1/t-0123456789abcdef/sheet.json.1234.tmp", "data-scopes/b1/t-0123456789abcdef/data-exports/x.csv",
      "data-scopes/b1/t-0123456789abcdef/anything/else.bin", "Data-Scopes/b1/T-0123456789abcdef/sheet.json", "data-scopes/b1/t-"]) {
      expect(confidentialDataScopePath(path), path).toBe(true);
    }
    for (const path of ["data-scopes", "data-scopes/b1", "data-scopes/b1/p-0123456789abcdef/sheet.json", "bots/b1/sheet.json",
      "bots/b1/data-scopes/b1/t-0123456789abcdef/sheet.json", "workspaces/data-scopes/b1/t-0123456789abcdef/sheet.json",
      "data-scopes/t-0123456789abcdef", "data-scopes/b1/xt-0123456789abcdef/sheet.json"]) {
      expect(confidentialDataScopePath(path), path).toBe(false);
    }
  });

  it.each(["attachments/key.txt", "workspaces/bot/notes.md", "workspaces/bot/external-runtimes.json", "vm-home/project/config.json", "config.json", "webhooks.json"])("does not redact arbitrary user file %s", (path) => {
    expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });
});
