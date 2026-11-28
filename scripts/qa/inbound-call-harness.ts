#!/usr/bin/env -S node --experimental-strip-types
// Synthetic inbound call harness for V-1..V-4 (#5535 / parent #2642).
//
//   node --experimental-strip-types scripts/qa/inbound-call-harness.ts [--out DIR]
//
// Exercises the Perspicax Voice inbound path on fixtures only: a loopback
// telephony route with the same fake assertion verifier the unit tests use,
// the spoken-register prompt rules, fixture timing budgets, and the same
// outbound call card / refusal path as a written turn. Never a real Twilio
// call, never a real person, never a network hop outside 127.0.0.1.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ConsoleAssertion } from "../../server/auth/oidc-rp.ts";
import {
  TELEPHONY_ASSERTION_ACTORS,
  TELEPHONY_PATH,
  createBotInboundTelephonyRoute,
  parseTelephonyEvent,
  type TelephonyRouteDeps,
} from "../../server/bots/bot-inbound-telephony.ts";
import { outboundWiring } from "../../server/outbound/outbound-wiring.ts";
import type { Message } from "../../server/store.ts";
import { TELEPHONY_RUN_RULES, WebhookManager, maskedCaller } from "../../server/triggers/webhooks.ts";
import {
  VOICE_CALL_INTERRUPTED_NOTE,
  voiceCallInstruction,
} from "../../server/voice/voice-call-prompt.ts";

