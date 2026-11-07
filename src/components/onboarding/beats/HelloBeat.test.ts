import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const store = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: {}, dispatch: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ identifyEmail: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));
import { openExternalLink } from "@/lib/app-links";
import type { ManagedProfile } from "@/lib/profile-management";
import { ManagedProfileIdentity } from "../../ManagedProfileIdentity";
import { HelloBeat } from "./HelloBeat";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
const props = { onNext: vi.fn(), onSkip: vi.fn(), setMascot: vi.fn(), bump: vi.fn() };
function render(hosted?: boolean, profileManaged?: ManagedProfile) {
  let tree: ReactNode = null;
  function Capture() {
    tree = HelloBeat({ ...props, ...(hosted === undefined ? {} : { hosted }), ...(profileManaged ? { profileManaged } : {}) });
    return tree;
  }
  return { html: renderToStaticMarkup(createElement(Capture)), tree };
}

beforeEach(() => {
  store.api.mockReset();
  props.onNext.mockReset();
  setLocale("en");
});

describe("the greeting beat", () => {
  it("asks a hosted workspace for nothing and saves nothing", () => {
    const { html, tree } = render(true);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("let you know when big things ship");
    expect(html).toContain("shared Sagax");
    expect(html).toContain("nothing to install");
    // Continue moves on; there is nothing to save
    const primary = nodes(tree).find((node) => typeof node.type === "function" && node.props.onClick);
    primary!.props.onClick!();
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("keeps the desktop greeting with its name and email fields", () => {
    for (const html of [render().html, render(false).html]) {
      expect(html).toContain("you@example.com");
      expect(html).toContain("let you know when big things ship");
      expect(html).not.toContain("shared Sagax");
    }
  });
});

const Owner: ManagedProfile = { by: "perspicax", url: "https://pulsatrix.example.test/console/me", name: "Alex", email: "owner@example.test" };

describe("the greeting on an organization server", () => {
  it("never asks for a name or an email, and shows them read-only", () => {
    const { html, tree } = render(false, Owner);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("you@example.com");
    expect(html).toContain("Pulsatrix Perspicax");
    // Continue moves on and saves nothing
    const primary = nodes(tree).find((node) => typeof node.type === "function" && node.props.onClick);
    primary!.props.onClick!();
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(store.api).not.toHaveBeenCalled();
    // the identity block carries the person and the link
    const identity = nodes(tree).find((node) => node.type === ManagedProfileIdentity);
    expect((identity!.props as unknown as { profile: ManagedProfile }).profile).toEqual(Owner);
  });

  it("says it in French", () => {
    setLocale("fr");
    const { html } = render(false, Owner);
    expect(html).toContain("Pulsatrix Perspicax");
    expect(html).not.toContain("<input");
  });
});

describe("the managed identity block", () => {
  const markup = (profile: ManagedProfile) => renderToStaticMarkup(createElement(ManagedProfileIdentity, { profile }));

  it("shows the name and email read-only with the note and the Perspicax link", () => {
    setLocale("fr");
    const html = markup(Owner);
    expect(html).not.toContain("<input");
    expect(html).toContain("Alex");
    expect(html).toContain("owner@example.test");
    expect(html).toContain("Géré par ton organisation (Pulsatrix Perspicax)");
    expect(html).toContain("Modifier dans Perspicax");
  });

  it("opens the issuer console's profile page", () => {
    const tree = ManagedProfileIdentity({ profile: Owner });
    const link = nodes(tree).find((node) => node.type === "button");
    link!.props.onClick!();
    expect(openExternalLink).toHaveBeenCalledWith("https://pulsatrix.example.test/console/me");
  });

  it("shows the Perspicax avatar, else the letters", () => {
    expect(markup({ ...Owner, avatarUrl: "/api/people/pr_1/avatar?v=0a1b" })).toContain('src="/api/people/pr_1/avatar?v=0a1b"');
    expect(markup(Owner)).not.toContain("<img");
  });

  it("keeps the note without a usable link", () => {
    setLocale("en");
    const html = markup({ ...Owner, url: null });
    expect(html).toContain("Managed by your organization (Pulsatrix Perspicax)");
    expect(html).not.toContain("Edit in Perspicax");
  });
});
