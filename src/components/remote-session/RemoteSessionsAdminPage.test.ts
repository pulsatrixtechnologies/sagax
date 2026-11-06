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

  it("follows the Tools header standard: icon, title, count, subtitle, refresh, then + Add computer", () => {
    setLocale("en");
    const html = render();
    const header = html.slice(html.indexOf("data-remote-sessions-header"), html.indexOf("data-remote-sessions-primary"));
    expect(header).toMatch(/<h1 class="[^"]*text-\[17px\] font-semibold[^"]*">Remote sessions<\/h1>/);
    expect(header).toContain("lucide-monitor");
    expect(header).toMatch(/data-page-count=""[^>]*>0 sessions · 0 hosts</);
    expect(header).toMatch(/data-page-subtitle=""[^>]*>[^<]+</);
    expect(header.indexOf("data-remote-admin-refresh")).toBeLessThan(header.indexOf("data-remote-admin-add"));
    expect(header).toMatch(/data-remote-admin-add=""[^>]*>.*Add computer/);
    // outlined like Team map's "+ Add", never the filled brown button
    expect(header).toMatch(/data-remote-admin-add=""[^>]*class="[^"]*border-hairline\/50/);
    // search and the two pills sit in the toolbar row under the title
    const toolbar = html.slice(html.indexOf("data-remote-sessions-primary"));
    expect(toolbar.indexOf('type="search"')).toBeLessThan(toolbar.indexOf("data-remote-admin-filter-unattended"));
  });

  it("shows the empty state before any session loads", () => {
    setLocale("en");
    const html = render();
    expect(html).toContain("data-remote-admin-empty");
    // a real empty state: its icon, a title, a line and an action
    const empty = html.slice(html.indexOf("data-remote-admin-empty"));
    expect(empty).toMatch(/<svg[^>]*lucide-monitor/);
    expect(empty).toMatch(/<p class="font-medium text-ink">[^<]+<\/p>/);
    expect(empty).toContain("Add computer");
  });

  it("uses translated labels, not raw keys", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("Sessions à distance");
    expect(html).not.toContain("remoteSessionsAdmin.title");
  });
});
