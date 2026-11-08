import { expect, it } from "vitest";

import en from "./en.json";
import fr from "./fr.json";

// #2938 (unified chat): an action that takes the person to a bot says
// « Ouvrir le chat de {bot} » / "Open {bot}'s chat", never "Open thread",
// "Open the conversation", "Go to conversation", « Ouvrir le fil »,
// « Ouvrir la conversation » nor « Voir le fil ».
const THREAD_ACTION = /\bopen (the |a |its )?(thread|conversation)\b|\bgo to (the )?conversation\b|\bopen thread\b|\bouvr(ir|e|ez) (le|un|son|la) (fil|conversation)\b|\bvoir le fil\b/i;
// Not rendered by any surface (kept for a later cleanup), or the status line
// of the bot's own start_thread tool step, not a button for the person.
const NOT_AN_ACTION = new Set(["botPanel.activity.openThread", "floatingBots.menu.openThread", "step.startThread.done", "step.startThread.failed", "step.startThread.running"]);

it.each([["en", en], ["fr", fr]] as const)("%s: no thread or conversation wording for an action", (_, catalog) => {
  const bad = Object.entries(catalog as Record<string, string>)
    .filter(([key, value]) => !NOT_AN_ACTION.has(key) && THREAD_ACTION.test(value))
    .map(([key, value]) => `${key}: ${value}`);
  expect(bad).toEqual([]);
});

it("the swept surfaces say the bot's chat, in both languages", () => {
  const e = en as Record<string, string>;
  const f = fr as Record<string, string>;
  expect(e["approvals.openChat"]).toBe("Open {bot}'s chat");
  expect(f["approvals.openChat"]).toBe("Ouvrir le chat de {bot}");
  for (const key of ["approvals.openThread", "needsYou.openThread", "botPanel.model.lockedOpen"]) {
    expect(e[key]).toBeUndefined();
    expect(f[key]).toBeUndefined();
  }
  expect(f["floatingBots.tray.needsYou"]).toBe("T'attend : {tool}");
  expect(f["compose.openChat"]).toBe("Ouvrir le chat");
  expect(f["chat.goToConversation"]).toBe("Ouvrir le chat");
});
