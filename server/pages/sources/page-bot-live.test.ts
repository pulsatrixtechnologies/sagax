// Live refresh for the bot source: a routine change must call
// PageDataWatch.botChanged so subscribe("bot") redraws (#5461).
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageDataWatch } from "../page-sources.ts";

describe("bot page source live refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies an open page when botChanged fires for its topic (routine path)", () => {
    vi.useFakeTimers();
    const data = vi.fn();
    const watch = new PageDataWatch({ isOpen: () => true, data }, 10);
    watch.record("page-1", "person-a", "bot", ["bot-a"]);
    // Mimics onRoutineChanged / onEnabledChanged / onRunChanged wiring.
    watch.botChanged("bot-a");
    vi.advanceTimersByTime(10);
    expect(data).toHaveBeenCalledWith("page-1", "person-a", "bot");
  });

  it("ignores a routine change for a different bot", () => {
    vi.useFakeTimers();
    const data = vi.fn();
    const watch = new PageDataWatch({ isOpen: () => true, data }, 10);
    watch.record("page-1", "person-a", "bot", ["bot-a"]);
    watch.botChanged("bot-b");
    vi.advanceTimersByTime(10);
    expect(data).not.toHaveBeenCalled();
  });
});
