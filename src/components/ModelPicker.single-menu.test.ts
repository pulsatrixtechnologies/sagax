// One model menu everywhere: the chat bar menu. The two-column "panes"
// menu (categories left, models right) is gone; every surface that picks a
// model renders the same ModelPicker, never a copy or a second layout.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

const SURFACES = [
  "components/Composer.tsx-parts/ComposerActionBar.tsx",
  "components/ModelWindowHost.tsx",
  "components/settings/BotModelsSettings.tsx",
  "components/bot-settings/ModelSection.tsx",
  "components/bot-wizard/WizardSteps.tsx",
  "components/TeamSettingsDialog.tsx",
  "components/code/LaunchComposer.tsx",
];

describe("single model menu", () => {
  it("no source keeps the two-column menu", () => {
    const leftovers = files
      .filter(({ text }) => /paneGroups|PANE_FAVORITES_KEY|PANES_MENU_WIDTH|data-model-panes|data-model-pane-group|ModelPanesBody|<ModelPicker\b[^>]*\bpanes\b|model\.panes\./.test(text))
      .map(({ path }) => path);
    expect(leftovers).toEqual([]);
  });

  it("every surface renders the one ModelPicker", () => {
    for (const surface of SURFACES) {
      const file = files.find(({ path }) => path === surface);
      expect(file, surface).toBeDefined();
      expect(file!.text, surface).toMatch(/<ModelPicker\b/);
      expect(file!.text, surface).toMatch(/import\s*\{[^}]*\bModelPicker\b[^}]*\}\s*from\s*["'][./]*(components\/)?ModelPicker["']/);
    }
  });

  it("no surface keeps a native <select> or a free-text field for a model", () => {
    for (const surface of ["components/TeamSettingsDialog.tsx", "components/code/LaunchComposer.tsx"]) {
      const text = files.find(({ path }) => path === surface)!.text;
      for (const tag of text.match(/<(select|input)\b[^>]*>/g) ?? []) expect(tag, surface).not.toMatch(/model/i);
    }
  });

  it("only ModelPicker builds a model menu", () => {
    const builders = files
      .filter(({ text }) => /<ModelPickerMenu\b|<ModelSearchList\b/.test(text))
      .map(({ path }) => path)
      .sort();
    expect(builders).toEqual(["components/ModelPicker.tsx-parts/ModelPickerMenu.tsx", "gallery/model-menu.tsx"]);
  });
});
