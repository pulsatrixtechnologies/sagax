// Settings > Computer: the loopback servers fold to one line, and the
// computer's activity never shows the platform or host name of a connection.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { DEFAULT_BOT_WORKPLACE } from "../../../shared/bot-workplace";

import { activityLine, BotWorkplaceSettings } from "./BotWorkplaceSettings";
import { EndpointKeyEditor, endpointName, endpointsSummary, endpointStatus, sharedWithSummary, sharingStateText } from "./LocalModelsSettings";
import { LocalModelSharing } from "./LocalModelSharing";

const row = (label: string, port: number) => ({ id: label, label, baseUrl: `http://127.0.0.1:${port}/v1` });

describe("loopback servers summary", () => {
  it("counts the servers and names the first three", () => {
    const rows = [row("DwarfStar", 8002), row("llama-server", 9337), row("Bonsai", 9338), row("Ollama", 11434)];
    expect(endpointsSummary(rows)).toBe("4 local servers · DwarfStar, llama-server, Bonsai, …");
    expect(endpointsSummary([row("DwarfStar", 8002)])).toBe("1 local server · DwarfStar");
    expect(endpointsSummary([])).toBe("0 local servers");
  });

  it("names an unlabeled server by host and port", () => {
    expect(endpointName({ id: "", label: "", baseUrl: "http://localhost:1234/v1" })).toBe("localhost:1234");
  });
});

describe("loopback server probe status", () => {
  const ep = (id: string, port: number) => ({ id, label: id, baseUrl: `http://127.0.0.1:${port}/v1` });
  const published = [{ id: "desk8002", label: "DwarfStar", models: ["a", "b"] }];
  const probes = [
    { id: "desk8002", status: "answered" as const },
    { id: "desk8000", status: "needs_key" as const },
    { id: "desk9337", status: "offline" as const },
    { id: "desk9338", status: "empty" as const },
  ];

  it("shows the model count for an answering server and why the others are not listed", () => {
    expect(endpointStatus(ep("desk8002", 8002), published, probes)).toEqual({ tone: "ok", text: "2 models" });
    expect(endpointStatus(ep("desk8000", 8000), published, probes)).toEqual({ tone: "warn", text: "Reachable, needs an API key" });
    expect(endpointStatus(ep("desk9337", 9337), published, probes)).toEqual({ tone: "muted", text: "Not responding" });
    expect(endpointStatus(ep("desk9338", 9338), published, probes)).toEqual({ tone: "muted", text: "Running, no models" });
  });

  it("shows nothing for a server not probed yet (older desktop, or none connected)", () => {
    expect(endpointStatus(ep("desk1234", 1234), published, probes)).toBeNull();
    expect(endpointStatus(ep("desk8002", 8002), [], [])).toBeNull();
  });
});

