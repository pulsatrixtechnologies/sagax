// #2191: each internal resume path must carry a speaker so Perspicax
// prepareTurn does not refuse with unknown_speaker.
import { describe, expect, it } from "vitest";

import { routineLineage, speakerPrincipal, type TurnSpeaker } from "../engines/engine-access.ts";
import { PerspicaxMcp, type PerspicaxMcpLink } from "../perspicax/perspicax-mcp.ts";
import type { ExchangeResult } from "../perspicax/perspicax-link.ts";
import { WarmResourceBudget } from "../resources/warm-resources.ts";
import { continuationSpeaker } from "./continuation-speaker.ts";

const ISS = "https://px.example.test";
const BOB = "pr_bob";
const ALICE = "pr_alice";
const OWNER = "pr_owner";

function mcpHarness() {
  let n = 0;
  const subjects: Record<string, { iss: string; sub: string; disabled: boolean }> = {
    [BOB]: { iss: ISS, sub: "B", disabled: false },
    [ALICE]: { iss: ISS, sub: "A", disabled: false },
    [OWNER]: { iss: ISS, sub: "O", disabled: false },
  };
  const delegations = new Set<string>([BOB, ALICE, OWNER]);
  const link: PerspicaxMcpLink = {
    exchangeToken: async (subjectToken): Promise<ExchangeResult> => {
      const sub = subjectToken.split(".")[1]!;
      return { ok: true, token: `pxlo1.${sub}.mcp-${++n}`, expiresAt: Date.now() + 900_000 };
    },
    revokeExchanged: async () => true,
    mcpEndpoint: () => "http://perspicax:8787/mcp",
  };
  const mcp = new PerspicaxMcp({
    warmBudget: new WarmResourceBudget({ intervalMs: 0 }),
    issuer: ISS,
    link: () => link,
    subjectOf: (id) => subjects[id] ?? null,
    subjectToken: async (subject) => ({ ok: true, token: `pxlo1.${subject.sub}.signin`, expiresAt: Date.now() + 3_600_000 }),
    routineSubjectToken: async (principalId) => {
      if (!delegations.has(principalId)) return { ok: false, error: "no_session" };
      return { ok: true, token: `pxlo1.${subjects[principalId]!.sub}.delegation`, expiresAt: Date.now() + 3_600_000 };
    },
    botExists: () => true,
    version: "0.8.52",
    fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (String(init?.method) === "DELETE") return new Response(null, { status: 204 });
      if (body?.id === undefined) return new Response(null, { status: 202 });
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
      });
    }) as typeof fetch,
  });
  return mcp;
}

/** Same mapping startTurn → prepareTurn uses for the speaker (#2191). */
async function prepareForSpeaker(speaker: TurnSpeaker, ownerPrincipalId = OWNER) {
  const mcp = mcpHarness();
  const principalId = speakerPrincipal(speaker, ownerPrincipalId);
  return mcp.prepareTurn({
    threadId: "t-resume",
    generation: "g1",
    bot: { id: "x" },
    speakerPrincipalId: principalId,
    speakerOrigin: speaker.origin,
    ownerPrincipalId,
    ...(routineLineage(speaker) ? { routine: true } : {}),
  });
}

describe("continuationSpeaker (#2191)", () => {
  it("keeps the last resolved speaker", () => {
    const last: TurnSpeaker = { origin: "person", principalId: BOB };
    expect(continuationSpeaker({ lastSpeaker: last, routineRun: true, runAsPrincipalId: ALICE })).toEqual(last);
  });

  it("uses the routine owner-routine speaker when no last speaker", () => {
    expect(continuationSpeaker({ routineRun: true, runAsPrincipalId: ALICE })).toEqual({
      origin: "owner-routine", principalId: ALICE,
    });
    expect(continuationSpeaker({ routineRun: true })).toEqual({ origin: "owner-routine" });
  });

  it("returns undefined when nothing is known (fail-closed)", () => {
    expect(continuationSpeaker({})).toBeUndefined();
  });
});

describe("#2191 prepareTurn on each resume path", () => {
  const person: TurnSpeaker = { origin: "person", principalId: BOB };
  const routine: TurnSpeaker = { origin: "owner-routine", principalId: ALICE };

  it.each([
    {
      path: "delegation wake (immediate)",
      speaker: continuationSpeaker({ lastSpeaker: person }),
    },
    {
      path: "pendingDelegationWakes",
      speaker: continuationSpeaker({ lastSpeaker: person }),
    },
    {
      path: "delegation wake from routine lineage",
      speaker: continuationSpeaker({ lastSpeaker: routine }),
    },
    {
      path: "approval / team-setup card resume",
      speaker: continuationSpeaker({ lastSpeaker: person }),
    },
    {
      path: "computer resume",
      speaker: continuationSpeaker({ lastSpeaker: person }),
    },
    {
      path: "secret / credential resume",
      speaker: continuationSpeaker({ lastSpeaker: person }),
    },
    {
      path: "ROUTINE_RESUME_PROMPT (restart, no in-memory speaker)",
      speaker: continuationSpeaker({ routineRun: true, runAsPrincipalId: ALICE }),
    },
    {
      path: "held-message resume (last speaker still known)",
      speaker: continuationSpeaker({ lastSpeaker: person }),
    },
  ])("$path does not return unknown_speaker", async ({ speaker }) => {
    expect(speaker).toBeDefined();
    const plan = await prepareForSpeaker(speaker!);
    expect(plan.unavailable.map((entry) => entry.reason)).not.toContain("unknown_speaker");
    expect(plan.mounted).toEqual([{ name: "Perspicax" }]);
  });

  it("fail-closed: anonymous person still yields unknown_speaker", async () => {
    expect(continuationSpeaker({})).toBeUndefined();
    const mcp = mcpHarness();
    const plan = await mcp.prepareTurn({
      threadId: "t-anon",
      generation: "g1",
      bot: { id: "x" },
      speakerPrincipalId: "",
      speakerOrigin: "person",
      ownerPrincipalId: OWNER,
    });
    expect(plan.unavailable).toEqual([expect.objectContaining({ reason: "unknown_speaker" })]);
  });
});
