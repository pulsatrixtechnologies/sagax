import { afterEach, describe, expect, it, vi } from "vitest";

import { reserveConnectionPage } from "./mcpServersModel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reserveConnectionPage", () => {
  it("opens the blank page during the click and navigates it when the address arrives", async () => {
    const page = {
      closed: false,
      opener: {} as Window | null,
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    const open = vi.fn(() => page);
    vi.stubGlobal("window", { open });
    const reserved = reserveConnectionPage();
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(page.opener).toBeNull();
    await expect(reserved.open("https://example.com/oauth")).resolves.toBe(true);
    expect(page.location.replace).toHaveBeenCalledWith("https://example.com/oauth");
  });

  it("reports a blocked page instead of opening one after the click", async () => {
    vi.stubGlobal("window", { open: () => null });
    const reserved = reserveConnectionPage();
    await expect(reserved.open("https://example.com/oauth")).resolves.toBe(false);
  });

  it("uses the desktop opener and does not open a browser tab", async () => {
    const openExternal = vi.fn(async () => {});
    const open = vi.fn();
    vi.stubGlobal("window", { open, ogb: { openExternal } });
    const reserved = reserveConnectionPage();
    expect(open).not.toHaveBeenCalled();
    await expect(reserved.open("https://example.com/oauth")).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");
  });

  it("closes a reserved page that the sign-in never uses", () => {
    const page = { closed: false, opener: {} as Window | null, location: { replace: vi.fn() }, close: vi.fn() };
    vi.stubGlobal("window", { open: () => page });
    const reserved = reserveConnectionPage();
    reserved.cancel();
    expect(page.close).toHaveBeenCalledOnce();
    return expect(reserved.open("https://example.com/oauth")).resolves.toBe(false);
  });
});
