// #4329 (lot 3): the chat bar's model menu grouped by provider, from the
// one grouping (shared/model-provider.ts): who gives the models, never the
// tool that runs them. The accounts and engines of one provider are pooled:
// one model, one row, the others riding on it for "Runs with".
// (#2106 before it: several accounts of one sign-in folded to one section.)
import { describe, expect, it } from "vitest";
import { buildModelPickerSections, type ModelPickerSectionsInput } from "./buildSections";
import { setLocale } from "@/lib/i18n";
import type { InstanceInfo, ModelSelection } from "@/state/store";

setLocale("en");

const engine = (instanceId: string, driverKind: string, displayName: string, options: InstanceInfo["models"]["options"], extra: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId,
  displayName,
  driverKind,
  access: "subscription",
  snapshot: { state: "available", authenticated: true },
  models: { default: options[0]!.id, options },
  capabilities: { effortLevels: ["low", "medium", "high"] },
  ...extra,
} as InstanceInfo);

const claudeModels = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
];
const claudeA = engine("claude-a", "claudeAgent", "Work", claudeModels);
const claudeB = engine("claude-b", "claudeAgent", "Personal", claudeModels);
const claudeApi = engine("claudeApi", "claudeAgent", "Anthropic", [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }], { access: "api" });
const codex = engine("codex", "codex", "Codex", [{ id: "gpt-5.6", label: "GPT-5.6" }]);
const chatgpt = engine("chatgpt", "codex", "ChatGPT plan", [{ id: "gpt-5.6", label: "GPT-5.6" }, { id: "gpt-6", label: "GPT-6" }]);
const grok = engine("grok", "grokAgent", "Grok", [{ id: "grok-4.7", label: "Grok 4.7" }]);
const pi = engine("pi", "piAgent", "pi", [
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "openai/gpt-5.6", label: "GPT-5.6" },
  { id: "mistral/mistral-large", label: "Mistral Large" },
], { access: "custom" });
const server = engine("srv-1", "openai-compat", "Home server", [{ id: "qwen3-coder", label: "Qwen3 Coder" }],
  { access: "custom", providerAccount: { provider: "openai", serverId: "home" } });
const local = (instance: InstanceInfo): InstanceInfo => ({ ...instance, models: { ...instance.models,
  options: [...instance.models.options, { id: "desk01::qwen", label: "Qwen", custom: true, local: true, anthropic: true }] } });

function input(selectable: InstanceInfo[], selection: ModelSelection, favoriteKeys: string[] = []): ModelPickerSectionsInput {
  const bot = { id: "bot-1", name: "Scout", threadId: "t1", modelSelection: selection };
  return {
    orgMode: false,
    accountModels: new Map(),
    selection,
    switches: {},
    autoOn: false,
    follows: undefined,
    selectedVariantLabel: undefined,
    fallback: undefined,
    instances: selectable,
    selectable,
    viewerLocal: false,
    autoPreview: null,
    autoRecord: null,
    profile: bot as ModelPickerSectionsInput["profile"],
    botModelInstance: selectable[0],
    botModelName: "",
    health: { orgMode: false, myEngines: null },
    myEngines: null,
    ranOnName: () => "",
    favoriteKeys,
  };
}
const keys = (sections: ReturnType<typeof buildModelPickerSections>["menuSections"]) => sections.map((section) => section.key);
const section = (sections: ReturnType<typeof buildModelPickerSections>["menuSections"], key: string) => sections.find((candidate) => candidate.key === key)!;

