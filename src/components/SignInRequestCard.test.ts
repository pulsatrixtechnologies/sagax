// The sign-in card: the site is the headline, the reason is the bot's own
// words, Open goes to the place the bot works, and Done or Cancel resume it.
// It never offers a field for the password: the page takes that.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ setters: [] as Array<ReturnType<typeof vi.fn>>, states: {} as Record<number, unknown> }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (value: unknown) => {
    const index = fixture.setters.length;
    const setter = vi.fn(); fixture.setters.push(setter);
    return [index in fixture.states ? fixture.states[index] : value, setter];
  } };
});
const dispatch = vi.fn();
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch }),
}));
const answerSignIn = vi.fn();
const here = { value: true };
vi.mock("@/lib/sign-in", () => ({ answerSignIn: (...args: unknown[]) => answerSignIn(...args), signInHostIsHere: () => here.value }));

import { SignInBanner, SignInRequestCard } from "./SignInRequestCard";

const card = (signIn: Record<string, unknown> = {}): Message => ({
  id: "card-1",
  role: "bot",
  kind: "signin",
  at: 1,
  text: "Pepper needs you to sign in to example.com.",
  signIn: { url: "https://example.com/login", site: "example.com", place: "browser", reason: "The report is behind a login.", ...signIn } as Message["signIn"],
});
const props = (signIn?: Record<string, unknown>) => ({ botId: "pepper", botName: "Pepper", threadId: "thread-1", message: card(signIn) });
const view = (signIn?: Record<string, unknown>) => renderToStaticMarkup(createElement(SignInRequestCard, props(signIn)));

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
const elements = (node: ReactNode): Node[] => {
  if (!isValidElement(node)) return [];
  const element = node as Node;
  return [element, ...Children.toArray(element.props.children).flatMap(elements)];
};
/** Every element the card renders, its AskCard footer included. */
const tree = (signIn?: Record<string, unknown>) => {
  let root!: ReactNode;
  function Capture() { root = SignInRequestCard(props(signIn)); return root; }
  renderToStaticMarkup(createElement(Capture));
  const top = elements(root);
  return [...top, ...top.flatMap((node) => elements((node.props as { footer?: ReactNode }).footer))];
};
const button = (nodes: Node[], label: string) => nodes.find((node) => node.type === "button" && Children.toArray(node.props.children).includes(label))!;
const settle = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };

beforeEach(() => {
  vi.stubGlobal("window", {});
  dispatch.mockReset(); answerSignIn.mockReset().mockResolvedValue(undefined);
  fixture.setters = []; fixture.states = {}; here.value = true;
});

