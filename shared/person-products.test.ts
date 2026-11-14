// #4185: the product object Perspicax serves is read tolerantly, a key's
// values fit the product's own form, and the bot's resume line never
// carries a value.
import { describe, expect, it } from "vitest";

import { parsePersonProduct, parsePersonProducts, productCardReason, productKeyResumeText, productKeyValues } from "./person-products.ts";

const product = {
  id: "psa", name: "Acme PSA", icon: { domain: "acme.example" },
  state: "key_refused", state_code: "expired",
  address: "https://psa.acme.example",
  access: { roles: [{ slug: "tech", name: "Technicians", mode: "dispatch" }] },
  key: { source: "own", kind: "basic", name: "mine", ending: "1a2b", expires_at: "2026-12-01T00:00:00Z", last_test: { at: "2026-11-13T10:00:00Z", ok: false, code: "unauthorized", status: 401 } },
  form: { kind: "basic", fields: [
    { slot: "username", label: { en: "Username", fr: "Nom d'utilisateur" }, secret: false, required: true },
    { slot: "password", label: { en: "Password", fr: "Mot de passe" }, secret: true, required: true },
    { slot: "site", label: "Site", required: false },
  ] },
  actions: ["set_own_key", "test", "remove_own_key", "teleport"],
  console_url: "https://console.example/products/psa",
  future_field: { anything: true },
};

describe("person products contract", () => {
  it("reads the product object and drops what it does not know", () => {
    const parsed = parsePersonProduct(product)!;
    expect(parsed).toMatchObject({
      id: "psa", name: "Acme PSA", icon: { domain: "acme.example" }, state: "key_refused", stateCode: "expired",
      address: "https://psa.acme.example", roles: [{ slug: "tech", name: "Technicians", mode: "dispatch" }],
      key: { source: "own", kind: "basic", ending: "1a2b", lastTest: { ok: false, code: "unauthorized", status: 401 } },
      actions: ["set_own_key", "test", "remove_own_key"],
      consoleUrl: "https://console.example/products/psa",
    });
    expect(parsed.form?.fields.map((field) => [field.slot, field.secret, field.required])).toEqual([["username", false, true], ["password", true, true], ["site", false, false]]);
    expect(parsed.form?.fields[2]!.label).toEqual({ en: "Site" });
    expect(JSON.stringify(parsed)).not.toContain("future_field");
  });

  it("keeps an unknown state as unknown, and a row without an id or a name out", () => {
    expect(parsePersonProduct({ id: "x", name: "X", state: "brand_new" })?.state).toBe("unknown");
    expect(parsePersonProducts({ products: [{ id: "a", name: "A", state: "connected" }, { name: "no id" }, null] }).map((entry) => entry.id)).toEqual(["a"]);
    expect(parsePersonProducts([{ id: "b", name: "B" }]).map((entry) => entry.id)).toEqual(["b"]);
    expect(parsePersonProducts("nope")).toEqual([]);
  });

  it("never keeps a console link that is not https", () => {
    expect(parsePersonProduct({ id: "a", name: "A", console_url: "javascript:alert(1)" })?.consoleUrl).toBeUndefined();
  });

  it("takes values only for the form's slots, the required ones filled", () => {
    const form = parsePersonProduct(product)!.form;
    expect(productKeyValues(form, { username: "ada", password: "pw" })).toEqual({ username: "ada", password: "pw" });
    expect(productKeyValues(form, { username: "ada" })).toBeNull();
    expect(productKeyValues(form, { username: "ada", password: "pw", other: "x" })).toBeNull();
    expect(productKeyValues(form, { username: "ada", password: 3 })).toBeNull();
    expect(productKeyValues(form, "ada")).toBeNull();
  });

  it("raises a card for a key state, a setup state for an administrator's step", () => {
    expect(productCardReason("key_missing")).toBe("key_missing");
    expect(productCardReason("key_refused")).toBe("key_refused");
    expect(productCardReason("not_served")).toBe("setup");
    expect(productCardReason("connected")).toBeNull();
  });

  it("tells the bot the outcome only", () => {
    expect(productKeyResumeText("Acme PSA", { ok: true })).toBe("Acme PSA: key set, tested, accepted. Continue the task.");
    expect(productKeyResumeText("Acme PSA", { ok: false, status: 401, code: "unauthorized" })).toBe("Acme PSA: key set, the vendor refused it (401, unauthorized).");
    expect(productKeyResumeText("Acme PSA", "declined")).toBe("Acme PSA: the person did not provide a key.");
  });
});
