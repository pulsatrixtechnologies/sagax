import { describe, expect, it } from "vitest";

import { phoneCallConsentBehavior } from "../../shared/phone-call-consent";
import { setLocale } from "@/lib/i18n";
import { phoneCallConsentStatusLabel } from "./PhoneCallConsentCard";

describe("PhoneCallConsentCard", () => {
  it("maps only Accept / Accepter to allow", () => {
    expect(phoneCallConsentBehavior("Accept")).toBe("allow");
    expect(phoneCallConsentBehavior("Accepter")).toBe("allow");
    expect(phoneCallConsentBehavior("Decline")).toBe("deny");
    expect(phoneCallConsentBehavior("Refuser")).toBe("deny");
    expect(phoneCallConsentBehavior("yes")).toBe("deny");
  });

  it("labels settled statuses", () => {
    setLocale("en");
    expect(phoneCallConsentStatusLabel({ status: "accepted" })).toContain("allowed");
    expect(phoneCallConsentStatusLabel({ status: "declined" })).toContain("not allowed");
    expect(phoneCallConsentStatusLabel({ status: "pending" })).toContain("Allow phone calls");
  });
});
