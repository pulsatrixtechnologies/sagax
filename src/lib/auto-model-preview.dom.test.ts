// @vitest-environment happy-dom
// M-20261126-101 (#5403): the mode menu's tooltips name what the server would run
// NOW. A bot on Auto or on a mode reads its preview when its chat bar mounts;
// an account that reached its limit since must be gone from the tooltip the
// next time the menu opens, so each opening reads the preview again, and the
// last answer stays on screen meanwhile.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { modeTooltip } from "@/lib/model-mode";
import type { AutoModelPreview } from "../../shared/auto-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const server = vi.hoisted(() => ({ calls: [] as string[], answer: null as unknown, pending: [] as Array<(value: unknown) => void> }));
vi.mock("@/state/store", () => ({
  api: (path: string) => {
    server.calls.push(path);
    return new Promise((resolve) => { server.pending.push(resolve); });
  },
}));
const { useAutoModelStatus } = await import("./auto-model-preview");

const seat = (instanceId: string, modelLabel: string) => ({ instanceId, model: modelLabel.toLowerCase(), engineLabel: instanceId, modelLabel });
const preview = (team: ReturnType<typeof seat>[]): AutoModelPreview => ({
  auto: true, pick: null, chain: [], excluded: [], backups: [], explanation: "",
  modes: { heavy: { mode: "heavy", pick: team[0]!, team } },
} as unknown as AutoModelPreview);
const WITH_CLAUDE = preview([seat("codex", "GPT-6 Astra"), seat("claude", "Claude Opus 5.5")]);
const WITHOUT_CLAUDE = preview([seat("codex", "GPT-6 Astra")]);

let host: HTMLDivElement;
let root: Root;
function Tip({ open }: { open: boolean }) {
  const status = useAutoModelStatus("b1", "t1", true, "rev", open);
  return createElement("p", null, status ? modeTooltip("heavy", status.modes?.heavy) : "loading");
}
const draw = (open: boolean) => act(() => root.render(createElement(Tip, { open })));
const answer = async (value: AutoModelPreview) => { await act(async () => { server.pending.shift()!(value); }); };

beforeEach(() => {
  setLocale("en");
  server.calls.length = 0;
  server.pending.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the mode menu's preview", () => {
  it("is read again each time the menu opens, so a model that reached its limit leaves the tooltip", async () => {
    draw(false);
    expect(server.calls).toEqual(["/api/bots/b1/auto-model?threadId=t1"]);
    await answer(WITH_CLAUDE);
    expect(host.textContent).toBe("Team of Experts · GPT-6 Astra, Claude Opus 5.5");
    // every Claude account reaches its weekly limit, then the person opens the menu
    draw(true);
    expect(server.calls).toHaveLength(2);
    // the last answer stays while the new one is read: no flash of an empty menu
    expect(host.textContent).toBe("Team of Experts · GPT-6 Astra, Claude Opus 5.5");
    await answer(WITHOUT_CLAUDE);
    expect(host.textContent).toBe("Team of Experts · GPT-6 Astra");
  });

  it("is not read again when the menu closes, nor on a render that changes nothing", async () => {
    draw(true);
    await answer(WITHOUT_CLAUDE);
    expect(server.calls).toHaveLength(1);
    draw(true);
    draw(false);
    expect(server.calls).toHaveLength(1);
    expect(host.textContent).toBe("Team of Experts · GPT-6 Astra");
    draw(true);
    expect(server.calls).toHaveLength(2);
  });
});
