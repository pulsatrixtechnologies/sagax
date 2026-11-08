import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { serverErrorMessage } from "./server-error-text";

afterEach(() => setLocale("en"));

const CASES: Array<[code: string, en: string, fr: string]> = [
  ["not_group_owner", "Only the group's owner can do this.", "Seul le propriétaire du groupe peut le faire."],
  ["sole_member", "You are the only person left in this group. Delete it instead of leaving.", "Tu es la seule personne restante dans ce groupe. Supprime-le plutôt que de le quitter."],
  ["not_channel_editor", "Only an owner or an admin can change who is in a channel.", "Seul un propriétaire ou un admin peut changer les personnes d'un canal."],
  ["thread_busy", "The bot is already working here. Interrupt it, or wait for it to finish.", "Le bot travaille déjà ici. Interromps-le ou attends qu'il termine."],
  ["thread_limit", "This bot has reached its limit of parallel threads. Wait for one to finish.", "Ce bot a atteint sa limite de fils en parallèle. Attends qu'un fil se termine."],
  ["safety_blocked", "This request is refused by the safety review.", "Cette demande est refusée par la revue de sécurité."],
];

describe("server refusals, in the app's language", () => {
  it.each(CASES)("says %s in English and in French, whatever the server's sentence", (code, en, fr) => {
    setLocale("en");
    expect(serverErrorMessage({ error: "Cette phrase du serveur", code })).toBe(en);
    setLocale("fr");
    expect(serverErrorMessage({ error: "a server sentence", code })).toBe(fr);
  });

  it("shows the French-only security refusals in English in the English app", () => {
    setLocale("en");
    for (const code of ["misuse_blocked", "misuse_approval_required", "misuse_locked"]) {
      const text = serverErrorMessage({ error: "Cette demande est refusée par la politique de sécurité.", code });
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/Cette|demande|refusée/);
    }
  });

  // 2026-11-02: one reason, never the list of every forbidden action
  it("names the one reason of a security block, in the app's language", () => {
    setLocale("en");
    const files = serverErrorMessage({ error: "x", code: "misuse_blocked", reason: "platform_exfiltration" });
    expect(files).toMatch(/belongs to the Sagax server/);
    expect(files).not.toMatch(/privilege|malware|attacking/i);
    setLocale("fr");
    expect(serverErrorMessage({ error: "x", code: "misuse_blocked", reason: "offensive_hacking" })).toMatch(/attaquer ou à balayer/);
    expect(serverErrorMessage({ error: "x", code: "misuse_blocked", reason: "constructor" })).toBe("Refusé par la politique de sécurité de Sagax. Reformule la demande sans cette action.");
    expect(serverErrorMessage({ error: "x", code: "misuse_blocked" })).not.toMatch(/élévation|malveillant|attaque/);
  });

  it("covers the desktop-flow approval refusal and leaves other bodies alone", () => {
    setLocale("fr");
    expect(serverErrorMessage({ code: "approval_desktop_required" })).toMatch(/flux de permissions/);
    expect(serverErrorMessage({ code: "something_else", error: "x" })).toBeNull();
    expect(serverErrorMessage({ code: "constructor" })).toBeNull();
    expect(serverErrorMessage(null)).toBeNull();
  });
});
