import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: {}, dispatch: store.dispatch }) }));
import { LaunchScreen } from "./LaunchScreen";

type Props = { children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; value?: string; disabled?: boolean; "data-mode"?: string };
type Node = ReactElement<Props>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

const probe = vi.fn();
const join = vi.fn();
const bridges = { environments: { state: vi.fn() }, orgJoin: { probe, join } };
const onSolo = vi.fn();

function render(initialMode?: "solo" | "server") {
  fixture.index = 0;
  fixture.effects = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = LaunchScreen({ bridges: bridges as never, onSolo, initialMode });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const mode = (id: string) => render().nodes.find((node) => node.props["data-mode"] === id)!;
const input = () => render().nodes.find((node) => node.type === "input")!;
const submit = () => render().nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });

beforeEach(() => {
  fixture.values = [];
  store.dispatch.mockReset();
  store.api.mockReset();
  store.api.mockResolvedValue({ onboarding: { launchMode: "solo" } });
  probe.mockReset();
  join.mockReset();
  bridges.environments.state.mockReset();
  bridges.environments.state.mockResolvedValue({ activeId: "local", environments: [] });
  onSolo.mockReset();
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("launch screen", () => {
  it("offers no server and server, without a Skip, and the product name", () => {
    const html = render().html;
    expect(html).toContain("Welcome to Sagax");
    expect(html).toContain("No server");
    expect(html).toContain("Server");
    expect(html).not.toContain("Skip");
    expect(html).toContain("role=\"dialog\"");
    // no address field until server mode is chosen
    expect(render().nodes.some((node) => node.type === "input")).toBe(false);
  });

  it("shows the Pulsatrix mark, never a bot mascot, and speaks French", () => {
    setLocale("fr");
    const { html, nodes: tree } = render();
    expect(html).toContain('data-pulsatrix-mark="app"');
    expect(html).toContain("pulsatrix-mark-app");
    expect(html).toContain('viewBox="0 0 28 25"');
    expect(tree.some((node) => typeof node.type === "function" && /Maus|Mascot/.test(node.type.name))).toBe(false);
    expect(html).toContain("Bienvenue dans Sagax");
    expect(html).toContain("Comment utiliseras-tu Sagax sur cet ordinateur?");
    expect(html).toContain("Sans serveur");
    expect(html).toContain("Continuer");
    expect(html).toContain("Tu pourras changer ce choix plus tard dans Réglages &gt; Général.");
    expect(html).not.toMatch(/Welcome to|No server|You can change/);
  });

  it("no server is remembered, and the tour goes on", async () => {
    mode("solo").props.onClick!();
    submit();
    expect(onSolo).toHaveBeenCalledOnce();
    await flush();
    expect(store.api).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PUT", body: JSON.stringify({ onboarding: { launchMode: "solo" } }) }));
    expect(store.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { onboarding: { launchMode: "solo" } } });
    expect(probe).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
  });


  it("server mode starts with an empty address; a typed address is checked, saved and used for Sign in with Pulsatrix", async () => {
    mode("server").props.onClick!();
    expect(input().props.value).toBe("");
    expect(render().html).toContain("Sign in");
    input().props.onChange!({ target: { value: "https://sagax.example.test" } });
    probe.mockResolvedValue({ origin: "https://sagax.example.test", issuer: "https://px.example.test" });
    join.mockResolvedValue({ ok: true });
    submit();
    await flush();
    expect(probe).toHaveBeenCalledExactlyOnceWith("https://sagax.example.test");
    expect(store.api).toHaveBeenCalledWith("/api/config", expect.objectContaining({ body: JSON.stringify({ onboarding: { launchMode: "server" } }) }));
    expect(join).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ origin: "https://sagax.example.test", serverMode: true }));
    expect(onSolo).not.toHaveBeenCalled();
  });

  it("server mode shows no server of ours: an empty field, an https placeholder and who to ask", async () => {
    bridges.environments.state.mockResolvedValue({ activeId: "local", environments: [{ id: "local", kind: "local", name: "Local" }] });
    render("server");
    for (const effect of fixture.effects) effect();
    await flush();
    const field = input();
    expect(field.props.value).toBe("");
    expect((field.props as { placeholder?: string }).placeholder).toBe("https://…");
    const html = render().html;
    expect(html).toContain("Ask your administrator for this address");
    expect(html).not.toMatch(/acmecloud|bot\.pulsatrix/);
  });

  it("proposes the organization server this computer already saved, never over a typed address", async () => {
    bridges.environments.state.mockResolvedValue({
      activeId: "local",
      environments: [
        { id: "local", kind: "local", name: "Local" },
        { id: "pc", kind: "remote", name: "A computer", origin: "https://computer.example.test" },
        { id: "org", kind: "remote", name: "Org", origin: "https://sagax.example.test", org: true },
      ],
    });
    render("server");
    for (const effect of fixture.effects) effect();
    await flush();
    expect(input().props.value).toBe("https://sagax.example.test");

    fixture.values = [];
    render("server");
    input().props.onChange!({ target: { value: "https://typed.example.test" } });
    for (const effect of fixture.effects) effect();
    await flush();
    expect(input().props.value).toBe("https://typed.example.test");
  });

  it("uses another address the person types", async () => {
    mode("server").props.onClick!();
    input().props.onChange!({ target: { value: "sagax.example.test" } });
    probe.mockResolvedValue({ origin: "https://sagax.example.test", issuer: "https://px.example.test" });
    join.mockResolvedValue({ ok: true });
    submit();
    await flush();
    expect(probe).toHaveBeenCalledExactlyOnceWith("https://sagax.example.test");
    expect(join).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ origin: "https://sagax.example.test", serverMode: true }));
  });

  it("refuses an address that is not https before asking anything", async () => {
    render("server");
    input().props.onChange!({ target: { value: "http://sagax.example.test" } });
    submit();
    await flush();
    expect(probe).not.toHaveBeenCalled();
    expect(render().html).toContain("Enter an https address");
  });

  it("says when the server cannot be reached, and saves nothing", async () => {
    render("server");
    input().props.onChange!({ target: { value: "https://sagax.example.test" } });
    probe.mockRejectedValue(new Error("Error invoking remote method 'org-join:probe': Error: That server could not be reached."));
    submit();
    await flush();
    const html = render().html;
    expect(html).toContain("That server could not be reached");
    expect(html).not.toContain("invoking");
    expect(join).not.toHaveBeenCalled();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("says when the server is not linked to Perspicax", async () => {
    render("server");
    input().props.onChange!({ target: { value: "https://sagax.example.test" } });
    probe.mockRejectedValue(new Error("That server does not sign people in with Pulsatrix."));
    submit();
    await flush();
    expect(render().html).toContain("not linked to Pulsatrix");
    expect(join).not.toHaveBeenCalled();
  });

  it("says when the sign-in could not start", async () => {
    render("server");
    input().props.onChange!({ target: { value: "https://sagax.example.test" } });
    probe.mockResolvedValue({ origin: "https://sagax.example.test", issuer: "https://px.example.test" });
    join.mockRejectedValue(new Error("secret /path"));
    submit();
    await flush();
    const html = render().html;
    expect(html).toContain("Could not connect");
    expect(html).not.toContain("secret");
  });
});
