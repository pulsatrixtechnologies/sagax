// The resolved capability list (lot 1b), shown in Plugins > Installed: a switch only
// where the list says the person may change it, "What <bot> receives", the
// index cap when it cuts, and never an id on screen.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { capabilityFixture } from "@/lib/capabilities.fixture";
import { containsUuid } from "../../../shared/human-id";

const { CapabilitiesBody } = await import("./CapabilitiesTab");

const render = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(CapabilitiesBody, { botName: "Scout", data: capabilityFixture(), onAdd: () => {}, ...extra }));
const visible = (html: string) => html.replace(/<[^>]+>/g, " ");

beforeEach(() => setLocale("en"));

describe("Resolved capability list", () => {
  it("shows each capability's budget and the installed signed pack, readable, on its detail", () => {
    const data = capabilityFixture();
    data.items[0]!.promptIndex = { bytes: 1_000, maxBytes: 4_000, skills: 2, maxSkills: 30, omitted: 1 };
    data.items[0]!.source.pack = `sha256:${"a".repeat(64)}`;
    data.items[0]!.source.version = "0.20.14";
    const html = render({ data, openAll: true });
    const text = visible(html);
    expect(text).toContain("Prompt budget");
    expect(text).toContain("2/30 files");
    expect(text).toContain("1 omitted");
    // no identifier on screen: the readable signed pack with its version;
    // the digest only behind the tooltip and the Copy action
    expect(text).toContain("Signed pack, version 0.20.14");
    expect(text).not.toContain("sha256:");
    expect(html).toContain(`title="${data.items[0]!.source.pack}"`);
    expect(html).toContain('aria-label="Copy the pack digest"');
    data.items[0]!.source.version = undefined;
    expect(visible(render({ data, openAll: true }))).toContain("Signed pack ");
  });
  it("lists one line per capability with its form, scope and state", () => {
    const html = render();
    expect(html.match(/data-capability="/g)?.length).toBe(8);
    expect(html).toContain('data-capability="flow" data-capability-scope="organization" data-capability-state="not_served"');
    expect(visible(html)).toContain("Not served by this engine");
    expect(visible(html)).toContain("To connect");
    expect(visible(html)).toContain("Engine account");
    expect(visible(html)).toContain("Everyone");
    expect(visible(html)).toContain("4 on");
  });

  it("shows a switch only where canToggle says so", () => {
    const html = render();
    // Notion, the skill, two Roles, GitHub (the bot's list of servers)
    expect(html.match(/role="switch"/g)?.length).toBe(5);
    expect(render({ switchable: () => false })).not.toContain('role="switch"');
  });

  it("says what the bot receives on its engine, and that the index cut", () => {
    const text = visible(render());
    expect(text).toContain("What Scout receives (engine: Codex)");
    expect(text).toContain("Notion, vcio-writing");
    expect(text).toContain("in the prompt");
    expect(text).toContain("(index 4 KB, 30 max)");
    expect(text).toContain("Dispatch, GitHub");
    expect(text).toContain("Pulsatrix Flow (Claude only today)");
    expect(text).toContain("The skills index of the prompt is full: 2 left out");
    const quiet = visible(render({ data: capabilityFixture({ promptIndex: { bytes: 900, maxBytes: 4_000, skills: 2, maxSkills: 30, omitted: 0 } }) }));
    expect(quiet).not.toContain("is full");
  });

  it("distinguishes a partial plugin scan from a known number of omitted references", () => {
    const text = visible(render({ data: capabilityFixture({ promptIndex: { bytes: 900, maxBytes: 4_000, skills: 2, maxSkills: 30, omitted: 0, incomplete: true } }) }));
    expect(text).toContain("Plugin discovery is partial");
    expect(text).not.toContain("0 left out");
  });

  it("opens a line on its detail: what it brings, who installed it, what the engine gets", () => {
    const text = visible(render({ openAll: true }));
    expect(text).toContain("notion-search");
    expect(text).toContain("notion-writer");
    expect(text).toContain("Alex Martin");
    expect(text).toContain("An update is offered");
    expect(text).toContain("Perspicax no longer lists this Role.");
  });

  it("never shows an id, even for a Role Perspicax no longer lists", () => {
    const text = visible(render({ openAll: true }));
    expect(containsUuid(text)).toBe(false);
    expect(text).toContain("Removed Role");
  });

  it("offers Add, and says when the bot receives nothing yet", () => {
    expect(render()).toContain("data-capabilities-add");
    expect(visible(render({ data: capabilityFixture({ items: [], promptIndex: undefined }) }))).toContain("Scout receives nothing on top of its engine yet");
  });

  it("reads in French", () => {
    setLocale("fr");
    const text = visible(render());
    expect(text).toContain("Ce que Scout reçoit (moteur : Codex)");
    expect(text).toContain("Non servie par ce moteur");
    expect(text).toContain("Ce bot");
    expect(text).toContain("4 activées");
  });
});
