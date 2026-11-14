// #4185: the product object Perspicax serves is read tolerantly, a key's
// values fit the product's own form, and the bot's resume line never
// carries a value.
import { describe, expect, it } from "vitest";

import { parsePersonProduct, parsePersonProducts, productCardReason, productKeyResumeText, productKeyValues } from "./person-products.ts";

// The product object exactly as Perspicax serves it (crates/gateway/openapi.json
// PersonProduct: base_url, reason_code, profiles, key.auth_type/last4, actions
// as an object of booleans).
const product = {
  id: "psa", name: "Acme PSA",
  auth_state: "failing", setup: { missing: [], per_customer_address: false },
  state: "key_refused", reason_code: "expired",
  base_url: "https://psa.acme.example",
  takes_key_kind: "basic",
  profiles: [{ name: "Technicians", mode: "hybrid", personal: false }, { name: "u-ada", mode: "compact", personal: true }],
  key: {
    source: "user", named: true, own: true, id: "cred-1", name: "mine", auth_type: "basic",
    last4: "1a2b", last4_slot: "username", expires_at: "2026-12-01T00:00:00Z", expired_at: null, fits: true, health: "failing",
    last_test: { at: "2026-11-13T10:00:00Z", ok: false, code: "unauthorized", status: 401, since: "2026-11-12T08:00:00Z" },
  },
  form: { kind: "basic", fields: [
    { slot: "username", label: { en: "Username", fr: "Nom d'utilisateur" }, secret: false, required: true },
    { slot: "password", label: { en: "Password", fr: "Mot de passe" }, secret: true, required: true },
    { slot: "site", label: "Site", required: false },
  ] },
  actions: { set_own_key: true, replace_key: false, test: true, remove_own_key: true, sign_in: false, sign_out: false, teleport: true },
  console_url: "https://console.example/products/psa",
  future_field: { anything: true },
};

describe("person products contract", () => {
  it("reads the product object and drops what it does not know", () => {
    const parsed = parsePersonProduct(product)!;
    expect(parsed).toMatchObject({
      id: "psa", name: "Acme PSA", state: "key_refused", stateCode: "expired",
      address: "https://psa.acme.example",
      roles: [{ name: "Technicians", mode: "hybrid", personal: false }, { name: "u-ada", mode: "compact", personal: true }],
      key: {
        source: "own", own: true, named: true, name: "mine", kind: "basic", ending: "1a2b", endingSlot: "username", expiresAt: "2026-12-01T00:00:00Z",
        lastTest: { ok: false, code: "unauthorized", status: 401, since: "2026-11-12T08:00:00Z" },
      },
      actions: ["set_own_key", "test", "remove_own_key"],
      consoleUrl: "https://console.example/products/psa",
    });
    expect(parsed.form?.fields.map((field) => [field.slot, field.secret, field.required])).toEqual([["username", false, true], ["password", true, true], ["site", false, false]]);
    expect(parsed.form?.fields[2]!.label).toEqual({ en: "Site" });
    expect(JSON.stringify(parsed)).not.toContain("future_field");
  });

  it("words each key source Perspicax names, and keeps no key when none serves", () => {
    const keyOf = (key: Record<string, unknown>) => parsePersonProduct({ ...product, key })?.key;
    expect(keyOf({ source: "profile", named: false, own: false })).toMatchObject({ source: "role", own: false, named: false });
    expect(keyOf({ source: "default", named: true, own: false, auth_type: "bearer", last4: "zz99" })).toMatchObject({ source: "shared", kind: "bearer", ending: "zz99" });
    expect(keyOf({ source: "user", named: true, own: true })?.source).toBe("own");
    expect(keyOf({ source: null, named: false, own: false })).toBeUndefined();
    expect(keyOf({ source: "default", named: false, own: false, expired_at: "2026-11-01T00:00:00Z" })).toMatchObject({ expiredAt: "2026-11-01T00:00:00Z" });
    // a key the person may not manage: its kind is the kind the product takes
    expect(keyOf({ source: "default", named: false, own: false })?.kind).toBe("basic");
  });

  it("reads the actions Perspicax allows, as its object of booleans or as a list", () => {
    expect(parsePersonProduct({ ...product, actions: { set_own_key: false, replace_key: true, test: true, remove_own_key: false, sign_in: false, sign_out: false } })?.actions).toEqual(["replace_key", "test"]);
    expect(parsePersonProduct({ ...product, actions: ["test", "test", "nope"] })?.actions).toEqual(["test"]);
    expect(parsePersonProduct({ ...product, actions: null })?.actions).toEqual([]);
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
