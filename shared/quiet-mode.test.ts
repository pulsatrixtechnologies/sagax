import { describe, expect, it } from "vitest";

import { quietModeCounts, quietModeLanguage } from "./quiet-mode.ts";

describe("the line quiet mode wrote when it went off (#3480), read on stored rows after #3581", () => {
  it("says what was kept quiet, in the person's language", () => {
    expect(quietModeCounts({ runs: 4, problems: 1 }, "fr")).toBe("Mode silencieux terminé : 4 exécutions gardées en silence, dont 1 avec des problèmes");
    expect(quietModeCounts({ runs: 1, problems: 0 }, "en")).toBe("Quiet mode is off: 1 run kept quiet, none with problems");
    expect(quietModeCounts({ runs: 0, problems: 0 }, "fr")).toBe("Mode silencieux terminé : aucune exécution n'a été gardée en silence");
    expect(quietModeLanguage("fr-CA")).toBe("fr");
    expect(quietModeLanguage(undefined)).toBe("en");
    for (const line of [quietModeCounts({ runs: 3, problems: 2 }, "fr"), quietModeCounts({ runs: 3, problems: 2 }, "en")]) {
      expect(line).not.toMatch(/[–—\n]/);
      expect(line).not.toMatch(/\bvous\b/i);
    }
  });
});
