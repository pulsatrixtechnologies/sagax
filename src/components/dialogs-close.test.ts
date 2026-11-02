// Every modal dialog in the app can be dismissed: Escape closes it and its
// Cancel / Close buttons are wired to a real handler. Owner report 0.4.1: an
// empty "Create bot" dialog over Settings > General ignored Cancel and
// Escape (NewBotDialog.test.ts holds the behavioural regression). This scan
// keeps the rule for dialogs added later, without a DOM in the test run.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
/** Screenshot galleries (src/gallery, excluded in tsconfig.json too): static
 * Playwright pages with sample frames, not shipped in the app. */
const NOT_SHIPPED = new Set([join(ROOT, "gallery")]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (NOT_SHIPPED.has(path)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".tsx") && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** A JSX element that declares itself a dialog (not a CSS selector string
 * such as '[role="dialog"]'), with the attributes on its opening tag. */
function dialogTags(source: string): string[] {
  const tags: string[] = [];
  const pattern = /<[A-Za-z][\w.]*\b[^<>]*?(?<!\[)role=(?:"(?:alert)?dialog"|\{[^}]*dialog[^}]*\})[^<>]*?>/g;
  for (const match of source.matchAll(pattern)) tags.push(match[0]);
  return tags;
}

/** Dialogs drawn inside a host that owns their Escape key (non-modal). */
const ESCAPE_HOST: Record<string, string> = {
  // the mascot's balloon: FloatingBotView closes it on Escape
  "components/floating-bots/Balloon.tsx": "components/floating-bots/FloatingBotView.tsx",
  // the model picker window: ModelPicker.tsx wires useModelPickerEffects, whose
  // keydown effect closes the window on Escape (split out of ModelPicker.tsx, #1383)
  "components/ModelPicker.tsx-parts/ModelPickerWindow.tsx": "components/ModelPicker.tsx-parts/useModelPickerEffects.ts",
};

const posix = (path: string) => relative(ROOT, path).split(sep).join("/");
const modalFiles = sources(ROOT)
  .map((path) => ({ path, source: readFileSync(path, "utf8").replace(/\r\n/g, "\n") }))
  .map((file) => ({ ...file, modal: dialogTags(file.source).filter((tag) => !/aria-modal=(?:"false"|\{false\})/.test(tag)) }))
  .filter((file) => file.modal.length > 0);

describe("every modal dialog closes", () => {
  it("finds the app's dialogs", () => {
    // a broken pattern must not pass by finding nothing
    expect(modalFiles.length).toBeGreaterThan(20);
    expect(modalFiles.map((file) => posix(file.path))).toContain("components/NewBotDialog.tsx");
  });

  it.each(modalFiles.map((file) => [posix(file.path), file] as const))("%s closes on Escape", (name, file) => {
    const host = ESCAPE_HOST[name];
    // useModalDialog (hooks/use-modal-dialog.ts), usePopoverDismiss (hooks/use-popover-dismiss.ts) and useCategoryModalKeyboard
    // (components/category-modal.ts, shared by Achievements and the persona editor, #241) close their dialog on Escape
    expect(host ? readFileSync(join(ROOT, host), "utf8").replace(/\r\n/g, "\n") : file.source).toMatch(/["']Escape["']|\buseModalDialog\(|\busePopoverDismiss\(|\buseCategoryModalKeyboard\(/);
  });

  it.each(modalFiles.map((file) => [posix(file.path), file] as const))("%s wires its Cancel and Close buttons", (_name, file) => {
    const buttons = [...file.source.matchAll(/<button\b[^>]*>\s*\{t\("common\.(?:cancel|close)"\)\}/g)].map((match) => match[0]);
    for (const button of buttons) {
      expect(button, button).toMatch(/onClick=\{/);
      expect(button, button).not.toMatch(/onClick=\{\s*\(\)\s*=>\s*\{\s*\}\s*\}/);
    }
  });
});
