// Checking a call's arguments against an MCP tool's input schema, the one
// way every checker does it: the chat-completions runtime before it runs a
// tool, the cloud computer's tools, and the remote proxy's call_tool.
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { isIP } from "node:net";

// A schema is a contract, so conversion that drops constraints is not safe.
// Ajv validates the same schema sent to the provider without coercing values,
// applying defaults, removing fields, or fetching external references.
const validatorOptions = {
  strict: true, allErrors: false, coerceTypes: false, useDefaults: false,
  removeAdditional: false, validateFormats: true, ownProperties: true, logger: false as const,
  // These are style diagnostics, not unsupported validation keywords. Valid
  // schemas may require undeclared names, use untyped composition branches,
  // or describe an open tuple. Ajv still enforces every constraint.
  strictRequired: false, strictTypes: false, strictTuples: false,
};

const SAFE_MIN = Number.MIN_SAFE_INTEGER;
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
// schemars writes one of these formats for each Rust integer type (isize and
// usize are `int` and `uint`); its `float` and `double` come from ajv-formats.
// These replace ajv-formats' int32 and int64: past the safe integer JSON.parse
// may already have rounded the value, so it is refused rather than sent on.
const INTEGER_FORMATS: ReadonlyArray<readonly [string, number, number]> = [
  ["int8", -128, 127],
  ["int16", -32768, 32767],
  ["int32", -2147483648, 2147483647],
  ["int64", SAFE_MIN, SAFE_MAX],
  ["int128", SAFE_MIN, SAFE_MAX],
  ["int", SAFE_MIN, SAFE_MAX],
  ["uint8", 0, 255],
  ["uint16", 0, 65535],
  ["uint32", 0, 4294967295],
  ["uint64", 0, SAFE_MAX],
  ["uint128", 0, SAFE_MAX],
  ["uint", 0, SAFE_MAX],
];

/** A validator for one tool's input schema. `allErrors` collects every
 * problem rather than stopping at the first, for a caller that lists them;
 * `strict: false` ignores keywords Ajv does not know instead of refusing
 * the schema. */
export function compileToolSchema(schema: Record<string, unknown>, options: { allErrors?: boolean; strict?: boolean } = {}): ValidateFunction {
  // Every tools refresh re-registers the same catalogs, and building a
  // compiler (meta-schema, formats) costs tens of ms per tool, so a schema
  // seen before reuses its validator. The key is the schema's content, so a
  // changed schema compiles fresh; validators run synchronously, so callers
  // sharing one never see each other's errors.
  const key = `${options.allErrors === true ? 1 : 0}${options.strict !== false ? 1 : 0}${JSON.stringify(schema)}`;
  const cached = compiledSchemas.get(key);
  if (cached) { compiledSchemas.delete(key); compiledSchemas.set(key, cached); return cached; }
  const validate = compileFresh(schema, options);
  compiledSchemas.set(key, validate);
  if (compiledSchemas.size > COMPILED_SCHEMA_LIMIT) compiledSchemas.delete(compiledSchemas.keys().next().value as string);
  return validate;
}

const COMPILED_SCHEMA_LIMIT = 512;
const compiledSchemas = new Map<string, ValidateFunction>();

function compileFresh(schema: Record<string, unknown>, options: { allErrors?: boolean; strict?: boolean }): ValidateFunction {
  const dialect = schema.$schema;
  if (dialect !== undefined && dialect !== "http://json-schema.org/draft-07/schema#" && dialect !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error("MCP tool schema uses an unsupported dialect; use JSON Schema draft-07 or 2020-12");
  }
  // One compiler per schema also prevents external IDs from resolving against
  // unrelated tools or retaining schemas after the turn has closed.
  const settings = { ...validatorOptions, allErrors: options.allErrors === true, strict: options.strict !== false };
  const compiler = dialect === "https://json-schema.org/draft/2020-12/schema" ? new Ajv2020(settings) : new Ajv(settings);
  // ajv-formats is CommonJS and exports the plugin as both module.exports
  // and .default; the latter also matches its NodeNext declaration.
  formats.default(compiler);
  // Port de OpenMausBot #3169 : GitHub's MCP server tags arguments it
  // routes into request headers with this annotation; it constrains nothing.
  compiler.addKeyword({ keyword: "x-mcp-header", schemaType: "string" });
  // Google's remote MCP servers (Maps, Gmail, Drive) annotate enums with per-value descriptions; it adds no constraint to check.
  compiler.addKeyword({ keyword: "x-google-enum-descriptions", schemaType: "array" });
  for (const [format, min, max] of INTEGER_FORMATS) compiler.addFormat(format, { type: "number", validate: value => Number.isInteger(value) && value >= min && value <= max });
  // schemars writes `ip` for Rust's IpAddr: either family, and no zone id
  // (`fe80::1%eth0`), which node's isIP accepts.
  compiler.addFormat("ip", { type: "string", validate: value => isIP(value) !== 0 && !value.includes("%") });
  try { return compiler.compile(schema); }
  catch { throw new Error("MCP tool schema could not be validated; check its constraints, formats, and references"); }
}

