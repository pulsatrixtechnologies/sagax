// A send while the bot works, routed by the bot (server/busy-routing.ts,
// shared/parallel-tasks.ts classifyBusySend): the rule's verdicts, the
// fallback classification, the routing handles and the per-resource line.
import { describe, expect, it } from "vitest";

import { classifyBusySend, isBusySendRequest, namedResources, resourcesOverlap } from "../shared/parallel-tasks.ts";
import { RoutableSteers, ROUTE_HANDLE_TTL_MS, busyClassifyPrompt, classifyWithoutSteer, orchestratedSteerText, parseBusyClassification, routeResources } from "./busy-routing.ts";
import { parallelBlocked, parallelResourceBlocked } from "./parallel-tasks.ts";

describe("classifyBusySend", () => {
  it("joins a correction, waits on a dependency or the same resource, runs the rest in parallel", () => {
    expect(classifyBusySend({ text: "arrête, utilise plutôt Postgres" })).toMatchObject({ mode: "steer", sure: true, why: "correction" });
    expect(classifyBusySend({ text: "actually use the staging server" })).toMatchObject({ mode: "steer", why: "correction" });
    expect(classifyBusySend({ text: "Ensuite, envoie le rapport au client" })).toMatchObject({ mode: "after", sure: true, why: "depends" });
    expect(classifyBusySend({ text: "Once you're done, open a PR with it" })).toMatchObject({ mode: "after", why: "depends" });
    expect(classifyBusySend({ text: "Make the heading navy in src/app/main.ts for the dark theme", running: "Refactor src/app/main.ts into modules" }))
      .toMatchObject({ mode: "after", why: "same-resource" });
    expect(classifyBusySend({ text: "Ajoute une note au billet #123456 pour le client", running: "Mets à jour le billet 123456" }))
      .toMatchObject({ mode: "after", why: "same-resource" });
    expect(classifyBusySend({ text: "Prépare le courriel de bienvenue pour le nouveau client", running: "Refactor src/app/main.ts" }))
      .toMatchObject({ mode: "parallel", sure: false, why: "independent" });
  });

  it("answers a question or a request to explain inline, never as a parallel task", () => {
    // Owner's exact shape: a plain question sent while the bot is busy.
    expect(classifyBusySend({ text: "ques qui c'est passé pourquoi l'ecan est apparu et la connexion à été coupé le shell a jamais fonctionner non plus" }))
      .toMatchObject({ mode: "steer", sure: true, why: "question" });
    expect(classifyBusySend({ text: "pourquoi l'écran est apparu ?" })).toMatchObject({ mode: "steer", sure: true, why: "question" });
    expect(classifyBusySend({ text: "c'est quoi le statut en ce moment?" })).toMatchObject({ mode: "steer", why: "question" });
    expect(classifyBusySend({ text: "What happened to the shell?" })).toMatchObject({ mode: "steer", why: "question" });
    expect(classifyBusySend({ text: "Explique-moi ce qui vient de se passer" })).toMatchObject({ mode: "steer", why: "question" });
    expect(classifyBusySend({ text: "tell me what you just did" })).toMatchObject({ mode: "steer", why: "question" });
  });

  it("keeps a short follow-up about the current work inline (several messages in a row)", () => {
    expect(classifyBusySend({ text: "et le shell?" })).toMatchObject({ mode: "steer", why: "question" });
    expect(classifyBusySend({ text: "tu as coupé la connexion toi-même" })).toMatchObject({ mode: "steer", why: "question" });
    expect(classifyBusySend({ text: "explique-moi ça" })).toMatchObject({ mode: "steer", why: "question" });
  });

  it("keeps a genuine independent request a parallel task, even when phrased as a question", () => {
    expect(classifyBusySend({ text: "Prépare le courriel de bienvenue pour le nouveau client", running: "Refactor" }))
      .toMatchObject({ mode: "parallel", sure: false, why: "independent" });
    // explicitly backgrounded work stays parallel even when it is a question
    expect(classifyBusySend({ text: "peux-tu analyser tous les billets du mois en arrière-plan ?", running: "x" }))
      .toMatchObject({ mode: "parallel", sure: false, why: "independent" });
    expect(classifyBusySend({ text: "can you audit the invoices in parallel?", running: "x" }))
      .toMatchObject({ mode: "parallel", sure: false, why: "independent" });
  });

  it("names files and records, and compares keys without case", () => {
    expect(namedResources("look at ./src/a.ts and docs/x.md, ticket 12345")).toEqual(["file:src/a.ts", "file:docs/x.md", "id:12345"]);
    expect(namedResources("Bonjour, ça va ?")).toEqual([]);
    expect(resourcesOverlap(["File:SRC/a.ts"], ["file:src/a.ts"])).toBe(true);
    expect(resourcesOverlap(["id:1"], ["id:2"])).toBe(false);
    expect(resourcesOverlap([], ["id:2"])).toBe(false);
  });

  it("accepts auto and the three explicit modes", () => {
    for (const mode of ["auto", "steer", "parallel", "after"]) expect(isBusySendRequest(mode)).toBe(true);
    expect(isBusySendRequest("ask")).toBe(false);
  });
});

