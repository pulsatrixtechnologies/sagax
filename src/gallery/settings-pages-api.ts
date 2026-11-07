/** The stand-in /api of the Settings gallery (src/gallery/settings-pages.tsx),
 * also rendered by the one-card-level guard (#2175,
 * src/components/SettingsModal.oneCardLevel.dom.test.ts) so a page is checked
 * on the same data it is shot with. Fictional data only, neutral names.
 * `params`: the gallery's query (`providers=1`, `org=1`, `auto=1`). */
export function settingsPagesApi(params: URLSearchParams): Record<string, unknown> {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 28, 14);
  const BOTS = ["Scout", "Atlas", "Juniper"];
  const RULE_TEXT = [
    "Run git status in its own folder", "Read files under ~/projects/site", "Open pages on docs.example.com",
    "Send a message to the Support team", "Run npm test", "Delete files in its scratch folder",
    "Change its own routine schedule", "Write to the shared notes", "Run the weekly report",
  ];
  const rules = Array.from({ length: 23 }, (_, index) => ({
    id: `rule-${index + 1}`,
    botId: `bot-${index % 3}`,
    botName: BOTS[index % 3],
    tool: "Bash",
    scope: { command: `step ${index + 1}` },
    behavior: index % 5 === 0 ? "deny" : index % 7 === 0 ? "ask" : "allow",
    description: `${RULE_TEXT[index % RULE_TEXT.length]}${index >= RULE_TEXT.length ? ` (${Math.floor(index / RULE_TEXT.length) + 1})` : ""}`,
  }));

  const grant = (botId: string) => ({ botId, mode: "always", grantedAt: NOW - 3 * DAY });
  const API: Record<string, unknown> = {
    "/api/config": {
      profile: { name: "Alex Example", email: "alex@example.com" },
      box: { configured: false },
      vps: { configured: false, sshAlias: "" },
      rooms: { turnTimeoutMinutes: 5 },
      localVm: { mode: "shared", maxInstances: 2 },
      tts: { configured: true, ready: true, voice: "", provider: "elevenlabs", keys: { elevenlabs: true, fish: false } },
      live: { enabled: true, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 },
      imageGen: { configured: false },
      anthropic: { configured: true },
      ...(params.get("org") ? { personalSettings: true, viewer: { role: "admin", operator: false, principalId: "p-1", email: "alex@example.com", name: "Alex Example", canCreateBots: true }, allowedEngines: ["claude", "codex", "grok", "compat-azure"], disabledModels: ["compat-azure/gpt-4o"] } : {}),
      ...(params.get("providers") ? { myDisabledModels: ["compat-azure/o4-mini"] } : {}),
      ...(params.get("providers") ? {
        openai: { configured: true },
        openaiCompatServers: [
          { instanceId: "compat-azure", name: "Azure Foundry", url: "https://example-resource.openai.azure.com/openai/v1", configured: true },
          { instanceId: "personal-lab", name: "Home lab", url: "http://127.0.0.1:8002/v1", configured: true },
        ],
        // Server default recovery so Models shows a real Backup column (#2080).
        automaticRecovery: { enabled: true, backup: { instanceId: "grok", model: "grok-4" } },
      } : {}),
      features: {},
      onboarding: { completedAt: NOW - 30 * DAY, launchMode: "solo" },
      newBotDefaults: { profile: { modelSelection: { instanceId: "claude", model: "sonnet", effort: "medium" }, approvalMode: "ask" } },
    },
    "/api/instances": { instances: [
      { instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", cliDefault: "claude", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "sonnet", options: [{ id: "opus", label: "Claude Opus 4.1" }, { id: "sonnet", label: "Claude Sonnet 4.5" }, { id: "haiku", label: "Claude Haiku 4.5" }] }, capabilities: { effortLevels: ["low", "medium", "high"] } },
      { instanceId: "grok", displayName: "Grok", driverKind: "grokAgent", cliDefault: "grok", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "grok-4", options: [{ id: "grok-4", label: "Grok 4" }] }, capabilities: { effortLevels: ["low", "medium", "high"] } },
      // ?providers=1 (#2080): several accounts per provider (emails stay inside
      // the Claude group), a personal openai-compat server (Skye), Azure Foundry.
      ...(params.get("providers") ? [
        { instanceId: "claude-work", displayName: "alex_bots@example.com", driverKind: "claudeAgent", cliDefault: "claude", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "sonnet", options: [{ id: "opus", label: "Claude Opus 4.1" }, { id: "sonnet", label: "Claude Sonnet 4.5" }, { id: "haiku", label: "Claude Haiku 4.5" }] }, capabilities: { effortLevels: ["low", "medium", "high"] } },
        { instanceId: "codex", displayName: "Codex", driverKind: "codex", cliDefault: "codex", access: "subscription", snapshot: { state: "available", authenticated: false }, models: { default: "", options: [] } },
        { instanceId: "openai-api", displayName: "OpenAI (API key)", driverKind: "codex", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "", options: [] } },
        { instanceId: "mistral", displayName: "Mistral", driverKind: "mistral", access: "api", snapshot: { state: "available", authenticated: false }, models: { default: "", options: [] } },
        { instanceId: "compat-azure", displayName: "Azure Foundry", driverKind: "openai-compat", access: "api", capabilities: { withholdsHostTools: true }, snapshot: { state: "available", authenticated: true }, models: { default: "gpt-4.1", options: [{ id: "gpt-4.1", label: "gpt-4.1", custom: true }, { id: "gpt-4.1-mini", label: "gpt-4.1-mini", custom: true }, { id: "o4-mini", label: "o4-mini", custom: true }, { id: "gpt-4o", label: "gpt-4o", custom: true }] } },
        { instanceId: "personal-lab", displayName: "Home lab", driverKind: "openai-compat", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "qwen-3.8-27b", options: [{ id: "qwen-3.8-27b", label: "Qwen 3.8 27B", custom: true }] }, capabilities: { effortLevels: [] } },
      ] : []),
    ] },
    "/api/me/cloud-agent-providers": { providers: [] },
    // Providers > Advanced: the claude.ai connectors, the Grok Bot link (Advanced) and Memes (Other services)
    "/api/me/harness-connectors": { manageUrl: "https://claude.ai/customize/connectors", canManage: true, enabled: true, claude: { available: true, connectors: [
      { name: "Gmail", status: "connected" }, { name: "Google Calendar", status: "connected" }, { name: "Notion", status: "needs_auth" }, { name: "Example Docs", status: "unknown" },
    ] }, codex: { available: false } },
    "/api/me/grok-bridge": { linked: true, enabled: true, orgAllowed: true, webhookUrl: "https://bots.example.com/hook", keySet: true, bots: ["Scout"], mayCallOwner: false, mayTextOwner: true, linkId: "demo-link", stats: { sentToday: 3, deadLetters: 0, circuitOpen: false } },
    "/api/me/memes": { provider: "giphy", keyConfigured: true, last4: "AB12", ready: true },
    // &org=1: an organization server, the viewer an admin with their own sign-ins
    ...(params.get("org") ? {
      "/api/org": { org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://perspicax.example.com" } }, link: { state: "ok" }, viewerRole: "admin", settings: {} },
      "/api/me/engines": { engines: [
        { instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true, subscription: { supported: true, signedIn: true, expired: true }, myKey: false, orgKey: true, myTurns: "org-key" },
        { instanceId: "codex", driver: "codex", displayName: "Codex", installed: true, subscription: { supported: true, signedIn: false }, myKey: true, keyWhere: "perspicax", orgKey: false, myTurns: "key" },
        { instanceId: "grok", driver: "grokAgent", displayName: "Grok", installed: true, subscription: { supported: true, signedIn: true }, myKey: false, orgKey: false, myTurns: "subscription" },
        { instanceId: "compat-azure", driver: "openaiCompat", displayName: "Azure Foundry", installed: true, subscription: { supported: false, signedIn: false }, myKey: false, orgKey: true, myTurns: "org-key" },
      ] },
      "/api/me/voice-keys": { elevenlabs: { configured: true, last4: "9f3a" }, fish: { configured: false, last4: null }, xai: { configured: false, last4: null }, openai: { configured: false, last4: null } },
    } : {}),
    "/api/me/providers": { keys: [{ provider: "elevenlabs", last4: "demo" }, { provider: "openai", last4: "demo" }], servers: [] },
    "/api/voice/status": { provider: "xai", available: true, organization: params.has("org"), tts: "elevenlabs", stt: "openai", providers: { tts: ["openai", "elevenlabs", "system", "chatterbox"], stt: ["openai"] } },
    "/api/voice/voices": { voices: [{ id: "demo-voice", label: "Example voice", own: true }] },
    "/api/me/local-models": params.get("providers") ? { expose: true, share: false, connected: true, endpoints: [{ id: "omlx", baseUrl: "http://127.0.0.1:8000/v1", label: "Local server" }], published: [{ id: "omlx", label: "Local server", models: ["local-large", "local-fast"] }], probes: [] } : undefined,
    "/api/bots": { bots: [
      { id: "bot-0", name: "Scout", section: "Clients", ownerUserId: "p-1", instanceId: "claude", model: "sonnet", threadId: "thread-0", modelSelection: { instanceId: "claude", model: "sonnet", effort: "high" }, fallback: [{ instanceId: "grok", model: "grok-4" }], turnPayerDefault: "owner", turnPayer: "speaker", threads: [], messages: [] },
      { id: "bot-1", name: "Atlas", section: "Clients", ownerUserId: "p-1", instanceId: "grok", model: "grok-4", threadId: "thread-1", modelSelection: { instanceId: "grok", model: "grok-4", ...(params.has("auto") ? { auto: true } : {}) }, threads: [], messages: [] },
      { id: "bot-2", name: "Juniper", ownerUserId: "p-1", instanceId: "claude", model: "sonnet", threadId: "thread-2", modelSelection: { instanceId: params.get("providers") ? "claude-work" : "claude", model: "haiku" }, threads: [], messages: [] },
      ...(params.get("providers") ? [
        { id: "bot-3", name: "Skye", section: "Lab", ownerUserId: "p-1", instanceId: "personal-lab", model: "qwen-3.8-27b", threadId: "thread-3", modelSelection: { instanceId: "personal-lab", model: "qwen-3.8-27b" }, threads: [], messages: [] },
        { id: "bot-4", name: "Ember", section: "Lab", ownerUserId: "p-1", instanceId: "claude-work", model: "opus", threadId: "thread-4", modelSelection: { instanceId: "claude-work", model: "opus", effort: "high" }, threads: [], messages: [] },
      ] : []),
    ], groups: [], sections: params.get("providers") ? ["Clients", "Lab"] : ["Clients"] },
    ...Object.fromEntries(BOTS.map((_, index) => [`/api/bots/bot-${index}/auto-model`, {
      auto: params.has("auto"), pick: { instanceId: "claude", model: "opus", engineLabel: "Claude", modelLabel: "Claude Opus 4.1", role: "orchestration", tier: "top", reason: "strongest-own", via: params.has("org") ? "org-key" : "subscription", at: NOW },
      chain: [{ instanceId: "claude", engineLabel: "Claude", model: "opus", modelLabel: "Claude Opus 4.1" }, { instanceId: "compat-azure", engineLabel: "Azure Foundry", model: "gpt-4.1", modelLabel: "gpt-4.1" }],
      excluded: [{ instanceId: "codex", engineLabel: "Codex", reason: "reconnect" }, { instanceId: "mistral", engineLabel: "Mistral", reason: "credentials" }, { instanceId: "compat-azure", engineLabel: "Azure Foundry", model: "o4-mini", modelLabel: "o4-mini", reason: "modelOff" }], backups: [],
    }])),
    "/api/approval-rules": { rules },
    "/api/security-keys": { keys: [{ id: "key-1", name: "Desk key", createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 2 * DAY, rpId: "localhost", deviceType: "singleDevice" }], classes: ["money"], rpId: "localhost" },
    "/api/me/tool-grants": { grants: [
      { id: "tg-1", subject: { kind: "bot", id: "bot-0" }, scope: "agents:write", grantedBy: "p-1", grantedAt: NOW - 5 * DAY, state: "active" },
      { id: "tg-2", subject: { kind: "bot", id: "bot-1" }, scope: "files:read", grantedBy: "p-1", grantedAt: NOW - 9 * DAY, expiresAt: NOW + 20 * DAY, state: "active" },
    ], adminOnlyAreas: [] },
    "/api/me/credentials/list": {
      items: [
        { id: "v-1", kind: "login", name: "Docs portal", username: "alex", domains: ["docs.example.com"], hasPassword: true, hasTotp: true, hasApiKey: false, hasNotes: false, source: "local", grants: [grant("bot-0")], createdAt: NOW - 20 * DAY, updatedAt: NOW - 20 * DAY, lastUsedAt: NOW - DAY, lastUsedBy: "bot-0" },
        { id: "v-2", kind: "apiKey", name: "Weather API", domains: ["api.example.com"], hasPassword: false, hasTotp: false, hasApiKey: true, hasNotes: false, source: "local", grants: [grant("bot-1")], createdAt: NOW - 12 * DAY, updatedAt: NOW - 12 * DAY },
        { id: "v-4", kind: "login", name: "Example signup", username: "alex@example.com", domains: ["accounts.example.com"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", grants: [grant("bot-1")], createdAt: NOW - DAY, updatedAt: NOW - DAY },
        { id: "v-3", kind: "note", name: "Office wifi", domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: true, source: "local", grants: [], createdAt: NOW - 6 * DAY, updatedAt: NOW - 6 * DAY },
      ],
      wallets: { shop_pay: { chosen: true, ready: true, missing: "" }, link: { chosen: false, ready: false, missing: "the Link CLI" } },
      onePassword: { available: false, reason: "absent" },
    },
    // Settings > Developer > Per bot (#2658): the first bot's technical cards
    "/api/webhooks": { webhooks: [], attempts: [] },
    "/api/mcp/servers": { servers: [] },
    "/api/bots/bot-0/memory": {
      botId: "bot-0",
      workspacePath: "~/Sagax/Scout",
      index: { lines: 120, bytes: 6400, maxLines: 400, maxBytes: 32000, loadedLines: 120, loadedBytes: 6400, truncated: false, hash: "h1" },
      topics: [],
      logs: [
        { path: "memory/log/2026-11-06.md", name: "2026-11-06.md", bytes: 820, modifiedAt: NOW - DAY },
        { path: "memory/log/2026-11-05.md", name: "2026-11-05.md", bytes: 1310, modifiedAt: NOW - 2 * DAY },
      ],
    },
    "/api/bots/bot-0/memory/semantic": { enabled: true, encoder: "built-in", memoryPassages: 42, conversationPassages: 7 },
  };
  return API;
}
