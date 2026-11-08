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
    expect(frenchDateRanges("Congé entre 8 to 14 nov. pour toute la semaine")).toBe("Congé entre le 8 et le 14 nov. pour toute la semaine");
  });

  it("takes a French « de » lead without doubling it", () => {
    expect(frenchDateRanges("la semaine de 8 to 14 novembre")).toBe("la semaine du 8 au 14 novembre");
    expect(frenchDateRanges("la période allant de 8 to 14 nov.")).toBe("la période allant du 8 au 14 nov.");
    expect(frenchDateRanges("De 8 to 14 décembre")).toBe("Du 8 au 14 décembre");
  });

  it("keeps weekdays and the first of the month", () => {
    expect(frenchDateRanges("lundi 1er to vendredi 5 décembre")).toBe("du lundi 1er au vendredi 5 décembre");
  });

  it("leaves English and anything without a French month alone", () => {
    for (const text of ["from 8 to 14 November", "Nov 8 to 14", "a number from 1 to 10", "Switch 3 to 4 novembres", "went to 14 novembre"]) {
      expect(frenchDateRanges(text)).toBe(text);
    }
  });

  it("leaves English day-month ranges with a short form English shares alone", () => {
    for (const text of [
      "Leave from 8 to 14 Nov.",
      "Closed 3 to 7 Oct 2026",
      "Out 1 to 5 Dec",
      "from 2 to 9 Sept.",
      "Week of 8 to 14 nov (UTC)",
      "The office is closed from 24 to 31 dec. for the holidays.",
    ]) {
      expect(frenchDateRanges(text)).toBe(text);
      expect(cleanReplyStyle(text)).toBe(text);
    }
  });

  it("rewrites those short forms in a French reply", () => {
    expect(frenchDateRanges("Le bureau est fermé 24 to 31 déc. pour les fêtes.")).toBe("Le bureau est fermé du 24 au 31 déc. pour les fêtes.");
    expect(frenchDateRanges("Le bureau est fermé 24 to 31 dec. pour les fêtes.")).toBe("Le bureau est fermé du 24 au 31 dec. pour les fêtes.");
    expect(frenchDateRanges("Les heures de la semaine 8 to 14 Nov. sont saisies.")).toBe("Les heures de la semaine du 8 au 14 Nov. sont saisies.");
  });

  it("runs on every reply through cleanReplyStyle, never inside code", () => {
    expect(cleanReplyStyle("Semaine 8 to 14 novembre.")).toBe("Semaine du 8 au 14 novembre.");
    expect(cleanReplyStyle("`8 to 14 novembre`")).toBe("`8 to 14 novembre`");
  });
});
