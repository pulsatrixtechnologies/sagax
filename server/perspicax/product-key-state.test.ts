import { describe, expect, it } from "vitest";
import { productKeyStateOf, withToolNote } from "./product-key-state.ts";

const refused = (error: Record<string, unknown>, how: "structured" | "text" = "structured") => ({
  jsonrpc: "2.0",
  id: 7,
  result: how === "structured"
    ? { isError: true, structuredContent: error, content: [{ type: "text", text: JSON.stringify(error) }] }
    : { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] },
});

describe("productKeyStateOf (#4185)", () => {
  it("reads the product and its key state from the details of a refused tool call", () => {
    const error = { code: "auth_unavailable", message: "no usable key", hint: "", details: { product: "acme_psa", key_state: "key_missing" } };
    expect(productKeyStateOf(refused(error))).toEqual({ product: "acme_psa", keyState: "key_missing" });
    expect(productKeyStateOf(refused(error, "text"))).toEqual({ product: "acme_psa", keyState: "key_missing" });
    // nested under error (a failed entry of a batch names the first code)
    expect(productKeyStateOf(refused({ ok: false, error: { code: "upstream_error", details: { product: "acme_psa", key_state: "key_refused" } } }))).toEqual({ product: "acme_psa", keyState: "key_refused" });
    for (const keyState of ["key_expired", "key_misfit", "sign_in_needed"]) {
      expect(productKeyStateOf(refused({ code: "auth_unavailable", details: { product: "p", key_state: keyState } }))?.keyState).toBe(keyState);
    }
  });

  it("never parses a sentence, and ignores a success, an unknown state or a missing product", () => {
    expect(productKeyStateOf(refused({ code: "auth_unavailable", message: "acme_psa has no key (key_missing)", details: {} }))).toBeNull();
    expect(productKeyStateOf(refused({ code: "auth_unavailable", details: { product: "p", key_state: "weird" } }))).toBeNull();
    expect(productKeyStateOf(refused({ code: "auth_unavailable", details: { key_state: "key_missing" } }))).toBeNull();
    const ok = { jsonrpc: "2.0", id: 1, result: { structuredContent: { code: "auth_unavailable", details: { product: "p", key_state: "key_missing" } }, content: [] } };
    expect(productKeyStateOf(ok)).toBeNull();
    expect(productKeyStateOf({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "x" } })).toBeNull();
    expect(productKeyStateOf(null)).toBeNull();
  });

  it("adds one sentence to the tool result and keeps the rest", () => {
    const body = refused({ code: "auth_unavailable", details: { product: "p", key_state: "key_missing" } });
    const noted = withToolNote(body, "A secure card was shown.") as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(noted.result.isError).toBe(true);
    expect(noted.result.content).toHaveLength(2);
    expect(noted.result.content[1]!.text).toBe("A secure card was shown.");
    expect((body.result.content as unknown[]).length).toBe(1);
  });
});
