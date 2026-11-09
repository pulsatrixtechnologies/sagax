import { describe, expect, it } from "vitest";

import { DEF_TOOL_RESULT_READ, savedResultMisuse } from "./core.ts";

// #3127: a connector's result handle passed to tool_result_read is refused
// with the tool that reads it, not with a generic "use the saved id".
describe("tool_result_read and the other result families", () => {
  it("names query_result of the server for a handle Sagax shaped", () => {
    const text = savedResultMisuse("files:r1.p3h3");
    expect(text).toContain("query_result");
    expect(text).toContain('"files" server');
  });

  it("names api_result_query for a handle the connector returned itself", () => {
    const text = savedResultMisuse("res_58e88a3adbc84612");
    expect(text).toContain("api_result_query");
    expect(text).toContain('"handle": "res_58e88a3adbc84612"');
  });

  it("keeps the saved id hint for anything else", () => {
    expect(savedResultMisuse("nope")).toMatch(/saved result id \(r- and a UUID\)/);
    expect(savedResultMisuse(undefined)).toMatch(/saved result id/);
  });

  it("its description sets the two connector handle formats apart", () => {
    expect(DEF_TOOL_RESULT_READ.name).not.toContain("__");
    expect(DEF_TOOL_RESULT_READ.description).toContain("r- and a UUID");
    expect(DEF_TOOL_RESULT_READ.description).toContain("connector's query tool");
  });
});
