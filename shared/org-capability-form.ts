// The organization's capability declarations (Capabilities lot 4): the one
// field and validation definition of the form. Perspicax exports it for its
// console's "Capacites de l'organisation" (console/src/lib/capability-form.ts
// in the Perspicax repository); this is a mirror of that definition for
// Sagax's Organization scope (Plugins > Installed and Sources), which writes
// the same route (`/api/v1/pulsabot/capabilities`) through this server's
// link. Keep both identical: same fields, forms, limits and rules; only the
// message keys are namespaced `orgCapabilities.` here. Pure, no React.
// Perspicax checks every rule again; these keep a wrong value from leaving
// the form and say why next to its field.
//
// The execution configuration is write-only: the form never fills it from
// a saved declaration, an edit sends it only when the admin types a new one
// (`replaceConfiguration`), and an omitted one keeps what Perspicax sealed.

/** What a capability is. */
export const CAPABILITY_FORMS = ["plugin", "skill", "mcp"] as const;
export type CapabilityForm = (typeof CAPABILITY_FORMS)[number];

/** Offered: available, off by default for each person. Imposed: on, not
 *  removable by a member. */
export const CAPABILITY_MODES = ["offered", "imposed"] as const;
export type CapabilityMode = (typeof CAPABILITY_MODES)[number];

/** How an MCP server runs: a command in the person's environment, or a
 *  public address. */
