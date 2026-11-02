// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { filePreviewKind } from "./TableFilePreview";

// the file helpers live in lib/message-file since the import-cycle split (2026-11-01)
vi.mock("@/lib/message-file", () => ({
  requestMessageFile: async () => new Response('{"name":"Sagax","items":[1,{"deep":true}],"empty":{}}'),
  saveFailureText: () => "",
  useLocalFileSave: () => ({ state: "idle", save: async () => {}, savedTo: null }),
}));

import { JsonViewer } from "./JsonViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("JsonViewer", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  it("is the preview of a .json file", () => expect(filePreviewKind("data.json")).toBe("json"));
  it("opens the root, folds and unfolds nodes", async () => {
    HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(createElement(JsonViewer, { path: "/w/a.json", name: "a.json", message: { threadId: "t", messageId: "m" }, onClose: () => {}, returnFocus: null }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const text = () => document.body.textContent ?? "";
    expect(text()).toContain("Sagax");
    expect(text()).not.toContain("deep");
    const items = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Expand items")!;
    await act(async () => { items.click(); });
    const inner = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Expand 1")!;
    await act(async () => { inner.click(); });
    expect(text()).toContain("deep");
    const all = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Collapse the root")!;
    await act(async () => { all.click(); });
    expect(text()).not.toContain("Sagax");
  });
});
