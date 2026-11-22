import { describe, expect, it } from "vitest";

import { tableRowOrder } from "./table-data";

function order(values: string[]): string[] {
  const rows = values.map((value) => [value]);
  return tableRowOrder(rows, "", { column: 0, descending: false }).map((index) => rows[index]![0]!);
}

describe("table decimal order", () => {
  it("keeps distinct precise decimals in order when Number() collapses them", () => {
    expect(order(["9007199254740992.2", "9007199254740992.1"])).toEqual(["9007199254740992.1", "9007199254740992.2"]);
    expect(order(["1e309", "2"])).toEqual(["2", "1e309"]);
    expect(order(["1e-320", "0"])).toEqual(["0", "1e-320"]);
  });
});
