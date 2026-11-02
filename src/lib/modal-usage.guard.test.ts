import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Lot 8 / docs/design/ux-reference-grokbot-cursor.md principle 5:
// the only allowed window for a decision is ConfirmDialog. Settings, viewers,
// barriers, the palette, shortcut help, floating windows and menus stay.
// New DialogFrame / useModalDialog / window.confirm usages must be listed
// here on purpose, never slipped in.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Production files that may still import DialogFrame (definition + exceptions
 * and surfaces owned by later lots that have not emptied the frame yet). */
const DIALOG_FRAME_ALLOW = new Set([
  "components/SettingsPrimitives.tsx", // definition + Settings chrome
  "components/TermsGate.tsx", // barrier (GARDER)
  "components/UpdateBanner.tsx", // lot 6: move error into the banner
  "components/bot-settings/CodeBranchList.tsx", // branch forms; empty with later bot-panel work
  "components/settings/BotModelsSettings.tsx", // BulkModelChoice picker until a popover lands
]);

/** Production files that may call useModalDialog. */
const USE_MODAL_DIALOG_ALLOW = new Set([
  "hooks/use-modal-dialog.ts", // definition
  "components/artifacts/ArtifactFrame.tsx", // viewer (GARDER)
  "components/RoutineCalendarPage.tsx", // EventEditor window path until panel-only
]);

/** Files that may mention window.confirm only in comments (or this guard). */
const WINDOW_CONFIRM_ALLOW = new Set([
  "components/ConfirmDialog.tsx", // documents the replacement
  "lib/modal-usage.guard.test.ts",
]);

const WINDOW_CONFIRM = /\bwindow\s*\.\s*confirm\b|\bogb\s*\?\.\s*confirm\b|\bogb\s*\.\s*confirm\b/;
const DIALOG_FRAME_IMPORT = /\bDialogFrame\b/;
const USE_MODAL = /\buseModalDialog\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "gallery" || entry.name === "node_modules") return [];
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function rel(path: string): string {
  return relative(SRC, path).split("\\").join("/");
}

describe("modal usage guard (lot 8)", () => {
  const files = sourceFiles(SRC).map((path) => ({ name: rel(path), text: readFileSync(path, "utf8") }));

  it("bans window.confirm and ogb.confirm outside the documented helpers", () => {
    const hits = files
      .filter((file) => !WINDOW_CONFIRM_ALLOW.has(file.name))
      .filter((file) => WINDOW_CONFIRM.test(file.text))
      // Ignore pure comments that only name the ban.
      .filter((file) => {
        const withoutComments = file.text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        return WINDOW_CONFIRM.test(withoutComments);
      })
      .map((file) => file.name);
    expect(hits).toEqual([]);
  });

  it("limits DialogFrame to the allowlist", () => {
    const hits = files
      .filter((file) => DIALOG_FRAME_IMPORT.test(file.text))
      .map((file) => file.name)
      .filter((name) => !DIALOG_FRAME_ALLOW.has(name));
    expect(hits).toEqual([]);
  });

  it("limits useModalDialog to the allowlist", () => {
    const hits = files
      .filter((file) => USE_MODAL.test(file.text))
      .map((file) => file.name)
      .filter((name) => !USE_MODAL_DIALOG_ALLOW.has(name));
    expect(hits).toEqual([]);
  });

  it("keeps ConfirmDialog as an alertdialog", () => {
    const confirm = files.find((file) => file.name === "components/ConfirmDialog.tsx");
    expect(confirm?.text).toMatch(/role="alertdialog"/);
  });
});
