import { describe, expect, it } from "vitest";

import { isPhoneOrWebhookTrigger, resolveRoutineById } from "./routine-by-id.ts";

// #1891: Voice line's list-page id failed list_routines by id while Incoming
// texts, Nightly and tunnel watch loaded. The Webhooks list shows webhook.id;
// createOwned stores a different routine.id. Automations > Mine also lists
// sibling bots of the same person.

const VOICE_WEBHOOK = "9fe3376c-7c0c-4a19-9a8d-5475c52ebf8f";
const VOICE_ROUTINE = "voice-routine-id";
const INCOMING = "20c7ee6e-effe-48e8-9576-8c0ff3ced59c";

const melonie = "bot-melonie";
const sibling = "bot-ember";

const routines = [
  { id: INCOMING, botId: melonie, name: "Incoming texts", enabled: false, schedule: { type: "webhook" as const } },
  { id: VOICE_ROUTINE, botId: melonie, name: "Voice line requests from JC", enabled: false, schedule: { type: "webhook" as const } },
  { id: "nightly", botId: melonie, name: "Nightly", enabled: true, schedule: { type: "cron" as const } },
  { id: "on-ember", botId: sibling, name: "Tunnel watch", enabled: true, schedule: { type: "interval" as const } },
];

const webhooks = [
  { id: "hook-incoming", botId: melonie, routineId: INCOMING, name: "Incoming texts", enabled: false },
  { id: VOICE_WEBHOOK, botId: melonie, routineId: VOICE_ROUTINE, name: "Voice line requests from JC", enabled: false },
  { id: "standalone-phone", botId: melonie, name: "Bot phone", enabled: true, source: { type: "telephony" } },
];

describe("resolveRoutineById (#1891 list_routines routine_id)", () => {
  it("loads a webhook routine by its routine id (Incoming texts)", () => {
    const found = resolveRoutineById({ routineId: INCOMING, botId: melonie, routines, webhooks });
    expect(found).toEqual({ kind: "found", routine: routines[0], via: "routine" });
  });

  it("loads the same routine when the list page id is the owned webhook id (Voice line)", () => {
    // Failing path before the fix: own.find(r => r.id === VOICE_WEBHOOK) missed.
    const found = resolveRoutineById({ routineId: VOICE_WEBHOOK, botId: melonie, routines, webhooks });
    expect(found).toMatchObject({
      kind: "found",
      via: "webhook",
      webhookId: VOICE_WEBHOOK,
      routine: { id: VOICE_ROUTINE, name: "Voice line requests from JC" },
    });
  });

  it("loads a sibling bot's routine when that bot is reachable (Automations Mine id)", () => {
    const found = resolveRoutineById({
      routineId: "on-ember",
      botId: melonie,
      routines,
      webhooks,
      reachableBotIds: [sibling],
    });
    expect(found).toMatchObject({ kind: "found", via: "routine", routine: { id: "on-ember", botId: sibling } });
  });

  it("refuses another person's bot even when its id is known", () => {
    const found = resolveRoutineById({
      routineId: "on-ember",
      botId: melonie,
      routines,
      webhooks,
      // reachableBotIds omitted: only Melonie's own bot
    });
    expect(found).toEqual({ kind: "missing" });
  });

  it("trims the id and ignores an empty one", () => {
    expect(resolveRoutineById({ routineId: `  ${INCOMING}  `, botId: melonie, routines, webhooks }).kind).toBe("found");
    expect(resolveRoutineById({ routineId: "   ", botId: melonie, routines, webhooks })).toEqual({ kind: "missing" });
  });

  it("does not treat a standalone telephony webhook without a routine as a routine", () => {
    // Standalone Bot phone triggers stay in Automations > Webhooks / Triggers;
    // list_routines still names routines. The caller gets missing, not a false hit.
    expect(resolveRoutineById({
      routineId: "standalone-phone",
      botId: melonie,
      routines,
      webhooks,
    })).toEqual({ kind: "missing" });
  });
});

describe("isPhoneOrWebhookTrigger (must not be silently disabled)", () => {
  it("marks webhook and email routines and telephony source webhooks", () => {
    expect(isPhoneOrWebhookTrigger({ schedule: { type: "webhook" } })).toBe(true);
    expect(isPhoneOrWebhookTrigger({ schedule: { type: "event", source: "email" } })).toBe(true);
    expect(isPhoneOrWebhookTrigger(null, { source: { type: "telephony" } })).toBe(true);
    expect(isPhoneOrWebhookTrigger({ schedule: { type: "cron" } })).toBe(false);
    expect(isPhoneOrWebhookTrigger({ schedule: { type: "interval" } }, { source: { type: "github" } })).toBe(false);
  });
});
