import { describe, expect, it } from "vitest";
import { LOCALE_HEADER, RequestLanguages, requestLanguage } from "./request-language.ts";

describe("the language a request asks in (#2803, #2805)", () => {
  it("prefers the app's own header, then the browser's first Accept-Language", () => {
    expect(requestLanguage({ [LOCALE_HEADER]: "fr", "accept-language": "en-US,en;q=0.9" })).toBe("fr");
    expect(requestLanguage({ "accept-language": "fr-CA,fr;q=0.9,en;q=0.8" })).toBe("fr-CA");
    expect(requestLanguage({ [LOCALE_HEADER]: "<script>", "accept-language": "en" })).toBe("en");
    expect(requestLanguage({ "accept-language": "*" })).toBeNull();
    expect(requestLanguage({})).toBeNull();
  });
  it("remembers the last language per person, and ignores a request with none", () => {
    const languages = new RequestLanguages(2);
    languages.note("a", "fr");
    languages.note("a", null);
    languages.note(null, "en");
    expect(languages.of("a")).toBe("fr");
    expect(languages.of(undefined)).toBe("en");
    languages.note("b", "fr");
    expect(languages.of("a")).toBeUndefined();
    expect(languages.of("b")).toBe("fr");
  });
});
