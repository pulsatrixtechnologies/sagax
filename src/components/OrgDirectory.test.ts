import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgDirectory } from "./OrgDirectory";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
}));

// renderToStaticMarkup HTML-escapes apostrophes as &#x27;. Decode before
// comparing against the UI label.
function text(html: string): string {
  return html.replace(/&#x27;/g, "'");
}

type Node = ReactElement<{ children?: ReactNode; type?: string; value?: string; onClick?: () => void; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void | Promise<void> }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  // A settings row (DescribedRow) carries what it opens in `below`, and a
  // group its heading's extras in `accessory`: walk them too.
  const extra = node.props as { below?: ReactNode; accessory?: ReactNode };
  return [node, ...Children.toArray(node.props.children).flatMap(nodes), ...nodes(extra.below), ...nodes(extra.accessory)];
}

function render(props: Parameters<typeof OrgDirectory>[0]) {
  fixture.index = 0;
  const tree = OrgDirectory(props);
  const html = text(renderToStaticMarkup(tree));
  return { html, nodes: nodes(tree) };
}

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
});

describe("OrgDirectory", () => {
  it("offers creation when there is no organization", () => {
    const html = render({ org: null, people: [], onCreate() {}, onInvite() {} }).html;
    expect(html).toContain("Create organization");
  });
  it("offers no invitation on an organization server that signs people in with Pulsatrix", () => {
    const html = render({
      org: { name: "Example" },
      people: [{ id: "zachary@example.test", role: "member" }],
      pendingInvites: [{ email: "late@example.test", token: "t1", link: "https://bot.example.test/join#token=t1" }],
      lastInvite: { email: "late@example.test", link: "https://bot.example.test/join#token=t1" },
      invitesOff: true,
      onCreate() {},
      onInvite() {},
      onRevoke() {},
    }).html;
    expect(html).toContain("managed in Perspicax");
    expect(html).not.toContain("late@example.test");
    expect(html).not.toContain("Invite");
  });
  it("lists members once the organization exists", () => {
    const html = render({
      org: { name: "Example" },
      people: [{ id: "zachary@example.test", role: "member" }],
      onCreate() {},
      onInvite() {},
    }).html;
    // A solo server's name was its host name: no row for it (0.5.6).
    expect(html).not.toContain(">Example<");
    expect(html).toContain("zachary@example.test");
    expect(html).not.toContain("Create organization");
  });
  it("shows a pending invite separately from members, with its link actions", () => {
    const onRevoke = vi.fn();
    const view = render({
      org: { name: "Example" },
      people: [],
      pendingInvites: [{ email: "zachary@example.test", token: "tok-1", link: "https://server.example.com/join#token=tok-1" }],
      onCreate() {},
      onInvite() {},
      onRevoke,
    });
    expect(view.html).toContain("Pending invitations");
    expect(view.html).toContain("zachary@example.test");
    expect(view.html).toContain("Copy link");
    view.nodes.find((node) => node.type === "button" && node.props.children === "Revoke")!.props.onClick!();
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith("tok-1");
  });
  it("draws Grok-style rows: address, invite, people and pending folded behind count pills", () => {
    const html = render({
      org: { name: "Example", host: { kind: "server", url: "https://server.example.com" } },
      people: [{ id: "a@example.test", role: "owner" }, { id: "b@example.test", role: "member" }],
      pendingInvites: [{ email: "c@example.test", token: "tok-2" }],
      onCreate() {},
      onInvite() {},
    }).html;
    expect(html).toContain('data-settings-group="people"');
    for (const id of ["organization.directory", "organization.invite", "organization.people", "organization.pending"]) expect(html, id).toContain(`data-settings-card="${id}"`);
    expect(html).toContain('aria-label="2 people"');
    expect(html).toContain('aria-label="1 pending"');
    expect(html.match(/data-count-pill=""/g)).toHaveLength(2);
    // folded, not removed
    expect(html.match(/<ul hidden=""/g)).toHaveLength(2);
    expect(html).toContain("b@example.test");
    expect(html).toContain("c@example.test");
    // no card titled with the organization's (host) name
    expect(html).not.toContain(">Example<");
  });
  it("lists people by email, falling back to a plain word, never their id", () => {
    const html = render({
      org: { name: "Example" },
      people: [
        { id: "pr_00000000-0000-4000-8000-00000000000a", role: "owner", email: "jc@example.com" },
        { id: "pr_11111111-1111-4111-8111-111111111111", role: "member" },
      ],
      onCreate() {},
      onInvite() {},
    }).html;
    expect(html).toContain(">jc@example.com<");
    expect(html).toContain("Owner");
    expect(html).toContain(">Unknown person<");
    expect(html).not.toContain("pr_11111111");
    expect(html).not.toContain(">pr_00000000-0000-4000-8000-00000000000a<");
  });
  it("edits the server address with a valid address only", async () => {
    const onUpdateHost = vi.fn(() => Promise.resolve());
    const props = { org: { name: "Example", host: { kind: "server" as const, url: "https://server.example.com" } }, people: [], onCreate() {}, onInvite() {}, onUpdateHost };
    expect(render(props).html).toContain("https://server.example.com");
    render(props).nodes.find((node) => node.type === "button" && node.props.children === "Edit")!.props.onClick!();
    const edit = () => render(props).nodes.find((node) => node.type === "input" && (node.props as { name?: string }).name === "org-server-address-edit")!;
    edit().props.onChange!({ target: { value: "http://10.0.0.5" } });
    expect(render(props).html).toContain("Use an https address");
    edit().props.onChange!({ target: { value: "https://example.com" } });
    await render(props).nodes.filter((node) => node.type === "form")[0]!.props.onSubmit!({ preventDefault() {} });
    expect(onUpdateHost).toHaveBeenCalledExactlyOnceWith({ kind: "server", url: "https://example.com" });
  });
  it("keeps the invite address when onInvite fails", async () => {
    const onInvite = vi.fn(() => Promise.reject(new Error("forbidden")));
    const props = { org: { name: "Example" }, people: [] as { id: string; role: "member" }[], onCreate() {}, onInvite };
    render(props).nodes.find((node) => node.type === "input")!.props.onChange!({ target: { value: "zachary@example.test" } });
    await render(props).nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });
    expect(onInvite).toHaveBeenCalledExactlyOnceWith("zachary@example.test");
    expect(render(props).nodes.find((node) => node.type === "input")!.props.value).toBe("zachary@example.test");
  });
  it("clears the invite address after onInvite succeeds", async () => {
    const onInvite = vi.fn(() => Promise.resolve());
    const props = { org: { name: "Example" }, people: [] as { id: string; role: "member" }[], onCreate() {}, onInvite };
    render(props).nodes.find((node) => node.type === "input")!.props.onChange!({ target: { value: "zachary@example.test" } });
    await render(props).nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });
    expect(render(props).nodes.find((node) => node.type === "input")!.props.value).toBe("");
  });
});
