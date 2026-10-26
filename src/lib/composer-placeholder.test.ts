import { beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { composerPlaceholder, type ComposerPlaceholderInput } from "./composer-placeholder";

const base: ComposerPlaceholderInput = { approval: false, attachmentPending: false, recording: false, busy: false, botName: "Scout" };

describe("composerPlaceholder", () => {
  beforeEach(() => setLocale("en"));

  it("names the bot of a 1:1 chat, idle or working", () => {
    expect(composerPlaceholder(base)).toBe("Message Scout");
    expect(composerPlaceholder({ ...base, busy: true })).toBe("Message Scout");
    expect(composerPlaceholder({ ...base, busy: true })).not.toContain("working");
  });

  it("falls back to the plain line without a name", () => {
    expect(composerPlaceholder({ ...base, botName: "" })).toBe("Write a message…");
  });

  it("says only 'Write a message…' while a room works", () => {
    expect(composerPlaceholder({ ...base, busy: true, groupName: "Launch", groupHint: () => "ignored" })).toBe("Write a message…");
  });

  it("is translated", () => {
    setLocale("fr");
    expect(composerPlaceholder({ ...base, busy: true })).toBe("Écrire un message à Scout");
    expect(composerPlaceholder({ ...base, busy: true, groupName: "Launch" })).toBe("Écrivez un message…");
  });

  it("invites an answer to a waiting question, and says it stays open", () => {
    expect(composerPlaceholder({ ...base, question: true })).toBe("Answer the question above, or write something else: it stays open");
    setLocale("fr");
    expect(composerPlaceholder({ ...base, question: true, busy: true })).toBe("Répondez à la question ci-dessus, ou écrivez autre chose : elle restera ouverte");
    // an approval still wins: it takes the composer over
    expect(composerPlaceholder({ ...base, question: true, approval: true })).toBe(t("composer.placeholder.approval"));
  });

  it("keeps the other states", () => {
    expect(composerPlaceholder({ ...base, groupName: "Launch", groupHint: () => "@ a member" })).toBe(t("composer.placeholder.group", { name: "Launch", hint: "@ a member" }));
    expect(composerPlaceholder({ ...base, groupName: "Launch", goalMode: true })).toBe(t("composer.placeholder.goal", { name: "Launch" }));
    expect(composerPlaceholder({ ...base, approval: true, busy: true })).toBe(t("composer.placeholder.approval"));
    expect(composerPlaceholder({ ...base, attachmentPending: true, busy: true })).toBe(t("composer.placeholder.attaching"));
    expect(composerPlaceholder({ ...base, recording: true, busy: true })).toBe(t("composer.placeholder.listening"));
  });
});
