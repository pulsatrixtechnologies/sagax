// #2623: Permissions and Access are split across sub-pages (V6). A search
// lands on the sub-page that holds the matched option, not on the section's
// first sub-page.
import { describe, expect, it } from "vitest";
import { personaPagesMatching, personaSubPageForQuery } from "./persona-search";
import { PERSONA_CATEGORIES, type PersonaCategory } from "./persona-sections";

const label = (page: PersonaCategory) => page;
const find = (query: string) => personaPagesMatching(PERSONA_CATEGORIES, query, label);

describe("search lands on the option's sub-page (#2623)", () => {
  it("opens When it acts alone for its options", () => {
    for (const query of ["proactif", "proactive", "brouillons", "email drafts", "mèmes", "meme", "cible de publication", "background brief", "destinataires"]) {
      const first = find(query)[0]!;
      expect(["permissions", "access"]).toContain(first);
      expect(personaSubPageForQuery(first, query)).toBe("actsAlone");
    }
  });
  it("opens Advanced settings for the technical options", () => {
    for (const query of ["garde-fou de boucle", "loop guard", "coordination", "bot principal", "parallèle"]) {
      const first = find(query)[0]!;
      expect(personaSubPageForQuery(first, query)).toBe("advanced");
    }
    expect(personaSubPageForQuery("permissions", "hooks")).toBe("advanced");
    expect(personaSubPageForQuery("access", "navigateur")).toBe("advanced");
  });
  it("opens Rules for the custom rules and Bot accounts for MCP", () => {
    expect(personaSubPageForQuery("permissions", "règles personnalisées")).toBe("rules");
    expect(personaSubPageForQuery("access", "mcp")).toBe("accounts");
  });
  it("keeps the section's own sub-page otherwise", () => {
    expect(personaSubPageForQuery("permissions", "approbation")).toBe("beforeActing");
    expect(personaSubPageForQuery("model", "moteur")).toBe("model");
    expect(personaSubPageForQuery("appearance", "mascotte")).toBeNull();
  });
});
