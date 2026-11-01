import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capabilityPrompt, capabilityPromptGroups } from "./capability-prompt.ts";
import { skillDiscoveryPage, type DiscoveredSkill } from "./skill-discovery.ts";
import {
  installLibrarySkill,
  listLibrarySkills,
  readLibrarySkillFile,
  readSkillLibraryIndex,
  skillsLibraryRoot,
} from "./skill-library.ts";
import {
  botsUsingSharedSkill,
  listSharedMeSkills,
  sharePrivateSkillToMe,
  sharePrivateSkillToOrganization,
  unshareSkillForBot,
  updateSharedSkill,
  type ShareBotRef,
} from "./skill-share.ts";
import { installSkill, listSkills, readSkillFile, setSkillEnabled } from "./skills.ts";

const SKILL = (name: string, body = "Do the shared thing.") =>
  `---\nname: ${name}\ndescription: Shared packing checklist.\n---\n\n# ${name}\n\n${body}\n`;

function learn(botId: string, name: string, body?: string) {
  const installed = installSkill(botId, "learned:conversation", [{ path: "SKILL.md", content: SKILL(name, body) }]);
  if ("error" in installed) throw new Error(installed.error);
  const enabled = setSkillEnabled(botId, name, true);
  if ("error" in enabled) throw new Error(enabled.error);
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

let roots: string[] = [];
let aliceBot: ShareBotRef;
let aliceMate: ShareBotRef;
let bobBot: ShareBotRef;
let bots: ShareBotRef[];
let aliceMe: string;
let bobMe: string;
let orgRoot: string;
let aliceRefs: string[];

beforeEach(() => {
  const scratch = mkdtempSync(join(tmpdir(), "sagax-skill-share-"));
  roots.push(scratch);
  aliceMe = join(scratch, "principals", "pr_alice", "capability-skills");
  bobMe = join(scratch, "principals", "pr_bob", "capability-skills");
  orgRoot = join(scratch, "skills-library");
  aliceBot = { id: id("alice-bot"), name: "Alice Packer", ownerUserId: "pr_alice", assignedSkills: [] };
  aliceMate = { id: id("alice-mate"), name: "Alice Clerk", ownerUserId: "pr_alice", assignedSkills: [] };
  bobBot = { id: id("bob-bot"), name: "Bob Shipper", ownerUserId: "pr_bob", assignedSkills: [] };
  bots = [aliceBot, aliceMate, bobBot];
  aliceRefs = [];
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shared skills: person isolation", () => {
  it("keeps Alice's Me share out of Bob's Me library and the organization index", () => {
    learn(aliceBot.id, "packing-list", "ALICE_ONLY");
    const shared = sharePrivateSkillToMe({
      author: aliceBot,
      bots: bots.filter((bot) => bot.ownerUserId === "pr_alice"),
      name: "packing-list",
      meRoot: aliceMe,
      reference: (_before, after) => {
        if (after) aliceRefs = sorted(aliceRefs.concat(after));
      },
    });
    if ("error" in shared) throw new Error(shared.error);
    expect(shared.scope).toBe("me");
    expect(readLibrarySkillFile("packing-list", aliceMe)).toContain("ALICE_ONLY");
    expect(listLibrarySkills(bobMe)).toEqual([]);
    expect(readSkillLibraryIndex(orgRoot)).toEqual({});
    expect(readSkillLibraryIndex(skillsLibraryRoot())["packing-list"]).toBeUndefined();
    expect(listSkills(bobBot.id).map((skill) => skill.name)).not.toContain("packing-list");
    expect(botsUsingSharedSkill({
      name: "packing-list",
      scope: "me",
      bots,
      personId: "pr_bob",
    }).map((bot) => bot.id)).not.toContain(aliceBot.id);
  });
});

describe("shared skills: sharing and unshare", () => {
  it("moves a private skill into Me once and links every bot of that person", () => {
    learn(aliceBot.id, "packing-list", "ONE_COPY");
    const result = sharePrivateSkillToMe({
      author: aliceBot,
      bots: [aliceBot, aliceMate],
      name: "packing-list",
      meRoot: aliceMe,
      reference: (_before, after) => {
        if (after) aliceRefs.push(after);
      },
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.library).toBe("installed");
    expect(result.linked.map((bot) => bot.botId).sort()).toEqual([aliceBot.id, aliceMate.id].sort());
    expect(listSkills(aliceBot.id).map((skill) => skill.name)).not.toContain("packing-list");
    expect(readLibrarySkillFile("packing-list", aliceMe)).toContain("ONE_COPY");
    expect(aliceRefs).toEqual(["packing-list"]);
    expect(existsSync(join(aliceMe, "archive", aliceBot.id, "packing-list", "SKILL.md"))).toBe(true);
    expect(listSharedMeSkills(aliceMe, [aliceBot, aliceMate], "pr_alice")[0]?.assignedBots.map((bot) => bot.id).sort())
      .toEqual([aliceBot.id, aliceMate.id].sort());
  });

  it("skips a teammate that still has its own private skill of the same name", () => {
    learn(aliceBot.id, "packing-list", "AUTHOR");
    learn(aliceMate.id, "packing-list", "MATE_PRIVATE");
    const result = sharePrivateSkillToMe({
      author: aliceBot,
      bots: [aliceBot, aliceMate],
      name: "packing-list",
      meRoot: aliceMe,
      reference: () => {},
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.skipped).toEqual([{
      botId: aliceMate.id,
      name: aliceMate.name,
      reason: 'has its own skill named "packing-list"',
    }]);
    expect(readSkillFile(aliceMate.id, "packing-list")).toContain("MATE_PRIVATE");
  });

  it("shares into the organization library with explicit bot links only", () => {
    learn(aliceBot.id, "order-audit", "ORG_COPY");
    const result = sharePrivateSkillToOrganization({
      author: aliceBot,
      bots,
      name: "order-audit",
      assignBotIds: [aliceBot.id, bobBot.id],
      patchAssigned: (botId, assignedSkills) => {
        const bot = bots.find((entry) => entry.id === botId)!;
        bot.assignedSkills = assignedSkills;
      },
      root: orgRoot,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.scope).toBe("organization");
    expect(readLibrarySkillFile("order-audit", orgRoot)).toContain("ORG_COPY");
    expect(aliceBot.assignedSkills).toEqual(["order-audit"]);
    expect(bobBot.assignedSkills).toEqual(["order-audit"]);
    expect(aliceMate.assignedSkills).toEqual([]);
    expect(listLibrarySkills(aliceMe)).toEqual([]);
  });

  it("unshares for one bot into a private copy while others keep the link", () => {
    learn(aliceBot.id, "packing-list", "SHARED_V1");
    const shared = sharePrivateSkillToMe({
      author: aliceBot,
      bots: [aliceBot, aliceMate],
      name: "packing-list",
      meRoot: aliceMe,
      reference: () => {},
    });
    if ("error" in shared) throw new Error(shared.error);
    const unshared = unshareSkillForBot({
      bot: aliceMate,
      name: "packing-list",
      scope: "me",
      meRoot: aliceMe,
    });
    if ("error" in unshared) throw new Error(unshared.error);
    expect(unshared.skill.origin).toBe("private");
    expect(readSkillFile(aliceMate.id, "packing-list")).toContain("SHARED_V1");
    expect(listSkills(aliceBot.id).map((skill) => skill.name)).not.toContain("packing-list");
    expect(readLibrarySkillFile("packing-list", aliceMe)).toContain("SHARED_V1");
    expect(botsUsingSharedSkill({
      name: "packing-list",
      scope: "me",
      bots: [aliceBot, aliceMate],
      personId: "pr_alice",
    }).map((bot) => bot.id)).toEqual([aliceBot.id]);
  });
});

describe("shared skills: update propagation", () => {
  it("updates the one Me copy so every linked bot reads the new bytes", () => {
    learn(aliceBot.id, "packing-list", "V1");
    const shared = sharePrivateSkillToMe({
      author: aliceBot,
      bots: [aliceBot, aliceMate],
      name: "packing-list",
      meRoot: aliceMe,
      reference: () => {},
    });
    if ("error" in shared) throw new Error(shared.error);
    const updated = updateSharedSkill({
      name: "packing-list",
      text: SKILL("packing-list", "V2_FOR_EVERYONE"),
      scope: "me",
      meRoot: aliceMe,
    });
    if ("error" in updated) throw new Error(updated.error);
    expect(readLibrarySkillFile("packing-list", aliceMe)).toContain("V2_FOR_EVERYONE");
    // An unshared bot keeps the old private snapshot.
    expect(unshareSkillForBot({ bot: aliceMate, name: "packing-list", scope: "me", meRoot: aliceMe })).not.toHaveProperty("error");
    expect(updateSharedSkill({
      name: "packing-list",
      text: SKILL("packing-list", "V3_LINKED_ONLY"),
      scope: "me",
      meRoot: aliceMe,
    })).not.toHaveProperty("error");
    expect(readLibrarySkillFile("packing-list", aliceMe)).toContain("V3_LINKED_ONLY");
    expect(readSkillFile(aliceMate.id, "packing-list")).toContain("V2_FOR_EVERYONE");
  });
});

describe("shared skills: discovery on API and file engines", () => {
  it("exposes the shared Me skill through skills_list paging and both prompt shapes", () => {
    installLibrarySkill({
      name: "packing-list",
      instructions: SKILL("packing-list", "DISCOVER_ME"),
      source: "local-import",
      reviewState: "approved",
      root: aliceMe,
    });
    const path = `capability-skills/me/skills/packing-list/SKILL.md`;
    const filePath = join(aliceMe, "skills", "packing-list", "SKILL.md");
    const rows: DiscoveredSkill[] = [{
      id: "person:skill:packing-list",
      name: "packing-list",
      kind: "skill",
      scope: "person",
      source: "Me",
      enabled: true,
      description: "Shared packing checklist.",
      path,
      filePath,
      capability: { key: "skill:me:packing-list", name: "packing-list" },
    }];
    const page = skillDiscoveryPage(rows);
    expect(page.skills).toHaveLength(1);
    expect(page.skills[0]).toMatchObject({ id: "person:skill:packing-list", scope: "person", path });
    expect(page.skills[0]).not.toHaveProperty("filePath");

    const groups = capabilityPromptGroups("codex", rows, {
      managedTools: true,
      read: () => readFileSync(filePath, "utf8"),
    });
    const filePrompt = capabilityPrompt("codex", groups, { managedTools: true });
    expect(filePrompt.text).toContain(path);
    expect(filePrompt.text).not.toContain("DISCOVER_ME");

    const apiGroups = capabilityPromptGroups("grok", rows, {
      managedTools: true,
      read: () => readFileSync(filePath, "utf8"),
    });
    const apiPrompt = capabilityPrompt("grok", apiGroups, { managedTools: true });
    expect(apiPrompt.text).toContain("DISCOVER_ME");
    expect(apiPrompt.text).toContain(path);
  });

  it("exposes an organization shared skill the same way after assignment", () => {
    installLibrarySkill({
      name: "order-audit",
      instructions: SKILL("order-audit", "DISCOVER_ORG"),
      source: "local-import",
      reviewState: "approved",
      root: orgRoot,
    });
    aliceBot.assignedSkills = ["order-audit"];
    expect(botsUsingSharedSkill({
      name: "order-audit",
      scope: "organization",
      bots,
    }).map((bot) => bot.id)).toEqual([aliceBot.id]);
    const path = "skill-library/order-audit/SKILL.md";
    const rows: DiscoveredSkill[] = [{
      id: "library:skill:order-audit",
      name: "order-audit",
      kind: "skill",
      scope: "library",
      source: "library",
      enabled: true,
      description: "Shared packing checklist.",
      path,
      filePath: join(orgRoot, "skills", "order-audit", "SKILL.md"),
      capability: { key: "skill:installation:order-audit", name: "order-audit" },
    }];
    expect(skillDiscoveryPage(rows).skills[0]).toMatchObject({ scope: "library", path });
    const filePrompt = capabilityPrompt("codex", capabilityPromptGroups("codex", rows, {
      managedTools: true,
      read: () => readLibrarySkillFile("order-audit", orgRoot),
    }), { managedTools: true });
    expect(filePrompt.text).toContain(path);
    const apiPrompt = capabilityPrompt("grok", capabilityPromptGroups("grok", rows, {
      managedTools: true,
      read: () => readLibrarySkillFile("order-audit", orgRoot),
    }), { managedTools: true });
    expect(apiPrompt.text).toContain("DISCOVER_ORG");
  });
});

function sorted(values: string[]) {
  return [...values].sort();
}
