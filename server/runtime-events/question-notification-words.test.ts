import { describe, expect, it } from "vitest";

import { CHOICE_LABEL_MAX } from "../../shared/notification-context.ts";
import { deliverableNotification } from "../notify.ts";
import { pushesForFrame, type FramePushDeps } from "../push/frames.ts";
import { APNS_PAYLOAD_MAX, buildApnsRequest, NEEDS_YOU_CATEGORY, OPEN_CATEGORY, QUESTION_CATEGORY } from "../push/payload.ts";
import { needsYouNotificationWords, questionNotificationWords } from "./question-notification-words.ts";

const deps: FramePushDeps = {
  notificationPeople: () => ["pr_owner"],
  muted: () => false,
  achievementNotifications: () => true,
  achievementName: () => undefined,
  now: () => 42,
};
const BOT = { id: "b-atlas", name: "Atlas", threadId: "t-atlas" };

/** The notify frame all the way to the APNs payload the phone reads. */
function phonePayload(note: ReturnType<typeof deliverableNotification>): Record<string, unknown> {
  const [push] = pushesForFrame({ kind: "notify", notification: note }, deps);
  expect(push).toBeTruthy();
  const request = buildApnsRequest({ message: push!, bundleId: "ca.pulsatrix.sagax", nowMs: 0 });
  expect(Buffer.byteLength(request.body)).toBeLessThanOrEqual(APNS_PAYLOAD_MAX);
  return JSON.parse(request.body) as Record<string, unknown>;
}

describe("question and needs-you notifications carry their context (#2909)", () => {
  it("replays the capture: a routine's needs-you with three long answers shows the context and Open only, never cut buttons", () => {
    // the capture: Atlas's routine stopped on a decision whose answers are sentences
    const card = {
      kind: "question" as const,
      items: [{ text: "Le billet #41872 a 3 entrées de temps sans note.\n\n| Membre | Heures |\n|---|---|\n| Alex | 2,5 |\n| Sam | 1,0 |\n\nJe fais quoi avec ces entrées ?" }],
      choices: [
        "Ajouter une note générique à chaque entrée et les soumettre",
        "Laisser les entrées telles quelles et te les envoyer pour révision",
        "Supprimer les entrées et les recréer à partir de l'agenda",
      ],
    };
    const words = needsYouNotificationWords(card, "Temps CW", "Atlas");
    const note = deliverableNotification("needs-you", BOT, "t-atlas", words.line, {
      routineName: "Temps CW", title: words.title, context: words.context, choices: words.choices, cardId: "m-card",
    })!;
    expect(note.choices).toEqual(card.choices);
    expect(note.choiceLabels).toBeUndefined();
    expect(note.cardId).toBe("m-card");
    // the context is readable: the table as text, the answers whole
    expect(note.context).toContain("Membre : Alex · Heures : 2,5");
    expect(note.context).toContain("Laisser les entrées telles quelles et te les envoyer pour révision");
    expect(note.context).not.toContain("|---|");

    const payload = phonePayload(note);
    const aps = payload.aps as { category: string; alert: { body: string } };
    expect(aps.category).toBe(OPEN_CATEGORY);
    expect(payload.choices).toBeUndefined();
    expect(payload.cardId).toBe("m-card");
    expect(aps.alert.body).toContain("Le billet #41872 a 3 entrées de temps sans note.");
    expect(aps.alert.body).toContain("Membre : Sam · Heures : 1,0");
    expect(aps.alert.body).not.toMatch(/…$/);
  });

  it("legible answers become whole buttons, each labelled within the limit", () => {
    const words = needsYouNotificationWords({ kind: "question", items: [{ text: "Le disque est plein à 95 %. Je fais quoi ?" }], choices: ["Purger : vider la cache des builds du mois", "Attendre"] }, undefined, "Atlas");
    const note = deliverableNotification("needs-you", BOT, "t-atlas", words.line, { title: words.title, context: words.context, choices: words.choices })!;
    expect(note.choiceLabels).toEqual(["Purger", "Attendre"]);
    const payload = phonePayload(note);
    expect((payload.aps as { category: string }).category).toBe(NEEDS_YOU_CATEGORY);
    expect(payload.choiceLabels).toEqual(["Purger", "Attendre"]);
    for (const label of payload.choiceLabels as string[]) expect(label.length).toBeLessThanOrEqual(CHOICE_LABEL_MAX);
  });

  it("a question names the bot that asked, says what each answer does and opens on its card", () => {
    const words = questionNotificationWords({
      permission: false,
      asker: "Nova",
      routed: "Atlas",
      summary: "Deux copies du rapport diffèrent. Je garde la copie locale ou celle du serveur ?",
      questions: [{ question: "Je garde la copie locale ou celle du serveur ?", options: [{ label: "Locale", description: "Garde tes changements d'hier" }, { label: "Serveur" }] }],
      options: ["Locale", "Serveur"],
    });
    expect(words.title).toBe("Nova : Je garde la copie locale ou celle du serveur ?");
    const note = deliverableNotification("question", BOT, "t-atlas", words.line, {
      title: words.title, requestId: "q-1", choices: ["Locale", "Serveur"], choiceLabels: words.choiceLabels, choiceDetails: words.choiceDetails, context: words.context, cardId: "m-q",
    })!;
    expect(note.context).toContain("• Locale : Garde tes changements d'hier");
    expect(note.context).toContain("Deux copies du rapport diffèrent.");
    const payload = phonePayload(note);
    expect((payload.aps as { category: string }).category).toBe(QUESTION_CATEGORY);
    expect(payload.choiceLabels).toEqual(["Locale", "Serveur"]);
    expect(payload.cardId).toBe("m-q");
  });
});
