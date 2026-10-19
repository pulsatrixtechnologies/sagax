// Automatic skill learning (server/skill-review.ts): step counting, the
// bounded transcript, the prompt's read-before-write rule, answer parsing,
// and the scheduler against a scripted engine — persisted counters, the
// threshold, deferral while the bot is busy, stale updates, failures and
// cancellation.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSkillReview,
  frontmatterName,
  MAX_REVIEW_CHANGES,
  parseSkillReview,
  reviewTranscript,
  shownSkills,
  SKILL_REVIEW_MARKER,
  skillReviewPrompt,
  TRANSCRIPT_MAX_CHARS,
  turnToolSteps,
  type ReviewChange,
  type ReviewMessage,
  type ReviewSkill,
  type SkillReviewDeps,
} from "./skill-review.ts";

const BOT = { id: "bot-1", name: "Scout" };
const skillMd = (name: string, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: Does ${name}.\n---\n\n# ${name}\n\n## Procedure\n1. ${body}\n`;

const tool = (turnId: string, name: string, extra: Partial<NonNullable<ReviewMessage["tool"]>> = {}, from?: ReviewMessage["from"]): ReviewMessage =>
  ({ role: "bot", kind: "activity", turnId, tool: { name, ok: true, ...extra }, ...(from ? { from } : {}) });
const say = (role: "user" | "bot", text: string, turnId?: string, from?: ReviewMessage["from"]): ReviewMessage =>
  ({ role, kind: "text", text, ...(turnId ? { turnId } : {}), ...(from ? { from } : {}) });

describe("counting tool steps", () => {
  it("counts the turn's tool rows, without setup chips or other turns", () => {
    const messages = [tool("t1", "Read"), tool("t1", "Bash"), tool("t1", "setting up", { setup: true }), tool("t2", "Edit"), say("bot", "done", "t1")];
    expect(turnToolSteps(messages, "t1", BOT.id, false)).toBe(2);
  });

  it("counts only the speaker's rows in a room", () => {
    const me = { botId: BOT.id, name: BOT.name, color: "red" };
    const other = { botId: "bot-2", name: "Pixel", color: "blue" };
    const messages = [tool("t1", "Read", {}, me), tool("t1", "Bash", {}, other), tool("t1", "Edit", {}, me)];
    expect(turnToolSteps(messages, "t1", BOT.id, true)).toBe(2);
  });
});

describe("the review transcript", () => {
  it("keeps recent turns in full and folds older ones into a digest", () => {
    const messages: ReviewMessage[] = [];
    for (let i = 0; i < 60; i += 1) {
      messages.push(say("user", `question ${i} ${"x".repeat(400)}`));
      messages.push(tool(`t${i}`, "Bash", { input: `ls ${i}` }));
      messages.push(say("bot", `answer ${i}`, `t${i}`));
    }
    const text = reviewTranscript(messages, BOT, false);
    expect(text).toContain("[Earlier in the conversation, summarised]");
    expect(text).toContain("Scout[tools: Bash]");
    expect(text).toContain("  [tool] Bash: ls 59");
    expect(text).toContain("answer 59");
    // a digest line is clipped; a recent line is not
    expect(text).toMatch(/Person: question 0 x+…/);
    expect(text.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS);
  });

  it("stays within its size cap however long the turns are", () => {
    const messages = Array.from({ length: 200 }, (_, i) => say(i % 2 ? "bot" : "user", "y".repeat(5_000)));
    expect(reviewTranscript(messages, BOT, false).length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS);
  });

  it("names other room speakers and notes skill receipts", () => {
    const other = { botId: "bot-2", name: "Pixel", color: "blue" };
    const messages: ReviewMessage[] = [
      say("user", "make a chart"),
      say("bot", "I can help", "t1", other),
      { role: "bot", kind: "options", from: { botId: BOT.id, name: BOT.name, color: "red" }, card: {
        title: "x", options: [], answered: "allow", skillRequest: { botId: BOT.id, name: "charting", action: "create" },
      } as unknown as ReviewMessage["card"] },
    ];
    const text = reviewTranscript(messages, BOT, true);
    expect(text).toContain("Pixel: I can help");
    expect(text).toContain('[skill "charting" created]');
  });
});

const skills: ReviewSkill[] = [
  { name: "weekly-report", description: "Writes the weekly report.", editable: true, enabled: true, sha256: "a".repeat(64), body: skillMd("weekly-report") },
  { name: "imported-tool", description: "Vendor skill.", editable: false, enabled: true, sha256: "b".repeat(64) },
  { name: "huge-skill", description: "Too long.", editable: true, enabled: true, sha256: "c".repeat(64), body: "z".repeat(20_000) },
];

describe("the review prompt", () => {
  it("shows learned skills in full, marks imported ones read-only, and puts the in-play skill first", () => {
    const prompt = skillReviewPrompt({ botName: "Scout", transcript: "Person: use weekly-report again", skills });
    expect(prompt.startsWith(SKILL_REVIEW_MARKER)).toBe(true);
    expect(prompt).toContain("weekly-report (learned, may update; named in this conversation)");
    expect(prompt).toContain("imported-tool (imported, read-only)");
    expect(prompt).toContain("huge-skill (learned, too long to show: do not update)");
    expect(prompt).toContain('<skill name="weekly-report">');
    expect(prompt).not.toContain('<skill name="huge-skill">');
    expect(prompt).toContain("## When to Use");
    expect(prompt).toContain("Be ACTIVE");
    expect(prompt).toContain("Never delete or rename a skill");
  });
});

describe("parsing a review", () => {
  const { shown } = shownSkills(skills, "");

  it("reads frontmatter names", () => {
    expect(frontmatterName(skillMd("a-b"))).toBe("a-b");
    expect(frontmatterName("# no frontmatter")).toBeNull();
  });

  it("keeps a create and an update of a shown learned skill, against the version shown", () => {
    const answer = "```json\n" + JSON.stringify({
      changes: [
        { action: "update", skill_name: "weekly-report", skill_md: skillMd("weekly-report", "Ask for the week first."), gist: "Asks for the week first." },
        { action: "create", skill_md: skillMd("chart-making"), gist: "New charting skill." },
      ],
      note: "two lessons",
    }) + "\n```";
    const { changes, note } = parseSkillReview(answer, skills, shown);
    expect(note).toBe("two lessons");
    expect(changes).toEqual([
      expect.objectContaining({ action: "update", name: "weekly-report", baseSha256: "a".repeat(64) }),
      expect.objectContaining({ action: "create", name: "chart-making" }),
    ]);
    expect(changes[1]!.baseSha256).toBeUndefined();
  });

  it("refuses updates it may not make and creates under taken names", () => {
    const answer = JSON.stringify({ changes: [
      { action: "update", skill_name: "imported-tool", skill_md: skillMd("imported-tool") },
      { action: "update", skill_name: "huge-skill", skill_md: skillMd("huge-skill") },
      { action: "update", skill_name: "weekly-report", skill_md: skillMd("renamed") },
      { action: "update", skill_name: "weekly-report", skill_md: skillMd("weekly-report") },
      { action: "create", skill_md: skillMd("weekly-report") },
      { action: "delete", skill_md: skillMd("anything") },
      { action: "create", skill_md: "no frontmatter" },
    ] });
    expect(parseSkillReview(answer, skills, shown).changes).toEqual([]);
  });

  it("takes at most a few changes and one per skill", () => {
    const answer = JSON.stringify({ changes: [
      { action: "create", skill_md: skillMd("one") },
      { action: "create", skill_md: skillMd("one", "again") },
      { action: "create", skill_md: skillMd("two") },
      { action: "create", skill_md: skillMd("three") },
      { action: "create", skill_md: skillMd("four") },
    ] });
    expect(parseSkillReview(answer, skills, shown).changes.map((change) => change.name)).toEqual(["one", "two", "three"].slice(0, MAX_REVIEW_CHANGES));
  });

  it("treats junk and Nothing to save as no change", () => {
    expect(parseSkillReview("Nothing to save.", skills, shown).changes).toEqual([]);
    expect(parseSkillReview('{"changes": [], "note": "Nothing to save."}', skills, shown)).toEqual({ changes: [], note: "Nothing to save." });
  });
});

describe("the scheduler", () => {
  let dir: string;
  let statePath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-skill-review-"));
    statePath = join(dir, "skill-review.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const createAnswer = JSON.stringify({ changes: [{ action: "create", skill_md: skillMd("chart-making"), gist: "Charts." }] });
  const updateAnswer = JSON.stringify({ changes: [{ action: "update", skill_name: "weekly-report", skill_md: skillMd("weekly-report", "Ask for the week first.") }] });

  function harness(overrides: Partial<SkillReviewDeps> & { answer?: () => Promise<string> | string } = {}) {
    const state = {
      enabled: true,
      busy: false,
      prompts: [] as string[],
      applied: [] as Array<{ threadId: string; change: ReviewChange }>,
      sha: new Map<string, string>([["weekly-report", "a".repeat(64)]]),
    };
    let called: () => void = () => {};
    const nextCall = () => new Promise<void>((resolve) => { called = resolve; });
    const review = createSkillReview({
      enabled: () => state.enabled,
      threshold: () => 3,
      bot: (id) => (id === BOT.id ? BOT : undefined),
      engine: () => ({
        generateText: async (prompt) => {
          state.prompts.push(prompt);
          called();
          return overrides.answer ? await overrides.answer() : createAnswer;
        },
      }),
      busy: () => state.busy,
      transcript: (_botId, threadId) => (threadId === "gone" ? null : { messages: [say("user", "make me a chart"), say("bot", "Here it is", "t1")], room: false }),
      skills: () => skills.map((skill) => ({ ...skill, sha256: state.sha.get(skill.name) ?? skill.sha256 })),
      currentSha: (_botId, name) => state.sha.get(name) ?? null,
      apply: (_botId, threadId, change) => {
        state.applied.push({ threadId, change });
        return { ok: true };
      },
      statePath,
      settleDelayMs: 0,
      ...overrides,
    });
    return { review, state, nextCall };
  }

  it("counts across turns and restarts, then reviews once the threshold is reached", async () => {
    const first = harness();
    first.review.noteTurn(BOT.id, "thread-a", 2);
    expect(first.review.status(BOT.id, "thread-a").steps).toBe(2);
    first.review.stop();
    expect(JSON.parse(readFileSync(statePath, "utf8")).counters).toEqual([expect.objectContaining({ botId: BOT.id, threadId: "thread-a", steps: 2 })]);

    // a restart reads the counter back; one more short turn makes it due
    const second = harness();
    expect(second.review.status(BOT.id, "thread-a").steps).toBe(2);
    second.review.noteTurn(BOT.id, "thread-a", 1);
    const called = second.nextCall();
    second.review.botSettled(BOT.id);
    await called;
    await second.review.idle();
    expect(second.state.prompts).toHaveLength(1);
    expect(second.state.prompts[0]).toContain("Person: make me a chart");
    expect(second.state.applied).toEqual([{ threadId: "thread-a", change: expect.objectContaining({ action: "create", name: "chart-making" }) }]);
    expect(second.review.status(BOT.id, "thread-a").steps).toBe(0);
  });

  it("does nothing below the threshold or while switched off", async () => {
    const { review, state } = harness();
    review.noteTurn(BOT.id, "thread-a", 2);
    review.botSettled(BOT.id);
    state.enabled = false;
    review.noteTurn(BOT.id, "thread-a", 5);
    review.botSettled(BOT.id);
    await review.idle();
    expect(state.prompts).toEqual([]);
    expect(review.status(BOT.id, "thread-a").steps).toBe(2);
  });

  it("starts counting again when the bot changes a skill itself", () => {
    const { review } = harness();
    review.noteTurn(BOT.id, "thread-a", 2);
    review.noteSkillChange(BOT.id, "thread-a");
    expect(review.status(BOT.id, "thread-a").steps).toBe(0);
  });

  it("finishes quietly while the person's next turn runs, and applies after it settles", async () => {
    let release: (answer: string) => void = () => {};
    const { review, state, nextCall } = harness({ answer: () => new Promise<string>((resolve) => { release = resolve; }) });
    review.noteTurn(BOT.id, "thread-a", 3);
    const called = nextCall();
    review.botSettled(BOT.id);
    await called;
    // the person writes again: the bot is busy when the answer arrives
    state.busy = true;
    review.noteTurn(BOT.id, "thread-a", 2);
    release(createAnswer);
    await review.idle();
    expect(state.applied).toEqual([]);
    expect(review.status(BOT.id, "thread-a")).toMatchObject({ waiting: true });

    state.busy = false;
    review.botSettled(BOT.id);
    await expect.poll(() => state.applied.length).toBe(1);
    // steps run while the review was out still count toward the next one
    expect(review.status(BOT.id, "thread-a")).toMatchObject({ waiting: false, steps: 2 });
  });

  it("leaves a skill alone that changed after the review read it", async () => {
    const { review, state, nextCall } = harness({ answer: () => {
      state.sha.set("weekly-report", "d".repeat(64));
      return updateAnswer;
    } });
    review.noteTurn(BOT.id, "thread-a", 3);
    const called = nextCall();
    review.botSettled(BOT.id);
    await called;
    await review.idle();
    expect(state.applied).toEqual([]);
    expect(review.status(BOT.id, "thread-a").steps).toBe(0);
  });

  it("keeps the counter after a failed call and waits before trying again", async () => {
    let now = 1_000_000;
    const { review, state } = harness({ now: () => now, answer: () => Promise.reject(new Error("over the spend limit")) });
    review.noteTurn(BOT.id, "thread-a", 3);
    expect(await review.run(BOT.id, "thread-a")).toMatchObject({ state: "failed" });
    expect(review.status(BOT.id, "thread-a").steps).toBe(3);
    review.noteTurn(BOT.id, "thread-a", 1);
    review.botSettled(BOT.id);
    await review.idle();
    expect(state.prompts).toHaveLength(1);
    now += 16 * 60_000;
    expect(await review.run(BOT.id, "thread-a")).toMatchObject({ state: "failed" });
    expect(state.prompts).toHaveLength(2);
  });

  it("is cancelled with its conversation and keeps nothing for it", async () => {
    const { review, state, nextCall } = harness({ answer: () => new Promise<string>(() => {}) });
    review.noteTurn(BOT.id, "thread-a", 3);
    const called = nextCall();
    const done = review.run(BOT.id, "thread-a");
    await called;
    review.dropThread("thread-a");
    expect(await done).toMatchObject({ state: "cancelled" });
    expect(state.applied).toEqual([]);
    expect(review.status(BOT.id, "thread-a").steps).toBe(0);
  });

  it("refuses a bot without a capable engine and forgets a conversation that is gone", async () => {
    const noEngine = harness({ engine: () => null });
    noEngine.review.noteTurn(BOT.id, "thread-a", 3);
    expect(await noEngine.review.run(BOT.id, "thread-a")).toMatchObject({ state: "failed" });
    noEngine.review.noteTurn(BOT.id, "gone", 3);
    expect(await noEngine.review.run(BOT.id, "gone")).toMatchObject({ state: "skipped" });
    expect(noEngine.review.status(BOT.id, "gone").steps).toBe(0);
  });
});