describe("SignInRequestCard while it waits", () => {
  it("leads with the site, quotes the bot's reason, and offers Open, Done and Cancel", () => {
    const html = view();
    expect(html).toContain("Sign in needed");
    expect(html).toMatch(/data-testid="sign-in-site"[^>]*>example\.com</);
    expect(html).toContain("“The report is behind a login.”");
    expect(html).toContain("— Pepper");
    expect(html).toContain("Pepper’s built-in browser");
    for (const label of ["Open", "Done", "Cancel"]) expect(html).toContain(label);
    expect(html).toMatch(/(Sagax|Sagax) never sees it\./);
    // No field takes a password here: the page does.
    expect(html).not.toContain("<input");
  });

  it.each([
    ["vm", "the Local VM Pepper works on"],
    ["cloud", "the cloud computer Pepper works on"],
    ["local", "on this computer, in the browser Pepper is using"],
  ])("names the place for %s", (place, words) => {
    expect(view({ place })).toContain(words);
  });

  it("says the host computer, not this one, where this computer is somewhere else", () => {
    here.value = false;
    expect(view({ place: "local" })).toMatch(/the computer (Sagax|Sagax) runs on/);
  });

  it("Open goes to the place the bot works", () => {
    button(tree(), "Open").props.onClick!();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "openSignIn", botId: "pepper", messageId: "card-1", url: "https://example.com/login", site: "example.com", place: "browser",
    });
  });

  it("Open on this computer explains where to sign in instead", () => {
    button(tree({ place: "local" }), "Open").props.onClick!();
    expect(dispatch).not.toHaveBeenCalled();
    // explained (the second useState) turns on
    expect(fixture.setters[1]).toHaveBeenCalledWith(true);
    fixture.setters = []; fixture.states = { 1: true };
    expect(view({ place: "local" })).toContain("Not the Browser tab: it keeps its own sign-ins");
  });

  // Sagax keeps no saved login of its own here: the card answers Done or
  // Cancel only, wherever the bot works (the credential vault is separate).
  it.each(["browser", "vm", "cloud", "local"])("offers no saved login on %s", (place) => {
    const html = view({ place });
    expect(html).not.toContain("Save a login");
    expect(html).not.toContain('type="password"');
  });

  it.each(["done", "cancel"] as const)("%s settles this card", async (choice) => {
    button(tree(), choice === "done" ? "Done" : "Cancel").props.onClick!();
    await settle();
    expect(answerSignIn).toHaveBeenCalledExactlyOnceWith({ botId: "pepper", threadId: "thread-1", messageId: "card-1", place: "browser" }, choice);
  });
});

describe("SignInRequestCard once settled", () => {
  it("folds into one line that names the site once done and resumed", () => {
    const html = view({ done: true, resumed: true });
    expect(html).toContain('data-ask-card="settled"');
    expect(html).toContain("Signed in to example.com");
    expect(html).toContain("Pepper is continuing");
    expect(html).not.toMatch(/>Done<|>Open</);
  });

  it("says a declined sign-in was declined", () => {
    expect(view({ cancelled: true, resumed: true })).toContain("Sign-in to example.com declined");
  });

  it("keeps a retry with the same answer when resuming failed", async () => {
    const nodes = tree({ done: true, resumed: false, error: "The bot could not be resumed." });
    expect(view({ done: true, resumed: false, error: "The bot could not be resumed." })).toContain("The bot could not be resumed.");
    const retry = nodes.flatMap((node) => elements((node.props as { action?: ReactNode }).action)).find((node) => node.type === "button")!;
    retry.props.onClick!();
    await settle();
    expect(answerSignIn).toHaveBeenCalledWith(expect.objectContaining({ messageId: "card-1" }), "done");
  });

  it("stops offering anything once superseded", () => {
    const html = view({ superseded: true });
    expect(html).toContain("Superseded by a newer request");
    expect(html).not.toMatch(/>Done<|>Open<|>Cancel</);
  });
});

describe("SignInBanner", () => {
  const help = { botId: "pepper", threadId: "thread-1", messageId: "card-1", site: "example.com", place: "vm" as const };
  const banner = (takeControl?: { onClick: () => void }) => {
    let root!: ReactNode;
    function Capture() { root = SignInBanner({ help, askerName: "Pepper", takeControl }); return root; }
    return { html: renderToStaticMarkup(createElement(Capture)), nodes: elements(root) };
  };

  it("names the asking bot and the site, and answers the card", async () => {
    const { html, nodes } = banner();
    expect(html).toContain("<b>Pepper</b> needs you to sign in to example.com");
    expect(html).not.toContain("Take control");
    button(nodes, "Done").props.onClick!();
    await settle();
    expect(answerSignIn).toHaveBeenCalledExactlyOnceWith(help, "done");
  });

  it("offers Take control only where it is given one", () => {
    const takeControl = { onClick: vi.fn() };
    const { html, nodes } = banner(takeControl);
    expect(html).toContain("Take control");
    nodes.find((node) => node.type === "button" && node.props.onClick === takeControl.onClick)!.props.onClick!();
    expect(takeControl.onClick).toHaveBeenCalledOnce();
  });
});
