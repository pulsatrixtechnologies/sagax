import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ConnectionSignInPanel } from "./ConnectionSignInPanel";

describe("connection sign-in animation", () => {
  it("shows the person's name, avatar and Sagax Business in English", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ConnectionSignInPanel, { name: "Alice Martin", avatarUrl: "/api/people/a/avatar?v=1" }));
    expect(html).toContain("Alice Martin");
    expect(html).toContain("Sagax Business");
    expect(html).toContain("Connecting your session");
    expect(html).toContain('src="/api/people/a/avatar?v=1"');
  });

  it("uses Québec French copy without anglicisms", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(ConnectionSignInPanel, { name: "Jean Dupont" }));
    expect(html).toContain("Connexion à ta session");
    expect(html).toContain("Sagax Business");
    expect(html).not.toContain("Connecting");
    expect(html).not.toContain("Sign in");
  });
});
