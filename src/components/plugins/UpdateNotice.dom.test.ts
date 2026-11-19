// @vitest-environment happy-dom
// A failed update is said calmly (#4504): the item, one sentence in the
// person's language (the server's raw words are read, never printed), that the
// old version stays, a Retry and a close.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { updateReasonKey } from "@/lib/capability-updates";
import { lastUpdateOf } from "@/lib/capability-updates";
import { LastUpdateNote } from "./DetailParts";
import { UpdateNotice } from "./UpdateNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("a failure's reason is mapped to a translated sentence", () => {
  it.each([
    ["The marketplace could not be reached.", "connectApps.updates.reason.unreachable"],
    ["fetch failed: ETIMEDOUT timed out", "connectApps.updates.reason.unreachable"],
    ["The organization console manages its version.", "connectApps.updates.reason.organization"],
    ["401 unauthorized: sign in again", "connectApps.updates.reason.signin"],
    ["plugin no longer exists in the marketplace", "connectApps.updates.reason.missing"],
    ["something nobody planned for", "connectApps.updates.reason.unknown"],
    [undefined, "connectApps.updates.reason.unknown"],
  ] as const)("%s -> %s", (error, key) => { expect(updateReasonKey(error)).toBe(key); });
});

describe("the notice", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const failure = { key: "plugin:me:me:kit@market", name: "Cursor Team Kit", error: "The marketplace could not be reached." };

  it("names the item, says why and that the old version stays, in one language, with Retry and a close; not a red bar", async () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    await act(async () => { root.render(createElement(UpdateNotice, { failure, onRetry, onClose })); });
    const notice = host.querySelector("[data-update-failure]")!;
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.querySelector("[data-update-failure-name]")?.textContent).toBe("Cursor Team Kit");
    expect(notice.textContent).toContain("The source could not be reached. The old version stays.");
    expect(notice.className).not.toMatch(/bg-danger|text-danger/);
    expect(notice.querySelector("svg")).not.toBeNull();
    await act(async () => { notice.querySelector<HTMLButtonElement>("[data-update-retry]")!.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(notice.querySelector("[data-update-dismiss]")?.getAttribute("aria-label")).toBe("Dismiss");
    await act(async () => { notice.querySelector<HTMLButtonElement>("[data-update-dismiss]")!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is fully French in French, with none of the server's English words", async () => {
    setLocale("fr");
    await act(async () => { root.render(createElement(UpdateNotice, { failure, onRetry: vi.fn(), onClose: vi.fn() })); });
    const text = host.querySelector("[data-update-failure]")!.textContent!;
    expect(text).toContain("La source n'a pas pu être jointe. L'ancienne version reste.");
    expect(text).not.toContain("marketplace could not");
    expect(host.querySelector("[data-update-retry]")?.textContent).toBe(t("connectApps.updates.retry"));
    expect(host.querySelector("[data-update-retry]")?.textContent).toBe("Réessayer");
  });
});

describe("a plugin updated by itself (M-20261119-040)", () => {
  it("raises no banner: the line lives in the plugin's own page, in one line, with no changelog", async () => {
    setLocale("en");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(LastUpdateNote, { at: Date.UTC(2026, 10, 18, 12), from: "0.33.6", to: "0.33.8" })); });
    const line = host.querySelector("[data-detail-last-update]")!;
    expect(line.textContent).toMatch(/Updated on .*2026, from 0\.33\.6 to 0\.33\.8\./);
    expect(line.querySelector("button")).toBeNull();
    expect(line.textContent).not.toContain("routines");
    await act(async () => root.render(createElement(LastUpdateNote, { at: Date.UTC(2026, 10, 18, 12) })));
    expect(host.querySelector("[data-detail-last-update]")!.textContent).toMatch(/Updated on .*2026\.$/);
    await act(async () => root.unmount());
    host.remove();
  });

  it("lastUpdateOf finds the item's line by kind and readable name", () => {
    const data = { count: 0, checkedAt: null, checking: false, items: [], history: [{ kind: "plugin" as const, name: "Pulsatrix Flow", at: 1, from: "1", to: "2" }] };
    expect(lastUpdateOf(data, "plugin", "pulsatrix-flow")?.to).toBe("2");
    expect(lastUpdateOf(data, "skill", "Pulsatrix Flow")).toBeUndefined();
    expect(lastUpdateOf(null, "plugin", "x")).toBeUndefined();
  });
});
