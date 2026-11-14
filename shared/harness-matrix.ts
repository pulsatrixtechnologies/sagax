// #4329 lot 0: which engine (the "harness", a driver kind) can run a bot
// with which kind of connection, as one table. Pure: no catalogue, no
// network. The design comment of #4329 (section 1) is the source; a pair
// it does not state is not in this table, and a pair turns on here only in
// the commit that makes it run.
//
// Marks: "works" runs today; "small" is a table entry or the reuse of a
// mechanism that exists; "larger" needs a new mechanism; "no" cannot, with
// its reason. Only "works" is offered to a person.
//
// Also here, because it is the same question asked from the key side: which
// person's or organization's key can pay which driver (`DRIVER_KEY_PROVIDERS`,
// read by server/engines/engine-credentials.ts for the turn's credential order).
import { localModelUnavailable } from "./local-model-engines.ts";

export type HarnessMark = "works" | "small" | "larger" | "no";

/** Where the server runs: one person's computer, or an organization server. */
export type HarnessPlace = "solo" | "organization";

/** How the person reads a harness: the vendor's own tool, pi, OpenCode, the
 * app's own runtime, or another tool. First-level words never name a tool. */
export type HarnessRole = "own" | "pi" | "opencode" | "builtin" | "tool";

/** The kind of connection a provider's models come through. */
export type HarnessSource =
  /** A sign-in to a subscription. `vendor` is the provider id
   * (shared/model-provider.ts); `driver` is the tool that holds it. */
  | { kind: "subscription"; vendor: string; driver: string }
  /** A key of that provider. */
  | { kind: "key"; vendor: string }
  /** A server added by address, by the protocol it speaks. */
  | { kind: "address"; protocol: "openai" | "anthropic" }
  /** An Azure resource. */
  | { kind: "azure" }
  /** This computer's models; `speaksAnthropic` when its server answers /v1/messages. */
  | { kind: "computer"; speaksAnthropic?: boolean };

export interface HarnessPair {
  /** The driver kind that runs the turn. */
  harness: string;
  role: HarnessRole;
  mark: HarnessMark;
  /** Why not, for a "no"; what is missing, for "small" and "larger". */
  reason?: string;
}

/** The app's own runtimes (the per-vendor API drivers and the OpenAI
 * protocol one). */
const BUILTIN_DRIVERS: ReadonlySet<string> = new Set(["openai-compat", "grok", "mistral", "cerebras", "groq", "meta", "minimax"]);

/** Which keys can pay which driver, in preference order. One table for the
 * server's credential order and for the app's provider rows. */
export const DRIVER_KEY_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  claudeAgent: ["anthropic"],
  codex: ["openai"],
  grokAgent: ["xai"],
  geminiAgent: ["google"],
  kimiAgent: ["moonshot"],
  grok: ["xai"],
  mistral: ["mistral"],
  cerebras: ["cerebras"],
  groq: ["groq"],
  opencodeGo: ["opencode"],
  cursorAgent: ["cursor"],
  droidAgent: ["factory"],
  minimax: ["minimax"],
  hermesAgent: ["openrouter", "glm", "zai"],
  // pi is BYOK across providers: any key the person keeps serves it, and the
  // model they pick decides which one a turn uses.
  // #2024: every provider pi serves natively from a key.
  piAgent: ["anthropic", "openai", "xai", "google", "moonshot", "openrouter", "mistral", "cerebras", "groq", "zai", "minimax", "opencode", "deepseek", "fireworks", "together", "huggingface", "nvidia", "kimi"],
};

/** The key providers that can pay a driver (empty when none can). */
export function keyProvidersOfDriver(driver: string): readonly string[] {
  return DRIVER_KEY_PROVIDERS[driver] ?? [];
}

/** The tool's own name, shown only where the harness is chosen and in
 * Advanced, never on the first level. A kind not listed falls back to the
 * instance's display name. */
export const HARNESS_TOOL_NAME: Readonly<Record<string, string>> = {
  claudeAgent: "Claude Code",
  claude: "Claude API",
  codex: "Codex",
  grokAgent: "Grok",
  grok: "xAI API",
  piAgent: "pi",
  "openai-compat": "OpenAI-compatible",
  mistral: "Mistral",
  groq: "Groq",
  cerebras: "Cerebras",
  meta: "Meta",
  antigravityAgent: "Antigravity",
  geminiAgent: "Gemini CLI",
  opencodeGo: "OpenCode",
  qwenAgent: "Qwen Code",
  clineAgent: "Cline",
  cursorAgent: "Cursor",
};

