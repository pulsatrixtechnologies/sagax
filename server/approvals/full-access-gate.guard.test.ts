// Structural guard (#1905, 2026-11-02): every code path that can put an
// approval or a choice card between the bot and the person reads the one
// Full access decision (server/approvals/full-access-gate.ts), and says so with a
// marker comment on the line that emits the card. A new surface without a
// marker, a marker naming no registered surface, a registered surface whose
// deciding file stopped reading the gate, or a registered surface nothing
// emits any more, each fails here. Runs with the merge gate on every PR.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { FULL_ACCESS_MARKER, FULL_ACCESS_SURFACES, type FullAccessSurface } from "./full-access-gate.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const SERVER = join(ROOT, "server");

/** A source file as the rule reads it on every platform: a Windows checkout
 * hands the scan CRLF lines, which no line pattern below expects. */
const readText = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
/** A repository path with "/" on every platform, as DECIDED_IN names it. */
const repoPath = (path: string): string => relative(ROOT, path).split(sep).join("/");

/** What emits a card or a permission request the person may have to answer. */
const EMITTERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // a card row appended to a conversation (an object literal, never a type)
  { name: "options card", pattern: /\bkind: "options",/ },
  // an engine bridge emitting a permission request into the fold
  { name: "permission request", pattern: /\brequestType: "permission"(?!\s*\|)/ },
  // the peer contact card
  { name: "peer card", pattern: /\brequestPeerApproval\(/ },
  // the safety review's hold on a permission request, or before a tool runs
  { name: "safety review", pattern: /\bsafety(?:PermissionEffect|ToolHold)\(/ },
  // the Sagax ask_choice card
  { name: "ask_choice card", pattern: /\bcreateChoiceCard\(/ },
  // #3502: the held card of the person's own browser (My Chrome)
  { name: "browser held card", pattern: /\bdeps\.confirm\(/ },
];

/** Where each surface's decision lives: that file must import the gate
 * module and read it. An engine bridge only emits (request.opened judges
 * it); an exempt card blocks nothing. */
const DECIDED_IN: Record<FullAccessSurface, string | null> = {
  // #1388: request.opened (tool-approval / question) lives in runtime-events/
  // The card and the Full access choice answer moved with the present split.
  "tool-approval": "server/runtime-events/request-opened-present.ts",
  "question": "server/runtime-events/request-opened-present.ts",
  // #3508: the server's own connector request is judged where every
  // request.opened is (the Full access decision is read there)
  "connector-held": "server/runtime-events/request-opened.ts",
  "safety-review": "server/safety/safety-review.ts",
  // safety-confirm card is in index-leaves/confirmHeldCard.ts; Full access is
  // still wired from index.ts via setSafetyFullAccess (central, like send)
  "safety-confirm": "server/index.ts",
  "ask-choice": "server/widgets/chat-widgets.ts",
  "browser-held": "server/browser/my-chrome/pilot.ts",
  "peer-contact": "server/index.ts",
  "proposal": "server/index.ts",
  "send": "server/index.ts",
  // retired (#1982): chat-completions no longer decides at Full; its MCP
  // asks are engine-bridge and request.opened judges them.
  "chat-engine": null,
  "engine-bridge": null,
  "isolation": null,
  "exempt": null,
};

const SKIP = /\.(?:test|e2e)\.ts$|\.d\.ts$|\/testing\//;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "testing" || entry === "self-knowledge") continue;
    if (statSync(path).isDirectory()) { yield* sourceFiles(path); continue; }
    if (!path.endsWith(".ts") || SKIP.test(repoPath(path))) continue;
    yield path;
  }
}

interface Hit { file: string; line: number; emitter: string; text: string; marker?: string }

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(SERVER)) {
    const lines = readText(file).split("\n");
    lines.forEach((text, index) => {
      // a definition, a type member, a deps method signature or a comment is not an emitter
      if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(text)) return;
      if (/^\s*(?:readonly\s+)?\w+\??: .*;\s*$/.test(text) && !/\(/.test(text)) return;
      if (/^\s*(?:readonly\s+)?\w+\??\(\w+\??:\s/.test(text)) return;
      if (/^\s*(?:\/\/|\*)/.test(text)) return;
      // a leaf host accessor that only forwards a binding (#2440), not a call
      if (/^\s*get \w+\(\) \{ return \w+; \},?\s*$/.test(text)) return;
      for (const emitter of EMITTERS) {
        if (!emitter.pattern.test(text)) continue;
        // the marker on the line itself or the three lines above it
        const window = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
        const marker = FULL_ACCESS_MARKER.exec(window)?.[1];
        hits.push({ file: repoPath(file), line: index + 1, emitter: emitter.name, text: text.trim(), ...(marker ? { marker } : {}) });
      }
    });
  }
  return hits;
}

