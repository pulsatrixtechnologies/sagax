import { describe, expect, it } from "vitest";

import { describeRun, groupActivityRuns, groupTranscript, isHiddenStatusActivity, isRecoveryActivity, isToolStep, roomTurnFolds, statusActivity } from "./activity-runs";
import type { Message } from "@/state/store";
import { SANDBOX_WAKE_NOTICE, SANDBOX_WAKE_TIMEOUT_NOTICE } from "../../shared/sandbox-wake";
import { workspaceLineName } from "../../shared/workspace-line";
import { ONE_PASSWORD_WAITING } from "../../shared/credential-vault";

let seq = 0;
const tool = (name: string, ok = true): Message =>
  ({ id: `t${++seq}`, at: seq, role: "bot", kind: "activity", tool: { name, ok } });
/** a step with no verdict yet — `ok` absent, not `ok: undefined`, which a
 * default parameter would quietly turn back into a finished step */
const running = (name: string): Message =>
  ({ id: `t${++seq}`, at: seq, role: "bot", kind: "activity", tool: { name } });
const text = (body: string): Message => ({ id: `m${++seq}`, at: seq, role: "bot", kind: "text", text: body });

describe("groupActivityRuns", () => {
  it("folds consecutive tool steps into one run", () => {
    const items = groupActivityRuns([tool("Edit"), tool("Bash"), tool("Edit")]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("run");
    expect(items[0].kind === "run" && items[0].messages).toHaveLength(3);
  });

  it("keeps text between runs, so a run never swallows what the bot said", () => {
    const items = groupActivityRuns([tool("Edit"), tool("Edit"), text("Now the sitemap:"), tool("Write"), tool("Write")]);
    expect(items.map((i) => i.kind)).toEqual(["run", "message", "run"]);
  });

  it("never folds an opened-thread chip into a run — it is navigation, not work", () => {
    const opened: Message = { ...tool("Opened thread #QA PR 245 on Scout"),
      threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245" } };
    const items = groupActivityRuns([tool("Edit"), tool("Edit"), opened, tool("Write"), tool("Write")]);
    expect(items.map((i) => i.kind)).toEqual(["run", "message", "run"]);
  });

  it("never folds a bot-to-bot chip into a run — it links to the other conversation", () => {
    const messaged: Message = { ...tool("Messaged @Ada"),
      comm: { groupId: "g1", withBotId: "ada", withName: "Ada", withColor: "blue" } };
    const items = groupActivityRuns([tool("Edit"), tool("Edit"), messaged, tool("Write"), tool("Write")]);
    expect(items.map((i) => i.kind)).toEqual(["run", "message", "run"]);
  });

  it("leaves a lone tool step as an ordinary message", () => {
    const items = groupActivityRuns([text("hi"), tool("Edit"), text("done")]);
    expect(items.map((i) => i.kind)).toEqual(["message", "message", "message"]);
  });

  it("keeps a step that is still running in the group, which then says what runs now", () => {
    const items = groupActivityRuns([tool("Edit"), tool("Edit"), running("Bash")]);
    expect(items.map((i) => i.kind)).toEqual(["run"]);
    expect(items[0].kind === "run" && items[0].messages.at(-1)?.tool?.name).toBe("Bash");
    // still working: no time yet
    expect(items[0].kind === "run" && items[0].elapsedMs).toBeUndefined();
  });

  it("puts every step of one turn, failed ones included, in one group", () => {
    // the capture: Used 6 tools, Could not use mcp, Used mcp, ... as ten rows
    const steps = [
      tool("Read"), tool("mcp", false), tool("mcp", false), tool("mcp"), tool("mcp", false),
      tool("mcp", false), tool("Bash"), tool("Bash"), tool("mcp", false), tool("mcp"),
    ];
    const items = groupActivityRuns([text("check the ticket"), ...steps, text("Here is the summary")]);
    expect(items.map((i) => i.kind)).toEqual(["message", "run", "message"]);
    expect(items[1].kind === "run" && items[1].messages).toEqual(steps);
  });

  it("never folds a failed turn, which renders as an error not a tool run", () => {
    const items = groupActivityRuns([tool("Edit"), tool("error: the CLI exited")]);
    expect(items.map((i) => i.kind)).toEqual(["message", "message"]);
  });

  it("keeps a usage-limit line visible between successful tool runs", () => {
    const recovery = tool("recovery: Limit reached on Claude and no other engine is available: your message will be sent again when it resets (around 2:05 PM).");
    const messages = [tool("Read"), tool("Edit"), recovery, tool("Bash"), tool("Write")];
    expect(isRecoveryActivity(recovery)).toBe(true);
    expect(isRecoveryActivity(text("recovery: ordinary text"))).toBe(false);
    for (const group of [groupActivityRuns, groupTranscript]) {
      const items = group(messages);
      expect(items.map(item => item.kind)).toEqual(["run", "message", "run"]);
      expect(items[1]).toEqual({ kind: "message", message: recovery });
    }
  });

  it("never draws an automatic recovery, nor lets it split a stretch of work (the maintainer, 2026-10-26)", () => {
    const recovery = tool("recovery: Automatic recovery: trying a backup once.");
    expect(isHiddenStatusActivity(recovery)).toBe(true);
    for (const group of [groupActivityRuns, groupTranscript]) {
      expect(group([tool("Read"), recovery, tool("Bash")]).map(item => item.kind)).toEqual(["run"]);
    }
  });

  it("keeps a stopped turn visible between successful tool runs", () => {
    const stopped = tool("stopped: Stopped");
    const messages = [tool("Read"), tool("Edit"), stopped, tool("Bash"), tool("Write")];
    expect(statusActivity(stopped)).toEqual({ kind: "stopped", text: "Stopped" });
    for (const group of [groupActivityRuns, groupTranscript]) {
      const items = group(messages);
      expect(items.map(item => item.kind)).toEqual(["run", "message", "run"]);
      expect(items[1]).toEqual({ kind: "message", message: stopped });
    }
  });

  it("2026-10-18: a bot moved off a provider the organization hid is a notice, never folded", () => {
    const moved = { ...tool("notice: Your organization no longer offers Grok. This bot now uses Auto, starting on Claude."), tool: { name: "notice: x", ok: true, engineMove: { from: "Grok", to: "Claude" } } } as Message;
    expect(statusActivity(moved)).toEqual({ kind: "notice", text: "Your organization no longer offers Grok. This bot now uses Auto, starting on Claude." });
  });

  it("shows the cluster wake rows as notices in the person's language", () => {
    expect(statusActivity(tool(SANDBOX_WAKE_NOTICE))).toEqual({ kind: "notice", text: "The environment was asleep. Starting can take a few minutes." });
    expect(statusActivity(tool(SANDBOX_WAKE_TIMEOUT_NOTICE))).toEqual({ kind: "notice", text: "The server environment did not start in time. Send the message again in a few minutes." });
  });

  it("shows Auto's Workspace lines as notices in the person's language, never folded", () => {
    expect(statusActivity(tool(workspaceLineName({ target: "this_computer" })))).toEqual({ kind: "notice", text: "On your computer" });
    expect(statusActivity(tool(workspaceLineName({ target: "browser" })))).toEqual({ kind: "notice", text: "In the browser" });
    expect(statusActivity(tool(workspaceLineName({ target: "cloud", fallback: { wanted: "this_computer", reason: "offline" } }))))
      .toEqual({ kind: "notice", text: "Moved to Cloud: your computer is offline" });
    expect(statusActivity(tool(workspaceLineName({ target: "this_computer", fallback: { wanted: "browser", reason: "unavailable" } }))))
      .toEqual({ kind: "notice", text: "Moved to This computer: Browser is not available" });
    expect(isToolStep(tool(workspaceLineName({ target: "cloud" })))).toBe(false);
  });

  it("never draws a Workspace line, nor lets one split a stretch of work (the maintainer, 2026-10-26)", () => {
    const here = tool(workspaceLineName({ target: "this_computer" }));
    const cloud = tool(workspaceLineName({ target: "cloud" }));
    const moved = tool(workspaceLineName({ target: "cloud", fallback: { wanted: "this_computer", reason: "offline" } }));
    const back = tool(workspaceLineName({ target: "this_computer", fallback: { wanted: "browser", reason: "unavailable" } }));
    for (const line of [here, cloud, moved, back]) expect(isHiddenStatusActivity(line)).toBe(true);
    const answer = text("ok");
    for (const group of [groupTranscript, groupActivityRuns]) {
      for (const line of [here, cloud, moved, back]) {
        expect(group([line, answer])).toEqual([{ kind: "message", message: answer }]);
        expect(group([tool("Read"), line, tool("Edit")]).map(item => item.kind)).toEqual(["run"]);
      }
    }
  });

  it("keeps a Data receipt whose title starts with notice:", () => {
    const receipt: Message = {
      ...tool("notice: revenue by region"),
      dataResult: { botId: "pepper", cardId: "c1", title: "notice: revenue by region", kind: "table", sql: "SELECT 1" },
    };
    expect(isHiddenStatusActivity(receipt)).toBe(false);
    expect(isToolStep(receipt)).toBe(false);
    const messages = [tool("Read"), tool("Edit"), receipt, tool("Bash"), tool("Write")];
    for (const group of [groupActivityRuns, groupTranscript]) {
      const items = group(messages);
      expect(items.map((item) => item.kind)).toEqual(["run", "message", "run"]);
      expect(items[1]).toEqual({ kind: "message", message: receipt });
    }
  });

  it("never draws an engine's technical notice (an MCP server skipped, a model fallback)", () => {
    for (const name of [
      'notice: MCP server "slack" was skipped for this turn: 401 Unauthorized',
      "notice: OpenCode no longer offers opencode/x, so this conversation uses opencode/big-pickle.",
    ]) {
      const notice = tool(name);
      expect(isHiddenStatusActivity(notice)).toBe(true);
      for (const group of [groupActivityRuns, groupTranscript]) {
        expect(group([tool("Read"), notice, tool("Bash")]).map(item => item.kind)).toEqual(["run"]);
      }
    }
  });

  it("keeps a notice that asks something of the person visible between successful tool runs", () => {
    const notice = tool(ONE_PASSWORD_WAITING);
    const messages = [tool("Read"), tool("Edit"), notice, tool("Bash"), tool("Write")];
    expect(statusActivity(notice)?.kind).toBe("notice");
    expect(isHiddenStatusActivity(notice)).toBe(false);
    expect(isRecoveryActivity(notice)).toBe(false);
    expect(statusActivity(text("notice: ordinary text"))).toBeNull();
    for (const group of [groupActivityRuns, groupTranscript]) {
      const items = group(messages);
      expect(items.map(item => item.kind)).toEqual(["run", "message", "run"]);
      expect(items[1]).toEqual({ kind: "message", message: notice });
    }
  });

  it("keeps a failed tool in its group: the group counts it", () => {
    const items = groupActivityRuns([
      tool("Read"),
      tool("Edit"),
      tool("Bash", false),
      tool("Write"),
      tool("Write"),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["run"]);
  });

  it("times a group from its first step to the end of its last", () => {
    const at = (name: string, start: number, durationMs: number): Message => ({ ...tool(name), at: start, tool: { name, ok: true, durationMs } });
    const items = groupActivityRuns([at("Read", 10_000, 1_000), at("Bash", 20_000, 5_000)]);
    expect(items[0].kind === "run" && items[0].elapsedMs).toBe(15_000);
  });

  it("gives a run a stable id taken from its first step", () => {
    const steps = [tool("Edit"), tool("Edit")];
    const items = groupActivityRuns(steps);
    expect(items[0].kind === "run" && items[0].id).toBe(`run:${steps[0].id}`);
  });

  it("does not attribute consecutive room steps from different bots to one sender", () => {
    const roomTool = (name: string, botId: string): Message => ({
      ...tool(name),
      from: { botId, name: botId, color: "blue" },
    });

    expect(
      groupActivityRuns([
        roomTool("Read", "alice"),
        roomTool("Edit", "alice"),
        roomTool("Write", "bob"),
        roomTool("Bash", "bob"),
      ]).map((item) => item.kind),
    ).toEqual(["run", "run"]);
  });

  it("keeps local calendar-day boundaries between activity runs", () => {
    const beforeMidnight = new Date(2026, 0, 1, 23, 59).getTime();
    const afterMidnight = new Date(2026, 0, 2, 0, 1).getTime();
    const stepAt = (name: string, at: number): Message => ({ ...tool(name), at });

    expect(
      groupActivityRuns([
        stepAt("Read", beforeMidnight),
        stepAt("Edit", beforeMidnight),
        stepAt("Write", afterMidnight),
        stepAt("Bash", afterMidnight),
      ]).map((item) => item.kind),
    ).toEqual(["run", "run"]);
  });
});

describe("isToolStep", () => {
  const opened: Message = { ...tool("Opened thread #QA PR 245 on Scout"),
    threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245" } };
  const messaged: Message = { ...tool("Messaged @Ada"),
    comm: { groupId: "g1", withBotId: "ada", withName: "Ada", withColor: "blue" } };

  it("is true for a tool the bot ran, whether it is running, finished or failed", () => {
    const steps = [tool("Edit"), running("Bash"), tool("Bash", false)];
    expect(steps.filter((step) => isToolStep(step))).toEqual(steps);
    // narrows the message: its tool can be read without another check
    const step = tool("Edit");
    expect(isToolStep(step) && step.tool.name).toBe("Edit");
  });

  it("is false for what is not work: chips that link elsewhere, status rows and a failed turn", () => {
    const rows = [
      opened,
      messaged,
      tool("notice: the engine runs another model"),
      tool("recovery: Automatic recovery: trying a backup once."),
      tool("error: the CLI exited"),
    ];
    expect(rows.filter((row) => isToolStep(row))).toEqual([]);
  });

  // Only a call's record asks for the provider's item id (call-record.ts): the
  // chat folds the harness's own chips, such as an automatic approval's receipt,
  // with the steps around them, and has always done so.
  it("does not ask for a provider item id: the chat still folds the harness's own chips", () => {
    const receipt = tool("approved Bash (full access): pnpm test");
    expect(receipt.tool).not.toHaveProperty("itemId");
    expect(isToolStep(receipt)).toBe(true);
    const items = groupActivityRuns([tool("Edit"), receipt, tool("Write")]);
    expect(items.map((i) => i.kind)).toEqual(["run"]);
    expect(items[0].kind === "run" && items[0].messages).toHaveLength(3);
  });

  it("is false for anything that is not an activity row with a tool", () => {
    const noTool: Message = { id: "n1", at: 1, role: "bot", kind: "activity" };
    const notActivity: Message = { ...tool("Edit"), kind: "text" };
    expect([text("hi"), noTool, notActivity].filter((row) => isToolStep(row))).toEqual([]);
  });
});

describe("describeRun", () => {
  it("counts repeats and names the tools in order of first use", () => {
    expect(describeRun([tool("Edit"), tool("Bash"), tool("Edit"), tool("Edit")])).toBe("4 steps · Edit ×3, Bash");
  });

  it("names a single repeat without a multiplier", () => {
    expect(describeRun([tool("Edit"), tool("Bash")])).toBe("2 steps · Edit, Bash");
  });

  it("trims a long tail of tool names rather than running off the row", () => {
    expect(describeRun([tool("Edit"), tool("Bash"), tool("Write"), tool("Grep"), tool("Read")])).toBe(
      "5 steps · Edit, Bash, Write +2 more",
    );
  });
});

describe("groupTranscript", () => {
  const assistant = (
    body: string,
    turnId: string,
    turnTerminal = false,
    at = ++seq * 1_000,
  ): Message => ({
    id: `m${++seq}`,
    at,
    role: "bot",
    kind: "text",
    text: body,
    turnId,
    turnTerminal,
  });

  const step = (name: string, turnId: string, at = ++seq * 1_000, ok = true): Message =>
    ({ id: `t${++seq}`, at, role: "bot", kind: "activity", tool: { name, ok }, turnId });

  it("keeps the bot's progress lines above the answer and folds only the settled turn's tool steps", () => {
    const user: Message = { id: "u1", at: 1_000, role: "user", kind: "text", text: "compare note-takers" };
    const ack = assistant("I'll check current pricing since this changes often.", "turn-1", false, 2_000);
    const search = step("WebSearch", "turn-1", 2_500);
    const read = step("WebFetch", "turn-1", 3_000);
    const helper = assistant("I'll spin up a research specialist for the details.", "turn-1", false, 3_500);
    const fetch = step("WebFetch", "turn-1", 4_000);
    const final = assistant("Here are the three best.", "turn-1", true, 30_000);

    const items = groupTranscript([user, ack, search, read, helper, fetch, final]);
    expect(items.map((item) => item.kind === "message" ? item.message.id : item.kind)).toEqual([user.id, ack.id, "run", helper.id, final.id]);
    expect(items[2]).toMatchObject({ kind: "run", id: `run:${search.id}`, elapsedMs: 29_000, messages: [search, read, fetch] });
  });

  it("shows just the answer for a turn with nothing to say: its steps fold, no line of it is hidden", () => {
    const user: Message = { id: "u2", at: 1_000, role: "user", kind: "text", text: "what time is it in Tokyo?" };
    const lookup = step("Bash", "turn-2", 1_500);
    const final = assistant("It's 9:30 PM in Tokyo.", "turn-2", true, 5_000);
    const items = groupTranscript([user, lookup, final]);
    expect(items.map((item) => item.kind)).toEqual(["message", "run", "message"]);
    expect(items.flatMap((item) => item.kind === "message" ? [item.message.text] : [])).toEqual([user.text, final.text]);
    expect(groupTranscript([user, final]).map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("leaves a failed step and other rows that are not work where they were", () => {
    const failed = step("Bash", "turn-3", 2_000, false);
    const ok = step("Read", "turn-3", 3_000);
    const final = assistant("Done.", "turn-3", true, 5_000);
    const items = groupTranscript([ok, failed, final]);
    expect(items.map((item) => item.kind === "message" ? item.message.id : item.kind)).toEqual(["run", failed.id, final.id]);
  });

  it("folds a room member's working notes, so a room still reads as answers", () => {
    const first = assistant("I'm checking connected apps.", "turn-r", false, 2_000);
    const final = assistant("You have three tasks.", "turn-r", true, 5_000);
    const { byTerminalId, hiddenIds } = roomTurnFolds([first, final]);
    expect([...hiddenIds]).toEqual([first.id]);
    expect(byTerminalId.get(final.id)).toMatchObject({ messages: [first] });
  });

  it("keeps every message visible until the turn settles", () => {
    const first = assistant("Checking.", "turn-live");
    const second = assistant("Still checking.", "turn-live");
    expect(groupTranscript([first, second]).map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("keeps a lone terminal message as the answer", () => {
    const only = assistant("I could not finish, but here is what I found.", "turn-short", true);
    expect(groupTranscript([only])).toEqual([{ kind: "message", message: only }]);
  });

  it("does not fold steps from a different turn", () => {
    const older = step("Read", "turn-old");
    const progress = step("Edit", "turn-new");
    const final = assistant("Done.", "turn-new", true);
    expect(groupTranscript([older, progress, final]).map((item) => item.kind === "run" ? item.messages.map((m) => m.id) : item.kind)).toEqual([
      "message",
      [progress.id],
      "message",
    ]);
  });
});

describe("1Password waiting row (parité R10)", () => {
  it("is a notice in the reader's language", async () => {
    const { ONE_PASSWORD_WAITING } = await import("../../shared/credential-vault");
    const row = statusActivity({ id: "a", role: "bot", kind: "activity", at: 1, tool: { name: ONE_PASSWORD_WAITING, ok: true } } as Message);
    expect(row?.kind).toBe("notice");
    expect(row?.text).toContain("1Password");
  });
});

describe("this computer's control line (2026-10-28)", () => {
  it("is a notice the chat keeps, in the reader's language", async () => {
    const { HOST_CONTROL_NOTICE } = await import("../../shared/host-control");
    const message = { id: "h", role: "bot", kind: "activity", at: 1, tool: { name: HOST_CONTROL_NOTICE, ok: true } } as Message;
    expect(isHiddenStatusActivity(message)).toBe(false);
    expect(statusActivity(message)).toEqual({ kind: "notice", text: "The bot is now controlling this computer: its screen, mouse and keyboard. Stop it at any time with Stop." });
  });
});

describe("the connector switch line (review of #943)", () => {
  it("reads in the person's language, from the structured line", () => {
    const message: Message = { id: "cs", at: 1, role: "bot", kind: "activity", tool: { name: "notice: Switched to Claude for Gmail.", ok: true, connectorSwitch: { engine: "Claude", connector: "Gmail" } } };
    expect(statusActivity(message)).toEqual({ kind: "notice", text: "Switched to Claude for Gmail" });
  });
});

describe("a 1:1 goal's status row (#1372)", () => {
  it("is shown, and reads in the person's language from the structured line", () => {
    const message: Message = { id: "g", at: 1, role: "bot", kind: "activity", tool: { name: "Done: ship the notes (notes shipped)", ok: true, soloGoal: { status: "completed", goal: "ship the notes", detail: "notes shipped" } } };
    expect(isHiddenStatusActivity(message)).toBe(false);
    expect(statusActivity(message)).toEqual({ kind: "notice", text: "Goal done: ship the notes (notes shipped)" });
  });
});

describe("a usage-limit switch is transparent (2026-10-29)", () => {
  const limitRow = (name: string, limitFailover: NonNullable<Message["tool"]>["limitFailover"]): Message =>
    ({ id: `l${++seq}`, at: seq, role: "bot", kind: "activity", tool: { name, ok: true, limitFailover } });

  it("leaves a switch and a return out of the chat, stored ones too", () => {
    expect(isHiddenStatusActivity(limitRow("notice: Limit reached on Claude: continuing on Codex until it resets (around 2:05 PM).",
      { kind: "switched", from: "Claude", to: "Codex", resetsAt: 0 }))).toBe(true);
    expect(isHiddenStatusActivity(limitRow("recovery: Limit reached on Claude: continuing on Codex until it resets (around 2:05 PM).",
      { kind: "switched", from: "Claude", to: "Codex", resetsAt: 0 }))).toBe(true);
    expect(isHiddenStatusActivity(limitRow("recovery: Claude's limit has reset: back on Claude.", { kind: "back", engine: "Claude" }))).toBe(true);
  });

  it("keeps the wait when nothing else can answer", () => {
    expect(isHiddenStatusActivity(limitRow("recovery: Limit reached on Claude and no other engine is available: your message will be sent again when it resets (around 2:05 PM).",
      { kind: "waiting", from: "Claude", resetsAt: 0 }))).toBe(false);
  });

  it("keeps consecutive-limit exhaustion visible in the chat (#1942)", () => {
    expect(isHiddenStatusActivity(limitRow("error: Limits were reached on Claude, Codex: no other engine could answer.",
      { kind: "exhausted", tried: ["Claude", "Codex"], resetsAt: 0 }))).toBe(false);
  });
});
