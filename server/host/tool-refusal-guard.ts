// Feeds the tool refusal memory (server/tools/tool-refusals.ts) from the
// runtime bus, so every engine counts (#4720): a connector's tool that fails
// with a durable permission refusal is remembered for the person the turn
// speaks for; the same tool answering forgets it. The first refusal of a
// connector for a person is said to them once, in one activity row with the
// provider's own reason, never once per bot or per run: the memory keeps
// who was told until that connector has no refusal left.
import type { RuntimeEvent } from "../contracts.ts";
import { permissionRefusalOf, refusalSentence, refusalTarget, type ToolRefusalMemory } from "../tools/tool-refusals.ts";

export interface ToolRefusalGuardDeps {
  memory: ToolRefusalMemory;
  /** The person this thread's turn speaks for (turn-reach.ts turnPersonFor); none, nothing is remembered. */
  person(threadId: string): string | undefined;
  /** The one row the person reads. */
  tell(threadId: string, row: { name: string; ok: false; output: string }): void;
  now?(): number;
  log?(line: string): void;
}

export interface ToolRefusalGuard {
  onEvent(event: RuntimeEvent): void;
  settle(threadId: string): void;
}

const ITEMS_MAX = 256;

export function createToolRefusalGuard(deps: ToolRefusalGuardDeps): ToolRefusalGuard {
  const now = deps.now ?? Date.now;
  /** Per thread: the connector and tool of each running call. */
  const running = new Map<string, Map<string, { connector: string; tool: string }>>();

  const settle = (threadId: string) => {
    running.delete(threadId);
  };

  const onEvent = (event: RuntimeEvent) => {
    const { threadId } = event;
    if (event.type === "session.exited") return settle(threadId);
    if (event.type === "item.started" && event.itemType === "tool" && event.itemId) {
      const target = refusalTarget({ title: event.title, tool: event.tool });
      if (!target) return;
      let items = running.get(threadId);
      if (!items) running.set(threadId, (items = new Map()));
      if (items.size >= ITEMS_MAX) items.delete(items.keys().next().value!);
      items.set(event.itemId, target);
      return;
    }
    if (event.type !== "item.completed" || event.itemType !== "tool" || !event.itemId) return;
    const target = running.get(threadId)?.get(event.itemId);
    if (!target) return;
    running.get(threadId)!.delete(event.itemId);
    const person = deps.person(threadId);
    if (!person) return;
    if (event.ok) {
      deps.memory.answered(person, target.connector, target.tool);
      return;
    }
    const refusal = permissionRefusalOf(event.output, now());
    if (!refusal) return;
    const { first, tell } = deps.memory.record(person, target.connector, target.tool, refusal);
    if (first) deps.log?.(`[tool-refusals] remembered: thread=${threadId} connector=${target.connector} tool=${target.tool} reason=${refusal.reason}`);
    if (tell) deps.tell(threadId, { name: refusalSentence(target.connector, target.tool, refusal), ok: false, output: refusal.detail });
  };

  return { onEvent, settle };
}
