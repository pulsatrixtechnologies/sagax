// #3424: About me per person on an organization server. A member's bots read
// the member's own About me, never the operator's; what a member's bot
// learns lands in the member's profile and the member's learned list; one
// person's About me never reaches another person's bot.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { PersonSettingsStore } from "../people/person-settings.ts";
import { createPersonAboutMe } from "./person-about-me.ts";
import { listLearnedFacts } from "./profile-learned.ts";

const OPERATOR = "operator-local";
const MEMBER = "member-a";
const OTHER = "member-b";
const TODAY = "2026-11-10";

const people = new PersonSettingsStore(DATA_DIR);
afterEach(() => {
  for (const id of [MEMBER, OTHER]) rmSync(join(DATA_DIR, "principals", id), { recursive: true, force: true });
});

function server(organization = true) {
  let operatorText = "Operator: runs the night shift";
  const aboutMe = createPersonAboutMe({
    organization: () => organization,
    localPrincipalId: () => OPERATOR,
    operator: { read: () => operatorText, save: (text) => { operatorText = text; } },
    people: { read: (id) => people.get(id).aboutMe ?? "", save: (id, text) => { people.setAboutMe(id, text); } },
  });
  return { aboutMe, operatorText: () => operatorText };
}

describe("About me per person (#3424)", () => {
  it("a member's bot reads the member's About me and never the operator's", () => {
    const { aboutMe } = server();
    aboutMe.save({ person: MEMBER }, "Member: handles the billing desk");
    expect(aboutMe.read(aboutMe.ofBot(MEMBER)!)).toBe("Member: handles the billing desk");
    expect(aboutMe.read(aboutMe.ofBot(OPERATOR)!)).toBe("Operator: runs the night shift");
    // a member who wrote nothing gets nothing, not the operator's
    expect(aboutMe.read(aboutMe.ofBot(OTHER)!)).toBe("");
  });

  it("a fact learned by a member's bot lands in the member's profile and list, not the operator's", () => {
    const { aboutMe, operatorText } = server();
    const added = aboutMe.learn(aboutMe.ofBot(MEMBER)!, { botId: "bot-m", botName: "Scout" }, ["Works on the billing desk"], TODAY);
    expect(added).toBe(1);
    expect(people.get(MEMBER).aboutMe).toContain("Works on the billing desk");
    expect(operatorText()).toBe("Operator: runs the night shift");
    expect(aboutMe.learned({ person: MEMBER }).map((fact) => fact.text)).toEqual(["Works on the billing desk"]);
    expect(aboutMe.learned({ person: null }).some((fact) => fact.text === "Works on the billing desk")).toBe(false);
    expect(listLearnedFacts().some((fact) => fact.text === "Works on the billing desk")).toBe(false);
    // and another member sees none of it
    expect(aboutMe.read({ person: OTHER })).toBe("");
    expect(aboutMe.learned({ person: OTHER })).toEqual([]);
  });

  it("removing a member's learned fact takes its line out of the member's About me and keeps it out", () => {
    const { aboutMe } = server();
    const owner = { person: MEMBER };
    aboutMe.save(owner, "Handwritten");
    aboutMe.learn(owner, { botId: "bot-m", botName: "Scout" }, ["Prefers short replies"], TODAY);
    const [fact] = aboutMe.learned(owner);
    const removed = aboutMe.removeLearned(owner, fact!.id);
    expect(removed?.aboutMe).toBe("Handwritten");
    expect(aboutMe.read(owner)).toBe("Handwritten");
    expect(aboutMe.learn(owner, { botId: "bot-m", botName: "Scout" }, ["Prefers short replies"], TODAY)).toBe(0);
    // another person's id never removes it
    aboutMe.learn(owner, { botId: "bot-m", botName: "Scout" }, ["Starts at seven"], TODAY);
    const [kept] = aboutMe.learned(owner);
    expect(aboutMe.removeLearned({ person: OTHER }, kept!.id)).toBeNull();
    expect(aboutMe.learned(owner)).toHaveLength(1);
  });

  it("a viewer is the operator, a person with their own About me, or nobody", () => {
    const { aboutMe } = server();
    expect(aboutMe.ofViewer({ operator: true, principalId: null })).toEqual({ person: null });
    expect(aboutMe.ofViewer({ operator: false, principalId: "Member-A" })).toEqual({ person: MEMBER });
    expect(aboutMe.ofViewer({ operator: false, principalId: null })).toBeNull();
    expect(aboutMe.ofViewer({ operator: false, principalId: "../x" })).toBeNull();
    // a personal server: one person, the server's profile
    const solo = server(false).aboutMe;
    expect(solo.ofBot(OPERATOR)).toEqual({ person: null });
    expect(solo.ofBot(MEMBER)).toBeNull();
    expect(solo.ofViewer({ operator: false, principalId: MEMBER })).toBeNull();
  });

  it("keeps the member's file under their own folder only", () => {
    const { aboutMe } = server();
    aboutMe.learn({ person: MEMBER }, { botId: "bot-m", botName: "Scout" }, ["Uses the late queue"], TODAY);
    expect(existsSync(join(DATA_DIR, "principals", MEMBER, "profile-learned.json"))).toBe(true);
    expect(existsSync(join(DATA_DIR, "principals", OTHER, "profile-learned.json"))).toBe(false);
  });
});
