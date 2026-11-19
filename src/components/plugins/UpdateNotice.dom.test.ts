// @vitest-environment happy-dom
// A failed update is said calmly (#4504): the item, one sentence in the
// person's language (the server's raw words are read, never printed), that the
// old version stays, a Retry and a close.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { updateReasonKey } from "@/lib/capability-updates";
import { AutoUpdatedNotice, UpdateNotice } from "./UpdateNotice";

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

describe("a plugin updated by itself (#475)", () => {
  it("says the name, from and to, that its routines follow, and closes", async () => {
    setLocale("en");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    await act(async () => { root.render(createElement(AutoUpdatedNotice, { line: { name: "Dispatch Kit", from: "1.0.0", to: "1.1.0", notes: "Faster routing." }, onClose })); });
    const notice = host.querySelector("[data-auto-updated]")!;
    expect(notice.textContent).toContain("Dispatch Kit");
    expect(notice.textContent).toContain("Updated by itself, 1.0.0 to 1.1.0. Its routines follow it the next time it runs.");
    expect(notice.textContent).toContain("Faster routing.");
    await act(async () => { notice.querySelector<HTMLButtonElement>("[data-update-dismiss]")!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });
});
