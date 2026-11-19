import { describe, expect, it } from "vitest";

import { compileServerToolSchema, compileToolSchema, serverToolValidator } from "./mcp-schema-validator.ts";

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

// upstream #3886: servers written in Rust (schemars) put a format on every
// integer field and `ip` on addresses; one unknown format skipped the server.
describe("compileToolSchema schemars formats", () => {
  it("accepts the numeric formats Rust's schemars writes and checks their ranges", () => {
    const validate = compileToolSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      properties: { limit: { type: "integer", format: "uint" }, depth: { type: "integer", format: "uint8" }, score: { type: "number", format: "float" }, offset: { type: "integer", format: "int32" } },
    });
    expect(validate({ limit: 10, depth: 3, score: 0.5, offset: -2 })).toBe(true);
    expect(validate({ depth: 256 })).toBe(false);
    expect(validate({ limit: -1 })).toBe(false);
    expect(validate({ offset: 2147483648 })).toBe(false);
  });

  it("holds every integer format to its range, with 64-bit ones capped at the safe integer", () => {
    const cases: Array<[string, number, number]> = [
      ["int8", -128, 127], ["int16", -32768, 32767], ["int32", -2147483648, 2147483647], ["int64", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      ["int", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], ["int128", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      ["uint", 0, Number.MAX_SAFE_INTEGER], ["uint128", 0, Number.MAX_SAFE_INTEGER], ["uint8", 0, 255], ["uint16", 0, 65535], ["uint32", 0, 4294967295], ["uint64", 0, Number.MAX_SAFE_INTEGER],
    ];
    for (const [format, min, max] of cases) {
      const validate = compileToolSchema({ type: "object", properties: { n: { type: "integer", format } } });
      expect([validate({ n: min }), validate({ n: max }), validate({ n: min - 1 }), validate({ n: max + 1 }), validate({ n: 1.5 })], format).toEqual([true, true, false, false, false]);
    }
    const double = compileToolSchema({ type: "object", properties: { x: { type: "number", format: "double" } } });
    expect([double({ x: -1e300 }), double({ x: 0.25 })]).toEqual([true, true]);
  });

  it("accepts schemars' `ip` as an IPv4 or IPv6 address, without a zone id", () => {
    const validate = compileToolSchema({ type: "object", properties: { host: { type: "string", format: "ip" } } });
    expect(["192.168.0.1", "::1", "2001:db8::8a2e:370:7334"].map((host) => validate({ host }))).toEqual([true, true, true]);
    expect(["256.1.1.1", "example.com", "192.168.0.1/24", "", "fe80::1%eth0"].map((host) => validate({ host }))).toEqual([false, false, false, false, false]);
  });

  it("still refuses a format it does not know", () => {
    expect(() => compileToolSchema({ type: "object", properties: { x: { type: "string", format: "made-up" } } })).toThrow("could not be validated");
  });
});

// upstream #4701
describe("a configured server's tool schema", () => {
  it("reads a schema without $schema as 2020-12 when draft-07 refuses it", () => {
    const validate = compileServerToolSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, dependentRequired: { b: ["a"] } });
    expect(validate({ a: "x", b: "y" })).toBe(true);
    expect(validate({ b: "y" })).toBe(false);
  });

  it("drops what asserts nothing (OpenAPI example, editor hints, repeated $id) before refusing", () => {
    const validate = compileServerToolSchema({ type: "object", properties: {
      a: { $id: "/schemas/unknown", type: "string", example: "x", markdownDescription: "A" },
      b: { $id: "/schemas/unknown", type: "number", "x-vendor": true },
    }, required: ["a"] });
    expect(validate({ a: "x", b: 1 })).toBe(true);
    expect(validate({ b: 1 })).toBe(false);
  });

  it("falls back to a lenient check, then to an object check, and never throws", () => {
    expect(serverToolValidator({ type: "object", properties: { a: { type: "string" } } }).check).toBe("full");
    const lenient = serverToolValidator({ type: "object", properties: { a: { type: "string", format: "made-up" } }, required: ["a"] });
    expect(lenient.check).toBe("lenient");
    expect(lenient.validate({ a: 1 })).toBe(false);
    const object = serverToolValidator({ type: "object", properties: { a: { $ref: "https://example.invalid/x" } } });
    expect(object.check).toBe("object");
    expect(object.validate({ a: 1 })).toBe(true);
    expect(object.validate([])).toBe(false);
  });
});
