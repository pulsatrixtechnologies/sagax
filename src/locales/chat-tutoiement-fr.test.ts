import { expect, it } from "vitest";

import fr from "./fr.json";

// Product rule: Sagax speaks to the person with « tu ». The chat and the
// composer never say « vous », « votre » nor « vos » in French (#2895 follow-up).
it("fr: chat.* and composer.* use tu, never vous / votre / vos", () => {
  const bad = Object.entries(fr as Record<string, string>)
    .filter(([key, value]) => /^(chat|composer)\./.test(key) && /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu.test(value))
    .map(([key, value]) => `${key}: ${value}`);
  expect(bad).toEqual([]);
});

// #2936: the Today page (approvals.*) speaks with tu as well: « T'attend »,
// the same words as the bot's task row, never « Vous attend ».
it("fr: approvals.* use tu, never vous / votre / vos", () => {
  const bad = Object.entries(fr as Record<string, string>)
    .filter(([key, value]) => key.startsWith("approvals.") && /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu.test(value))
    .map(([key, value]) => `${key}: ${value}`);
  expect(bad).toEqual([]);
  expect((fr as Record<string, string>)["approvals.kind.attention"]).toBe((fr as Record<string, string>)["botTasks.waiting"]);
});

// #2938: every visible French string speaks with tu. No « vous », « votre »,
// « vos », and no imperative or present in -ez (« Ouvrez », « Cliquez »).
const VOUS = /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu;
const EZ = /(?<![\p{L}])\p{L}+i?ez(?![\p{L}])/giu;
const NOT_A_VERB = new Set(["chez", "assez", "nez", "rez"]);

it("fr: the whole catalog uses tu, never vous / votre / vos", () => {
  const bad = Object.entries(fr as Record<string, string>)
    .filter(([, value]) => VOUS.test(value))
    .map(([key, value]) => `${key}: ${value}`);
  expect(bad).toEqual([]);
});

it("fr: the whole catalog has no verb in -ez (vouvoiement)", () => {
  const bad = Object.entries(fr as Record<string, string>)
    .flatMap(([key, value]) => [...value.matchAll(EZ)].map((match) => match[0]).filter((word) => !NOT_A_VERB.has(word.toLowerCase())).map((word) => `${key}: ${word}`));
  expect(bad).toEqual([]);
});
