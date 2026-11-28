// Settings > Appearance > Sidebar: "Person-work threads"
// (`sagax.personWorkThreads.v1`, "on" | "off", off by default: D-20261127-040,
// #5289). On, threads bots opened for the person's work (a hand-off, start_thread)
// are regular rows in each bot's normal thread list (sidebar and header picker),
// even when Show Bot threads is off. Routine runs, results threads, AI-client
// conversations and bot-hidden investigations stay out. Show Bot threads keeps
// controlling the Bot threads section; it also still lists those same threads
// when on (the earlier #5289 path). The choice follows the person through the
// synced preferences (shared/user-preferences.ts), and a bot changes it through
// the settings tool (appearance.personWorkThreads).
import { localChoice } from "./local-choice";

export const personWorkThreads = localChoice("sagax.personWorkThreads.v1", ["on", "off"] as const, "off");

export function usePersonWorkThreads(): boolean {
  return personWorkThreads.use() === "on";
}
