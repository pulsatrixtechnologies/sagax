// @vitest-environment happy-dom
// #4415 (the owner's rule: nothing in duplicate): a sign-in offered outside a
// provider's account rows (EngineConnect, EngineSetup, the harness section)
// runs the SAME flow as the rows (useAccountSignIn) and draws the same state
// and steps: the button becomes "Waiting for sign-in" with a quiet Cancel,
// one sentence, the vendor's page, the code or the code field. No card, no
// brand-coloured or full-width button, no second loop with its own words.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { MyEngine } from "@/lib/perspicax-org";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  answer: (() => undefined) as (path: string, init?: RequestInit) => unknown,
  refreshInstances: (() => {}) as () => void,
  refreshModels: (() => {}) as (id: string) => void,
  opened: [] as string[],
}));
vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      const own = fixture.answer(path, init);
      if (own instanceof Error) throw own;
      if (own === undefined) throw new Error(`no answer for ${path}`);
      return own;
    }),
    useStore: () => ({ refreshInstances: fixture.refreshInstances, refreshModels: fixture.refreshModels }),
  };
});
vi.mock("@/lib/app-links", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/app-links")>(),
  openExternalLink: vi.fn(async (url: string) => { fixture.opened.push(url); }),
}));

const { ClaudeSignIn } = await import("../ClaudeSignIn");
const { DeviceSignIn } = await import("../DeviceSignIn");
const { MyEngineAccess } = await import("./MyEngines");
const { api: apiMock } = await import("@/state/store");
const posts = () => vi.mocked(apiMock).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").map(([path, init]) => [path, (init as RequestInit).body ?? null]);

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const render = async (element: Parameters<Root["render"]>[0]) => { await act(async () => { root.render(element); }); await settle(); };
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};
const later = () => new Date(Date.now() + 10 * 60_000).toISOString();

/** The shared flow's look: no card, no brand colour, no full-width button. */
function sharedLook(node: Element) {
  expect(node.querySelector("[data-account-sign-in]"), "the shared flow").not.toBeNull();
  for (const el of node.querySelectorAll<HTMLElement>("div, form, p")) {
    expect(el.className.toString(), el.outerHTML.slice(0, 80)).not.toMatch(/\bborder-hairline|\bbg-app\b|\brounded-(lg|xl)\b/);
  }
  for (const el of node.querySelectorAll<HTMLElement>("button, a")) {
    expect(el.className.toString(), el.outerHTML.slice(0, 80)).not.toMatch(/\bbg-accent\b|\bw-full\b|\bbg-white\b/);
  }
}

