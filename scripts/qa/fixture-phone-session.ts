// Fixture phone session for the mobile conversation path (M-1 to M-4, #5534).
// Disposable fake-engine server, one paired phone session, loopback only.
//
//   node --experimental-strip-types scripts/qa/fixture-phone-session.ts
//   pnpm exec vitest run scripts/qa/fixture-phone-session.test.ts
//
// Writes a JSON report under tmp (or --out PATH). Exits non-zero when any
// sub-case fails. No real phone, no real network, no person's data.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { launchVerificationServer, type VerificationServer } from "../control-omb.ts";
import { openSse, type SseRecorder } from "../../server/testing/sse.ts";

export type CaseId = "M-1" | "M-2" | "M-3" | "M-4";

export type CaseResult = {
  id: CaseId;
  ok: boolean;
  detail: string;
  evidence?: unknown;
};

export type FixturePhoneReport = {
  ok: boolean;
  at: string;
  fixture: { url: string; dataDir: string; logPath: string; pid: number };
  device: string;
  cases: CaseResult[];
};

const DEVICE = "fixture-phone";
const CHOICE_MARKER = "PHONE_CHOICE";
const CHOICE_QUESTION = "Which fixture color?";
const CHOICE_OPTIONS = ["Azure", "Coral", "Moss"] as const;
const CHOICE_PICK = CHOICE_OPTIONS[0];
const LONG_MARKER = "LONG_REPLY_PLEASE";
const LONG_LINK = "https://example.test/fixture-phone-long-reply";
const LONG_REPLY = [
  "Fixture long reply for the phone session.",
  "",
  ...Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: the phone keeps this turn in view while more lines arrive.`),
  "",
  `Open the docs at ${LONG_LINK} when you need the recipe.`,
  "The last line stays the anchor the phone scrolls to on arrival.",
].join("\n");

type Api = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;

function phoneHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-openmausbot-companion": "1",
    "x-openmausbot-companion-device": DEVICE,
  };
}

async function poll<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (ok(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${what}; last=${JSON.stringify(last)?.slice(0, 800)}`);
}

async function idle(api: Api, botId: string, timeoutMs = 30_000): Promise<void> {
  await poll(
    async () => (await api("GET", "/api/bots?messages=0")).body.bots.find((bot: { id: string }) => bot.id === botId),
    (bot) => bot?.busy === false,
    `bot ${botId} idle`,
    timeoutMs,
  );
}

async function messages(api: Api, threadId: string, headers?: Record<string, string>): Promise<any[]> {
  const page = await api("GET", `/api/threads/${threadId}/messages?limit=100`, undefined, headers);
  if (page.status !== 200) throw new Error(`messages ${threadId}: ${page.status} ${JSON.stringify(page.body)}`);
  return Array.isArray(page.body) ? page.body : page.body.messages ?? [];
}

async function runM1(api: Api, bot: { id: string; threadId: string }, token: string): Promise<CaseResult> {
  const text = "M1_PROBE fixture phone send";
  const before = await messages(api, bot.threadId, phoneHeaders(token));
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, phoneHeaders(token));
  if (sent.status !== 202) {
    return { id: "M-1", ok: false, detail: `send refused: ${sent.status} ${JSON.stringify(sent.body)}` };
  }
  await idle(api, bot.id);
  const after = await messages(api, bot.threadId, phoneHeaders(token));
  const isUser = (message: any) => message.role === "user" && message.text === text;
  // Exact reply text only: digests quote the same words and must not count.
  const isReply = (message: any) => message.role === "bot" && message.text === "hello from fake claude";
  const users = after.filter(isUser);
  const replies = after.filter(isReply);
  const priorUsers = before.filter(isUser).length;
  const priorReplies = before.filter(isReply).length;
  const ok = users.length === priorUsers + 1 && replies.length === priorReplies + 1;
  return {
    id: "M-1",
    ok,
    detail: ok
      ? "one request and one complete reply on the phone session, no loss, no duplicate"
      : `expected +1 user and +1 reply; users=${users.length - priorUsers} replies=${replies.length - priorReplies}`,
    evidence: {
      userCount: users.length - priorUsers,
      replyCount: replies.length - priorReplies,
      replyPreview: replies.at(-1)?.text?.slice(0, 120),
    },
  };
}

