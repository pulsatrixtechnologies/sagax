// The executable scenarios behind each corpus `kind`. Every scenario runs
// against one isolated server whose fake engine is configured for exactly
// that task; none of them touches a real engine, key or account.
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readHandoffs } from "../../server/testing/handoff-rows.ts";
import { FAKE_ACP_CLI, SseTap, sleep, now, type ServerOptions, type ServerPaths } from "./harness.ts";
import { promptRequestText, type TaskContext } from "./context.ts";
import type { TaskDefinition } from "./corpus.ts";

export interface Scenario {
  server(): Omit<ServerOptions, "profile">;
  run(ctx: TaskContext): Promise<void>;
}
type Factory = (def: TaskDefinition) => Scenario;

const GATE = (name: string) => `[gate:${name}]`;
const slowEnv = (paths: ServerPaths): Record<string, string> => ({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: paths.gates });
const hasActivity = (messages: any[]) => messages.some((message) => message.kind === "activity");

/** First message of a held turn: busy, with its tool row visible so later words can be folded in. */
async function startHeldTurn(ctx: TaskContext, bot: { id: string; threadId: string; name: string }, gate: string, text = "Start a long synthetic report.") {
  const first = await ctx.send(bot, `${text} ${GATE(gate)}`);
  await ctx.waitUntil("the held turn to start", async () => (await ctx.botSnapshot(bot.id))?.busy === true);
  await ctx.waitUntil("its tool row", async () => hasActivity(await ctx.messages(bot.threadId)));
  return first;
}

const reply: Factory = (def) => {
  const { prompt, style, tools } = def.params as { prompt: string; style: "stream" | "echo"; tools?: number };
  return {
    server: () => ({
      engineEnv: {
        FAKE_CLAUDE_MODE: style === "stream" ? "stream" : "slow",
        ...(tools ? { FAKE_CLAUDE_TOOL_CALLS: JSON.stringify(Array.from({ length: tools }, (_, i) => ({ name: "Bash", input: { command: `echo step ${i + 1}` }, ok: true }))) } : {}),
      },
    }),
    async run(ctx) {
      ctx.echo = style === "echo";
      const bot = await ctx.newBot("Qual reply");
      const sent = await ctx.send(bot, prompt, { sample: true });
      await ctx.settle();
      const messages = await ctx.messages(bot.threadId);
      const texts = ctx.botTexts(messages);
      ctx.expectedTexts.set(bot.threadId, 1);
      if (style === "echo") ctx.check("the reply carries the prompt intact", texts.some((m) => String(m.text).includes(prompt)), `got ${String(texts[0]?.text).slice(0, 80)}`);
      if (tools) ctx.check(`${tools} tool rows`, messages.filter((m) => m.kind === "activity").length >= tools, `${messages.filter((m) => m.kind === "activity").length}`);
      ctx.check("accepted", sent.status === 202);
    },
  };
};

const sequence: Factory = (def) => {
  const { prompts } = def.params as { prompts: string[] };
  return {
    server: () => ({ engineEnv: { FAKE_CLAUDE_MODE: "stream" } }),
    async run(ctx) {
      const bot = await ctx.newBot("Qual sequence");
      for (const prompt of prompts) {
        await ctx.send(bot, prompt, { sample: true });
        await ctx.settle();
      }
      ctx.expectedTexts.set(bot.threadId, prompts.length);
    },
  };
};

const busy: Factory = (def) => {
  const { extra, routeWhileBusy } = def.params as { extra: number; routeWhileBusy?: boolean };
  return {
    server: () => ({
      engineEnv: (paths) => ({
        ...slowEnv(paths),
        ...(routeWhileBusy ? { FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "agents", tool: "route_message", onSteer: true, when: "ROUTE_AFTER", arguments: { handle: "$ROUTE_HANDLE", mode: "after" } }]) } : {}),
      }),
    }),
    async run(ctx) {
      ctx.echo = true;
      // A routed text rides in the steer note and runs after; only its own turn answers it.
      ctx.foldIsProcessing = !routeWhileBusy;
      const bot = await ctx.newBot("Qual busy");
      await startHeldTurn(ctx, bot, "g1");
      for (let i = 0; i < extra; i += 1) {
        await ctx.send(bot, `${routeWhileBusy ? "ROUTE_AFTER " : ""}Follow-up number ${i + 1}.`, { routeWhileBusy });
        await sleep(250);
      }
      ctx.server.openGate("g1");
      await ctx.settle(40_000);
      const texts = ctx.botTexts(await ctx.allMessages(bot.id));
      for (const entry of ctx.accepted) ctx.check(`${entry.marker} was answered`, texts.some((m) => ctx.ownText(String(m.text)).includes(entry.marker)));
    },
  };
};

