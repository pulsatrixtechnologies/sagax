// The owner's preview strip of a page's capabilities (#3413 lot 7): who asks
// on a card, and "Always allow" only while the organization allows it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageCapabilities } from "../../shared/page-capabilities";
import { t } from "@/lib/i18n";
import type { CapabilityBroker, CapabilityState, PendingApproval } from "../page-reader/capabilities";
import { PageCapabilityStrip } from "./PageCapabilityStrip";

const CAPS: PageCapabilities = { data: [], viewer: false, open: false, files: [], connectors: { GitHub: ["create_issue"] } };
const card = (over: Partial<PendingApproval>): PendingApproval => ({ id: 1, name: "connector:GitHub__create_issue", label: "GitHub: create_issue (acc)", at: 0, by: "page", always: true, ...over });
function render(approvals: PendingApproval[]): string {
  const state: CapabilityState = { loaded: true, caps: CAPS, reads: [], approvals, links: [] };
  const broker = { getState: () => state, subscribe: () => () => undefined } as unknown as CapabilityBroker;
  return renderToStaticMarkup(createElement(PageCapabilityStrip, { broker }));
}

describe("PageCapabilityStrip cards", () => {
  it("says who asks: the page, the reader's own rule or the organization", () => {
    const words = (html: string) => /<span class="min-w-0 flex-1">([^<]*)<\/span>/.exec(html)?.[1] ?? "";
    expect(words(render([card({ by: "page" })]))).toBe(t("pages.caps.act", { what: "GitHub: create_issue (acc)" }));
    expect(words(render([card({ by: "person" })]))).toBe(t("pages.caps.ownUse", { what: "GitHub: create_issue (acc)" }));
    expect(words(render([card({ by: "org" })]))).toBe(t("pages.caps.askUse", { what: "GitHub: create_issue (acc)" }));
  });

  it("hides Always allow while the organization turned it off", () => {
    expect(render([card({ always: true })])).toContain("data-cap-always");
    expect(render([card({ always: false })])).not.toContain("data-cap-always");
    expect(render([card({ always: false })])).toContain("data-cap-allow");
  });
});
