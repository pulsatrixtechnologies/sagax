// #2623: Permissions and Access are split across sub-pages (V6). A search
// lands on the sub-page that holds the matched option, not on the section's
// first sub-page.
import { describe, expect, it } from "vitest";
import { personaPagesMatching, personaSubPageForQuery, settingsSwitchForQuery } from "./persona-search";
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
  it("opens Rules for the custom rules, and no sub-page for MCP (the Access card is in place on General, #3398)", () => {
    expect(personaSubPageForQuery("permissions", "règles personnalisées")).toBe("rules");
    expect(personaSubPageForQuery("access", "mcp")).toBeNull();
    expect(personaSubPageForQuery("slack", "slack")).toBeNull();
  });
  it("keeps the section's own sub-page otherwise", () => {
    expect(personaSubPageForQuery("permissions", "approbation")).toBe("beforeActing");
    expect(personaSubPageForQuery("model", "moteur")).toBe("model");
    // #4147: Appearance is a sub-page of General > Settings, no tab of its own
    expect(personaSubPageForQuery("appearance", "mascotte")).toBe("appearance");
  });
});

// #3398: "Notify me" and "Collaborators can create routines" sit in place in
// General > Settings; a search that names them opens General at the Settings
// card, in English and in French. A short or generic query, or a word a page
// answers to, stays with the pages.
describe("search names the switches General holds in place (#3398)", () => {
  it("finds Notify me and the collaborators switch, and a word of a page stays that page's", () => {
    for (const query of ["notifications", "alerts", "alertes", "notify me", "m'avertir", "notif"]) {
      expect(settingsSwitchForQuery(query), query).toBe("notifyMe");
      expect(find(query)[0], `${query} matches a page`).toBeDefined();
    }
    for (const query of ["collaborators", "collaborateurs", "collab", "create routines", "créer des routines"]) {
      expect(settingsSwitchForQuery(query), query).toBe("collaboratorsCreateRoutines");
      expect(find(query), `${query} reaches the page of the switch`).toContain("permissions");
    }
    for (const query of ["voix", "speak", "effort", "", "  "]) expect(settingsSwitchForQuery(query), query).toBeNull();
  });
  it("leaves a short, generic or page query to the pages", () => {
    for (const query of ["a", "m", "r", "me", "ion", "rate", "create", "créer", "creer", "routines", "routine", "avertir"]) {
      expect(settingsSwitchForQuery(query), query).toBeNull();
    }
    expect(personaSubPageForQuery(find("routines")[0]!, "routines")).toBe("routines");
    // a word inside a switch phrase ("create" of "create routines") is not a
    // hit for the page that stands for the switch, which lives on General
    for (const query of ["create", "créer", "creer"]) expect(find(query), query).not.toContain("permissions");
  });
  it("keeps a partial switch word that starts the word (alert, notification)", () => {
    for (const query of ["alert", "notification", "notify"]) expect(settingsSwitchForQuery(query), query).toBe("notifyMe");
  });
  it("lets a page label win a partial match, never a whole switch word", () => {
    expect(settingsSwitchForQuery("collab", ["Collaboration"])).toBeNull();
    expect(settingsSwitchForQuery("collab")).toBe("collaboratorsCreateRoutines");
    expect(settingsSwitchForQuery("notifications", ["Notifications"])).toBe("notifyMe");
  });
});
