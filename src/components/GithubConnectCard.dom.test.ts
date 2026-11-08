// @vitest-environment happy-dom
// connect_github's sign-in card in a bot's chat (#2109): the code with Copy
// code, github.com with Open link, the expiry, then "GitHub connected as
// @login" once the server patches it. No Open thread, no side panel.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { GithubConnectCard as Card } from "../../shared/github-connect-card";
import { GithubConnectCard } from "./GithubConnectCard";

const fixture = vi.hoisted(() => ({ copyText: vi.fn(async () => "copied"), openExternalLink: vi.fn(async () => {}) }));
vi.mock("@/lib/copy-text", () => ({ copyText: fixture.copyText }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: fixture.openExternalLink }));

const NOW = 1_900_000_000_000;
const pending: Card = { state: "pending", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: NOW + 14.5 * 60_000 };

let host: HTMLDivElement;
let root: Root;
const render = (card: Card) => flushSync(() => root.render(createElement(GithubConnectCard, { card, now: NOW })));
const click = (selector: string) => flushSync(() => host.querySelector<HTMLButtonElement>(selector)!.click());

beforeEach(() => {
  vi.clearAllMocks();
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setLocale("en");
});

describe("GithubConnectCard", () => {
  it("shows the code, Copy code and Open link while GitHub waits", async () => {
    render(pending);
    const card = host.querySelector("[data-github-connect-card]")!;
    expect(card.getAttribute("data-github-connect-state")).toBe("pending");
    expect(host.querySelector("[data-github-connect-code]")!.textContent).toBe("ABCD-1234");
    expect(host.querySelector("[data-github-connect-expiry]")!.textContent).toBe("The code works for 15 min.");
    expect(host.textContent).not.toMatch(/Open thread|Go to conversation|Open the chat/);
    click("[data-github-connect-copy]");
    expect(fixture.copyText).toHaveBeenCalledWith("ABCD-1234");
    await vi.waitFor(() => expect(host.querySelector("[data-github-connect-copy]")!.textContent).toContain("Copied"));
    click("[data-github-connect-open]");
    expect(fixture.openExternalLink).toHaveBeenCalledWith("https://github.com/login/device");
  });

  it("never opens a link that is not https", () => {
    render({ ...pending, verificationUri: "javascript:alert(1)" });
    expect(host.querySelector("[data-github-connect-open]")).toBeNull();
  });

  it("says the code expired once past its time", () => {
    render({ ...pending, expiresAt: NOW - 1 });
    expect(host.querySelector("[data-github-connect-expiry]")!.textContent).toContain("expired");
  });

  it("turns into GitHub connected as @login, with no code left", () => {
    render(pending);
    render({ state: "connected", login: "octo" });
    expect(host.querySelector("[data-github-connect-card]")!.getAttribute("data-github-connect-state")).toBe("connected");
    expect(host.textContent).toContain("GitHub connected as @octo");
    expect(host.querySelector("[data-github-connect-code]")).toBeNull();
    expect(host.querySelector("[data-github-connect-copy]")).toBeNull();
  });

  it("says why the sign-in stopped, and when a newer code replaced it", () => {
    render({ state: "failed", error: "The sign-in was cancelled on GitHub." });
    expect(host.querySelector("[role=alert]")!.textContent).toBe("The sign-in was cancelled on GitHub.");
    render({ state: "cancelled" });
    expect(host.textContent).toContain("GitHub sign-in replaced");
  });

  it("speaks Quebec French", () => {
    setLocale("fr");
    render(pending);
    expect(host.textContent).toContain("Connecter GitHub");
    expect(host.textContent).toContain("Ouvrir le lien");
    render({ state: "connected", login: "octo" });
    expect(host.textContent).toContain("GitHub connecté en tant que @octo");
  });
});