describe("classifyWithoutSteer (the engine cannot take the words live)", () => {
  it("queues a correction, keeps what the rule is sure of, asks the model for the rest", async () => {
    expect(await classifyWithoutSteer({ text: "actually use staging", running: "deploy" })).toEqual({ mode: "after", by: "rule" });
    expect(await classifyWithoutSteer({ text: "Ensuite, envoie-le", running: "rapport" })).toEqual({ mode: "after", by: "rule" });
    const asked: string[] = [];
    const after = await classifyWithoutSteer({ text: "Draft the onboarding email", running: "Audit the invoices", generateText: async (prompt) => { asked.push(prompt); return " After. "; } });
    expect(after).toEqual({ mode: "after", by: "model" });
    expect(asked[0]).toContain("New message: Draft the onboarding email");
    expect(asked[0]).toContain("Current work: Audit the invoices");
  });

  it("queues a question inline after the running work instead of spawning a parallel task", async () => {
    // steer verdicts become "after" here (the running turn cannot take them
    // live), so the question is answered in the conversation, not in a task.
    expect(await classifyWithoutSteer({ text: "pourquoi l'écran est apparu ?", running: "long deploy" }))
      .toEqual({ mode: "after", by: "rule" });
    expect(await classifyWithoutSteer({ text: "ques qui c'est passé le shell a jamais fonctionné", running: "long deploy" }))
      .toEqual({ mode: "after", by: "rule" });
    // the model is never consulted for a question the rule already settled
    let asked = 0;
    await classifyWithoutSteer({ text: "What happened to the shell?", running: "x", generateText: async () => { asked += 1; return "parallel"; } });
    expect(asked).toBe(0);
  });

  // 2026-11-01 (reported: replies repeated, handled late): with no decision from
  // the bot (an engine without a one-shot model, such as Grok over ACP, or
  // one that failed), the guess was a parallel task, a second session that
  // answered beside the running turn. The words now join the running work's
  // one follow-up turn, which the safe-point pause starts at once.
  it("falls back to the running work's follow-up on no model, a failure, a timeout or a word it cannot read", async () => {
    expect(await classifyWithoutSteer({ text: "Draft the onboarding email", running: "x" })).toEqual({ mode: "after", by: "default" });
    expect(await classifyWithoutSteer({ text: "Draft the onboarding email", running: "x", generateText: async () => { throw new Error("down"); } })).toEqual({ mode: "after", by: "default" });
    expect(await classifyWithoutSteer({ text: "Draft the onboarding email", running: "x", generateText: async () => "maybe" })).toEqual({ mode: "after", by: "default" });
    const started = Date.now();
    expect(await classifyWithoutSteer({ text: "Draft the onboarding email", running: "x", timeoutMs: 50, generateText: () => new Promise(() => {}) })).toEqual({ mode: "after", by: "default" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(parseBusyClassification("parallel")).toBe("parallel");
    expect(parseBusyClassification("I would say steer")).toBeNull();
    expect(busyClassifyPrompt({ running: "a", incoming: "b" })).toMatch(/exactly one word/);
  });
});

describe("routing handles", () => {
  it("open, bind, read, drop and expire", () => {
    let now = 1_000;
    const steers = new RoutableSteers<{ who: string }>(() => now);
    steers.open("h1", { botId: "b", threadId: "t", text: "hi", context: { who: "owner" } });
    expect(steers.get("h1")?.messageId).toBeUndefined();
    steers.bind("h1", "m1");
    expect(steers.get("h1")).toMatchObject({ botId: "b", threadId: "t", messageId: "m1", context: { who: "owner" } });
    steers.open("h2", { botId: "b", threadId: "t2", text: "x", context: { who: "owner" } });
    steers.forgetThread("t2");
    expect(steers.get("h2")).toBeUndefined();
    steers.drop("h1");
    expect(steers.get("h1")).toBeUndefined();
    steers.open("h3", { botId: "b", threadId: "t", text: "x", context: { who: "owner" } });
    now += ROUTE_HANDLE_TTL_MS + 1;
    expect(steers.get("h3")).toBeUndefined();
  });

  it("puts a short note naming the handle in front of the words", () => {
    const text = orchestratedSteerText("abc-123", "Prépare le rapport");
    expect(text).toMatch(/^\[Sent while you work · route abc-123: .*route_message.*\]\nPrépare le rapport$/s);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("cleans the resource keys a bot names", () => {
    expect(routeResources([" SRC/A.ts ", "src/a.ts", "", 3, "ticket:1"])).toEqual(["src/a.ts", "ticket:1"]);
    expect(routeResources("nope")).toEqual([]);
    expect(routeResources(Array.from({ length: 30 }, (_, i) => `k${i}`))).toHaveLength(12);
  });
});

describe("one line per resource for parallel tasks", () => {
  const task = (threadId: string, at: number, resources?: string[], reportedAt?: number) => ({
    threadId, parallelOf: { threadId: "main", messageId: `m-${threadId}`, at, ...(resources ? { resources } : {}), ...(reportedAt ? { reportedAt } : {}) },
  });

  it("a task waits for an earlier pending one on the same resource, then runs once it is reported", () => {
    const first = task("p1", 1, ["file:src/a.ts"]);
    const second = task("p2", 2, ["FILE:src/a.ts", "id:9"]);
    const other = task("p3", 3, ["id:10"]);
    const tasks = [first, second, other];
    const busy = (id: string) => id === "p1";
    expect(parallelResourceBlocked({ task: first, tasks, busy })).toBe(false);
    expect(parallelResourceBlocked({ task: second, tasks, busy })).toBe(true);
    expect(parallelResourceBlocked({ task: other, tasks, busy })).toBe(false);
    expect(parallelBlocked({ task: second, tasks, limit: 3, busy })).toBe(true);
    // the first one reported: the line moves
    const done = [task("p1", 1, ["file:src/a.ts"], 5), second, other];
    expect(parallelResourceBlocked({ task: second, tasks: done, busy: () => false })).toBe(false);
    expect(parallelBlocked({ task: second, tasks: done, limit: 3, busy: () => false })).toBe(false);
  });

  it("a later task already running still holds the resource", () => {
    const early = task("p1", 1, ["id:9"]);
    const runningLate = task("p2", 2, ["id:9"]);
    expect(parallelResourceBlocked({ task: early, tasks: [early, runningLate], busy: (id) => id === "p2" })).toBe(true);
  });

  it("a task naming no resource never waits on one", () => {
    const plain = task("p1", 2);
    expect(parallelResourceBlocked({ task: plain, tasks: [task("p0", 1, ["id:9"]), plain], busy: () => true })).toBe(false);
  });
});