/** A validator's complaints as short lines a model can act on:
 * `company_id: must be string`, `must have required property 'id'`. */
export function schemaProblems(errors: readonly ErrorObject[] | null | undefined, max = 8): string[] {
  const lines = (errors ?? []).map((error) => {
    const where = error.instancePath ? `${error.instancePath.slice(1).replace(/\//g, ".")}: ` : "";
    const params = error.params as Record<string, unknown>;
    const detail = error.keyword === "additionalProperties" ? ` (${String(params.additionalProperty)})`
      : error.keyword === "enum" ? `: ${JSON.stringify(params.allowedValues).slice(0, 200)}` : "";
    return `${where}${error.message ?? "is not valid"}${detail}`;
  });
  return [...new Set(lines)].slice(0, max);
}

// ── a forgiving check, for a checker that is not the authority ──

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** Schemas longer than this are left to the server: compiling one would
 * cost more than checking it saves. */
export const LENIENT_SCHEMA_CHARS = 64_000;
const SCHEMA_MAPS = ["properties", "$defs", "definitions", "dependentSchemas"];
const SCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SCHEMA_ONE = ["items", "additionalItems", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames", "unevaluatedItems", "unevaluatedProperties"];

/** A copy of a schema without what a checker standing in front of the
 * server should never refuse on. The server still enforces all of it.
 * - `pattern`, `patternProperties` and `format`: a server's regular
 *   expression could stall this process (ReDoS), and validators disagree
 *   on formats (a date offered for a date-time).
 * - `additionalProperties: false` beside patternProperties or
 *   allOf/anyOf/oneOf, whose properties that level does not itself declare,
 *   so a strict reading refuses calls the server accepts. */
export function lenientSchema(schema: unknown, depth = 0): unknown {
  if (Array.isArray(schema)) return schema.map((child) => lenientSchema(child, depth));
  if (!isRecord(schema) || depth > 64) return schema;
  const copy: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern" || key === "patternProperties" || key === "format") continue;
    if (SCHEMA_MAPS.includes(key) && isRecord(value)) copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, lenientSchema(child, depth + 1)]));
    else if (SCHEMA_LISTS.includes(key) || SCHEMA_ONE.includes(key)) copy[key] = lenientSchema(value, depth + 1);
    else if (key === "dependencies" && isRecord(value)) copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, Array.isArray(child) ? child : lenientSchema(child, depth + 1)]));
    else copy[key] = value;
  }
  const opened = "patternProperties" in schema || SCHEMA_LISTS.slice(0, 3).some((key) => key in schema);
  if (opened && copy.additionalProperties === false) delete copy.additionalProperties;
  return copy;
}

/** A forgiving validator for a server's own input schema, or null when
 * there is none worth running: too big, or one Ajv cannot compile. What it
 * refuses is wrong for certain; what it cannot judge is the server's. */
export function lenientToolValidator(schema: unknown): ValidateFunction | null {
  if (!isRecord(schema)) return null;
  try {
    if (JSON.stringify(schema).length > LENIENT_SCHEMA_CHARS) return null;
    return compileToolSchema(lenientSchema(schema) as Json, { allErrors: true, strict: false });
  } catch {
    return null;
  }
}

