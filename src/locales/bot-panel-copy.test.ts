import { expect, it } from "vitest";

import en from "./en.json";
import fr from "./fr.json";

const translated = [
  "botSettings.nav.overview",
  "botModel.ifFails.title",
  "botPanel.access.nothing",
  "botPanel.overview.refresh",
  "botPanel.memory.upkeepHelp",
  "settings.share.intro",
  "settings.servers.title",
  "localAuto.title",
  "botPanel.skills.title",
  "botPanel.routines.hint",
  "botPanel.routines.hintAsk",
  "settings.profile.uploadPhoto",
  "routines.empty",
] as const;

it("translates Bot panel and Settings card copy into French", () => {
  for (const key of translated) {
    expect(fr[key], key).toBeTruthy();
    expect(fr[key], key).not.toBe(en[key]);
  }
  expect(en["botPanel.overview.refresh"]).toBe("Couldn’t refresh. Showing the last loaded overview.");
  expect(en["settings.share.intro"]).not.toMatch(/\bworkspaces?\b/i);
  expect(en["botPanel.access.placeholder"]).toBe("Private bot folder, or an absolute path");
  expect(fr["botSettings.nav.soul"]).toBe("Personnalité");
  expect(fr["routines.empty"]).toBe("Aucune routine pour l'instant.");
});