const hits = scan();
const describeHit = (hit: Hit) => `${hit.file}:${hit.line} (${hit.emitter}): ${hit.text.slice(0, 100)}`;

describe("every approval or choice card reads the Full access decision", () => {
  it("finds the surfaces at all (the scan is not empty)", () => {
    expect(hits.length).toBeGreaterThan(20);
    // #1388: options cards that lived in index.ts now emit from request.opened
    // and index-leaves (confirmHeldCard, send, proposal, …)
    expect(hits.some((hit) => hit.file === "server/runtime-events/request-opened-present.ts" && hit.emitter === "options card")).toBe(true);
    expect(hits.some((hit) => hit.file.startsWith("server/index-leaves/") && hit.emitter === "options card")).toBe(true);
    expect(hits.some((hit) => hit.file === "server/widgets/chat-widgets.ts")).toBe(true);
    expect(hits.some((hit) => hit.file === "server/drivers/openai-chat-turn.ts" && hit.emitter === "permission request")).toBe(true);
  });

  it("carries a marker naming a registered surface on each emitter", () => {
    const unmarked = hits.filter((hit) => !hit.marker).map(describeHit);
    expect(unmarked, "an approval or choice card with no `// full-access: <surface>` marker: register it in FULL_ACCESS_SURFACES and read the gate").toEqual([]);
    const unknown = hits.filter((hit) => hit.marker && !(hit.marker in FULL_ACCESS_SURFACES)).map((hit) => `${describeHit(hit)} marker ${hit.marker}`);
    expect(unknown, "a marker that names no surface of FULL_ACCESS_SURFACES").toEqual([]);
  });

  it("every registered surface is emitted somewhere, so the registry never lists a phantom", () => {
    const emitted = new Set(hits.map((hit) => hit.marker));
    // chat-engine is registered only so an old marker still passes (#1982)
    const retired = new Set<FullAccessSurface>(["chat-engine"]);
    const missing = (Object.keys(FULL_ACCESS_SURFACES) as FullAccessSurface[]).filter((id) => !emitted.has(id) && !retired.has(id));
    expect(missing).toEqual([]);
  });

  it("the file that decides each surface imports the gate and reads its decision", () => {
    const gateImport = /from "(?:\.\.\/)*(?:\.\/)?(?:approvals\/)?full-access-gate\.ts"/;
    const gateCall = /\bfullAccess(?:Decision|Acts|ChoiceAnswer)\(|\bpeerContactCardRequired\(|\bsetSafetyFullAccess\(|\bfullAccessResolver\b/;
    // #1388 leaf modules read the gate through the host (host.fullAccessDecision)
    const hostGateCall = /\bhost\.fullAccess(?:Decision|Acts|ChoiceAnswer)\(/;
    for (const [surface, file] of Object.entries(DECIDED_IN) as Array<[FullAccessSurface, string | null]>) {
      if (!file) continue;
      const text = readText(join(ROOT, file));
      // the safety review carries the decision in from the gate's resolver;
      // request.opened reads it via the leaf host after #1388
      const reads = gateImport.test(text)
        || hostGateCall.test(text)
        || (surface === "safety-review" && /fullAccess\?: boolean|fullAccessResolver/.test(text));
      expect(reads, `${file} decides ${surface} but does not import full-access-gate.ts`).toBe(true);
      expect(gateCall.test(text) || hostGateCall.test(text), `${file} decides ${surface} but never reads the decision`).toBe(true);
    }
    // a surface decided and emitted in one file never sits elsewhere; the
    // central ones (decided in index.ts or the review, emitted by the
    // route modules / index-leaves) may be emitted anywhere
    const central = new Set<string>(["proposal", "peer-contact", "safety-review", "safety-confirm", "send", "engine-bridge", "connector-held", "isolation", "exempt"]);
    for (const hit of hits) {
      if (!hit.marker || central.has(hit.marker)) continue;
      const decidedIn = DECIDED_IN[hit.marker as FullAccessSurface];
      expect(hit.file, `${describeHit(hit)}: ${hit.marker} is decided in ${decidedIn}`).toBe(decidedIn);
    }
  });

  it("the one permission handler reads the decision before the safety review and before any card", () => {
    // #1388: request.opened handler lives in runtime-events/request-opened.ts
    const openedSrc = readText(join(SERVER, "runtime-events/request-opened.ts"));
    const opened = openedSrc.indexOf('case "request.opened":');
    expect(opened).toBeGreaterThan(0);
    const handler = openedSrc.slice(opened);
    expect(handler).toMatch(/const fullTurn = host\.fullAccessDecision\(effectiveApprovalMode\)/);
    expect(handler).toMatch(/fullAccess: fullTurn\.acts/);
    // The choice answer is read in the present split, before the question card.
    const presentSrc = readText(join(SERVER, "runtime-events/request-opened-present.ts"));
    const choiceAt = presentSrc.indexOf("host.fullAccessChoiceAnswer(effectiveApprovalMode");
    const questionCardAt = presentSrc.indexOf("// full-access: question");
    expect(choiceAt).toBeGreaterThan(0);
    expect(questionCardAt).toBeGreaterThan(choiceAt);
    // the level is read before the safety review runs, so the review sees it
    expect(handler.indexOf("const effectiveApprovalMode")).toBeLessThan(handler.indexOf("safetyPermissionEffect("));
    expect(handler.indexOf("const fullTurn")).toBeLessThan(handler.indexOf("safetyPermissionEffect("));
  });

  it("the browser's held card reads the decision before the card, and the route wires the level and the record (#3502)", () => {
    const pilot = readText(join(SERVER, "browser", "my-chrome", "pilot.ts"));
    const run = pilot.slice(pilot.indexOf("export async function runMyChromeTool"));
    expect(run.indexOf("myChromeLevelAnswers(read.level, read.facts)")).toBeGreaterThan(0);
    expect(run.indexOf("myChromeLevelAnswers(read.level, read.facts)")).toBeLessThan(run.indexOf("// full-access: browser-held"));
    expect(pilot).toMatch(/function myChromeLevelAnswers[\s\S]{0,200}fullAccessDecision\(level, facts\)\.acts/);
    const route = readText(join(SERVER, "routes", "internal-environments-handlers.ts"));
    expect(route).toMatch(/heldLevel: [\s\S]{0,200}deps\.myChromeHeldLevel!\(/);
    expect(route).toMatch(/answeredByLevel: [\s\S]{0,200}deps\.myChromeLevelAnswered!\(/);
    const index = readText(join(SERVER, "index.ts"));
    expect(index).toMatch(/function myChromeHeldLevel[\s\S]{0,600}approvalModeForTurn\(/);
    expect(index).toMatch(/\n    myChromeHeldLevel,\n    myChromeLevelAnswered,\n/);
  });

  it("the server's own connector request is marked and reaches the one request.opened decision (#3508)", () => {
    const held = hits.filter((hit) => hit.file === "server/harness/held-requests.ts" && hit.emitter === "permission request");
    expect(held).toHaveLength(1);
    expect(held[0]?.marker).toBe("connector-held");
    const source = readText(join(SERVER, "harness", "held-requests.ts"));
    // it is published on the bus as a request.opened, never answered where it is emitted
    expect(source).toMatch(/this\.publish\(\{[\s\S]{0,400}type: "request\.opened"/);
    expect(source).not.toMatch(/fullAccess(?:Decision|Acts)\(/);
    // and request.opened reads its connector facts into the verdict the level decides
    const opened = readText(join(SERVER, "runtime-events", "request-opened.ts"));
    expect(opened).toMatch(/const connectorRead = Boolean\(permission && event\.accountConnector === true && event\.engineConnector === true && event\.outbound !== true/);
    expect(opened).toMatch(/autoVerdict\(strictCard \|\| foreignDestination \? "ask" : effectiveApprovalMode/);
  });

  it("every peer card sits behind peerReviewRequired, which reads the gate, as do fullAccessForSource and the safety resolver", () => {
    // in every server file: the route modules emit the card the central
    // check gates (peerReviewRequired comes in through their deps)
    for (const hit of hits) {
      if (hit.emitter !== "peer card") continue;
      const lines = readText(join(ROOT, hit.file)).split("\n");
      const before = lines.slice(Math.max(0, hit.line - 41), hit.line).join("\n");
      // or the shared approval bus, whose autoApply is fullAccessForSource (checked below)
      expect(/peerReviewRequired\(/.test(before) || /requestPeerApproval\(approvalBus,/.test(lines[hit.line - 1] ?? ""), `${describeHit(hit)}: requestPeerApproval without peerReviewRequired in reach`).toBe(true);
    }
    const index = readText(join(SERVER, "index.ts"));
    expect(index).toMatch(/function peerReviewRequired[\s\S]{0,400}peerContactCardRequired\(/);
    expect(index).toMatch(/function fullAccessForSource[\s\S]{0,300}fullAccessActs\(/);
    expect(index).toMatch(/const approvalBus: ApprovalBus = \{[^}]*autoApply: fullAccessForSource/);
    expect(index).toMatch(/setSafetyFullAccess\(\(\{ botId, threadId \}\)[\s\S]{0,600}fullAccessActs\(approvalModeForTurn\(/);
    // the ask_choice route hands the turn's level to the card
    expect(index).toMatch(/createAgentCard\(\{[\s\S]{0,600}approvalLevel: sourceApprovalMode\(bot\.id, threadId\)/);
  });

  it("the shared safety review reads Full access as an allow, never a safer path or a confirmation; the verdict is read before the hold", () => {
    const shared = readText(join(ROOT, "shared", "safety-review.ts"));
    expect(shared).toMatch(/fullAccess\?: boolean/);
    expect(shared).toMatch(/if \(input\.fullAccess === true\) return verdict\("allow", "full_access"/);
    // after every block and after the triage approval, before the review steps
    expect(shared.indexOf('verdict("block", "credentials"')).toBeLessThan(shared.indexOf('"full_access", ""'));
    expect(shared.indexOf('"full_access", ""')).toBeLessThan(shared.indexOf("const next = step(memory"));
    const server = readText(join(SERVER, "safety", "safety-review.ts"));
    expect(server).toMatch(/if \(verdict\.code === "full_access"\) return null;/);
    const auto = readText(join(SERVER, "approvals", "auto-approve.ts"));
    expect(auto.indexOf("fullAccessDecision(")).toBeLessThan(auto.indexOf('source: "safety-hold"'));
    expect(auto).toMatch(/if \(context\?\.safetyHold && !full\.acts && !full\.hold\)/);
    expect(auto).toMatch(/if \(full\.acts && !\(context\?\.sagaxGate && context\.stepUpRequired\?\.length\)\)/);
  });

  it("the chat-completions engines never answer Full themselves: every MCP ask reaches request.opened (#1982)", () => {
    const chat = readText(join(SERVER, "drivers", "openai-chat-turn.ts"));
    expect(chat).not.toMatch(/fullAccessActs\(turn\.approvalMode\)/);
    expect(chat).not.toMatch(/turn\.approvalMode === "full" \|\| !shown\.ask/);
    expect(chat).toMatch(/\/\/ full-access: engine-bridge/);
  });

  it("no driver answers or holds a permission request where it emits it, except the chat engines through the decision", () => {
    // every `requestType: "permission"` an engine driver or a runner emits is a bridge
    const bridges = hits.filter((hit) => hit.emitter === "permission request" && /^server\/(?:drivers|saved-steps|runner)\//.test(hit.file));
    expect(bridges.length).toBeGreaterThan(1);
    for (const hit of bridges) expect(hit.marker ?? "none", describeHit(hit)).toMatch(/^(?:engine-bridge|chat-engine|exempt)$/);
  });
});
