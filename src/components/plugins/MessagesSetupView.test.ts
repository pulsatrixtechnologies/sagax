import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mac-messages-setup", () => ({
  loadMessagesSetup: vi.fn(async () => ({
    available: true,
    onThisMac: true,
    useMessages: false,
    permissions: { fullDiskAccess: "denied", automation: "notAsked" },
  })),
  openMessagesPermissionPane: vi.fn(async () => {}),
  permissionTone: (state: string) => (state === "granted" ? "ok" : state === "denied" ? "warn" : "muted"),
  setMessagesEnabled: vi.fn(async (useMessages: boolean) => ({
    available: true,
    onThisMac: true,
    useMessages,
    permissions: { fullDiskAccess: "granted", automation: "granted" },
  })),
  testMessagesSetup: vi.fn(async () => ({ conversationCount: 2, names: ["Ada Example", "Bea Example"] })),
}));

vi.mock("@/lib/i18n", () => ({
  t: (key: string, vars?: Record<string, string | number>) => {
    if (vars?.count != null) return `${key}:${vars.count}`;
    return key;
  },
}));

import { MessagesSetupView } from "./MessagesSetupView";
import { MacAppsView, MacAppsInstalledSection } from "./MacAppsView";

describe("Mac Messages setup surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Mac hub with a Messages row", () => {
    const html = renderToStaticMarkup(createElement(MacAppsView, {
      onBack: () => {},
      trail: [],
      onOpenMessages: () => {},
      messagesEnabled: false,
      messagesAvailable: true,
    }));
    expect(html).toContain('data-mac-apps=""');
    expect(html).toContain('data-mac-app="messages"');
    expect(html).toContain("connectApps.mac.messages.rowOff");
  });

  it("renders the Installed Mac section", () => {
    const html = renderToStaticMarkup(createElement(MacAppsInstalledSection, {
      onOpenMac: () => {},
      onOpenMessages: () => {},
      messagesEnabled: true,
    }));
    expect(html).toContain("data-plugins-mac");
    expect(html).toContain("connectApps.mac.messages.rowOn");
  });

  it("renders setup shell with loading then steps markers in markup contract", () => {
    // SSR first paint is the loading shell (effects do not run in renderToStaticMarkup).
    const html = renderToStaticMarkup(createElement(MessagesSetupView, {
      onBack: () => {},
      trail: [{ label: "Mac", onSelect: () => {} }],
    }));
    expect(html).toContain('data-messages-setup=""');
    expect(html).toContain("connectApps.mac.messages.loading");
  });
});
