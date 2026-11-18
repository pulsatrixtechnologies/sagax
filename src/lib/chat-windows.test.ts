import { afterEach, describe, expect, it, vi } from "vitest";
import { botIdOfChatWindow, canOpenBotInOwnWindow, chatWindowId, openBotInOwnWindow, CHAT_WINDOW_SIZE } from "./chat-windows";
import { isPageWindowId } from "@/components/artifacts/artifact-windows";

afterEach(() => vi.unstubAllGlobals());

describe("a bot's own chat window", () => {
  it("keys one window per bot, apart from artifacts and pages", () => {
    expect(chatWindowId("dumpling")).toBe("chat:dumpling");
    expect(botIdOfChatWindow("chat:dumpling")).toBe("dumpling");
    expect(botIdOfChatWindow("page:abcdefgh")).toBeNull();
    expect(botIdOfChatWindow("chat:")).toBeNull();
    expect(botIdOfChatWindow("chat:a/b")).toBeNull();
    // the artifact bridge never docks or reconciles it as an artifact
    expect(isPageWindowId("chat:dumpling")).toBe(true);
  });

  it("desktop: asks the artifact bridge for the bot's window, named and sized", async () => {
    const open = vi.fn(async () => "created" as const);
    vi.stubGlobal("window", { ogb: { artifactWindow: { open } } });
    expect(canOpenBotInOwnWindow()).toBe(true);
    await expect(openBotInOwnWindow({ id: "dumpling", name: "Dumpling" })).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith({ botId: "dumpling", artifactId: "chat:dumpling", title: "Dumpling", ...CHAT_WINDOW_SIZE });
  });

  it("desktop: a refusal opens nothing", async () => {
    vi.stubGlobal("window", { ogb: { artifactWindow: { open: async () => "refused" } } });
    await expect(openBotInOwnWindow({ id: "dumpling", name: "Dumpling" })).resolves.toBe(false);
  });

  it("web: a named browser window on the compact route, so asking again focuses it", async () => {
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }));
    vi.stubGlobal("window", { open });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh)" });
    expect(canOpenBotInOwnWindow()).toBe(true);
    await openBotInOwnWindow({ id: "dumpling", name: "Dumpling" });
    expect(open).toHaveBeenCalledWith("/artifact-window#bot=dumpling&artifact=chat%3Adumpling", "chat:dumpling", expect.stringContaining("width=480"));
    expect(focus).toHaveBeenCalled();
  });

  it("is hidden where no window can open", () => {
    vi.stubGlobal("window", {});
    expect(canOpenBotInOwnWindow()).toBe(false);
    vi.stubGlobal("window", { open: () => null });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone)" });
    expect(canOpenBotInOwnWindow()).toBe(false);
  });
});