const busyParallel: Factory = () => ({
  server: () => ({ engineEnv: slowEnv }),
  async run(ctx) {
    ctx.echo = true;
    const bot = await ctx.newBot("Qual parallel");
    await startHeldTurn(ctx, bot, "g1");
    const created = await ctx.api("POST", `/api/bots/${bot.id}/tasks`, { title: "Second conversation" });
    const second = created.body?.task?.threadId as string | undefined;
    if (!ctx.check("a second conversation was created", Boolean(second), JSON.stringify(created.body).slice(0, 120))) return;
    // The fake engine holds on the LAST gate marker of a prompt, and a recalled
    // memory passage quotes the first message's gate; a gate of our own, already
    // open, comes last and so wins.
    ctx.server.openGate("open");
    const sent = await ctx.send(bot, `Quick synthetic question in the other conversation. ${GATE("open")}`, { threadId: second });
    const answered = await ctx.waitUntil("the second conversation to answer while the first is held", async () =>
      ctx.botTexts(await ctx.messages(second!)).some((m) => String(m.text).includes(sent.marker)), 15_000);
    ctx.check("the second answer did not wait for the first", answered);
    ctx.server.openGate("g1");
    await ctx.settle(30_000);
  },
});

const delegate: Factory = (def) => {
  const { shape } = def.params as { shape: "single" | "fan" | "chain" };
  return {
    server: () => ({ room: true, engineEnv: { FAKE_CLAUDE_MODE: "stream" } }),
    async run(ctx) {
      ctx.promptCountsDispatch = false;
      const create = (section: string) => ({ section });
      const chief = await ctx.newBot("Qual chief", {}, create("Leadership"));
      const lead = shape === "chain" ? await ctx.newBot("Qual lead", {}, create("Engineering")) : null;
      const first = await ctx.newBot("Qual specialist one", {}, create("Engineering"));
      const second = shape === "fan" ? await ctx.newBot("Qual specialist two", {}, create("Engineering")) : null;
      // The chief is promoted once the team it manages exists.
      const promoted = await ctx.api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true });
      if (!ctx.check("the chief was set up", promoted.status < 300, JSON.stringify(promoted.body).slice(0, 150))) return;
      const plan: Record<string, unknown> = {};
      const m = ctx.marker();
      if (shape === "single") {
        plan[chief.id] = { steps: [{ arguments: { bot_ids: [first.id], message: `Review the synthetic spec ${m}` } }], reply: "Assigned", resumeReply: `Reviewed ${m}` };
        plan[first.id] = { reply: "Spec reviewed" };
      } else if (shape === "fan") {
        plan[chief.id] = { steps: [{ arguments: { bot_ids: [first.id, second!.id], message: `Review the synthetic spec ${m}` } }], reply: "Assigned", resumeReply: `Reviewed ${m}` };
        plan[first.id] = { reply: "Spec reviewed one" };
        plan[second!.id] = { reply: "Spec reviewed two" };
      } else {
        plan[chief.id] = { steps: [{ arguments: { bot_ids: [lead!.id], message: `Implement and verify the synthetic export ${m}` } }], reply: "Assigned", resumeReply: `Reviewed ${m}` };
        plan[lead!.id] = { steps: [{ arguments: { bot_ids: [first.id], message: "Independently verify the synthetic export" } }], reply: "Sent for verification", resumeReply: "Verified by the specialist" };
        plan[first.id] = { reply: "Export verified" };
      }
      writeFileSync(ctx.server.paths.roomPlan, JSON.stringify(plan));
      await ctx.send(chief, "Please have the team do the synthetic task and own the result.", { sample: true });
      await ctx.settle(60_000);
      const chiefTexts = ctx.botTexts(await ctx.messages(chief.threadId)).map((message) => String(message.text));
      ctx.check("the chief reported the result once", chiefTexts.filter((text) => text.includes(`Reviewed ${m}`)).length === 1, JSON.stringify(chiefTexts).slice(0, 200));
      const nodes = readHandoffs(ctx.server.dataDir);
      const expected = shape === "fan" ? 2 : shape === "chain" ? 2 : 1;
      ctx.check(`${expected} delegated assignment(s) recorded`, nodes.filter((node) => node.parentId).length === expected, `${nodes.filter((node) => node.parentId).length}`);
      for (const node of nodes) ctx.check(`assignment ${node.botId.slice(0, 6)} reached a terminal state`, ["completed", "failed", "cancelled"].includes(node.status), node.status);
      // A node that handed work out runs twice by design (its turn, then its resume); a leaf runs once.
      const hasChild = (id: string) => nodes.some((node) => node.parentId === id);
      ctx.check("no assignment ran more than its design allows", nodes.every((node) => node.restarts === 0 && node.executions <= (hasChild(node.id) ? 2 : 1)), JSON.stringify(nodes.map((n) => n.executions)));
      for (const node of nodes) if (node.parentId && node.status !== "completed") ctx.check(`assignment ${node.botId.slice(0, 6)} completed`, false, node.status);
      for (const specialist of [first, second].filter(Boolean)) {
        const count = ctx.botTexts(await ctx.messages(specialist!.threadId)).length + ctx.botTexts(await ctx.allMessages(specialist!.id)).length;
        void count;
      }
    },
  };
};

