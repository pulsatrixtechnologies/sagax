import { describe, expect, it } from "vitest";
import type { DirectTriggers } from "../../shared/direct-triggers.ts";
import { ProactiveWaker, proactiveRelevance, type ProactiveEvent, type ProactiveWakeBatch } from "./proactive-wake.ts";

function harness(bot: { proactiveMode?: string; directTriggers?: DirectTriggers }) {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const woken: ProactiveWakeBatch[] = [];
  const waker = new ProactiveWaker({
    bot: (botId) => (botId === "nova" ? bot : undefined),
    wake: (batch) => woken.push(batch),
    log: () => {},
    now: () => now,
    setTimer: (fn, ms) => { const timer = { at: now + ms, fn, live: true }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { live: boolean }).live = false; },
    gatherMs: 1_000,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers) if (timer.live && timer.at <= now) { timer.live = false; timer.fn(); }
  };
  return { waker, woken, advance, bot };
}

const sms = (n: number, extra: Partial<ProactiveEvent> = {}): ProactiveEvent => ({
  botId: "nova", source: "sms", key: `sms-${n}`, label: "Text from a phone number", detail: `Message ${n}`, from: "+18195550101", confined: true, ...extra,
});

describe("direct triggers on the proactive wake (#2691)", () => {
  it("a text is a relevant source", () => {
    expect(proactiveRelevance(sms(1))).toBe("text on the bot's phone line");
  });

  it("a channel turned on wakes even with Proactive off", () => {
    const h = harness({ proactiveMode: "off", directTriggers: { sms: { on: true } } });
    expect(h.waker.offer(sms(1))).toBe("gathered");
    h.advance(2_000);
    expect(h.woken).toHaveLength(1);
    expect(h.woken[0]!.confined).toBe(true);
  });

  it("a channel turned off never wakes, and filters refuse", () => {
    expect(harness({ directTriggers: { sms: { on: false } } }).waker.offer(sms(1))).toBe("off");
    expect(harness({ directTriggers: { sms: { on: true, filters: "urgent" } } }).waker.offer(sms(1))).toBe("filtered");
    expect(harness({ directTriggers: { sms: { on: true, filters: "-from:*5550101" } } }).waker.offer(sms(1))).toBe("filtered");
  });

  it("with Proactive off, only the direct channel's events wake", () => {
    const h = harness({ proactiveMode: "proactive", directTriggers: { sms: { on: true } } });
    expect(h.waker.offer(sms(1))).toBe("gathered");
    expect(h.waker.offer({ botId: "nova", source: "mail", key: "m1", label: "Email", detail: "hi" })).toBe("gathered");
    h.bot.proactiveMode = "off";
    h.advance(2_000);
    // the events were gathered while on: none is marked direct, so none wakes
    expect(h.woken).toHaveLength(0);
    const h2 = harness({ proactiveMode: "off", directTriggers: { sms: { on: true } } });
    expect(h2.waker.offer(sms(2))).toBe("gathered");
    h2.bot.directTriggers = { sms: { on: false } };
    h2.advance(2_000);
    expect(h2.woken).toHaveLength(0);
  });
});
