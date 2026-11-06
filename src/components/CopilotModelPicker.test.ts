import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Children, createElement, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";
import { modelSwitchNeedsAsk } from "../../shared/approval-mode";
import { resolveCopilotModels } from "../../server/drivers/acp/copilot";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    instances: [] as InstanceInfo[],
    modelVariantSessions: {} as AppState["modelVariantSessions"],
    dispatch: vi.fn(),
  };
});
vi.mock("./MenuMotion", () => ({ useMenuMotion: () => ({ shown: true, closing: false, className: "", exitProps: {} }) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: fixture.modelVariantSessions },
    dispatch: fixture.dispatch,
    refreshInstances: vi.fn(() => Promise.resolve()),
    refreshModels: vi.fn(() => Promise.resolve()),
  }),
}));
const { ModelPicker, ModelVariantRow, modelSelectionForPick } = await import("./ModelPicker");

let home: string;
let discovered: InstanceInfo["models"];
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "sagax-copilot-picker-ui-"));
  discovered = await resolveCopilotModels({
    HOME: home, USERPROFILE: home, PATH: dirname(process.execPath),
    FAKE_ACP_MODELS: "auto,claude-haiku-4.5,gpt-5.6-luna",
    FAKE_ACP_VARIANTS: JSON.stringify({
      "gpt-5.6-luna": {
        id: "reasoning_effort", currentValue: "medium",
        options: [{ value: "low", name: "low" }, { value: "high", name: "high" }],
      },
    }),
  }, { cli: fileURLToPath(new URL("../../server/testing/fake-acp-cli.ts", import.meta.url)) });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (home) await rm(home, { recursive: true, force: true });
});
beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.modelVariantSessions = {};
});

const copilot = (): InstanceInfo => ({
  instanceId: "githubCopilot", displayName: "GitHub Copilot", driverKind: "copilotAgent", access: "subscription",
  snapshot: { state: "available", authenticated: true }, capabilities: { modelVariants: true }, models: discovered,
});
const claude = (): InstanceInfo => ({
  instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", access: "subscription",
  snapshot: { state: "available", authenticated: true },
  models: { default: "claude-sonnet-5", options: [{ id: "claude-sonnet-5", label: "Sonnet" }] },
});
const bot = (instanceId: string, model: string): Bot => ({
  id: "bot-hopper", threadId: "thread-hopper", name: "Hopper", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId, model },
});

it("lists the models Copilot advertised in the picker", () => {
  fixture.instances = [claude(), copilot()];
  const selected = bot("githubCopilot", "auto");
  const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: selected, threadId: selected.threadId }));
  expect(markup).toContain("claude-haiku-4.5");
  expect(markup).toContain("gpt-5.6-luna");
  expect(markup).toContain("GitHub Copilot");
});

it("offers the picked Copilot model's own effort levels", () => {
  fixture.instances = [copilot()];
  const selected = bot("githubCopilot", "gpt-5.6-luna");
  const row = ModelVariantRow({ bot: selected, threadId: selected.threadId, updateBotDefault: true, compact: true })!;
  const label = Children.toArray(row.props.children)[0] as ReactElement<{ children: ReactNode }>;
  const select = Children.toArray(label.props.children).at(-1) as ReactElement<{
    value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  }>;
  // Catalog order: low (0), high (1).
  select.props.onChange({ target: { value: "1" } } as ChangeEvent<HTMLSelectElement>);
  expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "setModel", botId: selected.id, threadId: selected.threadId, updateBotDefault: true,
    selection: { instanceId: "githubCopilot", model: "gpt-5.6-luna", variant: "high" },
  });
});

it("moves between Claude and Copilot without an approval reset for Ask and Auto", () => {
  fixture.instances = [claude(), copilot()];
  const toCopilot = modelSelectionForPick(bot("claude", "claude-sonnet-5").modelSelection, copilot(), "claude-haiku-4.5");
  expect(toCopilot).toEqual({ instanceId: "githubCopilot", model: "claude-haiku-4.5" });
  expect(modelSelectionForPick(toCopilot, claude(), "claude-sonnet-5")).toEqual({ instanceId: "claude", model: "claude-sonnet-5" });
  for (const mode of ["ask", "auto"] as const) {
    expect(modelSwitchNeedsAsk(mode, "claudeAgent", "copilotAgent")).toBe(false);
    expect(modelSwitchNeedsAsk(mode, "copilotAgent", "customAcp")).toBe(false);
    expect(modelSwitchNeedsAsk(mode, "customAcp", "claudeAgent")).toBe(false);
    expect(modelSwitchNeedsAsk(mode, "copilotAgent", "claudeAgent")).toBe(false);
  }
  // Full access runs on every engine (omb #2808 / PRO-RÈGLE), including bare ACP
  // Copilot: switching engines keeps Full without an Ask reset.
  expect(modelSwitchNeedsAsk("full", "claudeAgent", "copilotAgent")).toBe(false);
});