const routine: Factory = (def) => {
  const { runs, scheduledInMs } = def.params as { runs?: number; scheduledInMs?: number };
  return {
    server: () => ({ engineEnv: { FAKE_CLAUDE_MODE: "stream" } }),
    async run(ctx) {
      const bot = await ctx.newBot("Qual routine");
      const m = ctx.marker();
      const t0 = now();
      const expectedRuns = scheduledInMs ? 1 : runs!;
      ctx.allowedDispatches = expectedRuns;
      ctx.record({ marker: m, text: `Summarize the synthetic inbox. ${m}`, botId: bot.id, threadId: bot.threadId, status: 202, t0, sample: !scheduledInMs });
      const created = await ctx.api("POST", "/api/routines", {
        name: "Qual routine", prompt: `Summarize the synthetic inbox. ${m}`, botId: bot.id, enabled: true,
        schedule: scheduledInMs ? { type: "once", at: Date.now() + scheduledInMs } : { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
      });
      const routineId = created.body?.routine?.id as string | undefined;
      if (!ctx.check("routine created", Boolean(routineId), JSON.stringify(created.body).slice(0, 150))) return;
      const runsOf = async () => ((await ctx.api("GET", "/api/routines")).body?.runs ?? []).filter((run: any) => run.routineId === routineId) as any[];
      if (scheduledInMs) {
        await ctx.waitUntil("the scheduled run to complete", async () => (await runsOf()).some((run) => run.status === "completed"), scheduledInMs + 30_000);
        await sleep(3_000); // a second, duplicate scheduled run would show up here
      } else {
        for (let i = 0; i < runs!; i += 1) {
          const started = await ctx.api("POST", `/api/routines/${routineId}/run`);
          ctx.check(`run ${i + 1} started`, started.status < 300, JSON.stringify(started.body).slice(0, 150));
          const id = started.body?.run?.id;
          await ctx.waitUntil(`run ${i + 1} to complete`, async () => (await runsOf()).some((run) => run.id === id && run.status === "completed"), 30_000);
        }
      }
      await ctx.settle();
      const finished = await runsOf();
      ctx.check(`exactly ${expectedRuns} run(s), all completed`, finished.length === expectedRuns && finished.every((run) => run.status === "completed"), JSON.stringify(finished.map((run) => run.status)));
    },
  };
};

const upload: Factory = (def) => {
  const { chunks, replay, attach } = def.params as { chunks: number; replay?: boolean; attach?: boolean };
  return {
    server: () => ({ engineEnv: { FAKE_CLAUDE_MODE: "stream" } }),
    async run(ctx) {
      const size = 32 * 1024;
      const total = chunks * size;
      const bytes = Buffer.alloc(total);
      for (let i = 0; i < total; i += 1) bytes[i] = 97 + ((i * 31 + 7) % 26); // lowercase letters: a plain text file
      const uploadId = randomUUID();
      const base = `${ctx.server.url}/api/files?name=synthetic.txt&uploadId=${uploadId}&total=${total}`;
      const call = (phase: string, offset: number, body?: Buffer) => fetch(`${base}&phase=${phase}&offset=${offset}`, {
        method: "POST", headers: { "content-type": "text/plain", origin: ctx.server.url }, body: body ? new Uint8Array(body) : undefined,
      });
      for (let i = 0; i < chunks; i += 1) {
        const piece = bytes.subarray(i * size, (i + 1) * size);
        const response = await call("chunk", i * size, piece);
        ctx.check(`chunk ${i + 1} accepted`, response.status === 200, `${response.status}`);
        if (replay && i === 0) {
          const status = await (await call("status", 0)).json() as { offset?: number };
          ctx.check("status reports the durable offset", status.offset === size, JSON.stringify(status));
          const again = await call("chunk", 0, piece);
          ctx.check("a replayed chunk is harmless", again.status === 200 || again.status === 409, `${again.status}`);
        }
      }
      const commit = await call("commit", 0);
      const committed = await commit.json() as { saved?: { path: string; bytes: number } };
      ctx.check("commit saved every byte", commit.status === 200 && committed.saved?.bytes === total, JSON.stringify(committed));
      if (replay) {
        const again = await (await call("commit", 0)).json() as { saved?: { path: string } };
        ctx.check("a replayed commit returns the same file", again.saved?.path === committed.saved?.path);
      }
      const bot = await ctx.newBot("Qual files");
      const path = committed.saved?.path ?? "";
      // The attachment tag ends the message, so the marker goes before it.
      const marker = ctx.marker();
      const sent = await ctx.send(bot, `Read this synthetic file [${marker}].\n\n<attached-file path="${path}" name="synthetic.txt" />`, { sample: Boolean(attach), marker });
      ctx.check("the message carrying the file was accepted", sent.status === 202);
      await ctx.settle();
      if (attach) ctx.expectedTexts.set(bot.threadId, 1);
      const listing = await ctx.api("GET", `/api/threads/${bot.threadId}/files`);
      const file = (listing.body?.files ?? []).find((entry: any) => entry.name === "synthetic.txt");
      if (!ctx.check("the file is listed in the thread", Boolean(file), JSON.stringify(listing.body).slice(0, 150))) return;
      const download = await fetch(`${ctx.server.url}/api/threads/${bot.threadId}/files/${file.id}`, { headers: { origin: ctx.server.url } });
      const got = Buffer.from(await download.arrayBuffer());
      ctx.check("the download is byte for byte the upload", download.status === 200 && got.equals(bytes), `${download.status}, ${got.length} of ${total} bytes`);
    },
  };
};

const PAGE_HTML = "<!doctype html><html><body><h1>Synthetic report</h1><p>Nothing real is in this page.</p></body></html>";

const page: Factory = (def) => {
  const { publish } = def.params as { publish: boolean };
  return {
    server: () => ({
      engineEnv: {
        FAKE_CLAUDE_MODE: "stream",
        FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "agents", tool: "propose_page", when: "MAKE_PAGE", arguments: { title: "Synthetic report", kind: "html", content: PAGE_HTML } }]),
      },
    }),
    async run(ctx) {
      const bot = await ctx.newBot("Qual page");
      await ctx.send(bot, "MAKE_PAGE: write a one page synthetic report.");
      await ctx.settle();
      const listed = await ctx.api("GET", "/api/pages");
      const pages = (listed.body?.pages ?? []) as any[];
      if (!ctx.check("exactly one page was proposed", pages.length === 1, `${listed.status} ${JSON.stringify(listed.body).slice(0, 150)}`)) return;
      const id = pages[0].id as string;
      const source = await ctx.api("GET", `/api/pages/${id}/versions/1/source`);
      ctx.check("version 1 holds the proposed content", String(source.body?.content ?? "").includes("Synthetic report"), JSON.stringify(source.body).slice(0, 120));
      ctx.check("it waits for the person (draft)", pages[0].status === "draft", String(pages[0].status));
      if (publish) {
        const published = await ctx.api("POST", `/api/pages/${id}/publish`, { version: 1, access: "link", expiresAt: null });
        ctx.check("the person's publish worked", published.status === 200 && published.body?.page?.status === "published", `${published.status} ${JSON.stringify(published.body).slice(0, 150)}`);
        ctx.check("a reading link exists", typeof published.body?.page?.url === "string");
        const again = await ctx.api("GET", "/api/pages");
        ctx.check("still one page", (again.body?.pages ?? []).length === 1);
      }
    },
  };
};

