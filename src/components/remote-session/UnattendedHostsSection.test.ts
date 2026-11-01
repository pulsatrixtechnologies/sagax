import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { isOpaqueId } from "../../../shared/human-id";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { setLocale, t } from "@/lib/i18n";
import { unattendedHostLabel, UnattendedHostsSection } from "./UnattendedHostsSection";

afterEach(() => setLocale("en"));

const HOST = `h_${"ab".repeat(16)}`;
const UNNAMED = `h_${"cd".repeat(16)}`;
const REVOKED = `h_${"ef".repeat(16)}`;

const host = (over: Partial<UnattendedHostRow> = {}): UnattendedHostRow => ({
  hostId: HOST, hostname: "POSTE-RECEPTION", org: null, scope: "full-control",
  installedBy: null,
  enrolledAt: "2026-10-01T10:00:00.000Z", expiresAt: "2026-12-30T10:00:00.000Z", lastSeenAt: null, revokedAt: null, state: "enrolled",
  ...over,
});

function render(hosts: UnattendedHostRow[] = [host(), host({ hostId: UNNAMED, hostname: null }), host({ hostId: REVOKED, state: "revoked", revokedAt: "2026-10-20T00:00:00.000Z" })]) {
  return renderToStaticMarkup(createElement(UnattendedHostsSection, { state: { hosts, available: true, loading: false, reload: () => {} } }));
}

/** Text a person reads: no tags, no attributes (tooltips and Copy are allowed). */
const visible = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("UnattendedHostsSection", () => {
  it("lists the hosts with readable labels and never shows a host id", () => {
    const html = render();
    const text = visible(html);
    expect(text).toContain("POSTE-RECEPTION");
    expect(text).toContain(t("remoteSessionsAdmin.hosts.unnamed"));
    for (const id of [HOST, UNNAMED, REVOKED]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/h_[0-9a-f]{8}/);
    // the id stays for support: in a tooltip and behind Copy
    expect(html).toContain(`title="${HOST}"`);
    expect(html).toContain("data-unattended-host-copy");
    expect(isOpaqueId(unattendedHostLabel({ hostname: null }))).toBe(false);
  });

  it("always offers Unattended access on an enrolled host (no server gate)", () => {
    const html = render();
    expect(html.match(/data-unattended-host-open=""/g)).toHaveLength(2);
    expect(html).toContain(t("remoteSessionsAdmin.hosts.open"));
    expect(html).not.toContain("data-unattended-hosts-open-off");
  });

  it("keeps Revoke except on a revoked host", () => {
    expect(render().match(/data-unattended-host-revoke=""/g)).toHaveLength(2);
  });

  it("says when Perspicax cannot list hosts yet", () => {
    const html = renderToStaticMarkup(createElement(UnattendedHostsSection, { state: { hosts: [], available: false, loading: false, reload: () => {} } }));
    expect(html).toContain(t("remoteSessionsAdmin.hosts.unavailable"));
  });

  it("speaks French with the requested labels", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("Hôtes inscrits");
    expect(html).toContain("Accès non surveillé");
    expect(html).toContain("Révoquer");
    expect(html).not.toContain("remoteSessionsAdmin.hosts.");
  });
});
