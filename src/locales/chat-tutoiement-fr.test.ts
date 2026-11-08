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
