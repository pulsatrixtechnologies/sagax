// #4187: callers that read a thread at the same version (the inline
// questions of a parallel card and the approvals joining the open
// conversation, both keyed on the task's updatedAt) share one page request.
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/state/store", () => ({ api: (...args: unknown[]) => api(...args) }));

const { resetThreadHeadPages, threadHeadPage } = await import("./thread-head-page");

describe("threadHeadPage (#4187)", () => {
  beforeEach(() => {
    api.mockReset();
    resetThreadHeadPages();
  });

  it("asks once per version for a burst of task updates read by several callers", async () => {
    api.mockResolvedValue({ messages: [] });
    // 20 task updates, each read by several callers at the same version
    for (let version = 1; version <= 20; version += 1) {
      await Promise.all([threadHeadPage("task-1", version), threadHeadPage("task-1", version), threadHeadPage("task-1", version)]);
    }
    expect(api).toHaveBeenCalledTimes(20);
    expect(api).toHaveBeenLastCalledWith("/api/threads/task-1/messages?limit=60");
  });

  it("reads a failed page again on the next ask", async () => {
    api.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ messages: [] });
    await expect(threadHeadPage("task-2", 1)).rejects.toThrow("offline");
    await expect(threadHeadPage("task-2", 1)).resolves.toEqual({ messages: [] });
    expect(api).toHaveBeenCalledTimes(2);
  });
});
