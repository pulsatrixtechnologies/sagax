import { describe, expect, it } from "vitest";
import {
  configSecretCounts, confidentialDataScopePath, destinationSignInFile, disposableEngineHomePath, engineCredentialPath, engineSettingsPath, ephemeralWorkspaceTokenPath, excludedWorkspaceAuthPath, liveDataEnginePath,
  portableWorkspaceConfig, ReconnectTally, redownloadedOrgLibraryPath, restoredWorkspaceConfig, savedSignInPath, secretCategory, secretFieldName, withoutEngineSecrets, withoutRegistrySecrets,
} from "./workspace-backup-policy.ts";

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

  it("never exports a person's web search key", () => {
    for (const path of ["web-search.enc", "principals/pr_ada/web-search.enc", "web-search.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp", "web-bot-auth-key.json", "principals/pr_ada/web-bot-auth-key.json", "openapi.enc", "openapi.json", "principals/pr_ada/openapi.enc"]) {
      expect(excludedWorkspaceAuthPath(path)).toBe(true);
    }
    for (const path of ["notes/web-search.enc", "web-search.enc.md"]) expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });

  it("never exports or restores the organization GitHub access tokens", () => {
    for (const path of [
      "org-github-tokens.enc",
      "org-github-tokens.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp",
      "org-bot-secrets.enc",
      "org-bot-secrets.enc.4242.05a7b3e0-1234-4abc-8def-0123456789ab.tmp",
    ]) expect(excludedWorkspaceAuthPath(path)).toBe(true);
    for (const path of ["org-github-tokens.enc.md", "workspaces/bot/org-github-tokens.enc", "notes/org-github-tokens.enc"]) {
      expect(excludedWorkspaceAuthPath(path)).toBe(false);
    }
  });

  it("never exports the per-turn hook token directory, and only that directory", () => {
    for (const path of ["hook-tokens", "hook-tokens/0123456789abcdef01234567.token", "sessions.json.open", "sessions.json.unsynced"]) expect(ephemeralWorkspaceTokenPath(path)).toBe(true);
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

  it("leaves out every engine's saved sign-in in an engine home, and keeps its settings", () => {
    for (const path of [
      // Claude Code (CLAUDE_CONFIG_DIR) and its copies of .claude.json
      "principals/pr_ana/claude/.credentials.json", "principals/pr_ana/claude/.credentials.json.tmp.123.456",
      "principals/pr_ana/claude/backups/.claude.json.backup.1792350746720", "principals/pr_ana/claude/.claude.json.backup",
      // Codex (CODEX_HOME): ChatGPT tokens or API key, MCP sign-ins
      "principals/pr_ana/codex/auth.json", "principals/pr_ana/codex/.credentials.json", "principals/pr_ana/codex-key/auth.json",
      // Grok Build (HOME=<dir>, GROK_HOME=<dir>/.grok)
      "principals/pr_ana/grok/.grok/auth.json", "principals/pr_ana/grok/.grok/auth.json.lock", "principals/pr_ana/grok/.grok/mcp_credentials.json",
      "org/grokAgent-key/.grok/auth.json",
      // Kimi Code, pi, Gemini, Qwen, OpenCode, Hermes, Cline, Droid
      "principals/pr_ana/kimi/credentials/kimi-code.json", "principals/pr_ana/kimi/credentials", "principals/pr_ana/piAgent-key/auth.json",
      "principals/pr_ana/geminiAgent-key/.gemini/oauth_creds.json", "principals/pr_ana/geminiAgent-key/.gemini/google_accounts.json",
      "principals/pr_ana/geminiAgent-key/.gemini/mcp-oauth-tokens.json", "principals/pr_ana/geminiAgent-key/.gemini/.env", "org/qwen/.qwen/oauth_creds.json",
      "org/opencode/.local/share/opencode/auth.json", "org/opencode/.local/share/opencode/mcp-auth.json", "org/opencode/.local/share/opencode/account.json",
      "engine-policies/hermes-solo/auth.json", "engine-policies/hermes-org/.env", "org/cline/.cline/data/secrets.json", "org/droid/.factory/auth.encrypted",
      "org/grokAgent-key/.local/share/keyrings/login.keyring",
      // Sagax's own signed-in marker, and other spellings on a case-insensitive disk
      "principals/pr_ana/claude/.pulsabot-login.json", "principals/pr_ana/kimi/.pulsabot-login.json",
      "Principals/pr_ana/codex/AUTH.json", "PRINCIPALS/pr_ana/claude/.Credentials.json",
    ]) expect(engineCredentialPath(path), path).toBe(true);
    for (const path of [
      "principals/pr_ana/claude/settings.json", "principals/pr_ana/claude/.claude.json", "principals/pr_ana/claude/CLAUDE.md",
      "principals/pr_ana/claude/skills/x/SKILL.md", "principals/pr_ana/claude/projects/-x/abc.jsonl", "principals/pr_ana/codex/config.toml",
      "principals/pr_ana/codex/AGENTS.md", "principals/pr_ana/grok/.grok/config.toml", "principals/pr_ana/kimi/config.toml",
      "principals/pr_ana/piAgent-key/settings.json", "principals/pr_ana/geminiAgent-key/.gemini/settings.json", "principals/pr_ana/claude/.env.example",
      "principals/pr_ana/claude/auth.json.md", "principals/pr_ana/engine-api-keys.enc", "principals/pr_ana/claude", "principals/pr_ana",
      // user files outside engine homes are never redacted by name
      "workspaces/bot/auth.json", "workspaces/bot/.env", "task-workspaces/bot/thread/.credentials.json", "attachments/credentials/a.txt",
      "principals.json", "vm-home/project/auth.json",
    ]) expect(engineCredentialPath(path), path).toBe(false);
  });

  it("leaves out every secret Sagax keeps itself (Owner 2026-10-18 « Exclure tout »), and a turn's dead bearers", () => {
    for (const path of ["principals/pr_ana/mcp-oauth.enc", "principals/pr_ana/mcp-oauth.enc.12.0a1b-2c.tmp", "principals/pr_ana/cloud-agent-credentials.enc",
      "principals/pr_ana/connections.enc", "principals/pr_ana/credential-vault.enc", "principals/pr_ana/engine-api-keys.enc", "principals/pr_ana/future-store.enc",
      "marketplace-tokens.enc", "idp-revocations.enc", "Marketplace-Tokens.enc", "credential-vault.enc", "principals/pr_ana/codex/auth.json",
      "agent-api.key", "media-proxy.key", "published-pages.key", "template-links.key", "future-signing.key", "Published-Pages.KEY",
      "push-devices", "push-devices/pr_ana.json"]) expect(savedSignInPath(path), path).toBe(true);
    for (const path of ["workspaces/bot/marketplace-tokens.enc", "workspaces/bot/agent-api.key", "attachments/a.key", "principals/pr_ana/claude/settings.json",
      "principals.json", "published-pages.json", "template-links.json", "security-keys.json", "push-devices.json", "attachments/talk.key", "workspaces/w/notes/x.enc"]) expect(savedSignInPath(path), path).toBe(false);
    // a destination keeps its own top-level ones in place
    for (const name of ["agent-api.key", "media-proxy.key", "marketplace-tokens.enc", "push-devices"]) expect(destinationSignInFile(name), name).toBe(true);
    for (const name of ["principals", "published-pages.json", "principals/pr_ana/connections.enc"]) expect(destinationSignInFile(name), name).toBe(false);
    expect(ephemeralWorkspaceTokenPath("comms-tokens/abc.token")).toBe(true);
    expect(ephemeralWorkspaceTokenPath("comms-tokens")).toBe(true);
  });

  it("leaves out an engine home's scratch and caches (Codex tmp/arg0 links)", () => {
    for (const path of ["principals/pr_ana/codex/tmp", "principals/pr_ana/codex/tmp/arg0/codex-arg0x/apply_patch", "principals/pr_ana/codex/.tmp/x",
      "org/cursorAgent-key/Library/Caches/cursor-compile-cache/a", "org/x/.cache/y"]) expect(disposableEngineHomePath(path), path).toBe(true);
    for (const path of ["principals/pr_ana/codex/config.toml", "principals/pr_ana/codex/sessions/tmp/x", "tmp/x", "workspaces/bot/tmp/x",
      "principals/pr_ana/codex"]) expect(disposableEngineHomePath(path), path).toBe(false);
  });

  it("copies Claude Code's .claude.json without its account, API key, key approvals and MCP env or headers", () => {
    for (const path of ["principals/pr_ana/claude/.claude.json", "org/x/.claude/.claude.json", "principals/pr_ana/claude/settings.json", "principals/pr_ana/codex/config.toml",
      "engine-policies/hermes-org/config.yaml", "principals/pr_ana/piAgent-key/.pi/agent/models.json", "org/opencode/.config/opencode/opencode.json", "org/cline/.cline/data/cline_mcp_settings.json"]) {
      expect(engineSettingsPath(path), path).toBe(true);
    }
    for (const path of ["workspaces/bot/.claude.json", "workspaces/bot/settings.json", "config.json", "principals/pr_ana/claude/projects/-x/abc.jsonl"]) expect(engineSettingsPath(path), path).toBe(false);
    const text = JSON.stringify({ theme: "dark", mcpServers: { a: { command: "x", env: { A: "FAKE_SECRET_DO_NOT_USE_1" }, headers: { Authorization: "FAKE_SECRET_DO_NOT_USE_2" } } },
      oauthAccount: { emailAddress: "FAKE_SECRET_DO_NOT_USE_3" }, primaryApiKey: "FAKE_SECRET_DO_NOT_USE_4", customApiKeyResponses: { approved: ["FAKE_SECRET_DO_NOT_USE_5"] } });
    const scrubbed = withoutEngineSecrets("principals/pr_ana/claude/.claude.json", text)!;
    expect(JSON.parse(scrubbed)).toEqual({ theme: "dark", mcpServers: { a: { command: "x", env: {}, headers: {} } } });
    expect(scrubbed).not.toContain("FAKE_SECRET");
    expect(withoutEngineSecrets("x/.claude.json", JSON.stringify({ theme: "dark", maxTokens: 3 }))).toBeNull();
    expect(() => withoutEngineSecrets("x/.claude.json", "not json")).toThrow();
  });

  it("strips keys, tokens and env or header values from TOML and YAML engine settings, and keeps the rest", () => {
    const toml = [
      'model = "gpt-5"', 'api_key_env = "MOONSHOT_API_KEY"', "", '[model."local"]', 'base_url = "http://127.0.0.1:1234/v1"', 'api_key = "FAKE_SECRET_DO_NOT_USE_1"',
      "[mcp_servers.docs]", 'command = "docs"', 'bearer_token = "FAKE_SECRET_DO_NOT_USE_2"', 'http_headers = { "X-Key" = "FAKE_SECRET_DO_NOT_USE_3" }',
      "[mcp_servers.docs.env]", 'TOKEN = "FAKE_SECRET_DO_NOT_USE_4"', "[ui]", 'password = """', "FAKE_SECRET_DO_NOT_USE_5", '"""', 'theme = "dark"', "",
    ].join("\n");
    const out = withoutEngineSecrets("principals/pr_ana/codex/config.toml", toml)!;
    expect(out).not.toContain("FAKE_SECRET");
    for (const kept of ['model = "gpt-5"', 'api_key_env = "MOONSHOT_API_KEY"', 'base_url = "http://127.0.0.1:1234/v1"', 'command = "docs"', "[mcp_servers.docs.env]", 'theme = "dark"']) expect(out).toContain(kept);
    const yaml = ["model:", "  default: x", "providers:", "  local:", "    base_url: http://127.0.0.1:1234/v1", "    api_key: FAKE_SECRET_DO_NOT_USE_6",
      "mcp_servers:", "  docs:", "    command: docs", "    env:", "      TOKEN: FAKE_SECRET_DO_NOT_USE_7", "    headers:", "      - FAKE_SECRET_DO_NOT_USE_8", "toolsets: [web]", ""].join("\n");
    const yamlOut = withoutEngineSecrets("engine-policies/hermes-org/config.yaml", yaml)!;
    expect(yamlOut).not.toContain("FAKE_SECRET");
    for (const kept of ["default: x", "base_url: http://127.0.0.1:1234/v1", "command: docs", "toolsets: [ web ]"]) expect(yamlOut).toContain(kept);
    expect(withoutEngineSecrets("x/config.toml", 'model = "x"\n')).toBeNull();
  });

  it("finds a secret word anywhere in a field name, and leaves references and counts alone", () => {
    for (const name of ["openai_api_key", "github_token", "apiToken", "GITHUB_PAT", "db_password", "credentials", "key", "OPENAI_KEY", "groqKey", "oauthAccount", "customApiKeyResponses", "x-api-key"])
      expect(secretFieldName(name), name).toBe(true);
    for (const name of ["api_key_env", "bearer_token_env_var", "envKey", "apiKeyHelper", "token_url", "max_tokens", "model_auto_compact_token_limit", "sort_key", "keybindings", "monkey"])
      expect(secretFieldName(name), name).toBe(false);
    expect(withoutRegistrySecrets("p/.npmrc", "registry=https://r.example/\n//r.example/:_authToken=FAKE\n")).toBe("registry=https://r.example/\n");
    expect(withoutRegistrySecrets("p/.npmrc", "registry=https://r.example/\n")).toBeNull();
    expect(savedSignInPath("principals/pr_ana/claude/skills/gh/SKILL.md")).toBe(false);
    expect(savedSignInPath("principals/pr_ana/codex/.config/gh/hosts.yml")).toBe(true);
    expect(savedSignInPath("vm-home/talk.key")).toBe(false);
    const args = JSON.parse(withoutEngineSecrets("org/claude/.mcp.json", JSON.stringify({ mcpServers: { g: { command: "docker", args: ["run", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN=FAKE_SECRET_1", "--header", "X-API-Key: FAKE_SECRET_2", "-e", "LOG_LEVEL=debug", "img"] } } }))!);
    expect(args.mcpServers.g.args).toEqual(["run", "-e", "--header", "-e", "LOG_LEVEL=debug", "img"]);
  });

  it("counts what to reconnect by category, a person once and an engine sign-in once per engine home", () => {
    expect(secretCategory("principals/pr_ana/claude/.credentials.json")).toBe("engines");
    expect(secretCategory("principals/pr_ana/connections.enc")).toBe("connections");
    expect(secretCategory("principals/pr_ana/capabilities.enc")).toBe("connections");
    expect(savedSignInPath("principals/pr_ana/capabilities.enc")).toBe(true);
    expect(secretCategory("principals/pr_ana/credential-vault.enc")).toBe("credentialVault");
    expect(secretCategory("org-github-tokens.enc")).toBe("github");
    expect(secretCategory("push-devices/pr_ana.json")).toBe("phones");
    expect(secretCategory("media-proxy.key")).toBeNull();
    const tally = new ReconnectTally();
    for (const path of ["principals/pr_ana/claude/.credentials.json", "principals/pr_ana/claude/.pulsabot-login.json", "principals/pr_ana/codex/auth.json",
      "principals/pr_bo/claude/.credentials.json", "principals/pr_ana/connections.enc", "principals/pr_bo/connections.enc", "marketplace-tokens.enc", "agent-api.key"]) tally.path(path);
    tally.count("providerKeys", 2);
    expect(tally.result()).toEqual({ engines: { count: 3, people: 2 }, connections: { count: 2, people: 2 }, github: { count: 1 }, providerKeys: { count: 2 } });
    expect(configSecretCounts({ xai: { key: "FAKE_SECRET_DO_NOT_USE_1" }, mail: { password: "FAKE_SECRET_DO_NOT_USE_2" }, language: "fr", profile: { name: "A" },
      mcpServers: { a: { env: { A: "FAKE_SECRET_DO_NOT_USE_3" } }, b: { command: "b" } }, instances: { c: { environment: { K: "FAKE_SECRET_DO_NOT_USE_4" } }, d: { driver: "x" } } }))
      .toEqual({ providerKeys: 3, mcp: 1 });
  });

  it.each(["attachments/key.txt", "workspaces/bot/notes.md", "workspaces/bot/external-runtimes.json", "vm-home/project/config.json", "config.json", "webhooks.json"])("does not redact arbitrary user file %s", (path) => {
    expect(excludedWorkspaceAuthPath(path)).toBe(false);
  });
});