async function runM2(api: Api, bot: { id: string; threadId: string }, token: string): Promise<CaseResult> {
  const sent = await api(
    "POST",
    `/api/bots/${bot.id}/messages`,
    { text: `${CHOICE_MARKER} please ask`, threadId: bot.threadId },
    phoneHeaders(token),
  );
  if (sent.status !== 202) {
    return { id: "M-2", ok: false, detail: `choice prompt refused: ${sent.status} ${JSON.stringify(sent.body)}` };
  }
  const card = await poll(
    async () => (await messages(api, bot.threadId, phoneHeaders(token)))
      .find((message) => message.kind === "options" && message.card?.subtitle === CHOICE_QUESTION && !message.card?.answered),
    (found) => Boolean(found),
    "choice card on the phone thread",
    45_000,
  );
  await idle(api, bot.id);
  const openCard = await poll(
    async () => (await messages(api, bot.threadId, phoneHeaders(token)))
      .find((message) => message.id === card.id),
    (found) => Boolean(found) && !found.card?.answered && !found.card?.dismissed,
    "choice card still open after the ask turn",
  );

  let answeredStatus: number;
  let answeredBody: unknown;
  if (openCard.card?.requestId) {
    const answered = await api(
      "POST",
      `/api/threads/${bot.threadId}/respond`,
      { requestId: openCard.card.requestId, behavior: "answer", message: CHOICE_PICK },
      phoneHeaders(token),
    );
    answeredStatus = answered.status;
    answeredBody = answered.body;
  } else {
    const settled = await api(
      "PATCH",
      `/api/bots/${bot.id}/cards/${openCard.id}`,
      { answered: CHOICE_PICK, threadId: bot.threadId },
      phoneHeaders(token),
    );
    if (settled.status !== 200) {
      return { id: "M-2", ok: false, detail: `card settle refused: ${settled.status} ${JSON.stringify(settled.body)}` };
    }
    const follow = await api(
      "POST",
      `/api/bots/${bot.id}/messages`,
      { text: CHOICE_PICK, threadId: bot.threadId },
      phoneHeaders(token),
    );
    answeredStatus = follow.status;
    answeredBody = follow.body;
  }
  if (answeredStatus !== 200 && answeredStatus !== 202) {
    return { id: "M-2", ok: false, detail: `choice answer refused: ${answeredStatus} ${JSON.stringify(answeredBody)}` };
  }
  await idle(api, bot.id, 45_000);
  const settled = await poll(
    async () => (await messages(api, bot.threadId, phoneHeaders(token))).find((message) => message.id === openCard.id),
    (found) => Boolean(found?.card?.answered),
    "choice card settled as the picked option",
  );
  const pick = settled.card?.answeredText ?? settled.card?.answered;
  const asChoice = pick === CHOICE_PICK || pick === "answer";
  const userPick = (await messages(api, bot.threadId, phoneHeaders(token)))
    .some((message) => message.role === "user" && String(message.text ?? "").includes(CHOICE_PICK));
  const ok = asChoice && (pick === CHOICE_PICK || userPick);
  return {
    id: "M-2",
    ok,
    detail: ok
      ? `phone answered the choice as ${CHOICE_PICK}, not free text`
      : `card answered=${JSON.stringify(pick)} userPick=${userPick}`,
    evidence: {
      requestId: openCard.card?.requestId ?? null,
      options: openCard.card?.options,
      answered: pick,
      userPick,
    },
  };
}

