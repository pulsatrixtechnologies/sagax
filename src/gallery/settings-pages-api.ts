/** The stand-in /api of the Settings gallery (src/gallery/settings-pages.tsx),
 * also rendered by the one-card-level guard (#2175,
 * src/components/SettingsModal.oneCardLevel.dom.test.ts) so a page is checked
 * on the same data it is shot with. Fictional data only, neutral names.
 * `params`: the gallery's query (`providers=1`, `org=1`, `auto=1`, `keys=unreadable`,
 * `many=1` with providers=1: a realistic Providers list, eleven rows and more,
 * `botslink=none|off|org|paused-delivery`: the bots link's states, `noxai=1`:
 * no xAI account, `people=alone|others` (#4360): a server with no organization
 * whose owner is alone on it, or that has let one more person in,
 * `accounts=claude|claude-one|openai|openai-solo|xai` (#4415, #4426): a provider's Accounts). */
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
      tts: { configured: true, ready: true, voice: "", provider: "elevenlabs", keys: { elevenlabs: !params.get("empty"), fish: false } },
      live: { enabled: true, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 },
      imageGen: { configured: false },
      anthropic: { configured: !params.get("empty") },
      ...(params.get("org") ? { personalSettings: true, viewer: { role: "admin", operator: false, principalId: "p-1", email: "alex@example.com", name: "Alex Example", canCreateBots: true }, allowedEngines: ["claude", "codex", "grok", "compat-azure", ...(params.get("expired") ? ["grok-team"] : [])], disabledModels: ["compat-azure/gpt-4o"] } : {}),
      ...(params.get("people") && !params.get("org") ? { viewer: { role: "owner", operator: true, principalId: "p-1", email: "alex@example.com", name: "Alex Example", canCreateBots: true } } : {}),
      ...(params.get("providers") ? { myDisabledModels: ["compat-azure/o4-mini"] } : {}),
      ...(params.get("providers") ? {
        openai: { configured: true },
        openaiCompatServers: [
          { instanceId: "compat-azure", name: "Azure Foundry", url: "https://example-resource.openai.azure.com/openai/v1", configured: true },
          { instanceId: "personal-lab", name: "Home lab", url: "http://127.0.0.1:8002/v1", configured: true },
          ...(params.get("many") ? [{ instanceId: "compat-research", name: "Research cluster in the basement rack, second floor", url: "http://10.0.0.20:8080/v1", configured: true }] : []),
        ],
        // Server default recovery so Models shows a real Backup column (#2080).
        automaticRecovery: { enabled: true, backup: { instanceId: "grok", model: "grok-4" } },
      } : {}),
      features: {},
      onboarding: { completedAt: NOW - 30 * DAY, launchMode: "solo" },
      newBotDefaults: { profile: { modelSelection: { instanceId: "claude", model: "sonnet", effort: "medium" }, approvalMode: "ask" } },
    },
    "/api/instances": { instances: params.get("empty") ? [] : [
      // #4417: the sizes Claude Code runs a 1M model at (server/drivers/claude/config.ts)
      { instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", cliDefault: "claude", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "sonnet", options: [{ id: "opus", label: "Claude Opus 4.1", contextWindow: 1_000_000, contextWindows: [200_000, 1_000_000] }, { id: "sonnet", label: "Claude Sonnet 4.5", contextWindow: 1_000_000, contextWindows: [200_000, 1_000_000] }, { id: "haiku", label: "Claude Haiku 4.5" },
        // ?models=many: sixteen Claude models in all, the long list a provider can have
        ...(params.get("models") === "many" ? Array.from({ length: 13 }, (_, index) => ({ id: `claude-extra-${index}`, label: `Claude Model ${index + 1}` })) : [])] }, capabilities: { effortLevels: ["low", "medium", "high"] } },
      // &noxai=1 (#4329 lot 2): no xAI account here, for the bots link alone under its provider
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
      // &many=1 (#4329): a third Claude account with a long email, more keys and a long server name
      ...(params.get("providers") && params.get("many") ? [
        { instanceId: "claude-research", displayName: "Claude research", driverKind: "claudeAgent", cliDefault: "claude", access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "research.team.shared.account@example.com" } }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Claude Sonnet 4.5" }] } },
        { instanceId: "deepseek", displayName: "DeepSeek", driverKind: "deepseekAgent", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "deepseek-chat", options: [{ id: "deepseek-chat", label: "DeepSeek Chat" }] } },
        { instanceId: "openrouter", displayName: "OpenRouter", driverKind: "openai-compat", access: "api", snapshot: { state: "available", authenticated: false }, models: { default: "", options: [] } },
        { instanceId: "compat-research", displayName: "Research cluster in the basement rack, second floor", driverKind: "openai-compat", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "llama-4-70b", options: [{ id: "llama-4-70b", label: "Llama 4 70B", custom: true }, { id: "llama-4-8b", label: "Llama 4 8B", custom: true }] } },
      ] : []),
      // &bots=11 (#4384 review): OpenCode too, so a bot has three engines to pick from
      ...(params.get("providers") && params.get("bots") === "11" ? [
        { instanceId: "opencode", displayName: "OpenCode", driverKind: "opencodeGo", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "", options: [
          { id: "anthropic/opus", label: "Claude Opus 4.1" }, { id: "xai/grok-4", label: "Grok 4" },
        ] } },
      ] : []),
      // &keyonly=1 (#4376 review): a key engine with no key row of its own and no key yet
      ...(params.get("keyonly") ? [
        { instanceId: "meta", displayName: "Meta", driverKind: "meta", access: "api", snapshot: { state: "unavailable", reason: "No API key." }, models: { default: "", options: [] } },
      ] : []),
      // &expired=1 (#4376 review, with org=1): a second xAI account whose sign-in expired
      ...(params.get("expired") ? [
        { instanceId: "grok-team", displayName: "Grok team", driverKind: "grokAgent", cliDefault: "grok", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "grok-4", options: [{ id: "grok-4", label: "Grok 4" }] } },
      ] : []),
      // &pi=1 (#2983): the pi engine, so Providers shows Model servers for pi
      ...(params.get("pi") ? [
        { instanceId: "pi", displayName: "pi", driverKind: "piAgent", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "", options: [
          { id: "anthropic/opus", label: "Claude Opus 4.1" }, { id: "xai/grok-4", label: "Grok 4" }, { id: "mistral/mistral-large", label: "Mistral Large" },
          // a model server's row as pi names it (server/drivers/pi-model-servers.ts modelServerOptions)
          { id: "px-own-sx-0a1b2c3d4e/qwen-3.8-27b", label: "qwen-3.8-27b", custom: true, provider: "px-own-sx-0a1b2c3d4e", server: "oMLX on this Mac" },
        ] } },
      ] : []),
    ].filter((instance) => !(params.get("noxai") && instance.instanceId === "grok")) },
    ...(params.get("pi") ? { "/api/me/pi-model-servers": { servers: [
      { id: "sx-0a1b2c3d4e", name: "oMLX on this Mac", url: "http://127.0.0.1:8000/v1", configured: true, models: [{ id: "qwen-3.8-27b", contextWindow: 131072 }, { id: "qwen-3.8-7b" }], checkedAt: new Date(NOW - DAY).toISOString(), provider: "px-own-sx-0a1b2c3d4e" },
      { id: "sx-5f6a7b8c9d", name: "Ollama", url: "http://localhost:11434/v1", configured: false, models: [], provider: "px-own-sx-5f6a7b8c9d" },
    ] } } : {}),
    ...(params.get("keyonly") ? { "/api/instances/meta/api-key": { configured: false } } : {}),
    "/api/me/cloud-agent-providers": { providers: [] },
    // Providers > Advanced: the claude.ai connectors; Memes (Other services); the bots link (the xAI provider)
    "/api/me/harness-connectors": { manageUrl: "https://claude.ai/customize/connectors", canManage: true, enabled: true, claude: { available: true, connectors: [
      { name: "Gmail", status: "connected" }, { name: "Google Calendar", status: "connected" }, { name: "Notion", status: "needs_auth" }, { name: "Example Docs", status: "unknown" },
    ] }, codex: { available: false }, ...accountProviders(params.get("accounts")) },
    // &botslink=none|off|org|paused-delivery (#4329): the bots link line of the xAI group not linked, paused, turned off by the organization, delivery paused
    "/api/me/grok-bridge": params.get("botslink") === "none"
      ? { linked: false, enabled: false, orgAllowed: true, keySet: false, bots: [], mayCallOwner: false, mayTextOwner: false }
      : {
        linked: true, enabled: params.get("botslink") !== "off", orgAllowed: params.get("botslink") !== "org", webhookUrl: "https://bots.example.com/hook", keySet: true, bots: ["Scout"], mayCallOwner: false, mayTextOwner: true, linkId: "demo-link",
        stats: params.get("botslink") === "paused-delivery" ? { sentToday: 3, deadLetters: 2, circuitOpen: true } : { sentToday: 3, deadLetters: 0, circuitOpen: false },
      },
    "/api/me/memes": { provider: "giphy", keyConfigured: true, last4: "AB12", ready: true },
    // &org=1: an organization server, the viewer an admin with their own sign-ins
    ...(params.get("org") ? {
      "/api/org": { org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://perspicax.example.com" } }, link: { state: "ok" }, viewerRole: "admin", settings: {} },
      "/api/me/engines": { engines: [
        { instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true, subscription: { supported: true, signedIn: true, expired: true }, myKey: false, orgKey: true, myTurns: "org-key" },
        { instanceId: "codex", driver: "codex", displayName: "Codex", installed: true, subscription: { supported: true, signedIn: false }, myKey: true, keyWhere: "perspicax", orgKey: false, myTurns: "key" },
        { instanceId: "grok", driver: "grokAgent", displayName: "Grok", installed: true, subscription: { supported: true, signedIn: true }, myKey: false, orgKey: false, myTurns: "subscription" },
        { instanceId: "compat-azure", driver: "openaiCompat", displayName: "Azure Foundry", installed: true, subscription: { supported: false, signedIn: false }, myKey: false, orgKey: true, myTurns: "org-key" },
        ...(params.get("expired") ? [{ instanceId: "grok-team", driver: "grokAgent", displayName: "Grok team", installed: true, subscription: { supported: true, signedIn: true, expired: true }, myKey: false, orgKey: false, myTurns: "expired" }] : []),
      ] },
      "/api/me/voice-keys": { elevenlabs: { configured: true, last4: "9f3a" }, fish: { configured: false, last4: null }, xai: { configured: false, last4: null }, openai: { configured: false, last4: null } },
    } : {}),
    // &people=alone|others: the server's sign-in directory (#4360)
    ...(params.get("people") && !params.get("org") ? {
      "/api/org/invites": {
        org: { name: "" },
        people: [{ id: "p-1", role: "owner", email: "alex@example.com" }, ...(params.get("people") === "others" ? [{ id: "sam@example.com", role: "member", email: "sam@example.com" }] : [])],
        pendingInvites: [],
        viewerRole: "owner",
      },
    } : {}),
    "/api/me/providers": { keys: params.get("empty") ? [] : [{ provider: "elevenlabs", last4: "demo" }, { provider: "openai", last4: "demo" }], servers: [] },
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
      // &bots=11 (#4384 review): a real count of bots, several on a model another engine can run
      ...(params.get("providers") && params.get("bots") === "11" ? [
        { id: "bot-5", name: "Nimbus", section: "Clients", ownerUserId: "p-1", instanceId: "claude-work", model: "opus", threadId: "thread-5", modelSelection: { instanceId: "claude-work", model: "opus", effort: "medium" }, harness: "piAgent", fallback: [{ instanceId: "grok", model: "grok-4" }], threads: [], messages: [] },
        { id: "bot-6", name: "Orion", section: "Clients", ownerUserId: "p-1", instanceId: "grok", model: "grok-4", threadId: "thread-6", modelSelection: { instanceId: "grok", model: "grok-4", effort: "high" }, threads: [], messages: [] },
        { id: "bot-7", name: "Piper", section: "Clients", ownerUserId: "p-1", instanceId: "compat-azure", model: "gpt-4.1", threadId: "thread-7", modelSelection: { instanceId: "compat-azure", model: "gpt-4.1" }, threads: [], messages: [] },
        { id: "bot-8", name: "Quill", section: "Lab", ownerUserId: "p-1", instanceId: "claude", model: "opus", threadId: "thread-8", modelSelection: { instanceId: "claude", model: "opus", effort: "low" }, threads: [], messages: [] },
        { id: "bot-9", name: "Rowan", section: "Lab", ownerUserId: "p-1", instanceId: "grok", model: "grok-4", threadId: "thread-9", modelSelection: { instanceId: "grok", model: "grok-4" }, harness: "piAgent", threads: [], messages: [] },
        { id: "bot-10", name: "Sable", ownerUserId: "p-1", instanceId: "claude-work", model: "sonnet", threadId: "thread-10", modelSelection: { instanceId: "claude-work", model: "sonnet" }, threads: [], messages: [] },
      ] : []),
    ], groups: [], sections: params.get("providers") ? ["Clients", "Lab"] : ["Clients"] },
    ...Object.fromEntries(BOTS.map((_, index) => [`/api/bots/bot-${index}/auto-model`, {
      auto: params.has("auto"), pick: { instanceId: "claude", model: "opus", engineLabel: "Claude", modelLabel: "Claude Opus 4.1", role: "orchestration", tier: "top", reason: "strongest-own", via: params.has("org") ? "org-key" : "subscription", at: NOW },
      chain: [{ instanceId: "claude", engineLabel: "Claude", model: "opus", modelLabel: "Claude Opus 4.1" }, { instanceId: "compat-azure", engineLabel: "Azure Foundry", model: "gpt-4.1", modelLabel: "gpt-4.1" }],
      excluded: [{ instanceId: "codex", engineLabel: "Codex", reason: "reconnect" }, { instanceId: "mistral", engineLabel: "Mistral", reason: "credentials" }, { instanceId: "compat-azure", engineLabel: "Azure Foundry", model: "o4-mini", modelLabel: "o4-mini", reason: "modelOff" }], backups: [],
    }])),
    "/api/approval-rules": { rules },
    // &firstKey=1 (#4360): no key yet and no recent proof of the person
    "/api/security-keys": params.get("firstKey")
      ? { keys: [], classes: [], rpId: "localhost", needsSignIn: true }
      : { keys: [{ id: "key-1", name: "Desk key", createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 2 * DAY, rpId: "localhost", deviceType: "singleDevice" }], classes: ["money"], rpId: "localhost" },
    "/api/me/tool-grants": { grants: [
      { id: "tg-1", subject: { kind: "bot", id: "bot-0" }, scope: "agents:write", grantedBy: "p-1", grantedAt: NOW - 5 * DAY, state: "active" },
      { id: "tg-2", subject: { kind: "bot", id: "bot-1" }, scope: "files:read", grantedBy: "p-1", grantedAt: NOW - 9 * DAY, expiresAt: NOW + 20 * DAY, state: "active" },
    ], adminOnlyAreas: [] },
    // &vault=empty: nothing saved; &vault=full: an item of each kind, a
    // pending purchase and the history (#4094's captures)
    "/api/me/credentials/list": params.get("vault") === "empty" ? {
      items: [],
      wallets: { shop_pay: { chosen: false, ready: false, missing: "the Shop CLI" }, link: { chosen: false, ready: false, missing: "the Link CLI" } },
      onePassword: { available: false, reason: "absent" },
    } : {
      items: [
        ...(params.get("vault") === "full" ? [
          { id: "v-5", kind: "card", name: "Everyday card", domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, holder: "Alex Example" }, grants: [], createdAt: NOW - 4 * DAY, updatedAt: NOW - 4 * DAY },
          { id: "v-6", kind: "address", name: "Home", domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", address: { recipient: "Alex Example", line1: "1 Example Street", city: "Springfield", postal: "12345", country: "US" }, grants: [], createdAt: NOW - 3 * DAY, updatedAt: NOW - 3 * DAY },
          { id: "v-7", kind: "contact", name: "Work contact", domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", contact: { fullName: "Alex Example", email: "alex@example.com", phone: "+1 555 0100" }, grants: [], createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY },
        ] : []),
        { id: "v-1", kind: "login", name: "Docs portal", username: "alex", domains: ["docs.example.com"], hasPassword: true, hasTotp: true, hasApiKey: false, hasNotes: false, source: "local", grants: [grant("bot-0")], createdAt: NOW - 20 * DAY, updatedAt: NOW - 20 * DAY, lastUsedAt: NOW - DAY, lastUsedBy: "bot-0" },
        { id: "v-2", kind: "apiKey", name: "Weather API", domains: ["api.example.com"], hasPassword: false, hasTotp: false, hasApiKey: true, hasNotes: false, source: "local", grants: [grant("bot-1")], createdAt: NOW - 12 * DAY, updatedAt: NOW - 12 * DAY },
        { id: "v-4", kind: "login", name: "Example signup", username: "alex@example.com", domains: ["accounts.example.com"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", grants: [grant("bot-1")], createdAt: NOW - DAY, updatedAt: NOW - DAY },
        { id: "v-3", kind: "note", name: "Office wifi", domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: true, source: "local", grants: [], createdAt: NOW - 6 * DAY, updatedAt: NOW - 6 * DAY },
      ],
      wallets: { shop_pay: { chosen: true, ready: true, missing: "" }, link: { chosen: false, ready: false, missing: "the Link CLI" } },
      onePassword: { available: false, reason: "absent" },
      ...(params.get("vault") === "full" ? {
        payments: { defaultMethod: { type: "card", cardId: "v-5" }, bots: { "bot-0": { enabled: true, perPurchaseLimit: "100.00", perMonthLimit: "400.00" } } },
        methods: [
          { id: "card:v-5", type: "card", label: "Everyday card", detail: "visa ···· 4242", brand: "visa", last4: "4242", isDefault: true },
          { id: "wallet:shop_pay", type: "wallet", label: "Shop Pay", detail: "Connected", brand: "wallet", wallet: "shop_pay", isDefault: false, ready: true },
        ],
        purchases: [{ id: "pay_aaaaaaaaaaaaaaaa", botId: "bot-0", threadId: "thread-0", merchant: "Example Shop", domain: "shop.example.com", amount: "45.20", currency: "USD", cardName: "Everyday card", cardLast4: "4242", cardBrand: "visa", title: "Pay $45.20 to Example Shop with visa ···· 4242?", line: "2 items. Card ending 4242 (visa).", status: "pending", createdAt: NOW - 60_000 }],
        history: [{ id: "pay_bbbbbbbbbbbbbbbb", botId: "bot-0", threadId: "thread-0", merchant: "Example Books", domain: "books.example.com", amount: "28.00", currency: "USD", cardName: "Everyday card", cardLast4: "4242", cardBrand: "visa", title: "Pay $28.00 to Example Books?", line: "1 item.", status: "once", createdAt: NOW - DAY, doneAt: NOW - DAY, orderRef: "EX-1042" }],
      } : {}),
      ...(params.get("keys") === "unreadable" ? { unavailable: true } : {}),
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
  const accounts = params.get("accounts");
  if (accounts) Object.assign(API, accountScenes(accounts, API["/api/config"] as Record<string, unknown>, params.get("member") ? "member" : "admin"));
  return API;
}

/** &accounts=1|2|3|25|out (#4408): the providers list of the account
 * connectors, one to three providers signed in, one with 25 connectors, or
 * (out, with &org=1) Claude and OpenAI not signed in beside SpaceXSI: Claude's
 * sign-in expired, so its row on the page offers Sign in again and Advanced
 * draws nothing for it; ChatGPT was never signed in (its row waits under Add a
 * provider, the OpenAI row on the page is the person's key), so Advanced
 * holds its one Connect. */
function accountProviders(accounts: string | null): { providers?: unknown[] } {
  if (!accounts || !/^(\d+|out)$/.test(accounts)) return {};
  const claude = { provider: "claude-ai", vendor: "anthropic", manageUrl: "https://claude.ai/customize/connectors" };
  const openai = { provider: "chatgpt-apps", vendor: "openai", manageUrl: "https://chatgpt.com/#settings/Connectors" };
  const xai = { provider: "grok-com", vendor: "xai", manageUrl: "https://grok.com/connectors" };
  const lists = [
    { ...claude, available: true, connectors: [{ name: "Gmail", status: "connected" }, { name: "Google Calendar", status: "connected" }, { name: "Notion", status: "needs_auth" }, { name: "Example Docs", status: "unknown" }] },
    { ...openai, available: true, connectors: [{ name: "Notes", status: "connected" }, { name: "Example Drive", status: "connected" }] },
    { ...xai, available: true, connectors: [{ id: "outlook", name: "Outlook", status: "connected" }, { id: "microsoft-teams", name: "Microsoft Teams", status: "needs_auth" }] },
  ];
  // &accounts=25: one account with a real count, folded until opened
  if (accounts === "25") return { providers: [{ ...claude, available: true, connectors: Array.from({ length: 25 }, (_, index) => ({ name: `Example connector ${index + 1}`, status: index % 7 === 3 ? "needs_auth" : "connected" })) }] };
  if (accounts === "out") return { providers: [{ ...claude, available: false, reason: "not_signed_in", connectors: [] }, { ...openai, available: false, reason: "not_signed_in", connectors: [] }, lists[2]] };
  return { providers: lists.slice(0, Math.max(1, Math.min(3, Number(accounts) || 1))) };
}

/** &accounts=claude|claude-one|openai|openai-solo|xai (#4415, #4426): a provider's Accounts in
 * each state the owner met: several accounts all signed out, one sign-in
 * read by two engines (one row), a second sign-in of one engine, and the
 * answers a sign-in in progress gets (a pasted code, a device code, the
 * vendor's page alone). Removing answers that two bots still use it
 * (src/gallery/settings-pages.tsx). &member=1 shows them to an organization
 * member, who adds their own accounts too (#4435). Made-up names only. */
function accountScenes(scene: string, config: Record<string, unknown>, role: "admin" | "member"): Record<string, unknown> {
  const id = (driver: string, n: number) => `${driver}-0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const models = (prefix: string, label: string) => ({ default: `${prefix}-1`, options: [{ id: `${prefix}-1`, label }] });
  const engine = (instanceId: string, driverKind: string, displayName: string, signedIn: boolean, method?: string) => ({
    instanceId, displayName, driverKind, cliDefault: driverKind, access: "subscription",
    ...(method ? { authentication: { method } } : {}),
    snapshot: { state: "available", authenticated: signedIn }, models: models(instanceId, `${displayName} model`),
  });
  const pi = { instanceId: "pi", displayName: "pi", driverKind: "piAgent", access: "api", snapshot: { state: "available", authenticated: true }, models: { default: "anthropic/opus", options: [
    { id: "anthropic/opus", label: "Claude Opus 4.1" }, { id: "openai/gpt-5", label: "GPT-5" }, { id: "xai/grok-4", label: "Grok 4" },
  ] } };
  const mine = (instanceId: string, driver: string, displayName: string, signedIn: boolean, extra: Record<string, unknown> = {}) => ({
    instanceId, driver, displayName, installed: true, subscription: { supported: true, signedIn }, myKey: false, orgKey: false, myTurns: signedIn ? "subscription" : "none", ...extra,
  });
  const org = {
    "/api/config": { ...config, personalSettings: true, viewer: { role, operator: false, principalId: "p-1", email: "alex@example.com", name: "Alex Example", canCreateBots: true } },
    "/api/org": { org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://perspicax.example.com" } }, link: { state: "ok" }, viewerRole: role, settings: {} },
    "/api/me/voice-keys": { elevenlabs: { configured: false, last4: null }, fish: { configured: false, last4: null }, xai: { configured: false, last4: null }, openai: { configured: false, last4: null } },
  };
  const piMine = mine("pi", "piAgent", "pi", false, { subscription: { supported: false, signedIn: false }, myKey: true, keyWhere: "perspicax", myTurns: "key" });
  const waiting = (extra: Record<string, unknown>) => ({ auth: { phase: "waiting", flowId: "gallery-flow", expiresAt, ...extra } });
  if (scene === "claude") {
    const names = ["Claude", "Work", "Lab", "Side"];
    const ids = ["claude", id("claude", 1), id("claude", 2), id("claude", 3)];
    return {
      ...org,
      "/api/instances": { instances: [...ids.map((instanceId, at) => engine(instanceId, "claudeAgent", names[at]!, false)), pi] },
      "/api/me/engines": { engines: [...ids.map((instanceId, at) => mine(instanceId, "claudeAgent", names[at]!, false)), piMine] },
      "/api/me/providers": { keys: [], servers: [] },
      [`/api/me/engines/${ids[1]}/login/start`]: waiting({ authorizationUrl: "https://claude.ai/oauth/authorize?code=true" }),
      [`/api/me/engines/${ids[1]}/login/status`]: waiting({ authorizationUrl: "https://claude.ai/oauth/authorize?code=true" }),
    };
  }
  // #4426: a provider's only account, signed in: nothing to remove
  if (scene === "claude-one") {
    return {
      ...org,
      "/api/instances": { instances: [engine("claude", "claudeAgent", "Claude", true), pi] },
      "/api/me/engines": { engines: [mine("claude", "claudeAgent", "Claude", true), piMine] },
      "/api/me/providers": { keys: [], servers: [] },
    };
  }
  if (scene === "openai") {
    const added = id("chatgpt", 4);
    return {
      ...org,
      "/api/instances": { instances: [engine("codex", "codex", "Codex", true), engine("chatgpt", "codex", "ChatGPT plan", true), engine(added, "codex", "Side plan", false), pi] },
      "/api/me/engines": { engines: [mine("codex", "codex", "Codex", true), mine("chatgpt", "codex", "ChatGPT plan", true, { sharesSignInWith: "codex" }), mine(added, "codex", "Side plan", false), piMine] },
      "/api/me/providers": { keys: [], servers: [] },
      [`/api/me/engines/${added}/login/start`]: waiting({ authorizationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" }),
      [`/api/me/engines/${added}/login/status`]: waiting({ authorizationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" }),
    };
  }
  if (scene === "openai-solo") {
    const added = id("chatgpt", 5);
    return {
      "/api/instances": { instances: [engine("codex", "codex", "Codex", false, "device-code"), engine("chatgpt", "codex", "ChatGPT plan", false, "browser-pkce"), engine(added, "codex", "Side plan", false, "browser-pkce"), pi] },
      "/api/me/providers": { keys: [], servers: [] },
      "/api/instances/chatgpt/auth/start": waiting({ authorizationUrl: "https://auth.openai.com/api/accounts/authorize?client_id=app_example" }),
      "/api/instances/chatgpt/auth/status": waiting({ authorizationUrl: "https://auth.openai.com/api/accounts/authorize?client_id=app_example" }),
    };
  }
  if (scene === "xai") {
    return {
      ...org,
      "/api/instances": { instances: [engine("grok", "grokAgent", "Grok", false), pi] },
      "/api/me/engines": { engines: [mine("grok", "grokAgent", "Grok", false, { accounts: [{ slot: "primary", signedIn: false }, { slot: "second", signedIn: false }] }), piMine] },
      "/api/me/providers": { keys: [], servers: [] },
      "/api/me/engines/grok/login/start": waiting({ authorizationUrl: "https://accounts.x.ai/device?user_code=WXYZ-1234", userCode: "WXYZ-1234" }),
      "/api/me/engines/grok/login/status": waiting({ authorizationUrl: "https://accounts.x.ai/device?user_code=WXYZ-1234", userCode: "WXYZ-1234" }),
    };
  }
  return {};
}
