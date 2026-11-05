// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StepBoundary,
  UnknownMessageCard,
  isUnknownMessageKind,
  stepFallbackText,
  stepIdOf,
} from "./MessageBoundary";

describe("unknown message kind", () => {
  it("flags only kinds this version cannot draw", () => {
    expect(isUnknownMessageKind("text")).toBe(false);
    expect(isUnknownMessageKind(undefined)).toBe(false);
    expect(isUnknownMessageKind("hologram")).toBe(true);
  });
  it("keeps the message text and says to update", () => {
    const html = renderToStaticMarkup(createElement(UnknownMessageCard, { text: "Bonjour" }));
    expect(html).toContain("Bonjour");
    expect(html).toContain("data-unknown-message");
  });
});

describe("stepFallbackText", () => {
  it("reads tool words without throwing on sparse or odd shapes", () => {
    expect(stepFallbackText(undefined)).toBe("");
    expect(stepFallbackText(null)).toBe("");
    expect(stepFallbackText({ tool: { name: "Bash", summary: "ls" } })).toBe("ls");
    expect(stepFallbackText({ tool: { name: "Read" } })).toBe("Read");
    expect(stepFallbackText({ name: "web_search", summary: "sagax docs" })).toBe("sagax docs");
    expect(stepFallbackText({ text: "hello" })).toBe("hello");
    expect(stepIdOf({ id: "step-1" })).toBe("step-1");
    expect(stepIdOf({})).toBeUndefined();
  });
});

function Boom(): ReactNode {
  throw new Error("step label failed");
}

function Ok({ label }: { label: string }): ReactNode {
  return createElement("p", { "data-ok": label }, label);
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("StepBoundary", () => {
  it("shows the fallback and keeps siblings when a child throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    flushSync(() => root.render(createElement("div", null,
      createElement(StepBoundary, {
        stepId: "step-bad",
        fallbackText: "Bash",
        children: createElement(Boom),
      }),
      createElement(StepBoundary, {
        stepId: "step-ok",
        fallbackText: "Read",
        children: createElement(Ok, { label: "still here" }),
      }),
    )));
    expect(host.querySelector("[data-step-failed]")?.textContent).toContain("Bash");
    expect(host.querySelector("[data-step-failed]")?.textContent).toContain("Something went wrong in this step.");
    expect(host.querySelector('[data-ok="still here"]')?.textContent).toBe("still here");
    expect(error.mock.calls.some((args) => String(args[0]).includes("step-bad"))).toBe(true);
    expect(error.mock.calls.some((args) => String(args[0]).includes("Bash"))).toBe(false);
  });
});
