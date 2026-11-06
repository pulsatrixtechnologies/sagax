import { describe, expect, it } from "vitest";
import { installMainRuntimeEventSubscriber } from "./dispatcher.ts";

describe("installMainRuntimeEventSubscriber", () => {
  it("subscribes once", () => {
    const handlers: Array<(e: unknown) => void> = [];
    const bus = { subscribe: (h: (e: unknown) => void) => { handlers.push(h); } };
    installMainRuntimeEventSubscriber(bus, () => ({ shouldIgnoreProviderEvent: () => true }));
    expect(handlers).toHaveLength(1);
  });
});
