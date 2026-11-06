// #2045: bot/group membership by stable section id.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelSelection } from "../contracts.ts";
import {
  isSectionId,
  migrateSectionLinks,
  sameTeamLink,
} from "./section-link.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1);
const BOB = pid(2);
const SEC_A = "sec_00000000-0000-4000-8000-0000000000a1";
const SEC_B = "sec_00000000-0000-4000-8000-0000000000b2";
const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("section-link helpers (#2045)", () => {
  it("recognizes stable section ids", () => {
    expect(isSectionId(SEC_A)).toBe(true);
    expect(isSectionId("Ops")).toBe(false);
  });

  it("matches by id first, then by legacy name", () => {
    expect(sameTeamLink({ section: "Ops", sectionId: SEC_A }, { name: "Ops", id: SEC_A })).toBe(true);
    expect(sameTeamLink({ section: "Ops", sectionId: SEC_A }, { name: "Ops", id: SEC_B })).toBe(false);
    expect(sameTeamLink({ section: "Ops" }, { name: "Ops", id: SEC_A })).toBe(true);
    expect(sameTeamLink({ section: "Ops" }, { name: "Launch" })).toBe(false);
  });

  it("migrates name-only rows onto the owner's section id", () => {
    const { next, moved } = migrateSectionLinks(
      [
        { id: "a", section: "Ops", owner: ALICE },
        { id: "b", section: "Ops", owner: BOB },
        { id: "c", section: "Ops", sectionId: SEC_A, owner: ALICE },
      ],
      (row) => row.owner,
      (name, owner) => (name === "Ops" && owner === ALICE ? SEC_A : name === "Ops" && owner === BOB ? SEC_B : null),
    );
    expect(moved).toBe(2);
    expect(next[0]).toMatchObject({ id: "a", section: "Ops", sectionId: SEC_A });
    expect(next[1]).toMatchObject({ id: "b", section: "Ops", sectionId: SEC_B });
    expect(next[2]).toMatchObject({ id: "c", sectionId: SEC_A });
  });
});

