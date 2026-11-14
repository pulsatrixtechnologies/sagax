// #4215: Muse Code sends only the opening-block sections that changed, the
// way pi and the ACP agents do. The SDK is replaced by an in-memory host that
// records each turn's text, so no Muse Code CLI is needed.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { VOLATILE_SECTIONS_NOTE_PREFIX } from "./prompt-split.ts";

const sent: string[] = [];

vi.mock("@muse-code/sdk", () => {
  class MspError extends Error {}
  const spawnMspConnection = () => {
    let notify: (notification: { method: string; params: unknown }) => void = () => {};
    let ids = 0;
    const connection = {
      mintCommandId: () => `cmd-${++ids}`,
      onServerRequest: () => {},
      onProtocolError: () => {},
      onNotification: (handler: typeof notify) => { notify = handler; },
      request: async () => ({ models: [] }),
      command: async (method: string, params: Record<string, unknown>, options?: { commandId?: string }) => {
        if (method === "session/start") return { session: { sessionId: "muse-session-1", modelId: "muse-wonder" } };
        if (method === "turn/start") {
          const input = params.input as Array<{ type: string; text?: string }>;
          sent.push(input.find((part) => part.type === "text")!.text!);
          setTimeout(() => notify({ method: "turn/completed",
            params: { sessionId: params.sessionId, turnId: options?.commandId, terminal: "completed" } }), 0);
        }
        return {};
      },
    };
    return {
      close: async () => {},
      initialize: async () => ({
        connection, initializeResult: {}, exited: new Promise(() => {}), close: async () => {},
      }),
    };
  };
  return { MspError, spawnMspConnection };
});

const { MuseCodeDriver } = await import("./muse-code.ts");

describe("Muse Code opening block split (#4215)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;

  beforeEach(async () => {
    ensureDirs();
    sent.length = 0;
    instance = await MuseCodeDriver.create({
      instanceId: "muse-split-test", displayName: "Muse Split Test", environment: {}, enabled: true,
      config: MuseCodeDriver.defaultConfig(),
    });
    recorder = recordEvents(instance.adapter);
  });

  afterEach(async () => {
    await instance.dispose();
  });

  const sender = (threadId: string) => async (
    text: string,
    stable: { soul: string; skills: string },
    volatile: { memory: string; coordination: string },
  ) => {
    const stableSections = [{ id: "soul", text: stable.soul }, { id: "skills", text: `\n\n${stable.skills}` }];
    const volatileSections = [{ id: "memory", text: volatile.memory }, { id: "coordination", text: `\n\n${volatile.coordination}` }];
    const systemStable = stableSections.map((section) => section.text).join("");
    const systemVolatile = volatileSections.map((section) => section.text).join("");
    const { turnId } = await instance.adapter.sendTurn({
      threadId, text, system: `${systemStable}\n\n${systemVolatile}`,
      systemStable, systemVolatile, systemStableSections: stableSections, systemVolatileSections: volatileSections,
    });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    return sent.at(-1)!;
  };

  const stable = { soul: "Standing rules.", skills: "Skill: invoices." };
  const volatile = { memory: "Memory: likes quiet hours.", coordination: "Teammates: none busy." };

  it("rides a changed stable section alone instead of the whole opening block", async () => {
    const send = sender("t-muse-stable-" + randomUUID());
    expect(await send("first", stable, volatile))
      .toBe("Standing rules.\n\nSkill: invoices.\n\nMemory: likes quiet hours.\n\nTeammates: none busy.\n\nfirst");
    expect(await send("second", { ...stable, skills: "Skill: quotes." }, volatile))
      .toBe(`${VOLATILE_SECTIONS_NOTE_PREFIX}\n\nSkill: quotes.\n\nsecond`);
  });

  it("rides a changed volatile section alone instead of the whole volatile half", async () => {
    const send = sender("t-muse-volatile-" + randomUUID());
    await send("first", stable, volatile);
    expect(await send("second", stable, { ...volatile, memory: "Memory: moved to the coast." }))
      .toBe(`${VOLATILE_SECTIONS_NOTE_PREFIX}\n\nMemory: moved to the coast.\n\nsecond`);
  });
});
