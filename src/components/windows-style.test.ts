// The windows drawn like Settings (2026-10-16, lot A): About, the release
// notes, the confirmation and the keyboard shortcuts share Settings' frame,
// and their words follow the app language.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { formatReleaseDate, releaseNotesDate, sanitizeReleaseMarkdown } from "@/lib/release-notes";
import { AboutDialog } from "./AboutDialog";
import { ConfirmDialogCard } from "./ConfirmDialog";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { ReleaseNotesBody } from "./ReleaseNotesMarkdown";

afterEach(() => {
  setLocale("en");
  vi.unstubAllGlobals();
});

const confirm = (tone: "danger" | "neutral") =>
  renderToStaticMarkup(createElement(ConfirmDialogCard, {
    open: true,
    title: "Delete Pepper?",
    body: "This cannot be undone.",
    confirmLabel: "Delete",
    tone,
    onCancel: () => {},
    onConfirm: () => {},
  }));

describe("ConfirmDialog", () => {
  it("is drawn like Settings with Cancel in the app language and a red pill to erase", () => {
    const html = confirm("danger");
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("rounded-[14px]");
    expect(html).toContain(">Cancel</button>");
    expect(html).toMatch(/class="[^"]*bg-danger[^"]*"[^>]*>Delete<\/button>/);
    setLocale("fr");
    expect(confirm("neutral")).toContain(">Annuler</button>");
    expect(confirm("neutral")).not.toContain("bg-danger");
  });
});

describe("AboutDialog", () => {
  it("shows the Pulsatrix mark, Sagax, the version and the links as rows", () => {
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(AboutDialog, { open: true, onClose: () => {} }));
    expect(html).toContain("data-about-mark");
    expect(html).toContain(">Sagax</h2>");
    expect(html).toMatch(/>Version [^<]+</);
    expect(html.match(/data-link-row=/g)).toHaveLength(4);
    expect(html.indexOf(">Release notes<")).toBeLessThan(html.indexOf(">GitHub<"));
    expect(html).toContain("© 2026 Pulsatrix Technologies inc.");
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AboutDialog, { open: true, onClose: () => {} }));
    expect(fr).toContain(">Licence<");
    expect(fr).toContain("Basé sur OpenMausBot");
    expect(renderToStaticMarkup(createElement(AboutDialog, { open: false, onClose: () => {} }))).toBe("");
  });
});

describe("release notes", () => {
  const file = "<!-- date: 2026-10-16 -->\nIntro FR.\n\n## Fil\n\n* point\n\n## English\n\nIntro EN.\n\n## Thread\n\n* item\n";

  it("reads the hidden date line, never shows it, and writes the date in the app language", () => {
    expect(releaseNotesDate(file)).toBe("2026-10-16");
    expect(releaseNotesDate("no date")).toBeNull();
    expect(sanitizeReleaseMarkdown(file)).not.toContain("date:");
    expect(formatReleaseDate("2026-10-16", "fr")).toBe("16 octobre 2026");
    expect(formatReleaseDate("2026-10-16", "en")).toBe("October 16, 2026");
    expect(formatReleaseDate("soon", "en")).toBeNull();
  });

  it("titles each version with its date and draws its sections as grey headings", () => {
    const html = renderToStaticMarkup(createElement(ReleaseNotesBody, { notes: [{ version: "0.5.7", note: file }], language: "fr", headings: true }));
    expect(html).toContain(">Version 0.5.7</h3>");
    expect(html).toContain('data-release-date="2026-10-16"');
    expect(html).toContain("16 octobre 2026");
    expect(html).toMatch(/data-release-section=""[^>]*text-ink-secondary[^>]*>Fil<\/h4>/);
    expect(html).not.toContain("Thread");
  });
});

describe("KeyboardShortcutsModal", () => {
  it("shows the sheet in French, with categories as grey headings over cards", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(KeyboardShortcutsModal, { open: true, onClose: () => {} }));
    expect(html).toContain(">Raccourcis clavier</h2>");
    expect(html).toContain('aria-label="Fermer les raccourcis clavier"');
    expect(html).toContain(">Envoyer le message</span>");
    expect(html).toMatch(/data-settings-group="shortcuts\.Navigation"/);
    expect(html).toContain(">Terminé</button>");
    expect(html).not.toContain("Send message");
  });
});