const failover: Factory = (def) => {
  const { goBack } = def.params as { goBack: boolean };
  const PRIMARY = { instanceId: "primary", model: "fixture/primary" };
  return {
    server: () => ({
      engineEnv: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_TOOL_CALLS: "[]" },
      serverEnv: { SAGAX_TEST_LIMIT_AFTER_RESET_MS: "300" },
      extraInstances: (paths) => ({
        primary: {
          driver: "opencodeGo", displayName: "Primary fixture", config: { cli: FAKE_ACP_CLI },
          environment: {
            FAKE_ACP_MODELS: PRIMARY.model,
            FAKE_ACP_RPC_FAILURE_FILE: join(paths.dataDir, "primary-limited.json"), FAKE_ACP_RPC_FAILURE_WHILE_FILE: "1",
          },
        },
      }),
    }),
    async run(ctx) {
      ctx.deliveryByAnswer = true;
      const limited = join(ctx.server.dataDir, "primary-limited.json");
      const bot = await ctx.newBot("Qual failover");
      await ctx.api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { modelSelection: PRIMARY, updateBotDefault: true, approvalMode: "ask" });
      const resetsAt = Math.ceil((Date.now() + (goBack ? 6_000 : 60_000)) / 1_000) * 1_000;
      writeFileSync(limited, JSON.stringify({ code: -32603, message: "Internal error", data: { message: `You've hit your usage limit (429). Your plan resets at ${new Date(resetsAt).toISOString()}` } }));
      const first = await ctx.send(bot, "Synthetic request that meets a limit.", { sample: false });
      await ctx.waitUntil("the backup engine to answer", async () => ctx.botTexts(await ctx.messages(bot.threadId)).some((m) => m.text === "hello from fake claude"), 45_000);
      await ctx.settle(45_000);
      let messages = await ctx.messages(bot.threadId);
      ctx.check("one user message for the limited request", messages.filter((m) => m.role === "user" && String(m.text).includes(first.marker)).length === 1);
      ctx.check("one failover notice", messages.filter((m) => m.tool?.limitFailover).length === 1, `${messages.filter((m) => m.tool?.limitFailover).length}`);
      ctx.check("no engine error text in the chat", messages.filter((m) => m.kind === "activity" && String(m.tool?.name ?? "").startsWith("error:")).length === 0);
      ctx.expectedTexts.set(bot.threadId, 1);
      if (goBack) {
        rmSync(limited, { force: true });
        await ctx.waitUntil("the limit window to pass", () => Date.now() > resetsAt + 500, 20_000);
        const second = await ctx.send(bot, "Synthetic request after the reset.");
        await ctx.waitUntil("the primary to answer again", async () => ctx.botTexts(await ctx.messages(bot.threadId)).some((m) => m.text === "hello from fake acp"), 45_000);
        await ctx.settle(45_000);
        messages = await ctx.messages(bot.threadId);
        ctx.check("the second request ran on the primary", ctx.botTexts(messages).filter((m) => m.text === "hello from fake acp").length === 1);
        ctx.check("one user message for the second request", messages.filter((m) => m.role === "user" && String(m.text).includes(second.marker)).length === 1);
        ctx.expectedTexts.set(bot.threadId, 2);
      }
    },
  };
};