describe("Store membership by section id (#2045)", () => {
  const previous = process.env.SAGAX_DATA_DIR;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "section-id-"));
    process.env.SAGAX_DATA_DIR = dir;
    vi.resetModules();
  });

  afterEach(() => {
    const dir = process.env.SAGAX_DATA_DIR;
    if (previous === undefined) delete process.env.SAGAX_DATA_DIR;
    else process.env.SAGAX_DATA_DIR = previous;
    vi.resetModules();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("two people with the same team name keep their bots after a rename", async () => {
    const { Store: FreshStore } = await import("../store.ts");
    const { SectionChannels: FreshChannels } = await import("./section-channels.ts");
    const store = new FreshStore(selection);
    let n = 0;
    const channels = new FreshChannels({
      path: join(process.env.SAGAX_DATA_DIR!, "section-channels.json"),
      newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
    const aliceSec = channels.ensure("Ops", ALICE);
    const bobSec = channels.ensure("Ops", BOB);
    expect(aliceSec.id).not.toBe(bobSec.id);

    const aliceBot = store.createBot({ name: "Ada", section: "Ops", sectionId: aliceSec.id, ownerUserId: ALICE });
    const bobBot = store.createBot({ name: "Bea", section: "Ops", sectionId: bobSec.id, ownerUserId: BOB });
    expect(aliceBot.sectionId).toBe(aliceSec.id);
    expect(bobBot.sectionId).toBe(bobSec.id);

    expect(store.renameSectionForOwner("Ops", "Launch", ALICE, undefined, aliceSec.id)).toBeUndefined();
    expect(store.bot(aliceBot.id)).toMatchObject({ section: "Launch", sectionId: aliceSec.id });
    expect(store.bot(bobBot.id)).toMatchObject({ section: "Ops", sectionId: bobSec.id });

    expect(store.deleteSectionForOwner("Ops", BOB, bobSec.id)).toBeUndefined();
    expect(store.bot(bobBot.id)?.section).toBeUndefined();
    expect(store.bot(bobBot.id)?.sectionId).toBeUndefined();
    expect(store.bot(aliceBot.id)).toMatchObject({ section: "Launch", sectionId: aliceSec.id });
  });

  it("migrates legacy name links onto section ids", async () => {
    const { Store: FreshStore } = await import("../store.ts");
    const { SectionChannels: FreshChannels } = await import("./section-channels.ts");
    const store = new FreshStore(selection);
    store.createBot({ name: "Ada", section: "Ops", ownerUserId: ALICE });
    store.createBot({ name: "Bea", section: "Ops", ownerUserId: BOB });
    let n = 0;
    const channels = new FreshChannels({
      path: join(process.env.SAGAX_DATA_DIR!, "section-channels.json"),
      newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
    channels.ensure("Ops", ALICE);
    channels.ensure("Ops", BOB);
    const moved = store.migrateTeamSectionIds((name, owner) => channels.byNameForOwner(name, owner)?.id ?? null);
    expect(moved).toBe(2);
    const alice = store.bots.find((bot) => bot.ownerUserId === ALICE)!;
    const bob = store.bots.find((bot) => bot.ownerUserId === BOB)!;
    expect(alice.section).toBe("Ops");
    expect(bob.section).toBe("Ops");
    expect(alice.sectionId).toBe(channels.byNameForOwner("Ops", ALICE)!.id);
    expect(bob.sectionId).toBe(channels.byNameForOwner("Ops", BOB)!.id);
    expect(alice.sectionId).not.toBe(bob.sectionId);
  });

  it("creates the owner's section when a legacy name is unknown", async () => {
    const { Store: FreshStore } = await import("../store.ts");
    const { SectionChannels: FreshChannels, validSectionName, isGeneralName } = await import("./section-channels.ts");
    const store = new FreshStore(selection);
    store.createBot({ name: "Ada", section: "Field", ownerUserId: ALICE });
    store.createBot({ name: "Bea", section: "Field", ownerUserId: BOB });
    let n = 0;
    const channels = new FreshChannels({
      path: join(process.env.SAGAX_DATA_DIR!, "section-channels.json"),
      newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
    expect(channels.byNameForOwner("Field", ALICE)).toBeNull();
    expect(channels.byNameForOwner("Field", BOB)).toBeNull();
    const moved = store.migrateTeamSectionIds((name, owner) => {
      if (!validSectionName(name) || isGeneralName(name) || !owner.trim()) return null;
      return channels.ensure(name, owner).id;
    });
    expect(moved).toBe(2);
    const aliceSec = channels.byNameForOwner("Field", ALICE)!;
    const bobSec = channels.byNameForOwner("Field", BOB)!;
    expect(aliceSec.id).not.toBe(bobSec.id);
    const alice = store.bots.find((bot) => bot.ownerUserId === ALICE)!;
    const bob = store.bots.find((bot) => bot.ownerUserId === BOB)!;
    expect(alice).toMatchObject({ section: "Field", sectionId: aliceSec.id });
    expect(bob).toMatchObject({ section: "Field", sectionId: bobSec.id });
    // Rename after create-on-unknown keeps each person's membership.
    expect(store.renameSectionForOwner("Field", "Desk", ALICE, undefined, aliceSec.id)).toBeUndefined();
    expect(store.bot(alice.id)).toMatchObject({ section: "Desk", sectionId: aliceSec.id });
    expect(store.bot(bob.id)).toMatchObject({ section: "Field", sectionId: bobSec.id });
  });

  it("setBotsSection stamps sectionId and clear removes it", async () => {
    const { Store: FreshStore } = await import("../store.ts");
    const store = new FreshStore(selection);
    const bot = store.createBot({ name: "Ada", ownerUserId: ALICE });
    expect(store.setBotsSection([bot.id], "Studio", SEC_A).ok).toBe(true);
    expect(store.bot(bot.id)).toMatchObject({ section: "Studio", sectionId: SEC_A });
    expect(store.setBotsSection([bot.id], "").ok).toBe(true);
    expect(store.bot(bot.id)?.section).toBeUndefined();
    expect(store.bot(bot.id)?.sectionId).toBeUndefined();
  });

  it("renames keep each person's team computer on their section id", async () => {
    const { Store: FreshStore } = await import("../store.ts");
    const { SectionChannels: FreshChannels } = await import("./section-channels.ts");
    const { TeamComputers } = await import("../computer/team-computers.ts");
    const store = new FreshStore(selection);
    let n = 0;
    const channels = new FreshChannels({
      path: join(process.env.SAGAX_DATA_DIR!, "section-channels.json"),
      newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
    const aliceSec = channels.ensure("Ops", ALICE);
    const bobSec = channels.ensure("Ops", BOB);
    store.createBot({ name: "Ada", section: "Ops", sectionId: aliceSec.id, ownerUserId: ALICE });
    store.createBot({ name: "Bea", section: "Ops", sectionId: bobSec.id, ownerUserId: BOB });
    const computers = new TeamComputers(join(process.env.SAGAX_DATA_DIR!, "team-computers.json"), "5c57ceec-f5aa-4d79-a9c7-0e1f93875e70");
    const alicePc = computers.create("Alice desktop");
    const bobPc = computers.create("Bob desktop");
    computers.assign(alicePc.id, "Ops", aliceSec.id);
    computers.assign(bobPc.id, "Ops", bobSec.id);
    expect(store.renameSectionForOwner("Ops", "Launch", ALICE, computers, aliceSec.id)).toBeUndefined();
    expect(computers.forSection("Launch", aliceSec.id)).toMatchObject({ id: alicePc.id, section: "Launch", sectionId: aliceSec.id });
    expect(computers.forSection("Ops", bobSec.id)).toMatchObject({ id: bobPc.id, section: "Ops", sectionId: bobSec.id });
    // Lookup by Alice's id still finds her computer after the rename.
    expect(computers.forSection("Ops", aliceSec.id)).toMatchObject({ id: alicePc.id, section: "Launch" });
  });
});

describe("managesTeam with owner resolve (#2045)", () => {
  it("name grants only reach the owner's resolved section id", async () => {
    const { managesTeam } = await import("./section-link.ts");
    const resolve = (name: string) => (name === "Ops" ? SEC_A : null);
    expect(managesTeam(["Ops"], { name: "Ops", id: SEC_A }, resolve)).toBe(true);
    expect(managesTeam(["Ops"], { name: "Ops", id: SEC_B }, resolve)).toBe(false);
    expect(managesTeam([SEC_A], { name: "Ops", id: SEC_A })).toBe(true);
  });
});
