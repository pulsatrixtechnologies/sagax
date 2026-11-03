// What the Context pod may list. Every number is a size already in memory
// when the turn is built: prompt sections the server assembled, the tool
// definitions that turn would mount, and how many messages it handed over.
// A bucket with nothing measured is left out. Nothing here is a share of
// the model's window.
import { AGENT_API_TOOL_NAMES, availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";

export const CONTEXT_BUCKET_KEYS = ["messages", "messageBytes", "tools", "memory", "skills", "agents", "prompt"] as const;
export type ContextBucketKey = typeof CONTEXT_BUCKET_KEYS[number];
export type ContextBuckets = Partial<Record<ContextBucketKey, number>>;

const MEMORY_SECTIONS = new Set(["memory", "team-memory"]);
const SKILL_SECTIONS = new Set(["skills", "skill-instructions"]);
const KEYS = new Set<string>(CONTEXT_BUCKET_KEYS);

const whole = (value: number | undefined): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;

/** Keep only real positive counts. A missing or empty object is undefined,
 * so a turn that measured nothing does not wipe the previous reading. */
export function contextBuckets(value: unknown): ContextBuckets | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: ContextBuckets = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!KEYS.has(key)) continue;
    const count = whole(typeof raw === "number" ? raw : Number.NaN);
    if (count > 0) out[key as ContextBucketKey] = count;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Bytes of the tool definitions already loaded for this turn's catalog,
 * split into agent tools and the rest. No catalog in memory: nothing. */
export function toolDefinitionBytes(env: NodeJS.ProcessEnv | undefined): { tools?: number; agents?: number } {
  if (!env) return {};
  let tools = 0;
  let agents = 0;
  for (const tool of availableTools(catalogProfileFromEnv(env))) {
    const size = Buffer.byteLength(JSON.stringify(tool));
    if (AGENT_API_TOOL_NAMES.has(tool.name)) agents += size;
    else tools += size;
  }
  return { ...(tools > 0 ? { tools } : {}), ...(agents > 0 ? { agents } : {}) };
}

/** The buckets a turn can actually name. Sections are the prompt parts
 * already built (their byte sizes). `messages` is a count, not a byte size;
 * `messageBytes` is the size of the messages the turn handed over. */
export function measureContextBuckets(input: {
  sections?: ReadonlyArray<{ id: string; bytes?: number; text?: string }>;
  promptBytes?: number;
  messages?: number;
  messageBytes?: number;
  toolsBytes?: number;
  agentsBytes?: number;
}): ContextBuckets | undefined {
  let memory = 0;
  let skills = 0;
  for (const section of input.sections ?? []) {
    const size = whole(section.bytes) || (typeof section.text === "string" && section.text ? Buffer.byteLength(section.text) : 0);
    if (MEMORY_SECTIONS.has(section.id)) memory += size;
    else if (SKILL_SECTIONS.has(section.id)) skills += size;
  }
  return contextBuckets({
    messages: input.messages,
    messageBytes: input.messageBytes,
    tools: input.toolsBytes,
    memory,
    skills,
    agents: input.agentsBytes,
    prompt: input.promptBytes,
  });
}