async function runM3(
  api: Api,
  bot: { id: string; threadId: string },
  token: string,
  stream: SseRecorder,
): Promise<CaseResult> {
  const created = await api("POST", "/api/routines", {
    name: "Fixture phone brief",
    prompt: "Report the fixture phone routine state.",
    botId: bot.id,
    enabled: false,
    postResults: true,
    schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
  });
  if (created.status !== 201) {
    return { id: "M-3", ok: false, detail: `routine create refused: ${created.status} ${JSON.stringify(created.body)}` };
  }
  const routineId = created.body.routine.id as string;
  const launched = await api("POST", `/api/routines/${routineId}/run`);
  if (launched.status !== 201) {
    return { id: "M-3", ok: false, detail: `routine run refused: ${launched.status} ${JSON.stringify(launched.body)}` };
  }
  const runId = launched.body.run.id as string;
  const finished = await poll(
    async () => (await api("GET", "/api/routines")).body.runs.find((run: { id: string }) => run.id === runId),
    (run) => run?.status === "completed" && Boolean(run.threadId) && Boolean(run.resultsThreadId),
    "routine run completed with report thread",
    60_000,
  );
  const notice = await stream.until(
    (frame) => frame?.kind === "notify"
      && frame.notification?.kind === "done"
      && frame.notification?.routineRunId === runId,
    30_000,
  ).catch(() => null);
  if (!notice) {
    return {
      id: "M-3",
      ok: false,
      detail: `no done notification for routine run ${runId}; saw=${stream.frames.map((f) => f?.kind).join(",")}`,
      evidence: { run: finished },
    };
  }
  const openThreadId = notice.notification.threadId as string;
  const main = finished.resultsThreadId as string;
  const execution = finished.threadId as string;
  if (openThreadId !== main) {
    return {
      id: "M-3",
      ok: false,
      detail: `notification opened ${openThreadId}, expected main chat ${main} (not execution ${execution})`,
      evidence: { notification: notice.notification, run: finished },
    };
  }
  const page = await messages(api, openThreadId, phoneHeaders(token));
  const receipt = page.find((message) => message.kind === "routine.run" && message.routineRun?.runId === runId);
  const ok = Boolean(receipt)
    && receipt.routineRun?.executionThreadId === execution
    && openThreadId !== execution;
  return {
    id: "M-3",
    ok,
    detail: ok
      ? "done notification opens the main chat on the run's receipt, not a side panel or the wrong thread"
      : `receipt missing or mismatched; executionThreadId=${receipt?.routineRun?.executionThreadId}`,
    evidence: {
      notificationThreadId: openThreadId,
      resultsThreadId: main,
      executionThreadId: execution,
      routineName: notice.notification.routineName,
      receiptStatus: receipt?.routineRun?.status,
    },
  };
}

