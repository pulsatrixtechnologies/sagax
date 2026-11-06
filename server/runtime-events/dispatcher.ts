// @ts-nocheck
/**
 * Main runtime-event subscriber dispatcher (#1388).
 * One handler per event family; this file stays under 150 lines of control flow.
 * `getHost` runs per event (after module init), never at install time: many deps
 * are declared after the install call site in server/index.ts.
 */
import { runRuntimeEventPreamble } from "./preamble.ts";
import { handleItemEvents } from "./items.ts";
import { handleRequestOpened } from "./request-opened.ts";
import { handleRequestResolved } from "./request-resolved.ts";
import { handleRuntimeLifecycle } from "./runtime-lifecycle.ts";
import { handleTurnCompleted } from "./turn-completed.ts";

export type RuntimeEventHost = Record<string, any>;

/** Install the main index bus subscriber. `getHost` runs per event only. */
export function installMainRuntimeEventSubscriber(
  bus: { subscribe: (handler: (event: any) => void) => unknown },
  getHost: () => RuntimeEventHost,
): void {
  bus.subscribe((event: any) => {
    const h = getHost();
    const ctx = runRuntimeEventPreamble(event, h);
    if (!ctx) return;
    switch (event.type) {
      case "turn.started":
      case "session.started":
      case "turn.retrying":
      case "session.model-fallback":
      case "runtime.notice":
      case "runtime.error":
      case "thread.token-usage.updated":
        handleRuntimeLifecycle(event, ctx, h);
        break;
      case "item.completed":
      case "item.started":
        handleItemEvents(event, ctx, h);
        break;
      case "request.opened":
        handleRequestOpened(event, ctx, h);
        break;
      case "request.resolved":
        handleRequestResolved(event, ctx, h);
        break;
      case "turn.completed":
        handleTurnCompleted(event, ctx, h);
        break;
      default:
        break;
    }
  });
}
