import { describe, expect, it } from "vitest";
import { createScrubConfidentialThreads } from "./scrubConfidentialThreads.ts";

const scrub = createScrubConfidentialThreads(() => ({})) as (value: unknown, ids: ReadonlySet<string>) => unknown;

describe("scrubConfidentialThreads", () => {
  // #4493: a bot's waitingOn names the card it waits on by thread; on
  // someone's behalf (act, an AI client) a confidential thread's card is not there
  it("cuts a confidential thread's entry held in a field, as one held in a list", () => {
    const ids = new Set(["secret"]);
    const bots = [{
      id: "b1", threadId: "open", tasks: [{ threadId: "open" }, { threadId: "secret" }],
      waitingOn: { threadId: "secret", messageId: "m1", text: "Allow the bot to save a note?" },
    }];
    const out = scrub(bots, ids);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(out).toEqual([{ id: "b1", threadId: "open", tasks: [{ threadId: "open" }] }]);
  });

  it("keeps an ordinary thread's waitingOn", () => {
    const bot = { id: "b1", threadId: "open", tasks: [{ threadId: "open" }], waitingOn: { threadId: "open", messageId: "m1", text: "Which repo?" } };
    expect(scrub(bot, new Set(["secret"]))).toEqual(bot);
  });
});
