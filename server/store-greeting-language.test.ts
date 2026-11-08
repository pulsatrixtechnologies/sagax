import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });

// #2803: a bot created from a French app greets in French even when the
// server's own language is English.
it("greets in the creating device's language over the server default", () => {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }), undefined as never, undefined as never, () => "en");
  const fr = store.createBot({ name: "Gaston" }, { language: "fr" });
  expect(store.messagesFor(fr.threadId)[0]?.text).toBe("Bonjour, je suis Gaston. Que puis-je faire pour vous ?");
  const en = store.createBot({ name: "Juno" });
  expect(store.messagesFor(en.threadId)[0]?.text).toBe("Hi, I'm Juno. What would you like me to do?");
});
