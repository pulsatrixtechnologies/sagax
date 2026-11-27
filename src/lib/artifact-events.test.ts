// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARTIFACT_REATTACH_STORAGE_KEY,
  listenArtifactReattach,
  openArtifact,
  openArtifactWindow,
  OPEN_ARTIFACT_EVENT,
  OPEN_ARTIFACT_WINDOW_EVENT,
  signalArtifactReattach,
} from "./artifact-events";

describe("artifact-events", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("openArtifact fires the beside event", () => {
    const seen: unknown[] = [];
    const onOpen = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    openArtifact({ botId: "b1", artifactId: "a1", title: "Sales" });
    window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    expect(seen).toEqual([{ botId: "b1", artifactId: "a1", title: "Sales" }]);
  });

  it("openArtifactWindow fires the window event", () => {
    const seen: unknown[] = [];
    const onOpen = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OPEN_ARTIFACT_WINDOW_EVENT, onOpen);
    openArtifactWindow({ botId: "b1", artifactId: "a1", title: "Sales" });
    window.removeEventListener(OPEN_ARTIFACT_WINDOW_EVENT, onOpen);
    expect(seen).toEqual([{ botId: "b1", artifactId: "a1", title: "Sales" }]);
  });

  it("signalArtifactReattach reaches a storage listener in another window", () => {
    const onReattach = vi.fn();
    const stop = listenArtifactReattach(onReattach);
    // Simulate another window writing the key (this window only sees storage events
    // from other documents; call the handler path through a synthetic event).
    const payload = JSON.stringify({ botId: "b1", artifactId: "a1", title: "Sales", at: 1 });
    window.dispatchEvent(new StorageEvent("storage", {
      key: ARTIFACT_REATTACH_STORAGE_KEY,
      newValue: payload,
    }));
    stop();
    expect(onReattach).toHaveBeenCalledWith({ botId: "b1", artifactId: "a1", title: "Sales" });
  });

  it("signalArtifactReattach writes then clears the storage key", () => {
    signalArtifactReattach({ botId: "b1", artifactId: "a1", title: "Sales" });
    expect(localStorage.getItem(ARTIFACT_REATTACH_STORAGE_KEY)).toBeNull();
  });
});