/** The vendor's own tool, per provider id, for the pairs of this table. */
const OWN_TOOL: Readonly<Record<string, string>> = {
  anthropic: "claudeAgent",
  openai: "codex",
  xai: "grokAgent",
  google: "geminiAgent",
  opencode: "opencodeGo",
};

/** The app's own runtime for a provider's key. */
const BUILTIN_FOR_KEY: Readonly<Record<string, string>> = {
  anthropic: "openai-compat",
  openai: "openai-compat",
  xai: "grok",
  openrouter: "openai-compat",
  mistral: "mistral",
  cerebras: "cerebras",
  groq: "groq",
  minimax: "minimax",
  meta: "meta",
};

/** The tools that take an OpenAI protocol address from Sagax for a turn
 * (server/drivers/local-inject.ts), besides pi and OpenCode. */
const ADDRESS_TOOLS = ["codex", "grokAgent", "kimiAgent", "qwenAgent", "droidAgent", "hermesAgent"] as const;

const SUBSCRIPTION_KEPT = "The vendor keeps subscription use to its own tools; offering it elsewhere would put the person's account at risk.";
const PLAN_NOT_KEY = "A subscription is not an API key.";
const PER_PLACE_KEY = "Solo: the key reaches OpenCode. Organization server: OpenCode is not yet in the key table and needs the key under the name it reads.";

export function harnessRole(driver: string, vendor?: string): HarnessRole {
  if (driver === "piAgent") return "pi";
  if (driver === "opencodeGo" && vendor !== "opencode") return "opencode";
  if (BUILTIN_DRIVERS.has(driver)) return "builtin";
  if (vendor && OWN_TOOL[vendor] === driver) return "own";
  return "tool";
}

type Row = { harness: string; mark: HarnessMark | Partial<Record<HarnessPlace, HarnessMark>>; reason?: string };

function rowsFor(source: HarnessSource): Row[] {
  switch (source.kind) {
    case "subscription":
      switch (source.vendor) {
        case "anthropic":
          return [
            { harness: "claudeAgent", mark: "works" },
            { harness: "piAgent", mark: "no", reason: SUBSCRIPTION_KEPT },
            { harness: "opencodeGo", mark: "no", reason: SUBSCRIPTION_KEPT },
            { harness: "openai-compat", mark: "no", reason: SUBSCRIPTION_KEPT },
          ];
        case "openai":
          return [
            { harness: "codex", mark: "works" },
            { harness: "piAgent", mark: "larger", reason: "pi signs in to this plan only inside its own screen; the server has no command to drive it. Hosted use needs the vendor's approval." },
            { harness: "opencodeGo", mark: "larger", reason: "OpenCode signs in to this plan only interactively. Hosted use needs the vendor's approval." },
            { harness: "openai-compat", mark: "no", reason: PLAN_NOT_KEY },
          ];
        case "xai":
          return [
            { harness: "grokAgent", mark: "works" },
            { harness: "piAgent", mark: "larger", reason: "A recent pi signs in to it; the pinned version must be checked." },
            { harness: "opencodeGo", mark: "no", reason: "OpenCode has no sign-in for it." },
            { harness: "grok", mark: "no", reason: PLAN_NOT_KEY },
          ];
        default:
          // The other tools' sign-ins: their own tool only.
          return [{ harness: source.driver, mark: "works" }];
      }
    case "key":
      switch (source.vendor) {
        case "anthropic":
          return [
            { harness: "openai-compat", mark: "small", reason: "The Anthropic protocol runtime exists; it is used for servers added by address." },
            { harness: "claudeAgent", mark: "works" },
            { harness: "piAgent", mark: "works" },
            { harness: "opencodeGo", mark: { solo: "works", organization: "small" }, reason: PER_PLACE_KEY },
          ];
        case "openai":
          return [
            { harness: "openai-compat", mark: "works" },
            { harness: "codex", mark: "works" },
            { harness: "piAgent", mark: "works" },
            { harness: "opencodeGo", mark: { solo: "works", organization: "small" }, reason: PER_PLACE_KEY },
          ];
        case "xai":
          return [
            { harness: "grok", mark: "works" },
            { harness: "grokAgent", mark: "works" },
            { harness: "piAgent", mark: "works" },
            { harness: "opencodeGo", mark: "small", reason: "The key name is reserved today." },
          ];
        case "google":
          return [
            { harness: "geminiAgent", mark: "works" },
            { harness: "piAgent", mark: "works" },
            { harness: "opencodeGo", mark: { solo: "works" } },
            { harness: "openai-compat", mark: "no", reason: "No built in runtime for this provider." },
          ];
        case "openrouter":
          return [
            { harness: "openai-compat", mark: "works" },
            { harness: "piAgent", mark: "works" },
            { harness: "hermesAgent", mark: "works" },
            { harness: "opencodeGo", mark: "small", reason: "Not yet in OpenCode's entry of the key table." },
          ];
        case "mistral":
        case "cerebras":
        case "groq":
        case "minimax":
          return [
            { harness: BUILTIN_FOR_KEY[source.vendor]!, mark: "works" },
            { harness: "piAgent", mark: "works" },
          ];
        case "meta":
          return [{ harness: "meta", mark: "works" }];
        case "opencode":
          return [
            { harness: "opencodeGo", mark: "works" },
            { harness: "piAgent", mark: "works" },
          ];
        default:
          return [];
      }
    case "address":
      if (source.protocol === "anthropic") {
        return [
          { harness: "openai-compat", mark: "works" },
          { harness: "claudeAgent", mark: "small", reason: "Claude's tool takes an Anthropic protocol address; feed it the address." },
        ];
      }
      return [
        { harness: "openai-compat", mark: "works" },
        { harness: "piAgent", mark: "works" },
        ...ADDRESS_TOOLS.map((harness): Row => ({ harness, mark: "small", reason: "The per-turn address injection exists for this computer's models; feed it the address." })),
        { harness: "opencodeGo", mark: "small", reason: "The per-turn address injection exists for this computer's models; feed it the address." },
        { harness: "claudeAgent", mark: "no", reason: "Claude's tool speaks only the Anthropic protocol." },
      ];
    case "azure":
      return [
        { harness: "openai-compat", mark: "works" },
        { harness: "piAgent", mark: "no", reason: "Azure's header and deployment list are handled only by the built in runtime." },
        { harness: "opencodeGo", mark: "no", reason: "Azure's header and deployment list are handled only by the built in runtime." },
      ];
    case "computer": {
      // One list with the turn guard: shared/local-model-engines.ts.
      const engines = ["piAgent", "codex", "grokAgent", "kimiAgent", "qwenAgent", "droidAgent", "hermesAgent", "opencodeGo", "claudeAgent"];
      return [
        ...engines.map((harness): Row => (localModelUnavailable(harness, "desktop", source.speaksAnthropic)
          ? { harness, mark: "no", reason: "Claude's tool needs a local server that answers the Anthropic protocol." }
          : { harness, mark: "works" })),
        { harness: "openai-compat", mark: "small", reason: "The built in runtime does not read this computer's models yet." },
      ];
    }
  }
}