async function runM4(api: Api, bot: { id: string; threadId: string }, token: string, fixture: VerificationServer): Promise<CaseResult> {
  const wrapper = join(fixture.info.dataDir, "fixture-phone-long.mjs");
  // Clear the shared reply counter: earlier turns already advanced it, and a
  // one-shot REPLIES list must start at index 0 for this long reply.
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    `process.env.FAKE_CLAUDE_TOOL_CALLS = "[]";`,
    `delete process.env.FAKE_CLAUDE_REPLY_STATE;`,
    `process.env.FAKE_CLAUDE_REPLIES = ${JSON.stringify(JSON.stringify([LONG_REPLY]))};`,
    `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
  ].join("\n"), { mode: 0o700 });
  const patched = await api("PATCH", "/api/instances/claude", { cli: wrapper });
  if (patched.status !== 200) {
    return { id: "M-4", ok: false, detail: `long-reply wrapper refused: ${patched.status} ${JSON.stringify(patched.body)}` };
  }

  const sent = await api(
    "POST",
    `/api/bots/${bot.id}/messages`,
    { text: LONG_MARKER, threadId: bot.threadId },
    phoneHeaders(token),
  );
  if (sent.status !== 202) {
    return { id: "M-4", ok: false, detail: `long send refused: ${sent.status} ${JSON.stringify(sent.body)}` };
  }
  await idle(api, bot.id, 45_000);
  const page = await messages(api, bot.threadId, phoneHeaders(token));
  // Digests quote the start of the reply; require the link so we keep the real row.
  const reply = [...page].reverse().find((message) =>
    message.role === "bot"
    && typeof message.text === "string"
    && message.text.includes(LONG_LINK)
    && !String(message.text).startsWith("[digest]"));
  if (!reply) {
    return {
      id: "M-4",
      ok: false,
      detail: "long reply missing from the phone thread payload",
      evidence: {
        roles: page.map((m) => [m.role, m.kind ?? "", String(m.text ?? "").slice(0, 60), String(m.text ?? "").length]),
      },
    };
  }
  const text = String(reply.text);
  const hasLink = text.includes(LONG_LINK);
  const longEnough = text.length >= LONG_REPLY.length - 20;
  const anchorLine = "The last line stays the anchor the phone scrolls to on arrival.";
  const anchor = text.includes(anchorLine);
  // Newest bot content row may be followed by a digest; the long reply must still
  // be the latest non-digest bot text the phone would scroll to.
  const newestContent = [...page].reverse().find((message) =>
    message.role === "bot"
    && typeof message.text === "string"
    && message.text.trim()
    && !String(message.text).startsWith("[digest]"));
  const present = Boolean(reply.id) && newestContent?.id === reply.id;
  const ok = hasLink && longEnough && anchor && present;
  return {
    id: "M-4",
    ok,
    detail: ok
      ? "long reply present in the phone payload, anchored as the newest content row, with its link"
      : `hasLink=${hasLink} longEnough=${longEnough} anchor=${anchor} present=${present} len=${text.length}`,
    evidence: {
      messageId: reply.id,
      length: text.length,
      link: LONG_LINK,
      newestContentId: newestContent?.id,
      preview: text.slice(0, 80),
      tail: text.slice(-80),
    },
  };
}

export async function runFixturePhoneSession(options: { reportPath?: string } = {}): Promise<FixturePhoneReport> {
  const replyState = join(mkdtempSync(join(tmpdir(), "omb-fixture-phone-")), "reply-state");
  writeFileSync(replyState, "0");
  const fixture = await launchVerificationServer({
    FAKE_CLAUDE_TOOL_CALLS: "[]",
    FAKE_CLAUDE_REPLY_STATE: replyState,
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
      {
        server: "agents",
        tool: "ask_choice",
        when: CHOICE_MARKER,
        arguments: {
          title: "Fixture color",
          question: CHOICE_QUESTION,
          options: [...CHOICE_OPTIONS],
          wait: false,
          decision: true,
          key: "fixture-phone-color",
        },
      },
    ]),
  });

  const api: Api = async (method, path, body, headers = {}) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: fixture.info.url,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: response.status, body: parsed };
  };

  let stream: SseRecorder | undefined;
  const cases: CaseResult[] = [];
  try {
    const invitation = await api("POST", "/api/auth/pairing", { label: "Fixture phone", scopes: ["client", "admin"] });
    if (invitation.status !== 200) throw new Error(`pairing open failed: ${invitation.status}`);
    const paired = await api("POST", "/api/auth/pair", { code: invitation.body.code, label: DEVICE });
    if (paired.status !== 200 || !paired.body.token) throw new Error(`pair failed: ${paired.status}`);
    const token = paired.body.token as string;

    const created = await api("POST", "/api/bots", {
      name: "Fixture Phone Bot",
      modelSelection: { instanceId: "claude", model: "claude-sonnet-4-5" },
    });
    if (created.status !== 200 && created.status !== 201) throw new Error(`bot create failed: ${created.status}`);
    const bot = created.body.bot as { id: string; threadId: string };
    const notify = await api("PATCH", `/api/bots/${bot.id}`, { notifications: true, computer: "off", browser: false });
    if (notify.status !== 200) throw new Error(`bot notify patch failed: ${notify.status}`);

    stream = await openSse(`${fixture.info.url}/api/events`, {
      origin: fixture.info.url,
      ...phoneHeaders(token),
    });

    cases.push(await runM1(api, bot, token));
    cases.push(await runM2(api, bot, token));
    cases.push(await runM3(api, bot, token, stream));
    cases.push(await runM4(api, bot, token, fixture));

    const report: FixturePhoneReport = {
      ok: cases.every((entry) => entry.ok),
      at: new Date().toISOString(),
      fixture: {
        url: fixture.info.url,
        dataDir: fixture.info.dataDir,
        logPath: fixture.info.logPath,
        pid: fixture.info.pid,
      },
      device: DEVICE,
      cases,
    };
    const reportPath = options.reportPath ?? join(tmpdir(), `fixture-phone-session-${Date.now()}-${process.pid}.json`);
    writeFileSync(reportPath, JSON.stringify({ ...report, reportPath }, null, 2));
    console.info(JSON.stringify({ ok: report.ok, reportPath, cases: report.cases.map((entry) => ({ id: entry.id, ok: entry.ok })) }));
    return report;
  } finally {
    stream?.close();
    await fixture.close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href
  || process.argv[1]?.endsWith("fixture-phone-session.ts");

if (isMain) {
  const outFlag = process.argv.indexOf("--out");
  const reportPath = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
  runFixturePhoneSession({ reportPath }).then((report) => {
    process.exitCode = report.ok ? 0 : 1;
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
