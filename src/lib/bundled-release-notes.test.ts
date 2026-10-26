import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledNotesFor, bundledNotesSince, bundledReleaseCatalog, bundledVersions } from "./bundled-release-notes";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { forkVersion: string };

describe("bundledReleaseCatalog", () => {
  it("bundles the shipped release notes, including 0.4.4", () => {
    const catalog = bundledReleaseCatalog();
    expect(catalog["0.4.4"]).toContain("## English");
    expect(catalog["0.4.6"]).toContain("## English");
    expect(catalog["0.4.8"]).toContain("## English");
    expect(catalog["0.4.9"]).toContain("## English");
    expect(catalog["0.4.10"]).toContain("## English");
    expect(catalog["0.4.11"]).toContain("## English");
    expect(catalog["0.4.12"]).toContain("## English");
    expect(catalog["0.4.13"]).toContain("## English");
    expect(catalog["0.4.14"]).toContain("## English");
    expect(catalog["0.4.15"]).toContain("## English");
    expect(catalog["0.4.16"]).toContain("## English");
    expect(catalog["0.4.17"]).toContain("## English");
    expect(catalog["0.4.18"]).toContain("## English");
    expect(catalog["0.4.19"]).toContain("## English");
    expect(catalog["0.4.22"]).toContain("## English");
    expect(catalog["0.5.0"]).toContain("## English");
    expect(catalog["0.5.1"]).toContain("## English");
    expect(catalog["0.5.2"]).toContain("## English");
    expect(catalog["0.5.2"]).toMatch(/allumé volontairement/);
    expect(catalog["0.5.2"]).toMatch(/enabled it on purpose/);
    expect(catalog["0.5.2"]).toContain("SAGAX_BOOT_ENGINE_SLOTS");
    expect(catalog["0.5.2"]).toContain("SAGAX_SANDBOX_K8S_NODE_SELECTOR");
    expect(catalog["0.5.2"]).toContain("SAGAX_SANDBOX_K8S_WAKE_URL");
    expect(catalog["0.5.3"]).toContain("## English");
    expect(catalog["0.5.3"]).toMatch(/Menus simplifiés/);
    expect(catalog["0.5.3"]).toMatch(/Simpler menus/);
    expect(catalog["0.5.3"]).toMatch(/Permissions des bots/);
    expect(catalog["0.5.3"]).toMatch(/Bot permissions/);
    expect(catalog["0.5.3"]).toMatch(/Agents temporaires/);
    expect(catalog["0.5.3"]).toMatch(/Temporary agents/);
    expect(catalog["0.5.4"]).toContain("## English");
    expect(catalog["0.5.4"]).toMatch(/Utilisation/);
    expect(catalog["0.5.4"]).toMatch(/Usage/);
    expect(catalog["0.5.5"]).toContain("## English");
    expect(catalog["0.5.5"]).toMatch(/Dossier du bot/);
    expect(catalog["0.5.5"]).toMatch(/Bot folder/);
    expect(catalog["0.5.6"]).toContain("## English");
    expect(catalog["0.5.6"]).toMatch(/Nouveau fil/);
    expect(catalog["0.5.6"]).toMatch(/New thread/);
    expect(catalog["0.5.7"]).toContain("## English");
    expect(catalog["0.5.7"]).toMatch(/Terminal par destination/);
    expect(catalog["0.5.7"]).toMatch(/Open a terminal/);
    expect(catalog["0.5.8"]).toContain("## English");
    expect(catalog["0.5.8"]).toMatch(/128 outils/);
    expect(catalog["0.5.8"]).toMatch(/128 tool limit/);
    expect(catalog["0.5.9"]).toContain("## English");
    expect(catalog["0.5.9"]).toMatch(/Notes vocales/);
    expect(catalog["0.5.9"]).toMatch(/voice notes/);
    expect(catalog["0.5.10"]).toContain("## English");
    expect(catalog["0.5.10"]).toMatch(/Coffre d'identifiants/);
    expect(catalog["0.5.10"]).toMatch(/Credential vault/);
    expect(catalog["0.5.11"]).toContain("## English");
    expect(catalog["0.5.11"]).toMatch(/Fils confidentiels/);
    expect(catalog["0.5.11"]).toMatch(/Confidential threads/);
    expect(catalog["0.5.12"]).toContain("## English");
    expect(catalog["0.5.12"]).toMatch(/Un fil s'ouvre toujours/);
    expect(catalog["0.5.12"]).toMatch(/a thread always opens/);
    expect(catalog["0.5.13"]).toContain("## English");
    expect(catalog["0.5.13"]).toMatch(/Autoriser une fois, ou refuser/);
    expect(catalog["0.5.13"]).toMatch(/Allow once, or deny/);
    expect(catalog["0.5.14"]).toContain("## English");
    expect(catalog["0.5.14"]).toMatch(/Liens durs/);
    expect(catalog["0.5.14"]).toMatch(/Hard links/);
    expect(catalog["0.5.15"]).toContain("## English");
    expect(catalog["0.5.15"]).toMatch(/Claude Code accepté/);
    expect(catalog["0.5.15"]).toMatch(/Claude Code accepted/);
    expect(catalog["0.5.16"]).toContain("## English");
    expect(catalog["0.5.16"]).toMatch(/Une seule conversation par bot/);
    expect(catalog["0.5.16"]).toMatch(/One conversation per bot/);
    expect(catalog["0.5.17"]).toContain("## English");
    expect(catalog["0.5.17"]).toMatch(/Fournisseurs masqués par l'organisation/);
    expect(catalog["0.5.17"]).toMatch(/Hidden providers, gone everywhere/);
    expect(catalog["0.5.18"]).toContain("## English");
    expect(catalog["0.5.18"]).toMatch(/Effets d'arrière-plan/);
    expect(catalog["0.5.18"]).toMatch(/Upcoming automations/);
    expect(catalog["0.5.19"]).toContain("## English");
    expect(catalog["0.5.19"]).toMatch(/Réactions des bots/);
    expect(catalog["0.5.19"]).toMatch(/Bot reactions/);
    expect(catalog["0.5.20"]).toContain("## English");
    expect(catalog["0.5.20"]).toMatch(/Signaler une réponse/);
    expect(catalog["0.5.20"]).toMatch(/Report a reply/);
    expect(catalog["0.5.21"]).toContain("## English");
    expect(catalog["0.5.21"]).toMatch(/Suppression du compte/);
    expect(catalog["0.5.21"]).toMatch(/Update button/);
    expect(catalog["0.5.22"]).toContain("## English");
    expect(catalog["0.5.22"]).toMatch(/Barres de défilement auto-masquées/);
    expect(catalog["0.5.22"]).toMatch(/Auto-hiding scrollbars/);
    expect(catalog["0.5.23"]).toContain("## English");
    expect(catalog["0.5.23"]).toMatch(/Onglet Liens/);
    expect(catalog["0.5.23"]).toMatch(/Writing while a bot works/);
    expect(catalog["0.5.24"]).toContain("## English");
    expect(catalog["0.5.24"]).toMatch(/host\.commands/);
    expect(catalog["0.5.24"]).toMatch(/Your own destinations, no administrator/);
    expect(catalog["0.5.25"]).toContain("## English");
    expect(catalog["0.5.25"]).toMatch(/Living mascots/);
    expect(catalog["0.5.25"]).toMatch(/Your destination, your card/);
    expect(catalog["0.6.6"]).toContain("## English");
    expect(catalog["0.6.6"]).toMatch(/brings Sagax closer to Grok Bot/);
    expect(catalog["0.6.7"]).toContain("## English");
    expect(catalog["0.7.0"]).toContain("## English");
    expect(catalog["0.7.0"]).toMatch(/Sessions à distance/);
    expect(catalog["0.7.1"]).toContain("## English");
    expect(catalog["0.7.1"]).toMatch(/Tailcat livré avec Sagax/);
    expect(catalog["0.7.2"]).toContain("## English");
    expect(catalog["0.7.2"]).toMatch(/Mémoire d.équipe/);
    expect(catalog["0.7.3"]).toContain("## English");
    expect(catalog["0.7.3"]).toMatch(/Connecteurs des moteurs/);
    expect(catalog["0.7.4"]).toContain("## English");
    expect(catalog["0.7.4"]).toMatch(/Marketplace privé par défaut/);
    expect(catalog["0.7.5"]).toContain("## English");
    expect(catalog["0.7.5"]).toMatch(/Retrait de Composio/);
    expect(catalog["0.7.6"]).toContain("## English");
    expect(catalog["0.7.6"]).toMatch(/Premier démarrage guidé/);
    expect(catalog["0.7.7"]).toContain("## English");
    expect(catalog["0.7.7"]).toMatch(/Traces d'utilisation par personne/);
    expect(catalog["0.5.26"]).toMatch(/Requested by/);
    expect(catalog["0.5.26"]).toMatch(/This run/);
    expect(Object.keys(catalog).sort()).toEqual(["0.4.0", "0.4.1", "0.4.10", "0.4.11", "0.4.12", "0.4.13", "0.4.14", "0.4.15", "0.4.16", "0.4.17", "0.4.18", "0.4.19", "0.4.2", "0.4.20", "0.4.21", "0.4.22", "0.4.3", "0.4.4", "0.4.5", "0.4.6", "0.4.7", "0.4.8", "0.4.9", "0.5.0", "0.5.1", "0.5.10", "0.5.11", "0.5.12", "0.5.13", "0.5.14", "0.5.15", "0.5.16", "0.5.17", "0.5.18", "0.5.19", "0.5.2", "0.5.20", "0.5.21", "0.5.22", "0.5.23", "0.5.24", "0.5.25", "0.5.26", "0.5.27", "0.5.28", "0.5.29", "0.5.3", "0.5.30", "0.5.4", "0.5.5", "0.5.6", "0.5.7", "0.5.8", "0.5.9", "0.6.0", "0.6.1", "0.6.2", "0.6.3", "0.6.4", "0.6.5", "0.6.6", "0.6.7", "0.7.0", "0.7.1", "0.7.2", "0.7.3", "0.7.4", "0.7.5", "0.7.6", "0.7.7"]);
  });

  it("reads a version from the file name and picks the language section", () => {
    const catalog = bundledReleaseCatalog({
      "/docs/releases/1.2.0.md": "Français\n\n## English\n\nEnglish text",
      "/docs/releases/notes.md": "ignored",
    });
    expect(bundledNotesFor("1.2.0", "fr", catalog)).toBe("Français");
    expect(bundledNotesFor("1.2.0", "ja", catalog)).toBe("English text");
    expect(bundledNotesFor("9.9.9", "en", catalog)).toBeNull();
  });
});

describe("version browsing", () => {
  const catalog = {
    "0.9.0": "Neuf\n\n## English\n\nNine",
    "0.10.0": "Dix\n\n## English\n\nTen",
    "0.2.0": "Only French here",
  };

  it("lists versions newest first by semver, not by string", () => {
    expect(bundledVersions(catalog)).toEqual(["0.10.0", "0.9.0", "0.2.0"]);
  });

  it("lists the real bundle newest first with the running release on top", () => {
    const versions = bundledVersions();
    expect(versions[0]).toBe(packageJson.forkVersion);
    expect(versions.at(-1)).toBe("0.4.0");
  });

  it("bundles the release being built, so What's new and About show it after the update", () => {
    expect(bundledNotesFor(packageJson.forkVersion, "fr")).toBeTruthy();
    expect(bundledNotesFor(packageJson.forkVersion, "en")).toBeTruthy();
    expect(bundledNotesFor(packageJson.forkVersion, "fr")).not.toBe(bundledNotesFor(packageJson.forkVersion, "en"));
  });

  it("renders the chosen file in the UI language, and falls back when there is no English section", () => {
    expect(bundledNotesFor("0.9.0", "fr", catalog)).toBe("Neuf");
    expect(bundledNotesFor("0.9.0", "en", catalog)).toBe("Nine");
    expect(bundledNotesFor("0.10.0", "pt-BR", catalog)).toBe("Ten");
    expect(bundledNotesFor("0.2.0", "en", catalog)).toBe("Only French here");
  });

  it("collects the changes after the previous version up to the current one", () => {
    expect(bundledNotesSince("0.2.0", "0.9.0", catalog).map((entry) => entry.version)).toEqual(["0.9.0"]);
    expect(bundledNotesSince("0.2.0", "0.10.0", catalog).map((entry) => entry.version)).toEqual(["0.10.0", "0.9.0"]);
    expect(bundledNotesSince("0.10.0", "0.10.0", catalog)).toEqual([]);
  });
});
