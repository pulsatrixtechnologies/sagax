import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnknownMessageCard, isUnknownMessageKind } from "./MessageBoundary";

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