const cancel: Factory = (def) => {
  const { variant } = def.params as { variant: "tool" | "resend" | "queued" };
  return {
    server: () => ({ engineEnv: (paths) => ({ ...slowEnv(paths), FAKE_CLAUDE_HOLD_AFTER_TOOL: "1" }) }),
    async run(ctx) {
      ctx.echo = true;
      const bot = await ctx.newBot("Qual cancel");
      const first = await ctx.send(bot, `Start a long synthetic task. ${GATE("never")}`);
      await ctx.waitUntil("the turn to start", async () => (await ctx.botSnapshot(bot.id))?.busy === true);
      await ctx.waitUntil("its tool row", async () => hasActivity(await ctx.messages(bot.threadId)));
      let queued: Awaited<ReturnType<typeof ctx.send>> | undefined;
      if (variant === "queued") {
        queued = await ctx.send(bot, "A second synthetic message queued behind the first.");
        queued.cancelled = true; // the Stop below is for the whole conversation
        await sleep(300);
      }
      const stopAt = now();
      const stopped = await ctx.api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
      ctx.check("Stop accepted", stopped.status < 300, `${stopped.status}`);
      first.cancelled = true;
      const idle = await ctx.settle(20_000);
      ctx.note(`idle ${Math.round(now() - stopAt)} ms after Stop`);
      ctx.check("the bot is idle after Stop", idle);
      let messages = await ctx.messages(bot.threadId);
      ctx.check("the stopped turn has no final reply", !ctx.botTexts(messages).some((m) => String(m.text).includes(first.marker)));
      if (variant === "resend") {
        const again = await ctx.send(bot, "A new synthetic message after Stop.");
        await ctx.settle(30_000);
        messages = await ctx.messages(bot.threadId);
        ctx.check("the new message was answered once", ctx.botTexts(messages).filter((m) => String(m.text).includes(again.marker)).length === 1);
      }
      if (variant === "queued") {
        await sleep(2_500);
        messages = await ctx.messages(bot.threadId);
        ctx.check("nothing ran by surprise after Stop", !(await ctx.botSnapshot(bot.id))?.busy && !ctx.botTexts(messages).some((m) => String(m.text).includes(queued!.marker)), "the queued words ran after Stop");
      }
    },
  };
};