// upstream #4701: a configured server's tools mount even when one schema will not compile strictly.
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
/** What tool generators emit that never asserts: OpenAPI's `example`, `discriminator`, `externalDocs` and `xml`, and VS
 * Code's editor hints. Vendor `x-` extensions too, except the two compileToolSchema checks. */
const NON_ASSERTIONS = new Set(["example", "discriminator", "externalDocs", "xml", "markdownDescription", "markdownEnumDescriptions", "enumDescriptions"]);
const CHECKED_EXTENSIONS = new Set(["x-mcp-header", "x-google-enum-descriptions"]);
const SCHEMA_KEYWORD_MAPS = ["properties", "$defs", "definitions", "dependentSchemas", "patternProperties"];

function localRefsOnly(schema: unknown, depth = 0): boolean {
  if (Array.isArray(schema)) return schema.every((child) => localRefsOnly(child, depth + 1));
  if (!isRecord(schema) || depth > 64) return true;
  if (typeof schema.$ref === "string" && !schema.$ref.startsWith("#/") && schema.$ref !== "#") return false;
  return Object.values(schema).every((child) => localRefsOnly(child, depth + 1));
}

/** The schema without what asserts nothing. Embedded `$id`s go too when every `$ref` is a JSON pointer: Effect Schema
 * gives each `unknown` field the same `"$id": "/schemas/unknown"`, and Ajv refuses a schema holding one id twice.
 * Undefined when nothing would change. */
function withoutNonAssertions(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const dropIds = localRefsOnly(schema);
  let changed = false;
  const visit = (node: unknown, depth: number): unknown => {
    if (Array.isArray(node)) return node.map((child) => visit(child, depth));
    if (!isRecord(node) || depth > 64) return node;
    const copy: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (NON_ASSERTIONS.has(key) || (key.startsWith("x-") && !CHECKED_EXTENSIONS.has(key)) || (dropIds && depth > 0 && key === "$id")) { changed = true; continue; }
      if (SCHEMA_KEYWORD_MAPS.includes(key) && isRecord(value)) copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child, depth + 1)]));
      else if (SCHEMA_LISTS.includes(key) || SCHEMA_ONE.includes(key)) copy[key] = visit(value, depth + 1);
      else copy[key] = value;
    }
    return copy;
  };
  const plain = visit(schema, 0) as Json;
  if (plain.$schema === DRAFT_07.slice(0, -1)) { plain.$schema = DRAFT_07; changed = true; }
  return changed ? plain : undefined;
}

/** A configured server's tool schema, strictly. MCP (2025-11-25) reads a schema without `$schema` as JSON Schema
 * 2020-12, while older servers write draft-07 without naming it, so such a schema is tried as each. Where strict
 * compilation refuses it, its copy without what asserts nothing is compiled instead, so a refusal still means a
 * constraint this checker cannot hold. */
export function compileServerToolSchema(schema: Record<string, unknown>): ValidateFunction {
  const plain = withoutNonAssertions(schema);
  const candidates = [schema, ...(plain ? [plain] : [])]
    .flatMap((candidate) => candidate.$schema === undefined ? [candidate, { ...candidate, $schema: DRAFT_2020_12 }] : [candidate]);
  let refusal: unknown;
  for (const candidate of candidates) {
    try { return compileToolSchema(candidate); }
    catch (error) { refusal ??= error; }
  }
  throw refusal;
}

/** How much of a server tool's schema Sagax checks a call against before the server checks it: all of it, the lenient
 * copy, or only that the arguments are an object. */
export type ServerToolCheck = "full" | "lenient" | "object";

/** A check for every tool a server lists, so one schema this checker cannot compile never costs the server its other
 * tools. Security: no compiler here loads a schema, so an external `$ref` is never fetched; it leaves the check to the
 * server. */
export function serverToolValidator(schema: Record<string, unknown>): { validate: ValidateFunction; check: ServerToolCheck } {
  try { return { validate: compileServerToolSchema(schema), check: "full" }; }
  catch {}
  const lenient = lenientToolValidator(schema);
  return lenient ? { validate: lenient, check: "lenient" } : { validate: compileToolSchema({ type: "object" }), check: "object" };
}
