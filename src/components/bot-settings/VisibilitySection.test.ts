import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { formFromVisibility, mixedRooms, visibilityFromForm, VisibilitySection } from "./VisibilitySection";
import { SettingsSurfaceProvider } from "../SettingsPrimitives";

const render = (target: Bot) => renderToStaticMarkup(createElement(StoreProvider, null, createElement(VisibilitySection, { bot: target })));

const bot = (visibility?: Bot["visibility"]) => ({ id: "b1", name: "Payroll", visibility } as unknown as Bot);

describe("bot visibility form", () => {
  it("round-trips the three settings", () => {
    expect(formFromVisibility(undefined)).toEqual({ mode: "everyone", people: "" });
    expect(formFromVisibility("everyone")).toEqual({ mode: "everyone", people: "" });
    expect(formFromVisibility("admins")).toEqual({ mode: "admins", people: "" });
    expect(formFromVisibility({ people: ["ada@example.test", "@acme.test"] })).toEqual({ mode: "people", people: "ada@example.test\n@acme.test" });
    expect(visibilityFromForm("everyone", "ignored")).toEqual({ ok: true, visibility: "everyone" });
    expect(visibilityFromForm("admins", "")).toEqual({ ok: true, visibility: "admins" });
    expect(visibilityFromForm("people", " Ada@Example.test,\n@acme.test ; ada@example.test ")).toEqual({ ok: true, visibility: { people: ["ada@example.test", "@acme.test"] } });
    // an empty list is refused here rather than saved as "admins only" by surprise
    expect(visibilityFromForm("people", " \n ")).toEqual({ ok: false });
  });

  it("names the rooms this bot shares with bots other people can see", () => {
    const bots = [
      { id: "b1", visibility: { people: ["Ada@example.test"] } },
      { id: "b2", visibility: undefined },
      { id: "b3", visibility: { people: ["ada@example.test"] } },
    ] as Array<Pick<Bot, "id" | "visibility">>;
    const groups = [
      { id: "g1", name: "Pay questions", memberIds: ["b1", "b2"] },
      { id: "g2", name: "HR desk", memberIds: ["b1", "b3"] },
      { id: "g3", name: "b1 ⇄ b2", memberIds: ["b1", "b2"], dm: true },
      // once narrower, still narrower: its floor outlived the bot that set it
      { id: "g4", name: "Old severance room", memberIds: ["b2"], audienceFloor: "admins" as const },
    ];
    expect(mixedRooms(bots[0]!, groups, bots)).toEqual([{ id: "g1", name: "Pay questions" }]);
    expect(mixedRooms(bots[2]!, groups, bots)).toEqual([]);
    expect(mixedRooms(bots[1]!, groups, bots).map((room) => room.id)).toEqual(["g1", "g4"]);
  });

  it("renders the stored choice, with the list when it names people", () => {
    const people = render(bot({ people: ["ada@example.test"] }));
    expect(people).toContain("Only these people");
    // the audience is a pill menu showing the stored choice
    expect(people).toMatch(/aria-label="Who can see it"[^>]*title="Only these people"/);
    expect(people).toContain("ada@example.test</textarea>");
    const everyone = render(bot());
    expect(everyone).toMatch(/aria-label="Who can see it"[^>]*title="Everyone who can sign in"/);
    expect(everyone).not.toContain("<textarea");
  });
});

// The bot's profile page (#2313): one plain card under the grey label
// "Who can see it", the row titled "Visible to", the people list a filled
// field and Save a plain pill inside the card.
describe("bot visibility on the profile page (plain surface)", () => {
  const renderPlain = (target: Bot) => renderToStaticMarkup(createElement(StoreProvider, null, createElement(SettingsSurfaceProvider, { surface: "plain", children: createElement(VisibilitySection, { bot: target }) })));
  const withoutPopovers = (markup: string) => markup.replace(/<div[^>]*popover-surface[\s\S]*?<\/div>/g, "");

  it("has the grey label, the row and the list, with no border, underline or primary pill", () => {
    const markup = renderPlain(bot({ people: ["ada@example.test"] }));
    expect(markup).toContain('data-settings-group="botVisibility"');
    expect(markup).toContain(">Who can see it<");
    expect(markup).toContain(">Visible to<");
    expect(markup).toMatch(/aria-label="Who can see it"[^>]*title="Only these people"/);
    expect(markup).toContain("ada@example.test</textarea>");
    expect(markup).toContain(">Save<");
    expect(markup).toContain("data-bot-visibility");
    const bare = withoutPopovers(markup);
    expect(bare).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
    expect(bare).not.toContain("underline");
    expect(bare).not.toContain("ui-button-primary");
  });
});