const reconnect: Factory = (def) => {
  const { variant } = def.params as { variant: "cursor" | "stale" };
  return {
    server: () => ({ engineEnv: slowEnv }),
    async run(ctx) {
      ctx.echo = true;
      const bot = await ctx.newBot("Qual reconnect");
      const first = await startHeldTurn(ctx, bot, "g1");
      ctx.sse.close();
      // A cursor is "<stream id>:<seq>"; a stale one names a seq the server never reached.
      const cursor = `${ctx.sse.streamId}:${variant === "cursor" ? ctx.sse.lastSeq : 9_999_999}`;
      ctx.server.openGate("g1");
      await sleep(1_500); // the turn finishes while nobody listens
      const tap = await SseTap.open(ctx.server.url, cursor);
      const keep = ctx.sse;
      ctx.sse = tap;
      const resumed = tap.hello?.resumed === true;
      await sleep(500);
      const messages = await ctx.messages(bot.threadId);
      const inThread = ctx.botTexts(messages).filter((m) => String(m.text).includes(first.marker)).length;
      const replayed = tap.frames.filter(({ frame }) => frame.kind === "message" && frame.message?.role === "bot" && String(frame.message?.text ?? "").includes(first.marker)).length;
      if (variant === "cursor") {
        ctx.check("the server resumed from the cursor", resumed);
        ctx.check("the missed reply was replayed once", replayed === 1, `${replayed}`);
      } else {
        ctx.check("the server said it could not replay", !resumed);
        ctx.check("nothing was half replayed", replayed === 0, `${replayed}`);
      }
      ctx.check("the thread reload holds the reply once", inThread === 1, `${inThread}`);
      ctx.note(`resumed=${resumed} replayed=${replayed}`);
      void keep;
    },
  };
};