describe("per-endpoint API key editor", () => {
  const endpoint = { id: "desk8000", label: "oMLX", baseUrl: "http://127.0.0.1:8000/v1" };
  const render = (hasKey: boolean) =>
    renderToStaticMarkup(createElement(EndpointKeyEditor, { endpoint, hasKey, onChange: () => {} }));

  it("shows no key control at all off the desktop app (no window.ogb.localModels)", () => {
    expect(render(false)).toBe("");
  });

  it("offers to add a key, or shows one is saved, only on the desktop app", () => {
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { ogb: { localModels: { keyBases: async () => [], setKey: async () => true, clearKey: async () => true } } };
    try {
      const none = render(false);
      expect(none).toContain("Add API key");
      expect(none).toContain('data-loopback-key="none"');
      const set = render(true);
      expect(set).toContain("API key saved");
      expect(set).toContain('data-loopback-key="set"');
      // The editor never renders a key value: it only ever learns whether one is set.
      expect(set).not.toContain("sk-");
    } finally {
      if (original === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = original;
    }
  });
});

describe("computer activity", () => {
  const status: DesktopBridgeStatus = {
    connected: true, tunnel: false, desktops: [], workplace: { ...DEFAULT_BOT_WORKPLACE },
    activity: [{ at: Date.UTC(2026, 9, 15, 19, 46), target: "user-desktop", kind: "connect" as const, detail: "darwin Some-Macbook.local", ok: true }],
  };

  it("hides the list by default behind a quiet link", () => {
    const markup = renderToStaticMarkup(createElement(BotWorkplaceSettings as (props: { status?: DesktopBridgeStatus }) => ReturnType<typeof BotWorkplaceSettings>, { status }));
    expect(markup).toContain('data-bot-activity="closed"');
    expect(markup).toContain("See activity");
    expect(markup).not.toContain("darwin");
    expect(markup).not.toContain("Some-Macbook");
  });

  it("never shows the platform or host name of a connection", () => {
    expect(activityLine(status.activity[0])).toBe("Computer connected · your computer");
    expect(activityLine({ ...status.activity[0], kind: "network", detail: "example.com:443" })).toBe("example.com:443 · your computer");
  });
});

// D-20261123-023: sharing chooses its recipients
describe("who the computer's models are shared with", () => {
  const directory = {
    people: [{ principalId: "pr_ada", name: "Ada Lovelace", login: "ada", email: "ada@example.com", role: "member" as const, disabled: false }],
    teams: [{ id: "team_support", name: "Support", members: ["pr_ada"], managers: [] }],
  };

  it("sums up the chosen people and teams in one line", () => {
    expect(sharedWithSummary({ people: [], teams: [] })).toBe("Nobody chosen");
    expect(sharedWithSummary({ people: ["pr_ada"], teams: [] })).toBe("1 person");
    expect(sharedWithSummary({ people: ["pr_ada", "pr_bob"], teams: ["team_support"] })).toBe("2 people · 1 team");
  });

  it("names each chosen person and team, with a way to remove each", () => {
    const html = renderToStaticMarkup(createElement(LocalModelSharing, {
      directory: directory as never, viewerId: "pr_me", value: { people: ["pr_ada"], teams: ["team_support"] }, onChange: () => {},
    }));
    expect(html).toContain('data-local-models-recipients="2"');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Support");
    expect(html).toContain('aria-label="Remove Ada Lovelace"');
    expect(html).toContain('aria-label="Remove Support"');
    // one word for a team in this block, the one its title uses
    expect(html).toContain("Search people and teams");
    expect(html).not.toMatch(/groups?\b/i);
  });

  // #5266 review: the line under the switch read "only you see them" beside chosen people and teams
  it("says who can use the models in each state of the share: nobody, chosen people and teams, the whole organization", () => {
    const nobody = { people: [], teams: [] };
    const chosen = { people: ["pr_ada"], teams: ["team_support"] };
    expect(sharingStateText(false, nobody)).toBe("Only you can use them.");
    expect(sharingStateText(false, chosen)).toBe("Besides you, only the people and teams chosen below can use them.");
    expect(sharingStateText(false, { people: [], teams: ["team_support"] })).toBe(sharingStateText(false, chosen));
    expect(sharingStateText(true, nobody)).toBe("Everyone in the organization can use them, but they cannot edit this list.");
    expect(sharingStateText(true, chosen)).toBe(sharingStateText(true, nobody));
    expect(sharingStateText(false, chosen)).not.toMatch(/only you (see|can)/i);
  });

  it("a recipient the directory no longer lists stays removable", () => {
    const html = renderToStaticMarkup(createElement(LocalModelSharing, { directory: null, viewerId: null, value: { people: ["pr_gone"], teams: [] }, onChange: () => {} }));
    expect(html).toContain('data-local-models-recipient="pr_gone"');
    expect(html).toContain("A person of your organization");
    const team = renderToStaticMarkup(createElement(LocalModelSharing, { directory: null, viewerId: null, value: { people: [], teams: ["team_gone"] }, onChange: () => {} }));
    expect(team).toContain("A team of your organization");
  });
});
