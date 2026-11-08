import { describe, expect, it } from "vitest";

import { frenchDateRanges } from "./french-dates.ts";
import { cleanReplyStyle } from "./reply-style.ts";

describe("frenchDateRanges (QA 0.8.67 G9)", () => {
  it("words the QA reply's range the French way", () => {
    expect(frenchDateRanges("Temps de la semaine, 8 to 14 novembre : 28,32 h.")).toBe("Temps de la semaine, du 8 au 14 novembre : 28,32 h.");
  });

  it("replaces an English or a French lead", () => {
    expect(frenchDateRanges("from 8 to 14 novembre")).toBe("du 8 au 14 novembre");
    expect(frenchDateRanges("Du 8 to 14 novembre")).toBe("Du 8 au 14 novembre");
    expect(frenchDateRanges("Le 30 octobre to 5 novembre 2026")).toBe("Du 30 octobre au 5 novembre 2026");
    expect(frenchDateRanges("entre 8 to 14 nov.")).toBe("entre le 8 et le 14 nov.");
  });

  it("keeps weekdays and the first of the month", () => {
    expect(frenchDateRanges("lundi 1er to vendredi 5 décembre")).toBe("du lundi 1er au vendredi 5 décembre");
  });

  it("leaves English and anything without a French month alone", () => {
    for (const text of ["from 8 to 14 November", "Nov 8 to 14", "a number from 1 to 10", "Switch 3 to 4 novembres", "went to 14 novembre"]) {
      expect(frenchDateRanges(text)).toBe(text);
    }
  });

  it("runs on every reply through cleanReplyStyle, never inside code", () => {
    expect(cleanReplyStyle("Semaine 8 to 14 novembre.")).toBe("Semaine du 8 au 14 novembre.");
    expect(cleanReplyStyle("`8 to 14 novembre`")).toBe("`8 to 14 novembre`");
  });
});
