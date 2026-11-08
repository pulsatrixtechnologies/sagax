import jmespath from "jmespath";
import { describe, expect, it } from "vitest";
import { searchExtended, undefinedExtraFunction } from "./jmespath-extended.ts";

const data = {
  items: [
    { id: 3, summary: "VPN - Client A", owner: "Alex", dateEntered: "2026-11-05T10:00:00Z", hours: 1.5, tags: ["a", "b"] },
    { id: 1, summary: "Printer - Client B", owner: "sam", dateEntered: "2026-11-04T09:00:00Z", hours: 0.5, tags: [] },
    { id: 2, summary: "  Backup - Client A ", owner: null, dateEntered: "2026-11-06T08:00:00Z", hours: 2, tags: ["c"] },
  ],
  total: 3,
};

// QA 0.8.67 G8: a routine's query failed "undefined function split".
describe("searchExtended", () => {
  it("splits a string field", () => {
    expect(searchExtended(data, "items[].split(summary, ' - ')[1]")).toEqual(["Client A", "Client B", "Client A "]);
    expect(searchExtended(data, "items[?split(dateEntered, 'T')[0] == '2026-11-05'].id")).toEqual([3]);
  });

  it("adds lower, upper, trim and replace", () => {
    expect(searchExtended(data, "items[?lower(owner) == 'alex'].id")).toEqual([3]);
    expect(searchExtended(data, "items[].upper(owner)")).toEqual(["ALEX", "SAM"]);
    expect(searchExtended(data, "items[2].trim(summary)")).toBe("Backup - Client A");
    expect(searchExtended(data, "replace(items[0].summary, ' - ', ': ')")).toBe("VPN: Client A");
  });

  it("a null subject gives null, a wrong type is an error", () => {
    expect(searchExtended(data, "items[2].lower(owner)")).toBeNull();
    expect(() => searchExtended(data, "lower(total)")).toThrow(/expected argument 1 to be type string/);
    expect(() => searchExtended(data, "split(items[0].summary)")).toThrow(/takes 2 arguments/);
  });

  it("keeps the standard functions and rules beside the extra ones", () => {
    const query = "{total: sum(items[].hours), first: sort_by(items, &id)[0].id, top: max_by(items, &hours).id, clients: map(&split(summary, ' - ')[1], items), n: length(items[?contains(lower(summary), 'client a')]), tags: items[].tags[] | join(',', @)}";
    expect(searchExtended(data, query)).toEqual({ total: 4, first: 1, top: 2, clients: ["Client A", "Client B", "Client A "], n: 2, tags: "a,b,c" });
  });

  it("matches the library on the standard language", () => {
    for (const query of ["items[?hours > `1`].id", "items[-1].id", "items[::-1].id", "items[*].tags[0]", "items[0:2].{i: id, o: owner || 'none'}", "!total", "items | length(@)"]) {
      expect(searchExtended(data, query)).toEqual(jmespath.search(data, query));
    }
  });

  it("an unknown function is still an error", () => {
    expect(() => searchExtended(data, "regex(total)")).toThrow(/Unknown function/);
  });
});

describe("undefinedExtraFunction", () => {
  it("reads the function out of Perspicax's error", () => {
    expect(undefinedExtraFunction("Runtime error: Call to undefined function split (line 0, column 9)")).toBe("split");
    expect(undefinedExtraFunction("Call to undefined function regex_match")).toBeNull();
    expect(undefinedExtraFunction("Unknown function: lower()")).toBe("lower");
  });
});