const restart: Factory = (def) => {
  const { signal, queued } = def.params as { signal: "SIGTERM" | "SIGKILL"; queued?: boolean };
  return {
    server: () => ({ engineEnv: (paths) => ({ ...slowEnv(paths), FAKE_CLAUDE_HOLD_AFTER_TOOL: "1" }) }),
    async run(ctx) {
      ctx.echo = true;
      const bot = await ctx.newBot("Qual restart");
      const first = await startHeldTurn(ctx, bot, "held");
      let second: Awaited<ReturnType<typeof ctx.send>> | undefined;
      if (queued) {
        second = await ctx.send(bot, "A second synthetic message sent behind the held turn.");
        await sleep(300);
      }
      ctx.sse.close();
      await ctx.server.restart(signal);
      ctx.sse = await SseTap.open(ctx.server.url);
      const resumed = () => ctx.allMessages(bot.id).then((all) => all.some((m) => m.kind === "activity" && m.tool?.name === "Resuming after a restart"));
      // A graceful stop writes the cut turn down and the next start runs it
      // again once; a crash cannot, so the thread must say it was cut.
      const resumes = await ctx.waitUntilQuiet(() => resumed(), 8_000);
      ctx.note(`${signal}: ${resumes ? "the turn resumed after the restart" : "no resume after the restart"}`);
      if (resumes) {
        ctx.server.openGate("held");
        ctx.check("the resumed turn finished", await ctx.settle(30_000));
      }
      const idle = await ctx.settle(30_000);
      const messages = await ctx.allMessages(bot.id);
      const texts = ctx.botTexts(messages);
      const userKept = messages.some((m) => m.role === "user" && String(m.text).includes(first.marker));
      const cutRow = messages.some((m) => m.kind === "activity" && /restarted before this finished|interrupt/i.test(JSON.stringify(m.tool ?? "")));
      const answeredAfter = resumes && texts.some((m) => String(m.text).startsWith('reply to:'));
      ctx.note(`userKept=${userKept} cutRowShown=${cutRow} answeredAfterResume=${answeredAfter}`);
      ctx.check("the accepted message survived the restart", userKept);
      ctx.check("the cut turn is visible or answered", cutRow || answeredAfter);
      let delivered = true;
      if (queued && second) {
        // The second message was accepted while the turn ran: it must be
        // answered, or run, after the restart. A user row alone is not delivery.
        delivered = texts.some((m) => String(m.text).includes(second!.marker)) || ctx.server.promptLog().some((l) => promptRequestText(l).includes(second!.marker)) || (resumes && texts.some((m) => String(m.text).startsWith('reply to:') && String(m.text).includes(second!.marker)));
        ctx.note(`the message sent behind the turn was ${delivered ? "delivered" : "NOT delivered and nothing says so"}`);
        // The judge counts a message that never reached an engine as lost.
      }
      ctx.restartRecovery = idle && userKept && (cutRow || answeredAfter) && delivered ? "recovered" : "not-recovered";
    },
  };
};

const concurrent: Factory = (def) => {
  const { bots, sends } = def.params as { bots: number; sends: number };
  const stream = def.id === "concurrent-01";
  return {
    server: () => ({ engineEnv: stream ? { FAKE_CLAUDE_MODE: "stream" } : (paths) => slowEnv(paths) }),
    async run(ctx) {
      ctx.echo = !stream;
      const created = [] as Awaited<ReturnType<typeof ctx.newBot>>[];
      for (let i = 0; i < bots; i += 1) created.push(await ctx.newBot(`Qual concurrent ${i + 1}`));
      const calls: Promise<unknown>[] = [];
      for (const bot of created) for (let s = 0; s < sends; s += 1) calls.push(ctx.send(bot, `Synthetic concurrent message ${s + 1} for ${bot.name}.`, { sample: stream }));
      await Promise.all(calls);
      await ctx.settle(60_000);
      for (const bot of created) {
        const texts = ctx.botTexts(await ctx.allMessages(bot.id));
        if (stream) ctx.expectedTexts.set(bot.threadId, 1);
        else for (const entry of ctx.accepted.filter((item) => item.botId === bot.id)) ctx.check(`${entry.marker} answered`, texts.some((m) => String(m.text).includes(entry.marker)));
      }
      // no cross talk: a bot's replies never carry another bot's markers
      if (!stream) for (const bot of created) {
        const texts = ctx.botTexts(await ctx.allMessages(bot.id)).map((m) => String(m.text));
        const foreign = ctx.accepted.filter((item) => item.botId !== bot.id).some((item) => texts.some((text) => text.includes(item.marker)));
        ctx.check(`${bot.name} has no foreign reply`, !foreign);
      }
    },
  };
};

export const KINDS: Record<string, Factory> = {
  reply, sequence, busy, "busy-parallel": busyParallel, delegate, routine, upload, page, failover, cancel, reconnect, restart, concurrent,
};