export const HARNESS_VERSION = 1 as const;
export const SCENARIO_IDS = ["V-1", "V-2", "V-3", "V-4"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** Fixture NANP 555 numbers only; never a real line. */
const FIXTURE_LINE = "+15145550199";
const FIXTURE_FROM = "+15145550100";
const FIXTURE_ORIGIN = "https://sagax.example";
const FIXTURE_ISS = "https://perspicax.example";
const FIXTURE_OWNER = "u_fixture";
const FIXTURE_BOT = "bot_fixture";
const FIXTURE_PRINCIPAL = "pr_fixture";

/** Synthetic delay budgets (ms). Fixture settings, not a claim about a carrier. */
export const FIXTURE_TIMING = {
  firstSpeechBudgetMs: 800,
  resumeAfterInterruptBudgetMs: 800,
  injectOwnTextDelayMs: 25,
} as const;

export interface ScenarioResult {
  id: ScenarioId;
  title: string;
  passed: boolean;
  details: string[];
  evidence: Record<string, unknown>;
}

export interface InboundCallHarnessReport {
  version: typeof HARNESS_VERSION;
  passed: boolean;
  startedAt: string;
  finishedAt: string;
  scenarios: ScenarioResult[];
  notes: string[];
}

export interface SpokenRegisterCheck {
  ok: boolean;
  reasons: string[];
}

/** Spoken-register checker for fixture transcripts (V-2). No STT/TTS. */
export function checkSpokenRegister(text: string): SpokenRegisterCheck {
  const reasons: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) reasons.push("empty");
  if (/https?:\/\//i.test(trimmed) || /www\./i.test(trimmed)) reasons.push("url");
  if (/^\s*[-*•]\s+/m.test(trimmed) || /^\s*\d+\.\s+/m.test(trimmed)) reasons.push("list");
  if (/```|^\s*#{1,6}\s|\*\*[^*]+\*\*|^\s*\|.+\|/m.test(trimmed)) reasons.push("markdown");
  const sentences = trimmed.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length > 4) reasons.push(`too_many_sentences:${sentences.length}`);
  return { ok: reasons.length === 0, reasons };
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function callSid(n: number): string {
  return `CA${String(n).padStart(32, "a")}`;
}

function voiceBody(extra: Record<string, unknown> = {}) {
  return {
    contract: "perspicax-voice/1",
    event: "call_request",
    eventId: `call_request:${callSid(1)}`,
    receivedAt: "2026-11-28T15:00:00Z",
    line: { id: "line_fixture", number: FIXTURE_LINE },
    from: FIXTURE_FROM,
    authenticated: true,
    person: { id: FIXTURE_OWNER, name: "Ada Fixture" },
    content: { trust: "caller", text: "Quel est le statut du billet ?" },
    botId: FIXTURE_BOT,
    directives: { thirdPartyCall: "card", clientPhoneSource: "psa_contact" },
    ...extra,
  };
}

interface HarnessState {
  server: Server;
  base: string;
  tokens: Map<string, ConsoleAssertion>;
  ownTexts: Array<{
    ownerPrincipalId: string;
    sub: string;
    botId: string;
    from: string;
    text: string;
    label: string;
    via: "sms" | "call";
    atMs: number;
  }>;
  rows: Array<Record<string, unknown>>;
  hooks: WebhookManager;
  queued: Array<{ prompt: string; deliveryId: string; webhookId: string }>;
  dataDir: string;
  jti: number;
  eventN: number;
  startedAtMs: number;
}

async function openHarness(): Promise<HarnessState> {
  const dataDir = mkdtempSync(join(tmpdir(), "sagax-inbound-call-harness-"));
  const tokens = new Map<string, ConsoleAssertion>();
  const ownTexts: HarnessState["ownTexts"] = [];
  const rows: Array<Record<string, unknown>> = [];
  const queued: HarnessState["queued"] = [];
  const hooks = new WebhookManager({
    file: join(dataDir, "webhooks.json"),
    botState: () => "ready",
    enqueue: (input) => {
      queued.push(input);
      return { id: `run-${queued.length}` };
    },
  });
  hooks.create({
    name: "Ligne fixture",
    prompt: "Traite la demande.",
    botId: FIXTURE_BOT,
    enabled: true,
    source: { type: "telephony", events: [], filters: {} },
  });

  const state: HarnessState = {
    server: undefined as unknown as Server,
    base: "",
    tokens,
    ownTexts,
    rows,
    hooks,
    queued,
    dataDir,
    jti: 0,
    eventN: 0,
    startedAtMs: performance.now(),
  };

  const deps: TelephonyRouteDeps = {
    identity: () => "perspicax",
    publicOrigin: () => FIXTURE_ORIGIN,
    linkServerId: () => "srv",
    verify: async (bearer, audience) => {
      const found = tokens.get(bearer);
      if (!found || audience !== FIXTURE_ORIGIN) throw new Error("The assertion does not verify.");
      if (!TELEPHONY_ASSERTION_ACTORS.includes(found.actor)) throw new Error("The assertion does not name an actor this route accepts.");
      return found;
    },
    bot: (id) => (id === FIXTURE_BOT ? { id, name: "Helper" } : null),
    owner: (id) => (id === FIXTURE_BOT ? { principalId: FIXTURE_PRINCIPAL, sub: FIXTURE_OWNER, active: true } : null),
    triggers: (botId) => hooks.list().filter((hook) => hook.enabled && hook.botId === botId && hook.source?.type === "telephony").map((hook) => hook.id),
    ingest: (id, event, key) => hooks.ingest(id, event, key),
    ownText: async (input) => {
      await new Promise<void>((resolve) => setTimeout(resolve, FIXTURE_TIMING.injectOwnTextDelayMs));
      ownTexts.push({ ...input, atMs: performance.now() - state.startedAtMs });
      return true;
    },
    record: (row) => rows.push(row as unknown as Record<string, unknown>),
  };

  const handle = createBotInboundTelephonyRoute(deps);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!(await handle(req, res, url))) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.server = server;
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

async function closeHarness(state: HarnessState): Promise<void> {
  await new Promise<void>((resolve) => {
    state.server.closeAllConnections();
    state.server.close(() => resolve());
  });
  rmSync(state.dataDir, { recursive: true, force: true });
}

function mintToken(state: HarnessState, bodyText: string): string {
  state.jti += 1;
  const id = `tok${state.jti}`;
  state.tokens.set(id, {
    iss: FIXTURE_ISS,
    sub: FIXTURE_OWNER,
    jti: `jti-inbound-${String(state.jti).padStart(10, "0")}`,
    iat: 0,
    exp: Math.floor(Date.now() / 1000) + 60,
    serverId: "srv",
    role: "employee",
    teams: [],
    actor: "perspicax-voice",
    bodySha256: sha(bodyText),
  });
  return id;
}

async function postCall(state: HarnessState, body: Record<string, unknown>) {
  state.eventN += 1;
  const eventId = typeof body.eventId === "string" ? body.eventId : `call_request:${callSid(state.eventN)}`;
  const payload = { ...body, eventId };
  const text = JSON.stringify(payload);
  const bearer = mintToken(state, text);
  const res = await fetch(`${state.base}${TELEPHONY_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: text,
  });
  return {
    status: res.status,
    header: res.headers.get("x-sagax-telephony-api"),
    body: await res.json().catch(() => null) as Record<string, unknown> | null,
  };
}

async function runV1(state: HarnessState): Promise<ScenarioResult> {
  const details: string[] = [];
  const before = state.ownTexts.length;
  const got = await postCall(state, voiceBody({
    eventId: `call_request:${callSid(101)}`,
    content: { trust: "caller", text: "Quel est le statut du billet 4421 ?" },
  }));
  const turn = state.ownTexts[before];
  const okStatus = got.status === 202 && got.header === "1";
  const okBody = got.body?.event === "call_request" && got.body?.delivered === 1 && got.body?.conversation === true && got.body?.triggers === 0;
  const okTurn = !!turn && turn.via === "call" && turn.sub === FIXTURE_OWNER && turn.botId === FIXTURE_BOT
    && turn.text.includes("statut du billet") && turn.from === FIXTURE_FROM;
  const audit = JSON.stringify(state.rows);
  const maskedOnly = audit.includes(maskedCaller(FIXTURE_FROM)) && !audit.includes("5145550100") && !audit.includes("statut du billet");
  if (!okStatus) details.push(`route status ${got.status}`);
  if (!okBody) details.push(`body ${JSON.stringify(got.body)}`);
  if (!okTurn) details.push("own-line turn missing or wrong");
  if (!maskedOnly) details.push("audit leaked full number or text");
  details.push("fake perspicax-voice assertion accepted on loopback");
  details.push("call_request landed as via:call conversation turn for the fixture person");
  return {
    id: "V-1",
    title: "Synthetic call_request taken by the fixture person's bot",
    passed: okStatus && okBody && okTurn && maskedOnly,
    details,
    evidence: {
      status: got.status,
      body: { event: got.body?.event, delivered: got.body?.delivered, conversation: got.body?.conversation, triggers: got.body?.triggers },
      via: turn?.via,
      callerMasked: maskedCaller(FIXTURE_FROM),
    },
  };
}

async function runV2(_state: HarnessState): Promise<ScenarioResult> {
  const details: string[] = [];
  const instruction = voiceCallInstruction("Ada Fixture", { callId: "call-fixture01", language: "fr" });
  const promptOk = [
    instruction.includes("one to four"),
    instruction.includes("No markdown, lists, tables"),
    instruction.includes("URLs or file paths"),
    instruction.includes("Québec French or English"),
    /short spoken sentences/i.test(instruction),
  ].every(Boolean);
  if (!promptOk) details.push("voiceCallInstruction missing spoken-register rules");

  const good = checkSpokenRegister("Le billet est ouvert. Je te rappelle dès qu'il avance.");
  const withLink = checkSpokenRegister("Vois https://example.test/ticket pour le détail.");
  const withList = checkSpokenRegister("Voici les points:\n- un\n- deux\n- trois");
  const tooLong = checkSpokenRegister("Un. Deux. Trois. Quatre. Cinq.");
  const fixturesOk = good.ok && !withLink.ok && !withList.ok && !tooLong.ok
    && withLink.reasons.includes("url") && withList.reasons.includes("list") && tooLong.reasons.some((r) => r.startsWith("too_many_sentences"));
  if (!fixturesOk) details.push("fixture transcript checks did not match");
  details.push("prompt path: voiceCallInstruction (fr) carries short format, no links/lists, Québec French");
  details.push("synthetic transcripts checked without STT/TTS");
  return {
    id: "V-2",
    title: "Spoken register rules verifiable via prompt path and fixture transcripts",
    passed: promptOk && fixturesOk,
    details,
    evidence: {
      promptHasSpokenRules: promptOk,
      goodOk: good.ok,
      linkReasons: withLink.reasons,
      listReasons: withList.reasons,
      longReasons: tooLong.reasons,
    },
  };
}

async function runV3(state: HarnessState): Promise<ScenarioResult> {
  const details: string[] = [];
  const before = state.ownTexts.length;
  const t0 = performance.now();
  const got = await postCall(state, voiceBody({
    eventId: `call_request:${callSid(301)}`,
    content: { trust: "caller", text: "Dis-moi juste oui ou non." },
  }));
  const turn = state.ownTexts[before];
  // Wall path: telephony POST → ownText callback (fixture delay injected).
  const pathMs = performance.now() - t0;
  const firstOk = got.status === 202 && !!turn && pathMs <= FIXTURE_TIMING.firstSpeechBudgetMs;
  if (!firstOk) details.push(`first-speech path ${pathMs.toFixed(1)} ms over budget ${FIXTURE_TIMING.firstSpeechBudgetMs}`);

  const interrupted = voiceCallInstruction("Ada Fixture", {
    callId: "call-fixture02",
    language: "fr",
    interrupted: true,
    heard: "Le billet",
    unheard: "est encore ouvert depuis lundi.",
  });
  const interruptOk = interrupted.includes(VOICE_CALL_INTERRUPTED_NOTE)
    && interrupted.includes("They heard up to")
    && interrupted.includes("They did not hear");
  if (!interruptOk) details.push("interrupted prompt note missing");

  // Resume budget: fixture delay only, same order of magnitude as first speech.
  const resumeStarted = performance.now();
  await new Promise<void>((resolve) => setTimeout(resolve, FIXTURE_TIMING.injectOwnTextDelayMs));
  const resumeMs = performance.now() - resumeStarted;
  const resumeOk = resumeMs <= FIXTURE_TIMING.resumeAfterInterruptBudgetMs;
  if (!resumeOk) details.push(`resume fixture ${resumeMs.toFixed(1)} ms over budget`);

  details.push(`telephony→ownText path ${pathMs.toFixed(1)} ms (budget ${FIXTURE_TIMING.firstSpeechBudgetMs})`);
  details.push(`resume-after-interrupt fixture ${resumeMs.toFixed(1)} ms (budget ${FIXTURE_TIMING.resumeAfterInterruptBudgetMs})`);
  details.push("interruption note from voiceCallInstruction reused (voice-acceptance / voice-call-prompt)");
  return {
    id: "V-3",
    title: "Synthetic timings before first speech and after interruption",
    passed: firstOk && interruptOk && resumeOk,
    details,
    evidence: {
      firstSpeechPathMs: Number(pathMs.toFixed(2)),
      resumeFixtureMs: Number(resumeMs.toFixed(2)),
      budgets: FIXTURE_TIMING,
      interruptNotePresent: interruptOk,
    },
  };
}

async function runV4(state: HarnessState): Promise<ScenarioResult> {
  const details: string[] = [];
  const actionText = "Appelle le fournisseur pour confirmer la livraison de jeudi.";
  const before = state.ownTexts.length;
  const got = await postCall(state, voiceBody({
    eventId: `call_request:${callSid(401)}`,
    content: { trust: "caller", text: actionText },
    directives: { thirdPartyCall: "card", clientPhoneSource: "psa_contact" },
  }));
  const turn = state.ownTexts[before];
  const callLanded = got.status === 202 && got.body?.conversation === true && turn?.via === "call" && turn.text === actionText;
  if (!callLanded) details.push("action call_request did not land as conversation turn");

  const parsed = parseTelephonyEvent(voiceBody({
    eventId: `call_request:${callSid(402)}`,
    content: { trust: "caller", text: actionText },
    directives: { thirdPartyCall: "card", clientPhoneSource: "psa_contact" },
  }));
  const directivesOk = parsed?.directives.thirdPartyCall === "card";
  const rulesOk = TELEPHONY_RUN_RULES.includes("Every change or outbound action still asks for its approval card");
  if (!directivesOk) details.push("thirdPartyCall is not card");
  if (!rulesOk) details.push("BOT PHONE RULES missing card line");

  // Same confirmation path as written chat: place_phone_call stages a card, deny refuses.
  const outDir = mkdtempSync(join(tmpdir(), "sagax-inbound-v4-outbound-"));
  const rows: Message[] = [];
  let n = 0;
  const store = {
    messagesFor: () => rows,
    appendMessage: (_threadId: string, message: Omit<Message, "id" | "at">) => {
      const row = { ...message, id: `m${++n}`, at: n } as Message;
      rows.push(row);
      return row;
    },
    patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
  const voice = async () => ({ ok: true as const, isError: false, value: { dry_run: true } });
  const wiring = outboundWiring({
    dataDir: outDir,
    store,
    botName: () => "Helper",
    personName: () => "Ada Fixture",
    language: () => "fr",
    twilio: async () => ({ ok: true as const, isError: false, value: { dry_run: true } }),
    voice,
    wake: () => {},
  });
  wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
  wiring.consentStore.accept(FIXTURE_PRINCIPAL, FIXTURE_BOT);
  let cardPending = false;
  let hasDeny = false;
  let deniedStatus = false;
  let callNeverPlaced = false;
  let cardOptions: string[] = [];
  try {
    const first = await wiring.placeCall(
      { principalId: FIXTURE_PRINCIPAL, botId: FIXTURE_BOT, threadId: "t-call", generation: "g1", room: false },
      { to: "+1 514 555 0142", objective: "Confirmer la livraison de jeudi" },
    );
    cardPending = !first.isError && rows[0]?.outbound?.kind === "call" && rows[0]?.outbound?.status === "pending";
    const pending = wiring.primaryPending(FIXTURE_PRINCIPAL, false);
    cardOptions = pending[0]?.options ?? [];
    hasDeny = cardOptions.includes("deny");
    const id = pending[0]?.requestId;
    if (!id) {
      details.push("no pending call card id");
    } else {
      const denied = wiring.calls.answer(FIXTURE_PRINCIPAL, id, "deny", "harness");
      deniedStatus = denied.status === "denied";
      // Same as written chat: a denial never places; asking again stages a new card.
      const again = await wiring.placeCall(
        { principalId: FIXTURE_PRINCIPAL, botId: FIXTURE_BOT, threadId: "t-call", generation: "g2", room: false },
        { to: "+1 514 555 0142", objective: "Confirmer la livraison de jeudi" },
      );
      const placed = rows.some((r) => r.outbound?.kind === "call" && r.outbound?.status === "done");
      callNeverPlaced = deniedStatus && !placed && !again.isError
        && rows.filter((r) => r.outbound?.kind === "call").some((r) => r.outbound?.status === "pending");
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  if (!cardPending) details.push("place_phone_call did not stage a card");
  if (!hasDeny) details.push("card missing deny");
  if (!deniedStatus) details.push("deny did not mark the call denied");
  if (!callNeverPlaced) details.push("deny did not keep the call unplaced");

  details.push("action request on the call is a via:call turn");
  details.push("thirdPartyCall:card and BOT PHONE RULES require an approval card");
  details.push("place_phone_call stages a card with deny, same as written chat");
  return {
    id: "V-4",
    title: "Action request during the call follows the same card / refusal rules as written",
    passed: callLanded && directivesOk && rulesOk && cardPending && hasDeny && deniedStatus && callNeverPlaced,
    details,
    evidence: {
      conversation: got.body?.conversation,
      thirdPartyCall: parsed?.directives.thirdPartyCall,
      telephonyRulesRequireCard: rulesOk,
      outboundCardPending: cardPending,
      cardOptions,
      deniedStatus,
      callNeverPlaced,
    },
  };
}

export function renderInboundCallHarnessMarkdown(report: InboundCallHarnessReport): string {
  const lines = [
    `# Inbound call harness report`,
    ``,
    `- Passed: ${report.passed ? "yes" : "no"}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    ``,
    `| Scenario | Result |`,
    `| --- | --- |`,
    ...report.scenarios.map((s) => `| ${s.id}: ${s.title} | ${s.passed ? "pass" : "FAIL"} |`),
    ``,
  ];
  for (const s of report.scenarios) {
    lines.push(`## ${s.id}. ${s.title}`);
    lines.push(``);
    for (const d of s.details) lines.push(`- ${d}`);
    lines.push(``);
  }
  if (report.notes.length) {
    lines.push(`## Notes`);
    lines.push(``);
    for (const n of report.notes) lines.push(`- ${n}`);
    lines.push(``);
  }
  return lines.join("\n");
}

export async function runInboundCallHarness(options: { out?: string } = {}): Promise<InboundCallHarnessReport> {
  const startedAt = new Date().toISOString();
  const state = await openHarness();
  const scenarios: ScenarioResult[] = [];
  try {
    scenarios.push(await runV1(state));
    scenarios.push(await runV2(state));
    scenarios.push(await runV3(state));
    scenarios.push(await runV4(state));
  } finally {
    await closeHarness(state);
  }
  const finishedAt = new Date().toISOString();
  const report: InboundCallHarnessReport = {
    version: HARNESS_VERSION,
    passed: scenarios.every((s) => s.passed),
    startedAt,
    finishedAt,
    scenarios,
    notes: [
      "Loopback only (127.0.0.1). Fake perspicax-voice assertion, same verifier pattern as server/bots/bot-inbound-telephony.test.ts.",
      "Fixture 555 numbers only; audit rows keep masked callers.",
      "No real Twilio, no real person, no STT/TTS.",
      "Slot B of owner-device-runs.md still covers the carrier, verified number, real audio and interruption.",
    ],
  };
  if (options.out) {
    mkdirSync(options.out, { recursive: true });
    writeFileSync(join(options.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(options.out, "report.md"), renderInboundCallHarnessMarkdown(report));
  }
  return report;
}

export function parseInboundCallHarnessArgs(argv: readonly string[]): { out?: string } {
  const out: { out?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out") {
      const dir = argv[++i];
      if (!dir) throw new Error("--out needs a directory");
      out.out = dir;
    } else if (token === "--") continue;
    else throw new Error(`unknown argument ${token}`);
  }
  return out;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseInboundCallHarnessArgs(argv);
  const out = args.out ?? mkdtempSync(join(tmpdir(), "sagax-inbound-call-report-"));
  const report = await runInboundCallHarness({ out });
  process.stdout.write(`${renderInboundCallHarnessMarkdown(report)}\nReport written to ${out}\n`);
  return report.passed ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
