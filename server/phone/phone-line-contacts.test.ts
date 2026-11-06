import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyPhoneLineContactTool, PhoneLineContactsStore } from "./phone-line-contacts.ts";

describe("PhoneLineContactsStore (#2194)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function store() {
    const dir = mkdtempSync(join(tmpdir(), "phone-contacts-"));
    dirs.push(dir);
    return new PhoneLineContactsStore(dir);
  }

  it("sets, lists, removes and toggles notice_unknown", () => {
    const contacts = store();
    expect(applyPhoneLineContactTool(contacts, "pr_owner", { action: "list" })).toContain("No phone-line contacts");
    expect(applyPhoneLineContactTool(contacts, "pr_owner", {
      number: "+1 514 555 0142",
      persona: "Réponds en français.",
      label: "Fournisseur",
      hide_owner_name: true,
    })).toContain("Saved phone-line contact");
    expect(contacts.get("pr_owner", "+15145550142")).toMatchObject({
      number: "+15145550142",
      label: "Fournisseur",
      hideOwnerName: true,
      summarizeToOwner: true,
    });
    expect(applyPhoneLineContactTool(contacts, "pr_owner", { action: "list" })).toContain("Fournisseur");
    expect(applyPhoneLineContactTool(contacts, "pr_owner", { notice_unknown: true }))
      .toContain("Unknown SMS will post");
    expect(contacts.settings("pr_owner").noticeUnknown).toBe(true);
    expect(applyPhoneLineContactTool(contacts, "pr_owner", { action: "remove", number: "+15145550142" }))
      .toContain("Removed");
    expect(contacts.list("pr_owner")).toEqual([]);
  });

  it("isolates people and caps contacts", () => {
    const contacts = store();
    applyPhoneLineContactTool(contacts, "pr_a", { number: "+15145550101", persona: "A" });
    expect(contacts.list("pr_b")).toEqual([]);
    for (let i = 0; i < 40; i += 1) {
      const n = `+1438555${String(i).padStart(4, "0")}`;
      const out = applyPhoneLineContactTool(contacts, "pr_cap", { number: n, persona: `p${i}` });
      expect(out, n).toContain("Saved");
    }
    expect(applyPhoneLineContactTool(contacts, "pr_cap", { number: "+15145559999", persona: "overflow" }))
      .toMatch(/At most 40/);
  });
});
