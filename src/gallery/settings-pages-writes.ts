/** The Settings gallery's writes (#4376): a rename, a model switch, a key
 * saved or removed change its stand-in /api in memory, so the real renderer
 * can be driven through them headless (scripts/testing/providers-ui.e2e.test.ts)
 * and a capture shows the page after them. Fictional data only. */
type Api = Record<string, unknown>;
type Instance = { instanceId: string; displayName: string };

/** Renames outlive a page load in this tab, so a capture or a test can
 * open the model menu (?picker=bar) after renaming on Providers. */
const NAMES_KEY = "sagax.gallery.accountNames";
const storedNames = (): Record<string, string> => {
  try { return JSON.parse(sessionStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
};
const storeName = (instanceId: string, name: string) => {
  try { sessionStorage.setItem(NAMES_KEY, JSON.stringify({ ...storedNames(), [instanceId]: name })); } catch { /* private window */ }
};

/** Gives the stand-in /api the names given earlier in this tab. */
export function applyStoredGalleryNames(api: Api): void {
  const names = storedNames();
  const instances = (api["/api/instances"] as { instances: Instance[] } | undefined)?.instances ?? [];
  for (const instance of instances) if (names[instance.instanceId]) instance.displayName = names[instance.instanceId]!;
}

/** "Runs with" defaults saved in this page (#4384). */
let galleryHarness: Record<string, string> | null = null;
let galleryContext: Record<string, number> = {};
/** #5014: the person's account strategy per provider (Providers > a provider > Accounts). */
let galleryAccountSwitch: Record<string, { strategy: string; threshold: number }> = {};

const parse = (init?: RequestInit): Record<string, unknown> => {
  try { return typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {}; } catch { return {}; }
};

/** The answer to a write, or undefined when the gallery does not keep it. */
export function answerGalleryWrite(api: Api, url: URL, init?: RequestInit): unknown {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET") return undefined;
  const body = parse(init);
  const instances = (api["/api/instances"] as { instances: Instance[] } | undefined)?.instances ?? [];
  const config = api["/api/config"] as Record<string, unknown>;

  // an account's name: the engine's own (solo), the person's own (organization)
  const patch = /^\/api\/instances\/([\w.-]+)$/.exec(url.pathname);
  if (method === "PATCH" && patch && typeof body.displayName === "string") {
    const instance = instances.find((entry) => entry.instanceId === patch[1]);
    if (!instance) return { error: "unknown instance" };
    instance.displayName = body.displayName.trim();
    storeName(instance.instanceId, instance.displayName);
    return { instances };
  }
  const named = /^\/api\/me\/engines\/([\w.-]+)\/name$/.exec(url.pathname);
  if (method === "PUT" && named && typeof body.name === "string") {
    const instance = instances.find((entry) => entry.instanceId === named[1]);
    const engines = (api["/api/me/engines"] as { engines: Instance[] } | undefined)?.engines ?? [];
    const engine = engines.find((entry) => entry.instanceId === named[1]);
    const name = body.name.trim();
    if (instance && name) { instance.displayName = name; storeName(instance.instanceId, name); }
    if (engine && name) engine.displayName = name;
    return { ok: true, ...(name ? { displayName: name } : {}) };
  }

  // a key engine's own key (EngineApiKeyField): the engine is ready once it has one
  const engineKey = /^\/api\/instances\/([\w.-]+)\/api-key$/.exec(url.pathname);
  if (method === "POST" && engineKey) {
    const configured = typeof body.key === "string" && body.key.trim().length > 0;
    api[url.pathname] = { configured };
    const instance = instances.find((entry) => entry.instanceId === engineKey[1]) as (Instance & { snapshot?: unknown }) | undefined;
    if (instance) instance.snapshot = configured ? { state: "available", authenticated: true } : { state: "unavailable", reason: "No API key." };
    return { configured };
  }

  // a model switch (Active models and a provider's page)
  if (method === "PUT" && url.pathname === "/api/me/models" && Array.isArray(body.disabledModels)) {
    config.myDisabledModels = body.disabledModels;
    return { mine: body.disabledModels };
  }
  // "Runs with" on a provider's page (#4384): the person's default per provider
  if (method === "PUT" && url.pathname === "/api/me/models" && body.harnessByProvider && typeof body.harnessByProvider === "object") {
    const saved = { ...galleryHarness, ...(body.harnessByProvider as Record<string, string>) };
    galleryHarness = saved;
    return { mine: config.myDisabledModels ?? [], harnessByProvider: saved };
  }

  // "Context size" on a provider's page (#4417): the person's default per provider
  if (method === "PUT" && url.pathname === "/api/me/models" && body.contextByProvider && typeof body.contextByProvider === "object") {
    const next = { ...galleryContext };
    for (const [provider, size] of Object.entries(body.contextByProvider as Record<string, number | null>)) {
      if (size === null) delete next[provider];
      else next[provider] = size;
    }
    galleryContext = next;
    return { mine: config.myDisabledModels ?? [], contextByProvider: next };
  }

  // #5014: the account strategy on a provider's page, the person's own
  if (method === "PUT" && url.pathname === "/api/me/models" && body.accountSwitchByProvider && typeof body.accountSwitchByProvider === "object") {
    const next = { ...galleryAccountSwitch };
    for (const [provider, setting] of Object.entries(body.accountSwitchByProvider as Record<string, { strategy: string; threshold: number } | null>)) {
      if (setting === null) delete next[provider];
      else next[provider] = { strategy: setting.strategy ?? "high-water", threshold: setting.threshold ?? 80 };
    }
    galleryAccountSwitch = next;
    return { mine: config.myDisabledModels ?? [], accountSwitchByProvider: next };
  }

  // the person's own key for a provider
  const personalKey = /^\/api\/me\/providers\/keys\/([^/]+)$/.exec(url.pathname);
  if (personalKey) {
    const provider = decodeURIComponent(personalKey[1]!);
    const view = api["/api/me/providers"] as { keys: Array<{ provider: string; last4: string | null }>; servers: unknown[] };
    view.keys = view.keys.filter((key) => key.provider !== provider);
    if (method === "PUT" && typeof body.key === "string") view.keys.push({ provider, last4: body.key.trim().slice(-4) || null });
    // on a solo server the person's key for a vendor is the server's (provider-rows.ts)
    const own = config[provider] as { configured?: boolean } | undefined;
    if (own && typeof own === "object" && "configured" in own) config[provider] = { ...own, configured: method === "PUT" };
    // and on an organization server the engines it pays for say whose key runs them
    const drivers: Record<string, string[]> = { openai: ["codex"], anthropic: ["claudeAgent"], xai: ["grok", "grokAgent"] };
    const engines = (api["/api/me/engines"] as { engines: Array<Record<string, unknown>> } | undefined)?.engines ?? [];
    for (const engine of engines) {
      if (!drivers[provider]?.includes(String(engine.driver))) continue;
      engine.myKey = method === "PUT";
      if (method === "PUT") { engine.keyWhere = "perspicax"; if (engine.myTurns !== "subscription") engine.myTurns = "key"; }
      else { delete engine.keyWhere; if (engine.myTurns === "key") engine.myTurns = "none"; }
    }
    return { ...view, keys: [...view.keys] };
  }

  // a key of the server's list (ApiKeys.tsx saveCredential): { <section>: { key } }
  if (method === "PUT" && url.pathname === "/api/config") {
    for (const [section, value] of Object.entries(body)) {
      if (!value || typeof value !== "object") continue;
      const key = (value as { key?: unknown }).key;
      if (typeof key === "string") config[section] = { ...(config[section] as object | undefined), configured: key.trim().length > 0 };
    }
    // a new object, as the server's answer is: the store sees the change
    return { ...config };
  }
  return undefined;
}
