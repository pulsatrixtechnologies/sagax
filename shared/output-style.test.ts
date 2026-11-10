import { describe, expect, it } from "vitest";
import { findKeySentenceTables, isFieldValueHeader, isSentenceCell, OUTPUT_STYLE_RULE, OUTPUT_STYLE_RULE_SHORT, rewriteKeySentenceTables, TABLE_RULE } from "./output-style.ts";

// #2949: the reply flagged (2026-11-08), a "Piece | State" table of sentences.
const FLAGGED = [
  "Here is where each piece stands.",
  "",
  "| Piece | State |",
  "|---|---|",
  "| Rules | Live. Messages to you stay clear and short. |",
  "| Verification | Live. A draft to you is checked before it goes out. |",
  "| Standing voice | Still the earlier card, waiting for your pick. |",
  "| Fleet memory | Still the earlier card, waiting for your pick. |",
  "",
  "Nothing else changed.",
].join("\n");

describe("output style rule", () => {
  it("defaults to prose or short lists and keeps tables for real tabular data", () => {
    expect(OUTPUT_STYLE_RULE).toContain("short prose, or a short bulleted list with the label in bold");
    expect(OUTPUT_STYLE_RULE).toContain("3+ columns of comparable values");
    expect(OUTPUT_STYLE_RULE).toContain("across 6 or more rows of one kind");
    // #3293: the full and the short rule state the same threshold
    expect(OUTPUT_STYLE_RULE).toContain(TABLE_RULE);
    expect(OUTPUT_STYLE_RULE_SHORT).toContain(TABLE_RULE);
    expect(OUTPUT_STYLE_RULE).toContain("or on request");
    expect(OUTPUT_STYLE_RULE).toContain("Never a two-column label and sentence table, never a table for a status or a summary");
    expect(OUTPUT_STYLE_RULE).toContain("compact Sagax card fits");
    expect(OUTPUT_STYLE_RULE).toContain("Never a field and value table (\"Field | Value\", \"Champ | Valeur\")");
    expect(OUTPUT_STYLE_RULE).toContain("in French as in English, whatever the engine");
    expect(OUTPUT_STYLE_RULE_SHORT).toContain("never a label and sentence, field and value (\"Champ | Valeur\") or status table");
    expect(`${OUTPUT_STYLE_RULE}${OUTPUT_STYLE_RULE_SHORT}`).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("key/sentence table check", () => {
  it("fails the flagged table and rewrites it as a bulleted list with bold labels", () => {
    expect(findKeySentenceTables(FLAGGED)).toHaveLength(1);
    expect(rewriteKeySentenceTables(FLAGGED)).toBe([
      "Here is where each piece stands.",
      "",
      "- **Rules**: Live. Messages to you stay clear and short.",
      "- **Verification**: Live. A draft to you is checked before it goes out.",
      "- **Standing voice**: Still the earlier card, waiting for your pick.",
      "- **Fleet memory**: Still the earlier card, waiting for your pick.",
      "",
      "Nothing else changed.",
    ].join("\n"));
  });

  it("keeps real tabular data: three columns, or two columns of values", () => {
    const hours = "| Billet | Date | Heures |\n|---|---|---|\n| #297048 | 2026-11-02 | 1,5 |\n| #298455 | 2026-11-03 | 0,75 |";
    const values = "| Billet | Heures |\n|---|---|\n| #297048 | 1,5 |\n| #298455 | 0,75 |";
    const labels = "| Machine | Statut |\n|:--|--:|\n| FS-01 | En ligne |\n| NAS | Hors ligne |";
    for (const table of [hours, values, labels]) {
      expect(findKeySentenceTables(table)).toEqual([]);
      expect(rewriteKeySentenceTables(table)).toBe(table);
    }
  });

  it("rewrites a Champ | Valeur table of three values as a short list (#3020)", () => {
    // QA pass 3 (2026-11-09): count and newest open tickets of board 1
    const reply = [
      "Voici le portrait du tableau 1.",
      "",
      "| Champ | Valeur |",
      "|---|---|",
      "| Ouverts | 164 |",
      "| Plus récents | #299803, #299794, #299783 |",
      "| Confiance | Élevée |",
    ].join("\n");
    expect(findKeySentenceTables(reply)).toHaveLength(1);
    expect(rewriteKeySentenceTables(reply)).toBe([
      "Voici le portrait du tableau 1.",
      "",
      "- **Ouverts**: 164",
      "- **Plus récents**: #299803, #299794, #299783",
      "- **Confiance**: Élevée",
    ].join("\n"));
    for (const header of ["| Field | Value |", "| **Clé** | **Valeur** |", "| Métrique | Résultat |", "| Élément | Détail |"]) {
      expect(findKeySentenceTables(`${header}\n|---|---|\n| Ouverts | 164 |`)).toHaveLength(1);
    }
    expect(isFieldValueHeader(["Billet", "Heures"])).toBe(false);
    expect(isFieldValueHeader(["Machine", "Statut"])).toBe(false);
  });

  it("leaves a table inside a code fence alone", () => {
    const fenced = "```md\n| Piece | State |\n|---|---|\n| Rules | Live. Messages to you stay clear and short. |\n```";
    expect(rewriteKeySentenceTables(fenced)).toBe(fenced);
  });

  it("reads tables without outer pipes and keeps escaped pipes", () => {
    const bare = "Clé | Valeur\n--- | ---\n**Règle** | Les messages restent courts et clairs pour toi.\nFiltre | Garde a \\| b dans la phrase qui suit ici.";
    expect(rewriteKeySentenceTables(bare)).toBe("- **Règle**: Les messages restent courts et clairs pour toi.\n- **Filtre**: Garde a | b dans la phrase qui suit ici.");
  });

  it("tells a sentence from a value", () => {
    expect(isSentenceCell("Live. Messages to you stay clear.")).toBe(true);
    expect(isSentenceCell("En attente de ta réponse.")).toBe(true);
    expect(isSentenceCell("En ligne")).toBe(false);
    expect(isSentenceCell("1,5")).toBe(false);
    expect(isSentenceCell("2026-11-02")).toBe(false);
  });
});
