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
  it("renders the page chrome: title, two tabs with counts, search and the Computers filters", () => {
    setLocale("en");
    const html = render();
    expect(html).toContain("data-remote-sessions-admin");
    expect(html).toContain(t("remoteSessionsAdmin.title"));
    expect(html).toContain('type="search"');
    expect(html).toContain('data-remote-tab="computers"');
    expect(html).toContain('data-remote-tab="sessions"');
    expect(html).toContain('data-remote-admin-filter-online="off"');
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

  it("shows the empty state before any computer loads", () => {
    setLocale("en");
    const html = render();
    expect(html).toContain("data-unattended-hosts-empty");
    // a real empty state: its icon and a line
    const empty = html.slice(html.indexOf("data-unattended-hosts-empty"));
    expect(empty).toMatch(/<svg[^>]*lucide-monitor/);
    expect(empty).toMatch(/<p class="[^"]*">[^<]+<\/p>/);
  });

  it("uses translated labels, not raw keys", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("Sessions à distance");
    expect(html).not.toContain("remoteSessionsAdmin.title");
  });
});
