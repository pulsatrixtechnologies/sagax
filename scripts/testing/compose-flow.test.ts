// The catalogue no longer has a sidebar "Browse Bots" button. These cases
// lock the snapshot decisions openTemplatesCatalog makes without a browser.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECT_APPS_BUTTON, catalogTemplateTools, nestedTemplatesCatalog, openTemplatesCatalog, type CatalogFlow } from "./compose-flow.ts";

const EN = JSON.parse(readFileSync(new URL("../../src/locales/en.json", import.meta.url), "utf8")) as Record<string, string>;

const HOME = [
  'button "Back"',
  'heading "Browse Bots"',
  'button "Import"',
  'button "Share a team"',
].join("\n");

function flow(pages: string[]): { flow: CatalogFlow; clicks: string[] } {
  const clicks: string[] = [];
  let index = 0;
  return {
    clicks,
    flow: {
      flag: async () => {},
      snapshot: async () => pages[Math.min(index, pages.length - 1)] ?? "",
      click: async (name) => {
        clicks.push(name);
        index += 1;
      },
    },
  };
}

describe("openTemplatesCatalog", () => {
  it("treats the hosted home as ready even though its Back returns to Connect Apps", () => {
    expect(catalogTemplateTools(HOME)).toBe(true);
    expect(nestedTemplatesCatalog(HOME)).toBe(false);
  });

  it("walks Back only from View all or a detail, where the heading is no longer Browse Bots", () => {
    const viewAll = ['button "Back"', 'heading "Templates"', "Browse Bots"].join("\n");
    expect(nestedTemplatesCatalog(viewAll)).toBe(true);
    expect(nestedTemplatesCatalog(HOME)).toBe(false);
    expect(nestedTemplatesCatalog('heading "Connect Apps"\nbutton "Bot templates"')).toBe(false);
  });

  it("clicks the sidebar foot's button by the name the app shows, connectApps.title", () => {
    // #4169 renamed the window from Plugins to Connect Apps; the smokes kept
    // clicking "Plugins", which names nothing any more (#3568).
    expect(CONNECT_APPS_BUTTON).toBe(EN["connectApps.title"]);
    expect(CONNECT_APPS_BUTTON).toBe("Connect Apps");
  });

  it("opens Connect Apps, then Bot templates, and stops once Import and Share a team show", async () => {
    const { flow: catalog, clicks } = flow([
      'button "Connect Apps"',
      'heading "Connect Apps"\nbutton "Bot templates"',
      HOME,
    ]);
    await openTemplatesCatalog(catalog);
    expect(clicks).toEqual(["Connect Apps", "Bot templates"]);
  });

  it("leaves the hosted home's Back alone", async () => {
    const { flow: catalog, clicks } = flow([HOME]);
    await openTemplatesCatalog(catalog);
    expect(clicks).toEqual([]);
  });

  it("steps Back from a detail until the template tools show", async () => {
    const { flow: catalog, clicks } = flow([
      'button "Back"\nheading "From Customer Co"\nBrowse Bots',
      HOME,
    ]);
    await openTemplatesCatalog(catalog);
    expect(clicks).toEqual(["Back"]);
  });
});