beforeEach(() => {
  setLocale("en");
  fixture.answer = () => undefined;
  fixture.refreshInstances = vi.fn();
  fixture.refreshModels = vi.fn();
  fixture.opened = [];
  vi.mocked(apiMock).mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Claude outside the account rows", () => {
  it("runs the rows' flow: state in place of the button, one sentence, the page, the code field, Finish, then refresh", async () => {
    const base = "/api/me/engines/claude/login";
    const onSignedIn = vi.fn(async () => undefined);
    fixture.answer = (path) => path === `${base}/start`
      ? { auth: { phase: "waiting", flowId: "flow-1", authorizationUrl: "https://claude.ai/oauth/authorize?code=true", expiresAt: later() } }
      : path === `${base}/complete` ? { ok: true } : undefined;
    await render(createElement(ClaudeSignIn, { instanceId: "claude", base, onSignedIn, label: "Reconnect Claude" }));
    const start = host.querySelector<HTMLElement>("[data-claude-sign-in] [data-sign-in-start]")!;
    expect(start.textContent).toBe("Reconnect Claude");
    sharedLook(host);
    await click(start);
    expect(posts()).toEqual([[`${base}/start`, "{}"]]);
    expect(host.querySelector("[data-sign-in-start]"), "replaced, not beside it").toBeNull();
    expect(host.querySelector("[data-sign-in-state]")!.textContent).toContain("Waiting for sign-in");
    const steps = host.querySelector<HTMLElement>("[data-sign-in-steps]")!;
    expect(steps.textContent).toContain("Paste only a code from a sign-in started here");
    expect(steps.querySelector<HTMLAnchorElement>("[data-sign-in-open]")!.href).toBe("https://claude.ai/oauth/authorize?code=true");
    sharedLook(host);
    await type(steps.querySelector<HTMLInputElement>("[data-sign-in-code-input]")!, " pasted-code-123 ");
    await click(steps.querySelector("[data-sign-in-finish]"));
    expect(posts().at(-1)).toEqual([`${base}/complete`, JSON.stringify({ flowId: "flow-1", code: "pasted-code-123" })]);
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-sign-in-state], [data-sign-in-steps]")).toBeNull();
  });

  it("a refused code keeps the step and says why; Cancel is quiet and ends it", async () => {
    const base = "/api/instances/claude/auth";
    fixture.answer = (path) => path === `${base}/start`
      ? { auth: { phase: "waiting", flowId: "flow-2", authorizationUrl: "https://claude.ai/oauth/authorize", expiresAt: later() } }
      : path === `${base}/complete` ? new Error("Anthropic did not accept that code.")
        : path === `${base}/cancel` ? { ok: true } : undefined;
    await render(createElement(ClaudeSignIn, { instanceId: "claude" }));
    expect(host.querySelector("[data-sign-in-start]")!.textContent).toBe("Connect Claude");
    await click(host.querySelector("[data-sign-in-start]"));
    await type(host.querySelector<HTMLInputElement>("[data-sign-in-code-input]")!, "wrong-code");
    await click(host.querySelector("[data-sign-in-finish]"));
    expect(host.textContent).toContain("Anthropic did not accept that code.");
    const cancel = host.querySelector<HTMLElement>("[data-sign-in-cancel]")!;
    expect(cancel.className).not.toMatch(/bg-control|bg-accent|w-full/);
    await click(cancel);
    expect(posts().at(-1)).toEqual([`${base}/cancel`, JSON.stringify({ flowId: "flow-2" })]);
    expect(host.querySelector("[data-sign-in-start]")).not.toBeNull();
    expect(fixture.refreshInstances).not.toHaveBeenCalled();
  });
});