export const MCP_TRANSPORTS = ["stdio", "http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** The marketplace policy: any, or only the allowed list. Null (never set)
 *  keeps Sagax's historical rules; it is never read as `any`. */
export const MARKETPLACE_MODES = ["any", "list"] as const;
export type MarketplaceMode = (typeof MARKETPLACE_MODES)[number];

/** The mount names of the one Pulsatrix Flow identity, served by Perspicax. */
export const FLOW_MOUNT_PREFIX = "pulsatrix-flow";

export const CAPABILITY_LIMITS = {
  mount: 64,
  name: 120,
  description: 2000,
  version: 64,
  url: 2048,
  marketplaceName: 64,
  skillPath: 256,
  skillBytes: 1024 * 1024,
} as const;

// ---- the API shapes (crates/gateway/openapi.json) --------------------------

export type CapabilitySource = { kind: "manual" } | { kind: "marketplace"; url: string; plugin: string; version?: string | null };
export type PluginValue = string | number | boolean;
export type CapabilityConfiguration =
  | { type: "plugin"; values?: Record<string, PluginValue> }
  | { type: "skill"; files: Record<string, string> }
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export interface CapabilityInput {
  mount_name: string;
  form: CapabilityForm;
  name: string;
  description?: string;
  source: CapabilitySource;
  mode: CapabilityMode;
  enabled: boolean;
  configuration?: CapabilityConfiguration;
}

export interface Capability {
  id: string;
  mount_name: string;
  form: CapabilityForm;
  name: string;
  description: string;
  source: CapabilitySource;
  scope: string;
  mode: CapabilityMode;
  enabled: boolean;
  configured: boolean;
  configuration_kind: string;
  created_at: string;
  updated_at: string;
}

export interface CapabilityMarketplace {
  id: string;
  source: string;
  name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceInput {
  source: string;
  name: string;
  enabled: boolean;
}

export interface CapabilityInventory {
  capabilities: Capability[];
  marketplaces: CapabilityMarketplace[];
  marketplace_policy: { mode: MarketplaceMode } | null;
}

export interface Changed<T> {
  value: T;
  changed: boolean;
}

export const CAPABILITIES_PATH = "/api/v1/pulsabot/capabilities";

// ---- the form ---------------------------------------------------------------

/** What the form holds. Text fields as typed; the configuration's fields
 *  start empty, on a new declaration as on an edit. */
export interface CapabilityDraft {
  mountName: string;
  form: CapabilityForm;
  name: string;
  description: string;
  mode: CapabilityMode;
  enabled: boolean;
  /** Plugin: the marketplace's address and the version (empty: latest). */
  marketplaceUrl: string;
  version: string;
  /** On an edit, send a new configuration; off keeps the sealed one. A new
   *  declaration always sends one (a plugin may leave its values empty). */
  replaceConfiguration: boolean;
  /** Plugin: `key=value` per line (true, false and numbers are typed). */
  pluginValues: string;
  /** Skill: SKILL.md, then other relative files. */
  skillFiles: { path: string; content: string }[];
  transport: McpTransport;
  /** Stdio: the command, one argument per line, `NAME=value` per line. */
  command: string;
  args: string;
  env: string;
  /** Remote: the public address and `Name: value` per line. */
  url: string;
  headers: string;
}

export type DraftField =
  | "mountName"
  | "form"
  | "name"
  | "description"
  | "mode"
  | "marketplaceUrl"
  | "version"
  | "pluginValues"
  | "skillFiles"
  | "transport"
  | "command"
  | "args"
  | "env"
  | "url"
  | "headers";

/** One field of the form: its message key prefix (`orgCapabilities.field.<key>`
 *  for the label, `.hint` for the hint), the forms it shows for, whether it
 *  is required, and whether it belongs to the write-only configuration. */
export interface FieldDef {
  key: DraftField;
  forms: readonly CapabilityForm[];
  transports?: readonly McpTransport[];
  required: boolean;
  configuration: boolean;
}

export const CAPABILITY_FIELDS: readonly FieldDef[] = [
  { key: "form", forms: CAPABILITY_FORMS, required: true, configuration: false },
  { key: "mountName", forms: CAPABILITY_FORMS, required: true, configuration: false },
  { key: "name", forms: CAPABILITY_FORMS, required: true, configuration: false },
  { key: "description", forms: CAPABILITY_FORMS, required: false, configuration: false },
  { key: "mode", forms: CAPABILITY_FORMS, required: true, configuration: false },
  { key: "marketplaceUrl", forms: ["plugin"], required: true, configuration: false },
  { key: "version", forms: ["plugin"], required: false, configuration: false },
  { key: "pluginValues", forms: ["plugin"], required: false, configuration: true },
  { key: "skillFiles", forms: ["skill"], required: true, configuration: true },
  { key: "transport", forms: ["mcp"], required: true, configuration: true },
  { key: "command", forms: ["mcp"], transports: ["stdio"], required: true, configuration: true },
  { key: "args", forms: ["mcp"], transports: ["stdio"], required: false, configuration: true },
  { key: "env", forms: ["mcp"], transports: ["stdio"], required: false, configuration: true },
  { key: "url", forms: ["mcp"], transports: ["http"], required: true, configuration: true },
  { key: "headers", forms: ["mcp"], transports: ["http"], required: false, configuration: true },
];

/** The fields the form shows for a draft. */
export function visibleFields(d: Pick<CapabilityDraft, "form" | "transport">): FieldDef[] {
  return CAPABILITY_FIELDS.filter((f) => f.forms.includes(d.form) && (!f.transports || f.transports.includes(d.transport)));
}

export function emptyDraft(form: CapabilityForm = "plugin"): CapabilityDraft {
  return {
    mountName: "",
    form,
    name: "",
    description: "",
    mode: "offered",
    enabled: true,
    marketplaceUrl: "",
    version: "",
    replaceConfiguration: true,
    pluginValues: "",
    skillFiles: [{ path: "SKILL.md", content: "" }],
    transport: "stdio",
    command: "",
    args: "",
    env: "",
    url: "",
    headers: "",
  };
}

/** The draft of a saved declaration: its public fields, never its
 *  configuration, which stays sealed until the admin replaces it. */
export function draftFromCapability(c: Capability): CapabilityDraft {
  const d = emptyDraft(c.form);
  d.mountName = c.mount_name;
  d.name = c.name;
  d.description = c.description;
  d.mode = c.mode;
  d.enabled = c.enabled;
  if (c.source.kind === "marketplace") {
    d.marketplaceUrl = c.source.url;
    d.version = c.source.version ?? "";
  }
  d.transport = c.configuration_kind === "http" ? "http" : "stdio";
  d.replaceConfiguration = false;
  return d;
}

/** What an error says: a key of the message files, with its values. */
export interface FieldError {
  key: string;
  vars?: Record<string, string | number>;
}
export type DraftErrors = Partial<Record<DraftField, FieldError>>;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A mount name: a letter or digit, then letters, digits, `.`, `_` or `-`. */
export function validMountName(v: string): boolean {
  return v.length <= CAPABILITY_LIMITS.mount && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
}

export function isFlowMount(v: string): boolean {
  const lower = v.toLowerCase();
  return lower === FLOW_MOUNT_PREFIX || lower.startsWith(`${FLOW_MOUNT_PREFIX}-`);
}

function privateIpv4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb") || h.startsWith("::ffff:");
}

/** A public HTTPS address without credentials, or the key of why not. */
export function publicHttpsError(raw: string): string | null {
  if (!raw) return "orgCapabilities.error.required";
  if (raw.length > CAPABILITY_LIMITS.url) return "orgCapabilities.error.too_long";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "orgCapabilities.error.url";
  }
  if (url.protocol !== "https:") return "orgCapabilities.error.https";
  if (url.username || url.password) return "orgCapabilities.error.credentials";
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (privateIpv4(host) || privateIpv6(host)) return "orgCapabilities.error.public_host";
  if (!host.startsWith("[") && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && (host === "localhost" || host.endsWith(".localhost") || !host.includes("."))) {
    return "orgCapabilities.error.public_host";
  }
  return null;
}

