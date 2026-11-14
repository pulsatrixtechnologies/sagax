// Team secrets and Phone calls are rows of the Organization's bots card
// (2026-10-26): no heading or card of their own inside it, no native
// <select> or checkbox, and the secret's editor only once asked for.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as store from "@/state/store";
import { EditorBox, EditorField, PillSelect } from "../SettingsPrimitives";
import { OrgPhoneCalls } from "./OrgPhoneCalls";
import { OrgTeamSecrets } from "./OrgTeamSecrets";

afterEach(() => vi.restoreAllMocks());

describe("organization forms layout", () => {
  it("draws Team secrets as one row with an Add a secret action and no form yet", () => {
    vi.spyOn(store, "useStore").mockReturnValue({
      state: { ...store.initialState, bots: [{ id: "bot-atlas", name: "Atlas" }] as unknown as typeof store.initialState.bots },
      dispatch: vi.fn(), flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn(),
    });
    const html = renderToStaticMarkup(createElement(OrgTeamSecrets));
    expect(html).toContain('data-settings-card="organization.teamSecrets"');
    expect(html).toContain('data-settings-row="teamSecrets"');
    expect(html).toContain("data-org-secret-add");
    expect(html).not.toContain("data-settings-group");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<input");
  });

  it("draws Phone calls as a row, without a nested group", () => {
    const html = renderToStaticMarkup(createElement(OrgPhoneCalls));
    expect(html).toContain('data-settings-row="phoneCalls"');
    expect(html).not.toContain("data-settings-group");
    expect(html).not.toContain('type="checkbox"');
  });

  it("hides Do not call while Phone calls is off, keeps the values, shows them when on", () => {
    const saved = { callbackNumber: "+15145550100", doNotCall: ["+15145550142"] };
    const off = renderToStaticMarkup(createElement(OrgPhoneCalls, { initial: { enabled: false, ...saved } }));
    expect(off).toContain('data-settings-row="phoneCalls"');
    expect(off).toContain("data-org-calls-enabled");
    expect(off).not.toContain('data-settings-row="phoneCallsDoNotCall"');
    // search still leads to the switch: the row carries the hidden row's words
    expect(off).toContain('data-settings-keywords="Do not call"');
    const on = renderToStaticMarkup(createElement(OrgPhoneCalls, { initial: { enabled: true, ...saved } }));
    expect(on).toContain('data-settings-row="phoneCallsDoNotCall"');
    expect(on).toContain("+1 514 555 0142");
  });

  it("never shows a callback number row nor its warning: calls no longer say one (#4193)", () => {
    for (const settings of [{ enabled: true, callbackNumber: "+15145550100", doNotCall: [] }, { enabled: true, doNotCall: [] }]) {
      const html = renderToStaticMarkup(createElement(OrgPhoneCalls, { initial: settings }));
      expect(html).not.toContain('data-settings-row="phoneCallsCallback"');
      expect(html).not.toContain("data-org-calls-no-callback");
      expect(html).not.toContain("Callback number");
      expect(html).not.toContain("+1 514 555 0100");
    }
  });

  it("says only what a call does: who calls, and that someone who asks to stop is not called again", () => {
    const html = renderToStaticMarkup(createElement(OrgPhoneCalls, { initial: { enabled: false, doNotCall: [] } }));
    expect(html).not.toContain("how to opt out");
    expect(html).toContain("Each call says it is an AI calling on your behalf.");
  });

  it("lays an editor's fields out as label and control rows, with its actions under them", () => {
    const html = renderToStaticMarkup(createElement(EditorBox, {
      label: "Add a secret",
      onSubmit: () => {},
      actions: createElement("button", { type: "submit" }, "Add"),
      children: [
        createElement(EditorField, { key: "a", label: "Label", children: createElement("input", { "aria-label": "Label" }) }),
        createElement(EditorField, { key: "b", label: "Kind", menu: true, children: createElement(PillSelect, { ariaLabel: "Kind", value: "a", onChange: () => {}, options: [{ value: "a", label: "A" }] }) }),
      ],
    }));
    expect(html).toMatch(/^<form aria-label="Add a secret"/);
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)]");
    expect(html).toMatch(/<label data-editor-field=""[^>]*>.*<input aria-label="Label"/);
    expect(html).toMatch(/<div role="group" aria-labelledby="[^"]+" data-editor-field=""/);
    expect(html).not.toContain("<select");
  });
});