describe("a device code or a page outside the account rows", () => {
  it("Codex: the code and OpenAI's page, in the shared flow", async () => {
    fixture.answer = (path) => path === "/api/instances/codex/auth/start"
      ? { auth: { phase: "waiting", flowId: "flow-3", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-12345", expiresAt: later() } }
      : undefined;
    await render(createElement(DeviceSignIn, { instanceId: "codex" }));
    expect(host.querySelector("[data-device-sign-in=codex] [data-sign-in-start]")).not.toBeNull();
    await click(host.querySelector("[data-sign-in-start]"));
    const steps = host.querySelector<HTMLElement>("[data-sign-in-steps]")!;
    expect(steps.querySelector("[data-sign-in-code]")!.textContent).toContain("ABCD-12345");
    expect(steps.querySelector<HTMLAnchorElement>("[data-sign-in-open]")!.href).toBe("https://auth.openai.com/codex/device");
    expect(steps.textContent).toContain("Enter this code on the sign-in page");
    expect(steps.textContent).not.toContain("codex login");
    expect(fixture.opened).toEqual([]);
    sharedLook(host);
  });

  it("Grok: xAI's page and code; a code from another page is never shown", async () => {
    fixture.answer = (path) => path === "/api/instances/grok/auth/start"
      ? { auth: { phase: "waiting", flowId: "flow-4", authorizationUrl: "https://accounts.x.ai/device?user_code=ZZZZ-ZZZZ", userCode: "WDJB-MJHT", expiresAt: later() } }
      : undefined;
    await render(createElement(DeviceSignIn, { instanceId: "grok", provider: "grok" }));
    expect(host.querySelector("[data-device-sign-in=grok]")).not.toBeNull();
    await click(host.querySelector("[data-sign-in-start]"));
    expect(host.querySelector("[data-sign-in-open]")).toBeNull();
    expect(host.textContent).not.toContain("WDJB-MJHT");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("could not be opened safely");
  });

  it("ChatGPT plan: the page opens at once, the flow waits for it, then refreshes the engine", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const authorizationUrl = "https://auth.openai.com/api/accounts/authorize?state=fixture";
      let status = 0;
      fixture.answer = (path) => path === "/api/instances/chatgpt/auth/start"
        ? { auth: { phase: "waiting", flowId: "flow-5", authorizationUrl, expiresAt: later() } }
        : path.startsWith("/api/instances/chatgpt/auth/status") ? (status += 1, { auth: { phase: "succeeded", flowId: "flow-5", authorizationUrl: null, expiresAt: null } })
          : undefined;
      await render(createElement(DeviceSignIn, { instanceId: "chatgpt", browserPkce: true }));
      expect(host.querySelector("[data-chatgpt-plan-sign-in] [data-sign-in-start]")).not.toBeNull();
      await click(host.querySelector("[data-sign-in-start]"));
      expect(fixture.opened).toEqual([authorizationUrl]);
      expect(host.querySelector("[data-sign-in-steps]")!.textContent).toContain("Finish signing in on the page that opened");
      sharedLook(host);
      await act(async () => { vi.advanceTimersByTime(2_000); });
      await settle();
      expect(status).toBe(1);
      expect(fixture.refreshInstances).toHaveBeenCalledOnce();
      expect(fixture.refreshModels).toHaveBeenCalledWith("chatgpt");
      expect(host.querySelector("[data-sign-in-state]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed start says why in one line and offers Try again; ChatGPT's device-code fix is named", async () => {
    let starts = 0;
    fixture.answer = (path) => path === "/api/instances/codex/auth/start" ? (starts += 1, new Error("The server stopped.")) : undefined;
    await render(createElement(DeviceSignIn, { instanceId: "codex" }));
    await click(host.querySelector("[data-sign-in-start]"));
    expect(host.querySelector("[data-sign-in-outcome]")!.textContent).toContain("The server stopped.");
    expect(host.textContent).toContain("Device-code");
    const again = host.querySelector<HTMLElement>("[data-sign-in-start]")!;
    expect(again.textContent).toBe("Try again");
    await click(again);
    expect(starts).toBe(2);
  });
});

describe("a person's own sign-in on an organization server (MyEngineAccess)", () => {
  const mine = (over: Partial<MyEngine> = {}): MyEngine => ({
    instanceId: "kimi", driver: "kimiAgent", displayName: "Kimi", installed: true,
    subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...over,
  });

  it("signs in through the shared flow on the person's own route, with the engine's words for a refusal", async () => {
    fixture.answer = (path) => path === "/api/me/engines/kimi/login/start"
      ? { auth: { phase: "waiting", flowId: "flow-6", authorizationUrl: "https://www.kimi.com/code/authorize_device", userCode: "QWER-TYUI", expiresAt: later() } }
      : undefined;
    await render(createElement(MyEngineAccess, { engine: mine(), label: "Connect Kimi" }));
    const start = host.querySelector("[data-my-engine=kimi] [data-sign-in-start]")!;
    expect(start.textContent).toBe("Connect Kimi");
    await click(start);
    expect(posts()).toEqual([["/api/me/engines/kimi/login/start", "{}"]]);
    expect(host.querySelector("[data-sign-in-state]")).not.toBeNull();
    sharedLook(host);
  });

  it("an engine the server lists as installed reads 'not connected', not 'not installed'", async () => {
    fixture.answer = (path) => path === "/api/me/engines/kimi/login/start" ? new Error("Kimi is not installed on this server.") : undefined;
    await render(createElement(MyEngineAccess, { engine: mine() }));
    await click(host.querySelector("[data-sign-in-start]"));
    expect(host.querySelector("[data-sign-in-outcome]")!.textContent).not.toContain("not installed");
  });

  it("signed in: one state and Sign out", async () => {
    fixture.answer = (path) => path === "/api/me/engines/kimi/login/sign-out" ? { ok: true } : undefined;
    const onChanged = vi.fn();
    await render(createElement(MyEngineAccess, { engine: mine({ subscription: { supported: true, signedIn: true } }), onChanged }));
    expect(host.querySelector("[data-sign-in-start]")).toBeNull();
    await click(host.querySelector("button"));
    expect(posts()).toEqual([["/api/me/engines/kimi/login/sign-out", "{}"]]);
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
