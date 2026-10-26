// sagax_help answers from the generated base (scripts/self-knowledge/):
// the 20 questions of the bench (server/self-knowledge/bench-questions.json)
// find their section in the first results, an answer stays short, and the
// server and speaker are said.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledKnowledgeIndex, excerpt, HELP_CALLS_PER_TURN, HelpCallCounter, helpAnswer, queryTerms, searchKnowledge } from "./self-knowledge.ts";

const index = (await bundledKnowledgeIndex())!;
const bench = JSON.parse(readFileSync(join(import.meta.dirname, "self-knowledge", "bench-questions.json"), "utf8")) as Array<{ q: string; expect: string[] }>;

describe("sagax_help", () => {
  it("reads the bundled base", () => {
    expect(index).not.toBeNull();
    expect(index.base.sections.length).toBeGreaterThan(500);
  });

  it.each(bench)("finds the answer to « $q » in its first four sections", ({ q, expect: wanted }) => {
    const ids = searchKnowledge(index, q, 4).map((match) => match.section.id);
    expect(wanted.some((id) => ids.includes(id)), `${q}: ${ids.join(", ")}`).toBe(true);
  });

  it("finds generated sections for questions no guide was written for", () => {
    const top = (question: string) => searchKnowledge(index, question, 3).map((match) => match.section.id);
    expect(top("Peux-tu changer le thème de l'app en sombre ?")).toContain("setting:appearance");
    expect(top("Peux-tu réagir avec un emoji à mon message ?")).toContain("tool:react_to_message");
    expect(top("Peux-tu chercher dans nos anciennes conversations ?")).toContain("tool:session_search");
    expect(top("Où je mets mon mot de passe pour que tu remplisses un formulaire ?")).toContain("setting:credentials");
  });

  it("maps French words to the base's English", () => {
    expect(queryTerms("Peux-tu lire un .zip ?")).toEqual(expect.arrayContaining(["zip", "read"]));
    expect(queryTerms("mode voix équipe")).toEqual(expect.arrayContaining(["voice", "team"]));
  });

  it("answers in a few short sections and says where it runs", () => {
    const member = helpAnswer(index, "Comment donner le mode voix à une équipe ?", { organization: true, role: "member", perspicaxTools: true });
    expect(member.text).toContain("organization server (Perspicax), the person speaking is a member");
    expect(member.text).toContain(`Sagax ${index.base.version} knowledge, ${index.base.generated}`);
    expect(member.text).toContain("Bot rights");
    expect(member.text).toContain("api_list");
    expect(member.text.length).toBeLessThan(4000);
    expect(member.ids.length).toBeLessThanOrEqual(4);
    const solo = helpAnswer(index, "Où sont mes routines ?", { organization: false });
    expect(solo.text).toContain("a person's own Sagax (solo, no organization)");
    expect(solo.text).not.toContain("api_list");
    for (const question of bench.map((entry) => entry.q)) {
      expect(helpAnswer(index, question, { organization: true, role: "admin" }).text.length, question).toBeLessThan(4000);
    }
  });

  it("puts the Perspicax console last on a solo Sagax", () => {
    const question = "Où voir les droits sur les bots ?";
    const org = searchKnowledge(index, question, 6, { organization: true }).map((match) => match.section.kind);
    const solo = searchKnowledge(index, question, 6, { organization: false }).map((match) => match.section.kind);
    expect(org).toContain("perspicax");
    expect(solo.indexOf("perspicax") === -1 || solo.indexOf("perspicax") > org.indexOf("perspicax")).toBe(true);
    expect(helpAnswer(index, question, { organization: false }).text).not.toContain("Perspicax console 1.");
  });

  it("caps the calls of one turn", () => {
    const counter = new HelpCallCounter();
    for (let i = 0; i < HELP_CALLS_PER_TURN; i++) expect(counter.take("t:g")).toBe(true);
    expect(counter.take("t:g")).toBe(false);
    expect(counter.take("t:g2")).toBe(true);
  });

  it("never claims a capability when nothing matches", () => {
    const none = helpAnswer(index, "zzqx wvvy", { organization: false });
    expect(none.ids).toEqual([]);
    expect(none.text).toContain("Do not claim the capability exists or does not");
  });

  it("keeps an excerpt within its size and leads a tool with its first sentence", () => {
    const tool = index.base.sections.find((section) => section.id === "tool:act")!;
    const text = excerpt(tool, "installer un plugin");
    expect(text.length).toBeLessThanOrEqual(520);
    expect(text.startsWith("Act as the signed-in person.")).toBe(true);
    expect(text).toContain("Plugins");
  });
});