/** A skill file path: relative, `/` separated, no empty, `.` or `..`
 *  segment, no backslash, no drive. */
export function validSkillPath(p: string): boolean {
  return (
    p.length > 0 &&
    p.length <= CAPABILITY_LIMITS.skillPath &&
    !p.startsWith("/") &&
    !p.includes("\\") &&
    !p.includes(":") &&
    !CONTROL.test(p) &&
    p.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
}

/** `owner/repo`, `owner/*` or a public HTTPS address, or why not. */
export function marketplaceSourceError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "orgCapabilities.error.required";
  if (v.includes("://")) return publicHttpsError(v);
  const part = /^[A-Za-z0-9._-]{1,100}$/;
  const [owner, repo, extra] = v.split("/");
  if (extra !== undefined || !owner || !repo || !part.test(owner) || owner === "." || owner === "..") return "orgCapabilities.error.marketplace_source";
  if (repo !== "*" && (!part.test(repo) || repo === "." || repo === "..")) return "orgCapabilities.error.marketplace_source";
  return null;
}

/** Lines of `sep`-separated pairs; null when a line has no separator. */
function pairs(text: string, sep: string): [string, string][] | null {
  const out: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(sep);
    if (at <= 0) return null;
    out.push([line.slice(0, at).trim(), line.slice(at + sep.length).trim()]);
  }
  return out;
}

