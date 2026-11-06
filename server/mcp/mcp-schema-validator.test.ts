import { describe, expect, it } from "vitest";

import { compileToolSchema } from "./mcp-schema-validator.ts";

describe("compileToolSchema cache (#1971)", () => {
  const schema = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };

  it("reuses the validator of a schema seen before", () => {
    expect(compileToolSchema(structuredClone(schema))).toBe(compileToolSchema(structuredClone(schema)));
  });

  it("compiles fresh when the schema or the options differ", () => {
    const base = compileToolSchema(schema);
    expect(compileToolSchema({ ...schema, required: [] })).not.toBe(base);
    expect(compileToolSchema(schema, { allErrors: true })).not.toBe(base);
    expect(compileToolSchema(schema, { strict: false })).not.toBe(base);
  });

  it("a shared validator still reports each call's own errors", () => {
    const validate = compileToolSchema(schema);
    expect(validate({})).toBe(false);
    expect(validate.errors?.[0]?.keyword).toBe("required");
    expect(validate({ id: "a" })).toBe(true);
    expect(validate.errors).toBeNull();
  });
});
