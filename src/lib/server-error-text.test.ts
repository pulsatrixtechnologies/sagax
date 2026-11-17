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
  // #4471: the gate's refusal of a route no list names, and a bot that is not the person's
  ["admin_route", "Only an administrator can do this on this server. Ask an administrator if you need it.", "Seul un administrateur peut faire ça sur ce serveur. Demande-le à un administrateur si tu en as besoin."],
  ["bot_owner_only", "Only this bot's owner, or someone who may edit it, can do this.", "Seul le propriétaire de ce bot, ou une personne qui peut le modifier, peut faire ça."],
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

  // #4471: the gate says why a route is an administrator's; a handler's own
  // admin_only refusal keeps its own sentence
  it("names why a route is an administrator's, in the app's language", () => {
    const body = { error: "Only an administrator can do this: the fleet is every installation this one manages.", code: "admin_route", reasonKey: "serverError.adminRoute.fleet" };
    setLocale("en");
    expect(serverErrorMessage(body)).toBe("Only an administrator can do this: the fleet is every installation this one manages.");
    setLocale("fr");
    expect(serverErrorMessage(body)).toBe("Seul un administrateur peut faire ça : la flotte, c'est chaque installation que celle-ci gère.");
    // a key this build does not know, or one outside the reasons, reads plainly
    expect(serverErrorMessage({ ...body, reasonKey: "serverError.adminRoute.later" })).toMatch(/^Seul un administrateur peut faire ça sur ce serveur/);
    expect(serverErrorMessage({ ...body, reasonKey: "serverError.threadBusy" })).toMatch(/^Seul un administrateur peut faire ça sur ce serveur/);
    expect(serverErrorMessage({ error: "Only an organization admin changes phone call settings.", code: "admin_only" })).toBeNull();
  });

  it("covers the desktop-flow approval refusal and leaves other bodies alone", () => {
    setLocale("fr");
    expect(serverErrorMessage({ code: "approval_desktop_required" })).toMatch(/flux de permissions/);
    expect(serverErrorMessage({ code: "something_else", error: "x" })).toBeNull();
    expect(serverErrorMessage({ code: "constructor" })).toBeNull();
    expect(serverErrorMessage(null)).toBeNull();
  });
});
