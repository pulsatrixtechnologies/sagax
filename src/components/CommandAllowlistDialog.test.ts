import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { instances: [] }, dispatch: vi.fn() }),
  api: vi.fn(),
}));

import { CommandAllowlistDialog } from "./CommandAllowlistDialog";

describe("CommandAllowlistDialog as a pushed page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("covers the panel with a PanelPage and the allowlist body", () => {
    const html = renderToStaticMarkup(
      createElement(CommandAllowlistDialog, { botId: "bot-1", botName: "Scout", onClose: vi.fn() }),
    );
    expect(html).toContain('data-panel-page=""');
    expect(html).toContain('data-command-allowlist=""');
    expect(html).toContain("Command allowlist");
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('aria-label="Close command allowlist"');
    expect(html).toContain("Saved commands for Scout");
  });
});