function pluginValues(text: string): Record<string, PluginValue> | null {
  const list = pairs(text, "=");
  if (!list) return null;
  const out: Record<string, PluginValue> = {};
  for (const [k, v] of list) {
    if (!k || k.length > 128) return null;
    out[k] = v === "true" ? true : v === "false" ? false : v !== "" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}

/** The errors of a draft, by field; empty when it can be sent. Each value
 *  is a message key, never a value of the draft. */
export function validateDraft(d: CapabilityDraft, creating: boolean): DraftErrors {
  const e: DraftErrors = {};
  const mount = d.mountName.trim();
  if (!mount) e.mountName = { key: "orgCapabilities.error.required" };
  else if (!validMountName(mount)) e.mountName = { key: "orgCapabilities.error.mount" };
  else if (isFlowMount(mount)) e.mountName = { key: "orgCapabilities.error.flow" };
  const name = d.name.trim();
  if (!name) e.name = { key: "orgCapabilities.error.required" };
  else if (name.length > CAPABILITY_LIMITS.name || CONTROL.test(name)) e.name = { key: "orgCapabilities.error.too_long" };
  if (d.description.trim().length > CAPABILITY_LIMITS.description) e.description = { key: "orgCapabilities.error.too_long" };
  if (d.form === "plugin") {
    const url = publicHttpsError(d.marketplaceUrl.trim());
    if (url) e.marketplaceUrl = { key: url };
    const v = d.version.trim();
    if (v.length > CAPABILITY_LIMITS.version || /\s/.test(v)) e.version = { key: "orgCapabilities.error.version" };
  }
  const sending = creating || d.replaceConfiguration;
  if (!sending) return e;
  if (d.form === "plugin" && pluginValues(d.pluginValues) === null) e.pluginValues = { key: "orgCapabilities.error.pairs", vars: { sep: "=" } };
  if (d.form === "skill") {
    const paths = d.skillFiles.map((f) => f.path.trim());
    let bytes = 0;
    for (const f of d.skillFiles) bytes += f.path.length + f.content.length;
    if (!paths.includes("SKILL.md")) e.skillFiles = { key: "orgCapabilities.error.skill_md" };
    else if (paths.some((p) => !validSkillPath(p))) e.skillFiles = { key: "orgCapabilities.error.skill_path" };
    else if (new Set(paths).size !== paths.length) e.skillFiles = { key: "orgCapabilities.error.skill_duplicate" };
    else if (bytes > CAPABILITY_LIMITS.skillBytes) e.skillFiles = { key: "orgCapabilities.error.too_long" };
  }
  if (d.form === "mcp" && d.transport === "stdio") {
    if (!d.command.trim()) e.command = { key: "orgCapabilities.error.required" };
    const env = pairs(d.env, "=");
    if (!env || env.some(([k]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) e.env = { key: "orgCapabilities.error.env" };
  }
  if (d.form === "mcp" && d.transport === "http") {
    const url = publicHttpsError(d.url.trim());
    if (url) e.url = { key: url };
    const headers = pairs(d.headers, ":");
    if (!headers || headers.some(([k]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k))) e.headers = { key: "orgCapabilities.error.pairs", vars: { sep: ":" } };
  }
  return e;
}

/** The configuration a draft sends, or undefined (an edit that keeps the
 *  sealed one). Call after `validateDraft` found nothing. */
export function draftConfiguration(d: CapabilityDraft, creating: boolean): CapabilityConfiguration | undefined {
  if (!creating && !d.replaceConfiguration) return undefined;
  switch (d.form) {
    case "plugin": {
      const values = pluginValues(d.pluginValues) ?? {};
      // A new plugin with no value takes its manifest's defaults.
      if (Object.keys(values).length === 0) return creating ? undefined : { type: "plugin", values: {} };
      return { type: "plugin", values };
    }
    case "skill":
      return { type: "skill", files: Object.fromEntries(d.skillFiles.map((f) => [f.path.trim(), f.content])) };
    case "mcp":
      if (d.transport === "http") {
        return { type: "http", url: d.url.trim(), headers: Object.fromEntries(pairs(d.headers, ":") ?? []) };
      }
      return {
        type: "stdio",
        command: d.command.trim(),
        args: d.args.split("\n").map((a) => a.trim()).filter(Boolean),
        env: Object.fromEntries(pairs(d.env, "=") ?? []),
      };
  }
}

/** The body of POST (creating) or PUT (an edit) for a valid draft. */
export function draftToInput(d: CapabilityDraft, creating: boolean): CapabilityInput {
  const mount = d.mountName.trim();
  const version = d.version.trim();
  const input: CapabilityInput = {
    mount_name: mount,
    form: d.form,
    name: d.name.trim(),
    description: d.description.trim(),
    source: d.form === "plugin" ? { kind: "marketplace", url: d.marketplaceUrl.trim(), plugin: mount, version: version || null } : { kind: "manual" },
    mode: d.mode,
    enabled: d.enabled,
  };
  const configuration = draftConfiguration(d, creating);
  if (configuration) input.configuration = configuration;
  return input;
}

/** The checks of an allowed marketplace's fields. */
export function validateMarketplace(m: MarketplaceInput): Partial<Record<"source" | "name", FieldError>> {
  const e: Partial<Record<"source" | "name", FieldError>> = {};
  const source = marketplaceSourceError(m.source);
  if (source) e.source = { key: source };
  const name = m.name.trim();
  if (!name) e.name = { key: "orgCapabilities.error.required" };
  else if (name.length > CAPABILITY_LIMITS.marketplaceName || CONTROL.test(name)) e.name = { key: "orgCapabilities.error.too_long" };
  return e;
}
