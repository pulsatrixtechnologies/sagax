import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { RemoteSessionsAdminPage } from "./RemoteSessionsAdminPage";

afterEach(() => setLocale("en"));

function render() {
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(RemoteSessionsAdminPage)));
}

describe("RemoteSessionsAdminPage", () => {
  it("renders the page chrome: title, search and both filters", () => {
    setLocale("en");
    const html = render();
    expect(html).toContain("data-remote-sessions-admin");
    expect(html).toContain(t("remoteSessionsAdmin.title"));
    expect(html).toContain('type="search"');
    expect(html).toContain('data-remote-admin-filter="off"');
    expect(html).toContain("data-remote-admin-filter-unattended");
  });

  it("shows the empty state before any session loads", () => {
    setLocale("en");
    expect(render()).toContain("data-remote-admin-empty");
  });

  it("uses translated labels, not raw keys", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("Sessions à distance");
    expect(html).not.toContain("remoteSessionsAdmin.title");
  });
});
