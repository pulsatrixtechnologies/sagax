// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openArtifact = vi.fn((..._args: unknown[]) => undefined);
const openArtifactWindow = vi.fn((..._args: unknown[]) => undefined);
const api = vi.fn(async (..._args: unknown[]) => ({ artifact: { rev: 2 }, versions: [{ rev: 1 }] }));

vi.mock("@/lib/artifact-events", () => ({
  openArtifact: (detail: unknown) => openArtifact(detail),
  openArtifactWindow: (detail: unknown) => openArtifactWindow(detail),
}));

vi.mock("@/state/store", () => ({
  api: (path: string, init?: unknown) => api(path, init),
}));

vi.mock("@/lib/i18n", () => ({
  t: (key: string, vars?: Record<string, string>) => {
    if (vars?.title) return `${key}:${vars.title}`;
    if (vars?.n) return `${key}:${vars.n}`;
    return key;
  },
}));

import { SagaxArtifactChatCard } from "./SagaxArtifactChatCard";
import type { Message } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SagaxArtifactChatCard", () => {
  let root: Root | null = null;

  beforeEach(() => {
    openArtifact.mockClear();
    openArtifactWindow.mockClear();
    api.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function mount(rev = 2) {
    const host = document.createElement("div");
    document.body.append(host);
    const message = {
      id: "m1",
      at: 1,
      role: "bot",
      kind: "text",
      text: "Artifact saved: Sales",
      artifactCard: { artifactId: "art_aaaaaaaaaaaa", title: "Sales", rev },
    } as Message;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(SagaxArtifactChatCard, { message, botId: "b1" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    return host;
  }

  it("renders title and open actions", async () => {
    await mount();
    expect(document.querySelector("[data-artifact-chat-card=art_aaaaaaaaaaaa]")).not.toBeNull();
    expect(document.body.textContent).toContain("Sales");
    expect(document.querySelector("[data-artifact-chat-beside]")).not.toBeNull();
    expect(document.querySelector("[data-artifact-chat-window]")).not.toBeNull();
  });

  it("Open beside and Window fire the artifact events", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-artifact-chat-beside]")!.click();
      document.querySelector<HTMLButtonElement>("[data-artifact-chat-window]")!.click();
    });
    expect(openArtifact).toHaveBeenCalledWith({ botId: "b1", artifactId: "art_aaaaaaaaaaaa", title: "Sales" });
    expect(openArtifactWindow).toHaveBeenCalledWith({ botId: "b1", artifactId: "art_aaaaaaaaaaaa", title: "Sales" });
  });

  it("loads versions for the stepper", async () => {
    await mount();
    expect(api).toHaveBeenCalledWith("/api/bots/b1/artifacts/art_aaaaaaaaaaaa?versions=1", undefined);
    expect(document.querySelector("[data-artifact-chat-version]")?.textContent).toContain("2");
  });
});
