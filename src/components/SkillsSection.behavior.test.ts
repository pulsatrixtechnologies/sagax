import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsLibrarySkillWire } from "../../shared/wire";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, modal: vi.fn(), request: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = initial;
    return [fixture.values[index], (next: unknown) => { fixture.values[index] = next; }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: () => {},
}));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: fixture.modal }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [{ id: "bot", name: "Pepper" }], config: { features: { skillsLibrary: true } }, dispatch: () => {} } }) }));
vi.mock("./bot-settings/BotEditorContext", () => ({ useBotEditor: () => ({ request: fixture.request }) }));
vi.mock("./bot-settings/FilesSection", () => ({
  PopoverMenu: ({ children }: { children: (close: () => void) => unknown }) => children(() => {}),
  MenuItem: (props: Record<string, unknown>) => props,
}));
vi.mock("./bot-settings/SkillEditorPage", () => ({ SkillEditorPage: () => null }));
vi.mock("@/components/ConfirmProvider", () => ({
  useConfirm: () => async () => true,
  confirmAsync: async () => true,
  discardConfirmRequest: () => ({ title: "Close without saving?", confirmLabel: "Discard", tone: "danger" }),
}));

import { SkillsSection as BotSkillsSection } from "./bot-settings/SkillsSection";
import type { Bot } from "@/state/store";

type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => isValidElement<Props>(child) ? [child, ...nodes(child.props.children)] : []);
}
const skill = (name = "order-audit"): SkillsLibrarySkillWire => ({ name, description: "Audit orders", source: "local-import", enabled: false, tags: [], version: null, importedAt: "2026-10-02T00:00:00Z", warnings: [], assignedBots: [] });
const source = "---\nname: order-audit\ndescription: Audit orders\n---\n\nCheck every line item.";
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
function render() {
  fixture.index = 0;
  return nodes(BotSkillsSection({ bot: { id: "bot" } as Bot }));
}
const named = (tree: ReactElement<Props>[], label: string) => tree.find((node) => node.props["aria-label"] === label)!;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  fixture.values = [[skill()], false, "", "", null, null, "", "", false, "", "bot"];
  fixture.modal.mockClear();
  fixture.request.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => response(options?.method === "PATCH" ? {} : url.endsWith("order-audit") ? { text: source } : { skills: [skill()] })));
});

describe("A bot's library skills: review before enabling", () => {
  it("requires the same source review before enabling a per-bot library skill", async () => {
    // Hook call order: useManagedSkills (shared with the Simple bot panel) owns
    // skills…reviewing (0-8) and the assignment guard ref (9); the section then
    // owns editing, source, importing and importMessage (10-13).
    fixture.values = [[{ ...skill(), origin: "library" }], ["order-audit"], [], "", [], false, "", "", null, { current: false }, null, "", false, ""];
    fixture.request.mockImplementation(async (_url, options) => options?.method ? {} : { text: source, name: "order-audit" });
    named(render(), "Enable order-audit").props.onClick!();
    await flush();
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.request).toHaveBeenCalledWith("/api/skills-library/order-audit");
    // The review step is the shared SkillReviewDialog, given the fetched source.
    const review = render().find((node) => typeof node.type === "function" && node.type.name === "SkillReviewDialog")!;
    expect(review.props.text).toBe(source);
    (review.props.onEnable as () => void)();
    await flush();
    expect(fixture.request).toHaveBeenCalledWith("/api/skills-library/order-audit", expect.objectContaining({ method: "PATCH", body: '{"enabled":true}' }));
  });
});
