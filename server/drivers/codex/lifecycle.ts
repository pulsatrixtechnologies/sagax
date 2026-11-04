/** Retire idle Codex processes as soon as their owning records change (#1969). */
import type { Store } from "../../store.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { codexContractKey } from "./sessions.ts";

export function wireCodexSessionLifecycle(store: Pick<Store, "bots" | "bot" | "tasks" | "onChange">,
  instances: () => ProviderInstance[]): () => void {
  const held = new Map<string, Map<string, string>>();
  const read = (botId: string) => {
    const bot = store.bot(botId);
    return new Map((bot ? store.tasks(botId) : []).map(task => [task.threadId, codexContractKey({
      model: task.modelSelection ?? bot!.modelSelection,
      owner: task.ownerPrincipalId ?? bot!.ownerUserId,
    })]));
  };
  for (const bot of store.bots) held.set(bot.id, read(bot.id));
  const release = (thread: string) => {
    for (const instance of instances()) {
      if (instance.driverKind === "codex") instance.adapter.releaseWarmSession?.(thread);
    }
  };
  return store.onChange(change => {
    if (change.type === "thread.deleted") { release(change.threadId); return; }
    if (change.type !== "bot" && change.type !== "bot.deleted") return;
    const before = held.get(change.botId);
    const after = read(change.botId);
    for (const [thread, key] of before ?? []) if (after.get(thread) !== key) release(thread);
    if (after.size) held.set(change.botId, after);
    else held.delete(change.botId);
  });
}
