import { describe, expect, it, vi } from "vitest";
import { GithubConnectCards } from "./github-connect-cards.ts";

const START = { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: 1_900_000_000_000 };

function harness() {
  let n = 0;
  const appendMessage = vi.fn((_threadId: string, _message: Record<string, unknown>) => ({ id: `m-${++n}` }));
  const patchMessage = vi.fn();
  return { cards: new GithubConnectCards({ appendMessage, patchMessage }), appendMessage, patchMessage };
}

describe("GithubConnectCards (#2109)", () => {
  it("posts a pending card with the code, the link and a text fallback", () => {
    const { cards, appendMessage } = harness();
    const posted = cards.post("p-1", "t-1", START, { botId: "bot-1", name: "Ada" });
    expect(posted).toEqual({ messageId: "m-1", reused: false });
    expect(appendMessage).toHaveBeenCalledWith("t-1", {
      role: "bot",
      kind: "text",
      text: "Connect GitHub: open https://github.com/login/device and enter the code ABCD-1234.",
      githubConnect: { state: "pending", ...START },
      from: { botId: "bot-1", name: "Ada" },
    });
  });

  it("reuses the card when the same chat asks again with the same code", () => {
    const { cards, appendMessage } = harness();
    cards.post("p-1", "t-1", START);
    expect(cards.post("p-1", "t-1", START)).toEqual({ messageId: "m-1", reused: true });
    expect(appendMessage).toHaveBeenCalledTimes(1);
  });

  it("marks the cards of an older code as replaced", () => {
    const { cards, patchMessage } = harness();
    cards.post("p-1", "t-1", START);
    cards.post("p-1", "t-2", { ...START, userCode: "WXYZ-9999" });
    expect(patchMessage).toHaveBeenCalledWith("t-1", "m-1", { text: "GitHub sign-in replaced by a newer code.", githubConnect: { state: "cancelled" } });
  });

  it("turns every card of the flow into GitHub connected as @login", () => {
    const { cards, patchMessage } = harness();
    cards.post("p-1", "t-1", START);
    cards.post("p-1", "t-2", START);
    cards.post("p-2", "t-3", START);
    cards.settle("p-1", { state: "connected", login: "octo" });
    expect(patchMessage).toHaveBeenCalledTimes(2);
    expect(patchMessage).toHaveBeenCalledWith("t-1", "m-1", { text: "GitHub connected as @octo.", githubConnect: { state: "connected", login: "octo" } });
    expect(patchMessage).toHaveBeenCalledWith("t-2", "m-2", expect.objectContaining({ githubConnect: { state: "connected", login: "octo" } }));
    cards.settle("p-1", { state: "connected", login: "octo" });
    expect(patchMessage).toHaveBeenCalledTimes(2);
  });

  it("says why the flow stopped and survives a deleted chat", () => {
    const { cards, patchMessage } = harness();
    patchMessage.mockImplementation(() => { throw new Error("gone"); });
    cards.post("p-1", "t-1", START);
    expect(() => cards.settle("p-1", { state: "failed", error: "The code expired." })).not.toThrow();
    expect(patchMessage).toHaveBeenCalledWith("t-1", "m-1", { text: "GitHub sign-in stopped: The code expired.", githubConnect: { state: "failed", error: "The code expired." } });
  });
});
