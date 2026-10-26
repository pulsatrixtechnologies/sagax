// "Scanner avec l'iPhone" (row 84): shown only while a phone can scan; a
// scanned card fills the number, the expiry and the name, never the code.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { PhoneCardScanButton, scannedCardFields, scannedCardSummary } from "./PhoneCardScanButton";

afterEach(() => setLocale("en"));

describe("PhoneCardScanButton", () => {
  it("draws nothing when no phone of the person can scan", () => {
    expect(renderToStaticMarkup(createElement(PhoneCardScanButton, { onRead: () => {}, available: false }))).toBe("");
  });

  it("offers the scan when a phone can, in the person's language", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PhoneCardScanButton, { onRead: () => {}, available: true }));
    expect(html).toContain("Scanner avec l&#x27;iPhone");
  });

  it("fills the form's number, expiry and name, never the security code", () => {
    const fields = scannedCardFields({ number: "4111111111111111", expMonth: 9, expYear: 2029, holder: "ANN" });
    expect(fields).toEqual({ pan: "4111111111111111", expMonth: "9", expYear: "2029", holder: "ANN" });
    expect(fields).not.toHaveProperty("cvv");
  });

  it("says what was read beside the masked field: the last four digits and the expiry (crypto review of #961)", () => {
    setLocale("fr");
    expect(scannedCardSummary({ number: "4111111111111111", expMonth: 9, expYear: 2029 })).toBe("Lu sur l'iPhone : carte se terminant par 1111, expire 09/2029. Vérifiez-la sur votre carte, puis tapez vous-même le code de sécurité.");
    expect(scannedCardSummary({ number: "4111111111111111" })).toContain("1111");
    expect(scannedCardSummary({ number: "4111111111111111" })).not.toContain("4111111111111111");
  });
});
