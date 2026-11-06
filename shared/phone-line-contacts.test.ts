import { describe, expect, it } from "vitest";

import {
  parsePhoneLineContact,
  parsePhoneLineContactAction,
  phoneContactDirective,
  phoneContactGuidance,
  phoneContactOwnerNotice,
  phoneUnknownOwnerNotice,
} from "./phone-line-contacts.ts";

describe("phone-line-contacts (#2194)", () => {
  it("parses a contact and builds the trigger directive", () => {
    const contact = parsePhoneLineContact({
      number: "+1 514 555 0142",
      persona: "Réponds en français, ton court.",
      label: "Fournisseur",
      language: "fr",
      hide_owner_name: true,
      summarize_to_owner: true,
    });
    expect(contact).toMatchObject({
      number: "+15145550142",
      persona: "Réponds en français, ton court.",
      label: "Fournisseur",
      language: "fr",
      hideOwnerName: true,
      summarizeToOwner: true,
    });
    if (typeof contact === "string") throw new Error(contact);
    expect(phoneContactDirective(contact)).toEqual({
      contactPersona: contact.persona,
      contactLanguage: "fr",
      contactHideOwnerName: "yes",
      contactSummarizeToOwner: "yes",
      contactLabel: "Fournisseur",
    });
    expect(phoneContactGuidance(contact)).toContain("Never reveal the owner's or bot's name: yes");
  });

  it("refuses a bad number or empty persona", () => {
    expect(parsePhoneLineContact({ number: "nope", persona: "x" })).toMatch(/phone number/);
    expect(parsePhoneLineContact({ number: "+15145550142", persona: "" })).toMatch(/persona/);
  });

  it("parses list, remove, notice_unknown and set actions", () => {
    expect(parsePhoneLineContactAction({ action: "list" })).toEqual({ action: "list" });
    expect(parsePhoneLineContactAction({ action: "remove", number: "+1 514 555 0142" }))
      .toEqual({ action: "remove", number: "+15145550142" });
    expect(parsePhoneLineContactAction({ notice_unknown: true }))
      .toEqual({ action: "notice_unknown", noticeUnknown: true });
    const set = parsePhoneLineContactAction({
      number: "+15145550142",
      persona: "Be brief.",
      language: "en",
    });
    expect(set).toMatchObject({ action: "set", contact: { number: "+15145550142", language: "en" } });
  });

  it("builds owner notices without raw secrets", () => {
    expect(phoneContactOwnerNotice({ label: "Sam", from: "+1 514 555 0142", text: "Hello there" }))
      .toBe("SMS from Sam: Hello there");
    expect(phoneUnknownOwnerNotice({ from: "+1 514 555 0199", text: "Qui ?" }))
      .toBe("Unknown SMS from +1 514 555 0199: Qui ?");
  });
});