function vendorOf(source: HarnessSource): string | undefined {
  return source.kind === "subscription" || source.kind === "key" ? source.vendor : undefined;
}

/** Every pair the table states for this connection, resolved for the place.
 * A pair stated only for the other place is left out. */
export function harnessPairs(source: HarnessSource, place: HarnessPlace): HarnessPair[] {
  const vendor = vendorOf(source);
  const pairs: HarnessPair[] = [];
  for (const row of rowsFor(source)) {
    const mark = typeof row.mark === "string" ? row.mark : row.mark[place];
    if (!mark) continue;
    pairs.push({ harness: row.harness, role: harnessRole(row.harness, vendor), mark, ...(row.reason && mark !== "works" ? { reason: row.reason } : {}) });
  }
  return pairs;
}

/** The harnesses a person may pick for this connection: the "works" pairs. */
export function offeredHarnesses(source: HarnessSource, place: HarnessPlace): HarnessPair[] {
  return harnessPairs(source, place).filter((pair) => pair.mark === "works");
}

/** Whether this driver may run this connection here. */
export function harnessAllowed(source: HarnessSource, place: HarnessPlace, harness: string): boolean {
  return offeredHarnesses(source, place).some((pair) => pair.harness === harness);
}

/**
 * The recommended harness: the vendor's own tool for a signed-in account;
 * built in for a key, a server or Azure (else the own tool, else pi); for
 * this computer, the engine the bot already uses when it can run it. Null
 * when nothing can.
 */
export function recommendedHarness(source: HarnessSource, place: HarnessPlace, current?: string): string | null {
  const offered = offeredHarnesses(source, place);
  if (!offered.length) return null;
  if (source.kind === "computer") return offered.find((pair) => pair.harness === current)?.harness ?? offered[0]!.harness;
  if (source.kind === "subscription") return offered.find((pair) => pair.role === "own")?.harness ?? offered[0]!.harness;
  const order: HarnessRole[] = ["builtin", "own", "pi", "opencode", "tool"];
  for (const role of order) {
    const pair = offered.find((entry) => entry.role === role);
    if (pair) return pair.harness;
  }
  return offered[0]!.harness;
}