describe("the chat bar menu by provider (#4329)", () => {
  it("pools Claude's accounts and key under one Claude provider, one row per model, Favorites under Auto", () => {
    const { menuSections } = buildModelPickerSections(input([claudeA, claudeB, claudeApi], { instanceId: "claude-a", model: "claude-sonnet-5" }, ["claude-a\u0000claude-opus-5"]));
    expect(keys(menuSections)).toEqual(["top", "favorites", "anthropic"]);
    expect(menuSections[0]!.rows.some((row) => row.kind === "auto")).toBe(true);
    expect(menuSections[1]!.rows.map((row) => row.modelId)).toEqual(["claude-opus-5"]);
    const claude = section(menuSections, "anthropic");
    expect(claude.label).toBe("Claude");
    expect(claude.note).toBeUndefined();
    expect(claude.rows.map((row) => [row.instanceId, row.modelId])).toEqual([["claude-a", "claude-sonnet-5"], ["claude-a", "claude-opus-5"]]);
    expect(claude.rows[0]!.current).toBe(true);
    expect(claude.rows[0]!.alternatives?.map((row) => row.instanceId)).toEqual(["claude-b", "claudeApi"]);
  });

  it("names OpenAI once for its two sign-ins, never Codex, and the xAI group by its label", () => {
    const { menuSections } = buildModelPickerSections(input([grok, chatgpt, codex], { instanceId: "grok", model: "grok-4.7" }));
    expect(keys(menuSections)).toEqual(["top", "openai", "xai"]);
    expect(menuSections.map((candidate) => candidate.label)).toEqual([undefined, "OpenAI", "SpaceXAI"]);
    expect(section(menuSections, "openai").rows.map((row) => row.modelId)).toEqual(["gpt-5.6", "gpt-6"]);
    const words = JSON.stringify(menuSections.map(({ label, note, rows }) => ({ label, note, rows: rows.map((row) => [row.label, row.detail]) })));
    expect(words).not.toMatch(/Codex|Claude Code|ChatGPT plan|Harness|API key/);
  });

  it("lands each pi row under the vendor before its slash, pooled with the vendor's own tool", () => {
    const { menuSections } = buildModelPickerSections(input([claudeA, codex, pi], { instanceId: "claude-a", model: "claude-opus-5" }));
    expect(keys(menuSections)).toEqual(["top", "anthropic", "openai", "mistral"]);
    const opus = section(menuSections, "anthropic").rows.find((row) => row.modelId === "claude-opus-5")!;
    expect(opus).toMatchObject({ instanceId: "claude-a", harness: "claudeAgent", current: true });
    expect(opus.alternatives?.map((row) => [row.instanceId, row.modelId, row.harness])).toEqual([["pi", "anthropic/claude-opus-5", "piAgent"]]);
    // a vendor only pi reaches is a provider of its own
    expect(section(menuSections, "mistral").rows.map((row) => row.modelId)).toEqual(["mistral/mistral-large"]);
    // the row does not repeat the provider the heading names
    expect(opus.alternatives![0]!.detail ?? "").not.toMatch(/anthropic/i);
  });

  it("draws a pooled model with the engine the bot runs on, so a pick keeps what runs it", () => {
    const { menuSections } = buildModelPickerSections(input([claudeA, codex, pi], { instanceId: "pi", model: "mistral/mistral-large" }));
    const gpt = section(menuSections, "openai").rows[0]!;
    expect(gpt).toMatchObject({ instanceId: "pi", modelId: "openai/gpt-5.6", harness: "piAgent" });
    expect(gpt.alternatives?.map((row) => row.instanceId)).toEqual(["codex"]);
  });

  it("puts a server the person added under its own name, and this computer's models last, once each", () => {
    const { menuSections } = buildModelPickerSections(input([local(claudeA), server, local(grok)], { instanceId: "claude-a", model: "claude-sonnet-5" }));
    expect(keys(menuSections)).toEqual(["top", "anthropic", "xai", "server:home", "computer"]);
    expect(section(menuSections, "server:home").label).toBe("Home server");
    const computer = section(menuSections, "computer");
    expect(computer.label).toBe("This computer");
    expect(computer.rows.map((row) => [row.instanceId, row.modelId])).toEqual([["claude-a", "desk01::qwen"]]);
    expect(computer.rows[0]!.alternatives?.map((row) => row.instanceId)).toEqual(["grok"]);
    expect(computer.rows[0]!.tags ?? []).not.toContain("Local");
  });

  it("keeps a favorite starred on an engine now pooled under another row", () => {
    const { menuSections } = buildModelPickerSections(input([claudeA, claudeApi], { instanceId: "claude-a", model: "claude-opus-5" }, ["claudeApi\u0000claude-sonnet-5"]));
    expect(section(menuSections, "favorites").rows.map((row) => [row.instanceId, row.modelId])).toEqual([["claudeApi", "claude-sonnet-5"]]);
  });
});
